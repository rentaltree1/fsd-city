// Parking-lot driving shared by Smart Summon and Self-Driving: everything is planned in the lot's own
// street frame (u along the street, w away from it). Cars only use the aisles (never cut across stalls):
// the aisle network is a small graph, stalls are entered and left with a single arc.
import { clamp, CENTER_OFF, FRONT_OFF, REAR_OFF, CAR_WID, WHEELBASE } from './config.js';

// the player's car: these follow whichever vehicle is selected (live bindings in config.js)
const turnR = () => 4.5 * Math.max(1, WHEELBASE / 2.89); // comfortable lot turning radius

// nearest point on the aisle network to (u, w): which link, how far along it, and how far away
export function projectAisle(lot, u, w, links = lot.aisles.links) {
  const N = lot.aisles.nodes;
  let best = null;
  for (const [i, j] of links) {
    const [au, aw] = N[i], [bu, bw] = N[j], du = bu - au, dw = bw - aw, l2 = du * du + dw * dw;
    const t = clamp(((u - au) * du + (w - aw) * dw) / l2, 0, 1), pu = au + du * t, pw = aw + dw * t, d = Math.hypot(u - pu, w - pw);
    if (!best || d < best.d) best = { i, j, t, u: pu, w: pw, d };
  }
  return best;
}
// projection of a node of the network
export function nodePoint(lot, k) {
  const [u, w] = lot.aisles.nodes[k];
  const link = lot.aisles.links.find(([i, j]) => i === k || j === k);
  return { i: link[0], j: link[1], t: link[0] === k ? 0 : 1, u, w, d: 0 };
}

// Shortest route along the aisles from A to B (projections). startDir / endDir (local unit vectors)
// force the direction we leave A in and arrive at B in. Returns a polyline [[u, w], ...] or null.
export function aisleRoute(lot, A, B, startDir = null, endDir = null) {
  const N = lot.aisles.nodes.map((p) => p.slice()), n = N.length;
  N.push([A.u, A.w], [B.u, B.w]);
  const adj = N.map(() => []);
  const add = (a, b) => { const d = Math.hypot(N[a][0] - N[b][0], N[a][1] - N[b][1]); adj[a].push([b, d]); adj[b].push([a, d]); };
  for (const [i, j] of lot.aisles.links) {
    const onA = A.i === i && A.j === j, onB = B.i === i && B.j === j;
    if (!onA && !onB) { add(i, j); continue; }
    const pts = [[0, i], [1, j]];
    if (onA) pts.push([A.t, n]);
    if (onB) pts.push([B.t + (onA && B.t === A.t ? 1e-6 : 0), n + 1]);
    pts.sort((p, q) => p[0] - q[0]);
    for (let k = 0; k < pts.length - 1; k++) add(pts[k][1], pts[k + 1][1]);
  }
  const dirOk = (a, b, dir) => !dir || (N[b][0] - N[a][0]) * dir[0] + (N[b][1] - N[a][1]) * dir[1] > 1e-3;
  const dist = N.map(() => Infinity), prev = N.map(() => -1), done = N.map(() => false);
  dist[n] = 0;
  for (;;) {
    let k = -1;
    for (let q = 0; q < N.length; q++) if (!done[q] && dist[q] < Infinity && (k < 0 || dist[q] < dist[k])) k = q;
    if (k < 0 || k === n + 1) break;
    done[k] = true;
    for (const [b, d] of adj[k]) {
      if (k === n && !dirOk(n, b, startDir)) continue;
      if (b === n + 1 && !dirOk(k, n + 1, endDir)) continue;
      if (dist[k] + d < dist[b]) { dist[b] = dist[k] + d; prev[b] = k; }
    }
  }
  if (!isFinite(dist[n + 1])) return null;
  const out = [];
  for (let k = n + 1; k !== -1; k = prev[k]) out.unshift(N[k]);
  return out.filter((p, i) => i === 0 || Math.hypot(p[0] - out[i - 1][0], p[1] - out[i - 1][1]) > 0.05);
}
export const polyLen = (P) => { let L = 0; for (let i = 1; i < P.length; i++) L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return L; };

