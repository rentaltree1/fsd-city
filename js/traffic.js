// Traffic AI: cars follow lane centrelines, obey the painted lane arrows, traffic lights (with
// permissive-left yielding), all-way stops (first-come first-served), two-way stops (wait for a gap in
// the through traffic), turn round in cul-de-sacs, and keep distance with IDM.
import { clamp, rng, yawFromHeading } from './config.js';
import { makeNPCCar, pickType, COLORS, npcMats } from './npc.js';
import { turnPoints, uturnPoints } from './fsd.js';

const TURN_V = { R: 4.6, L: 6.2, r: 8, l: 8, U: 3.2 };
const isLeft = (m) => m === 'L' || m === 'l';
const HZ = 16, TDT = 0.25; // conflict look-ahead: 16 steps of 0.25 s
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const PLAYER = { id: 'player' }; // the player's place in an all-way stop's queue

export class Traffic {
  constructor(scene, city, count = 48) {
    this.scene = scene; this.city = city; this.rand = rng(4242);
    this.cars = []; this.parked = []; this.feedCache = new Map(); this.pNode = null;
    for (let i = 0; i < count; i++) {
      const m = makeNPCCar(pickType(this.rand()), COLORS[Math.floor(this.rand() * COLORS.length)], { animated: true });
      scene.add(m.group);
      this.cars.push({ id: 'ai' + String(i).padStart(2, '0'), m, L: m.L, W: m.W, H: m.H, wb: m.wb || m.L * 0.6, type: m.type, x: 0, z: 0, h: 0, v: 0, steer: 0, active: false });
    }
  }

  addParked(stall, lot) {
    const r = this.rand;
    // (box trucks and delivery vans don't fit a parking stall)
    let type = pickType(r());
    while (type === 'truck' || type === 'cargo') type = pickType(r());
    const m = makeNPCCar(type, COLORS[Math.floor(r() * COLORS.length)]);
    // store stalls know their own centre; most drivers pull in nose first
    const c = stall.cx !== undefined ? { x: stall.cx, z: stall.cz } : lot.lp(stall.u, 27.0);
    const h = stall.hIn !== undefined ? (r() < 0.75 ? stall.hIn : stall.hIn + Math.PI) : r() < 0.6 ? stall.h : stall.h + Math.PI;
    m.group.position.set(c.x, 0.15, c.z);
    m.group.rotation.y = yawFromHeading(h);
    this.scene.add(m.group);
    const p = { id: 'pk' + this.parked.length, m, L: m.L, W: m.W, H: m.H, type: m.type, x: c.x, z: c.z, h, v: 0, parked: true, stall };
    this.parked.push(p);
    stall.occupied = true; stall.carL = m.L; stall.carW = m.W;
    return p;
  }

