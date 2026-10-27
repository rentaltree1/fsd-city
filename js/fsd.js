// Supervised FSD: camera-only perception (8 cameras with real FOV/range, building occlusion, noisy
// tracking), route planning over the lane graph, lane selection from painted arrows, signal/stop-sign
// handling, leaving and backing into parking stalls, and a pure-pursuit + speed-profile controller.
import { S, STOP, LANE_OFF, FRONT_OFF, REAR_OFF, CENTER_OFF, WHEELBASE, CAR_LEN, CAR_WID, clamp, lerp, smooth, wrapAngle } from './config.js';
import { CAMERAS } from './car.js';
import { projectAisle, nodePoint, aisleRoute, polyLen, fillet, cutAt, stallExit, stallEntry, stallAt, inLot } from './lotnav.js';

const DEG = Math.PI / 180;
export const SUMMON_V = 3.5;   // just under 8 mph: Smart Summon's limit
const LOT_V = 3.5, REV_V = 1.1;
export const SUMMON_RANGE = 85; // metres between you and the car

// Control point for a junction turn from P (heading d1) to Q (heading d2): where the two lane centre
// lines cross, so the curve stays inside the lanes whatever angle the streets meet at. Nearly
// parallel lanes (a gentle bend) fall back to Q projected onto the entry lane.
export function turnControl(P, d1x, d1z, Q, d2x, d2z) {
  const wx = Q.x - P.x, wz = Q.z - P.z, det = d1x * d2z - d1z * d2x;
  if (Math.abs(det) > 0.12) {
    const t = (wx * d2z - wz * d2x) / det, s = (d1x * wz - d1z * wx) / det;
    if (t > 0.5 && s > 0.5) return { x: P.x + d1x * t, z: P.z + d1z * t };
  }
  const t = wx * d1x + wz * d1z;
  return { x: P.x + d1x * t, z: P.z + d1z * t };
}
// The path through a junction from P (lane end, heading d1) to Q (heading d2) at lane offset w: carry
// on along the lane, swing round an arc that keeps clear of the kerb return on the inside of the turn,
// then straighten up in the new lane. Returns [[x,z]...] from P to Q. Left turns (leftLead) first pull
// straight out into the junction, so a car waiting for oncoming traffic waits there, not at the line;
// the returned array's `lead` is that straight distance.
export function turnPoints(P, d1x, d1z, Q, d2x, d2z, w, n = 16, hw = 7.6, kerb = 6, leftLead = false) {
  const wx = Q.x - P.x, wz = Q.z - P.z, det = d1x * d2z - d1z * d2x;
  const th = Math.abs(Math.atan2(det, d1x * d2x + d1z * d2z));
  if (Math.abs(det) > 0.03) {
    const t = (wx * d2z - wz * d2x) / det, s = (d1x * wz - d1z * wx) / det;
    if (t > 0.5 && s > 0.5) {
      // inside of a right turn is the kerb (hw - w away), of a left turn the far kerb (hw + w)
      const right = det > 0, Rp = Math.max(4.6, kerb + (right ? hw - w : hw + w) - 0.6);
      const lead = leftLead && !right && th > 0.6 ? clamp(Math.min(t - 6.5, t * 0.45), 0, 8) : 0;
      const L = Math.max(1.5, Math.min(Rp * Math.tan(th / 2), t - lead, s));
      const K = { x: P.x + d1x * t, z: P.z + d1z * t };
      const A = { x: K.x - d1x * L, z: K.z - d1z * L }, B = { x: K.x + d2x * L, z: K.z + d2z * L };
      const out = [[P.x, P.z]];
      const la = Math.hypot(A.x - P.x, A.z - P.z), lb = Math.hypot(Q.x - B.x, Q.z - B.z);
      for (let i = 1, k = Math.ceil(la / 2); i <= k; i++) out.push([P.x + ((A.x - P.x) * i) / k, P.z + ((A.z - P.z) * i) / k]);
      for (let i = 1; i <= n; i++) {
        const u = i / n, a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, d = u * u;
        out.push([a * A.x + b * K.x + d * B.x, a * A.z + b * K.z + d * B.z]);
      }
      for (let i = 1, k = Math.ceil(lb / 2); i <= k; i++) out.push([B.x + ((Q.x - B.x) * i) / k, B.z + ((Q.z - B.z) * i) / k]);
      out.lead = la;
      return out;
    }
  }
  const K = turnControl(P, d1x, d1z, Q, d2x, d2z), out = [[P.x, P.z]];
  for (let i = 1; i <= n; i++) { const u = i / n, a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, d = u * u; out.push([a * P.x + b * K.x + d * Q.x, a * P.z + b * K.z + d * Q.z]); }
  return out;
}
// Round a cul-de-sac: in on the right of street e, anticlockwise round the bulb (island on the left),
// out along the reverse street. Returns [[x,z]...] from e's lane end to the reverse street's lane start.
export function uturnPoints(city, e, w0, w1 = w0) {
  const n = city.nodes[e.b], fx = e.dx, fz = e.dz, rx = e.rx, rz = e.rz, sb = e.sb, sa = e.rev.sa;
  const key = [[-sb, w0], [-sb * 0.55, w0 + 0.9], [-2, 5.4], [2.6, 4.7], [5.0, 0], [2.6, -4.7], [-2, -5.4], [-sa * 0.55, -w1 - 0.9], [-sa, -w1]];
  const P = key.map(([a, b]) => [n.x + fx * a + rx * b, n.z + fz * a + rz * b]), out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    for (let k = 0; k < 6; k++) {
      const t = k / 6, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(P[P.length - 1]);
  return out;
}
// do two oriented boxes (centre, heading, length, width) overlap? (separating axis test)
export function boxesOverlap(ax, az, ah, aL, aW, bx, bz, bh, bL, bW) {
  const dx = bx - ax, dz = bz - az;
  const ca = Math.cos(ah), sa = Math.sin(ah), cb = Math.cos(bh), sb = Math.sin(bh);
  for (const [nx, nz] of [[ca, sa], [-sa, ca], [cb, sb], [-sb, cb]]) {
    const ra = (aL / 2) * Math.abs(ca * nx + sa * nz) + (aW / 2) * Math.abs(-sa * nx + ca * nz);
    const rb = (bL / 2) * Math.abs(cb * nx + sb * nz) + (bW / 2) * Math.abs(-sb * nx + cb * nz);
    if (Math.abs(dx * nx + dz * nz) > ra + rb) return false;
  }
  return true;
}
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// ---------------------------------------------------------------- vision
export class Vision {
  constructor(city) {
    this.city = city;
    this.tracks = new Map();
    this.lights = new Map();
    this.signs = new Map();
    this.camCounts = {};
    this.t = 0;
  }
  camWorld(car, cam) {
    // model frame (x right, z back) -> world. Car forward = (cos h, sin h), right = (-sin h, cos h)
    const fx = Math.cos(car.h), fz = Math.sin(car.h), rx = -fz, rz = fx;
    const along = CENTER_OFF - cam.pos[2], lat = cam.pos[0];
    return { x: car.x + fx * along + rx * lat, z: car.z + fz * along + rz * lat, y: cam.pos[1] };
  }
  // which cameras can see a world point (x,z) with angular half-size
  seenBy(car, x, z, size, out) {
    out.length = 0;
    for (const cam of CAMERAS) {
      const p = this.camWorld(car, cam);
      const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
      if (d > cam.range + size) continue;
      const ang = wrapAngle(Math.atan2(dz, dx) - car.h - cam.yaw * DEG);
      if (Math.abs(ang) - Math.atan2(size, Math.max(d, 0.1)) > (cam.fov / 2) * DEG) continue;
      out.push(cam);
    }
    return out;
  }
  // Is the line from a camera to a point on vehicle `target` blocked by a building, or by another vehicle
  // standing between them? (A car only hides what's behind it if it's tall enough to cover it.)
  sightBlocked(cp, px, pz, target, near) {
    if (this.city.segmentBlocked(cp.x, cp.z, px, pz)) return true;
    const dx = px - cp.x, dz = pz - cp.z, L = Math.hypot(dx, dz);
    if (L < 1e-3) return false;
    const ux = dx / L, uz = dz / L;
    for (const o of near) {
      if (o === target || o.d >= target.d) break; // near is sorted by distance: only closer cars can hide it
      if ((o.H || 1.5) < Math.min(1.3, (target.H || 1.5) * 0.85)) continue;
      // slab test of the ray against the occluder's footprint, shrunk a little (rounded corners)
      const ox = cp.x - o.x, oz = cp.z - o.z, c = Math.cos(o.h), s = Math.sin(o.h);
      const sx = ox * c + oz * s, sz = -ox * s + oz * c, vx = ux * c + uz * s, vz = -ux * s + uz * c;
      const hl = o.L * 0.45, hw = o.W * 0.42;
      let t0 = 0.5, t1 = L - 0.5;
      for (const [p0, dv, h] of [[sx, vx, hl], [sz, vz, hw]]) {
        if (Math.abs(dv) < 1e-6) { if (p0 < -h || p0 > h) { t0 = 1; t1 = 0; } continue; }
        let a = (-h - p0) / dv, b = (h - p0) / dv; if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      }
      if (t0 <= t1) return true;
    }
    return false;
  }
  update(dt, car, vehicles) {
    this.t += dt;
    const cams = [];
    for (const k in this.camCounts) this.camCounts[k] = 0;
    // everything within camera range, nearest first (closer vehicles can hide farther ones)
    const near = [];
    for (const o of vehicles) {
      const dx = o.x - car.cx, dz = o.z - car.cz, d2 = dx * dx + dz * dz;
      if (d2 > 255 * 255) continue;
      o.d = Math.sqrt(d2); near.push(o);
    }
    near.sort((a, b) => a.d - b.d);
    this.near = near;
    const camPos = {};
    for (const cam of CAMERAS) camPos[cam.id] = this.camWorld(car, cam);
    for (const o of near) {
      // a vehicle is seen if any camera has a clear line to its middle, nose or tail
      this.seenBy(car, o.x, o.z, o.L / 2, cams);
      const c = Math.cos(o.h), s = Math.sin(o.h), samples = [[o.x, o.z], [o.x + c * o.L * 0.4, o.z + s * o.L * 0.4], [o.x - c * o.L * 0.4, o.z - s * o.L * 0.4]];
      const seenCams = [];
      for (const cam of cams) {
        const cp = camPos[cam.id];
        for (const [px, pz] of samples) {
          const ang = wrapAngle(Math.atan2(pz - cp.z, px - cp.x) - car.h - cam.yaw * DEG);
          if (Math.abs(ang) > (cam.fov / 2) * DEG || Math.hypot(px - cp.x, pz - cp.z) > cam.range) continue;
          if (!this.sightBlocked(cp, px, pz, o, near)) { seenCams.push(cam.id); this.camCounts[cam.id] = (this.camCounts[cam.id] || 0) + 1; break; }
        }
      }
      let tr = this.tracks.get(o.id);
      if (seenCams.length) {
        // measurement: position with range-dependent noise; speed and heading estimated from the frames
        const sig = 0.02 + o.d * 0.0012;
        const mx = o.x + gauss() * sig, mz = o.z + gauss() * sig;
        if (!tr) {
          tr = { id: o.id, x: mx, z: mz, y: o.y || 0, h: o.h, v: o.v, L: o.L, W: o.W, H: o.H, type: o.type, parked: !!o.parked, conf: 0.35, lastSeen: this.t, stopSince: null, cams: [] };
          this.tracks.set(o.id, tr);
        } else {
          tr.y = o.y || 0;
          // alpha filter on top of a constant-velocity prediction: steady, no jitter, little lag
          const px = tr.x + Math.cos(tr.h) * tr.v * dt, pz = tr.z + Math.sin(tr.h) * tr.v * dt;
          tr.x = px + (mx - px) * 0.35; tr.z = pz + (mz - pz) * 0.35;
          tr.v += (o.v + gauss() * 0.05 - tr.v) * 0.35;
          const h0 = tr.h;
          tr.h += wrapAngle(o.h + gauss() * 0.004 - tr.h) * 0.4;
          // turn rate, so a car partway through a turn is predicted to keep turning
          tr.yr = (tr.yr || 0) + (wrapAngle(tr.h - h0) / Math.max(dt, 1e-3) - (tr.yr || 0)) * 0.3;
          tr.conf = Math.min(1, tr.conf + 0.2); tr.lastSeen = this.t;
        }
        tr.cams = seenCams; tr.seen = true;
        if (tr.v < 0.3) { if (tr.stopSince === null) tr.stopSince = this.t; } else tr.stopSince = null;
      } else if (tr) {
        // just lost sight of it: keep predicting it briefly (it is probably still there)
        tr.x += Math.cos(tr.h) * tr.v * dt; tr.z += Math.sin(tr.h) * tr.v * dt;
        tr.conf -= dt * 1.2; tr.seen = false; tr.cams = [];
        if (this.t - tr.lastSeen > 1.2 || tr.conf <= 0) this.tracks.delete(o.id);
      }
    }
    for (const [id, tr] of this.tracks) if (this.t - tr.lastSeen > 1.4) this.tracks.delete(id);
    // traffic lights: only readable when facing us within the forward cameras
    const fwd = CAMERAS.filter((c) => c.yaw === 0);
    for (const [eid, sig] of Object.entries(this.city.signals)) {
      const e = this.city.edges[eid];
      const dx = sig.x - car.cx, dz = sig.z - car.cz;
      if (Math.abs(dx) > 170 || Math.abs(dz) > 170) { this.lights.delete(+eid); continue; }
      const facing = Math.cos(car.h) * e.dx + Math.sin(car.h) * e.dz;
      let ok = false;
      if (facing > 0.5) {
        for (const cam of fwd) {
          const p = this.camWorld(car, cam), d = Math.hypot(sig.x - p.x, sig.z - p.z);
          const ang = wrapAngle(Math.atan2(sig.z - p.z, sig.x - p.x) - car.h);
          if (d < Math.min(cam.range, 160) && Math.abs(ang) < (cam.fov / 2) * DEG && !this.city.segmentBlocked(p.x, p.z, sig.x, sig.z)) { ok = true; break; }
        }
      }
      if (ok) this.lights.set(+eid, { state: this.city.lightState(sig.node, e.phase), x: sig.x, z: sig.z, y: sig.y, node: sig.node, edge: e, t: this.t });
      else this.lights.delete(+eid);
    }
    for (const [eid, st] of Object.entries(this.city.stopSigns)) {
      const e = this.city.edges[eid];
      const dx = st.x - car.cx, dz = st.z - car.cz;
      if (dx * dx + dz * dz > 75 * 75) { this.signs.delete(+eid); continue; }
      const facing = Math.cos(car.h) * e.dx + Math.sin(car.h) * e.dz;
      if (facing > 0.5 && this.seenBy(car, st.x, st.z, 0.4, cams).some((cm) => { const p = camPos[cm.id]; return !this.city.segmentBlocked(p.x, p.z, st.x, st.z); })) this.signs.set(+eid, { x: st.x, z: st.z, node: st.node, edge: e });
      else this.signs.delete(+eid);
    }
  }
}

// ---------------------------------------------------------------- path accumulation
class Path {
  constructor() { this.x = []; this.z = []; this.s = []; this.g = []; this.v = []; this.j = []; }
  get n() { return this.x.length; }
  get lastS() { return this.s.length ? this.s[this.s.length - 1] : 0; }
  push(x, z, gear, vmax, j = false) {
    const n = this.x.length;
    if (n) {
      const d = Math.hypot(x - this.x[n - 1], z - this.z[n - 1]);
      if (d < 0.05 && this.g[n - 1] === gear) return;
      this.s.push(this.s[n - 1] + d);
    } else this.s.push(0);
    this.x.push(x); this.z.push(z); this.g.push(gear); this.v.push(vmax); this.j.push(j);
  }
  heading(i) {
    const a = Math.max(0, i - 1), b = Math.min(this.n - 1, i + 1);
    if (a === b) return 0;
    let hx = this.x[b] - this.x[a], hz = this.z[b] - this.z[a];
    if (this.g[i] === 'R') { hx = -hx; hz = -hz; }
    return Math.atan2(hz, hx);
  }
  pointAt(s) {
    let lo = 0, hi = this.n - 1;
    if (s <= 0) return [this.x[0], this.z[0]];
    if (s >= this.s[hi]) return [this.x[hi], this.z[hi]];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.s[m] < s) lo = m; else hi = m; }
    const t = (s - this.s[lo]) / Math.max(1e-6, this.s[hi] - this.s[lo]);
    return [lerp(this.x[lo], this.x[hi], t), lerp(this.z[lo], this.z[hi], t)];
  }
}