// round every corner with an arc of up to radius R, sampled every ~0.5 m; marks turn points with the
// turn's side (+1 right, -1 left) for the indicators
export function fillet(P, R = 4.2) {
  if (P.length < 2) return P.map((p) => [p[0], p[1], 0]);
  const out = [[P[0][0], P[0][1], 0]];
  const line = (a, b) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 0.5)); for (let i = 1; i <= n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, 0]); };
  let cur = P[0];
  for (let i = 1; i < P.length - 1; i++) {
    const a = P[i - 1], p = P[i], b = P[i + 1];
    const l1 = Math.hypot(p[0] - a[0], p[1] - a[1]), l2 = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const d1 = [(p[0] - a[0]) / l1, (p[1] - a[1]) / l1], d2 = [(b[0] - p[0]) / l2, (b[1] - p[1]) / l2];
    const th = Math.acos(clamp(d1[0] * d2[0] + d1[1] * d2[1], -1, 1));
    if (th < 0.05) continue;
    const t = Math.min(R * Math.tan(th / 2), l1 * (i === 1 ? 0.95 : 0.5), l2 * (i === P.length - 2 ? 0.95 : 0.5));
    const s = [p[0] - d1[0] * t, p[1] - d1[1] * t], e = [p[0] + d2[0] * t, p[1] + d2[1] * t];
    line(cur, s);
    // in (u, w) a right turn rotates u toward w: cross(d1, d2) > 0
    const side = d1[0] * d2[1] - d1[1] * d2[0] > 0 ? 1 : -1;
    const n = Math.max(3, Math.ceil((th * t) / 0.4));
    for (let k = 1; k <= n; k++) { const q = k / n, A = (1 - q) * (1 - q), B = 2 * q * (1 - q), C = q * q; out.push([A * s[0] + B * p[0] + C * e[0], A * s[1] + B * p[1] + C * e[1], side]); }
    cur = e;
  }
  line(cur, P[P.length - 1]);
  return out;
}
// cut a sampled polyline at distance s from its start
export function cutAt(P, s) {
  if (s <= 0) return [P[0]];
  const out = [P[0]];
  let acc = 0;
  for (let i = 1; i < P.length; i++) {
    const d = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    if (acc + d >= s) { const t = (s - acc) / d; out.push([P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t, P[i][2]]); return out; }
    acc += d; out.push(P[i]);
  }
  return out;
}

// Does the car's footprint stay clear of the parked cars while it follows these rear-axle samples?
// samples: [u, w, fu, fw] (position and forward direction, lot frame). Parked cars sit centred in their
// stalls, so each occupied stall is an axis-aligned box in this frame.
export function sweepClear(lot, samples, self) {
  const obs = [];
  const [u0, w0] = samples[0];
  for (const s of lot.stalls) {
    if (!s.occupied || s === self || Math.abs(s.u - u0) > 16) continue;
    const cw = s.wm + s.n * 2.75;
    if (Math.abs(cw - w0) > 16) continue;
    // the parked car's real size (pickups overhang the stall), plus room for tracking error
    obs.push([s.u, cw, (s.carW || 1.95) / 2 + 0.15, (s.carL || 4.85) / 2 + 0.15]);
  }
  if (!obs.length) return true;
  for (const [u, w, fu, fw] of samples) {
    const ru = -fw, rw = fu; // car's right-hand side in (u, w)
    const corners = [];
    const hw = CAR_WID / 2 + 0.02;
    for (const a of [-REAR_OFF, CENTER_OFF, FRONT_OFF]) for (const b of [-hw, hw]) corners.push([u + fu * a + ru * b, w + fw * a + rw * b]);
    for (const [ou, ow, hu, hw] of obs) {
      for (const [cu, cw] of corners) if (Math.abs(cu - ou) < hu && Math.abs(cw - ow) < hw) return false;
      for (const du of [-hu, hu]) for (const dw of [-hw, hw]) {
        const px = ou + du - u, pz = ow + dw - w, al = px * fu + pz * fw, lt = px * ru + pz * rw;
        if (al > -REAR_OFF && al < FRONT_OFF && Math.abs(lt) < CAR_WID / 2 + 0.02) return false;
      }
    }
  }
  return true;
}

