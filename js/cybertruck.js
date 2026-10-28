// Tesla Cybertruck (2024-2026) built procedurally from flat facets, the way the real truck is made.
// 5.683 m long, 2.027 m wide, 1.791 m tall, 3.807 m wheelbase. The body is a set of planes: a lower side
// plane below the waist crease, an inward-raked upper side plane above it (holding the flush side glass and
// the sail), the hood, the windshield and one long top plane from the apex down to the tailgate (glass roof,
// then the tonneau between the sail pillars). Each plane's 2D outline is triangulated and cut into panels:
// four front-hinged doors, a front-hinged frunk lid and a drop-down tailgate, each on its own pivot.
// Model frame: origin on the ground at the body's lengthwise centre, forward -z, right +x, up +y.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, smooth } from './config.js';

const LEN = 5.683, ZF = -LEN / 2, ZR = LEN / 2;
const AF = -1.96, AR = 1.847, WB = AR - AF, TRK = 0.86, WR = 0.445;
const XC = 0.985;                       // half width at the waist crease
const ZC = -1.48, ZA = -0.12;           // cowl (windshield base) and apex
const Y_NOSE = 1.09, Y_COWL = 1.25, Y_APEX = 1.791, Y_TAIL = 1.27, Y_ROCK = 0.5, Y_BF = 0.66, Y_BR = 0.64;
const T_UP = 0.55, T_LO = 0.04;         // inward rake above / below the crease (dx per dy)
const yC = (z) => 1.06 + (0.09 * (z - ZF)) / LEN;   // waist crease
const yS = (z) => yC(z) + 0.13;                       // side glass sill
const xUp = (z, y) => XC - (y - yC(z)) * T_UP;
const xLo = (z, y) => XC - (yC(z) - y) * T_LO;
const yHood = (z) => Y_NOSE + ((z - ZF) * (Y_COWL - Y_NOSE)) / (ZC - ZF);
const yWind = (z) => Y_COWL + ((z - ZC) * (Y_APEX - Y_COWL)) / (ZA - ZC);
const yTop = (z) => Y_APEX + ((z - ZA) * (Y_TAIL - Y_APEX)) / (ZR - ZA);
const zFront = (y) => ZF + (Y_NOSE - y) * 0.28;
const xHood = (z) => xUp(z, yHood(z)), xWind = (z) => xUp(z, yWind(z)), xTop = (z) => xUp(z, yTop(z));
// panel cut lines
const DF0 = -1.24, DB = -0.08, DR1 = 1.1, BP1 = -0.04, CP = 0.86, HF0 = ZF + 0.05, HF1 = ZC - 0.06, RG1 = 1.0, RG2 = 1.06, SAIL_W = 0.12;
const TG = { x: 0.87, y0: 0.66, y1: 1.235 };
// angular wheel arch opening (relative to the axle) and the flare's outer edge
const ARCH = [[-0.52, 0.36], [-0.52, 0.68], [-0.3, 0.95], [0.3, 0.95], [0.52, 0.68], [0.52, 0.36]];

function offsetLine(pts, d) {
  const n = [];
  for (let i = 0; i < pts.length - 1; i++) { const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1], l = Math.hypot(dx, dy); n.push([-dy / l, dx / l]); }
  const out = [[pts[0][0] + n[0][0] * d, pts[0][1] + n[0][1] * d]];
  for (let i = 1; i < pts.length - 1; i++) { const a = n[i - 1], b = n[i], k = d / (1 + a[0] * b[0] + a[1] * b[1]); out.push([pts[i][0] + (a[0] + b[0]) * k, pts[i][1] + (a[1] + b[1]) * k]); }
  const m = n[n.length - 1], p = pts[pts.length - 1]; out.push([p[0] + m[0] * d, p[1] + m[1] * d]);
  return out;
}
const ARCH_OUT = offsetLine(ARCH, 0.08);
const archO = (za) => ARCH.map(([dz, y]) => [za + dz, y]);
const archQ = (za, yFront, yRear) => ARCH_OUT.map(([dz, y], i) => [za + dz, i === 0 ? yFront : i === ARCH_OUT.length - 1 ? yRear : y]);

// inset a convex 2D polygon, one width per edge
function inset(poly, w) {
  const n = poly.length; let area = 0;
  for (let i = 0; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const s = area > 0 ? 1 : -1, lines = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy), wi = Array.isArray(w) ? w[i] : w;
    lines.push({ p: [a[0] - (dy / l) * s * wi, a[1] + (dx / l) * s * wi], d: [dx / l, dy / l] });
  }
  return poly.map((_, i) => {
    const A = lines[(i - 1 + n) % n], B = lines[i], det = A.d[0] * B.d[1] - A.d[1] * B.d[0];
    const t = ((B.p[0] - A.p[0]) * B.d[1] - (B.p[1] - A.p[1]) * B.d[0]) / det;
    return [A.p[0] + A.d[0] * t, A.p[1] + A.d[1] * t];
  });
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mir = (p) => [-p[0], p[1], p[2]];

function plane(map, out) {
  const p0 = map(0.1, 0.9), n = norm(cross(sub(map(0.2, 0.9), p0), sub(map(0.1, 1.0), p0)));
  return { map, n: dot(n, out) < 0 ? n.map((v) => -v) : n };
}
const shift = (pl, d) => ({ map: (a, b) => { const p = pl.map(a, b); return [p[0] + pl.n[0] * d, p[1] + pl.n[1] * d, p[2] + pl.n[2] * d]; }, n: pl.n });
const PL = {
  lo: plane((z, y) => [xLo(z, y), y, z], [1, 0, 0]),
  up: plane((z, y) => [xUp(z, y), y, z], [1, 1, 0]),
  hood: plane((x, z) => [x, yHood(z), z], [0, 1, 0]),
  wind: plane((x, z) => [x, yWind(z), z], [0, 1, -1]),
  top: plane((x, z) => [x, yTop(z), z], [0, 1, 0]),
  front: plane((x, y) => [x, y, zFront(y)], [0, 0, -1]),
  rear: plane((x, y) => [x, y, ZR], [0, 0, 1]),
  well: plane((z, y) => [0.6, y, z], [1, 0, 0]),
};
// front end of the crease, where it meets the raked front face
let FCy = yC(ZF), FCz = zFront(FCy); FCy = yC(FCz); FCz = zFront(FCy);
const FC = [FCz, FCy];

// paintLo: the same stainless below the waist crease, a touch duller (road film, and it sits in the crease's shadow)
const MATS = ['paint', 'paintLo', 'glass', 'roofglass', 'trim', 'black', 'tonneau', 'seam', 'jamb', 'tint'];
const OPAQUE = ['paint', 'paintLo', 'trim', 'black'];

// Triangle soup per (part, material) with flat normals, planar UVs (metres; u along the brushing) and tangents.
class Parts {
  constructor() { this.p = {}; }
  buf(part, mat) { const P = (this.p[part] ||= {}); return (P[mat] ||= { pos: [], nor: [], uv: [], tan: [] }); }
  tri(part, mat, a, b, c, n) {
    if (dot(cross(sub(b, a), sub(c, a)), n) < 0) [b, c] = [c, b];
    const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
    const uv = (p) => (ax >= ay && ax >= az ? [p[2], p[1]] : ay >= az ? [p[2], p[0]] : [p[0], p[1]]);
    const ua = uv(a), ub = uv(b), uc = uv(c), e1 = sub(b, a), e2 = sub(c, a);
    const du1 = ub[0] - ua[0], dv1 = ub[1] - ua[1], du2 = uc[0] - ua[0], dv2 = uc[1] - ua[1], det = du1 * dv2 - du2 * dv1;
    let t = [1, 0, 0], w = 1;
    if (Math.abs(det) > 1e-12) {
      const r = 1 / det, T = [0, 1, 2].map((i) => (e1[i] * dv2 - e2[i] * dv1) * r), Bt = [0, 1, 2].map((i) => (e2[i] * du1 - e1[i] * du2) * r);
      const d = dot(T, n); t = norm([T[0] - n[0] * d, T[1] - n[1] * d, T[2] - n[2] * d]);
      w = dot(cross(n, t), Bt) < 0 ? -1 : 1;
    }
    const B = this.buf(part, mat);
    for (const [p, q] of [[a, ua], [b, ub], [c, uc]]) { B.pos.push(...p); B.nor.push(...n); B.uv.push(...q); B.tan.push(...t, w); }
  }
  face(part, mat, pl, outline, holes = [], mpart = null) {
    const tris = THREE.ShapeUtils.triangulateShape(outline.map((p) => new THREE.Vector2(p[0], p[1])), holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1]))));
    const pts = [...outline, ...holes.flat()].map(([a, b]) => pl.map(a, b));
    for (const [i, j, k] of tris) {
      this.tri(part, mat, pts[i], pts[j], pts[k], pl.n);
      if (mpart) this.tri(mpart, mat, mir(pts[i]), mir(pts[j]), mir(pts[k]), [-pl.n[0], pl.n[1], pl.n[2]]);
    }
  }
  quad(part, mat, a, b, c, d, hint, mpart = null) {
    let n = norm(cross(sub(b, a), sub(d, a)));
    if (dot(n, hint) < 0) n = n.map((v) => -v);
    this.tri(part, mat, a, b, c, n); this.tri(part, mat, a, c, d, n);
    if (mpart) { const m = [-n[0], n[1], n[2]]; this.tri(mpart, mat, mir(a), mir(b), mir(c), m); this.tri(mpart, mat, mir(a), mir(c), mir(d), m); }
  }
  // thin dark strip along a panel cut, just proud of the surface
  seam(part, pl, a, b, mpart = null, w = 0.0032) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy), px = (-dy / l) * w, py = (dx / l) * w, sp = shift(pl, 0.0016);
    this.face(part, 'seam', sp, [[a[0] + px, a[1] + py], [b[0] + px, b[1] + py], [b[0] - px, b[1] - py], [a[0] - px, a[1] - py]], [], mpart);
  }
  // door/lid thickness: walls from a 3D edge polyline to the same polyline moved by `off`
  wall(part, pts, off, mpart = null) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], c = [b[0] + off[0], b[1] + off[1], b[2] + off[2]], d = [a[0] + off[0], a[1] + off[1], a[2] + off[2]];
      this.quad(part, 'jamb', a, b, c, d, norm(cross(sub(b, a), off)), mpart);
    }
  }
  geometry(part, pivot) {
    const P = this.p[part]; if (!P) return null;
    const outer = new THREE.BufferGeometry(), inner = new THREE.BufferGeometry();
    const A = { pos: [], nor: [], uv: [], tan: [] }, I = { pos: [], nor: [] };
    let start = 0;
    MATS.forEach((m, mi) => {
      const b = P[m]; if (!b || !b.pos.length) return;
      const cnt = b.pos.length / 3;
      for (const k of ['pos', 'nor', 'uv', 'tan']) for (const v of b[k]) A[k].push(v);
      outer.addGroup(start, cnt, mi); start += cnt;
      if (OPAQUE.includes(m)) { for (const v of b.pos) I.pos.push(v); for (const v of b.nor) I.nor.push(v); }
    });
    outer.setAttribute('position', new THREE.Float32BufferAttribute(A.pos, 3));
    outer.setAttribute('normal', new THREE.Float32BufferAttribute(A.nor, 3));
    outer.setAttribute('uv', new THREE.Float32BufferAttribute(A.uv, 2));
    outer.setAttribute('tangent', new THREE.Float32BufferAttribute(A.tan, 4));
    inner.setAttribute('position', new THREE.Float32BufferAttribute(I.pos, 3));
    inner.setAttribute('normal', new THREE.Float32BufferAttribute(I.nor, 3));
    outer.translate(-pivot.x, -pivot.y, -pivot.z); inner.translate(-pivot.x, -pivot.y, -pivot.z);
    return { outer, inner };
  }
}

