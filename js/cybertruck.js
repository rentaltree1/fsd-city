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

const MATS = ['paint', 'glass', 'roofglass', 'trim', 'black', 'tonneau', 'seam', 'jamb', 'tint'];
const OPAQUE = ['paint', 'trim', 'black', 'tonneau'];

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
  G.face('body', 'paint', lo, [FC, [zFront(Y_BF), Y_BF], ...archQ(AF, Y_BF, Y_ROCK), [DF0, Y_ROCK], [DF0, yC(DF0)]], [], 'body');
  G.face('FR', 'paint', lo, [[DF0, Y_ROCK], [DB, Y_ROCK], [DB, yC(DB)], [DF0, yC(DF0)]], [], 'FL');
  G.face('RR', 'paint', lo, [[DB, Y_ROCK], [DR1, Y_ROCK], [DR1, yC(DR1)], [DB, yC(DB)]], [], 'RL');
  G.face('body', 'paint', lo, [[DR1, yC(DR1)], [DR1, Y_ROCK], ...archQ(AR, Y_ROCK, Y_BR), [ZR, Y_BR], [ZR, yC(ZR)]], [], 'body');
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
  for (let i = 0; i < 4; i++) sl('trunk', PL.rear, tgr[i], tgr[(i + 1) % 4]);
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

// ---------- textures ----------
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
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}
function tonneauTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 16;
  const g = c.getContext('2d'); g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, 256, 16);
  for (let i = 0; i < 20; i++) { const x = (i * 256) / 20; g.fillStyle = '#5a5a5a'; g.fillRect(x, 0, 1.5, 16); g.fillStyle = '#9a9a9a'; g.fillRect(x + 1.5, 0, 2, 16); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

// ---------- wheels ----------
let wheelCache = null;
function wheelGeos(viz) {
  if (wheelCache && wheelCache.viz === viz) return wheelCache;
  // 35" all-terrain tyre: carcass + staggered tread lugs that wrap onto the shoulder
  const prof = [[0.255, -0.125], [0.3, -0.142], [0.36, -0.148], [0.4, -0.145], [0.42, -0.136], [0.43, -0.118], [0.432, -0.08], [0.432, 0.08], [0.43, 0.118], [0.42, 0.136], [0.4, 0.145], [0.36, 0.148], [0.3, 0.142], [0.255, 0.125]];
  const carcass = new THREE.LatheGeometry(prof.map((p) => new THREE.Vector2(p[0], p[1])), 72).rotateZ(Math.PI / 2);
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
  const tread = lugs.length ? mergeGeometries(lugs) : null;
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
      // outer facet ring
      const s0 = pt(0.262, a0, 0.112), s1 = pt(0.262, a1, 0.112);
      push(k === 'blade' ? 'rim' : 'dish', o0, s0, s1); push(k === 'blade' ? 'rim' : 'dish', o0, s1, o1);
    }
    // step walls on both blade edges
    for (const a of [c0 - bw, c0 + bw]) push('dish', pt(R0, a, 0.147), pt(R1, a, 0.132), pt(R1, a, 0.122)), push('dish', pt(R0, a, 0.147), pt(R1, a, 0.122), pt(R0, a, 0.136));
    // hexagonal centre plate with its own facets and a step down to the blades
    const h0 = c0 + step / 2, h1 = h0 + step;
    push('cap', [0.152, 0, 0], pt(R0 * 0.92, h0, 0.15), pt(R0 * 0.92, h1, 0.15));
    push('dish', pt(R0 * 0.92, h0, 0.15), pt(R0, h0, 0.141), pt(R0, h1, 0.141)); push('dish', pt(R0 * 0.92, h0, 0.15), pt(R0, h1, 0.141), pt(R0 * 0.92, h1, 0.15));
  }
  for (let i = 0; i < 24; i++) { const a0 = (i / 24) * Math.PI * 2, a1 = ((i + 1) / 24) * Math.PI * 2; push('dish', pt(0.262, a0, 0.112), pt(0.272, a0, 0.09), pt(0.272, a1, 0.09)); push('dish', pt(0.262, a0, 0.112), pt(0.272, a1, 0.09), pt(0.262, a1, 0.112)); }
  const toGeo = (arr) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); g.computeVertexNormals(); return g; };
  // fix winding so every facet faces outward (+x)
  for (const k of Object.keys(P)) {
    const a = P[k];
    for (let i = 0; i < a.length; i += 9) {
      const A = a.slice(i, i + 3), B = a.slice(i + 3, i + 6), C = a.slice(i + 6, i + 9);
      if (cross(sub(B, A), sub(C, A))[0] < 0) for (let j = 0; j < 3; j++) [a[i + 3 + j], a[i + 6 + j]] = [a[i + 6 + j], a[i + 3 + j]];
    }
  }
  wheelCache = { viz, carcass, tread, blade: toGeo(P.blade), dish: toGeo(P.dish), cap: toGeo(P.cap), rim: toGeo(P.rim) };
  return wheelCache;
}