class Turtle {
  constructor(path, x, z, h, gear, vmax) { Object.assign(this, { path, x, z, h, gear, vmax, j: false }); path.push(x, z, gear, vmax); }
  straight(len) {
    const n = Math.max(1, Math.ceil(Math.abs(len) / 0.5));
    for (let i = 0; i < n; i++) { this.x += Math.cos(this.h) * len / n; this.z += Math.sin(this.h) * len / n; this.path.push(this.x, this.z, this.gear, this.vmax, this.j); }
    return this;
  }
  arc(R, ang) { // ang > 0 = right turn (in direction of travel)
    const n = Math.max(2, Math.ceil(Math.abs(ang) * R / 0.4)), da = ang / n, chord = 2 * R * Math.sin(Math.abs(da) / 2);
    for (let i = 0; i < n; i++) {
      this.h += da / 2; this.x += Math.cos(this.h) * chord; this.z += Math.sin(this.h) * chord; this.h += da / 2;
      this.path.push(this.x, this.z, this.gear, this.vmax, this.j);
    }
    return this;
  }
}

// Driving personalities. off: speed over the limit in mph (picked once per drive inside the range);
// a/brake: comfortable acceleration and braking; gap: following time; stopWait: pause at stop signs;
// yellow: braking it will accept rather than run a yellow; gapT: gap it needs in cross traffic;
// laneBias: how much shorter the other lane's queue must be (in metres) to switch; lat: cornering.
export const PROFILES = {
  Sloth: { off: [-4, -2], a: 1.2, brake: 2.2, gap: 2.3, stopWait: 2.2, yellow: 2.5, gapT: 6.5, laneBias: 40, lat: 1.9, turnK: 0.9 },
  Chill: { off: [0, 2], a: 1.5, brake: 2.6, gap: 1.8, stopWait: 1.6, yellow: 3.0, gapT: 5.6, laneBias: 24, lat: 2.3, turnK: 1.0 },
  Standard: { off: [4, 9], a: 2.0, brake: 3.0, gap: 1.45, stopWait: 1.1, yellow: 3.5, gapT: 4.8, laneBias: 14, lat: 2.7, turnK: 1.06 },
  Hurry: { off: [10, 14], a: 2.6, brake: 3.4, gap: 1.15, stopWait: 0.8, yellow: 4.2, gapT: 4.0, laneBias: 8, lat: 3.1, turnK: 1.12 },
  'Mad Max': { off: [15, 20], a: 3.3, brake: 4.0, gap: 0.9, stopWait: 0.45, yellow: 5.0, gapT: 3.3, laneBias: 4, lat: 3.6, turnK: 1.2, overtake: true },
};
const MPH = 0.44704;

// ---------------------------------------------------------------- planner + controller
export class FSD {
  constructor(city, vision) {
    this.city = city; this.vision = vision;
    this.engaged = false; this.path = null; this.events = []; this.signals = [];
    this.idx = 0; this.sCur = 0; this.dest = null; this.stall = null; this.chosenStall = null;
    this.status = ''; this.profile = 'Standard'; this.gearWait = 0;
    this.lastSteer = 0; this.route = []; this.segs = []; this.vOff = 0; this.decideT = 0;
  }
  get prof() { return PROFILES[this.profile] || PROFILES.Standard; }
  setProfile(name, car) {
    this.profile = name;
    this.pickSpeed();
    if (this.engaged && car) { const err = this.plan(car, this.dest, { keepEvents: true }); if (err) this.engaged = false; }
  }
  pickSpeed() { const [a, b] = this.prof.off; this.vOff = (a + Math.random() * (b - a)) * MPH; }
  setSpeed(e) { return Math.max(3, e.limit + this.vOff); }

  findStall(car) {
    for (const lot of this.city.lots) {
      if (lot.big) {
        const c = this.city.edgeLocal(lot.edge, car.cx, car.cz);
        if (inLot(lot, c.u, c.w)) return { lot, st: stallAt(lot, c.u, c.w) };
        continue;
      }
      const c = this.city.edgeLocal(lot.edge, car.x, car.z);
      if (c.u < 25 || c.u > 88 || c.w < 12 || c.w > 32) continue;
      for (const st of lot.stalls) {
        const d = Math.hypot(car.x - st.F.x, car.z - st.F.z);
        if (d < 1.6 && Math.abs(wrapAngle(car.h - st.h)) < 0.45) return { lot, st };
      }
      return { lot, st: null };
    }
    return null;
  }
  // the stall to back into: the one picked on the screen, else a free stall with an empty stall
  // between it and the nearest parked car (or any free one)
  pickStall(lot) {
    if (lot.big) return this.storeStalls(lot)[0] || null;
    const S = lot.stalls;
    if (this.chosenStall && S.includes(this.chosenStall) && !this.chosenStall.occupied) return this.chosenStall;
    const occ = (k) => k >= 0 && k < S.length && S[k].occupied;
    let best = null, bs = -1e9;
    S.forEach((st, k) => {
      if (st.occupied || st === this.leavingStall) return;
      const score = -(occ(k - 1) + occ(k + 1)) * 10 + (occ(k - 2) + occ(k + 2)) * 3 - k * 0.2;
      if (score > bs) { bs = score; best = st; }
    });
    return best || S[S.length - 1];
  }