function buildShell(viz) {
  const G = new Parts();
  const lo = PL.lo, up = PL.up;
  // ---- lower side plane: front fender, doors, rear quarter (right side, mirrored)
  G.face('body', 'paintLo', lo, [FC, [zFront(Y_BF), Y_BF], ...archQ(AF, Y_BF, Y_ROCK), [DF0, Y_ROCK], [DF0, yC(DF0)]], [], 'body');
  G.face('FR', 'paintLo', lo, [[DF0, Y_ROCK], [DB, Y_ROCK], [DB, yC(DB)], [DF0, yC(DF0)]], [], 'FL');
  G.face('RR', 'paintLo', lo, [[DB, Y_ROCK], [DR1, Y_ROCK], [DR1, yC(DR1)], [DB, yC(DB)]], [], 'RL');
  G.face('body', 'paintLo', lo, [[DR1, yC(DR1)], [DR1, Y_ROCK], ...archQ(AR, Y_ROCK, Y_BR), [ZR, Y_BR], [ZR, yC(ZR)]], [], 'body');
  // ---- upper side plane: fender top, flush door glass, B-pillar, sail
  G.face('body', 'paint', up, [FC, [ZF, Y_NOSE], [ZC, Y_COWL], [DF0, yWind(DF0)], [DF0, yC(DF0)]], [], 'body');
  G.face('FR', 'paint', up, [[DF0, yC(DF0)], [DB, yC(DB)], [DB, yS(DB)], [DF0, yS(DF0)]], [], 'FL');
  G.face('RR', 'paint', up, [[DB, yC(DB)], [DR1, yC(DR1)], [DR1, yS(DR1)], [DB, yS(DB)]], [], 'RL');
  const fwin = [[DF0, yS(DF0)], [ZA, yS(ZA)], [ZA, Y_APEX], [DF0, yWind(DF0)]], fgl = inset(fwin, [0.014, 0.012, 0.02, 0.025]);
  G.face('FR', 'trim', up, fwin, [fgl], 'FL'); G.face('FR', 'glass', up, fgl, [], 'FL');
  const rwin = [[BP1, yS(BP1)], [DR1, yS(DR1)], [CP, yTop(CP)], [BP1, yTop(BP1)]], rgl = inset(rwin, [0.014, 0.035, 0.03, 0.012]);
  G.face('RR', 'trim', up, rwin, [rgl], 'RL'); G.face('RR', 'glass', up, rgl, [], 'RL');
  G.face('body', 'trim', up, [[ZA, yS(ZA)], [BP1, yS(BP1)], [BP1, yTop(BP1)], [ZA, Y_APEX]], [], 'body');
  G.face('body', 'paint', up, [[DR1, yC(DR1)], [ZR, yC(ZR)], [ZR, Y_TAIL], [CP, yTop(CP)], [DR1, yS(DR1)]], [], 'body');
  // ---- hood: fixed nose strip, frunk lid, black cowl
  const hq = (z0, z1) => [[-xHood(z0), z0], [xHood(z0), z0], [xHood(z1), z1], [-xHood(z1), z1]];
  G.face('body', 'paint', PL.hood, hq(ZF, HF0));
  G.face('frunk', 'paint', PL.hood, hq(HF0, HF1));
  G.face('body', 'trim', PL.hood, hq(HF1, ZC));
  // ---- windshield with a black frit border
  const ws = [[-xWind(ZC), ZC], [xWind(ZC), ZC], [xWind(ZA), ZA], [-xWind(ZA), ZA]], wsg = inset(ws, [0.05, 0.03, 0.03, 0.03]);
  G.face('body', 'trim', PL.wind, ws, [wsg]); G.face('body', 'glass', PL.wind, wsg);
  // ---- top plane: glass roof, rear roof bar, sail pillars and the flush tonneau
  const tq = (z0, z1, x0 = 0, x1 = 0) => [[-xTop(z0) + x0, z0], [xTop(z0) - x0, z0], [xTop(z1) - x1, z1], [-xTop(z1) + x1, z1]];
  const roof = tq(ZA, RG1), roofg = inset(roof, [0.03, 0.05, 0.03, 0.05]);
  G.face('body', 'trim', PL.top, roof, [roofg]); G.face('body', 'roofglass', PL.top, roofg);
  // dark inner tint under the glass roof, only seen from the cabin
  if (!viz) G.face('body', 'tint', { map: shift(PL.top, -0.012).map, n: PL.top.n.map((v) => -v) }, roofg.map(([x, z]) => [x * 0.985, z]));
  G.face('body', 'paint', PL.top, tq(RG1, RG2));
  const sx = (z, w) => xTop(z) - w;
  G.face('body', 'paint', PL.top, [[sx(RG2, SAIL_W), RG2], [xTop(RG2), RG2], [xTop(ZR), ZR], [sx(ZR, SAIL_W), ZR]], [], 'body');
  G.face('body', 'trim', PL.top, [[sx(RG2, SAIL_W + 0.012), RG2], [sx(RG2, SAIL_W), RG2], [sx(ZR, SAIL_W), ZR], [sx(ZR, SAIL_W + 0.012), ZR]], [], 'body');
  G.face('body', 'tonneau', PL.top, tq(RG2, ZR, SAIL_W + 0.012, SAIL_W + 0.012));
  // ---- raked front face under the light bar
  const zfb = zFront(Y_BF);
  G.face('body', 'paint', PL.front, [[-xLo(zfb, Y_BF), Y_BF], [xLo(zfb, Y_BF), Y_BF], [XC, FCy], [xHood(ZF), Y_NOSE], [-xHood(ZF), Y_NOSE], [-XC, FCy]]);
  // ---- rear face around the tailgate
  const tgr = [[-TG.x, TG.y0], [TG.x, TG.y0], [TG.x, TG.y1], [-TG.x, TG.y1]];
  G.face('body', 'paint', PL.rear, [[-xLo(ZR, Y_BR), Y_BR], [xLo(ZR, Y_BR), Y_BR], [XC, yC(ZR)], [xTop(ZR), Y_TAIL], [-xTop(ZR), Y_TAIL], [-XC, yC(ZR)]], [tgr]);
  G.face('trunk', 'paint', PL.rear, tgr);
  // ---- black bumpers, skid areas, rockers and underbody
  const YB = 0.4, zbf = ZF + 0.27, zbr = ZR - 0.17, YU = 0.34;
  const fb = [[-xLo(zfb, Y_BF), Y_BF, zfb], [xLo(zfb, Y_BF), Y_BF, zfb], [0.93, YB, zbf], [-0.93, YB, zbf]];
  G.quad('body', 'black', fb[0], fb[1], fb[2], fb[3], [0, -0.3, -1]);
  G.quad('body', 'black', [-0.93, YB, zbf], [0.93, YB, zbf], [0.86, YU, AF - 0.45], [-0.86, YU, AF - 0.45], [0, -1, -0.3]);
  const rb = [[-xLo(ZR, Y_BR), Y_BR, ZR], [xLo(ZR, Y_BR), Y_BR, ZR], [0.93, 0.42, zbr], [-0.93, 0.42, zbr]];
  G.quad('body', 'black', rb[0], rb[1], rb[2], rb[3], [0, -0.3, 1]);
  G.quad('body', 'black', [-0.93, 0.42, zbr], [0.93, 0.42, zbr], [0.86, YU, AR + 0.5], [-0.86, YU, AR + 0.5], [0, -1, 0.3]);
  // tow-hitch receiver under the rear bumper
  const hz = ZR - 0.06, hy0 = 0.38, hy1 = 0.45, hw = 0.04;
  for (const [a, b, c, d, h] of [
    [[-hw, hy1, zbr - 0.1], [hw, hy1, zbr - 0.1], [hw, hy1, hz], [-hw, hy1, hz], [0, 1, 0]], [[-hw, hy0, zbr - 0.1], [hw, hy0, zbr - 0.1], [hw, hy0, hz], [-hw, hy0, hz], [0, -1, 0]],
    [[hw, hy0, zbr - 0.1], [hw, hy1, zbr - 0.1], [hw, hy1, hz], [hw, hy0, hz], [1, 0, 0]], [[-hw, hy0, zbr - 0.1], [-hw, hy1, zbr - 0.1], [-hw, hy1, hz], [-hw, hy0, hz], [-1, 0, 0]],
    [[-hw, hy0, hz], [hw, hy0, hz], [hw, hy1, hz], [-hw, hy1, hz], [0, 0, 1]],
  ]) G.quad('body', 'trim', a, b, c, d, h);
  // bumper corners between the fascia and the flares
  const xf = (z, y) => xLo(z, y) + 0.004;
  G.quad('body', 'black', [xLo(zfb, Y_BF), Y_BF, zfb], [xf(AF - 0.6, Y_BF), Y_BF, AF - 0.6], [xf(AF - 0.6, YB), YB, AF - 0.6], [0.93, YB, zbf], [1, 0, 0], 'body');
  G.quad('body', 'black', [xLo(ZR, Y_BR), Y_BR, ZR], [xf(AR + 0.6, Y_BR), Y_BR, AR + 0.6], [xf(AR + 0.6, 0.42), 0.42, AR + 0.6], [0.93, 0.42, zbr], [1, 0, 0], 'body');
  // rocker cladding, 14 mm proud with a top lip
  const rk = shift(lo, 0.014);
  G.face('body', 'black', rk, [[AF + 0.6, 0.37], [AR - 0.6, 0.37], [AR - 0.6, Y_ROCK], [AF + 0.6, Y_ROCK]], [], 'body');
  G.quad('body', 'black', lo.map(AF + 0.6, Y_ROCK), lo.map(AR - 0.6, Y_ROCK), rk.map(AR - 0.6, Y_ROCK), rk.map(AF + 0.6, Y_ROCK), [0, 1, 0], 'body');
  G.quad('body', 'black', rk.map(AF + 0.6, 0.37), rk.map(AR - 0.6, 0.37), [0.8, 0.37, AR - 0.6], [0.8, 0.37, AF + 0.6], [0, -1, 0], 'body');
  G.quad('body', 'black', [-0.6, YU, AF - 0.45], [0.6, YU, AF - 0.45], [0.6, YU, AR + 0.5], [-0.6, YU, AR + 0.5], [0, -1, 0]);
  // ---- trapezoid flares (4 cm proud with a chamfered outer edge), arch lips and wheel-well liners
  const fl = shift(lo, 0.04), flc = shift(lo, 0.022);
  for (const za of [AF, AR]) {
    const Q = archQ(za, 0.36, 0.36), O = archO(za), Q2 = offsetLine(O, 0.05);
    Q2[0][1] = Q2[Q2.length - 1][1] = 0.36;
    G.face('body', 'black', fl, [...Q2, ...O.slice().reverse()], [], 'body');
    for (let i = 0; i < Q.length - 1; i++) {
      const a = Q[i], b = Q[i + 1], h = [0, b[0] - a[0], -(b[1] - a[1])];
      G.quad('body', 'black', fl.map(...Q2[i]), fl.map(...Q2[i + 1]), flc.map(...b), flc.map(...a), [1, h[1], h[2]], 'body');
      G.quad('body', 'black', flc.map(...a), flc.map(...b), lo.map(...b), lo.map(...a), [0.3, h[1], h[2]], 'body');
    }
    for (let i = 0; i < O.length - 1; i++) {
      const a = O[i], b = O[i + 1], h = [0, -(b[0] - a[0]), b[1] - a[1]];
      G.quad('body', 'black', fl.map(...a), fl.map(...b), [0.6, b[1], b[0]], [0.6, a[1], a[0]], [0, h[1], h[2]], 'body');
    }
    G.face('body', 'black', PL.well, O, [], 'body');
  }
  // ---- panel seams
  const sl = (part, pl, a, b, m) => G.seam(part, pl, a, b, m);
  sl('FR', lo, [DF0, Y_ROCK], [DF0, yC(DF0)], 'FL'); sl('FR', up, [DF0, yC(DF0)], [DF0, yWind(DF0)], 'FL');
  sl('FR', lo, [DF0, Y_ROCK + 0.002], [DB, Y_ROCK + 0.002], 'FL');
  sl('FR', lo, [DB, Y_ROCK], [DB, yC(DB)], 'FL'); sl('FR', up, [DB, yC(DB)], [DB, yS(DB)], 'FL');
  sl('RR', lo, [DB, Y_ROCK + 0.002], [DR1, Y_ROCK + 0.002], 'RL');
  sl('RR', lo, [DR1, Y_ROCK], [DR1, yC(DR1)], 'RL'); sl('RR', up, [DR1, yC(DR1)], [DR1, yS(DR1)], 'RL');
  sl('frunk', PL.hood, [-xHood(HF0), HF0], [xHood(HF0), HF0]);
  sl('frunk', PL.hood, [-xHood(HF1), HF1], [xHood(HF1), HF1]);
  for (const f of [-1, 1]) sl('frunk', PL.hood, [f * (xHood(HF0) - 0.006), HF0], [f * (xHood(HF1) - 0.006), HF1]);
  for (let i = 0; i < 4; i++) sl('trunk', PL.rear, tgr[i], tgr[(i + 1) % 4]);
  // the door-glass outlines, reused for the sliding window panes
  G.fgl = fgl; G.rgl = rgl;
  // ---- panel thickness (seen when open)
  const inX = [-0.085, 0, 0];
  const doorEdge = (z0, z1) => [up.map(z0, yS(z0)), up.map(z0, yC(z0)), lo.map(z0, Y_ROCK), lo.map(z1, Y_ROCK), lo.map(z1, yC(z1)), up.map(z1, yS(z1))];
  G.wall('FR', doorEdge(DF0, DB), inX, 'FL');
  G.wall('RR', doorEdge(DB, DR1), inX, 'RL');
  const lidE = [PL.hood.map(-xHood(HF0), HF0), PL.hood.map(xHood(HF0), HF0), PL.hood.map(xHood(HF1), HF1), PL.hood.map(-xHood(HF1), HF1)];
  G.wall('frunk', [...lidE, lidE[0]], [0, -0.05, 0]);
  const tgE = tgr.map(([x, y]) => [x, y, ZR]);
  G.wall('trunk', [...tgE, tgE[0]], [0, 0, -0.07]);
  G.face('trunk', 'tonneau', plane((x, y) => [x, y, ZR - 0.07], [0, 0, -1]), tgr);
  G.face('frunk', 'jamb', shift(PL.hood, -0.05), hq(HF0, HF1).map(([x, z]) => [x * 0.99, z]));
  if (!viz) {
    // cab back wall (follows the body section) with the rear window, and the vault's splayed inner walls
    const zw = 1.1, cab = [[-0.94, 0.48], [0.94, 0.48], [XC - 0.02, yC(zw)], [xTop(zw) - 0.02, yTop(zw) - 0.015], [-xTop(zw) + 0.02, yTop(zw) - 0.015], [-XC + 0.02, yC(zw)]];
    const rw = [[-0.6, 1.02], [0.6, 1.02], [0.6, 1.44], [-0.6, 1.44]];
    G.face('body', 'jamb', plane((x, y) => [x, y, zw], [0, 0, -1]), cab, [rw]);
    G.face('body', 'glass', plane((x, y) => [x, y, zw], [0, 0, -1]), rw);
    const bw = (z) => 0.7 + ((z - 1.12) / (ZR - 1.12)) * 0.15;
    const z1 = ZR - 0.02, yt = (z) => yTop(z) - 0.012;
    G.quad('body', 'jamb', [bw(1.12), TG.y0, 1.12], [bw(z1), TG.y0, z1], [bw(z1), yt(z1), z1], [bw(1.12), yt(1.12), 1.12], [-1, 0, 0], 'body');
  }
  return G;
}