  laneSeg(c) {
    const e = c.edge;
    c.lane = Math.min(c.lane, e.lanes - 1);
    const off = e.laneOff[c.lane];
    if (e.curve) {
      c.pts = [];
      const span = e.len - e.sa - e.sb, n = Math.max(2, Math.ceil(span / 4));
      for (let i = 0; i <= n; i++) { const p = this.city.edgePoint(e, e.sa + (span * i) / n, off); c.pts.push([p.x, p.z]); }
    } else {
      const a = this.city.edgePoint(e, e.sa, off), b = this.city.edgePoint(e, e.len - e.sb, off);
      c.pts = [[a.x, a.z], [b.x, b.z]];
    }
    this.measure(c);
  }
  turnSeg(c) {
    const e = c.edge, n = c.next, l = c.lane, city = this.city;
    // through a bend in the road a car keeps its lane; at a junction it turns into the nearest lane
    const bend = city.nodes[e.b].bend || city.nodes[e.b].pass;
    const nl = bend ? Math.min(l, n.lanes - 1) : c.move === 'R' || c.move === 'r' ? n.lanes - 1 : isLeft(c.move) || c.move === 'U' ? 0 : Math.min(l, n.lanes - 1);
    c.nextLane = nl;
    c.turnExt = c.move === 'R' ? 7 : c.move === 'L' ? 3 : c.move === 'S' || c.move === 'U' ? 0 : 2;
    c.waitS = null;
    if (c.move === 'U') { c.pts = uturnPoints(city, e, e.laneOff[l], n.laneOff[nl]); this.measure(c); return; }
    const P = city.edgePoint(e, e.len - e.sb, e.laneOff[l]), Q = city.edgePoint(n, n.sa + c.turnExt, n.laneOff[nl]);
    // streets meet at all sorts of angles: even "straight through" bends gently across the junction
    if (c.move === 'S' && e.dx * n.sdx + e.dz * n.sdz > 0.998) { c.pts = [[P.x, P.z], [Q.x, Q.z]]; }
    else if (bend) {
      // a bend in the road: a smooth curve through the corner where the two lane lines meet
      const C = city.edgePoint(e, e.len, e.laneOff[l]), C2 = city.edgePoint(n, 0, n.laneOff[nl]), cx = (C.x + C2.x) / 2, cz = (C.z + C2.z) / 2;
      const k = Math.max(2, Math.ceil(Math.hypot(Q.x - P.x, Q.z - P.z) / 1.5));
      c.pts = [];
      for (let i = 0; i <= k; i++) { const t = i / k, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), d = t * t; c.pts.push([a * P.x + b * cx + d * Q.x, a * P.z + b * cz + d * Q.z]); }
    } else {
      c.pts = turnPoints(P, e.dx, e.dz, Q, n.sdx, n.sdz, e.laneOff[l], 12, Math.min(e.hw, n.hw), Math.min(e.kerb, n.kerb), c.move === 'L');
      if (c.move === 'L' && c.pts.lead > 2) c.waitS = c.pts.lead * 0.9 - 1.2;
    }
    this.measure(c);
  }
  // the turn the car will take at the end of its lane (cached)
  turnPreview(c) {
    const key = c.edge.id + ':' + c.move + ':' + c.lane;
    if (!c._tp || c._tp.key !== key) { const t = { edge: c.edge, next: c.next, lane: c.lane, move: c.move }; this.turnSeg(t); t.key = key; c._tp = t; }
    return c._tp;
  }
  measure(c) {
    c.cum = [0];
    for (let i = 1; i < c.pts.length; i++) c.cum.push(c.cum[i - 1] + Math.hypot(c.pts[i][0] - c.pts[i - 1][0], c.pts[i][1] - c.pts[i - 1][1]));
    c.len = c.cum[c.cum.length - 1];
  }
  posAt(c, s) {
    s = clamp(s, 0, c.len);
    let i = 1; while (i < c.cum.length - 1 && c.cum[i] < s) i++;
    const t = (s - c.cum[i - 1]) / Math.max(1e-6, c.cum[i] - c.cum[i - 1]);
    const a = c.pts[i - 1], b = c.pts[i];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(b[1] - a[1], b[0] - a[0])];
  }
  chooseMove(c) {
    const lm = this.city.laneMoves[c.edge.id][Math.min(c.lane, c.edge.lanes - 1)], mv = this.city.moveEdge[c.edge.id];
    const opts = [...lm].filter((k) => mv[k]);
    const w = { S: 0.6, R: 0.22, L: 0.18, r: 0.2, l: 0.16, U: 1 };
    let tot = 0; for (const o of opts) tot += w[o];
    let r = this.rand() * tot, pick = opts[0];
    for (const o of opts) { r -= w[o]; if (r <= 0) { pick = o; break; } }
    c.move = pick; c.next = mv[pick];
  }

  spawn(c, px, pz, minD, maxD) {
    const city = this.city;
    for (let tries = 0; tries < 40; tries++) {
      const e = city.edges[Math.floor(this.rand() * city.edges.length)];
      if (e.len - e.sa - e.sb < 12) continue;
      const mp = city.edgePoint(e, e.len / 2, 0), mx = mp.x, mz = mp.z;
      const d = Math.hypot(mx - px, mz - pz);
      if (d < minD || d > maxD) continue;
      // arterials carry most of the traffic
      if (e.lanes === 1 && this.rand() < 0.45) continue;
      c.edge = e; c.lane = this.rand() < 0.5 ? 0 : 1; c.mode = 'lane';
      this.laneSeg(c);
      c.s = 3 + this.rand() * (c.len - 6);
      const [x, z, h] = this.posAt(c, c.s);
      if (Math.hypot(x - px, z - pz) < minD) continue;
      if (this.cars.some((o) => o !== c && o.active && Math.hypot(o.x - x, o.z - z) < 14)) continue;
      c.x = x; c.z = z; c.h = h; c.steer = 0; c.hold = false; c.mutualT = 0; c.yieldPrev = null;
      c.vdes = e.limit * (0.88 + this.rand() * 0.22);
      c.v = c.vdes * 0.6;
      c.stopped = false; c.stopT = 0; c.node = null; c.permit = false;
      this.chooseMove(c);
      c.active = true; c.m.group.visible = true;
      return true;
    }
    c.active = false; c.m.group.visible = false;
    return false;
  }

  removeFromQueue(c) {
    if (c.queueNode) { const q = c.queueNode.queue, i = q.indexOf(c); if (i >= 0) q.splice(i, 1); c.queueNode = null; }
  }

  // is anyone crossing the junction? (cars waiting at their own stop lines don't count, even where a
  // wide junction puts them close to its centre)
  boxOccupied(n, self, player, pLoc) {
    const r = (n.r || 8) + 1.5;
    for (const o of this.cars) {
      if (o === self || !o.active) continue;
      if (o.mode === 'turn' ? o.edge.b === n.id : o.edge.a === n.id && o.s < o.L) return true;
    }
    const waiting = pLoc && pLoc.e.b === n.id && pLoc.u < pLoc.e.len - pLoc.e.sb;
    if (player && !waiting && Math.hypot(player.x - n.x, player.z - n.z) < r + 0.5) return true;
    return false;
  }

  // the lanes feeding an approach, back through bends (a car 20 m beyond a bend is still coming)
  feeders(e) {
    let f = this.feedCache.get(e.id);
    if (!f) { f = this.city.feeders(e, 140); this.feedCache.set(e.id, f); }
    return f;
  }
  // distance from car o (in lane mode, on one of the feeders of approach e) to e's stop line, or null
  approachDist(o, e) {
    if (o.mode !== 'lane') return null;
    for (const { e: q, off } of this.feeders(e)) if (o.edge === q) return off + (o.len - o.s);
    return null;
  }
  playerApproach(pLoc, e) {
    if (!pLoc) return null;
    for (const { e: q, off } of this.feeders(e)) if (pLoc.e === q) return off + (q.len - q.sb - pLoc.u);
    return null;
  }
  // what a driver at c can see: anything close, or further away with a clear line past the buildings
  canSee(c, x, z) {
    const dx = x - c.x, dz = z - c.z;
    return dx * dx + dz * dz < 25 * 25 || !this.city.segmentBlocked(c.x, c.z, x, z);
  }

  oncoming(opp, n, player, pLoc, self) {
    const red = (e) => e.ctl === 'light' && this.city.lightState(n, e.phase) === 'R';
    for (const o of this.cars) {
      if (!o.active || o === self) continue;
      if (o.mode === 'turn' && o.edge === opp && !isLeft(o.move)) return true;
      const d = this.approachDist(o, opp);
      if (d === null || d > 48) continue;
      if (o.edge === opp && (isLeft(o.move) || (red(opp) && !o.permit))) continue; // turning too, or held at a red
      if ((o.v > 1 || d < 10) && (!self || this.canSee(self, o.x, o.z))) return true;
    }
    if (player) {
      const d = this.playerApproach(pLoc, opp);
      if (d !== null && d < 50 && (player.v > 1 || d < 12) && !(red(opp) && player.v < 1)) return true;
      const rx = player.x - n.x, rz = player.z - n.z;
      const along = rx * opp.dx + rz * opp.dz, lat = rx * opp.rx + rz * opp.rz;
      const hd = Math.cos(player.h) * opp.dx + Math.sin(player.h) * opp.dz;
      if (hd > 0.7 && along < 6 && along > -12 && lat > -0.5 && lat < opp.hw + 0.5) return true;
    }
    return false;
  }
  // through traffic (on uncontrolled approaches) that would reach the junction within ~5.5 s and that
  // the waiting driver can see
  priorityComing(n, self, player, pLoc) {
    for (const pe of Object.values(n.in)) {
      if (pe.ctl !== 'none') continue;
      for (const o of this.cars) {
        if (o === self || !o.active) continue;
        const d = this.approachDist(o, pe);
        if (d === null) continue;
        if ((d < 14 || (o.v > 1 && d / o.v < 5.5)) && this.canSee(self, o.x, o.z)) return true;
      }
      if (player) {
        const d = this.playerApproach(pLoc, pe), v = Math.abs(player.v);
        if (d !== null && (d < 16 || (v > 1 && d / v < 6)) && this.canSee(self, player.x, player.z)) return true;
      }
    }
    return false;
  }
  // a car that pulled out of a stop street is in the junction: through traffic lets it clear
  crossTraffic(n, self) {
    for (const o of this.cars) if (o !== self && o.active && o.mode === 'turn' && o.edge.b === n.id && o.edge.ctl !== 'none' && Math.hypot(o.x - n.x, o.z - n.z) < (n.r || 8) + 4) return true;
    return false;
  }

  canProceed(c, player, pLoc) {
    const n = this.city.nodes[c.edge.b], ctl = c.edge.ctl;
    const dist = c.len - c.s - c.L / 2;
    if (n.pass || n.bend) return true;
    // round the end of a cul-de-sac one at a time (cars from both lanes would meet half way round)
    if (n.bulb) return !this.cars.some((o) => o !== c && o.active && o.mode === 'turn' && o.edge.b === n.id && o.s < o.len * 0.6);
    // an unprotected left with oncoming traffic: pull out into the junction and wait there ('hold')
    const left = (opp) => (c.move === 'L' && this.turnPreview(c).waitS ? 'hold' : false);
    if (ctl === 'none') {
      if (isLeft(c.move) && c.edge.opp && this.oncoming(c.edge.opp, n, player, pLoc, c)) return left(c.edge.opp);
      return !this.crossTraffic(n, c);
    }
    if (ctl === 'light') {
      const st = this.city.lightState(n, c.edge.phase);
      if (st === 'R') return false;
      if (st === 'Y' && dist > (c.v * c.v) / 6 + 1.5) return false;
      const opp = c.edge.opp;
      if (isLeft(c.move) && opp && this.oncoming(opp, n, player, pLoc, c)) return st === 'G' ? left(opp) : false;
      return true;
    }
    if (!c.stopped || c.stopT < 1.0) return false;
    if (ctl === 'stop4') { if (n.queue[0] !== c) return false; return !this.boxOccupied(n, c, player, pLoc); }
    return !this.boxOccupied(n, c, player, pLoc) && !this.priorityComing(n, c, player, pLoc);
  }

  update(dt, player) {
    const city = this.city;
    for (const c of this.cars) {
      if (!c.active || Math.hypot(c.x - player.x, c.z - player.z) > 470) {
        this.removeFromQueue(c);
        this.spawn(c, player.x, player.z, c.active ? 230 : 70, 430);
      }
    }
    const all = this.cars.filter((c) => c.active);
    // which street the player is on: on the approach to a junction only cars in the same lane count as
    // leaders (streets can converge at sharp angles; right of way at the junction handles the rest)
    const pLoc = city.locate(player.x, player.z, player.h);
    // ... and the car ahead just past the junction (or bend) in the lane we're heading for
    const sameLane = (c, o) => o.edge === c.edge || (o.mode === 'turn' && (o.next === c.edge || (o.edge.b === c.edge.b && c.len - c.s < 25) || (o.edge === c.next && c.len - c.s < 60))) ||
      (o.edge === c.next && o.mode === 'lane' && c.len - c.s < 60 && o.lane === this.turnPreview(c).nextLane);
    // the player stopped at an all-way stop takes their turn in the queue like everyone else
    {
      const e = pLoc && pLoc.e, ahead = e ? e.len - e.sb - pLoc.u - (player.L || 4.8) / 2 : 99;
      const waiting = e && e.ctl === 'stop4' && ahead < 3 && ahead > -1.5 && player.v < 0.5;
      const node = waiting ? city.nodes[e.b] : null;
      if (this.pNode && this.pNode !== node) { const q = this.pNode.queue, i = q.indexOf(PLAYER); if (i >= 0) q.splice(i, 1); this.pNode = null; }
      if (node && !node.queue.includes(PLAYER)) { node.queue.push(PLAYER); this.pNode = node; }
    }
    // everyone's next 4 s: cars cleared to go (or already in a junction) are assumed to carry on at
    // least at walking-pace-plus; the rest stop at their line (or at their waiting point when holding
    // for a left turn). The player follows their Self-Driving path, or goes straight on.
    const plans = new Map();
    for (const o of all) {
      const go = o.mode === 'turn' || o.permit;
      let cap = o.mode === 'lane' && !go ? Math.max(0, o.len - o.s - 0.4) : 1e9;
      if (o.mode === 'turn' && o.hold && o.waitS != null) cap = Math.max(0, o.waitS - o.s);
      if (o.mode === 'lane' && o.permit === 'hold') cap = o.len - o.s + Math.max(0, this.turnPreview(o).waitS ?? 0);
      plans.set(o, this.trajectory(o, go ? Math.max(o.v, Math.min(o.vdes, 4.5)) : o.v, cap));
    }
    const pPlan = [], P_L = player.L || 4.8, P_W = player.W || 1.95, route = player.route;
    for (let i = 0; i <= HZ; i++) {
      const d = player.v * i * TDT;
      if (route && route.length > 2 && player.v > 0.3) {
        let acc = 0, k = 1;
        for (; k < route.length; k++) { const l = Math.hypot(route[k][0] - route[k - 1][0], route[k][1] - route[k - 1][1]); if (acc + l >= d) break; acc += l; }
        k = Math.min(k, route.length - 1);
        const a = route[k - 1], b = route[k], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, t = clamp((d - acc) / l, 0, 1);
        pPlan.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(b[1] - a[1], b[0] - a[0]), d]);
      } else pPlan.push([player.x + Math.cos(player.h) * d, player.z + Math.sin(player.h) * d, player.h, d]);
    }
    for (const c of all) c.yieldNow = null;
    for (const c of all) {
      const fx = Math.cos(c.h), fz = Math.sin(c.h);
      let gap = 1e9, vl = 0;
      const consider = (o, L, W) => {
        const rx = o.x - c.x, rz = o.z - c.z;
        const lon = rx * fx + rz * fz;
        if (lon <= 0 || lon > 60) return;
        const lat = -rx * fz + rz * fx;
        if (Math.abs(lat) > (c.mode === 'turn' ? 2.2 : 1.55) + W * 0.15) return;
        const g = lon - c.L / 2 - L / 2;
        if (g < gap) { gap = g; vl = o.v * Math.max(0, Math.cos(o.h - c.h)); c.leadId = o.id; }
      };
      c.leadId = null;
      const inLane = c.mode === 'lane';
      // (out in a junction, the cars still queued on the approach we came from are behind us, however
      // the turn has swung us round)
      for (const o of all) if (o !== c && (inLane ? sameLane(c, o) : !(o.mode === 'lane' && o.edge === c.edge))) consider(o, o.L, o.W);
      const jn = city.nodes[c.edge.b], pInJunction = Math.hypot(player.x - jn.x, player.z - jn.z) < (jn.r || 8) + 2;
      if (!inLane || !pLoc || pLoc.e === c.edge || pInJunction) consider(player, P_L, P_W);
      let v0 = c.vdes;
      if (c.mode === 'turn') v0 = Math.min(v0, TURN_V[c.move] ?? v0);
      else if (c.move !== 'S') v0 = Math.min(v0, Math.sqrt((TURN_V[c.move] ?? 6.2) ** 2 + 3.6 * Math.max(0, c.len - c.s)));
      // stop line handling
      if (c.mode === 'lane') {
        const dist = c.len - c.s - c.L / 2;
        if (dist < 55) {
          // keep re-checking until inside stopping distance, then the car is committed
          if (!c.permit || dist > (c.v * c.v) / 6 + 2) c.permit = this.canProceed(c, player, pLoc);
          if (!c.permit) {
            const g = dist + 1.6; // IDM keeps s0 to a leader, so this parks the bumper ~0.8 m before the line
            if (g < gap) { gap = g; vl = 0; }
            const ctl = c.edge.ctl;
            if ((ctl === 'stop2' || ctl === 'stop4') && dist < 1.8 && c.v < 0.25) {
              if (!c.stopped) { c.stopped = true; c.stopT = 0; if (ctl === 'stop4') { jn.queue.push(c); c.queueNode = jn; } }
              c.stopT += dt;
            }
          }
        }
      } else if (c.hold) {
        // out in the junction waiting to turn left: go when the oncoming lane clears
        if (this.oncoming(c.edge.opp, jn, player, pLoc, c) && c.waitS != null) {
          const g = c.waitS - c.s + 1.6;
          if (g < gap) { gap = g; vl = 0; }
        } else c.hold = false;
      }
      // crossing paths: if we and another vehicle would occupy the same spot within 4 s, the one that
      // gets there second yields (a car already in the junction goes first; the player always has it)
      const mine = plans.get(c), reach = c.v * 4 + 14;
      const conflict = (oT, oL, oW, ob, oBox, isPlayer) => {
        const o0 = oT[0], rx = o0[0] - c.x, rz = o0[1] - c.z;
        if (Math.abs(rx) > reach + 40 || Math.abs(rz) > reach + 40) return;
        const lon = rx * fx + rz * fz, lat = -rx * fz + rz * fx, dh = Math.abs(wrap(o0[2] - c.h));
        if (dh < 0.7 && lon < 0 && Math.abs(lat) < 1.8) return; // following us in our lane
        if (dh < 0.6 && lon > 0 && Math.abs(lat) < 2.4) return;  // our leader: IDM keeps the distance
        // the player beside or behind us in the next lane, planning to move over: they merge in behind
        // us (only a car already ahead of our nose is let in)
        if (isPlayer && dh < 0.7 && lon < c.L / 2 + 1.5 && Math.abs(lat) > 1.8 && Math.abs(lat) < 5.6) return;
        for (let i = 1; i <= HZ; i++) {
          const m = mine[i], o = oT[i];
          if (!Traffic.overlap(m[0], m[1], m[2], c.L, c.W, o[0], o[1], o[2], oL, oW)) continue;
          // a driver only reacts to what they can see
          if (!this.canSee(c, o0[0], o0[1])) return;
          let jMe = i, kO = i;
          for (let j = 0; j < i; j++) if (Traffic.overlap(mine[j][0], mine[j][1], mine[j][2], c.L, c.W, o[0], o[1], o[2], oL, oW)) { jMe = j; break; }
          for (let k = 0; k < i; k++) if (Traffic.overlap(m[0], m[1], m[2], c.L, c.W, oT[k][0], oT[k][1], oT[k][2], oL, oW)) { kO = k; break; }
          let yieldIt;
          if (isPlayer) yieldIt = true;
          else if (kO === 0 && jMe > 0) yieldIt = true;      // it is already standing there
          else if (jMe === 0 && kO > 0) yieldIt = false;
          else if ((c.mode === 'turn') !== oBox) yieldIt = oBox;
          else yieldIt = kO < jMe || (kO === jMe && ob.id < c.id);
          // two cars waiting for each other: after a moment the one with the lower id goes first
          if (yieldIt && !isPlayer && ob.yieldPrev === c.id && (c.mutualT || 0) > 1.2 && c.id < ob.id) yieldIt = false;
          // it is queued behind us: waiting for it would wait forever
          if (yieldIt && !isPlayer && ob.leadId === c.id && ob.v < 0.5) yieldIt = false;
          if (yieldIt) { const g = mine[jMe][3] + 1.0; if (g < gap) { gap = g; vl = 0; c.yieldNow = isPlayer ? 'player' : ob.id; } }
          return;
        }
      };
      for (const o of all) if (o !== c) conflict(plans.get(o), o.L, o.W, o, o.mode === 'turn', false);
      conflict(pPlan, P_L, P_W, null, false, true);
      // last line of defence: never drive into the player's car (whatever the predictions said)
      {
        const rx = player.x - c.x, rz = player.z - c.z;
        if (rx * rx + rz * rz < 100) {
          const ahead = c.v * 0.6 + 1.2, nx = c.x + fx * ahead * 0.5, nz = c.z + fz * ahead * 0.5;
          if (Traffic.overlap(nx, nz, c.h, c.L + ahead, c.W, player.x, player.z, player.h, P_L, P_W)) {
            const g = Math.max(0, rx * fx + rz * fz - c.L / 2 - P_L / 2 - 0.3); if (g < gap) { gap = g; vl = 0; }
            // nose to nose with the player and neither can move: back off a few metres to make room
            if (c.v < 0.3 && player.v < 0.3) { c.standoffT = (c.standoffT || 0) + dt; if (c.standoffT > 3) { c.backoff = 2.5; c.standoffT = 0; } }
          } else c.standoffT = 0;
        }
      }
      // IDM
      const aMax = 1.7, b = 2.6, s0 = 2.4, T = 1.35;
      let a = aMax * (1 - Math.pow(Math.max(0, c.v) / Math.max(0.1, v0), 4));
      if (gap < 1e8) {
        const ss = s0 + Math.max(0, c.v * T + (c.v * (c.v - vl)) / (2 * Math.sqrt(aMax * b)));
        a -= aMax * (ss / Math.max(0.1, gap)) ** 2;
      }
      a = clamp(a, -8, aMax);
      c.v = Math.max(0, c.v + a * dt);
      if (c.backoff > 0) { c.backoff -= dt; c.v = -1.2; }
      c.braking = a < -0.6 || c.v < 0.3;
      // progress of the reference point along the lane / turn, kept level with the car
      {
        const [rx0, rz0, rh] = this.posAt(c, c.s);
        const al = (c.x - rx0) * Math.cos(rh) + (c.z - rz0) * Math.sin(rh);
        c.s += c.v * dt + clamp(al, -0.4, 0.4) * Math.min(1, dt * 5);
      }
      if (c.s >= c.len) {
        const over = c.s - c.len;
        if (c.mode === 'lane') {
          if (!c.permit) { c.s = c.len; c.v = 0; }
          else { this.removeFromQueue(c); c.stopped = false; c.hold = c.permit === 'hold'; c.permit = false; c.mode = 'turn'; this.turnSeg(c); c.s = over; }
        } else {
          c.edge = c.next; c.lane = c.nextLane ?? 0; c.mode = 'lane'; this.laneSeg(c); c.s = over + (c.turnExt || 0); c.permit = false; c.hold = false;
          this.chooseMove(c);
          c.vdes = c.edge.limit * (0.88 + this.rand() * 0.22);
        }
      }
      // steering: pure pursuit toward a point ahead on the planned line, through a kinematic bicycle
      // model (the same way the player's car moves), so turns and corrections are smooth
      {
        const Ld = clamp(2.4 + 0.55 * c.v, 3.4, 14);
        const [tx, tz] = this.ahead(c, Ld);
        const alpha = wrap(Math.atan2(tz - c.z, tx - c.x) - c.h);
        const wb = c.wb || c.L * 0.6;
        const want = c.v < 0 ? 0 : clamp(Math.atan2(2 * wb * Math.sin(alpha), Ld), -0.62, 0.62);
        c.steer = (c.steer || 0) + clamp(want - (c.steer || 0), -1.5 * dt, 1.5 * dt);
        const beta = Math.atan(0.5 * Math.tan(c.steer));
        c.x += c.v * Math.cos(c.h + beta) * dt; c.z += c.v * Math.sin(c.h + beta) * dt;
        c.h = wrap(c.h + ((c.v * Math.cos(beta) * Math.tan(c.steer)) / wb) * dt);
        // way off the line (shouldn't happen): put it back on
        const [rx1, rz1, rh1] = this.posAt(c, c.s);
        if ((c.x - rx1) ** 2 + (c.z - rz1) ** 2 > 16) { c.x = rx1; c.z = rz1; c.h = rh1; c.steer = 0; }
      }
      if (c.m.wheels) for (const w of c.m.wheels) {
        w.spin.rotation.x -= (c.v * dt) / (w.r || 0.34);
        if (w.front) w.pivot.rotation.y = -c.steer;
      }
      const x = c.x, z = c.z;
      let y = 0, pitch = 0;
      if (!city.inCity(x, z)) {
        const fx = Math.cos(c.h) * c.L * 0.4, fz = Math.sin(c.h) * c.L * 0.4;
        const hf = city.groundHeight(x + fx, z + fz), hr = city.groundHeight(x - fx, z - fz);
        y = (hf + hr) / 2; pitch = Math.atan2(hf - hr, c.L * 0.8);
      }
      c.y = y;
      c.m.group.position.set(x, y, z);
      c.m.group.rotation.order = 'YXZ';
      c.m.group.rotation.set(pitch, yawFromHeading(c.h), 0);
      c.m.tail.material = c.braking ? npcMats.brake : npcMats.tail;
    }
    // who's been waiting on whom (for breaking two-car standoffs)
    const byId = new Map(all.map((c) => [c.id, c]));
    for (const c of all) {
      const o = c.yieldNow && byId.get(c.yieldNow);
      c.mutualT = o && o.yieldNow === c.id && c.v < 0.6 ? (c.mutualT || 0) + dt : 0;
      c.yieldPrev = c.yieldNow;
    }
  }

  // ---- predictive conflict check: where will each car be over the next few seconds?
  // a point d metres further along c's route (current segment, then the turn it has chosen, then straight on)
  ahead(c, d) {
    const s = c.s + d;
    if (s <= c.len) return this.posAt(c, s);
    let rem = s - c.len, seg = c;
    if (c.mode === 'lane' && c.next) {
      seg = this.turnPreview(c);
      if (rem <= seg.len) return this.posAt(seg, rem);
      rem -= seg.len;
    }
    // past the end of the turn: carry on down the lane of the street it leads into (the last few points
    // of a short bend are too close together to give a usable direction)
    if (seg.next) {
      const e = seg.next, l = e.laneOff[Math.min(seg.nextLane ?? 0, e.lanes - 1)], u = e.sa + (seg.turnExt || 0) + rem;
      const p = this.city.edgePoint(e, u, l), q = this.city.edgePoint(e, u + 0.5, l);
      return [p.x, p.z, Math.atan2(q.z - p.z, q.x - p.x)];
    }
    const n = seg.pts.length, a = seg.pts[n - 2], b = seg.pts[n - 1], h = Math.atan2(b[1] - a[1], b[0] - a[0]);
    return [b[0] + Math.cos(h) * rem, b[1] + Math.sin(h) * rem, h];
  }
  trajectory(c, v, cap) {
    const out = [];
    for (let i = 0; i <= HZ; i++) { const d = Math.max(0, Math.min(v * i * TDT, cap)); const p = this.ahead(c, d); p.push(d); out.push(p); }
    return out;
  }
  // do two footprints (centres, headings, sizes) overlap, with a safety margin?
  static overlap(ax, az, ah, aL, aW, bx, bz, bh, bL, bW) {
    const dx = bx - ax, dz = bz - az, c = Math.cos(ah), s = Math.sin(ah);
    const lon = dx * c + dz * s, lat = -dx * s + dz * c, rc = Math.abs(Math.cos(bh - ah)), rs = Math.abs(Math.sin(bh - ah));
    return Math.abs(lon) < aL / 2 + rc * bL / 2 + rs * bW / 2 + 0.7 && Math.abs(lat) < aW / 2 + rs * bL / 2 + rc * bW / 2 + 0.45;
  }

  get vehicles() { return this.cars.filter((c) => c.active).concat(this.parked); }
}