// Leave a stall: nose-in cars back out, nose-out (backed-in) cars drive out, either way with one arc onto
// the aisle facing direction a (+1/-1 along u). If the swing would clip a neighbour, go straight further
// first. Returns rear-axle points [u, w, gear] or null if there's no clear way out this direction.
export function stallExit(lot, st, cu, cw, noseIn, a) {
  const n = st.n, R = turnR(), depth = (cw - st.aw) * n, g = noseIn ? 'R' : 'D';
  const Rr = Math.min(R, Math.max(2.5, depth));
  for (let extra = 0; extra <= 2.01; extra += 0.25) {
    const s1 = Math.max(0, depth - Rr) + extra, w1 = cw - n * s1;
    const pts = [[cu, cw, g]], smp = [];
    const fwd = noseIn ? n : -n; // the car's nose points along +w*fwd while in the stall
    const ns = Math.max(1, Math.ceil(s1 / 0.4));
    for (let k = 1; k <= ns; k++) { pts.push([cu, cw - (n * s1 * k) / ns, g]); smp.push([cu, cw - (n * s1 * k) / ns, 0, fwd]); }
    // reverse swings the tail toward -a (ending up facing +a); forward swings the nose toward +a
    const sgn = noseIn ? -1 : 1, cxu = cu + sgn * a * Rr;
    for (let k = 1; k <= 16; k++) {
      const f = (k / 16) * (Math.PI / 2);
      const pu = cxu - sgn * a * Rr * Math.cos(f), pw = w1 - n * Rr * Math.sin(f);
      pts.push([pu, pw, g]);
      // heading blends from the stall axis to the aisle (+a)
      smp.push([pu, pw, a * Math.sin(f), fwd * Math.cos(f)]);
    }
    if (sweepClear(lot, smp, st)) return { pts, end: [cxu, w1 - n * Rr], len: s1 + (Rr * Math.PI) / 2 };
  }
  if (noseIn) return stallBackOut(lot, st, cu, cw, a);
  return null;
}
// Tight neighbours: back out on a wide arc to ~50°, stop, then pull forward on a tight arc to line up with
// the aisle. Sized so the forward arc ends on the aisle centre.
function stallBackOut(lot, st, cu, cw, a) {
  const n = st.n, Rf = turnR(), depth = (cw - st.aw) * n, s1 = 0.3;
  for (const Rb of [6, 7, 8, 9, 10.5]) {
    const s = (depth - s1 + Rf) / (Rb + Rf);
    if (s > 0.97 || s < 0.3) continue;
    const th = Math.asin(s), pts = [[cu, cw, 'R']], smp = [];
    pts.push([cu, cw - n * s1, 'R']); smp.push([cu, cw - n * s1, 0, n]);
    // reverse: heading turns from the stall axis (n) toward +a by th, the tail swinging toward -a
    const u1 = cu, w1 = cw - n * s1;
    for (let k = 1; k <= 16; k++) {
      const f = (k / 16) * th;
      const pu = u1 - a * Rb * (1 - Math.cos(f)), pw = w1 - n * Rb * Math.sin(f);
      pts.push([pu, pw, 'R']); smp.push([pu, pw, a * Math.sin(f), n * Math.cos(f)]);
    }
    // forward: keep turning toward +a until square with the aisle
    const u2 = u1 - a * Rb * (1 - Math.cos(th)), w2 = w1 - n * Rb * Math.sin(th);
    for (let k = 1; k <= 14; k++) {
      const f = th + (k / 14) * (Math.PI / 2 - th);
      const pu = u2 + a * Rf * (Math.cos(th) - Math.cos(f)), pw = w2 + n * Rf * (Math.sin(f) - Math.sin(th));
      pts.push([pu, pw, 'D']); smp.push([pu, pw, a * Math.sin(f), n * Math.cos(f)]);
    }
    if (!sweepClear(lot, smp, st)) continue;
    const e = pts[pts.length - 1];
    return { pts, end: [e[0], e[1]], len: s1 + Rb * th + Rf * (Math.PI / 2 - th) + 4 };
  }
  return null;
}
// Enter a stall nose-first, travelling along +a down an aisle line `off` metres from the aisle centre
// (swinging wide when the neighbours are tight). The arc starts at `start`; pts end centred in the stall.
export function stallEntry(lot, st, a) {
  const n = st.n, R = turnR();
  const wEnd = st.wm + n * (2.75 - CENTER_OFF); // rear axle with the car centred in the stall
  // swing wide enough to finish with ~2.6 m straight in (so the car ends square in the stall), but no
  // closer than ~0.3 m to the stalls across the aisle
  const halfAisle = Math.abs(st.wm - st.aw), want = (st.aw - wEnd) * n + R + 2.6;
  const offs = [want, want - 0.5, want - 1, want - 1.6].map((o) => clamp(o, 0, halfAisle - 1.25));
  for (const off of [...new Set(offs)]) {
    const u0 = st.u - a * R, w0 = st.aw - n * off;
    const pts = [], smp = [];
    for (let k = 1; k <= 16; k++) {
      const f = (k / 16) * (Math.PI / 2);
      pts.push([u0 + a * R * Math.sin(f), w0 + n * R * (1 - Math.cos(f))]);
      smp.push([pts[k - 1][0], pts[k - 1][1], a * Math.cos(f), n * Math.sin(f)]);
    }
    const sEnd = (wEnd - (w0 + n * R)) * n;
    if (sEnd < -0.2) continue;
    const ns = Math.max(1, Math.ceil(sEnd / 0.4));
    for (let k = 1; k <= ns; k++) pts.push([st.u, w0 + n * R + (n * sEnd * k) / ns]);
    if (sweepClear(lot, smp, st)) return { start: [u0, w0], off, pts };
  }
  return null;
}

// the stall a car (centre at u, w) is standing in, if any
export function stallAt(lot, u, w) {
  for (const s of lot.stalls) { const d = (w - s.wm) * s.n; if (Math.abs(u - s.u) < 1.3 && d > 0.5 && d < 5.4) return s; }
  return null;
}
// is this local point inside the lot's paved area?
export const inLot = (lot, u, w, m = 0) => u > lot.bounds[0] - m && u < lot.bounds[1] + m && w > lot.bounds[2] - 2.5 - m && w < lot.bounds[3] + m;