function wheelAssembly(W, WM, side) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(W.carcass, WM.tire); tire.castShadow = true; g.add(tire);
  if (W.tread) { const t = new THREE.Mesh(W.tread, WM.tread); t.castShadow = true; g.add(t); }
  const face = new THREE.Group(); if (side < 0) face.rotation.y = Math.PI; g.add(face);
  face.add(new THREE.Mesh(W.blade, WM.blade), new THREE.Mesh(W.rim, WM.rim), new THREE.Mesh(W.dish, WM.dish), new THREE.Mesh(W.cap, WM.cap));
  const back = new THREE.Mesh(new THREE.CircleGeometry(0.27, 24), WM.dish); back.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2; back.position.x = -side * 0.1; g.add(back);
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

export function buildCybertruck({ viz = false, paint = CYBER_PAINTS.Stainless } = {}) {
  const root = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(chassis);
  const M = {};
  if (viz) {
    M.paint = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.45, metalness: 0.1, flatShading: true });
    M.trim = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.5, flatShading: true });
    M.black = M.tonneau = M.seam = M.jamb = M.trim;
    M.glass = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.2, transparent: true, opacity: 0.85 });
    M.roofglass = M.tint = M.glass;
    M.inner = new THREE.MeshStandardMaterial({ color: 0x55585e, side: THREE.BackSide });
  } else {
    const br = brushedTexture();
    M.paint = new THREE.MeshPhysicalMaterial({ color: paint, metalness: 0.78, roughness: 0.55, roughnessMap: br, anisotropy: 0.35, envMapIntensity: 1.35 });
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
  }
  const matList = MATS.map((k) => M[k]);
  const G = buildShell(viz);
  const interact = [];
  const mkPart = (key, pivot) => {
    const grp = new THREE.Group(); grp.position.copy(pivot); chassis.add(grp);
    const { outer, inner } = G.geometry(key, pivot);
    const mesh = new THREE.Mesh(outer, matList); mesh.castShadow = true; mesh.receiveShadow = true;
    const im = new THREE.Mesh(inner, M.inner); im.receiveShadow = true;
    grp.add(mesh, im);
    return { grp, mesh };
  };
  mkPart('body', new THREE.Vector3());
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

  // static meshes are batched per (parent, material) and merged at the end
  const batch = new Map();
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), ONE = new THREE.Vector3(1, 1, 1);
  const addC = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, grp = chassis) => {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    const s = new THREE.BufferGeometry();
    for (const a of ['position', 'normal', 'uv']) if (g.attributes[a]) s.setAttribute(a, g.attributes[a]);
    if (!s.attributes.uv) s.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((s.attributes.position.count) * 2), 2));
    tmpE.set(rx, ry, rz); tmpQ.setFromEuler(tmpE);
    tmpM.compose(new THREE.Vector3(x, y, z).sub(grp.position), tmpQ, ONE); s.applyMatrix4(tmpM);
    const key = grp.uuid + mat.uuid;
    if (!batch.has(key)) batch.set(key, { grp, mat, list: [] });
    batch.get(key).list.push(s);
  };
  const addL = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = chassis) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  };
  // box between two points (beams, rails)
  const beam = (a, b, w, h, mat, grp = chassis, upHint = [0, 1, 0]) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length(); d.normalize();
    const up = new THREE.Vector3(...upHint), X = new THREE.Vector3().crossVectors(up, d).normalize(), Y = new THREE.Vector3().crossVectors(d, X);
    const g = new THREE.BoxGeometry(w, h, len).applyMatrix4(new THREE.Matrix4().makeBasis(X, Y, d));
    const c = A.add(B).multiplyScalar(0.5);
    addC(g, mat, c.x, c.y, c.z, 0, 0, 0, grp);
  };
  // place a box flush on a body plane
  const onPlane = (pl, a, b, w, h, d, mat, off = 0, parent = chassis, local = false) => {
    const p = pl.map(a, b), q = pl.map(a, b + 0.01), N = new THREE.Vector3(...pl.n);
    const up = new THREE.Vector3(q[0] - p[0], q[1] - p[1], q[2] - p[2]).normalize(), X = new THREE.Vector3().crossVectors(up, N).normalize();
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, up, N));
    m.position.set(...p).addScaledVector(N, off + d / 2);
    if (local) m.position.sub(parent.position);
    parent.add(m); return m;
  };

  // ---------- lights ----------
  const L = {
    drl: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.2 }),
    head: new THREE.MeshStandardMaterial({ color: 0x9aa4ad, emissive: 0xf4f8ff, emissiveIntensity: 0, roughness: 0.1, metalness: 0.6 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x3a0505, emissive: 0xff1208, emissiveIntensity: 0.4, roughness: 0.2 }),
    sigF: new THREE.MeshStandardMaterial({ color: 0x3a2a05, emissive: 0xffa21a, emissiveIntensity: 0 }),
    sigR: new THREE.MeshStandardMaterial({ color: 0x3a1005, emissive: 0xff5a10, emissiveIntensity: 0 }),
    sigFL: null, sigFR: null,
    rev: new THREE.MeshStandardMaterial({ color: 0x888888, emissive: 0xffffff, emissiveIntensity: 0 }),
    ambient: new THREE.MeshStandardMaterial({ color: 0x223344, emissive: 0x3d8bff, emissiveIntensity: 1.2 }),
    port: new THREE.MeshStandardMaterial({ color: 0x113322, emissive: 0x22ff66, emissiveIntensity: 0 }),
  };
  L.sigFL = L.sigF.clone(); L.sigFR = L.sigF.clone(); L.sigRL = L.sigR.clone(); L.sigRR = L.sigR.clone();
  const housing = viz ? M.trim : new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.08, metalness: 0.3, clearcoat: 1 });
  // full-width front light bar on the leading edge: thin DRL line, headlamp strip, amber ends
  onPlane(PL.front, 0, 1.067, 1.93, 0.044, 0.008, housing, 0.001);
  onPlane(PL.front, 0, 1.079, 1.9, 0.01, 0.004, L.drl, 0.009);
  onPlane(PL.front, 0, 1.061, 1.6, 0.013, 0.004, L.head, 0.009);
  for (const s of [-1, 1]) onPlane(PL.front, s * 0.885, 1.061, 0.13, 0.013, 0.004, s < 0 ? L.sigFL : L.sigFR, 0.009);
  // lower bumper: dark intake slot and the front camera above it
  const fbp = plane((x, y) => [x, y, zFront(Y_BF) + ((Y_BF - y) / (Y_BF - 0.4)) * (ZF + 0.27 - zFront(Y_BF))], [0, -0.3, -1]);
  onPlane(fbp, 0, 0.5, 1.2, 0.045, 0.006, M.seam, 0.0);
  onPlane(fbp, 0, 0.6, 0.03, 0.03, 0.006, housing, 0.0);
  // rear: red bar across the top of the tailgate, corner pieces with the signals
  const tgP = doors.trunk.grp;
  onPlane(PL.rear, 0, 1.206, 1.74, 0.036, 0.008, housing, 0.001, tgP, true);
  onPlane(PL.rear, 0, 1.213, 1.72, 0.011, 0.004, L.tail, 0.009, tgP, true);
  for (const s of [-1, 1]) {
    onPlane(PL.rear, s * 0.72, 1.197, 0.22, 0.008, 0.004, L.rev, 0.009, tgP, true);
    onPlane(PL.rear, s * 0.906, 1.206, 0.068, 0.036, 0.008, housing, 0.001);
    onPlane(PL.rear, s * 0.906, 1.213, 0.064, 0.011, 0.004, L.tail, 0.009);
    onPlane(PL.rear, s * 0.906, 1.197, 0.064, 0.008, 0.004, s < 0 ? L.sigRL : L.sigRR, 0.009);
  }
  // single big wiper parked along the cowl
  if (!viz) onPlane(PL.wind, 0.08, ZC + 0.075, 1.42, 0.022, 0.014, M.trim, 0.002);
  // rear plate in the bumper
  if (!viz) {
    const plateC = document.createElement('canvas'); plateC.width = 256; plateC.height = 128;
    const px = plateC.getContext('2d'); px.fillStyle = '#f4f4f0'; px.fillRect(0, 0, 256, 128); px.fillStyle = '#1b2a6b'; px.font = 'bold 64px Arial'; px.textAlign = 'center'; px.fillText('FSD 26', 128, 88); px.font = '18px Arial'; px.fillText('CALIFORNIA', 128, 26);
    const plateT = new THREE.CanvasTexture(plateC); plateT.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.155), new THREE.MeshStandardMaterial({ map: plateT, roughness: 0.5 }));
    const t = (0.64 - 0.53) / (0.64 - 0.42);
    plate.position.set(0, 0.53, ZR - t * 0.17 + 0.006); plate.rotation.x = Math.atan2(0.17, 0.22); chassis.add(plate);
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
  const recess = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.128, 0.168), M.seam); recess.position.set(-0.001, 0, 0.08); tilt.add(recess);
  const portRing = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.004, 8, 24), L.port); portRing.rotation.y = Math.PI / 2; portRing.position.set(-0.002, 0, 0.08); tilt.add(portRing);
  const portIn = new THREE.Mesh(new THREE.CircleGeometry(0.032, 20), M.trim); portIn.rotation.y = -Math.PI / 2; portIn.position.set(-0.0025, 0, 0.08); tilt.add(portIn);

  // mirrors (small fixed camera-style pods on the front doors), cameras
  const mirGeo = new ConvexGeometry([
    [0.0, -0.035, -0.055], [0.0, 0.04, -0.05], [0.0, -0.035, 0.03], [0.0, 0.045, 0.03],
    [0.16, -0.04, -0.06], [0.17, 0.05, -0.045], [0.16, -0.045, 0.035], [0.17, 0.055, 0.035],
    [0.08, 0.06, -0.06], [0.08, -0.055, -0.07], [0.19, 0.005, -0.03], [0.19, 0.01, 0.03],
  ].map((p) => new THREE.Vector3(...p)));
  const mirGlassMat = viz ? M.glass : new THREE.MeshStandardMaterial({ color: 0x9aa3ab, metalness: 1, roughness: 0.02 });
  for (const s of [-1, 1]) {
    const d = s < 0 ? doors.FL : doors.FR, pv = d.grp.position, z = -1.12, y = yS(z) - 0.035;
    const mg = new THREE.Group(); mg.position.set(s * (xUp(z, y) + 0.045) - pv.x, y + 0.03, z - pv.z); d.grp.add(mg);
    const hous = new THREE.Mesh(mirGeo, M.trim); hous.castShadow = true; if (s < 0) hous.scale.x = -1; mg.add(hous);
    const mgl = new THREE.Mesh(new THREE.PlaneGeometry(0.135, 0.07), mirGlassMat); mgl.position.set(s * 0.09, 0.006, 0.0352); mg.add(mgl);
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.022, 0.05), M.trim); stalk.position.set(-s * 0.04, -0.03, -0.01); stalk.rotation.z = s * 0.45; mg.add(stalk);
    // fender repeater camera and B-pillar camera
    const cam = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.01, 14), M.trim); cam.rotation.z = Math.PI / 2;
    cam.position.set(s * (xLo(-1.42, 0.99) + 0.004), 0.99, -1.42); chassis.add(cam);
    const bc = new THREE.Mesh(new THREE.CircleGeometry(0.011, 14), new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.8, roughness: 0.15 }));
    const bp = PL.up.map(-0.08, 1.38); bc.position.set(s * (bp[0] + 0.004), bp[1], bp[2]); bc.lookAt(s * 3, bp[1] + 1.5, bp[2]); chassis.add(bc);
  }

  // ---------- wheels ----------
  const WM = {
    tire: new THREE.MeshStandardMaterial({ color: 0x1b1b1c, roughness: 0.93 }),
    tread: new THREE.MeshStandardMaterial({ color: 0x202021, roughness: 0.88 }),
    blade: viz ? new THREE.MeshStandardMaterial({ color: 0x8d9196, roughness: 0.4, flatShading: true }) : new THREE.MeshStandardMaterial({ color: 0x8a8e93, roughness: 0.38, metalness: 0.6, flatShading: true }),
    rim: viz ? new THREE.MeshStandardMaterial({ color: 0x6d7176, roughness: 0.4, flatShading: true }) : new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.45, metalness: 0.55, flatShading: true }),
    dish: new THREE.MeshStandardMaterial({ color: 0x1f2022, roughness: 0.6, metalness: 0.3, flatShading: true, side: THREE.DoubleSide }),
    cap: new THREE.MeshStandardMaterial({ color: 0x111112, roughness: 0.3, metalness: 0.4, flatShading: true }),
  };
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
  if (!viz) {
    const im = {
      dash: new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.8 }),
      dashTop: new THREE.MeshStandardMaterial({ color: 0x55555a, roughness: 0.9 }),
      fabric: new THREE.MeshStandardMaterial({ color: 0x5b5955, roughness: 1 }),
      leather: new THREE.MeshStandardMaterial({ color: 0x19191a, roughness: 0.55 }),
      gloss: new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.08, clearcoat: 1 }),
      carpet: new THREE.MeshStandardMaterial({ color: 0x151516, roughness: 1 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x9a9da1, metalness: 0.9, roughness: 0.25 }),
      head: new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.95 }),
      bed: new THREE.MeshStandardMaterial({ color: 0x1e1f21, roughness: 0.75 }),
    };
    const RB = (w, h, d, r = 0.03, s = 2) => new RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
    const BX = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    // dashboard: one long low slab under the windshield, a grey top and a light strip across its face
    const sh = new THREE.Shape();
    [[-1.53, 1.2], [-0.92, 1.088], [-0.86, 1.078], [-0.835, 1.055], [-0.835, 1.02], [-0.855, 0.99], [-0.93, 0.93], [-0.98, 0.8], [-1.12, 0.62], [-1.4, 0.5], [-1.53, 0.5]].forEach((p, i) => (i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1])));
    const dg = new THREE.ExtrudeGeometry(sh, { depth: 1.78, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2 });
    dg.rotateY(-Math.PI / 2); dg.translate(0.89, 0, 0);
    addC(dg, im.dash, 0, 0, 0);
    const dt = new THREE.Shape();
    [[-1.53, 1.218], [-0.92, 1.104], [-0.85, 1.094], [-0.83, 1.084], [-0.86, 1.074], [-1.53, 1.19]].forEach((p, i) => (i ? dt.lineTo(p[0], p[1]) : dt.moveTo(p[0], p[1])));
    const dtg = new THREE.ExtrudeGeometry(dt, { depth: 1.76, bevelEnabled: false }); dtg.rotateY(-Math.PI / 2); dtg.translate(0.88, 0, 0);
    addC(dtg, im.dashTop, 0, 0, 0);
    addC(BX(1.74, 0.006, 0.006), L.ambient, 0, 1.036, -0.836);
    addC(BX(1.7, 0.014, 0.02), M.black, 0, 0.985, -0.85);
    // centre touchscreen (18.5", landscape) on a short stand
    const scr = new THREE.Group(); scr.position.set(0, 1.215, -0.93); scr.rotation.set(-0.2, -0.06, 0); chassis.add(scr);
    addL(RB(0.436, 0.266, 0.022, 0.008, 3), im.gloss, 0, 0, 0, 0, 0, 0, scr);
    screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.25), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    screenMesh.position.z = 0.0115; screenMesh.userData.screen = true; scr.add(screenMesh);
    addL(RB(0.12, 0.1, 0.05, 0.015), im.dash, 0, -0.1, -0.04, 0, 0, 0, scr);
    // squircle steering wheel
    const sw = new THREE.Group(); sw.position.set(EYE.x, 1.1, -0.66); sw.rotation.x = -0.42; chassis.add(sw);
    const spin = new THREE.Group(); sw.add(spin); steeringSpin = spin;
    addL(new THREE.TubeGeometry(new Squircle(0.18, 0.128, 4.2), 160, 0.019, 12, true), im.leather, 0, 0, 0, 0, 0, 0, spin);
    addL(RB(0.13, 0.085, 0.05, 0.022, 3), im.leather, 0, 0, -0.012, 0, 0, 0, spin);
    addL(RB(0.08, 0.045, 0.006, 0.003), im.gloss, 0, 0, 0.014, 0, 0, 0, spin);
    for (const s of [-1, 1]) {
      addL(RB(0.11, 0.036, 0.024, 0.01), im.leather, s * 0.115, 0, -0.008, 0, 0, 0, spin);
      addL(new THREE.CylinderGeometry(0.013, 0.013, 0.014, 16), im.metal, s * 0.11, 0.004, 0.006, 0, 0, Math.PI / 2, spin);
      addL(RB(0.028, 0.012, 0.006, 0.003), im.gloss, s * 0.14, -0.002, 0.006, 0, 0, 0, spin);
    }
    addL(new THREE.CylinderGeometry(0.035, 0.042, 0.26, 16), im.dash, 0, 0, -0.15, Math.PI / 2, 0, 0, sw);
    addL(RB(0.1, 0.085, 0.16, 0.03), im.dash, 0, -0.015, -0.27, 0, 0, 0, sw);
    // seats
    const seat = (x, z) => {
      addC(RB(0.54, 0.13, 0.52, 0.05, 3), im.leather, x, 0.7, z, 0.08);
      for (const s of [-1, 1]) addC(RB(0.08, 0.09, 0.48, 0.03), im.leather, x + s * 0.24, 0.765, z, 0.08);
      addC(RB(0.54, 0.7, 0.13, 0.05, 3), im.leather, x, 1.1, z + 0.36, 0.2);
      for (const s of [-1, 1]) addC(RB(0.08, 0.52, 0.11, 0.03), im.leather, x + s * 0.24, 1.07, z + 0.32, 0.2);
      addC(RB(0.29, 0.19, 0.1, 0.04), im.leather, x, 1.55, z + 0.46, 0.2);
      addC(BX(0.4, 0.2, 0.45), im.carpet, x, 0.56, z);
    };
    seat(EYE.x, -0.36); seat(-EYE.x, -0.36);
    addC(RB(1.6, 0.14, 0.5, 0.05, 3), im.leather, 0, 0.7, 0.66, 0.06);
    addC(RB(1.6, 0.62, 0.13, 0.05, 3), im.leather, 0, 1.06, 0.98, 0.2);
    for (const x of [-0.5, 0, 0.5]) addC(RB(0.26, 0.15, 0.08, 0.03), im.leather, x, 1.42, 1.05, 0.2);
    // console with phone pads, cup holders and armrest; floor, pedals
    addC(RB(0.28, 0.3, 1.0, 0.04, 3), im.dash, 0, 0.63, -0.4);
    addC(BX(0.24, 0.005, 0.3), im.gloss, 0, 0.782, -0.72);
    for (const s of [-1, 1]) addC(new THREE.CylinderGeometry(0.04, 0.04, 0.006, 20), M.black, s * 0.06, 0.781, -0.42);
    addC(RB(0.29, 0.06, 0.36, 0.025), im.leather, 0, 0.8, -0.08);
    addC(BX(1.84, 0.04, 2.52), im.carpet, 0, 0.46, -0.16);
    addC(BX(1.6, 0.04, 0.5), im.carpet, 0, 0.56, -1.3, 0.5);
    addC(BX(0.06, 0.1, 0.02), im.metal, EYE.x - 0.08, 0.62, -1.12, -0.6);
    addC(BX(0.05, 0.16, 0.02), im.metal, EYE.x + 0.1, 0.64, -1.12, -0.6);
    // headliner frame, mirror, camera housing, B-pillar trims, cab rear wall with its window
    const yRoof = (z) => (z < ZA ? yWind(z) : yTop(z));
    const rail = (z0, z1, f) => [[f * (xUp(z0, yRoof(z0)) - 0.032), yRoof(z0) - 0.02, z0], [f * (xUp(z1, yRoof(z1)) - 0.032), yRoof(z1) - 0.02, z1]];
    for (const f of [-1, 1]) {
      const [a0, a1] = rail(ZC + 0.05, ZA, f); beam(a0, a1, 0.045, 0.02, im.head);
      const [b0, b1] = rail(ZA, RG1 + 0.05, f); beam(b0, b1, 0.05, 0.022, im.head);
      const bp0 = [f * (xUp(-0.08, yS(-0.08)) - 0.03), yS(-0.08), -0.08], bp1 = [f * (xUp(-0.08, yTop(-0.08)) - 0.035), yTop(-0.08) - 0.025, -0.08];
      beam(bp0, bp1, 0.04, 0.085, im.head, chassis, [0, 0, 1]);
      // door sills and pillars seen with the doors open (hugging the skin: vertical, then raked above the crease)
      const pillar = (z, y1, d) => {
        beam([f * (xLo(z, 0.5) - 0.06), 0.5, z], [f * (XC - 0.06), yC(z), z], 0.09, d, M.jamb, chassis, [0, 0, 1]);
        beam([f * (XC - 0.06), yC(z), z], [f * (xUp(z, y1) - 0.06), y1, z], 0.09, d, M.jamb, chassis, [0, 0, 1]);
      };
      pillar(DF0 - 0.03, yWind(DF0) - 0.03, 0.06); pillar(DB, yS(DB), 0.08); pillar(DR1 + 0.03, yS(DR1), 0.06);
      beam([f * 0.905, 0.47, DF0], [f * 0.905, 0.47, DR1], 0.1, 0.06, M.jamb);
    }
    addC(BX(1.2, 0.05, 0.1), im.head, 0, Y_APEX - 0.065, ZA + 0.02);
    addC(BX(1.4, 0.05, 0.1), im.head, 0, yTop(RG1) - 0.05, RG1 + 0.03);
    addC(RB(0.13, 0.05, 0.07, 0.02), M.black, 0, yWind(-0.3) - 0.05, -0.31);
    const mzz = -0.7, mirror = addL(RB(0.24, 0.062, 0.024, 0.012), M.black, 0, yWind(mzz) - 0.058, mzz + 0.025, -0.12);
    addL(new THREE.PlaneGeometry(0.226, 0.05), new THREE.MeshStandardMaterial({ color: 0x8c949b, metalness: 1, roughness: 0.02 }), 0, 0, 0.0125, 0, 0, 0, mirror);
    addC(BX(0.022, 0.04, 0.022), M.black, 0, yWind(mzz) - 0.018, mzz);
    // vault: bed floor and wheel tubs; frunk tub
    addC(BX(1.72, 0.04, 1.7), im.bed, 0, TG.y0 - 0.02, 1.97);
    for (const s of [-1, 1]) addC(RB(0.2, 0.34, 1.1, 0.04), im.bed, s * 0.68, TG.y0 + 0.17, AR);
    addC(BX(1.12, 0.03, 1.12), im.carpet, 0, 0.74, (ZF + 0.12 + ZC) / 2 - 0.02);
    for (const s of [-1, 1]) addC(BX(0.03, 0.36, 1.12), im.carpet, s * 0.56, 0.91, (ZF + 0.12 + ZC) / 2 - 0.02);
    addC(BX(1.12, 0.36, 0.03), im.carpet, 0, 0.91, ZF + 0.16);
    addC(BX(1.12, 0.36, 0.03), im.carpet, 0, 0.91, ZC - 0.1);
    // door cards: armrest, ambient strip, pull and the electronic release button
    for (const [k, d] of Object.entries(doors)) {
      if (k === 'frunk' || k === 'trunk') continue;
      const s = k.endsWith('L') ? -1 : 1, front = k.startsWith('F'), grp = d.grp;
      const z0 = front ? DF0 + 0.06 : DB + 0.08, z1 = front ? DB - 0.08 : DR1 - 0.06, zc = (z0 + z1) / 2, zl = z1 - z0;
      addC(RB(0.06, 0.56, zl, 0.02), im.dash, s * 0.915, 0.8, zc, 0, 0, 0, grp);
      addC(RB(0.05, 0.13, zl * 0.95, 0.015), im.leather, s * 0.875, 1.12, zc, 0, 0, s * 0.5, grp);
      addC(RB(0.1, 0.05, zl * 0.5, 0.02), im.leather, s * 0.855, 0.86, zc + (front ? 0.08 : 0), 0, 0, 0, grp);
      addC(BX(0.006, 0.006, zl * 0.9), L.ambient, s * 0.883, 1.06, zc, 0, 0, 0, grp);
      addC(BX(0.02, 0.07, zl * 0.85), im.fabric, s * 0.884, 0.99, zc, 0, 0, 0, grp);
      addC(RB(0.05, 0.12, zl * 0.6, 0.02), im.dash, s * 0.88, 0.62, zc, 0, 0, 0, grp);
      const btn = new THREE.Mesh(RB(0.02, 0.016, 0.05, 0.006), im.metal);
      btn.position.set(s * 0.849 - grp.position.x, 1.105, (front ? -0.62 : 0.4) - grp.position.z); btn.rotation.z = s * 0.5;
      btn.userData.action = k; btn.userData.inside = true; grp.add(btn); interact.push(btn);
    }
    for (const { grp, mat, list } of batch.values()) {
      const m = new THREE.Mesh(mergeGeometries(list), mat); m.castShadow = true; m.receiveShadow = true; grp.add(m);
    }
  }

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
      M.paint.color.setHex(c);
      const f = FINISH[c]; if (!f || viz) return;
      M.paint.metalness = f.metalness; M.paint.roughness = f.roughness; M.paint.clearcoat = f.clearcoat; M.paint.anisotropy = f.brushed ? 0.35 : 0;
      const map = f.brushed ? M.paint.userData.brushed : null;
      if (M.paint.roughnessMap !== map) { M.paint.roughnessMap = map; M.paint.needsUpdate = true; }
    },
    toggle(name) { const d = doors[name]; if (!d) return false; d.target = d.target > 0.5 ? 0 : 1; return d.target > 0.5; },
    isOpen(name) { return doors[name].target > 0.5; },
    anyDoorOpen() { return ['FL', 'FR', 'RL', 'RR'].some((k) => doors[k].cur > 0.02 || doors[k].target > 0.5); },
    chargeOpen: 0, chargeTarget: 0,
    update(dt, st) {
      for (const d of Object.values(doors)) {
        d.cur += clamp(d.target - d.cur, -d.speed * dt, d.speed * dt);
        const a = smooth(d.cur) * d.max;
        if (d.axis === 'y') d.grp.rotation.y = a; else d.grp.rotation.x = a;
      }
      this.chargeOpen += clamp(this.chargeTarget - this.chargeOpen, -3 * dt, 3 * dt);
      chargeFlap.rotation.y = -smooth(this.chargeOpen) * 1.7;
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
      for (const sp of spots) sp.intensity = st.headlights ? 1800 : 0;
      L.tail.emissiveIntensity = st.braking ? 5.5 : st.headlights ? 1.6 : 0.4;
      L.rev.emissiveIntensity = st.gear === 'R' ? 4 : 0;
      L.drl.emissiveIntensity = st.awake ? 2.4 : 0.15;
      L.ambient.emissiveIntensity = st.awake ? 0.6 + st.night * 1.6 : 0;
      L.port.emissiveIntensity = this.chargeOpen > 0.5 ? (st.charging ? 2 + Math.sin(st.time * 3) * 1.2 : 1.5) : 0;
      L.port.emissive.setHex(st.charging ? 0x22ff66 : 0x3d8bff);
    },
  };
  if (!viz) M.paint.userData.brushed = M.paint.roughnessMap;
  car.setPaint(paint);
  return car;
}