// ---------- textures (all procedural canvases) ----------
const canvasTex = (c, srgb = true, repeat = true) => {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
};
function grain(g, W, H, amp) {
  const img = g.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * amp; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
}
function brushedTexture() {
  const W = 128, H = 1024, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const base = 150 + (Math.random() - 0.5) * 80, ph = Math.random() * 6.283, f = 1 + Math.floor(Math.random() * 3);
    for (let x = 0; x < W; x++) {
      const v = base + Math.sin(ph + (x / W) * 6.283 * f) * 14 + (Math.random() - 0.5) * 8, i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = clamp(v, 0, 255); img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return canvasTex(c, false);
}
function tonneauTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 16;
  const g = c.getContext('2d'); g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, 256, 16);
  for (let i = 0; i < 20; i++) { const x = (i * 256) / 20; g.fillStyle = '#5a5a5a'; g.fillRect(x, 0, 1.5, 16); g.fillStyle = '#9a9a9a'; g.fillRect(x + 1.5, 0, 2, 16); }
  return canvasTex(c, false);
}
// light grey marble-look dash top
function marbleTexture() {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  g.fillStyle = '#a4a5a3'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 20 + Math.random() * 90, l = Math.random() < 0.5 ? 255 : 110, a = 0.05 + Math.random() * 0.09;
    const grd = g.createRadialGradient(x, y, 0, x, y, r); grd.addColorStop(0, `rgba(${l},${l},${l},${a})`); grd.addColorStop(1, `rgba(${l},${l},${l},0)`);
    g.fillStyle = grd; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  g.lineCap = 'round';
  for (let i = 0; i < 28; i++) {
    let x = Math.random() * S, y = Math.random() * S, a = Math.random() * 6.283;
    const dark = Math.random() < 0.55;
    g.strokeStyle = dark ? `rgba(60,62,66,${0.1 + Math.random() * 0.14})` : `rgba(242,242,240,${0.2 + Math.random() * 0.25})`; g.lineWidth = 0.6 + Math.random() * 1.8;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 40; k++) { a += (Math.random() - 0.5) * 0.9; x += Math.cos(a) * 9; y += Math.sin(a) * 9; g.lineTo(x, y); }
    g.stroke();
  }
  grain(g, S, S, 9);
  return canvasTex(c);
}
// perforated leather for the seat centres
function perfTexture() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  g.fillStyle = '#262628'; g.fillRect(0, 0, S, S); grain(g, S, S, 22);
  g.fillStyle = '#0a0a0b';
  for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) { g.beginPath(); g.arc(i * 16 + 8 + (j % 2 ? 8 : 0), j * 16 + 8, 2.6, 0, 6.283); g.fill(); }
  return canvasTex(c);
}
// rubber floor mats: the faceted triangle pattern
function matTexture() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  const n = 8, cs = S / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = i * cs, y = j * cs, flip = (i + j) % 2;
    g.fillStyle = flip ? '#232324' : '#1a1a1b'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + cs, y); g.lineTo(x + (flip ? cs : 0), y + cs); g.closePath(); g.fill();
    g.fillStyle = flip ? '#1d1d1e' : '#262627'; g.beginPath(); g.moveTo(x, y + cs); g.lineTo(x + cs, y + cs); g.lineTo(x + (flip ? 0 : cs), y); g.closePath(); g.fill();
  }
  g.strokeStyle = '#101011'; g.lineWidth = 2;
  for (let k = 0; k <= n; k++) { g.beginPath(); g.moveTo(k * cs, 0); g.lineTo(k * cs, S); g.stroke(); g.beginPath(); g.moveTo(0, k * cs); g.lineTo(S, k * cs); g.stroke(); }
  grain(g, S, S, 10);
  return canvasTex(c);
}
function grilleTexture() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  g.fillStyle = '#2a2a2c'; g.fillRect(0, 0, S, S); g.fillStyle = '#09090a';
  for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) { g.beginPath(); g.arc(i * 8 + 4 + (j % 2 ? 4 : 0), j * 8 + 4, 2.2, 0, 6.283); g.fill(); }
  return canvasTex(c);
}
// stitched leather for the wheel rim (u along the rim, v around it)
function rimTexture() {
  const W = 1024, H = 64, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = '#1d1d1f'; g.fillRect(0, 0, W, H); grain(g, W, H, 16);
  g.fillStyle = '#7a7770';
  for (const v of [21, 43]) for (let x = 0; x < W; x += 14) g.fillRect(x, v - 1, 8, 2.5);
  g.fillStyle = '#111112'; g.fillRect(0, 31, W, 2);
  return canvasTex(c);
}
// tyre: dark rubber with raised sidewall lettering (u around the tyre, v across the profile)
function tyreTexture() {
  const W = 1024, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = '#1b1b1c'; g.fillRect(0, 0, W, H); g.fillStyle = '#212122'; g.fillRect(0, 79, W, 98); grain(g, W, H, 14);
  g.fillStyle = '#2e2e30'; g.font = 'bold 13px Arial'; g.textBaseline = 'middle';
  for (let k = 0; k < 4; k++) { const x = k * 256; g.fillText('CYBERTRUCK', x + 12, 220); g.fillText('ALL-TERRAIN  285/65R20', x + 12, 36); }
  g.fillStyle = '#232325'; for (const y of [204, 236, 20, 52]) g.fillRect(0, y, W, 1.5);
  return canvasTex(c);
}
function rearScreenTexture() {
  const W = 256, H = 144, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = '#0a0c10'; g.fillRect(0, 0, W, H);
  const grd = g.createLinearGradient(0, 0, W, H); grd.addColorStop(0, '#1d2d4a'); grd.addColorStop(1, '#0d1118'); g.fillStyle = grd; g.fillRect(12, 12, 150, 92);
  g.fillStyle = '#e8ecf2'; g.beginPath(); g.moveTo(76, 44); g.lineTo(104, 58); g.lineTo(76, 72); g.closePath(); g.fill();
  g.fillStyle = '#c9ced6'; g.fillRect(172, 20, 70, 8); g.fillStyle = '#6b7280'; g.fillRect(172, 36, 54, 6); g.fillRect(172, 50, 62, 6); g.fillRect(172, 64, 40, 6);
  g.fillStyle = '#1e2430'; g.fillRect(12, 112, 232, 20); g.fillStyle = '#9aa3b2'; for (let i = 0; i < 4; i++) g.fillRect(28 + i * 58, 118, 26, 8);
  return canvasTex(c, true, false);
}
function phoneTexture() {
  const W = 128, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#2b1f5c'); grd.addColorStop(1, '#0d3b66'); g.fillStyle = grd; g.fillRect(0, 0, W, H);
  g.fillStyle = '#ffffff'; g.font = 'bold 44px Arial'; g.textAlign = 'center'; g.fillText('10:08', 64, 80); g.font = '14px Arial'; g.fillText('Tuesday, October 27', 64, 104);
  g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(12, 150, 104, 24); g.fillRect(12, 184, 104, 24);
  return canvasTex(c, true, false);
}
// one atlas for every printed glyph (button labels, the T on the horn pad, the tailgate lettering)
function labelAtlas() {
  const W = 1024, H = 512, CW = 128, CH = 64, cols = 8, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), cells = {}; let col = 0, row = 0;
  const cell = (name, draw, span = 1) => {
    if (col + span > cols) { col = 0; row++; }
    const cx = col * CW, cy = row * CH, w = CW * span; col += span;
    g.save(); g.translate(cx, cy); g.beginPath(); g.rect(0, 0, w, CH); g.clip(); draw(g, w); g.restore();
    cells[name] = [cx / W, 1 - (cy + CH) / H, (cx + w) / W, 1 - cy / H];
  };
  const text = (s, size, color, weight = 'bold') => (g, w) => { g.fillStyle = color; g.font = `${weight} ${size}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, w / 2, CH / 2 + 2); };
  const tri = (dir) => (g) => { g.fillStyle = '#f2f2f2'; g.beginPath(); if (dir < 0) { g.moveTo(40, 32); g.lineTo(88, 10); g.lineTo(88, 54); } else { g.moveTo(88, 32); g.lineTo(40, 10); g.lineTo(40, 54); } g.closePath(); g.fill(); };
  for (const s of ['P', 'R', 'N', 'D']) cell(s, text(s, 44, '#f2f2f2'));
  cell('hazard', (g) => { g.strokeStyle = '#ff4a3a'; g.lineWidth = 6; g.lineJoin = 'round'; g.beginPath(); g.moveTo(64, 8); g.lineTo(104, 56); g.lineTo(24, 56); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(64, 24); g.lineTo(64, 40); g.moveTo(64, 46); g.lineTo(64, 50); g.stroke(); });
  cell('sigL', tri(-1)); cell('sigR', tri(1));
  cell('wiper', (g) => { g.strokeStyle = '#f2f2f2'; g.lineWidth = 5; g.beginPath(); g.arc(64, 62, 46, Math.PI * 1.18, Math.PI * 1.82); g.stroke(); g.beginPath(); g.moveTo(64, 60); g.lineTo(92, 26); g.stroke(); g.fillStyle = '#f2f2f2'; g.beginPath(); g.arc(64, 60, 5, 0, 6.283); g.fill(); });
  cell('lights', (g) => { g.fillStyle = '#f2f2f2'; g.beginPath(); g.moveTo(68, 12); g.bezierCurveTo(36, 12, 36, 52, 68, 52); g.closePath(); g.fill(); g.strokeStyle = '#f2f2f2'; g.lineWidth = 4; for (const y of [18, 28, 38, 48]) { g.beginPath(); g.moveTo(76, y); g.lineTo(104, y); g.stroke(); } });
  cell('voice', (g) => { g.fillStyle = '#f2f2f2'; g.fillRect(55, 8, 18, 30); g.beginPath(); g.arc(64, 8, 9, Math.PI, 0); g.fill(); g.beginPath(); g.arc(64, 38, 9, 0, Math.PI); g.fill(); g.strokeStyle = '#f2f2f2'; g.lineWidth = 4; g.beginPath(); g.arc(64, 36, 18, 0, Math.PI); g.stroke(); g.beginPath(); g.moveTo(64, 54); g.lineTo(64, 59); g.stroke(); });
  cell('T', (g) => { g.fillStyle = '#d8d9db'; g.beginPath(); g.moveTo(40, 12); g.quadraticCurveTo(64, 22, 88, 12); g.lineTo(88, 22); g.quadraticCurveTo(76, 20, 70, 27); g.lineTo(70, 56); g.lineTo(58, 56); g.lineTo(58, 27); g.quadraticCurveTo(52, 20, 40, 22); g.closePath(); g.fill(); });
  cell('media', (g) => { g.fillStyle = '#f2f2f2'; g.beginPath(); g.moveTo(44, 14); g.lineTo(76, 32); g.lineTo(44, 50); g.closePath(); g.fill(); g.fillRect(82, 14, 6, 36); g.fillRect(92, 14, 6, 36); });
  cell('FSD', text('FSD', 30, '#5aa9ff'));
  cell('CYBERTRUCK', (g, w) => { g.fillStyle = '#3a3b3d'; g.font = 'bold 40px Arial'; g.textBaseline = 'middle'; const s = 'CYBERTRUCK'; let x = 14; for (const ch of s) { g.fillText(ch, x, CH / 2 + 2); x += g.measureText(ch).width + 14; } }, 4);
  return { tex: canvasTex(c, true, false), cells };
}

// ---------- wheels ----------
let wheelCache = null;
function wheelGeos(viz) {
  if (wheelCache && wheelCache.viz === viz) return wheelCache;
  // 35" all-terrain tyre: carcass + staggered tread lugs that wrap onto the shoulder
  const prof = [[0.255, -0.125], [0.3, -0.142], [0.36, -0.148], [0.4, -0.145], [0.42, -0.136], [0.43, -0.118], [0.432, -0.08], [0.432, 0.08], [0.43, 0.118], [0.42, 0.136], [0.4, 0.145], [0.36, 0.148], [0.3, 0.142], [0.255, 0.125]];
  const carcass = new THREE.LatheGeometry(prof.map((p) => new THREE.Vector2(p[0], p[1])), 72).rotateZ(Math.PI / 2).toNonIndexed();
  const lugs = [];
  const N = viz ? 0 : 36, m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const lug = (w, h, t, x, r, a) => { const g = new THREE.BoxGeometry(w, h, t).toNonIndexed(); e.set(a, 0, 0); q.setFromEuler(e); m.compose(new THREE.Vector3(x, r * Math.cos(a), r * Math.sin(a)), q, new THREE.Vector3(1, 1, 1)); g.applyMatrix4(m); lugs.push(g); };
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, h = Math.PI / N;
    for (const s of [-1, 1]) {
      const aa = a + (s > 0 ? h : 0);
      lug(0.07, 0.02, 0.066, s * 0.1, 0.437, aa);           // shoulder block
      lug(0.016, 0.05, 0.056, s * 0.143, 0.405, aa);        // sidewall lug
      lug(0.05, 0.018, 0.05, s * 0.033, 0.438, aa + h);     // centre block
    }
  }
  const rubber = lugs.length ? mergeGeometries([carcass, mergeGeometries(lugs)], true) : carcass;
  // flat, faceted aero cover: six raised blades over a darker dish, a hex cap
  const P = { blade: [], dish: [], cap: [], rim: [] };
  const pt = (r, a, x) => [x, r * Math.cos(a), r * Math.sin(a)];
  const push = (k, a, b, c) => P[k].push(...a, ...b, ...c);
  const S = 6, step = (Math.PI * 2) / S, bw = 0.34, R0 = 0.085, R1 = 0.215;
  for (let i = 0; i < S; i++) {
    const c0 = i * step, segs = [[c0 - bw, c0 + bw, 'blade', 0.147, 0.132], [c0 + bw, c0 + step - bw, 'dish', 0.136, 0.122]];
    for (const [a0, a1, k, xi, xo] of segs) {
      const i0 = pt(R0, a0, xi), i1 = pt(R0, a1, xi), o0 = pt(R1, a0, xo), o1 = pt(R1, a1, xo);
      push(k, i0, o0, o1); push(k, i0, o1, i1);
      const s0 = pt(0.262, a0, 0.112), s1 = pt(0.262, a1, 0.112);
      push(k === 'blade' ? 'rim' : 'dish', o0, s0, s1); push(k === 'blade' ? 'rim' : 'dish', o0, s1, o1);
    }
    for (const a of [c0 - bw, c0 + bw]) push('dish', pt(R0, a, 0.147), pt(R1, a, 0.132), pt(R1, a, 0.122)), push('dish', pt(R0, a, 0.147), pt(R1, a, 0.122), pt(R0, a, 0.136));
    const h0 = c0 + step / 2, h1 = h0 + step;
    push('cap', [0.152, 0, 0], pt(R0 * 0.92, h0, 0.15), pt(R0 * 0.92, h1, 0.15));
    push('dish', pt(R0 * 0.92, h0, 0.15), pt(R0, h0, 0.141), pt(R0, h1, 0.141)); push('dish', pt(R0 * 0.92, h0, 0.15), pt(R0, h1, 0.141), pt(R0 * 0.92, h1, 0.15));
  }
  for (let i = 0; i < 24; i++) { const a0 = (i / 24) * Math.PI * 2, a1 = ((i + 1) / 24) * Math.PI * 2; push('dish', pt(0.262, a0, 0.112), pt(0.272, a0, 0.09), pt(0.272, a1, 0.09)); push('dish', pt(0.262, a0, 0.112), pt(0.272, a1, 0.09), pt(0.262, a1, 0.112)); }
  const toGeo = (arr) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); g.computeVertexNormals(); return g; };
  for (const k of Object.keys(P)) {
    const a = P[k];
    for (let i = 0; i < a.length; i += 9) {
      const A = a.slice(i, i + 3), B = a.slice(i + 3, i + 6), C = a.slice(i + 6, i + 9);
      if (cross(sub(B, A), sub(C, A))[0] < 0) for (let j = 0; j < 3; j++) [a[i + 3 + j], a[i + 6 + j]] = [a[i + 6 + j], a[i + 3 + j]];
    }
  }
  // one multi-material geometry per side: blades, rim ring, dish, cap and the dark back plate
  const back = new THREE.CircleGeometry(0.27, 24).toNonIndexed(); back.deleteAttribute('uv'); back.rotateY(-Math.PI / 2); back.translate(-0.1, 0, 0);
  const faceR = mergeGeometries([toGeo(P.blade), toGeo(P.rim), toGeo(P.dish), toGeo(P.cap), back], true);
  const faceL = faceR.clone().rotateY(Math.PI);
  wheelCache = { viz, rubber, faceR, faceL };
  return wheelCache;
}

function wheelAssembly(W, WM, side) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(W.rubber, W.rubber.groups.length > 1 ? [WM.tire, WM.tread] : WM.tire); tire.castShadow = true; g.add(tire);
  g.add(new THREE.Mesh(side < 0 ? W.faceL : W.faceR, [WM.blade, WM.rim, WM.dish, WM.cap, WM.dish]));
  return g;
}

// ---------- spec ----------
const EYE = new THREE.Vector3(-0.43, 1.4, -0.22);
const PORT = (() => { const z = 1.78, y = 1.22, n = PL.up.n; return { p: [-xUp(z, y), y, z], n: [-n[0], n[1], n[2]] }; })();
export const CYBER_PAINTS = { 'Stainless': 0xb9bcbf, 'Satin Black': 0x2a2b2d, 'Quicksilver Wrap': 0x9ea3a8, 'Arctic White Wrap': 0xe9eaeb };
const FINISH = {
  // (not fully metallic: the in-game reflection map is mostly road and grass, and bare stainless should
  // still read bright under the sky)
  [CYBER_PAINTS.Stainless]: { metalness: 0.78, roughness: 0.5, clearcoat: 0, brushed: true },
  [CYBER_PAINTS['Satin Black']]: { metalness: 0.35, roughness: 0.5, clearcoat: 0.25, brushed: false },
  [CYBER_PAINTS['Quicksilver Wrap']]: { metalness: 0.9, roughness: 0.2, clearcoat: 0.6, brushed: false },
  [CYBER_PAINTS['Arctic White Wrap']]: { metalness: 0.05, roughness: 0.32, clearcoat: 0.5, brushed: false },
};
export const CYBERTRUCK = {
  L: LEN, W: 2.027, H: Y_APEX, wheelbase: WB, axleF: AF, axleR: AR, track: TRK, wheelR: WR,
  eye: EYE.clone(),
  driverDoor: [-1.35, 1.0, -0.62],
  chargePort: PORT.p.map((v, i) => v + PORT.n[i] * 0.04),
  cameras: [
    { id: 'main', name: 'Main', pos: [0, yWind(-0.3) - 0.035, -0.3], yaw: 0, fov: 50, range: 150 },
    { id: 'narrow', name: 'Narrow', pos: [0.04, yWind(-0.3) - 0.035, -0.3], yaw: 0, fov: 35, range: 250 },
    { id: 'wide', name: 'Wide', pos: [-0.04, yWind(-0.3) - 0.035, -0.3], yaw: 0, fov: 120, range: 60 },
    { id: 'lpillar', name: 'Left Pillar', pos: [-xUp(-0.08, 1.38) - 0.01, 1.38, -0.08], yaw: -60, fov: 90, range: 80 },
    { id: 'rpillar', name: 'Right Pillar', pos: [xUp(-0.08, 1.38) + 0.01, 1.38, -0.08], yaw: 60, fov: 90, range: 80 },
    { id: 'lrep', name: 'Left Repeater', pos: [-xLo(-1.42, 0.99) - 0.01, 0.99, -1.42], yaw: -135, fov: 75, range: 100 },
    { id: 'rrep', name: 'Right Repeater', pos: [xLo(-1.42, 0.99) + 0.01, 0.99, -1.42], yaw: 135, fov: 75, range: 100 },
    { id: 'rear', name: 'Rear', pos: [0, 1.17, ZR + 0.02], yaw: 180, fov: 130, range: 50 },
  ],
};

class Squircle extends THREE.Curve {
  constructor(a, b, n) { super(); this.a = a; this.b = b; this.e = 2 / n; }
  getPoint(t, v = new THREE.Vector3()) { const th = t * Math.PI * 2, c = Math.cos(th), s = Math.sin(th); return v.set(this.a * Math.sign(c) * Math.abs(c) ** this.e, this.b * Math.sign(s) * Math.abs(s) ** this.e, 0); }
}

const WIND_A = Math.atan((Y_APEX - Y_COWL) / (ZA - ZC));   // windshield angle above horizontal
const ONE = new THREE.Vector3(1, 1, 1);
const T4 = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), ONE);

export function buildCybertruck({ viz = false, paint = CYBER_PAINTS.Stainless } = {}) {
  const root = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(chassis);
  const M = {};
  if (viz) {
    M.paint = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.45, metalness: 0.1, flatShading: true });
    M.paintLo = M.paint;
    M.trim = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.5, flatShading: true });
    M.black = M.tonneau = M.seam = M.jamb = M.trim;
    M.glass = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.2, transparent: true, opacity: 0.85 });
    M.roofglass = M.tint = M.glass;
    M.inner = new THREE.MeshStandardMaterial({ color: 0x55585e, side: THREE.BackSide });
  } else {
    const br = brushedTexture();
    M.paint = new THREE.MeshPhysicalMaterial({ color: paint, metalness: 0.78, roughness: 0.55, roughnessMap: br, anisotropy: 0.35, envMapIntensity: 1.35 });
    M.paintLo = new THREE.MeshPhysicalMaterial({ color: paint, metalness: 0.74, roughness: 0.66, roughnessMap: br, anisotropy: 0.3, envMapIntensity: 0.95 });
    M.glass = new THREE.MeshPhysicalMaterial({ color: 0x10151b, metalness: 0.2, roughness: 0.03, transparent: true, opacity: 0.68, side: THREE.DoubleSide, envMapIntensity: 1.6, depthWrite: false });
    M.roofglass = new THREE.MeshPhysicalMaterial({ color: 0x07090c, metalness: 0.3, roughness: 0.03, transparent: true, opacity: 0.9, side: THREE.DoubleSide, envMapIntensity: 1.5, depthWrite: false });
    M.tint = new THREE.MeshStandardMaterial({ color: 0x020304, roughness: 0.25, metalness: 0.3, transparent: true, opacity: 0.55, depthWrite: false });
    M.trim = new THREE.MeshPhysicalMaterial({ color: 0x0a0a0b, metalness: 0.2, roughness: 0.18, clearcoat: 1 });
    M.black = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.82 });
    const tt = tonneauTexture();
    M.tonneau = new THREE.MeshStandardMaterial({ color: 0x2a2b2d, roughness: 0.55, metalness: 0.35, map: tt, bumpMap: tt, bumpScale: 1.2 });
    M.seam = new THREE.MeshStandardMaterial({ color: 0x060606, roughness: 0.8 });
    M.jamb = new THREE.MeshStandardMaterial({ color: 0x3a3b3d, roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide });
    M.inner = new THREE.MeshStandardMaterial({ color: 0x2b2b2d, roughness: 0.85, side: THREE.BackSide });
    M.none = new THREE.MeshBasicMaterial({ visible: false });   // swapped into a panel's glass slot while that window is down
  }
  const matList = MATS.map((k) => M[k]);
  const GLASS_I = MATS.indexOf('glass'), TON_I = MATS.indexOf('tonneau');
  const G = buildShell(viz);
  const interact = [];
  const mkPart = (key, pivot) => {
    const grp = new THREE.Group(); grp.position.copy(pivot); chassis.add(grp);
    const { outer, inner } = G.geometry(key, pivot);
    const mesh = new THREE.Mesh(outer, matList.slice()); mesh.castShadow = true; mesh.receiveShadow = true;
    const im = new THREE.Mesh(inner, M.inner); im.receiveShadow = true;
    grp.add(mesh, im);
    return { grp, mesh };
  };
  const body = mkPart('body', new THREE.Vector3());
  const hx = 0.965;
  const doors = {
    FL: { ...mkPart('FL', new THREE.Vector3(-hx, 0, DF0)), axis: 'y', max: -1.1, cur: 0, target: 0, speed: 1.5 },
    FR: { ...mkPart('FR', new THREE.Vector3(hx, 0, DF0)), axis: 'y', max: 1.1, cur: 0, target: 0, speed: 1.5 },
    RL: { ...mkPart('RL', new THREE.Vector3(-hx, 0, DB)), axis: 'y', max: -1.1, cur: 0, target: 0, speed: 1.5 },
    RR: { ...mkPart('RR', new THREE.Vector3(hx, 0, DB)), axis: 'y', max: 1.1, cur: 0, target: 0, speed: 1.5 },
    frunk: { ...mkPart('frunk', new THREE.Vector3(0, yHood(HF0), HF0)), axis: 'x', max: -0.95, cur: 0, target: 0, speed: 0.55 },
    trunk: { ...mkPart('trunk', new THREE.Vector3(0, TG.y0, ZR)), axis: 'x', max: 1.5, cur: 0, target: 0, speed: 0.5 },
  };
  for (const [k, d] of Object.entries(doors)) { d.mesh.userData.action = k; interact.push(d.mesh); }

  // ---- batching: every static piece is collected per parent group and merged into ONE mesh per group with
  // one material slot per material (so the whole static interior is a single draw list, not 200 objects)
  const batch = new Map();
  const worldUV = (g) => {   // planar UVs in metres from each vertex's dominant normal axis (textures at a fixed real-world scale)
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
      if (ax >= ay && ax >= az) uv.setXY(i, p.getZ(i), p.getY(i)); else if (ay >= az) uv.setXY(i, p.getX(i), p.getZ(i)); else uv.setXY(i, p.getX(i), p.getY(i));
    }
  };
  const clean = (geo) => {   // non-indexed copy with exactly position / normal / uv
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    const s = new THREE.BufferGeometry();
    s.setAttribute('position', g.attributes.position); s.setAttribute('normal', g.attributes.normal);
    s.setAttribute('uv', g.attributes.uv ? g.attributes.uv.clone() : new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    return s;
  };
  const addCM = (geo, mat, m4, grp = chassis) => {
    const s = clean(geo); s.applyMatrix4(m4);
    if (mat.userData.worldUV) worldUV(s);
    if (!batch.has(grp.uuid)) batch.set(grp.uuid, { grp, mats: new Map() });
    const B = batch.get(grp.uuid).mats; if (!B.has(mat)) B.set(mat, []); B.get(mat).push(s);
  };
  // place in chassis coordinates (the parent's position is subtracted) or, with local=true, in the parent's own frame
  const addC = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, grp = chassis, local = false) => {
    const p = new THREE.Vector3(x, y, z); if (!local) p.sub(grp.position);
    addCM(geo, mat, T4(p.x, p.y, p.z, rx, ry, rz), grp);
  };
  const flushBatch = () => {
    for (const { grp, mats } of batch.values()) {
      const geos = [], list = [];
      for (const [mat, gl] of mats) { geos.push(gl.length > 1 ? mergeGeometries(gl) : gl[0]); list.push(mat); }
      const m = new THREE.Mesh(list.length > 1 ? mergeGeometries(geos, true) : geos[0], list.length > 1 ? list : list[0]);
      m.castShadow = true; m.receiveShadow = true; grp.add(m);
    }
    batch.clear();
  };
  // live meshes (things that move or get clicked)
  const addL = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = chassis) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.receiveShadow = true; parent.add(m); return m;
  };
  // several geometries/materials fused into one live mesh with material groups: [[geo, mat, matrix?], ...]
  const multi = (parts, parent, x = 0, y = 0, z = 0) => {
    const geos = [], mats = [];
    for (const [geo, mat, m4] of parts) { const g = clean(geo); if (m4) g.applyMatrix4(m4); geos.push(g); mats.push(mat); }
    const m = new THREE.Mesh(mergeGeometries(geos, true), mats); m.position.set(x, y, z); parent.add(m); return m;
  };
  // box between two points (beams, rails)
  const beam = (a, b, w, h, mat, grp = chassis, upHint = [0, 1, 0]) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length(); d.normalize();
    const up = new THREE.Vector3(...upHint), X = new THREE.Vector3().crossVectors(up, d).normalize(), Y = new THREE.Vector3().crossVectors(d, X);
    const g = new THREE.BoxGeometry(w, h, len).applyMatrix4(new THREE.Matrix4().makeBasis(X, Y, d));
    const c = A.add(B).multiplyScalar(0.5);
    addC(g, mat, c.x, c.y, c.z, 0, 0, 0, grp);
  };
  // a box flush on a body plane: live (onPlane) or batched (onPlaneC)
  const planeFrame = (pl, a, b, d, off) => {
    const p = pl.map(a, b), q = pl.map(a, b + 0.01), N = new THREE.Vector3(...pl.n);
    const up = new THREE.Vector3(q[0] - p[0], q[1] - p[1], q[2] - p[2]).normalize(), X = new THREE.Vector3().crossVectors(up, N).normalize();
    return { m: new THREE.Matrix4().makeBasis(X, up, N), p: new THREE.Vector3(...p).addScaledVector(N, off + d / 2) };
  };
  const onPlane = (pl, a, b, w, h, d, mat, off = 0, parent = chassis) => {
    const f = planeFrame(pl, a, b, d, off), m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.quaternion.setFromRotationMatrix(f.m); m.position.copy(f.p).sub(parent.position); parent.add(m); return m;
  };
  const onPlaneC = (pl, a, b, w, h, d, mat, off = 0, grp = chassis) => {
    const f = planeFrame(pl, a, b, d, off); f.m.setPosition(f.p.sub(grp.position)); addCM(new THREE.BoxGeometry(w, h, d), mat, f.m, grp);
  };
  const BX = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const RB = (w, h, d, r = 0.03, s = 2) => new RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  // the mirrored upper side plane, for things on the left of the body
  const upL = { map: (z, y) => mir(PL.up.map(z, y)), n: [-PL.up.n[0], PL.up.n[1], PL.up.n[2]] };

  // ---------- lights ----------
  const L = {
    drl: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.2 }),
    head: new THREE.MeshStandardMaterial({ color: 0x9aa4ad, emissive: 0xf4f8ff, emissiveIntensity: 0, roughness: 0.1, metalness: 0.6 }),
    fog: new THREE.MeshStandardMaterial({ color: 0x80858a, emissive: 0xfff3dc, emissiveIntensity: 0, roughness: 0.15, metalness: 0.5 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x3a0505, emissive: 0xff1208, emissiveIntensity: 0.4, roughness: 0.2 }),
    sigF: new THREE.MeshStandardMaterial({ color: 0x3a2a05, emissive: 0xffa21a, emissiveIntensity: 0 }),
    sigR: new THREE.MeshStandardMaterial({ color: 0x3a1005, emissive: 0xff5a10, emissiveIntensity: 0 }),
    sigFL: null, sigFR: null,
    rev: new THREE.MeshStandardMaterial({ color: 0x888888, emissive: 0xffffff, emissiveIntensity: 0 }),
    ambient: new THREE.MeshStandardMaterial({ color: 0x223344, emissive: 0x3d8bff, emissiveIntensity: 1.2 }),
    port: new THREE.MeshStandardMaterial({ color: 0x113322, emissive: 0x22ff66, emissiveIntensity: 0 }),
    fsd: new THREE.MeshStandardMaterial({ color: 0x0a1a33, emissive: 0x3d8bff, emissiveIntensity: 0 }),
    foot: new THREE.MeshStandardMaterial({ color: 0x3a4250, emissive: 0xdde8ff, emissiveIntensity: 0 }),
    domeL: new THREE.MeshStandardMaterial({ color: 0xcfcac0, emissive: 0xfff1d6, emissiveIntensity: 0, roughness: 0.3 }),
    domeR: null,
    rear: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.12, metalness: 0.1 }),
  };
  L.sigFL = L.sigF.clone(); L.sigFR = L.sigF.clone(); L.sigRL = L.sigR.clone(); L.sigRR = L.sigR.clone(); L.domeR = L.domeL.clone();
  const housing = viz ? M.trim : new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.08, metalness: 0.3, clearcoat: 1 });
  const camMat = viz ? M.trim : new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.8, roughness: 0.15 });
  // full-width front light bar on the leading edge: thin DRL line, headlamp strip, amber ends
  onPlaneC(PL.front, 0, 1.067, 1.93, 0.044, 0.008, housing, 0.001);
  onPlaneC(PL.front, 0, 1.079, 1.9, 0.01, 0.004, L.drl, 0.009);
  onPlaneC(PL.front, 0, 1.061, 1.6, 0.013, 0.004, L.head, 0.009);
  for (const s of [-1, 1]) onPlaneC(PL.front, s * 0.885, 1.061, 0.13, 0.013, 0.004, s < 0 ? L.sigFL : L.sigFR, 0.009);
  // lower bumper: dark intake slot, the front camera above it, fog lamps in the corners
  const fbp = plane((x, y) => [x, y, zFront(Y_BF) + ((Y_BF - y) / (Y_BF - 0.4)) * (ZF + 0.27 - zFront(Y_BF))], [0, -0.3, -1]);
  onPlaneC(fbp, 0, 0.5, 1.2, 0.045, 0.006, M.seam, 0.0);
  onPlaneC(fbp, 0, 0.6, 0.03, 0.03, 0.006, housing, 0.0);
  if (!viz) for (const s of [-1, 1]) { onPlaneC(fbp, s * 0.66, 0.46, 0.12, 0.032, 0.006, housing, 0.001); onPlaneC(fbp, s * 0.66, 0.46, 0.11, 0.022, 0.004, L.fog, 0.006); }
  // rear: red bar across the top of the tailgate, corner pieces with the signals
  const tgP = doors.trunk.grp;
  onPlaneC(PL.rear, 0, 1.206, 1.74, 0.036, 0.008, housing, 0.001, tgP);
  onPlaneC(PL.rear, 0, 1.213, 1.72, 0.011, 0.004, L.tail, 0.009, tgP);
  for (const s of [-1, 1]) {
    onPlaneC(PL.rear, s * 0.72, 1.197, 0.22, 0.008, 0.004, L.rev, 0.009, tgP);
    onPlaneC(PL.rear, s * 0.906, 1.206, 0.068, 0.036, 0.008, housing, 0.001);
    onPlaneC(PL.rear, s * 0.906, 1.213, 0.064, 0.011, 0.004, L.tail, 0.009);
    onPlaneC(PL.rear, s * 0.906, 1.197, 0.064, 0.008, 0.004, s < 0 ? L.sigRL : L.sigRR, 0.009);
  }
  // rear plate in the bumper, the reversing camera just above it
  if (!viz) {
    const plateC = document.createElement('canvas'); plateC.width = 256; plateC.height = 128;
    const px = plateC.getContext('2d'); px.fillStyle = '#f4f4f0'; px.fillRect(0, 0, 256, 128); px.fillStyle = '#1b2a6b'; px.font = 'bold 64px Arial'; px.textAlign = 'center'; px.fillText('FSD 26', 128, 88); px.font = '18px Arial'; px.fillText('CALIFORNIA', 128, 26);
    const plateT = new THREE.CanvasTexture(plateC); plateT.colorSpace = THREE.SRGBColorSpace;
    const t = (0.64 - 0.53) / (0.64 - 0.42), ang = Math.atan2(0.17, 0.22);
    addC(new THREE.PlaneGeometry(0.31, 0.155), new THREE.MeshStandardMaterial({ map: plateT, roughness: 0.5 }), 0, 0.53, ZR - t * 0.17 + 0.006, ang);
    addC(BX(0.05, 0.022, 0.024), housing, 0, 0.628, ZR - 0.02, ang);
    addC(new THREE.CylinderGeometry(0.007, 0.007, 0.004, 12), camMat, 0, 0.628, ZR - 0.003, Math.PI / 2 - ang);
  }
  // the single giant wiper, pivoted at the driver's side of the cowl, sweeping across the windshield plane
  let wiper = null;
  if (!viz) {
    // local frame: +x along the cowl toward the passenger side, +y DOWN the glass (right-handed with the glass normal), +z out of the glass
    const N = new THREE.Vector3(...PL.wind.n), X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3().crossVectors(N, X).normalize();
    wiper = new THREE.Group(); wiper.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, N));
    wiper.position.set(...PL.wind.map(-0.76, ZC + 0.085)).addScaledVector(N, 0.012); chassis.add(wiper);
    multi([
      [BX(1.44, 0.02, 0.012), M.trim, T4(0.72, -0.014, 0.006, 0, 0, -0.012)],     // arm, lifting slightly toward the tip
      [BX(1.36, 0.006, 0.016), M.black, T4(0.76, -0.002, -0.003, 0, 0, -0.012)],  // blade
      [BX(0.09, 0.05, 0.034), M.trim, T4(0.0, -0.012, 0.0)],                       // pivot cover
    ], wiper);
  }
  // charge port behind a flap in the left sail, above the rear wheel
  // local frame on the sloped panel: +x into the body, +y up the slope, +z rearward; hinge at the flap's front edge
  const tilt = new THREE.Group(); chassis.add(tilt);
  {
    const N = new THREE.Vector3(...PORT.n), X = N.clone().negate();
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(N, -N.y).normalize(), Z = new THREE.Vector3().crossVectors(X, up);
    tilt.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, up, Z));
    tilt.position.set(...PORT.p).addScaledVector(Z, -0.08);
  }
  const chargeFlap = new THREE.Group(); tilt.add(chargeFlap);
  const flap = new THREE.Mesh(new RoundedBoxGeometry(0.006, 0.12, 0.16, 1, 0.002), M.paint);
  flap.position.set(-0.007, 0, 0.08); flap.userData.action = 'chargeport'; chargeFlap.add(flap); interact.push(flap);
  multi([
    [BX(0.002, 0.128, 0.168), M.seam, T4(-0.001, 0, 0.08)],
    [new THREE.TorusGeometry(0.034, 0.004, 8, 24), L.port, T4(-0.002, 0, 0.08, 0, Math.PI / 2, 0)],
    [new THREE.CircleGeometry(0.032, 20), M.trim, T4(-0.0025, 0, 0.08, 0, -Math.PI / 2, 0)],
  ], tilt);

  // mirrors (small camera-style pods on the front doors; they fold), cameras, the exterior door buttons
  const mirPts = [
    [0.0, -0.035, -0.055], [0.0, 0.04, -0.05], [0.0, -0.035, 0.03], [0.0, 0.045, 0.03],
    [0.16, -0.04, -0.06], [0.17, 0.05, -0.045], [0.16, -0.045, 0.035], [0.17, 0.055, 0.035],
    [0.08, 0.06, -0.06], [0.08, -0.055, -0.07], [0.19, 0.005, -0.03], [0.19, 0.01, 0.03],
  ];
  const mirGlassMat = viz ? M.glass : new THREE.MeshStandardMaterial({ color: 0x9aa3ab, metalness: 1, roughness: 0.02 });
  const mirrors = [];
  for (const s of [-1, 1]) {
    const d = s < 0 ? doors.FL : doors.FR, pv = d.grp.position, z = -1.12, y = yS(z) - 0.035;
    const mg = new THREE.Group(); mg.position.set(s * (xUp(z, y) + 0.045) - pv.x, y + 0.03, z - pv.z); d.grp.add(mg);
    const pod = multi([
      [new ConvexGeometry(mirPts.map((p) => new THREE.Vector3(s * p[0], p[1], p[2]))), M.trim],
      [new THREE.PlaneGeometry(0.135, 0.07), mirGlassMat, T4(s * 0.09, 0.006, 0.0352)],
      [BX(0.1, 0.022, 0.05), M.trim, T4(-s * 0.04, -0.03, -0.01, 0, 0, s * 0.45)],
    ], mg);
    pod.castShadow = true; mirrors.push({ grp: mg, s });
    // fender repeater camera and B-pillar camera
    addC(new THREE.CylinderGeometry(0.013, 0.013, 0.01, 14), M.trim, s * (xLo(-1.42, 0.99) + 0.004), 0.99, -1.42, 0, 0, Math.PI / 2);
    const bp = PL.up.map(-0.08, 1.38), bc = new THREE.Object3D(); bc.position.set(s * (bp[0] + 0.004), bp[1], bp[2]); bc.lookAt(s * 3, bp[1] + 1.5, bp[2]); bc.updateMatrix();
    addCM(new THREE.CircleGeometry(0.011, 14), camMat, bc.matrix);
    // no door handles: a small button pad on the B-pillar (front doors) and on the sail (rear doors)
    const up = s < 0 ? upL : PL.up;
    onPlaneC(up, -0.08, yS(-0.08) + 0.09, 0.028, 0.05, 0.004, M.black, 0.0015);
    onPlaneC(up, DR1 + 0.045, yS(DR1) + 0.07, 0.028, 0.05, 0.004, M.black, 0.0015);
  }

  // ---------- wheels ----------
  const WM = {
    tire: viz ? new THREE.MeshStandardMaterial({ color: 0x1b1b1c, roughness: 0.93 }) : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, map: tyreTexture(), bumpMap: null }),
    tread: new THREE.MeshStandardMaterial({ color: 0x202021, roughness: 0.88 }),
    blade: viz ? new THREE.MeshStandardMaterial({ color: 0x8d9196, roughness: 0.4, flatShading: true }) : new THREE.MeshStandardMaterial({ color: 0x8a8e93, roughness: 0.38, metalness: 0.6, flatShading: true }),
    rim: viz ? new THREE.MeshStandardMaterial({ color: 0x6d7176, roughness: 0.4, flatShading: true }) : new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.45, metalness: 0.55, flatShading: true }),
    dish: new THREE.MeshStandardMaterial({ color: 0x1f2022, roughness: 0.6, metalness: 0.3, flatShading: true, side: THREE.DoubleSide }),
    cap: new THREE.MeshStandardMaterial({ color: 0x111112, roughness: 0.3, metalness: 0.4, flatShading: true }),
  };
  if (!viz) { WM.tire.bumpMap = WM.tire.map; WM.tire.bumpScale = 0.8; }
  const W = wheelGeos(viz);
  const wheels = [];
  for (const [z, front] of [[AF, true], [AR, false]]) for (const s of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(s * TRK, WR, z);
    const spin = new THREE.Group(); pivot.add(spin);
    spin.add(wheelAssembly(W, WM, s));
    root.add(pivot);
    wheels.push({ pivot, spin, front, side: s });
  }

  // ---------- interior ----------
  let steeringSpin = null, screenMesh = null;
  const I = viz ? null : { wipPhase: 0, scrollKick: 0, envSync: [], scrollL: null, label: null };
  const anim = {}, buttons = new Map();
  const mkAnim = (name, speed = 3) => (anim[name] = { cur: 0, target: 0, speed, apply: null });
  // a clickable control: action + hover label; dir (in the parent's frame) gives it a press-down animation
  const hit = (mesh, action, label, dir = null, obj = mesh) => {
    mesh.userData.action = action; mesh.userData.inside = true; mesh.userData.label = label; interact.push(mesh);
    if (dir) { if (!buttons.has(action)) buttons.set(action, []); buttons.get(action).push({ obj, base: obj.position.clone(), dir: new THREE.Vector3(...dir), t: 0 }); }
    return mesh;
  };
  if (!viz) {
    const marble = marbleTexture(), perf = perfTexture(), matT = matTexture(), grille = grilleTexture(), atlas = labelAtlas();
    marble.repeat.set(1.6, 1.6); perf.repeat.set(7, 7); matT.repeat.set(8, 8); grille.repeat.set(28, 28);
    const im = {
      dash: new THREE.MeshStandardMaterial({ color: 0x232325, roughness: 0.85 }),
      dashTop: new THREE.MeshStandardMaterial({ map: marble, roughness: 0.92 }),
      leather: new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.6 }),
      perf: new THREE.MeshStandardMaterial({ map: perf, bumpMap: perf, bumpScale: 0.4, roughness: 0.65 }),
      stitch: new THREE.MeshStandardMaterial({ color: 0x8c8a84, roughness: 0.9 }),
      fabric: new THREE.MeshStandardMaterial({ color: 0x47474a, roughness: 1 }),
      gloss: new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.1, clearcoat: 1 }),
      carpet: new THREE.MeshStandardMaterial({ color: 0x141415, roughness: 1 }),
      mat: new THREE.MeshStandardMaterial({ map: matT, bumpMap: matT, bumpScale: 0.5, roughness: 0.95 }),
      metal: new THREE.MeshStandardMaterial({ color: 0xa9acb0, metalness: 0.85, roughness: 0.32, envMapIntensity: 0.6 }),
      alu: new THREE.MeshStandardMaterial({ color: 0x9a9da1, metalness: 0.7, roughness: 0.42, envMapIntensity: 0.5 }),
      head: new THREE.MeshStandardMaterial({ color: 0x2e2e30, roughness: 1 }),
      pillar: new THREE.MeshStandardMaterial({ color: 0x1f1f21, roughness: 0.9 }),
      bed: new THREE.MeshStandardMaterial({ color: 0x1e1f21, roughness: 0.75 }),
      grille: new THREE.MeshStandardMaterial({ map: grille, bumpMap: grille, bumpScale: 0.3, roughness: 0.8 }),
      rim: new THREE.MeshStandardMaterial({ map: rimTexture(), roughness: 0.6 }),
      label: new THREE.MeshStandardMaterial({ map: atlas.tex, emissive: 0xffffff, emissiveMap: atlas.tex, emissiveIntensity: 0.3, alphaTest: 0.4, roughness: 0.6 }),
      belt: new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.95 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x0f0f10, roughness: 0.95 }),
      cup: new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.7 }),
    };
    for (const m of [im.dashTop, im.perf, im.mat, im.grille]) m.userData.worldUV = true;
    const rvGlass = new THREE.MeshStandardMaterial({ color: 0x6f767c, metalness: 1, roughness: 0.08, envMapIntensity: 0.45 });
    I.envSync.push(M.paintLo, im.metal, im.alu, mirGlassMat, rvGlass); I.label = im.label;
    const label = (name, w, h) => { const g = new THREE.PlaneGeometry(w, h), r = atlas.cells[name], uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]), r[1] + uv.getY(i) * (r[3] - r[1])); return g; };
    const extrudeX = (pts, x0, x1, bevel = 0) => {   // a (z, y) profile extruded across the cabin from x0 to x1
      const sh = new THREE.Shape(); pts.forEach((p, i) => (i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1])));
      const g = new THREE.ExtrudeGeometry(sh, { depth: x1 - x0, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2 });
      g.rotateY(-Math.PI / 2); g.translate(x1, 0, 0); return g;
    };

    // ---- dashboard: one long flat shelf under the windshield (marble top), a dark fascia with the ambient strip under its lip
    addC(extrudeX([[-1.5, 1.228], [-1.0, 1.125], [-0.885, 1.112], [-0.85, 1.098], [-0.84, 1.07], [-0.84, 1.03], [-0.86, 1.005], [-0.885, 0.96], [-0.9, 0.86], [-0.96, 0.78], [-1.1, 0.66], [-1.3, 0.56], [-1.5, 0.52]], -0.92, 0.92, 0.012), im.dash, 0, 0, 0);
    addC(extrudeX([[-1.5, 1.248], [-1.0, 1.143], [-0.885, 1.128], [-0.845, 1.114], [-0.828, 1.095], [-0.85, 1.088], [-0.885, 1.104], [-1.0, 1.12], [-1.5, 1.225]], -0.91, 0.91), im.dashTop, 0, 0, 0);
    addC(BX(1.78, 0.005, 0.007), L.ambient, 0, 1.062, -0.838);                 // full-width light strip under the lip
    addC(BX(1.72, 0.014, 0.05), M.seam, 0, 1.235, -1.455);                     // the hidden windshield vent slot
    for (const s of [-1, 1]) addC(BX(0.26, 0.02, 0.016), M.seam, s * 0.7, 1.025, -0.842);   // slim side vents
    addC(BX(1.7, 0.016, 0.02), M.black, 0, 0.955, -0.887);                     // knee-bolster edge
    for (const s of [-1, 1]) addC(BX(0.07, 0.004, 0.012), L.foot, s * 0.43, 0.56, -1.0);   // footwell lights
    // glovebox: a drawer in the lower dash on the passenger side
    const glove = new THREE.Group(); glove.position.set(0.5, 0.86, -0.906); glove.rotation.x = 0.4; chassis.add(glove);
    addC(RB(0.52, 0.19, 0.012, 0.006, 1), M.seam, 0.5, 0.86, -0.91, 0.4);
    hit(multi([[RB(0.5, 0.17, 0.02, 0.008, 1), im.dash], [BX(0.46, 0.14, 0.26), im.dash, T4(0, -0.012, -0.14)], [BX(0.44, 0.004, 0.22), im.carpet, T4(0, 0.045, -0.14)]], glove), 'glovebox', 'Glovebox');
    mkAnim('glovebox', 2.5).apply = (k) => { glove.position.z = -0.906 + k * 0.22; };

    // ---- centre touchscreen (18.5", landscape) on a short stand
    const scr = new THREE.Group(); scr.position.set(0, 1.268, -0.9); scr.rotation.set(-0.2, -0.06, 0); chassis.add(scr);
    addC(RB(0.44, 0.27, 0.02, 0.007, 2), im.gloss, 0, 0, 0, 0, 0, 0, scr, true);
    screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.25), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    screenMesh.position.z = 0.0105; screenMesh.userData.screen = true; scr.add(screenMesh);
    addC(RB(0.14, 0.1, 0.04, 0.012, 1), im.dash, 0, -0.16, -0.03, 0, 0, 0, scr, true);
    addC(RB(0.22, 0.012, 0.1, 0.005, 1), im.dash, 0, -0.2, -0.03, 0, 0, 0, scr, true);

    // ---- squircle steering wheel (steer-by-wire; no stalks: signals, wipers and lights live on the left spoke)
    const sw = new THREE.Group(); sw.position.set(EYE.x, 1.1, -0.66); sw.rotation.x = -0.42; chassis.add(sw);
    const spin = new THREE.Group(); sw.add(spin); steeringSpin = spin;
    addC(new THREE.TubeGeometry(new Squircle(0.185, 0.14, 4.5), 128, 0.019, 10, true), im.rim, 0, 0, 0, 0, 0, 0, spin, true);
    addC(RB(0.2, 0.115, 0.04, 0.02, 2), im.leather, 0, -0.012, -0.012, 0, 0, 0, spin, true);                   // hub
    for (const s of [-1, 1]) addC(RB(0.11, 0.056, 0.034, 0.012, 2), im.leather, s * 0.125, -0.004, -0.012, 0, 0, 0, spin, true);
    addC(RB(0.06, 0.1, 0.034, 0.012, 2), im.leather, 0, -0.1, -0.012, 0, 0, 0, spin, true);
    for (const s of [-1, 1]) addC(BX(0.002, 0.03, 0.002), im.stitch, s * 0.07, -0.004, 0.0055, 0, 0, 0, spin, true);   // spoke seams
    hit(multi([[RB(0.15, 0.075, 0.012, 0.012, 2), im.gloss], [label('T', 0.03, 0.015), im.label, T4(0, 0.004, 0.0062)]], spin, 0, -0.005, 0.014), 'horn', 'Horn', [0, 0, -1]);
    const wbtn = (x, y, name, action, text) => hit(multi([[RB(0.022, 0.016, 0.008, 0.003, 1), im.gloss], [label(name, 0.018, 0.009), im.label, T4(0, 0, 0.0042)]], spin, x, y, 0.009), action, text, [0, 0, -1]);
    wbtn(-0.152, 0.014, 'sigR', 'sig:R', 'Right turn signal'); wbtn(-0.152, -0.006, 'sigL', 'sig:L', 'Left turn signal');
    wbtn(-0.118, -0.02, 'wiper', 'wiper', 'Wipers'); wbtn(-0.092, -0.02, 'lights', 'lights', 'Headlights');
    wbtn(0.152, 0.004, 'voice', 'voice', 'Voice command');
    // scroll wheels: the left one rolls (volume) and presses (play/pause), the right one presses to engage FSD
    const scrollL = new THREE.Group(); scrollL.position.set(-0.105, 0.012, 0.011); spin.add(scrollL); I.scrollL = scrollL;
    const seg = (t0, t1, action, text) => hit(addL(new THREE.CylinderGeometry(0.0125, 0.0125, 0.017, 20, 1, false, t0, t1 - t0).rotateZ(Math.PI / 2), im.rubber, 0, 0, 0, 0, 0, 0, scrollL), action, text, [0, 0, -1], scrollL);
    seg(Math.PI / 6, Math.PI, 'volUp', 'Volume up'); seg(-Math.PI / 6, Math.PI / 6, 'media', 'Play / pause'); seg(Math.PI, (11 * Math.PI) / 6, 'volDown', 'Volume down');
    hit(addL(new THREE.CylinderGeometry(0.0125, 0.0125, 0.017, 20).rotateZ(Math.PI / 2), im.rubber, 0.105, 0.012, 0.011, 0, 0, 0, spin), 'fsd', 'Engage FSD', [0, 0, -1]);
    addC(BX(0.016, 0.004, 0.002), L.fsd, 0.105, -0.022, 0.0055, 0, 0, 0, spin, true);                       // FSD indicator
    addC(label('FSD', 0.014, 0.007), im.label, 0.128, -0.022, 0.0056, 0, 0, 0, spin, true);
    addC(new THREE.CylinderGeometry(0.035, 0.045, 0.24, 16), im.dash, 0, 0, -0.13, Math.PI / 2, 0, 0, sw, true);   // column
    addC(RB(0.13, 0.1, 0.16, 0.03, 2), im.dash, 0, -0.02, -0.26, 0, 0, 0, sw, true);                              // shroud

    // ---- seats: sculpted, bolstered, integrated headrests, perforated centres, seams, rails, belts
    const seatF = (x, z) => {
      const T = 0.06, R = 0.2, zb = z + 0.3, yb = 1.12, si = x < 0 ? 1 : -1;
      addC(RB(0.5, 0.11, 0.5, 0.04, 2), im.leather, x, 0.73, z, T);
      addC(RB(0.28, 0.1, 0.44, 0.03, 2), im.perf, x, 0.755, z - 0.01, T);
      for (const s of [-1, 1]) { addC(RB(0.1, 0.1, 0.48, 0.035, 2), im.leather, x + s * 0.2, 0.775, z, T); addC(BX(0.003, 0.1, 0.44), im.stitch, x + s * 0.141, 0.757, z - 0.01, T); }
      addC(RB(0.5, 0.68, 0.12, 0.04, 2), im.leather, x, yb, zb, R);
      addC(RB(0.28, 0.6, 0.12, 0.03, 2), im.perf, x, yb - 0.02, zb - 0.012, R);
      for (const s of [-1, 1]) { addC(RB(0.1, 0.56, 0.14, 0.035, 2), im.leather, x + s * 0.2, yb - 0.03, zb + 0.005, R); addC(BX(0.003, 0.6, 0.122), im.stitch, x + s * 0.141, yb - 0.02, zb - 0.012, R); }
      addC(RB(0.3, 0.2, 0.1, 0.04, 2), im.leather, x, yb + 0.44 * Math.cos(R), zb + 0.44 * Math.sin(R), R);
      addC(BX(0.44, 0.16, 0.44), im.dash, x, 0.6, z);
      for (const s of [-1, 1]) addC(BX(0.03, 0.03, 0.56), im.metal, x + s * 0.17, 0.51, z);
      addC(BX(0.025, 0.08, 0.025), im.rubber, x + si * 0.22, 0.78, z + 0.1, -0.3);
      addC(RB(0.035, 0.05, 0.022, 0.006, 1), im.metal, x + si * 0.22, 0.825, z + 0.09, -0.3);
    };
    seatF(EYE.x, -0.36); seatF(-EYE.x, -0.36);
    // three-across rear bench with a folded centre armrest
    addC(RB(1.62, 0.13, 0.5, 0.04, 2), im.leather, 0, 0.73, 0.66, 0.05);
    addC(RB(1.62, 0.56, 0.12, 0.04, 2), im.leather, 0, 1.04, 0.97, 0.18);
    for (const x of [-0.52, 0, 0.52]) {
      addC(RB(0.4, 0.1, 0.42, 0.03, 2), im.perf, x, 0.76, 0.65, 0.05); addC(RB(0.4, 0.46, 0.12, 0.03, 2), im.perf, x, 1.02, 0.96, 0.18);
      for (const s of [-1, 1]) { addC(BX(0.003, 0.1, 0.42), im.stitch, x + s * 0.2, 0.762, 0.65, 0.05); addC(BX(0.003, 0.46, 0.122), im.stitch, x + s * 0.2, 1.02, 0.96, 0.18); }
      addC(RB(0.3, 0.17, 0.1, 0.04, 2), im.leather, x, 1.04 + 0.35 * Math.cos(0.18), 0.97 + 0.35 * Math.sin(0.18), 0.18);
    }
    addC(RB(0.34, 0.3, 0.05, 0.015, 1), im.leather, 0, 0.98, 0.905, 0.18); addC(BX(0.34, 0.003, 0.052), im.stitch, 0, 1.13, 0.935, 0.18);
    for (const x of [-0.26, 0, 0.26]) { addC(BX(0.025, 0.07, 0.025), im.rubber, x, 0.8, 0.84); addC(RB(0.035, 0.05, 0.022, 0.006, 1), im.metal, x, 0.84, 0.835); }
    // belts: B-pillar guide, strap down the pillar, floor anchor
    for (const f of [-1, 1]) {
      const xg = f * (xUp(-0.08, 1.42) - 0.06);
      addC(RB(0.02, 0.06, 0.05, 0.006, 1), im.metal, xg, 1.43, -0.08);
      beam([xg + f * 0.004, 1.41, -0.08], [f * 0.82, 0.5, 0.02], 0.047, 0.004, im.belt, chassis, [1, 0, 0]);
    }
    // floor, mats, pedals
    addC(BX(1.84, 0.04, 2.52), im.carpet, 0, 0.46, -0.16);
    addC(BX(1.6, 0.04, 0.5), im.carpet, 0, 0.56, -1.3, 0.5);
    for (const s of [-1, 1]) addC(BX(0.52, 0.006, 0.6), im.mat, s * 0.43, 0.483, -0.86);
    addC(BX(1.5, 0.006, 0.46), im.mat, 0, 0.483, 0.26);
    addC(RB(0.055, 0.15, 0.012, 0.005, 1), im.rubber, -0.33, 0.6, -1.17, -0.55);                       // accelerator (floor-hinged)
    addC(RB(0.1, 0.07, 0.014, 0.005, 1), im.rubber, -0.5, 0.645, -1.17, -0.55); addC(BX(0.02, 0.18, 0.012), im.metal, -0.5, 0.74, -1.22, -0.35);   // brake + arm
    addC(RB(0.08, 0.16, 0.012, 0.005, 1), im.rubber, -0.7, 0.63, -1.2, -0.55);                          // dead pedal

    // ---- centre console: phone pads on a sloped deck, cup holders, deep lidded bin, rear screen
    addC(RB(0.32, 0.26, 1.04, 0.03, 2), im.dash, 0, 0.62, -0.34);
    for (const s of [-1, 1]) { addC(BX(0.012, 0.008, 0.9), im.alu, s * 0.158, 0.754, -0.35); addC(BX(0.016, 0.03, 0.4), im.rubber, s * 0.16, 0.7, -0.3); }   // trim strip, grab recess
    const padT = 0.3, padY = 0.772, padZ = -0.7;
    addC(BX(0.3, 0.02, 0.26), im.dash, 0, 0.762, padZ, padT);
    const phoneMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: phoneTexture(), emissiveIntensity: 0.9, roughness: 0.2 });
    for (const [s, key] of [[-1, 'L'], [1, 'R']]) {
      hit(addL(RB(0.1, 0.006, 0.18, 0.004, 1), im.gloss, s * 0.065, padY, padZ, padT), 'pad:' + key, 'Phone charger');
      addC(BX(0.08, 0.002, 0.16), im.rubber, s * 0.065, padY + 0.0035, padZ, padT);
      const ph = multi([[RB(0.074, 0.008, 0.152, 0.006, 1), im.gloss], [new THREE.PlaneGeometry(0.066, 0.142), phoneMat, new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(0, 0.0041, 0)]], chassis, s * 0.065, padY + 0.009, padZ);
      ph.rotation.x = padT; ph.visible = false;
      mkAnim('pad:' + key, 4).apply = (k) => { ph.visible = k > 0.001; ph.scale.setScalar(Math.max(k, 0.001)); };
    }
    for (const s of [-1, 1]) {
      const recG = new THREE.CylinderGeometry(0.042, 0.042, 0.008, 24);
      if (s < 0) hit(addL(recG, im.rubber, s * 0.07, 0.751, -0.46), 'cupholder', 'Cup holder'); else addC(recG, im.rubber, s * 0.07, 0.751, -0.46);
      addC(new THREE.TorusGeometry(0.042, 0.004, 6, 24), im.alu, s * 0.07, 0.755, -0.46, Math.PI / 2);
    }
    const cup = multi([[new THREE.CylinderGeometry(0.038, 0.032, 0.13, 20), im.cup], [new THREE.CylinderGeometry(0.041, 0.041, 0.014, 20), im.rubber, T4(0, 0.072, 0)]], chassis, -0.07, 0.815, -0.46);
    cup.visible = false; mkAnim('cupholder', 4).apply = (k) => { cup.visible = k > 0.001; cup.scale.setScalar(Math.max(k, 0.001)); };
    // armrest bin: walls, floor, lid hinged at the back
    for (const [w, h, d, x, y, z] of [[0.32, 0.1, 0.02, 0, 0.78, -0.3], [0.32, 0.1, 0.02, 0, 0.78, 0.18], [0.02, 0.1, 0.5, -0.15, 0.78, -0.06], [0.02, 0.1, 0.5, 0.15, 0.78, -0.06]]) addC(BX(w, h, d), im.dash, x, y, z);
    addC(BX(0.3, 0.01, 0.48), im.carpet, 0, 0.74, -0.06);
    const arm = new THREE.Group(); arm.position.set(0, 0.835, 0.17); chassis.add(arm);
    hit(multi([[RB(0.3, 0.05, 0.48, 0.02, 2), im.leather, T4(0, 0, -0.24)], [BX(0.26, 0.003, 0.003), im.stitch, T4(0, 0.025, -0.08)], [BX(0.26, 0.003, 0.003), im.stitch, T4(0, 0.025, -0.4)]], arm), 'armrest', 'Armrest');
    mkAnim('armrest', 2.5).apply = (k) => { arm.rotation.x = k * 1.35; };
    // the 9.4" rear display on the back of the console, vents and USB-C under it
    L.rear.emissiveMap = rearScreenTexture(); L.rear.needsUpdate = true;
    addC(RB(0.24, 0.15, 0.012, 0.006, 1), im.gloss, 0, 0.86, 0.19);
    hit(addL(new THREE.PlaneGeometry(0.208, 0.117), L.rear, 0, 0.86, 0.197), 'rearScreen', 'Rear screen');
    mkAnim('rearScreen', 4).apply = (k) => { L.rear.emissiveIntensity = k * 1.3; };
    addC(BX(0.2, 0.025, 0.01), M.seam, 0, 0.765, 0.194); for (const s of [-1, 1]) addC(BX(0.012, 0.005, 0.004), M.seam, s * 0.03, 0.735, 0.194);

    // ---- A-pillars, headliner rails, headers, B-pillar trims, sills
    const yRoof = (z) => (z < ZA ? yWind(z) : yTop(z));
    for (const f of [-1, 1]) {
      beam([f * (xWind(ZC + 0.08) - 0.06), yWind(ZC + 0.08) - 0.03, ZC + 0.08], [f * (xWind(ZA) - 0.075), yWind(ZA) - 0.045, ZA], 0.12, 0.08, im.pillar);
      beam([f * (xUp(ZA, yRoof(ZA)) - 0.075), yRoof(ZA) - 0.03, ZA], [f * (xUp(RG1, yRoof(RG1)) - 0.075), yRoof(RG1) - 0.03, RG1 + 0.05], 0.15, 0.03, im.head);
      const bp0 = [f * (xUp(-0.08, yS(-0.08)) - 0.03), yS(-0.08), -0.08], bp1 = [f * (xUp(-0.08, yTop(-0.08)) - 0.04), yTop(-0.08) - 0.03, -0.08];
      beam(bp0, bp1, 0.05, 0.1, im.pillar, chassis, [0, 0, 1]);
      const pillar = (z, y1, d) => {
        beam([f * (xLo(z, 0.5) - 0.06), 0.5, z], [f * (XC - 0.06), yC(z), z], 0.09, d, M.jamb, chassis, [0, 0, 1]);
        beam([f * (XC - 0.06), yC(z), z], [f * (xUp(z, y1) - 0.06), y1, z], 0.09, d, M.jamb, chassis, [0, 0, 1]);
      };
      pillar(DF0 - 0.03, yWind(DF0) - 0.03, 0.06); pillar(DB, yS(DB), 0.08); pillar(DR1 + 0.03, yS(DR1), 0.06);
      beam([f * 0.905, 0.47, DF0], [f * 0.905, 0.47, DR1], 0.1, 0.06, M.jamb);
    }
    addC(BX(1.3, 0.04, 0.12), im.head, 0, Y_APEX - 0.055, ZA + 0.03);
    addC(BX(1.4, 0.04, 0.14), im.head, 0, yTop(RG1) - 0.045, RG1 + 0.03);
    addC(BX(1.3, 0.02, 0.1), im.head, 0, yTop(1.06) - 0.03, 1.05);
    // ---- overhead console on the top of the windshield: hazard + backup P R N D buttons, reading lights, cabin camera
    const ohZ = -0.5, oh = new THREE.Group(); oh.position.set(0, yWind(ohZ) - 0.03, ohZ); oh.rotation.x = -WIND_A; chassis.add(oh);
    addC(RB(0.36, 0.03, 0.28, 0.01, 1), im.gloss, 0, 0, 0, 0, 0, 0, oh, true);
    const ohBtn = (x, w, name, action, text) => hit(multi([[RB(w, 0.008, 0.03, 0.003, 1), im.dash], [label(name, 0.02, 0.01), im.label, new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, -0.0045, 0)]], oh, x, -0.019, 0), action, text, [0, 1, 0]);
    ohBtn(-0.13, 0.05, 'hazard', 'hazard', 'Hazard lights');
    ['P', 'R', 'N', 'D'].forEach((g, i) => ohBtn(-0.04 + i * 0.05, 0.042, g, 'gear:' + g, { P: 'Park', R: 'Reverse', N: 'Neutral', D: 'Drive' }[g]));
    for (const [s, key] of [[-1, 'L'], [1, 'R']]) {
      const mat = key === 'L' ? L.domeL : L.domeR;
      hit(addL(new THREE.CylinderGeometry(0.014, 0.014, 0.005, 16), mat, s * 0.15, -0.0165, 0.1, 0, 0, 0, oh), 'dome:' + key, 'Reading light');
      const pl = new THREE.PointLight(0xfff1d6, 0, 2.6, 2); pl.position.set(s * 0.15, -0.06, 0.1); oh.add(pl);
      mkAnim('dome:' + key, 5).apply = (k) => { mat.emissiveIntensity = k * 2.5; pl.intensity = k * 2; };
    }
    addC(new THREE.CylinderGeometry(0.008, 0.008, 0.004, 12), camMat, 0, -0.016, -0.12, 0, 0, 0, oh, true);
    // rear-view mirror (frameless) on a short stem, angled to the driver
    const mz = -0.64;
    addC(BX(0.022, 0.05, 0.022), M.black, 0, yWind(mz) - 0.04, mz - 0.01);
    const mirG = new THREE.Group(); mirG.position.set(0, yWind(mz) - 0.075, mz); mirG.rotation.set(-0.08, -0.26, 0); chassis.add(mirG);
    addC(RB(0.26, 0.075, 0.022, 0.008, 1), M.black, 0, 0, 0, 0, 0, 0, mirG, true);
    addC(new THREE.PlaneGeometry(0.248, 0.062), rvGlass, 0, 0, 0.0115, 0, 0, 0, mirG, true);
    // sun visors, hinged at the header, flipping down over the windshield
    for (const [s, key] of [[-1, 'L'], [1, 'R']]) {
      const vz = -0.42, v = new THREE.Group(); v.position.set(s * 0.42, yWind(vz) - 0.05, vz); v.rotation.x = -WIND_A; chassis.add(v);
      hit(multi([[RB(0.36, 0.014, 0.16, 0.006, 1), im.head, T4(0, 0, 0.085)], [BX(0.12, 0.002, 0.08), M.seam, T4(0, -0.0075, 0.09)]], v), 'visor:' + key, 'Sun visor');
      mkAnim('visor:' + key, 3).apply = (k) => { v.rotation.x = -WIND_A + k * 1.55; };
    }

    // ---- rear cab wall: window frame, upholstery; the vault: floor, tubs, L-track, tonneau rails and canister
    for (const [w, h, x, y] of [[1.26, 0.03, 0, 1.455], [1.26, 0.03, 0, 1.005], [0.03, 0.48, -0.615, 1.23], [0.03, 0.48, 0.615, 1.23]]) addC(BX(w, h, 0.03), im.pillar, x, y, 1.085);
    addC(BX(1.7, 0.5, 0.02), im.fabric, 0, 0.75, 1.085);
    addC(BX(1.72, 0.04, 1.7), im.bed, 0, TG.y0 - 0.02, 1.97);
    for (const s of [-1, 1]) {
      addC(RB(0.2, 0.34, 1.1, 0.04), im.bed, s * 0.68, TG.y0 + 0.17, AR);
      addC(BX(0.035, 0.03, 1.58), im.alu, s * 0.75, 0.9, 1.95);
      for (let i = 0; i < 14; i++) addC(BX(0.012, 0.014, 0.02), M.seam, s * 0.731, 0.9, 1.2 + i * 0.11);
      const sx0 = xTop(RG2) - SAIL_W - 0.03, sx1 = xTop(ZR) - SAIL_W - 0.03;
      beam([s * sx0, yTop(RG2) - 0.03, RG2 + 0.02], [s * sx1, yTop(ZR) - 0.03, ZR - 0.02], 0.03, 0.02, im.alu, chassis, [0, 1, 0]);
    }
    addC(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 16), im.bed, 0, yTop(RG2 + 0.14) - 0.1, RG2 + 0.14, 0, 0, Math.PI / 2);
    // frunk tub
    addC(BX(1.12, 0.03, 1.12), im.carpet, 0, 0.74, (ZF + 0.12 + ZC) / 2 - 0.02);
    for (const s of [-1, 1]) addC(BX(0.03, 0.36, 1.12), im.carpet, s * 0.56, 0.91, (ZF + 0.12 + ZC) / 2 - 0.02);
    addC(BX(1.12, 0.36, 0.03), im.carpet, 0, 0.91, ZF + 0.16);
    addC(BX(1.12, 0.36, 0.03), im.carpet, 0, 0.91, ZC - 0.1);
    // tailgate lettering (outer face)
    addC(label('CYBERTRUCK', 0.8, 0.1), im.label, 0, 0.83, ZR + 0.003, 0, 0, 0, tgP);
    // the motorised tonneau: its own mesh over the vault that rolls forward into the canister
    {
      const TP = new Parts(); TP.face('t', 'tonneau', PL.top, [[-xTop(RG2) + SAIL_W + 0.012, RG2], [xTop(RG2) - SAIL_W - 0.012, RG2], [xTop(ZR) - SAIL_W - 0.012, ZR], [-xTop(ZR) + SAIL_W + 0.012, ZR]]);
      const tg = TP.geometry('t', new THREE.Vector3()).outer;
      const O = PL.top.map(0, RG2), O2 = PL.top.map(0, RG2 + 0.1), N = new THREE.Vector3(...PL.top.n);
      const Zv = new THREE.Vector3(O2[0] - O[0], O2[1] - O[1], O2[2] - O[2]).normalize(), Xv = new THREE.Vector3().crossVectors(N, Zv).normalize();
      const B = new THREE.Matrix4().makeBasis(Xv, N, Zv).setPosition(O[0], O[1], O[2]);
      tg.applyMatrix4(B.clone().invert());
      const ton = new THREE.Mesh(tg, M.tonneau); ton.quaternion.setFromRotationMatrix(B); ton.position.set(O[0], O[1] + 0.002, O[2]); ton.castShadow = true; chassis.add(ton);
      body.mesh.material[TON_I] = M.none;
      mkAnim('tonneau', 0.5).apply = (k) => { ton.scale.z = Math.max(1 - k, 0.02); };
    }

    // ---- door cards: armrest, pull, release button, window switches, speaker, ambient strip, map pocket; the sliding glass
    for (const [k, d] of Object.entries(doors)) {
      if (k === 'frunk' || k === 'trunk') continue;
      const s = k.endsWith('L') ? -1 : 1, front = k.startsWith('F'), grp = d.grp;
      const z0 = front ? DF0 + 0.05 : DB + 0.07, z1 = front ? DB - 0.07 : DR1 - 0.05, zc = (z0 + z1) / 2, zl = z1 - z0, zf = z0 + (front ? 0.16 : 0.1);
      addC(RB(0.06, 0.64, zl, 0.02, 1), im.dash, s * 0.915, 0.83, zc, 0, 0, 0, grp);
      addC(RB(0.04, 0.15, zl * 0.96, 0.015, 1), im.leather, s * 0.9, 1.13, zc, 0, 0, s * 0.42, grp);
      addC(BX(0.006, 0.006, zl * 0.92), L.ambient, s * 0.884, 1.045, zc, 0, 0, 0, grp);
      addC(BX(0.02, 0.085, zl * 0.88), im.fabric, s * 0.882, 0.99, zc, 0, 0, 0, grp);
      addC(RB(0.12, 0.045, zl * 0.6, 0.015, 1), im.leather, s * 0.845, 0.9, zc + 0.05, 0, 0, 0, grp);
      addC(BX(zl * 0.56, 0.003, 0.003), im.stitch, s * 0.8, 0.923, zc + 0.05, 0, Math.PI / 2, 0, grp);
      addC(RB(0.03, 0.17, 0.035, 0.01, 1), im.alu, s * 0.86, 0.99, zf, 0, 0, 0, grp);
      addC(BX(0.004, 0.18, 0.24), im.grille, s * 0.884, 0.68, zc + 0.12, 0, 0, 0, grp);
      addC(new THREE.CylinderGeometry(0.018, 0.018, 0.004, 16), im.grille, s * 0.884, 1.17, z0 + 0.06, 0, 0, Math.PI / 2, grp);
      addC(RB(0.05, 0.14, zl * 0.62, 0.015, 1), im.dash, s * 0.872, 0.6, zc, 0, 0, 0, grp);
      addC(BX(0.012, 0.016, zl * 0.6), M.seam, s * 0.85, 0.668, zc, 0, 0, 0, grp);
      hit(addL(RB(0.022, 0.014, 0.05, 0.005, 1), im.alu, s * 0.878 - grp.position.x, 1.095, zf - grp.position.z, 0, 0, s * 0.42, grp), k, 'Open door', [s, 0, 0]);
      (k === 'FL' ? ['FL', 'FR', 'RL', 'RR'] : [k]).forEach((w, i) => hit(addL(RB(0.018, 0.009, 0.03, 0.003, 1), im.gloss, s * 0.825 - grp.position.x, 0.927, zc - 0.2 + i * 0.045 - grp.position.z, 0, 0, 0, grp), 'win:' + w, 'Window', [0, -1, 0]));
      // the glass: a pane in the plane of the window that shrinks toward the sill as it drops into the door
      const win = front ? G.fgl : G.rgl, PP = new Parts(); PP.face('pR', 'glass', PL.up, win, [], 'pL');
      const pg = PP.geometry(s < 0 ? 'pL' : 'pR', new THREE.Vector3()).outer;
      const up = s < 0 ? upL : PL.up, zm = (win[0][0] + win[1][0]) / 2, ym = (win[0][1] + win[1][1]) / 2;
      const O = up.map(zm, ym), O2 = up.map(zm, ym + 0.1), N = new THREE.Vector3(...up.n);
      const Yv = new THREE.Vector3(O2[0] - O[0], O2[1] - O[1], O2[2] - O[2]).normalize(), Xv = new THREE.Vector3().crossVectors(Yv, N).normalize();
      const B = new THREE.Matrix4().makeBasis(Xv, Yv, N).setPosition(O[0], O[1], O[2]);
      pg.applyMatrix4(B.clone().invert());
      const pane = new THREE.Mesh(pg, M.glass); pane.quaternion.setFromRotationMatrix(B); pane.position.set(O[0] - grp.position.x, O[1] - grp.position.y, O[2] - grp.position.z); pane.visible = false; grp.add(pane);
      mkAnim('win:' + k, 0.5).apply = (kk, raw) => { const open = raw > 0.002; pane.visible = open && raw < 0.999; pane.scale.y = Math.max(1 - kk, 0.001); d.mesh.material[GLASS_I] = open ? M.none : M.glass; };
    }
    mkAnim('mirrorFold', 1.6).apply = (k) => { for (const m of mirrors) m.grp.rotation.y = -m.s * k * 1.25; };
  }
  flushBatch();

  // headlight spots
  const spots = [];
  if (!viz) {
    for (const s of [-1, 1]) {
      const sp = new THREE.SpotLight(0xf4f6ff, 0, 95, 0.42, 0.55, 1.4);
      sp.position.set(s * 0.62, 1.05, ZF - 0.03);
      sp.target.position.set(s * 0.9, 0, -28);
      chassis.add(sp, sp.target);
      spots.push(sp);
    }
  }

  const car = {
    root, chassis, doors, wheels, steeringSpin, screenMesh, lights: L, spots, interact, mats: M, chargeFlap,
    setPaint(c) {
      M.paint.color.setHex(c); M.paintLo.color.setHex(c);
      const f = FINISH[c]; if (!f || viz) return;
      M.paint.metalness = f.metalness; M.paint.roughness = f.roughness; M.paint.clearcoat = f.clearcoat; M.paint.anisotropy = f.brushed ? 0.35 : 0;
      M.paintLo.metalness = f.metalness - 0.04; M.paintLo.roughness = Math.min(1, f.roughness + 0.12); M.paintLo.clearcoat = f.clearcoat * 0.8; M.paintLo.anisotropy = f.brushed ? 0.3 : 0;
      const map = f.brushed ? M.paint.userData.brushed : null;
      for (const m of [M.paint, M.paintLo]) if (m.roughnessMap !== map) { m.roughnessMap = map; m.needsUpdate = true; }
    },
    toggle(name) { const d = doors[name]; if (!d) return false; d.target = d.target > 0.5 ? 0 : 1; return d.target > 0.5; },
    isOpen(name) { return doors[name].target > 0.5; },
    anyDoorOpen() { return ['FL', 'FR', 'RL', 'RR'].some((k) => doors[k].cur > 0.02 || doors[k].target > 0.5); },
    chargeOpen: 0, chargeTarget: 0,
    // every interior click lands here: the part animates; true = handled in the model, false = the game acts on it
    press(action) {
      const list = buttons.get(action); if (list) for (const b of list) b.t = 1;
      const a = anim[action];
      if (a) { a.target = a.target > 0.5 ? 0 : 1; return true; }
      if (action === 'voice') return true;
      if (I && (action === 'volUp' || action === 'volDown')) I.scrollKick += action === 'volUp' ? -0.9 : 0.9;
      return false;
    },
    update(dt, st) {
      for (const d of Object.values(doors)) {
        d.cur += clamp(d.target - d.cur, -d.speed * dt, d.speed * dt);
        const a = smooth(d.cur) * d.max;
        if (d.axis === 'y') d.grp.rotation.y = a; else d.grp.rotation.x = a;
      }
      this.chargeOpen += clamp(this.chargeTarget - this.chargeOpen, -3 * dt, 3 * dt);
      chargeFlap.rotation.y = -smooth(this.chargeOpen) * 1.7;
      for (const a of Object.values(anim)) { a.cur += clamp(a.target - a.cur, -a.speed * dt, a.speed * dt); if (a.apply) a.apply(smooth(a.cur), a.cur); }
      for (const list of buttons.values()) for (const b of list) if (b.t > 0) { b.t = Math.max(0, b.t - dt * 6); b.obj.position.copy(b.base).addScaledVector(b.dir, Math.sin(b.t * Math.PI) * 0.0035); }
      if (!st) return;
      // wheels: spin + Ackermann steering
      const R = Math.abs(st.steer) > 1e-4 ? WB / Math.tan(st.steer) : 1e9;
      for (const w of wheels) {
        w.spin.rotation.x -= (st.v * dt) / WR;
        if (w.front) {
          const ang = Math.abs(R) > 1e8 ? 0 : Math.atan(WB / (R - w.side * TRK));
          w.pivot.rotation.y = -ang;
        }
      }
      // steer-by-wire: about 170 degrees of wheel at full lock
      if (steeringSpin) steeringSpin.rotation.z += (-st.steer * 5 - steeringSpin.rotation.z) * Math.min(1, dt * 14);
      chassis.rotation.x = lerp(chassis.rotation.x, clamp((st.accel || 0) * 0.004, -0.028, 0.028), Math.min(1, dt * 5));
      chassis.rotation.z = lerp(chassis.rotation.z, clamp((st.latAcc || 0) * 0.005, -0.03, 0.03), Math.min(1, dt * 5));
      chassis.position.y = lerp(chassis.position.y, Math.abs(st.v) > 0.5 ? Math.sin(st.dist * 1.7) * 0.0025 : 0, Math.min(1, dt * 6));
      // lights
      const blink = st.blinkOn;
      L.sigFL.emissiveIntensity = L.sigRL.emissiveIntensity = (st.signal === 'L' || st.hazard) && blink ? 4 : 0;
      L.sigFR.emissiveIntensity = L.sigRR.emissiveIntensity = (st.signal === 'R' || st.hazard) && blink ? 4 : 0;
      L.head.emissiveIntensity = st.headlights ? 5 : 0;
      L.fog.emissiveIntensity = st.headlights ? 3 : 0;
      for (const sp of spots) sp.intensity = st.headlights ? 1800 : 0;
      L.tail.emissiveIntensity = st.braking ? 5.5 : st.headlights ? 1.6 : 0.4;
      L.rev.emissiveIntensity = st.gear === 'R' ? 4 : 0;
      L.drl.emissiveIntensity = st.awake ? 2.4 : 0.15;
      L.ambient.emissiveIntensity = st.awake ? 0.6 + st.night * 1.6 : 0;
      L.port.emissiveIntensity = this.chargeOpen > 0.5 ? (st.charging ? 2 + Math.sin(st.time * 3) * 1.2 : 1.5) : 0;
      L.port.emissive.setHex(st.charging ? 0x22ff66 : 0x3d8bff);
      if (!I) return;
      L.fsd.emissiveIntensity = st.fsd ? 2.5 : 0;
      L.foot.emissiveIntensity = st.awake ? 0.6 + st.night * 1.4 : 0;
      I.label.emissiveIntensity = st.awake ? 0.25 + st.night * 0.9 : 0.05;
      // the wiper sweeps while st.wipers is on and always finishes its stroke back at the park position
      const wp = I.wipPhase;
      if (st.wipers || wp % 1 > 1e-4) { let n = wp + dt * 0.75; if (!st.wipers && Math.floor(n) > Math.floor(wp)) n = Math.floor(n); I.wipPhase = n; }
      if (wiper) wiper.rotation.z = -(1 - Math.cos(I.wipPhase * Math.PI * 2)) * 0.5 * 1.3;
      // the left scroll wheel shows the volume, with a kick when it is rolled
      I.scrollKick *= Math.max(0, 1 - dt * 4);
      const tgt = -(st.volume || 0) * 5 + I.scrollKick; I.scrollL.rotation.x += (tgt - I.scrollL.rotation.x) * Math.min(1, dt * 10);
      // metallic interior bits and the lower panels borrow the paint's reflection map (assigned by the game after the build)
      if (M.paint.envMap && I.envSync[0].envMap !== M.paint.envMap) for (const m of I.envSync) { m.envMap = M.paint.envMap; m.needsUpdate = true; }
    },
  };
  if (!viz) M.paint.userData.brushed = M.paint.roughnessMap;
  car.setPaint(paint);
  return car;
}