  // ---------- parking lots (Smart Summon, store parking) ----------
  // free store stalls, best first: close to the entrance, front rows by the store, a little variety
  storeStalls(lot) {
    if (this.chosenStall && lot.stalls.includes(this.chosenStall) && !this.chosenStall.occupied) return [this.chosenStall];
    const du = lot.u0 + lot.L / 2, dw = lot.W0 + 44;
    return lot.stalls.filter((s) => !s.occupied && !s.reserved && s !== this.leavingStall)
      .map((s) => [s, Math.hypot(s.u - du, s.wm + s.n * 2.75 - dw) + (s.row < 2 ? 12 : 0) + Math.random() * 5])
      .sort((a, b) => a[1] - b[1]).map((a) => a[0]);
  }
  // the lot (and stall) the car is in, by its centre
  lotOf(car) {
    for (const lot of this.city.lots) {
      const c = this.city.edgeLocal(lot.edge, car.cx, car.cz);
      if (inLot(lot, c.u, c.w, 0.5)) return { lot, st: stallAt(lot, c.u, c.w) };
    }
    return null;
  }
  // ways to get onto the aisle network from where the car is: out of its stall either way, or straight
  // on along the aisle it's already on
  lotStarts(car, lot, st) {
    const e = lot.edge, c = this.city.edgeLocal(e, car.x, car.z);
    const hu = Math.cos(car.h) * e.dx + Math.sin(car.h) * e.dz, hw = Math.cos(car.h) * e.rx + Math.sin(car.h) * e.rz;
    const out = [];
    if (st) {
      const noseIn = hw * st.n > 0;
      for (const a of [1, -1]) {
        const ex = stallExit(lot, st, c.u, c.w, noseIn, a);
        if (!ex) continue;
        out.push({ A: projectAisle(lot, ex.end[0], ex.end[1]), dir: [a, 0], exit: ex.pts, len: ex.len + (noseIn ? 3 : 0) });
      }
    } else {
      const A = projectAisle(lot, c.u, c.w);
      if (A.d < 3) out.push({ A, dir: [hu, hw], exit: [[c.u, c.w, 'D']], len: A.d });
    }
    return out;
  }
  // push lot driving onto a path: the stall exit (reverse or forward), then the aisle polyline with rounded
  // corners. Indicators for the turns; a gear event where reverse changes to drive.
  pushLot(path, events, signals, lot, exit, poly, v = LOT_V, cut = Infinity) {
    // (a gear event wherever the manoeuvre changes direction, e.g. reverse out then pull forward)
    let gPrev = null;
    for (const [u, w, g] of exit) {
      if (gPrev && g !== gPrev) events.push({ s: path.lastS, off: 0, type: 'gear', gear: g, done: false });
      const p = lot.lp(u, w); path.push(p.x, p.z, g, g === 'R' ? REV_V : Math.min(v, 1.8));
      gPrev = g;
    }
    if (gPrev === 'R') events.push({ s: path.lastS, off: 0, type: 'gear', gear: 'D', done: false });
    let f = fillet(poly);
    if (cut < Infinity) f = cutAt(f, cut);
    let run = null;
    const s0 = path.lastS;
    for (const [u, w, side] of f) {
      const p = lot.lp(u, w);
      path.push(p.x, p.z, 'D', v);
      if (side && !run) run = { s0: path.lastS, dir: side > 0 ? 'R' : 'L' };
      if (!side && run) { signals.push({ s0: Math.max(s0, run.s0 - 10), s1: path.lastS, dir: run.dir, kind: 'turn' }); run = null; }
    }
    if (run) signals.push({ s0: Math.max(s0, run.s0 - 10), s1: path.lastS, dir: run.dir, kind: 'turn' });
  }
  // from a stall or aisle out through the nearest workable driveway and right onto the street
  lotOut(car, lot, path, events, signals) {
    const cc = this.city.edgeLocal(lot.edge, car.cx, car.cz), st = stallAt(lot, cc.u, cc.w);
    let best = null;
    for (const gk of lot.gates) {
      const G = nodePoint(lot, gk);
      for (const o of this.lotStarts(car, lot, st)) {
        const r = aisleRoute(lot, o.A, G, o.dir, [0, -1]);
        if (!r) continue;
        const L = o.len + polyLen(r);
        if (!best || L < best.L) best = { ...o, r, L, gk };
      }
    }
    if (!best) return { err: st ? 'No clear way out of this parking spot' : 'Turn toward the lot exit to start Self-Driving' };
    this.pushLot(path, events, signals, lot, best.exit, best.r);
    const e = lot.edge, [ug] = lot.aisles.nodes[best.gk], last = path.n - 1;
    // creep across the sidewalk, stop at the kerb, then a right turn into the near lane
    const T = new Turtle(path, path.x[last], path.z[last], Math.atan2(-e.rz, -e.rx), 'D', 2.2);
    const w = this.city.edgeLocal(e, T.x, T.z).w;
    T.straight(Math.max(0.2, w - e.laneOff[e.lanes - 1] - 6)).arc(6, Math.PI / 2);
    signals.push({ s0: path.lastS - 16, s1: path.lastS, dir: 'R', kind: 'turn' });
    const xe = this.exitEvent(path, e, ug, last, false);
    if (xe) events.push(xe);
    if (st) this.leavingStall = st;
    return { startEdge: e, startU: ug + 6, startW: e.laneOff[e.lanes - 1] };
  }
  // in through the driveway (already turned in, heading into the lot) and nose-first into a free stall
  lotIn(lot, path, signals) {
    const x = path.x[path.n - 1], z = path.z[path.n - 1];
    const c = this.city.edgeLocal(lot.edge, x, z);
    const A = projectAisle(lot, c.u, Math.max(c.w, lot.W0));
    const N = lot.aisles.nodes;
    const umin = Math.min(...N.map((p) => p[0])) + 0.6, umax = Math.max(...N.map((p) => p[0])) - 0.6;
    for (const st of this.storeStalls(lot).slice(0, 14)) {
      let best = null;
      for (const a of [1, -1]) {
        const ent = stallEntry(lot, st, a);
        if (!ent) continue;
        const ub = clamp(ent.start[0] - a * 6, umin, umax);
        if ((ent.start[0] - ub) * a < 1.5) continue;
        const B = projectAisle(lot, ub, st.aw);
        const r = aisleRoute(lot, A, B, [0, 1], [a, 0]);
        if (!r) continue;
        const L = polyLen(r);
        if (!best || L < best.L) best = { r: [...r, ent.start], ent, L, a };
      }
      if (!best) continue;
      this.pushLot(path, [], signals, lot, [], best.r, LOT_V);
      for (const [u, w] of best.ent.pts) { const p = lot.lp(u, w); path.push(p.x, p.z, 'D', 1.6); }
      signals.push({ s0: path.lastS - 14, s1: path.lastS - 3, dir: best.a * st.n > 0 ? 'R' : 'L', kind: 'turn' });
      return st;
    }
    return null;
  }
  // Smart Summon: out of the parking spot and along the aisles to the person at (px, pz), under 8 mph.
  // Stops alongside them, or short of them if they're standing in the aisle.
  planSummon(car, px, pz) {
    const where = this.lotOf(car);
    if (!where) return { err: 'Smart Summon works in parking lots' };
    const { lot, st } = where, pl = this.city.edgeLocal(lot.edge, px, pz);
    const B = projectAisle(lot, pl.u, pl.w);
    if (B.d > 14) return { err: 'Stand next to the parking lot your car is in' };
    let best = null;
    for (const o of this.lotStarts(car, lot, st)) {
      const r = aisleRoute(lot, o.A, B, o.dir, null);
      if (!r) continue;
      const L = o.len + polyLen(r);
      if (!best || L < best.L) best = { ...o, r, L };
    }
    if (!best) return { err: st ? 'No clear path out of the parking spot' : 'No clear path to you' };
    const path = new Path(), events = [], signals = [];
    const Lr = polyLen(fillet(best.r));
    const cut = B.d < 2.6 ? Lr - FRONT_OFF - 3.4 : Lr - CENTER_OFF;
    this.pushLot(path, events, signals, lot, best.exit, best.r, SUMMON_V, Math.max(0.2, cut));
    events.push({ s: path.lastS, off: 0, type: 'end', done: false });
    for (let i = path.n - 1; i >= 0 && path.s[i] > path.lastS - 8; i--) path.v[i] = Math.min(path.v[i], 0.6 + (path.lastS - path.s[i]) * 0.4);
    this.path = path; this.events = events; this.signals = signals; this.segs = []; this.route = [];
    this.idx = 0; this.minIdx = 0; this.sCur = 0; this.dest = null; this.stall = null; this.gearWait = 0; this.lastSteer = car.steer;
    if (st) { st.occupied = false; this.leavingStall = st; }
    this.summon = { lot, x: px, z: pz };
    return { lot, st };
  }

  routeEdges(start, startU, goal, goalU) {
    if (start === goal && startU < goalU - 8) return [start];
    const E = this.city.edges, dist = new Float64Array(E.length).fill(Infinity), prev = new Int32Array(E.length).fill(-1), done = new Uint8Array(E.length);
    const heap = [], push = (id, d) => { heap.push([d, id]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const turnCost = (m) => (m === 'L' ? 22 : m === 'R' ? 8 : m === 'U' ? 70 : 0);
    const ctlCost = (e) => (e.ctl === 'light' ? 12 : e.ctl === 'stop4' || e.ctl === 'stop2' ? 8 : 0);
    for (const [m, o] of Object.entries(this.city.moveEdge[start.id])) {
      const c = start.len - startU + turnCost(m) + ctlCost(start);
      if (c < dist[o.id]) { dist[o.id] = c; prev[o.id] = start.id; push(o.id, c); }
    }
    while (heap.length) {
      const [, id] = pop();
      if (done[id]) continue; done[id] = 1;
      if (id === goal.id) break;
      const e = E[id];
      // time-ish cost: residential streets are slower than arterials
      const k = e.lanes === 1 ? 1.35 : 1;
      for (const [m, o] of Object.entries(this.city.moveEdge[id])) {
        const c = dist[id] + e.len * k + ctlCost(e) + turnCost(m);
        if (c < dist[o.id]) { dist[o.id] = c; prev[o.id] = id; push(o.id, c); }
      }
    }
    if (!isFinite(dist[goal.id])) return null;
    const out = [];
    for (let id = goal.id; id !== -1 && id !== start.id; id = prev[id]) out.push(E[id]);
    out.push(start);
    return out.reverse();
  }

  // metres driven along a route from startU on its first edge to goalU on its last
  routeLen(r, startU, goalU) {
    if (!r) return Infinity;
    let L = -startU;
    for (let i = 0; i < r.length - 1; i++) L += r[i].len;
    return L + goalU;
  }
  // best route length from (e, u) to a destination, entering a lot from either side
  routeCost(dest, e, u) {
    if (dest.roadside) return this.routeLen(this.routeEdges(e, u, dest.edge, dest.u), u, dest.u);
    const lot = dest.lot, le = lot.edge;
    let c = this.routeLen(this.routeEdges(e, u, le, lot.du - 6), u, lot.du - 6);
    if (this.lotLeftOk(lot, true)) c = Math.min(c, this.routeLen(this.routeEdges(e, u, le.rev, le.len - lot.du - 7), u, le.len - lot.du - 7) + 25);
    return c;
  }
  // a left turn out of (or into) this lot's driveway: two-way street, and the turn's arc stays clear of
  // the junction it heads toward
  lotLeftOk(lot, into = false) {
    const e = lot.edge, r = e.rev;
    if (!r || e.lanes !== 2 || r.lanes !== 2) return false;
    // (turning left out right at a junction mouth puts us across the lane cars turn into: right out only)
    return into ? lot.du + 7 < e.len - e.sb - 4 : lot.du - 7 > e.sa + 15;
  }

  randomRoute(start, n) {
    const r = [start];
    let e = start;
    for (let i = 0; i < n; i++) {
      const mv = this.city.moveEdge[e.id], opts = Object.keys(mv).filter((m) => m !== 'U' || Object.keys(mv).length === 1);
      if (!opts.length) break;
      const w = { S: 0.55, R: 0.25, L: 0.2, r: 0.18, l: 0.15, U: 1 };
      let tot = 0; for (const o of opts) tot += w[o];
      let x = Math.random() * tot, pick = opts[0];
      for (const o of opts) { x -= w[o]; if (x <= 0) { pick = o; break; } }
      e = mv[pick]; r.push(e);
    }
    return r;
  }

  // queue length (m) in each lane of edge e between u0 and the stop line, from what the cameras see
  laneQueues(e, u0) {
    const q = new Array(e.lanes).fill(0);
    for (const tr of this.vision.tracks.values()) {
      if (tr.conf < 0.3 || tr.parked) continue;
      const c = this.city.edgeLocal(e, tr.x, tr.z);
      if (c.u < u0 || c.u > e.len || c.w < 0 || c.w > e.hw) continue;
      if (Math.cos(tr.h - e.h) < 0.7) continue;
      const l = this.laneOfW(e, c.w, c.u);
      q[l] = Math.max(q[l], e.len - e.sb - c.u + tr.L) + (tr.v < 2.5 ? 6 : 2);
    }
    return q;
  }
  bestLane(e, allowed, cur, u0) {
    const q = this.laneQueues(e, u0);
    let best = allowed.includes(cur) ? cur : allowed[0], bc = Infinity;
    for (const l of allowed) { const c = q[l] + (l !== cur ? this.prof.laneBias : 0); if (c < bc) { bc = c; best = l; } }
    return best;
  }
  // which lane of e a car at lateral offset w (at u along it) is in
  laneOfW(e, w, u = 0) {
    let best = 0;
    for (let l = 1; l < e.lanes; l++) if (Math.abs(this.city.laneW(e, l, u) - w) < Math.abs(this.city.laneW(e, best, u) - w)) best = l;
    return best;
  }
  // The vehicle in lane l of edge e that is beside us, close behind (closer still when it is catching
  // up) or just ahead of u: moving over now would cut it off. null when the lane is free. v: our speed.
  laneBlocker(e, l, u, v = 0) {
    for (const tr of this.vision.tracks.values()) {
      if (tr.conf < 0.2 || tr.parked || Math.abs((tr.y || 0) - this.carY) > 3) continue;
      const c = this.city.edgeLocal(e, tr.x, tr.z);
      if (c.w < 0 || c.w > e.hw || Math.cos(tr.h - e.h) < 0.5) continue;
      if (this.laneOfW(e, c.w, c.u) !== l) continue;
      const back = 7 + v * 0.4 + Math.max(0, tr.v - v) * 3 + tr.L / 2, fwd = 6 + Math.max(0, v - tr.v) * 1.2 + tr.L / 2;
      if (c.u > u - back && c.u < u + fwd) return tr;
    }
    return null;
  }
  laneFree(e, l, u, v = 0) { return !this.laneBlocker(e, l, u, v); }

  // Build the full drivable path. Returns null or an error string.
  plan(car, dest, opts = {}) {
    const city = this.city, path = new Path(), events = [], signals = [], segs = [];
    if (!this.vOff && !opts.keepEvents) this.pickSpeed();
    let startEdge, startU, startW;
    const parked = this.findStall(car), inLotNow = !parked && this.lotOf(car);
    if (parked && parked.st && !parked.lot.big) {
      // pull out of the stall: forward to the mouth, left onto the aisle, right to the driveway, then right
      // onto the road, or left across it when the other direction is the shorter way
      const { lot, st } = parked, e = lot.edge;
      const left = dest && this.lotLeftOk(lot) && this.routeCost(dest, e.rev, e.len - lot.du + 7) + 25 < this.routeCost(dest, e, lot.du + 6);
      const c = city.edgeLocal(e, car.x, car.z);
      const T = new Turtle(path, car.x, car.z, e.h - Math.PI / 2, 'D', 2.2);
      T.straight(Math.max(0.5, c.w - 24.1)).arc(5.5, -Math.PI / 2);
      const p = city.edgeLocal(e, T.x, T.z);
      T.straight(Math.max(0.2, p.u - (lot.du + 5))).arc(5, Math.PI / 2);
      T.vmax = 3.5;
      const iDw = path.n - 1;
      if (left) {
        const w1 = city.edgeLocal(e, T.x, T.z).w;
        T.j = true; T.straight(Math.max(0.5, w1 + e.rev.laneOff[0] - 7)).arc(7, -Math.PI / 2);
        signals.push({ s0: path.lastS - 22, s1: path.lastS, dir: 'L', kind: 'turn' });
        startEdge = e.rev; startU = city.edgeLocal(e.rev, T.x, T.z).u + 0.5; startW = e.rev.laneOff[0];
      } else {
        T.straight(2.2).arc(6, Math.PI / 2);
        signals.push({ s0: path.lastS - 16, s1: path.lastS, dir: 'R', kind: 'turn' });
        startEdge = e; startU = lot.du + 6; startW = e.laneOff[e.lanes - 1];
      }
      const xe = this.exitEvent(path, e, lot.du, iDw, left);
      if (xe) events.push(xe);
      this.leavingStall = st;
    } else if (parked || inLotNow) {
      // anywhere else in a lot (a store stall, nose-in, or out on an aisle): aisles to a driveway
      const r = this.lotOut(car, (parked || inLotNow).lot, path, events, signals);
      if (r.err) return r.err;
      ({ startEdge, startU, startW } = r);
    } else {
      const loc = city.locate(car.x, car.z, car.h);
      if (!loc) return 'Self-Driving unavailable: drive onto a mapped road';
      startEdge = loc.e; startU = loc.u; startW = clamp(loc.w, 0.6, startEdge.hw - 0.8);
      if (startU > startEdge.len - startEdge.sb - 3) {
        // already inside/near the intersection: continue straight if possible
        const mv = city.moveEdge[startEdge.id], nx = mv.S || mv.r || mv.l || Object.values(mv)[0];
        startU -= startEdge.len; startEdge = nx;
      }
      path.push(car.x, car.z, 'D', this.setSpeed(startEdge));
    }
    let stall = null, route, enterLeft = false, goalU = 0;
    if (dest && dest.roadside) {
      route = this.routeEdges(startEdge, startU, dest.edge, dest.u);
      if (!route) return 'No route found';
    } else if (dest) {
      const lot = dest.lot, e = lot.edge;
      stall = this.pickStall(lot);
      route = this.routeEdges(startEdge, startU, e, lot.du - 6); goalU = lot.du - 6;
      // turning left into the lot from the far side beats driving round the block
      if (this.lotLeftOk(lot, true)) {
        const r2 = this.routeEdges(startEdge, startU, e.rev, e.len - lot.du - 7);
        if (r2 && this.routeLen(r2, startU, e.len - lot.du - 7) + 25 < this.routeLen(route, startU, goalU)) { route = r2; enterLeft = true; goalU = e.len - lot.du - 7; }
      }
      if (!route) return 'No route found';
    } else route = this.randomRoute(startEdge, 14);
    const prof = this.prof;
    let lane = this.laneOfW(startEdge, startW, startU), nextStart = 0, carry = null;
    for (let k = 0; k < route.length; k++) {
      const e = route[k], last = k === route.length - 1, next = route[k + 1];
      const move = next ? city.moveOf(e, next) : null;
      lane = Math.min(lane, e.lanes - 1);
      const uStart = k === 0 ? startU : nextStart;
      // a bend mid-block is a gentle curve: cut the corner with an arc wide enough to take at the speed
      // limit (streets are drawn as chains of straight pieces, so a curving road is a string of small
      // kinks that must not slow the car), as long as the arc stays well inside the lane
      const bendB = !last && city.nodes[e.b].bend;
      const vlim = this.setSpeed(e);
      let trim = 0;
      if (bendB) {
        const th = Math.acos(clamp(e.dx * next.sdx + e.dz * next.sdz, -1, 1));
        const Rt = Math.max(70, (vlim * vlim * 1.3) / prof.lat);
        const maxDev = Math.sin(th) > 1e-3 ? (4 * 0.55) / Math.sin(th) : 1e9; // the corner curve dips d·sinθ/4 inside the lane line
        trim = clamp(Math.min(Rt * Math.tan(th / 2), maxDev), 0.5, Math.min((e.len - uStart) * 0.8, next.len * 0.4));
      }
      const uEnd = last ? (dest ? (dest.roadside ? dest.u : goalU) : e.len - e.sb) : bendB ? e.len - trim : e.len - e.sb;
      let target = lane, forced = false;
      if (!last) {
        const allowed = [...Array(e.lanes).keys()].filter((l) => city.laneMoves[e.id][l].includes(move));
        target = allowed.includes(lane) ? lane : allowed[0] ?? lane;
        forced = !allowed.includes(lane);
        if (allowed.length > 1) {
          const hint = opts.laneHint && opts.laneHint.get(e.id);
          if (hint !== undefined && allowed.includes(hint)) target = hint;
          // a shorter queue in the other lane is only worth a lane change when that lane is free beside us
          else if (k <= 1) { const b = this.bestLane(e, allowed, lane, uStart); if (b === lane || this.laneFree(e, b, uStart, Math.abs(car.v))) target = b; }
        }
      } else if (dest) { target = enterLeft ? 0 : e.lanes - 1; forced = target !== lane; }
      if (carry && carry.lane < e.lanes) target = carry.lane; // finish the lane change already under way
      // A lane change takes a calm ~3.5 s at the speed we'll be doing. Bends are only kinks in one street,
      // so a change that doesn't fit before a bend carries on along the next piece; it is shortened only
      // when a real junction is near.
      const vlc = Math.max(Math.abs(car.v), vlim * 0.75), span = uEnd - uStart;
      const wFrom = k === 0 ? startW : carry ? carry.wNow : city.laneW(e, lane, uStart);
      const wTo = last && dest && dest.roadside ? (dest.pullW ?? e.hw - 1.4) : carry ? carry.b : city.laneW(e, target, uEnd);
      const varying = e.laneOff1 && e.laneOff1 !== e.laneOff; // a ramp: the lane itself shifts along the street
      let lcA = wFrom, lcB = wTo, lcLen = 0, lc0 = uStart;
      if (carry) { lcA = carry.a; lcLen = carry.len; lc0 = uStart - carry.done; }
      else {
        const dw = Math.abs(wTo - wFrom);
        const want = dw > 1.5 ? vlc * 4.2 : Math.min(10, vlc * 2);
        lcLen = dw > 0.05 ? clamp(Math.min(bendB ? Infinity : span - 12, want), 3, 140) : 0;
        if (k === 0 && dw < 1) lcLen = Math.min(lcLen, 10);
        lc0 = k === 0 ? uStart + 1 : uStart + Math.min(10, Math.max(0, span - lcLen - 10));
        if (opts.laneHint && opts.laneHint.has(e.id) && k === 0) lc0 = uStart + 2; // a decided lane change happens now
        // a lane change held back because that lane wasn't free: start it no earlier than this
        const minU = opts.lcMinU && opts.lcMinU.get(e.id);
        if (minU !== undefined && dw > 1.5) lc0 = Math.max(lc0, minU);
        if (bendB) lc0 = Math.min(lc0, Math.max(uStart, uEnd - 2));
        else if (lc0 + lcLen > uEnd - 5) { lc0 = Math.max(uStart, uEnd - 5 - lcLen); lcLen = Math.max(3, Math.min(lcLen, uEnd - 5 - lc0)); }
      }
      const wAtU = varying ? (uu) => city.laneW(e, 0, uu) + (wFrom - city.laneW(e, 0, uStart)) * (1 - smooth((uu - uStart) / 12)) : (uu) => (lcLen ? lerp(lcA, lcB, smooth((uu - lc0) / lcLen)) : wTo);
      const s0 = path.lastS;
      for (let u = uStart; u < uEnd + 0.5; u += 1) {
        const uu = Math.min(u, uEnd);
        const p = city.edgePoint(e, uu, wAtU(uu));
        path.push(p.x, p.z, 'D', vlim);
        if (uu === uEnd) break;
      }
      const seg = { e, s0, s1: path.lastS, u0: uStart, lane: target, move, k };
      // the lane change on this piece (checked against traffic in that lane while it is still pending)
      if (lcLen && Math.abs(lcB - lcA) > 1.5) seg.lc = { u0: lc0, len: lcLen, to: target, from: lcA < lcB ? Math.max(0, target - 1) : Math.min(e.lanes - 1, target + 1), forced, latest: !bendB && lc0 >= uEnd - 5 - lcLen - 0.5 };
      segs.push(seg);
      if (!carry && Math.abs(lcB - lcA) > 1.5) signals.push({ s0: s0 + (lc0 - uStart) - 20, s1: s0 + (lc0 - uStart) + lcLen * 0.8, dir: lcB > lcA ? 'R' : 'L', kind: 'lane' });
      // still moving across at the bend: carry on into the next piece of the street
      const wEnd = wAtU(uEnd), doneAtBend = uEnd - lc0 + 2 * trim;
      carry = lcLen && bendB && doneAtBend < lcLen ? { a: lcA, b: lcB, len: lcLen, done: doneAtBend, lane: target, wNow: wAtU(uEnd + 2 * trim) } : null;
      lane = target;
      if (!last) {
        const node = city.nodes[e.b], sLine = path.lastS;
        let jev = null;
        const base = { s: sLine, off: FRONT_OFF + 0.6, off0: FRONT_OFF + 0.6, node, edge: e, move, toName: next.name, done: false, phase: 'approach' };
        if (node.fwy && e.kind === 'ramp') events.push(jev = { ...base, type: 'merge', fwyIn: Object.values(node.in).find((o) => o.kind === 'fwy' && !o.noEntry), fwyOut: next });
        else if (!node.pass && !node.bend && !node.bulb) {
          if (e.ctl === 'light') events.push(jev = { ...base, type: 'light' });
          else if (e.ctl === 'stop4') events.push(jev = { ...base, type: 'stop' });
          else if (e.ctl === 'stop2') events.push(jev = { ...base, type: 'stop2' });
          else if ((move === 'L' || move === 'l') && e.opp) events.push(jev = { ...base, type: 'yield', off: FRONT_OFF + 0.3 });
          else events.push(jev = { ...base, type: 'turn' }); // just for the turn-by-turn display
        }
        // turns finish a few metres down the new street so the arc has a realistic radius
        const ext = move === 'R' ? 7 : move === 'L' ? 3 : move === 'S' || move === 'U' ? 0 : 2;
        nextStart = bendB ? trim : next.sa + ext;
        const nl = city.laneAfter(e, lane, next, bendB ? 'S' : move);
        const wP = bendB ? wEnd : city.laneW(e, lane, uEnd), wQ = bendB && carry ? carry.wNow : city.laneW(next, nl, nextStart);
        const P = city.edgePoint(e, uEnd, wP), Q = city.edgePoint(next, nextStart, wQ);
        if (bendB) {
          // quadratic curve through the corner where the two lane lines meet
          const C = city.edgePoint(e, e.len, (wP + wQ) / 2), C2 = city.edgePoint(next, 0, (wP + wQ) / 2);
          const cx = (C.x + C2.x) / 2, cz = (C.z + C2.z) / 2, n = Math.max(2, Math.ceil((2 * trim) / 1));
          for (let i = 1; i <= n; i++) { const t = i / n, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), d = t * t; path.push(a * P.x + b * cx + d * Q.x, a * P.z + b * cz + d * Q.z, 'D', vlim); }
        } else if (move === 'U') {
          for (const [x, z] of uturnPoints(city, e, city.laneW(e, lane, e.len), city.laneW(next, nl, 0)).slice(1)) path.push(x, z, 'D', 3.2, true);
        } else if (move === 'S' && e.dx * next.sdx + e.dz * next.sdz > 0.998) {
          const n = Math.max(2, Math.ceil(Math.hypot(Q.x - P.x, Q.z - P.z)));
          for (let i = 1; i <= n; i++) path.push(lerp(P.x, Q.x, i / n), lerp(P.z, Q.z, i / n), 'D', vlim, !node.bend);
        } else {
          const vt = (move === 'R' ? 6 : move === 'L' ? 7.8 : move === 'S' ? vlim : 9.5) * prof.turnK;
          const tp = turnPoints(P, e.dx, e.dz, Q, next.sdx, next.sdz, city.laneW(e, lane, uEnd), 20, Math.min(e.hw, next.hw), Math.min(e.kerb, next.kerb), move === 'L');
          for (const [x, z] of tp.slice(1)) path.push(x, z, 'D', vt, !node.bend);
          if (move !== 'S') signals.push({ s0: sLine - 55, s1: path.lastS - 2, dir: move.toUpperCase(), kind: 'turn' });
          // a left turn waits for oncoming traffic pulled out into the junction, not back at the line
          if (jev && move === 'L' && tp.lead > 2) jev.sWait = sLine + tp.lead * 0.9;
        }
        if (jev) jev.sEnd = path.lastS;
        lane = nl;
      }
    }
    if (dest && dest.roadside) {
      signals.push({ s0: path.lastS - 40, s1: path.lastS, dir: 'R', kind: 'lane' });
      for (let i = path.n - 1; i >= 0 && path.s[i] > path.lastS - 30; i--) path.v[i] = Math.min(path.v[i], 2 + (path.lastS - path.s[i]) * 0.35);
      events.push({ s: path.lastS, off: 0, type: 'end', done: false });
    } else if (dest) {
      const e = dest.lot.edge;
      const T = new Turtle(path, path.x[path.n - 1], path.z[path.n - 1], enterLeft ? e.h + Math.PI : e.h, 'D', 4.2);
      const sTurn = path.lastS;
      // turning left across the oncoming lanes into the driveway: wait for a gap like any left turn
      if (enterLeft) events.push({ type: 'lotleft', s: sTurn, off: 0.5, off0: 0.5, edge: e.rev, node: city.nodes[e.rev.b], move: 'L', views: [{ e, u0: dest.lot.du, dir: -1, ws: e.laneOff.slice(0, e.lanes) }], sEnd: sTurn + 14, done: false, phase: 'approach' });
      if (enterLeft) {
        // across the oncoming lanes: flagged as a crossing so oncoming cars are yielded to
        T.j = true; T.arc(7, -Math.PI / 2);
        T.straight(Math.max(0.5, 11.4 - city.edgeLocal(e, T.x, T.z).w)); T.j = false;
      } else T.arc(6, Math.PI / 2);
      signals.push({ s0: sTurn - 45, s1: sTurn + 6, dir: enterLeft ? 'L' : 'R', kind: 'turn' });
      if (dest.lot.big) {
        // store lot: up the aisles and nose-first into a free stall near the entrance
        if (stall) stall.reserved = false;
        stall = this.lotIn(dest.lot, path, signals);
        if (!stall) return 'The parking lot is full';
      } else {
        T.vmax = 2.6; T.straight(2.2).arc(5, -Math.PI / 2);
        const p = city.edgeLocal(e, T.x, T.z);
        T.straight(stall.u + 5.5 - p.u);
        events.push({ s: path.lastS, off: 0, type: 'gear', gear: 'R', done: false });
        T.gear = 'R'; T.vmax = 1.25; T.h = e.h + Math.PI; path.push(T.x, T.z, 'R', 1.25);
        T.arc(5.5, -Math.PI / 2).straight(4.5);
      }
      events.push({ s: path.lastS, off: 0, type: 'end', done: false });
    } else {
      events.push({ s: path.lastS, off: FRONT_OFF, type: 'end', done: false, cruise: true });
    }
    // curvature speed limits
    for (let i = 2; i < path.n - 2; i++) {
      if (path.g[i] !== path.g[i - 2] || path.g[i] !== path.g[i + 2]) continue;
      const ax = path.x[i - 2], az = path.z[i - 2], bx = path.x[i], bz = path.z[i], cx = path.x[i + 2], cz = path.z[i + 2];
      const A = Math.hypot(bx - ax, bz - az), B = Math.hypot(cx - bx, cz - bz), C = Math.hypot(cx - ax, cz - az);
      const area2 = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
      const kappa = A * B * C > 1e-6 ? (2 * area2) / (A * B * C) : 0;
      if (kappa > 1e-3) path.v[i] = Math.min(path.v[i], Math.sqrt(prof.lat / kappa));
    }
    if (this.stall && this.stall !== stall) this.stall.reserved = false;
    this.path = path; this.events = events; this.signals = signals; this.route = route; this.segs = segs;
    this.idx = 0; this.minIdx = 0; this.sCur = 0; this.dest = dest; this.stall = stall; this.gearWait = 0;
    this.lastSteer = car.steer;
    if (stall) stall.reserved = true;
    return null;
  }

  engage(car, dest) {
    this.leavingStall = null;
    this.pickSpeed();
    const err = this.plan(car, dest);
    if (err) return err;
    this.engaged = true;
    this.status = dest ? `Navigating to ${dest.name}` : 'Following road';
    return null;
  }
  disengage() {
    this.engaged = false;
    if (this.stall) this.stall.reserved = false;
  }

  // mark a gear change done and never slide back onto the previous gear's segment
  finishGear(ev) {
    ev.done = true;
    const p = this.path;
    for (let i = Math.max(0, this.idx - 5); i < p.n; i++) if (p.s[i] >= ev.s - 1e-6 && p.g[i] === ev.gear) { this.minIdx = i; this.idx = Math.max(this.idx, i); break; }
  }

  nextLimitS() {
    for (const ev of this.events) if (!ev.done && (ev.type === 'gear' || ev.type === 'end')) return ev.s;
    return this.path.lastS;
  }

  updateProgress(car) {
    const p = this.path, lim = this.nextLimitS();
    let best = Math.max(this.idx, this.minIdx || 0), bd = Infinity;
    for (let i = Math.max(this.minIdx || 0, this.idx - 3); i < Math.min(p.n, this.idx + 60); i++) {
      if (p.s[i] > lim + 0.01) break;
      const d = (p.x[i] - car.x) ** 2 + (p.z[i] - car.z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    this.idx = best;
    // project onto segment for continuous s
    const j = Math.min(p.n - 1, best + 1);
    const sx = p.x[j] - p.x[best], sz = p.z[j] - p.z[best], L2 = sx * sx + sz * sz;
    const t = L2 > 1e-6 ? clamp(((car.x - p.x[best]) * sx + (car.z - p.z[best]) * sz) / L2, 0, 1) : 0;
    this.sCur = Math.min(lim, p.s[best] + t * Math.sqrt(L2));
    this.offPath = Math.sqrt(bd);
  }

  oncoming(ev, tracks) {
    const e = ev.edge, n = ev.node;
    for (const tr of tracks) {
      if (tr.conf < 0.3 || tr.parked) continue;
      const hd = Math.cos(tr.h) * -e.dx + Math.sin(tr.h) * -e.dz;
      if (hd < 0.75) continue;
      const rx = tr.x - n.x, rz = tr.z - n.z;
      const along = rx * e.dx + rz * e.dz, lat = rx * e.rx + rz * e.rz;
      if (lat > 0.5 || lat < -e.hw - 0.5) continue;
      if (along > -9 && along < 55 && (tr.v > 1 || along < 10)) return true;
    }
    return false;
  }
  intersectionClear(ev, tracks) {
    const n = ev.node;
    for (const tr of tracks) {
      if (tr.parked) continue;
      const d = Math.hypot(tr.x - n.x, tr.z - n.z), r = n.r || 8;
      if (d < r + 1.5 && tr.v > 0.3) return false;
      if (d < r + 8 && tr.stopSince !== null && tr.stopSince < ev.t0 - 0.3) return false;
    }
    return true;
  }
  // two-way stop: no through traffic arriving within the gap this personality needs, nobody in the box
  gapClear(ev, tracks) {
    const n = ev.node, pri = Object.values(n.in).filter((e) => e.ctl === 'none');
    for (const tr of tracks) {
      if (tr.parked || tr.conf < 0.25) continue;
      const dn = Math.hypot(tr.x - n.x, tr.z - n.z);
      if (dn < (n.r || 8) + 2 && tr.v > 0.4) return false;
      for (const pe of pri) {
        if (Math.cos(tr.h - pe.h) < 0.6) continue;
        const c = this.city.edgeLocal(pe, tr.x, tr.z);
        if (c.u < -5 || c.u > pe.len + 3 || c.w < -0.5 || c.w > pe.hw + 0.5) continue;
        const d = pe.len - c.u;
        if (d < 12 || (tr.v > 0.8 && d / tr.v < this.prof.gapT)) return false;
      }
    }
    return true;
  }

  mustStop(ev, car, tracks, d, simT) {
    const v = Math.abs(car.v), prof = this.prof;
    if (ev.type === 'end' && ev.cruise) return d < 6; // the route is extended long before this
    if (ev.type === 'gear' || ev.type === 'end') return true;
    if (ev.type === 'turn') { if (d < -0.5) ev.done = true; return false; }
    if (d < -0.5) { ev.done = true; return false; }
    if (ev.type === 'light') {
      if (ev.commit) return false;
      const L = this.vision.lights.get(ev.edge.id);
      const dLine = ev.s - ev.off0 - this.sCur, left = ev.move === 'L' || ev.move === 'l';
      if (L) ev.seen = L.state;
      // already out in the junction waiting to turn left (the signal may be out of view, or have
      // changed): finish the turn as soon as the oncoming traffic gives a gap or stops
      if (dLine < -0.3 && left && (!L || L.state !== 'G')) return this.leftTurn(ev, car, tracks, d);
      if (dLine < -0.3 && !L) { ev.commit = true; return false; }
      if (!left || (L && L.state !== 'G')) ev.off = ev.off0;
      if (!L) {
        // can't read the signal: stop at the line, then treat it like an all-way stop
        if (d > 18) return false;
        if (d < 0.9 && v < 0.12 && ev.blindT0 == null) ev.blindT0 = this.vision.t;
        if (ev.blindT0 != null && this.vision.t - ev.blindT0 > 4 && this.intersectionClear({ ...ev, t0: ev.blindT0 }, tracks)) { ev.commit = true; return false; }
        ev.reason = 'light';
        return true;
      }
      ev.seen = L.state;
      const aReq = (v * v) / (2 * Math.max(dLine, 0.1));
      if (L.state === 'R') {
        // already over the line when it changed: clear the intersection
        if (dLine < 1.5 && aReq > 6) { ev.commit = true; return false; }
        ev.decided = 'stop'; ev.reason = 'light'; return true;
      }
      if (L.state === 'Y') {
        // decide once: stop if it can be done at this personality's braking, otherwise proceed
        if (!ev.decided) ev.decided = aReq < prof.yellow ? 'stop' : 'go';
        if (ev.decided === 'go') { ev.commit = true; return false; }
        ev.reason = 'light'; return true;
      }
      ev.decided = null;
      if (left) return this.leftTurn(ev, car, tracks, d);
      if (dLine < 2) ev.commit = true;
      return false;
    }
    if (ev.type === 'yield' || ev.type === 'lotleft') {
      if (ev.commit) return false;
      if (d > 30) return false;
      return this.leftTurn(ev, car, tracks, d);
    }
    if (ev.type === 'merge') {
      // joining the freeway: a gap in its right lane (nothing alongside the merge point, nothing
      // coming up behind it within a few seconds), else wait at the end of the ramp
      if (ev.commit) return false;
      if (d > 70) return false;
      const fin = ev.fwyIn, fout = ev.fwyOut;
      let clear = true;
      for (const tr of tracks) {
        if (tr.conf < 0.3 || tr.parked) continue;
        for (const [q, past] of [[fin, false], [fout, true]]) {
          if (!q || Math.cos(tr.h - q.h) < 0.5) continue;
          const c = this.city.edgeLocal(q, tr.x, tr.z);
          if (c.w < 0 || c.w > q.hw || this.laneOfW(q, c.w, c.u) !== q.lanes - 1) continue;
          const toNode = past ? -c.u : q.len - c.u; // metres before the merge point (negative: past it)
          if (toNode > -6 && toNode < Math.max(28, tr.v * 3.2 + 6)) clear = false;
        }
      }
      if (clear) { ev.okSince ??= this.vision.t; if (d < 30 && this.vision.t - ev.okSince > 0.3) { ev.commit = true; return false; } return false; }
      ev.okSince = null; ev.reason = 'gap';
      return true;
    }
    if (ev.type === 'exit') {
      if (ev.phase === 'go') return false;
      if (ev.phase === 'approach') { if (d < 0.6 && v < 0.12) { ev.phase = 'judge'; ev.t0 = this.vision.t; } ev.reason = 'exit'; return true; }
      const safe = this.safeToGo(car, tracks, ev).ok;
      if (!safe) ev.blindSince = null;
      const clear = safe && this.viewWaived(ev, (o) => this.roadViewClear(car, ev.views, o));
      if (clear) ev.okSince ??= this.vision.t; else ev.okSince = null;
      if (clear && this.vision.t - ev.okSince > 0.5 && this.vision.t - ev.t0 > 0.8) { ev.phase = 'go'; ev.commit = true; return false; }
      ev.reason = 'exit'; return true;
    }
    if (ev.type === 'stop' || ev.type === 'stop2') {
      if (ev.phase === 'go') return false;
      if (ev.phase === 'approach') { if (d < 0.9 && v < 0.12) { ev.phase = 'stopped'; ev.t0 = this.vision.t; } ev.reason = 'stop'; return true; }
      // after the full stop: creep forward (slowly, smoothly) until the cameras can see far enough down
      // the cross street, then go only when the gap is big enough to get all the way across
      const waited = this.vision.t - ev.t0 > prof.stopWait;
      if (ev.phase === 'stopped' && waited) ev.phase = this.viewClear(car, ev) ? 'judge' : 'creep';
      if (ev.phase === 'creep') {
        // the stopping point moves out at walking pace to at most 3.2 m past the line
        if (ev.creepT0 == null) ev.creepT0 = this.vision.t;
        ev.vcap = 1.1;
        ev.off = ev.off0 - Math.min(3.2, 0.7 + (this.vision.t - ev.creepT0) * 1.2);
        if (this.viewClear(car, ev) || ev.off <= ev.off0 - 3.15) ev.phase = 'judge';
        ev.reason = 'creep'; return true;
      }
      if (ev.phase === 'judge') {
        ev.vcap = null;
        const okOrder = ev.type === 'stop' ? this.intersectionClear(ev, tracks) : true;
        // a real gap: nothing coming, a clear view (cars can hide behind the one that just went by),
        // held for half a second
        const safe = okOrder && this.safeToGo(car, tracks, ev).ok;
        if (!safe) ev.blindSince = null;
        const clear = safe && this.viewWaived(ev, (o) => this.viewClear(car, ev, null, o));
        if (clear) ev.okSince ??= this.vision.t; else ev.okSince = null;
        if (clear && this.vision.t - ev.okSince > 0.5) { ev.phase = 'go'; ev.commit = true; return false; }
        ev.reason = ev.type === 'stop' ? 'stopwait' : 'gap';
        return true;
      }
      ev.reason = 'stop';
      return true;
    }
    return false;
  }

  // A partly hidden view (a street curving behind a building) is acceptable once we've been stopped,
  // seeing nothing coming, for a few seconds: anything out of sight would have come into view by now.
  // (Called only when nothing we can see is in the way.)
  // Traffic going past blocking the view doesn't count (wait for it to pass and look again): only a view
  // blocked by buildings or parked cars is waived.
  viewWaived(ev, viewOk, stopped = true) {
    if (viewOk('all')) return true;
    if (!stopped || viewOk('static')) { ev.blindSince = null; return false; }
    ev.blindSince ??= this.vision.t;
    return this.vision.t - ev.blindSince > 3.5;
  }

  // Pulling out of a driveway onto road e is like a stop sign: stop with the nose at the kerb, look both
  // ways, go only on a real gap. iFrom: first path index of the driveway run; left: crossing to the far side.
  exitEvent(path, e, u0, iFrom, left) {
    let s = null;
    for (let i = iFrom; i < path.n; i++) if (this.city.edgeLocal(e, path.x[i], path.z[i]).w <= e.hw + 0.4 + FRONT_OFF) { s = path.s[i]; break; }
    if (s === null) return null;
    const views = [{ e, u0, dir: -1, ws: e.laneOff.slice(0, e.lanes) }];
    if (left) views.push({ e, u0, dir: 1, ws: e.laneOff.slice(0, e.lanes).map((w) => -w) });
    return { type: 'exit', s, off: 0, off0: 0, edge: e, node: this.city.nodes[e.b], phase: 'approach', views, sEnd: path.lastS + 4, done: false };
  }
  // can the cameras see along road e on either side of u0 (traffic heading toward u0)?
  roadViewClear(car, views, occl = 'all') {
    const cams = CAMERAS.filter((c) => c.id === 'main' || c.id === 'wide' || c.id === 'lpillar' || c.id === 'rpillar').map((c) => this.vision.camWorld(car, c));
    const near = (this.vision.near || []).filter((o) => o.parked || (occl === 'all' && (o.v || 0) > 0.5));
    for (const { e, u0, dir, ws } of views) for (const d of [14, 30, 55]) {
      const u = u0 + dir * d;
      if (u < e.sa || u > e.len - e.sb) continue;
      for (const w of ws) {
        const pt = this.city.edgePoint(e, u, w), probe = { d: Math.hypot(pt.x - car.cx, pt.z - car.cz), H: 1.5 };
        if (!cams.some((c) => !this.vision.sightBlocked(c, pt.x, pt.z, probe, near))) return false;
      }
    }
    return true;
  }

  // Unprotected left: pull out into the junction to the waiting point, then turn once there's a gap in
  // the oncoming traffic big enough to get across. Once it goes, it's committed.
  leftTurn(ev, car, tracks, d) {
    if (ev.commit) return false;
    if (d > 45) return false;
    // the gap has to be really there: nothing coming that we can see, the oncoming lanes visible far
    // enough (a car can hide behind the one that just passed), and it has stayed that way for a moment
    const v = Math.abs(car.v);
    // (once our signal has gone yellow/red the oncoming traffic is stopping too: a queue at their line
    // blocking the view doesn't hide anyone coming)
    const needView = v <= 4 && !(ev.type === 'light' && ev.seen && ev.seen !== 'G');
    const safe = this.safeToGo(car, tracks, ev).ok;
    if (!safe) ev.blindSince = null;
    const clear = safe && (!needView || this.viewWaived(ev, (o) => (ev.views ? this.roadViewClear(car, ev.views, o) : this.viewClear(car, ev, [ev.edge.opp], o)), v < 0.3));
    if (clear) ev.okSince ??= this.vision.t; else ev.okSince = null;
    const settled = clear && (v > 4 || this.vision.t - ev.okSince > 0.5);
    if (settled) { if (d < 6 || v < 3 || ev.sWait == null) { ev.commit = true; } return false; }
    if (clear && v > 4) return false;
    // not clear: stop at the waiting point inside the junction (or at the line if the turn has none)
    if (ev.sWait != null) ev.off = -(ev.sWait - ev.s);
    ev.reason = 'yield';
    return true;
  }

  // Can we see far enough down every street that has right of way here? (Line of sight from the
  // front and pillar cameras past buildings to points along those lanes.)
  // Can we see far enough down the streets that cross our path? Line of sight from the front and pillar
  // cameras to points along those lanes, past buildings and past other vehicles.
  viewClear(car, ev, approaches = null, occl = 'all') {
    const n = ev.node, cams = CAMERAS.filter((c) => c.id === 'main' || c.id === 'wide' || c.id === 'lpillar' || c.id === 'rpillar').map((c) => this.vision.camWorld(car, c));
    const list = approaches || Object.values(n.in).filter((pe) => pe !== ev.edge && !(ev.type === 'stop2' && pe.ctl !== 'none') && Math.abs(wrapAngle(pe.h - ev.edge.h)) >= 0.5);
    // (a stopped car in the traffic can block the view, but whatever is behind it has to stop too)
    const near = (this.vision.near || []).filter((o) => o.parked || (occl === 'all' && (o.v || 0) > 0.5));
    for (const pe of list) {
      if (!pe) continue;
      const need = clamp(pe.limit * 4.2, 30, 65);
      for (const { e: q, off } of this.city.feeders(pe, need + 10)) {
        for (const dd of [12, 28, need]) {
          const u = q.len - (dd - off);
          if (u < 0 || u > q.len) continue;
          for (const l of q.laneOff.slice(0, q.lanes)) {
            const pt = this.city.edgePoint(q, u, l), dist = Math.hypot(pt.x - car.cx, pt.z - car.cz), probe = { d: dist, H: 1.5 };
            if (!cams.some((c) => !this.vision.sightBlocked(c, pt.x, pt.z, probe, near))) return false;
          }
        }
      }
    }
    return true;
  }

  // Gap acceptance: if we went now (accelerating like this personality does, slowing to the turn speed),
  // would any vehicle the cameras see come within its safety margin of us before we're clear of the
  // junction? Crossing cars are assumed to keep their speed and heading.
  safeToGo(car, tracks, ev) {
    const p = this.path, prof = this.prof, sEnd = Math.min((ev.sEnd ?? ev.s + 22) + REAR_OFF + 1.5, ev.s + 40);
    const tb = clamp(prof.gapT * 0.3, 0.9, 2.0), aGo = prof.a * 0.85, fx = Math.cos(car.h), fz = Math.sin(car.h);
    const cand = [];
    for (const tr of tracks) {
      if (tr.parked || tr.conf < 0.25 || Math.abs((tr.y || 0) - car.y) > 3) continue;
      const rx = tr.x - car.cx, rz = tr.z - car.cz;
      if (rx * rx + rz * rz > 110 * 110) continue;
      const dh = Math.abs(wrapAngle(tr.h - car.h)), ahead = rx * fx + rz * fz;
      if (dh < 0.5 && (ahead > 0 || ahead < -3)) continue; // same way as us: the follow logic handles it
      cand.push(tr);
    }
    if (!cand.length) return { ok: true };
    // their motion: current speed, and current turn rate for up to a quarter turn
    const them = cand.map((tr) => ({ tr, x: tr.x, z: tr.z, h: tr.h, turned: 0, yr: Math.abs(tr.yr || 0) > 0.05 ? clamp(tr.yr, -0.9, 0.9) : 0 }));
    // our own motion if we go: follow the path's speed profile (turn speeds, curves) with this
    // personality's acceleration and ordinary braking, from the speed we're doing now
    let s = this.sCur, v = Math.abs(car.v), j = this.idx;
    const T = 0.15, delay = v < 0.5 ? 0.35 : 0;
    const vAhead = (s0) => { let m = 30; for (let k = j; k < p.n && p.s[k] < s0 + 25; k++) m = Math.min(m, Math.sqrt(p.v[k] * p.v[k] + 2 * 2.2 * Math.max(0, p.s[k] - s0))); return m; };
    for (let t = 0; t <= 12; t += T) {
      if (t > delay) {
        while (j < p.n - 1 && p.s[j + 1] <= s) j++;
        const vt = vAhead(s);
        v = v < vt ? Math.min(vt, v + aGo * T) : Math.max(vt, v - 2.6 * T);
        s += v * T;
      }
      if (s > sEnd) return { ok: true };
      const [cx, cz] = p.pointAt(s + CENTER_OFF);
      const [ax, az] = p.pointAt(s + CENTER_OFF + 1.5);
      const h = Math.atan2(az - cz, ax - cx);
      for (const m of them) {
        const tr = m.tr;
        if (t > 0) {
          if (m.yr && Math.abs(m.turned) < 1.57) { m.h += m.yr * T; m.turned += m.yr * T; }
          m.x += Math.cos(m.h) * tr.v * T; m.z += Math.sin(m.h) * tr.v * T;
        }
        // their footprint stretched by the time margin we want ahead of and behind them
        const ext = tr.v * tb, back = tr.v * 0.4;
        const ox = m.x + Math.cos(m.h) * (ext - back) / 2, oz = m.z + Math.sin(m.h) * (ext - back) / 2;
        if (boxesOverlap(cx, cz, h, CAR_LEN + 0.8, CAR_WID + 0.6, ox, oz, m.h, tr.L + ext + back, tr.W + 0.4)) return { ok: false, tr, t };
      }
    }
    return { ok: true };
  }

  // Vehicles whose paths cross ours: where will they be when we get there? If one will be on our path
  // (within its width) at about the time we arrive, we must be stopped short of that point.
  // Returns the path distance (from sCur) of the first conflict, or Infinity.
  conflictAhead(car, tracks, v) {
    const p = this.path, fx = Math.cos(car.h), fz = Math.sin(car.h);
    const vMe = Math.max(v, 2.0);
    let best = Infinity; this.conflictWith = null;
    // through a junction we've committed to (the gap check said go), don't second-guess every frame:
    // only an imminent collision (under a second away) stops us there
    const committed = [];
    for (const ev of this.events) if (!ev.done && (ev.commit || ev.phase === 'go')) committed.push([ev.s - 4, (ev.sEnd ?? ev.s + 25) + 2]);
    for (const tr of tracks) {
      if (tr.conf < 0.3 || tr.parked || Math.abs((tr.y || 0) - car.y) > 3) continue;
      const rx = tr.x - car.x, rz = tr.z - car.z, dd = Math.hypot(rx, rz);
      if (dd > 70) continue;
      const dh = Math.abs(wrapAngle(tr.h - car.h));
      // a car that has (nearly) stopped won't get out of the way: test our actual footprint along the path
      // against it, committed or not (so we neither creep into it nor wait for one that's clear of us)
      if (tr.v < 0.8 && dh >= 0.45) {
        for (let j = this.idx; j < p.n; j++) {
          const ds = p.s[j] - this.sCur;
          if (ds > 16 || p.g[j] !== 'D') break;
          const [cx, cz] = p.pointAt(p.s[j] + CENTER_OFF), [ax, az] = p.pointAt(p.s[j] + CENTER_OFF + 1);
          if (boxesOverlap(cx, cz, Math.atan2(az - cz, ax - cx), CAR_LEN + 0.5, CAR_WID + 0.3, tr.x, tr.z, tr.h, tr.L, tr.W)) {
            if (ds + FRONT_OFF < best) { best = ds + FRONT_OFF; this.conflictWith = tr; }
            break;
          }
        }
        continue;
      }
      if (dh < 0.45) continue;                      // same direction: the lead-vehicle logic handles it
      if (rx * fx + rz * fz < -4 && dh < 2.2) continue; // behind us
      const oncoming = dh > 2.6;
      const tvx = Math.cos(tr.h) * tr.v, tvz = Math.sin(tr.h) * tr.v, rad = 1.25 + tr.W * 0.5 + 0.4;
      for (let j = this.idx; j < p.n; j += 2) {
        const ds = p.s[j] - this.sCur;
        if (ds > 42) break;
        if (p.g[j] !== 'D') break;
        if (oncoming && !p.j[j]) continue;           // oncoming traffic only matters where we cross it
        const tMe = ds / vMe;
        if (tMe > 4.5) break;
        if (committed.length && committed.some(([a, b]) => p.s[j] >= a && p.s[j] <= b) && ds / Math.max(v, 0.5) > 1.0) continue;
        let hit = false;
        for (const dt of [-1.2, -0.6, 0, 0.6, 1.2]) {
          const t = Math.max(0, tMe + dt);
          const ox = tr.x + tvx * t, oz = tr.z + tvz * t;
          if ((ox - p.x[j]) ** 2 + (oz - p.z[j]) ** 2 < rad * rad) { hit = true; break; }
        }
        if (hit) { if (ds < best) { best = ds; this.conflictWith = tr; } break; }
      }
    }
    return best;
  }

  // returns control command
  step(dt, car, simT) {
    const prof = this.prof;
    this.carY = car.y || 0;
    this.updateProgress(car);
    const tracks = [...this.vision.tracks.values()];
    const v = Math.abs(car.v);
    const isRev = () => this.path.g[Math.min(this.path.n - 1, this.idx + 1)] === 'R';
    // ---- lane changes only into a gap: a pending change whose lane isn't free beside us is put off
    // (dropped when it was only for a shorter queue); one that has to happen before the junction and
    // is running out of room eases off to let the other car by first
    this.lcCheckT = (this.lcCheckT || 0) - dt;
    let vLc = Infinity;
    if (!isRev() && this.lcCheckT <= 0) {
      this.lcCheckT = 0.25;
      const seg = this.segs.find((s) => s.lc && this.sCur >= s.s0 - 1 && this.sCur < s.s1);
      this.lcWait = null;
      if (seg) {
        const lc = seg.lc, e = seg.e, u = seg.u0 + (this.sCur - seg.s0), prog = (u - lc.u0) / lc.len;
        const tr = prog < 0.45 ? this.laneBlocker(e, lc.to, u, v) : null;
        if (tr) {
          this.lcWait = tr;
          const uEnd = seg.k === this.segs.length - 1 ? e.len : e.len - e.sb;
          const room = uEnd - 5 - u, behind = this.city.edgeLocal(e, tr.x, tr.z).u < u - 1.5;
          let err;
          if (!lc.forced && lc.from !== lc.to) err = this.plan(car, this.dest, { keepEvents: true, laneHint: new Map([[e.id, lc.from]]) });
          else if (room > lc.len + 12 || (behind && tr.v <= v + 0.5)) {
            // put the change off a little; a car behind that isn't gaining is left behind (we keep our
            // speed and move over once the gap is there)
            err = this.plan(car, this.dest, { keepEvents: true, laneHint: new Map([[e.id, lc.to]]), lcMinU: new Map([[e.id, Math.min(u + 8, uEnd - 8)]]) });
          } else {
            // no room to wait it out at speed: drop back behind it (the change is re-timed behind us)
            err = this.plan(car, this.dest, { keepEvents: true, laneHint: new Map([[e.id, lc.to]]), lcMinU: new Map([[e.id, u + 4]]) });
            this.lcHold = { until: this.vision.t + 0.6, v: Math.max(1.5, tr.v - 2.5) };
          }
          if (!err) this.updateProgress(car);
          this.lcCheckT = 0.5;
        }
      }
    }
    if (this.lcHold) { if (this.vision.t < this.lcHold.until) vLc = this.lcHold.v; else this.lcHold = null; }
    const p = this.path;
    const gearHere = p.g[Math.min(p.n - 1, this.idx + 1)];
    const rev = gearHere === 'R';
    const out = { accel: 0, steer: car.steer, gear: null, signal: null, done: false, takeover: false };
    // ---- target speed
    let vT = Math.min(p.v[this.idx], vLc);
    const look = Math.max(35, (v * v) / (2 * 1.6) + 20);
    for (let j = this.idx; j < p.n && p.s[j] - this.sCur < look; j += 2) {
      vT = Math.min(vT, Math.sqrt(p.v[j] * p.v[j] + 2 * 1.6 * Math.max(0, p.s[j] - this.sCur)));
    }
    let stopEv = null, stopD = Infinity;
    for (const ev of this.events) {
      if (ev.done) continue;
      const d = ev.s - ev.off - this.sCur;
      if (d > look + 40) break;
      if (this.mustStop(ev, car, tracks, d, simT)) {
        if (d < stopD) { stopD = d; stopEv = ev; }
      } else if (ev.type !== 'gear' && ev.type !== 'end') {
        if (d < -0.5) ev.done = true;
      }
    }
    let aStop = Infinity;
    if (stopEv) {
      const d = Math.max(0, stopD);
      vT = Math.min(vT, Math.sqrt(2 * 2.0 * d));
      // kinematic braking to land exactly on the stop point
      const aReq = (v * v) / (2 * Math.max(0.15, d));
      // (only once the braking needed is noticeable: short manoeuvres must still get up to speed)
      if ((aReq > 1.1 || (d < 8 && aReq > 0.3)) && v > 0.1) aStop = -aReq * 1.08;
      if (d < 0.25) vT = 0;
      if (stopEv.vcap) vT = Math.min(vT, stopEv.vcap);
      this.status = { light: 'Stopping for traffic light', yield: 'Yielding to oncoming traffic', stop: 'Stopping for stop sign', creep: 'Creeping forward to see', exit: 'Waiting to pull out', stopwait: 'Waiting for right of way', gap: 'Waiting for a gap in traffic', gear: 'Pulling forward to reverse', end: rev ? 'Reversing into stall' : this.dest ? `Arriving at ${this.dest.name}` : 'Stopping' }[stopEv.reason || stopEv.type] || '';
    }
    if (!stopEv || (stopD > 45 && !rev)) {
      if (this.dest) this.status = rev ? 'Reversing into stall' : this.idx > p.n - 90 ? `Parking at ${this.dest.name}` : `Navigating to ${this.dest.name}`;
      else this.status = 'Following road';
    }
    // ---- crossing traffic: yield short of where another car is going to be
    let aConf = Infinity;
    if (!rev) {
      const dc = this.conflictAhead(car, tracks, v);
      if (dc < Infinity) {
        const d = Math.max(0, dc - FRONT_OFF - 2.2);
        vT = Math.min(vT, Math.sqrt(2 * prof.brake * d));
        const aReq = (v * v) / (2 * Math.max(0.3, d));
        if (v > 0.2) aConf = d < 0.5 ? -7 : -Math.min(8, aReq * 1.1);
        if (dc - FRONT_OFF < 12) this.status = 'Yielding to crossing traffic';
      }
    }
    // ---- lead vehicle (forward only)
    let aLead = Infinity;
    this.lead = null;
    if (!rev) {
      let gap = Infinity, vl = 0, leadTr = null;
      for (const tr of tracks) {
        if (tr.conf < 0.3 || Math.abs((tr.y || 0) - car.y) > 3) continue;
        const dx = tr.x - car.x, dz = tr.z - car.z;
        if (dx * dx + dz * dz > (look + 15) ** 2) continue;
        let bd = 1e9, bj = -1;
        for (let j = this.idx; j < p.n && p.s[j] - this.sCur < look + 10; j += 2) {
          const d = (p.x[j] - tr.x) ** 2 + (p.z[j] - tr.z) ** 2;
          if (d < bd) { bd = d; bj = j; }
        }
        if (bj < 0 || Math.sqrt(bd) > 1.5 + tr.W * 0.3) continue;
        // its extent along our path: half its length if it's ahead of us, half its width if it's crossing
        const ch = Math.abs(Math.cos(tr.h - p.heading(bj)));
        const g = p.s[bj] - this.sCur - FRONT_OFF - (ch * tr.L + (1 - ch) * tr.W) / 2;
        if (g < -2) continue;
        if (g < gap) { gap = g; vl = tr.v * Math.max(0, Math.cos(tr.h - p.heading(bj))); leadTr = tr; }
      }
      if (leadTr) {
        this.lead = leadTr; this.leadGap = gap;
        const ss = 3.0 + Math.max(0, v * prof.gap + (v * (v - vl)) / (2 * Math.sqrt(prof.a * prof.brake)));
        aLead = prof.a * (1 - (ss / Math.max(0.2, gap)) ** 2);
        // IDM brakes far harder than needed for a slow car well ahead: cap it near the braking that
        // actually closes the speed difference before the minimum gap
        if (v > vl && gap > 6) aLead = Math.max(aLead, -Math.max(prof.brake, (1.4 * (v - vl) ** 2) / (2 * (gap - 4))));
        if (gap < 0.6 && v > 2.5) out.takeover = true;
      }
    }
    // ---- people on foot on our path (forwards or reversing): stop a good metre and a half short
    this.pedStop = false;
    for (const pd of this.peds || []) {
      for (let j = this.idx; j < p.n && p.s[j] - this.sCur < 22; j++) {
        if (p.g[j] !== gearHere) break;
        if ((p.x[j] - pd.x) ** 2 + (p.z[j] - pd.z) ** 2 > 1.75 * 1.75) continue;
        const d = Math.max(0, p.s[j] - this.sCur - (rev ? REAR_OFF : FRONT_OFF) - 1.5);
        vT = Math.min(vT, Math.sqrt(2 * 1.4 * d));
        if (v > 0.1) aLead = Math.min(aLead, -(v * v) / (2 * Math.max(0.25, d)) * 1.1);
        if (d < 0.25) vT = 0;
        this.pedStop = true;
        break;
      }
    }
    // ---- gear handling
    if ((gearHere === 'R' && car.gear !== 'R') || (gearHere === 'D' && car.gear !== 'D')) {
      out.accel = -4;
      if (v < 0.05) {
        this.gearWait += dt;
        if (this.gearWait > 0.6) {
          out.gear = gearHere; this.gearWait = 0;
          for (const ev of this.events) if (!ev.done && ev.type === 'gear' && ev.s - this.sCur < 1.0) this.finishGear(ev);
        }
      }
      out.steer = this.lastSteer;
      return out;
    }
    // ---- accel
    let a = clamp((vT - v) * 1.4, -prof.brake * 1.1, prof.a);
    a = Math.min(a, aLead, aStop, aConf);
    if (vT < 0.05 && v < 0.3) a = -3;
    out.accel = clamp(a, -8, prof.a);
    // gear event reached: stop then switch
    if (stopEv && stopEv.type === 'gear' && stopD < 0.35 && v < 0.05) this.finishGear(stopEv);
    if (stopEv && stopEv.type === 'end' && stopD < 0.4 && v < 0.05) { out.done = true; }
    const last = this.events[this.events.length - 1];
    if (last && last.cruise && last.s - this.sCur < 90) {
      // extend only mid-block so stop-sign/light state isn't reset at an intersection
      const loc = this.city.locate(car.x, car.z, car.h);
      if (loc && loc.u > 15 && loc.u < loc.e.len - 30) out.replan = true;
    }
    // ---- tactical decisions (about once a second): pick the shorter queue, Mad Max passes slow cars
    this.decideT -= dt;
    if (this.decideT <= 0 && !rev && this.dest !== undefined) {
      this.decideT = 1.0;
      const hint = this.tactical(car, v);
      if (hint) out.replanHint = hint;
    }
    // ---- steering (pure pursuit on the rear axle)
    // parking-lot manoeuvres (planned at lot speed) track tighter so tight turns don't cut the corner
    const Ld = rev ? 2.4 : p.v[this.idx] <= LOT_V + 0.01 ? clamp(1.8 + 0.6 * v, 2.6, 6) : clamp(3.2 + 0.5 * v, 4, 16);
    const lim = this.nextLimitS();
    let tx, tz;
    if (this.sCur + Ld <= lim) [tx, tz] = p.pointAt(this.sCur + Ld);
    else {
      // extend past the end of the current gear segment along its final direction
      const [ex, ez] = p.pointAt(lim), [bx, bz] = p.pointAt(lim - 1.5);
      const l = Math.hypot(ex - bx, ez - bz) || 1, extra = this.sCur + Ld - lim;
      tx = ex + ((ex - bx) / l) * extra; tz = ez + ((ez - bz) / l) * extra;
    }
    const dx = tx - car.x, dz = tz - car.z;
    const fx = Math.cos(car.h), fz = Math.sin(car.h);
    let steer;
    if (!rev) {
      const alpha = Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz);
      steer = Math.atan((2 * WHEELBASE * Math.sin(alpha)) / Math.hypot(dx, dz));
    } else {
      const alpha = Math.atan2(-fx * dz + fz * dx, -fx * dx - fz * dz);
      steer = -Math.atan((2 * WHEELBASE * Math.sin(alpha)) / Math.hypot(dx, dz));
    }
    steer = clamp(steer, -0.6, 0.6);
    const rate = v < 3 ? 1.6 : 0.9;
    this.lastSteer += clamp(steer - this.lastSteer, -rate * dt, rate * dt);
    out.steer = this.lastSteer;
    // ---- turn signals
    for (const sg of this.signals) if (this.sCur > sg.s0 && this.sCur < sg.s1) { out.signal = sg.dir; break; }
    if (this.offPath > 6) out.replanOff = true;
    return out;
  }

  // Lane decisions on a two-lane street while still mid-block: move to the lane with the shorter queue
  // for our turn, or (Mad Max) pull out round a slower car. Returns a lane hint map for replanning.
  tactical(car, v) {
    const seg = this.segs.find((s) => this.sCur >= s.s0 && this.sCur < s.s1);
    if (!seg) return null;
    const e = seg.e, city = this.city;
    if (e.lanes < 2 || e.curve) return null;
    const loc = city.edgeLocal(e, car.x, car.z);
    // the street carries on through bends: measure the room to the next real junction
    let toLine = e.len - e.sb - loc.u;
    for (let i = this.segs.indexOf(seg) + 1, prev = e; i < this.segs.length && city.nodes[prev.b].bend; i++) { toLine += this.segs[i].e.len; prev = this.segs[i].e; }
    if (toLine < 35 || loc.u < e.sa + 3) return null;
    if (this.events.some((ev) => !ev.done && ev.type !== 'turn' && ev.s - this.sCur < 30 && ev.s - this.sCur > -5)) return null;
    const cur = this.laneOfW(e, loc.w, loc.u);
    if (seg.lane !== cur) return null; // a lane change is already under way
    // the lanes next to ours that can make our turn
    const all = [...Array(e.lanes).keys()];
    const allowed = (seg.move ? all.filter((l) => city.laneMoves[e.id][l].includes(seg.move)) : all).filter((l) => Math.abs(l - cur) <= 1);
    if (allowed.length < 2) return null;
    let want = null;
    if (toLine < 160) { const b = this.bestLane(e, allowed, cur, loc.u); if (b !== cur) want = b; }
    // passing (on the left for choice) needs room to change lanes calmly (~3.5 s) before the next junction
    if (this.prof.overtake && this.lead && this.leadGap < 45 && this.lead.v < this.setSpeed(e) - 3 && toLine > Math.max(60, v * 4.2 + 30)) want = allowed.includes(cur - 1) ? cur - 1 : allowed.includes(cur + 1) ? cur + 1 : null;
    if (want === null || !this.laneFree(e, want, loc.u, v)) return null;
    // no weaving: at least 6 s between lane changes
    if (this.vision.t - (this.lcT ?? -99) < 6) return null;
    this.lcT = this.vision.t;
    return new Map([[e.id, want]]);
  }

  // points of the planned path from the front of the car forward over `len` metres
  ahead(len) {
    const p = this.path; if (!p) return [];
    const out = [], lim = this.nextLimitS();
    const rev = p.g[Math.min(p.n - 1, this.idx + 1)] === 'R';
    const start = Math.min(lim, this.sCur + (rev ? 0 : 2.2)), end = Math.min(lim, start + len);
    for (let s = start; s <= end; s += 0.8) out.push(p.pointAt(s));
    out.push(p.pointAt(end));
    return out;
  }
}
