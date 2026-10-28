// Tesla Model Y (Juniper, 2025-2026) built procedurally.
// The body is one smooth lofted skin (4.797 m long, 1.921 m wide, 1.624 m tall, 2.890 m wheelbase):
// cross-sections along z are centripetal Catmull-Rom curves through feature points (rocker, side, shoulder
// crease, beltline, roof rail, roof crown) whose heights and widths come from side- and plan-view profile
// curves. Both ends close smoothly on a pole. Panel shut lines, wheel arches, glass and trim are then cut
// out of the skin exactly by clipping its triangles against scalar fields, so every seam follows its curve
// instead of the grid. Separate pieces: four doors, frunk lid, liftgate and the charge-port flap, each on
// its own pivot. Lamps and trims are conformal decals projected onto the skin.
// Model frame: origin on the ground midway between the axles, forward -z, right +x, up +y.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, smooth } from './config.js';

const LEN = 4.797, Z0 = -LEN / 2, Z1 = LEN / 2;
const zAt = (t) => Z0 + t * LEN;
export const AXLE_F = -1.445, AXLE_R = 1.445, TRACK = 0.818, WHEEL_R = 0.356;
export const EYE = new THREE.Vector3(-0.37, 1.21, 0.13);
export const PAINTS = {
  'Ultra Red': 0x9e1218, 'Quicksilver': 0xb8bbbe, 'Pearl White': 0xe8e8e4, 'Stealth Grey': 0x3b3e42,
  'Diamond Black': 0x0c0c0d, 'Glacier Blue': 0x8ea2b4,
};
// per-paint finish (metal flake, base roughness, clearcoat) keyed by colour
// (Tesla paints are metallic/pearl multi-coats under a deep clearcoat: flake metalness 0.6-0.75, a hard
// clearcoat with ~0.03 roughness; Pearl White is a tri-coat pearl with a soft sheen instead of flake)
const FINISH = {
  0x9e1218: { color: 0xa6111a, metalness: 0.6, roughness: 0.32, clearcoatRoughness: 0.03, sheen: 0.15 },
  0xb8bbbe: { color: 0xb2b6ba, metalness: 0.75, roughness: 0.34, clearcoatRoughness: 0.03, sheen: 0 },
  0xe8e8e4: { color: 0xe7e7e2, metalness: 0.12, roughness: 0.26, clearcoatRoughness: 0.03, sheen: 0.35 },
  0x3b3e42: { color: 0x36383b, metalness: 0.68, roughness: 0.38, clearcoatRoughness: 0.03, sheen: 0 },
  0x0c0c0d: { color: 0x0a0a0b, metalness: 0.62, roughness: 0.3, clearcoatRoughness: 0.025, sheen: 0 },
  0x8ea2b4: { color: 0x8095a7, metalness: 0.66, roughness: 0.32, clearcoatRoughness: 0.03, sheen: 0 },
};

function pchip(pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), n = pts.length;
  const d = [], m = new Array(n);
  for (let k = 0; k < n - 1; k++) d.push((ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k++) {
    if (d[k - 1] * d[k] <= 0) m[k] = 0;
    else { const h0 = xs[k] - xs[k - 1], h1 = xs[k + 1] - xs[k], w1 = 2 * h1 + h0, w2 = h1 + 2 * h0; m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k]); }
  }
  return (t) => {
    t = clamp(t, xs[0], xs[n - 1]);
    let lo = 0, hi = n - 2;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (xs[mid] <= t) lo = mid; else hi = mid - 1; }
    const k = lo, h = xs[k + 1] - xs[k], s = (t - xs[k]) / h, s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * ys[k] + (s3 - 2 * s2 + s) * h * m[k] + (-2 * s3 + 3 * s2) * ys[k + 1] + (s3 - s2) * h * m[k + 1];
  };
}
// Profiles are interpolated over sigma = sqrt(distance from the nearer end), so every curve that closes
// onto the nose or tail pole does so with a vertical tangent (a rounded, not pointed, end).
const sig = (z) => { const d = clamp(z - Z0, 0, LEN), h = LEN / 2; return d <= h ? Math.sqrt(d) : 2 * Math.sqrt(h) - Math.sqrt(LEN - d); };
const F = (pts) => { const f = pchip(pts.map(([z, v]) => [sig(z), v])); return (z) => f(sig(z)); };
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const smax = (a, b, k) => { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return lerp(a, b, h) + k * h * (1 - h); };

// ---- side and plan views (metres; z from the nose tip -2.3985 to the tail tip +2.3985) ----
// half width at the widest point of each section
const DF = (d) => Z0 + d, DR = (d) => Z1 - d; // distances from the nose / tail tips
const fW = F([[Z0, 0], [DF(0.003), 0.16], [DF(0.015), 0.32], [DF(0.04), 0.47], [DF(0.09), 0.612], [DF(0.16), 0.722], [DF(0.25), 0.812], [DF(0.38), 0.882], [DF(0.55), 0.928],
  [DF(0.8), 0.95], [-1.45, 0.953], [-1.1, 0.951], [-0.4, 0.946], [0.3, 0.944], [0.85, 0.947], [1.25, 0.953], [1.6, 0.954], [DR(0.6), 0.944], [DR(0.42), 0.926], [DR(0.28), 0.89], [DR(0.18), 0.838],
  [DR(0.11), 0.765], [DR(0.06), 0.66], [DR(0.03), 0.535], [DR(0.012), 0.365], [DR(0.003), 0.185], [Z1, 0]]);
// underside centre line: chin, 167 mm clearance, diffuser
const fYb = F([[Z0, 0.5], [DF(0.003), 0.44], [DF(0.012), 0.38], [DF(0.035), 0.322], [DF(0.08), 0.278], [DF(0.15), 0.246], [DF(0.25), 0.221], [DF(0.4), 0.2], [DF(0.55), 0.188], [-1.5, 0.172],
  [0, 0.167], [1.5, 0.172], [DR(0.55), 0.19], [DR(0.35), 0.222], [DR(0.2), 0.27], [DR(0.1), 0.33], [DR(0.045), 0.4], [DR(0.015), 0.47], [DR(0.003), 0.55], [Z1, 0.62]]);
// hood centre line: rounded Juniper nose sloping back to the light-bar edge, then a gently rising bonnet
const fHood = F([[Z0, 0.5], [DF(0.002), 0.56], [DF(0.008), 0.62], [DF(0.02), 0.68], [DF(0.042), 0.731], [DF(0.075), 0.77], [DF(0.12), 0.797], [DF(0.19), 0.817],
  [DF(0.26), 0.829], [DF(0.4), 0.849], [DF(0.7), 0.89], [-1.445, 0.927], [-1.2, 0.962], [-1.05, 0.985], [-0.8, 1.02], [-0.5, 1.04]]);
// glass centre line: windshield (extended below the bonnet), panoramic roof, fastback, spoiler lip, tailgate
const fGlass = F([[-1.5, 0.66], [-1.3, 0.82], [-1.15, 0.925], [-1.05, 0.997], [-0.9, 1.112], [-0.7, 1.262], [-0.5, 1.4], [-0.36, 1.488], [-0.2, 1.552],
  [0, 1.596], [0.2, 1.617], [0.4, 1.624], [0.6, 1.62], [0.85, 1.601], [1.1, 1.567], [1.35, 1.513], [1.6, 1.44], [1.8, 1.364], [1.95, 1.291], [2.04, 1.236],
  [2.085, 1.205], [2.112, 1.19], [2.135, 1.184], [2.155, 1.17], [2.185, 1.135], [2.24, 1.08], [2.29, 1.03], [2.33, 0.978], [2.36, 0.918], [2.38, 0.85],
  [2.392, 0.76], [2.397, 0.69], [Z1, 0.62]]);
// shoulder crease: wraps the nose at the light-bar edge, runs along the fenders and doors, wraps the tail
const fSh = F([[Z0, 0.5], [DF(0.004), 0.575], [DF(0.016), 0.648], [DF(0.045), 0.712], [DF(0.1), 0.763], [DF(0.2), 0.802], [DF(0.35), 0.832], [DF(0.7), 0.9],
  [-1.445, 0.952], [-1.2, 0.982], [-1.0, 1.0], [-0.6, 1.018], [0, 1.032], [0.6, 1.049], [1.1, 1.064], [1.445, 1.074], [1.8, 1.077], [DR(0.4), 1.068],
  [DR(0.25), 1.035], [DR(0.15), 1.014], [DR(0.09), 0.988], [DR(0.05), 0.95], [DR(0.024), 0.89], [DR(0.008), 0.8], [Z1, 0.62]]);
// beltline (base of the side glass)
const fBelt = F([[-1.6, 0.86], [-1.25, 0.965], [-1.05, 1.03], [-0.93, 1.06], [-0.6, 1.076], [0, 1.094], [0.6, 1.113], [1.1, 1.131], [1.445, 1.143],
  [1.8, 1.151], [2.05, 1.154], [2.2, 1.145]]);
// roof-rail inset and the plan-view sweep of the glass (windshield corners sit behind its centre)
const fRail = F([[-1.6, 0.8], [-1.05, 0.79], [-0.7, 0.752], [-0.36, 0.71], [0, 0.682], [0.6, 0.668], [1.2, 0.65], [1.7, 0.628], [2.1, 0.61], [2.3, 0.6]]);
const fSweep = (z) => lerp(0.12, -0.1, sstep(-0.15, 1.05, z));
const fCrown = (z) => lerp(lerp(0.03, 0.072, sstep(-0.8, -0.2, z)), 0.04, sstep(1.0, 2.0, z));
const yGlassAt = (x, z) => fGlass(z - fSweep(z) * (x / 0.8) ** 2) - fCrown(z) * (x / 0.72) ** 2;
const yTop = (z) => (z < -0.55 ? smax(fHood(z), fGlass(z), 0.012) : fGlass(z));
// subtle flares around the wheel openings
const RA = 0.415;
const flare = (z, y) => {
  let f = 0;
  for (const az of [AXLE_F, AXLE_R]) { const r = Math.hypot(z - az, y - WHEEL_R); f += Math.exp(-(((r - RA - 0.035) / 0.075) ** 2)) * (az > 0 ? 0.008 : 0.006); }
  return f * sstep(0.12, 0.3, y);
};

// ---- cross-sections ----
// control points (right half, x >= 0) from the bottom centre round to the roof centre
const NCTRL = 14;
const SUBS = [2, 3, 3, 5, 5, 4, 2, 4, 4, 4, 4, 5, 5]; // vertices per segment
const S_IDX = [0]; for (const n of SUBS) S_IDX.push(S_IDX[S_IDX.length - 1] + n);
const NV = S_IDX[S_IDX.length - 1] + 1;
const SEC_ANG = [-90, -62, -42, -22, 0, 14, 27, 36, 45, 55, 64, 73, 82, 90].map((a) => (a * Math.PI) / 180);
function sectionCtrl(z) {
  const W = fW(z), yb = fYb(z), ysh = Math.max(yb + 0.002, fSh(z)), H = ysh - yb, q = clamp(W / 0.95, 0, 1);
  const inset = 0.058 + 0.075 * (1 - sstep(Z0, Z0 + 0.75, z)) + 0.03 * sstep(Z1 - 0.6, Z1, z);
  const xSh = W * (1 - inset * q), x7 = xSh - 0.03 * q;
  const yt = yTop(z);
  // bonnet: crowned from the centre line up to the fender tops
  const hoodEdge = ysh + 0.011 * q;
  const yHood = (x) => (z < -0.5 ? fHood(z) + (hoodEdge - fHood(z)) * clamp(x / Math.max(1e-4, x7), 0, 1) ** 2.4 : -9);
  const x11 = Math.min(fRail(z), x7 * 0.8), x8 = Math.max(x11 + 0.01 * q, xSh - 0.052 * q), x12 = x11 * 0.52;
  const yG = (x) => yGlassAt(x, z);
  let y11 = z < -0.5 ? smax(yHood(x11), yG(x11), 0.01) : yG(x11);
  let y12 = z < -0.5 ? smax(yHood(x12), yG(x12), 0.01) : yG(x12);
  y11 = Math.min(y11, yt - 0.002); y12 = clamp(y12, y11 + 0.0005, yt - 0.0005);
  let y8 = Math.min(fBelt(z), y11 - 0.004);
  if (z < -0.5) y8 = smax(yHood(x8), y8, 0.008);
  y8 = clamp(y8, hoodEdge - 0.005, y11 - 0.001);
  const c8 = [x8, y8], c11 = [x11, y11];
  // side glass: slightly convex between the belt and the rail
  const gl = (f) => { const dx = c11[0] - c8[0], dy = c11[1] - c8[1], l = Math.hypot(dx, dy) || 1; const b = 0.022 * Math.min(1, l / 0.4) * f * (1 - f) * 4; return [c8[0] + dx * f + (dy / l) * b, c8[1] + dy * f - (dx / l) * b]; };
  const c = [
    [0, yb], [W * 0.8, yb], [W * 0.945, yb + 0.05 * H], [W * 0.978, yb + 0.17 * H], [W, yb + 0.55 * H], [W * 0.982, yb + 0.86 * H],
    [xSh, ysh], [x7, hoodEdge], c8, gl(0.36), gl(0.74), c11, [x12, y12], [0, yt],
  ];
  // close to the nose and tail poles the section relaxes into a smooth superellipse, so the creases and
  // tight corners do not converge on the tip as radiating lines
  const w = Math.max(1 - sstep(0, 0.34, z - Z0), 1 - sstep(0, 0.26, Z1 - z));
  if (w > 0) {
    const y4 = c[4][1], ex = 2 / 2.5;
    for (let k = 0; k < NCTRL; k++) {
      const th = SEC_ANG[k], cs = Math.cos(th), sn = Math.sin(th);
      const ex0 = W * Math.abs(cs) ** ex, ey0 = y4 + (th < 0 ? y4 - yb : yt - y4) * Math.sign(sn) * Math.abs(sn) ** ex;
      c[k] = [lerp(c[k][0], ex0, w), lerp(c[k][1], ey0, w)];
    }
  }
  // body side follows the arch flares
  for (let k = 2; k <= 6; k++) c[k][0] += flare(z, c[k][1]);
  return c;
}
// centripetal Catmull-Rom through the control points; returns NV points [x, y]
function sectionPoints(z) {
  const c = sectionCtrl(z), n = c.length, out = [];
  const P = (i) => (i < 0 ? [-c[1][0], c[1][1]] : i >= n ? [-c[n - 2][0], c[n - 2][1]] : c[i]);
  for (let i = 0; i < n - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const tj = (a, b) => Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
    const t0 = 0, t1 = t0 + tj(p0, p1), t2 = t1 + tj(p1, p2), t3 = t2 + tj(p2, p3);
    const ns = SUBS[i];
    for (let j = 0; j < ns; j++) {
      const t = t1 + ((t2 - t1) * j) / ns, r = [0, 0];
      for (let a = 0; a < 2; a++) {
        const A1 = ((t1 - t) * p0[a] + (t - t0) * p1[a]) / (t1 - t0), A2 = ((t2 - t) * p1[a] + (t - t1) * p2[a]) / (t2 - t1), A3 = ((t3 - t) * p2[a] + (t - t2) * p3[a]) / (t3 - t2);
        const B1 = ((t2 - t) * A1 + (t - t0) * A2) / (t2 - t0), B2 = ((t3 - t) * A2 + (t - t1) * A3) / (t3 - t1);
        r[a] = ((t2 - t) * B1 + (t - t1) * B2) / (t2 - t1);
      }
      out.push([Math.max(0, r[0]), r[1]]);
    }
  }
  out.push(c[n - 1]);
  return out;
}
const sOf = (k) => { let i = 0; while (i < SUBS.length - 1 && k >= S_IDX[i + 1]) i++; return i + (k - S_IDX[i]) / SUBS[i]; };

// smooth normals of a ring grid P[i][k] = [x, y, z] (half section, mirrored about x = 0)
function gridNormals(P) {
  const NZ = P.length, sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  return P.map((row, i) => row.map((p, k) => {
    if (i === 0) return [0, 0, -1];
    if (i === NZ - 1) return [0, 0, 1];
    const a = P[i - 1][k], b = P[i + 1][k];
    const c = k === 0 ? [-P[i][1][0], P[i][1][1], p[2]] : P[i][k - 1], d = k === NV - 1 ? [-P[i][NV - 2][0], P[i][NV - 2][1], p[2]] : P[i][k + 1];
    let tz = sub(b, a), tk = sub(d, c);
    if (Math.hypot(...tk) < 1e-7) tk = [0, 1, 0];
    const n = [tk[1] * tz[2] - tk[2] * tz[1], tk[2] * tz[0] - tk[0] * tz[2], tk[0] * tz[1] - tk[1] * tz[0]];
    const l = Math.hypot(...n) || 1;
    return [n[0] / l, n[1] / l, n[2] / l];
  }));
}
// section table for fast inside tests / ray casts against the skin
let secTable = null;
function sectionTable() {
  if (secTable) return secTable;
  const n = 700, zs = [];
  for (let i = 0; i <= n; i++) { const u = i / n; zs.push(zAt(u - 0.62 * Math.sin(2 * Math.PI * u) / (2 * Math.PI))); }
  const secs = zs.map((z, i) => (i === 0 || i === n ? Array.from({ length: NV }, () => [0, fYb(z), z]) : sectionPoints(z).map((p) => [p[0], p[1], z])));
  secTable = { zs, secs, nrm: gridNormals(secs) };
  return secTable;
}
function sectionAt(z) {
  const { zs } = sectionTable();
  let lo = 0, hi = zs.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (zs[m] <= z) lo = m; else hi = m; }
  return { lo, hi, f: (z - zs[lo]) / (zs[hi] - zs[lo]) };
}
// is the point inside the skin? (2D point-in-polygon on the interpolated section)
function insideBody(x, y, z) {
  if (z <= Z0 || z >= Z1) return false;
  const { secs } = sectionTable(), { lo, hi, f } = sectionAt(z), A = secs[lo], B = secs[hi];
  const ax = Math.max(1e-6, Math.abs(x)); // (exactly on the centre plane the closing edge would be ambiguous)
  let inside = false;
  for (let k = 0, m = NV - 1; k < NV; m = k++) {
    const yk = A[k][1] + (B[k][1] - A[k][1]) * f, ym = A[m][1] + (B[m][1] - A[m][1]) * f;
    if ((yk > y) !== (ym > y)) {
      const xk = A[k][0] + (B[k][0] - A[k][0]) * f, xm = A[m][0] + (B[m][0] - A[m][0]) * f;
      if (ax < ((xm - xk) * (y - yk)) / (ym - yk) + xk) inside = !inside;
    }
  }
  return inside;
}
// smooth skin normal at a point on (or very near) the skin
function skinNormal(x, y, z) {
  const { secs, nrm } = sectionTable(), { lo, hi, f } = sectionAt(clamp(z, Z0 + 1e-4, Z1 - 1e-4)), A = secs[lo], B = secs[hi];
  const ax = Math.abs(x);
  let best = 1e9, bk = 0, bt = 0;
  for (let k = 0; k < NV - 1; k++) {
    const x0 = lerp(A[k][0], B[k][0], f), y0 = lerp(A[k][1], B[k][1], f), x1 = lerp(A[k + 1][0], B[k + 1][0], f), y1 = lerp(A[k + 1][1], B[k + 1][1], f);
    const ex = x1 - x0, ey = y1 - y0, l2 = ex * ex + ey * ey || 1e-12, t = clamp(((ax - x0) * ex + (y - y0) * ey) / l2, 0, 1);
    const d = Math.hypot(x0 + ex * t - ax, y0 + ey * t - y);
    if (d < best) { best = d; bk = k; bt = t; }
  }
  const n = [0, 1, 2].map((a) => lerp(lerp(nrm[lo][bk][a], nrm[lo][bk + 1][a], bt), lerp(nrm[hi][bk][a], nrm[hi][bk + 1][a], bt), f));
  const v = new THREE.Vector3(x < 0 ? -n[0] : n[0], n[1], n[2]);
  return v.normalize();
}
// cast from o along unit d until the skin is reached (o must start outside); returns { p, n } or null
function castSkin(o, d, maxT = 1) {
  let t0 = 0, t1 = null;
  const step = 0.02;
  for (let t = step; t <= maxT; t += step) if (insideBody(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t)) { t1 = t; t0 = t - step; break; }
  if (t1 === null) return null;
  for (let it = 0; it < 15; it++) { const m = (t0 + t1) / 2; if (insideBody(o[0] + d[0] * m, o[1] + d[1] * m, o[2] + d[2] * m)) t1 = m; else t0 = m; }
  const p = new THREE.Vector3(o[0] + d[0] * t1, o[1] + d[1] * t1, o[2] + d[2] * t1);
  return { p, n: skinNormal(p.x, p.y, p.z) };
}
// project a point onto the skin along d (starting `back` metres behind it)
function projectSkin(p, d, back = 0.22) {
  const l = Math.hypot(d[0], d[1], d[2]), D = [d[0] / l, d[1] / l, d[2] / l];
  return castSkin([p[0] - D[0] * back, p[1] - D[1] * back, p[2] - D[2] * back], D, back + 0.6);
}

// ---- feature lines as fast lookups over z ----
let featTab = null;
function feat(z) {
  if (!featTab) {
    const n = 2400, rows = [];
    for (let i = 0; i <= n; i++) { const c = sectionCtrl(Z0 + (LEN * i) / n); rows.push([c[4][0], c[6][1], c[7][0], c[8][0], c[8][1], c[11][0], c[11][1]]); }
    featTab = { n, rows };
  }
  const u = clamp((z - Z0) / LEN, 0, 1) * featTab.n, i = Math.min(featTab.n - 1, Math.floor(u)), f = u - i, a = featTab.rows[i], b = featTab.rows[i + 1];
  return { W: lerp(a[0], b[0], f), ySh: lerp(a[1], b[1], f), x7: lerp(a[2], b[2], f), x8: lerp(a[3], b[3], f), y8: lerp(a[4], b[4], f), x11: lerp(a[5], b[5], f), y11: lerp(a[6], b[6], f) };
}
// one column of the feature table without allocating: 0 W, 1 ySh, 2 x7, 3 x8, 4 y8, 5 x11, 6 y11
function FT(z, c) {
  if (!featTab) feat(0);
  const u = clamp((z - Z0) / LEN, 0, 1) * featTab.n, i = Math.min(featTab.n - 1, Math.floor(u)), f = u - i;
  return featTab.rows[i][c] + (featTab.rows[i + 1][c] - featTab.rows[i][c]) * f;
}
// panel layout (side view, metres)
const GAP = 0.0045;
const L = {
  zDF: -0.985, zDR: 0.3, zRR: 1.085, RRD: 0.47, yDB: 0.235, zBF: 0.252, zBR: 0.346, zDv0: 1.058, zLT: 1.215, yLB: 0.742,
  zHdr0: -0.378, zHdr1: -0.318, zRG1: 2.072, cp: { z: 2.105, y: 0.896, hz: 0.062, hy: 0.046, r: 0.02 },
};
L.zDv1 = L.zRR;
const yKick = (z) => FT(z, 4) + Math.max(0, z - 1.2) ** 2 * 2.7;
const yAp = (z) => FT(z - 0.058, 6); // A-pillar trailing edge (the side window's front edge)
const archR = (az, y, z) => Math.hypot(z - az, y - WHEEL_R);
const xHS = (z) => FT(z, 2) - 0.05;
const zHF = (x) => -2.252 + 0.2 * Math.min(1, Math.abs(x) / 0.82) ** 2.6;
let zCowlF = null;
function zCowl(x) {
  if (!zCowlF) { // where the windshield rises out of the bonnet
    const pts = [];
    for (let i = 0; i <= 18; i++) {
      const xx = (0.86 * i) / 18;
      let lo = -1.4, hi = -0.6;
      for (let it = 0; it < 40; it++) {
        const m = (lo + hi) / 2, f = feat(m), yh = fHood(m) + (f.ySh + 0.011 - fHood(m)) * clamp(xx / f.x7, 0, 1) ** 2.4;
        if (yGlassAt(xx, m) > yh) hi = m; else lo = m;
      }
      pts.push([xx, (lo + hi) / 2]);
    }
    zCowlF = pchip(pts);
  }
  return zCowlF(Math.abs(x));
}
const zHR = (x) => zCowl(x) - 0.03;
const xLift = (z) => lerp(FT(z, 5) - 0.014, 0.585, sstep(1.95, 2.2, z));
const fHoodF = (x, y, z) => Math.min(xHS(z) - x, z - zHF(x), zHR(x) - z);
const fLiftF = (x, y, z) => Math.min(z - L.zLT, xLift(z) - x, y - L.yLB);
const fRearDoor = (x, y, z) => Math.min(L.zRR - z, archR(AXLE_R, y, z) - L.RRD);
const sdBox2 = (px, py, hx, hy, r) => { const qx = Math.abs(px) - hx + r, qy = Math.abs(py) - hy + r; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; };
const fFlap = (x, y, z) => sdBox2(z - L.cp.z, y - L.cp.y, L.cp.hz, L.cp.hy, L.cp.r);

const CL = {};
// classify a point of the skin: null = hole (wheel arch), 'gap' = shut-line gap, else { part, mat }
function classify(x, y, z, s, side) {
  const sideZone = s < 10.95 && x > 0.45;
  if (s < 7.2 && x > 0.46 && (archR(AXLE_F, y, z) < RA || archR(AXLE_R, y, z) < RA)) return null;
  const g2 = GAP / 2, y8 = FT(z, 4), y11 = FT(z, 6);
  // ---- parts ----
  let part = 'body';
  if (side < 0 && sideZone && z > 1.9 && z < 2.3 && y > 0.8 && y < 1.08) { const v = fFlap(x, y, z); if (Math.abs(v) < g2) return 'gap'; if (v < 0) part = 'flap'; }
  if (part === 'body' && s > 5.5 && z < -0.85) { const v = fHoodF(x, y, z); if (Math.abs(v) < g2) return 'gap'; if (v > 0) part = 'hood'; }
  if (part === 'body' && z > 1.1 && s > 2) { const v = fLiftF(x, y, z); if (Math.abs(v) < g2) return 'gap'; if (v > 0) part = 'lift'; }
  if (part === 'body' && sideZone && z > L.zDF - 0.05 && z < L.zRR + 0.05) {
    const skinTop = y < y8, inGlass = y >= y8 && y < y11 - 0.03 && y < yAp(z);
    if (y < y8 + 0.004 && y > L.yDB - g2) {
      // door skins (below the belt): front edge, the shut line between doors, rear edge round the arch, sills
      if (Math.abs(z - L.zDF) < g2 || Math.abs(z - L.zDR) < g2 || Math.abs(fRearDoor(x, y, z)) < g2) { if (skinTop || y < y8 + 0.004) return 'gap'; }
      if (z > L.zDF && fRearDoor(x, y, z) > 0 && Math.abs(y - L.yDB) < g2) return 'gap';
    }
    if (y >= y8 && y < y8 + GAP && ((z > L.zDF && z < L.zBF && y >= yAp(z)) || (z > L.zBF && z < L.zBR))) return 'gap';
    if (z > L.zDF && z < L.zDR && y > L.yDB && (skinTop || (inGlass && z < L.zBF))) part = 'doorF';
    else if (z > L.zDR && fRearDoor(x, y, z) > 0 && y > L.yDB && skinTop) part = 'doorR';
    else if (z > L.zBR && z < L.zDv1 && y >= y8 && y < y11 - 0.03) part = 'doorR';
  }
  // ---- materials ----
  let mat = 'paint';
  if (s < 1.02 && y < 0.3) mat = 'black';
  else if (z < -1.8 && y < 0.29 && s < 7) mat = 'black';
  else if (z > 1.85 && y < 0.4 && s < 7) mat = 'black';
  else if (s < 4 && y < 0.225 && z > -1.1 && z < 1.1) mat = 'black';
  if (s >= 9.5) {
    // roof: windshield, header bar, panoramic glass, rear glass, cowl strip
    const zc = z < -0.75 ? zCowl(x) : -9, x11 = FT(z, 5);
    if (z > zc - 0.03 + g2 && z < zc && x < xHS(z)) mat = 'trim';
    else if (z >= zc && z < L.zHdr0 && x < x11 - 0.024) mat = 'glass';
    else if (z >= L.zHdr0 && z < L.zHdr1 && x < x11 - 0.012) mat = 'trim';
    else if (z >= L.zHdr1 && z < L.zLT - g2 && x < x11 - 0.03) mat = 'roofglass';
    else if (z > L.zLT + g2 && z < L.zRG1 && x < x11 - 0.03) mat = 'roofglass';
  }
  if (sideZone && y > y8 - 0.013 && z > -1.0 && z < 1.75) {
    const dloTop = y11 - 0.03;
    if (y < y8) { if ((z > -0.9 && z < 1.6 && part !== 'body') || (z >= L.zRR && z < 1.6)) mat = 'trim'; } // belt mouldings
    else if (y < y11 - 0.012) {
      const ap = yAp(z);
      if (z > L.zBF && z < L.zBR) mat = 'trim';
      else if (z > L.zDv0 && z < L.zDv1) mat = y < dloTop ? 'trim' : 'trim';
      else if (z >= L.zDv1) {
        const k = yKick(z);
        if (y < dloTop && y > k) mat = 'glass';
        else if (y > k - 0.012 && y < dloTop + 0.018) mat = 'trim';
      } else if (y < dloTop && y < ap) mat = 'glass';
      else if (y < ap + 0.012 && y < dloTop + 0.018) mat = 'trim';
      else if (y >= dloTop && y < ap) mat = 'trim';
    }
  }
  return CL[part + mat] ||= { part, mat };
}

// clip fields: [f(x, y, z, s, side), domain(x, y, z, s, side)] — triangles straddling a zero set are split on it
const FIELDS = [
  [(x, y, z) => archR(AXLE_F, y, z) - RA, (x, y, z, s) => s < 7.6 && Math.abs(z - AXLE_F) < 0.5 && y < 0.85],
  [(x, y, z) => archR(AXLE_R, y, z) - RA, (x, y, z, s) => s < 7.6 && Math.abs(z - AXLE_R) < 0.5 && y < 0.85],
  [(x) => x - 0.46, (x, y, z, s) => s < 1.5 && (Math.abs(z - AXLE_F) < 0.45 || Math.abs(z - AXLE_R) < 0.45)],
  [(x, y, z) => z - L.zDF - GAP / 2, (x, y, z, s) => s < 11 && y < 1.15 && Math.abs(z - L.zDF) < 0.08, true],
  [(x, y, z) => z - L.zDF + GAP / 2, (x, y, z, s) => s < 11 && y < 1.15 && Math.abs(z - L.zDF) < 0.08, true],
  [(x, y, z) => z - L.zDR - GAP / 2, (x, y, z, s) => s < 11 && y < 1.15 && Math.abs(z - L.zDR) < 0.08, true],
  [(x, y, z) => z - L.zDR + GAP / 2, (x, y, z, s) => s < 11 && y < 1.15 && Math.abs(z - L.zDR) < 0.08, true],
  [(x, y, z) => fRearDoor(x, y, z) - GAP / 2, (x, y, z, s) => s < 11 && y < 1.15 && z > 0.9 && z < 1.2, true],
  [(x, y, z) => fRearDoor(x, y, z) + GAP / 2, (x, y, z, s) => s < 11 && y < 1.15 && z > 0.9 && z < 1.2, true],
  [(x, y, z) => y - L.yDB - GAP / 2, (x, y, z, s) => s < 7 && y < 0.3 && z > -1.05 && z < 1.15, true],
  [(x, y, z) => y - L.yDB + GAP / 2, (x, y, z, s) => s < 7 && y < 0.3 && z > -1.05 && z < 1.15, true],
  [(x, y, z) => y - FT(z, 4), (x, y, z, s) => s > 4.5 && s < 11 && x > 0.45 && z > -1.05 && z < 2.1],
  [(x, y, z) => y - FT(z, 4) - GAP, (x, y, z, s) => s > 4.5 && s < 11 && x > 0.45 && ((z > -1.05 && z < -0.55) || (z > 0.2 && z < 0.4)), true],
  [(x, y, z) => y - FT(z, 4) + 0.013, (x, y, z, s) => s > 4.5 && s < 11 && x > 0.45 && z > -1.05 && z < 1.7],
  [(x, y, z) => z + 0.9, (x, y, z, s) => s > 4.5 && s < 11 && x > 0.45 && y > 0.95 && Math.abs(z + 0.9) < 0.06],
  [(x, y, z) => y - yAp(z), (x, y, z, s) => s > 4.5 && s < 11.5 && x > 0.45 && z > -1.05 && z < -0.1],
  [(x, y, z) => y - yAp(z) - 0.012, (x, y, z, s) => s > 4.5 && s < 11.5 && x > 0.45 && z > -1.05 && z < -0.1],
  [(x, y, z) => y - FT(z, 6) + 0.03, (x, y, z, s) => s > 4.5 && s < 11.5 && x > 0.45 && z > -1.05 && z < 1.75],
  [(x, y, z) => y - FT(z, 6) + 0.012, (x, y, z, s) => s > 4.5 && s < 11.5 && x > 0.45 && z > -1.05 && z < 1.75],
  [(x, y, z) => z - L.zBF, (x, y, z, s) => s > 6 && s < 11.5 && y > 0.95 && Math.abs(z - 0.3) < 0.12],
  [(x, y, z) => z - L.zBR, (x, y, z, s) => s > 6 && s < 11.5 && y > 0.95 && Math.abs(z - 0.3) < 0.12],
  [(x, y, z) => z - L.zDv0, (x, y, z, s) => s > 6 && s < 11.5 && y > 0.95 && Math.abs(z - 1.07) < 0.08],
  [(x, y, z) => z - L.zDv1, (x, y, z, s) => s > 6 && s < 11.5 && y > 0.95 && Math.abs(z - 1.07) < 0.08],
  [(x, y, z) => y - yKick(z), (x, y, z, s) => s > 6 && s < 11.5 && x > 0.45 && z > 1.1 && z < 1.75],
  [(x, y, z) => y - yKick(z) + 0.012, (x, y, z, s) => s > 6 && s < 11.5 && x > 0.45 && z > 1.1 && z < 1.75],
  [(x, y, z) => x - FT(z, 5) + 0.024, (x, y, z, s) => s > 9.5 && z > -1.15 && z < -0.3],
  [(x, y, z) => x - FT(z, 5) + 0.012, (x, y, z, s) => s > 9.5 && z > -0.42 && z < -0.28],
  [(x, y, z) => x - FT(z, 5) + 0.03, (x, y, z, s) => s > 9.5 && z > -0.36 && z < 2.12],
  [(x, y, z) => z - zCowl(x), (x, y, z, s) => s > 6 && z > -1.2 && z < -0.8],
  [(x, y, z) => fHoodF(x, y, z) - GAP / 2, (x, y, z, s) => s > 5.5 && z < -0.85, true],
  [(x, y, z) => fHoodF(x, y, z) + GAP / 2, (x, y, z, s) => s > 5.5 && z < -0.85, true],
  [(x, y, z) => z - L.zHdr0, (x, y, z, s) => s > 9.5 && Math.abs(z - L.zHdr0) < 0.05],
  [(x, y, z) => z - L.zHdr1, (x, y, z, s) => s > 9.5 && Math.abs(z - L.zHdr1) < 0.05],
  [(x, y, z) => fLiftF(x, y, z) - GAP / 2, (x, y, z, s) => s > 2 && z > 1.1, true],
  [(x, y, z) => fLiftF(x, y, z) + GAP / 2, (x, y, z, s) => s > 2 && z > 1.1, true],
  [(x, y, z) => z - L.zRG1, (x, y, z, s) => s > 9.5 && Math.abs(z - L.zRG1) < 0.06],
  [(x, y, z) => y - 0.225, (x, y, z, s) => s < 4.5 && z > -1.15 && z < 1.15 && y < 0.3],
  [(x, y, z) => y - 0.29, (x, y, z, s) => s < 7.5 && z < -1.75 && y < 0.4],
  [(x, y, z) => y - 0.4, (x, y, z, s) => s < 7.5 && z > 1.8 && y < 0.5],
  [(x, y, z) => y - 0.3, (x, y, z, s) => s < 1.3 && (z < -1.9 || z > 1.9) && y < 0.4],
  [(x, y, z) => fFlap(x, y, z) - GAP / 2, (x, y, z, s, side) => side < 0 && s < 11 && x > 0.45 && z > 1.9 && z < 2.3 && y > 0.8 && y < 1.08, true],
  [(x, y, z) => fFlap(x, y, z) + GAP / 2, (x, y, z, s, side) => side < 0 && s < 11 && x > 0.45 && z > 1.9 && z < 2.3 && y > 0.8 && y < 1.08, true],
];

let bodyCache = null;
function buildBodyParts() {
  if (bodyCache) return bodyCache;
  // ring positions: dense near both poles, extra rings at the cowl crease and the spoiler lip
  let zs = [];
  const NR = 224;
  for (let i = 0; i <= NR; i++) { const u = i / NR; zs.push(zAt(u - 0.6 * Math.sin(2 * Math.PI * u) / (2 * Math.PI))); }
  for (let z = -1.13; z <= -0.87; z += 0.011) zs.push(z);
  for (let z = 2.06; z <= 2.2; z += 0.009) zs.push(z);
  zs.sort((a, b) => a - b);
  zs = zs.filter((z, i) => i === 0 || z - zs[i - 1] > 0.0025 || i === zs.length - 1);
  zs[0] = Z0; zs[zs.length - 1] = Z1;
  const NZ = zs.length;
  const P = zs.map((z, i) => (i === 0 || i === NZ - 1 ? Array.from({ length: NV }, () => [0, i === 0 ? fYb(Z0) : fYb(Z1), z]) : sectionPoints(z).map((p) => [p[0], p[1], z])));
  // smooth vertex normals from central differences on the grid
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const N = gridNormals(P);
  const sK = Array.from({ length: NV }, (_, k) => sOf(k));
  const NF = FIELDS.length;
  const mkV = (p, n, s) => ({ p, n, s, fc: new Float64Array(NF).fill(NaN), on: null });
  const fval = (v, j, side) => { let r = v.fc[j]; if (r !== r) { r = v.fc[j] = FIELDS[j][0](Math.abs(v.p[0]), v.p[1], v.p[2], v.s, side); } return r; };
  const interp = (a, b, t, j) => {
    const n = [lerp(a.n[0], b.n[0], t), lerp(a.n[1], b.n[1], t), lerp(a.n[2], b.n[2], t)], l = Math.hypot(...n) || 1;
    const v = mkV([lerp(a.p[0], b.p[0], t), lerp(a.p[1], b.p[1], t), lerp(a.p[2], b.p[2], t)], [n[0] / l, n[1] / l, n[2] / l], lerp(a.s, b.s, t));
    v.fc[j] = 0; v.on = [j, ...(a.on && b.on ? a.on.filter((q) => b.on.includes(q)) : [])];
    return v;
  };
  const area2 = (a, b, c) => { const u = sub(b.p, a.p), w = sub(c.p, a.p); return Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]); };
  const out = [];
  const clipRec = (tri, j, side) => {
    const [a, b, c] = tri;
    const cx = (Math.abs(a.p[0]) + Math.abs(b.p[0]) + Math.abs(c.p[0])) / 3, cy = (a.p[1] + b.p[1] + c.p[1]) / 3, cz = (a.p[2] + b.p[2] + c.p[2]) / 3, cs = (a.s + b.s + c.s) / 3;
    for (; j < NF; j++) {
      if (!FIELDS[j][1](cx, cy, cz, cs, side)) continue;
      const fa = fval(a, j, side), fb = fval(b, j, side), fc = fval(c, j, side);
      const E = 1e-9;
      if ((fa >= -E && fb >= -E && fc >= -E) || (fa <= E && fb <= E && fc <= E)) continue;
      const poly = [[a, fa], [b, fb], [c, fc]], pos = [], neg = [];
      for (let i = 0; i < 3; i++) {
        const [v, fv] = poly[i], [w, fw] = poly[(i + 1) % 3];
        if (fv >= -E) pos.push(v); if (fv <= E) neg.push(v);
        if ((fv > E && fw < -E) || (fv < -E && fw > E)) { const x = interp(v, w, fv / (fv - fw), j); pos.push(x); neg.push(x); }
      }
      for (const pl of [pos, neg]) for (let i = 1; i + 1 < pl.length; i++) { const t = [pl[0], pl[i], pl[i + 1]]; if (area2(...t) > 1e-10) clipRec(t, j + 1, side); }
      return;
    }
    out.push(tri);
  };
  // sort triangles into parts and materials; shut-line edges get a dark return flange
  const MATS = ['paint', 'glass', 'roofglass', 'trim', 'black', 'seam'];
  const parts = {};
  const get = (key) => (parts[key] ||= Object.fromEntries(MATS.map((m) => [m, { p: [], n: [], uv: [] }])));
  const pushV = (bk, v, sx) => { bk.p.push(v.p[0] * sx, v.p[1], v.p[2]); bk.n.push(v.n[0] * sx, v.n[1], v.n[2]); bk.uv.push(v.p[2] / LEN + 0.5, v.s / (NCTRL - 1)); };
  const keyOf = (part, side) => (part === 'doorF' || part === 'doorR' ? part + (side > 0 ? 'R' : 'L') : part);
  const seamField = FIELDS.map((f) => !!f[2]);
  // tri is given in its own side's coordinates; mirror = also emit the mirror image on the other side
  const emit = (tri, side, mirror) => {
    const [a, b, c] = tri;
    const cx = Math.abs(a.p[0] + b.p[0] + c.p[0]) / 3, cy = (a.p[1] + b.p[1] + c.p[1]) / 3, cz = (a.p[2] + b.p[2] + c.p[2]) / 3, cs = (a.s + b.s + c.s) / 3;
    const cl = classify(cx, cy, cz, cs, side);
    if (!cl || cl === 'gap') return;
    const k1 = keyOf(cl.part, side), k2 = keyOf(cl.part, -side);
    let bk = get(k1)[cl.mat]; pushV(bk, a, 1); pushV(bk, b, 1); pushV(bk, c, 1);
    if (mirror) { bk = get(k2)[cl.mat]; pushV(bk, a, -1); pushV(bk, c, -1); pushV(bk, b, -1); }
    if (cl.mat === 'glass' || cl.mat === 'roofglass') return;
    for (let e = 0; e < 3; e++) {
      const p = tri[e], q = tri[(e + 1) % 3], o = tri[(e + 2) % 3];
      if (!p.on || !q.on || !p.on.some((j) => seamField[j] && q.on.includes(j))) continue;
      // step across the edge (perpendicular to it, in the triangle's plane) and check for a gap there
      const mid = [(p.p[0] + q.p[0]) / 2, (p.p[1] + q.p[1]) / 2, (p.p[2] + q.p[2]) / 2], ed = sub(q.p, p.p), el = Math.hypot(...ed) || 1;
      const mo = sub(mid, o.p), along = (mo[0] * ed[0] + mo[1] * ed[1] + mo[2] * ed[2]) / (el * el);
      const dir = [mo[0] - ed[0] * along, mo[1] - ed[1] * along, mo[2] - ed[2] * along], dl = Math.hypot(...dir);
      if (dl < 1e-7) continue;
      const ds = (p.s + q.s) / 2 + (((p.s + q.s) / 2 - o.s) / dl) * 0.0015;
      if (classify(Math.abs(mid[0] + (dir[0] / dl) * 0.0015), mid[1] + (dir[1] / dl) * 0.0015, mid[2] + (dir[2] / dl) * 0.0015, ds, side) !== 'gap') continue;
      const dn = [dir[0] / dl, dir[1] / dl, dir[2] / dl], D = 0.02;
      const P2 = [p.p[0] - p.n[0] * D, p.p[1] - p.n[1] * D, p.p[2] - p.n[2] * D], Q2 = [q.p[0] - q.n[0] * D, q.p[1] - q.n[1] * D, q.p[2] - q.n[2] * D];
      const fv = (pp) => ({ p: pp, n: dn, s: 0 }), quad = [fv(p.p), fv(q.p), fv(Q2), fv(p.p), fv(Q2), fv(P2)];
      for (const w of quad) pushV(get(k1).seam, w, 1);
      if (mirror) for (const w of quad) pushV(get(k2).seam, w, -1);
    }
  };
  // one vertex record per grid point, shared by its quads (keeps the per-vertex field cache useful)
  let rowA = P[0].map((p, k) => mkV(p, N[0][k], sK[k]));
  for (let i = 0; i < NZ - 1; i++) {
    const rowB = P[i + 1].map((p, k) => mkV(p, N[i + 1][k], sK[k]));
    for (let k = 0; k < NV - 1; k++) quad(i, k, rowA[k], rowA[k + 1], rowB[k], rowB[k + 1]);
    rowA = rowB;
  }
  function quad(i, k, a, b, c, d) {
    // the charge-port flap exists on the left only: there both halves are cut separately
    const z0 = P[i][0][2], z1 = P[i + 1][0][2], ylo = Math.min(a.p[1], b.p[1], c.p[1], d.p[1]), yhi = Math.max(a.p[1], b.p[1], c.p[1], d.p[1]);
    const flapZone = z1 > 1.88 && z0 < 2.32 && yhi > 0.78 && ylo < 1.1 && sK[k] < 11.5;
    for (const side of flapZone ? [1, -1] : [1]) {
      const m = (v) => (side > 0 ? v : mkV([-v.p[0], v.p[1], v.p[2]], [-v.n[0], v.n[1], v.n[2]], v.s));
      const A = m(a), B = m(b), C = m(c), D = m(d);
      const t1 = side > 0 ? [A, B, C] : [A, C, B], t2 = side > 0 ? [B, D, C] : [B, C, D];
      for (const t of [t1, t2]) if (area2(...t) > 1e-12) { out.length = 0; clipRec(t, 0, side); for (const tr of out) emit(tr, side, !flapZone); }
    }
  }
  const res = {};
  for (const [key, pd] of Object.entries(parts)) {
    const g = new THREE.BufferGeometry(), inner = new THREE.BufferGeometry();
    const P2 = [], N2 = [], U2 = [], IP = [], IN = [];
    let start = 0;
    MATS.forEach((m, mi) => {
      const b = pd[m], cnt = b.p.length / 3;
      if (!cnt) return;
      for (let i = 0; i < b.p.length; i++) { P2.push(b.p[i]); N2.push(b.n[i]); }
      for (let i = 0; i < b.uv.length; i++) U2.push(b.uv[i]);
      g.addGroup(start, cnt, mi); start += cnt;
      // inner shell keeps outward normals: BackSide rendering flips them for lighting
      if (m === 'paint' || m === 'trim') for (let i = 0; i < b.p.length; i++) { IP.push(b.p[i]); IN.push(b.n[i]); }
    });
    g.setAttribute('position', new THREE.Float32BufferAttribute(P2, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N2, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U2, 2));
    inner.setAttribute('position', new THREE.Float32BufferAttribute(IP, 3));
    inner.setAttribute('normal', new THREE.Float32BufferAttribute(IN, 3));
    res[key] = { g, inner };
  }
  bodyCache = res;
  return res;
}

// ---- conformal decals ----
// A 2D shape laid out in a frame (origin o, axes u, v) is projected along d onto the skin and lifted by
// `lift` along the surface normal; winding is fixed so the faces look outward.
function decalGeometry(shape, o, u, v, d, lift = 0.0012, segs = 10, uvBox = null, maxEdge = 0.022) {
  // Shapes are x-monotone outlines: triangulate as columns (at every outline vertex and at least every
  // maxEdge) split into rows, so even large decals hug the curved skin without long chords.
  const C = shape.getPoints(segs);
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const p of C) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const span = (x) => { let lo = 1e9, hi = -1e9; for (let i = 0; i < C.length; i++) { const p = C[i], q = C[(i + 1) % C.length]; if ((p.x - x) * (q.x - x) <= 0 && p.x !== q.x) { const y = lerp(p.y, q.y, (x - p.x) / (q.x - p.x)); lo = Math.min(lo, y); hi = Math.max(hi, y); } else if (p.x === x) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); } } return lo <= hi ? [lo, hi] : null; };
  const [mx, my] = Array.isArray(maxEdge) ? maxEdge : [maxEdge, maxEdge];
  const nU = Math.ceil((x1 - x0) / mx), wX = x1 - x0;
  let xs = [];
  for (let i = 0; i <= nU; i++) xs.push(lerp(x0, x1, i / nU));
  // extra columns toward both ends, where the outline turns round
  for (const f of [0.004, 0.012, 0.025, 0.045, 0.07]) if (f * wX < mx) xs.push(x0 + f * wX, x1 - f * wX);
  for (const p of C) if (p.x - x0 < mx * 0.8 || x1 - p.x < mx * 0.8) xs.push(p.x);
  xs.sort((a, b) => a - b); xs = xs.filter((x, i) => i === 0 || x - xs[i - 1] > 1e-5);
  const rows = Math.max(1, Math.ceil((y1 - y0) / my));
  const pts = [], tris = [], cols = [];
  for (const x of xs) { const sp = span(x) || [lerp(y0, y1, 0.5), lerp(y0, y1, 0.5)]; const base = pts.length / 2; for (let r = 0; r <= rows; r++) pts.push(x, lerp(sp[0], sp[1], r / rows)); cols.push(base); }
  for (let c = 0; c + 1 < cols.length; c++) for (let r = 0; r < rows; r++) { const a = cols[c] + r, b = cols[c + 1] + r; tris.push(a, b, a + 1, a + 1, b, b + 1); }
  const n = pts.length / 2, P = new Float32Array(n * 3), N = new Float32Array(n * 3), UV = new Float32Array(n * 2), keep = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[i * 2], b = pts[i * 2 + 1];
    const h = typeof o === 'function' ? o(a, b) : hit2([o[0] + u[0] * a + v[0] * b, o[1] + u[1] * a + v[1] * b, o[2] + u[2] * a + v[2] * b], d);
    if (!h) continue;
    keep[i] = 1;
    P.set([h.p.x + h.n.x * lift, h.p.y + h.n.y * lift, h.p.z + h.n.z * lift], i * 3); N.set([h.n.x, h.n.y, h.n.z], i * 3);
    if (uvBox) UV.set([(a - uvBox[0]) / (uvBox[2] - uvBox[0]), (b - uvBox[1]) / (uvBox[3] - uvBox[1])], i * 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  const out = [], va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), vn = new THREE.Vector3();
  for (let i = 0; i < tris.length; i += 3) {
    const A = tris[i], B = tris[i + 1], C = tris[i + 2];
    if (!keep[A] || !keep[B] || !keep[C]) continue;
    va.fromArray(P, A * 3); vb.fromArray(P, B * 3).sub(va); vc.fromArray(P, C * 3).sub(va); vn.fromArray(N, A * 3);
    if (vb.cross(vc).dot(vn) < 0) out.push(A, C, B); else out.push(A, B, C);
  }
  g.setIndex(out);
  return g;
}
const rrect = (x0, y0, x1, y1, r) => {
  const s = new THREE.Shape();
  s.moveTo(x0 + r, y0); s.lineTo(x1 - r, y0); s.quadraticCurveTo(x1, y0, x1, y0 + r); s.lineTo(x1, y1 - r); s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1); s.quadraticCurveTo(x0, y1, x0, y1 - r); s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
};
// a ribbon of given width lying on the skin along a polyline of surface hits {p, n}
function ribbonGeometry(hits, width, lift = 0.0015, w1 = width) {
  const P = [], N = [], I = [];
  if (hits.length < 2) return new THREE.BufferGeometry();
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i], a = hits[Math.max(0, i - 1)].p, b = hits[Math.min(hits.length - 1, i + 1)].p;
    const T = b.clone().sub(a).normalize(), B = new THREE.Vector3().crossVectors(h.n, T).normalize();
    const w = lerp(width, w1, i / (hits.length - 1)) / 2;
    for (const sgn of [-1, 1]) {
      const q = h.p.clone().addScaledVector(B, sgn * w);
      const r = projectSkin([q.x, q.y, q.z], [-h.n.x, -h.n.y, -h.n.z], 0.05) || { p: q, n: h.n };
      P.push(r.p.x + r.n.x * lift, r.p.y + r.n.y * lift, r.p.z + r.n.z * lift); N.push(r.n.x, r.n.y, r.n.z);
    }
    if (i > 0) { const k = i * 2; I.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  // orient outward
  const p0 = new THREE.Vector3(P[0], P[1], P[2]), p1 = new THREE.Vector3(P[3], P[4], P[5]), p2 = new THREE.Vector3(P[6], P[7], P[8]);
  const fn = new THREE.Vector3().crossVectors(p1.sub(p0), p2.sub(p0));
  if (fn.dot(new THREE.Vector3(N[0], N[1], N[2])) < 0) for (let i = 0; i < I.length; i += 3) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; }
  g.setIndex(I);
  return g;
}
// project along the main axis first (so shape coordinates keep their meaning), then settle along d
function hit2(p, d) {
  const ax = Math.abs(d[0]) > Math.abs(d[2]) ? [Math.sign(d[0]), 0, 0] : [0, 0, Math.sign(d[2])];
  if (Math.abs(d[1]) < 1e-6 && (ax[0] ? Math.abs(d[2]) : Math.abs(d[0])) < 1e-6) return projectSkin(p, d);
  const h1 = projectSkin(p, ax);
  if (!h1) return projectSkin(p, d);
  return projectSkin([h1.p.x, h1.p.y, h1.p.z], d, 0.05) || h1;
}
// cylindrical projection about a vertical axis at z = cz: (azimuth in degrees from straight ahead/behind, height)
const radial = (cz, rear) => (phDeg, y) => { const ph = (phDeg * Math.PI) / 180, sx = Math.sin(ph), sz = Math.cos(ph) * (rear ? 1 : -1), R0 = 1.95; return castSkin([sx * R0, y, cz + sz * R0], [-sx, 0, -sz], R0); };
const hitsAlong = (pts, dir) => pts.map((p) => hit2(p, typeof dir === 'function' ? dir(p) : dir)).filter(Boolean);
const mirrorGeo = (g) => { const m = g.clone(); m.scale(-1, 1, 1); const ix = m.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } return m; };

// ---- batching ----
// Static pieces are merged into one mesh per group with a material array, so the whole car (exterior and
// interior) stays well under a hundred meshes: every input is made non-indexed with position/normal/uv
// only, transformed into the group's frame and merged per material; the per-material blocks then become
// the geometry groups of a single mesh.
const _eul = new THREE.Euler();
class Batch {
  constructor() { this.items = new Map(); }
  add(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    let m;
    if (x && x.isMatrix4) m = x;
    else if (x && x.isObject3D) { x.updateMatrix(); m = x.matrix; }
    else { m = new THREE.Matrix4().makeRotationFromEuler(_eul.set(rx, ry, rz)); m.setPosition(x, y, z); }
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.clearGroups();
    g.applyMatrix4(m);
    let l = this.items.get(mat); if (!l) this.items.set(mat, (l = []));
    l.push(g);
    return this;
  }
  mesh(opts = {}) {
    const mats = [], geos = [];
    for (const [mat, l] of this.items) { const g = l.length === 1 ? l[0] : mergeGeometries(l, false); if (g) { mats.push(mat); geos.push(g); } }
    if (!geos.length) return null;
    const g = geos.length === 1 ? geos[0] : mergeGeometries(geos, true);
    const m = new THREE.Mesh(g, mats.length === 1 ? mats[0] : mats);
    m.castShadow = !!opts.shadow; m.receiveShadow = opts.receive !== false;
    return m;
  }
}
// the triangles of one material group of a geometry, as a geometry of their own
function groupGeo(src, mi) {
  const g = src.index ? src.toNonIndexed() : src, parts = [];
  for (const gr of g.groups) {
    if (gr.materialIndex !== mi) continue;
    const sub = new THREE.BufferGeometry(), cnt = gr.count === Infinity ? g.attributes.position.count - gr.start : gr.count;
    for (const [name, a] of Object.entries(g.attributes)) sub.setAttribute(name, new THREE.BufferAttribute(a.array.slice(gr.start * a.itemSize, (gr.start + cnt) * a.itemSize), a.itemSize));
    parts.push(sub);
  }
  return parts.length === 1 ? parts[0] : parts.length ? mergeGeometries(parts, false) : new THREE.BufferGeometry();
}
// a box of section w (x) by h (y) running from a to b
function barGeo(a, b, w, h) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const g = new THREE.BoxGeometry(w, h, A.distanceTo(B));
  const m = new THREE.Matrix4().lookAt(B, A, new THREE.Vector3(0, 1, 0)); m.setPosition(A.clone().add(B).multiplyScalar(0.5));
  return g.applyMatrix4(m);
}
// small procedural textures
function canvasTex(w, h, draw, { srgb = true, repeat = null } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
// white text on a clear ground (used as an alpha map: the green channel carries the mask)
const textTex = (text, w, h, font, fit = false) => canvasTex(w, h, (x) => {
  x.fillStyle = '#fff'; x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
  const s = fit ? (w * 0.94) / Math.max(1, x.measureText(text).width) : 1; // (fit: stretched to fill the width)
  x.setTransform(s, 0, 0, 1, w / 2, h / 2 + 1); x.fillText(text, 0, 0);
}, { srgb: false });

// ---- wheels: 255/45 R19 on aero "Crossflow"-style wheels ----
// sidewall: moulded size markings and a rim-protector ring, a shade lighter than the rubber
let tyreTex = null;
function tyreTexture() {
  if (tyreTex) return tyreTex;
  const c = document.createElement('canvas'); c.width = 1024; c.height = 128; const x = c.getContext('2d');
  x.fillStyle = '#161618'; x.fillRect(0, 0, 1024, 128);
  x.fillStyle = '#1d1d20'; x.fillRect(0, 119, 1024, 3); // rim protector line (v = 0 is the outer bead)
  x.fillStyle = '#242427'; x.font = 'bold 17px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (const [u, t] of [[0.12, '255/45 R19 104W'], [0.37, 'ALL SEASON  M+S'], [0.62, '255/45 R19 104W'], [0.87, 'XL  TUBELESS']]) x.fillText(t, u * 1024, 104);
  tyreTex = new THREE.CanvasTexture(c); tyreTex.colorSpace = THREE.SRGBColorSpace; tyreTex.anisotropy = 4;
  return tyreTex;
}
const GEO = new Map(), memo = (k, f) => { let g = GEO.get(k); if (!g) { g = f(); GEO.set(k, g); } return g; };
// one wheel (tyre, rim, spokes, cap, brake) as a single batched mesh
function wheelAssembly(mats, side, viz) {
  const b = new Batch(), H = Math.PI / 2;
  const V2 = (p) => new THREE.Vector2(p[0], p[1]);
  // tyre section (radius, axial): beads, sidewall bulge, rim protector, rounded shoulders, flat tread
  const tp = [[0.246, -0.103], [0.258, -0.112], [0.276, -0.1205], [0.3, -0.1258], [0.322, -0.1262], [0.338, -0.1225], [0.3485, -0.1135], [0.3545, -0.099],
    [0.3565, -0.078], [0.357, -0.05], [0.3572, 0], [0.357, 0.05], [0.3565, 0.078], [0.3545, 0.099], [0.3485, 0.1135], [0.338, 0.1225], [0.322, 0.1262],
    [0.3, 0.1258], [0.276, 0.1205], [0.258, 0.112], [0.246, 0.103]];
  // (the lettered sidewall is at the start of the profile: turn it outboard on both sides)
  b.add(memo('tyre' + viz, () => new THREE.LatheGeometry(tp.map(V2), viz ? 40 : 64)), mats.tire, 0, 0, 0, 0, side < 0 ? Math.PI : 0, H);
  // rim: barrel and the polished outer lip (lathe +y turned to face outboard)
  const rp = [[0.226, -0.105], [0.231, -0.1], [0.231, 0.06], [0.236, 0.085], [0.2445, 0.1], [0.2505, 0.104], [0.2525, 0.1085], [0.249, 0.1115], [0.24, 0.111], [0.228, 0.102]];
  b.add(memo('rim' + viz, () => new THREE.LatheGeometry(rp.map(V2), viz ? 32 : 64)), mats.rimLip, 0, 0, 0, 0, 0, side > 0 ? -H : H);
  b.add(memo('barrel', () => new THREE.CylinderGeometry(0.229, 0.229, 0.2, 40, 1, true)), mats.rimInner, 0, 0, 0, 0, 0, H);
  // "Crossflow" aero face: five swept twin spokes over a dark turbine disc, the slots between them
  // closed by the dark aero inserts
  const fg = memo('face' + side + viz, () => {
  const R = 0.228, face = new THREE.Shape(); face.absarc(0, 0, R, 0, Math.PI * 2, false);
  const nS = 10;
  for (let s = 0; s < nS; s++) {
    const a0 = (s / nS) * Math.PI * 2, hole = new THREE.Path();
    const r1 = 0.088, r2 = 0.208, sw = 0.36, w1 = 0.15, w2 = s % 2 ? 0.3 : 0.38;
    hole.moveTo(Math.cos(a0) * r1, Math.sin(a0) * r1);
    for (let k = 1; k < 6; k++) { const f = k / 6, r = lerp(r1, r2, f), a = a0 + sw * f * f; hole.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    hole.absarc(0, 0, r2, a0 + sw, a0 + sw + w2, false);
    for (let k = 5; k > 0; k--) { const f = k / 6, r = lerp(r1, r2, f), a = a0 + sw * f * f + lerp(w1, w2, f); hole.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    hole.absarc(0, 0, r1, a0 + w1, a0, true);
    face.holes.push(hole);
  }
  const fg = new THREE.ExtrudeGeometry(face, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.007, bevelSize: 0.005, bevelSegments: 1, curveSegments: viz ? 4 : 6 });
  fg.rotateY(side > 0 ? H : -H);
  fg.translate(side * 0.074, 0, 0);
  return fg;
  });
  b.add(groupGeo(fg, 0), mats.rim); b.add(groupGeo(fg, 1), mats.rimWall); // faces / slot walls
  // dark disc behind the spokes (the turbine pockets) — open between r 0.21 and the barrel so the brake shows
  b.add(memo('pocket', () => new THREE.RingGeometry(0.205, 0.229, 48, 1)), mats.rimInner, side * 0.06, 0, 0, 0, side > 0 ? H : -H, 0);
  // centre cap
  b.add(memo('cap', () => new THREE.CylinderGeometry(0.056, 0.06, 0.02, 32)), mats.cap, side * 0.083, 0, 0, 0, 0, H);
  b.add(memo('capT', () => new THREE.CircleGeometry(0.03, 24)), mats.capLogo, side * 0.0935, 0, 0, 0, side > 0 ? H : -H, 0);
  // brake disc and hat
  if (!viz) {
    const dp = [[0.085, -0.016], [0.172, -0.016], [0.176, -0.012], [0.176, 0.012], [0.172, 0.016], [0.085, 0.016]];
    b.add(memo('disc', () => new THREE.LatheGeometry(dp.map((p) => V2(p)), 56)), mats.disc, -side * 0.012, 0, 0, 0, 0, H);
    b.add(memo('hat', () => new THREE.CylinderGeometry(0.088, 0.09, 0.05, 32)), mats.hub, side * 0.02, 0, 0, 0, 0, H);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      b.add(memo('lug', () => new THREE.CylinderGeometry(0.009, 0.009, 0.03, 10)), mats.disc, side * 0.05, Math.cos(a) * 0.058, Math.sin(a) * 0.058, 0, 0, H);
    }
  }
  return b.mesh({ shadow: true });
}

function applyFinish(mat, c) {
  const f = FINISH[c];
  mat.color.setHex(f ? f.color : c);
  if (!mat.isMeshPhysicalMaterial) return;
  mat.metalness = f ? f.metalness : 0.5; mat.roughness = f ? f.roughness : 0.3; mat.clearcoatRoughness = f ? f.clearcoatRoughness : 0.03;
  mat.sheen = f ? f.sheen : 0;
}

export function buildModelY({ viz = false, paint = PAINTS['Ultra Red'] } = {}) {
  const root = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(chassis);
  const M = {};
  if (viz) {
    M.paint = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.45, metalness: 0.1 });
    M.trim = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.5 });
    M.black = M.trim; M.seam = M.trim;
    M.glass = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.2, transparent: true, opacity: 0.85 });
    M.roofglass = M.glass;
    M.inner = new THREE.MeshStandardMaterial({ color: 0x55585e, side: THREE.BackSide });
  } else {
    M.paint = new THREE.MeshPhysicalMaterial({ color: paint, metalness: 0.7, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.6, envMapIntensity: 1.15 });
    applyFinish(M.paint, paint);
    M.glass = new THREE.MeshPhysicalMaterial({ color: 0x0c1116, metalness: 0.1, roughness: 0.03, transparent: true, opacity: 0.58, side: THREE.DoubleSide, envMapIntensity: 1.5, depthWrite: false });
    M.roofglass = new THREE.MeshPhysicalMaterial({ color: 0x05070a, metalness: 0.35, roughness: 0.035, transparent: true, opacity: 0.9, side: THREE.DoubleSide, envMapIntensity: 1.45, depthWrite: false });
    M.trim = new THREE.MeshPhysicalMaterial({ color: 0x08080a, metalness: 0.3, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.04 });
    M.black = new THREE.MeshStandardMaterial({ color: 0x121214, roughness: 0.68, metalness: 0.05 });
    M.seam = new THREE.MeshStandardMaterial({ color: 0x040404, roughness: 0.95, side: THREE.DoubleSide });
    M.inner = new THREE.MeshStandardMaterial({ color: 0x232325, roughness: 0.9, side: THREE.BackSide });
  }
  const matList = [M.paint, M.glass, M.roofglass, M.trim, M.black, M.seam];
  const parts = buildBodyParts();
  const interact = [];
  const mkPart = (key, pivot, parent = chassis) => {
    const grp = new THREE.Group();
    grp.position.copy(pivot);
    // the cached skin geometry is shared between builds; the mesh is offset back by the pivot instead
    const mesh = new THREE.Mesh(parts[key].g, matList); mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.position.copy(pivot).negate(); grp.add(mesh);
    if (!viz) { // the visualization never looks inside
      const inner = new THREE.Mesh(parts[key].inner, M.inner); inner.receiveShadow = true; inner.position.copy(pivot).negate(); grp.add(inner);
    }
    parent.add(grp);
    return { grp, mesh };
  };
  mkPart('body', new THREE.Vector3());
  const zHinge = zHR(0) + 0.004, yHinge = yTop(zHinge) - 0.006;
  const doors = {
    FL: { ...mkPart('doorFL', new THREE.Vector3(-0.925, 0, L.zDF + 0.01)), axis: 'y', max: -1.12, cur: 0, target: 0, speed: 1.5 },
    FR: { ...mkPart('doorFR', new THREE.Vector3(0.925, 0, L.zDF + 0.01)), axis: 'y', max: 1.12, cur: 0, target: 0, speed: 1.5 },
    RL: { ...mkPart('doorRL', new THREE.Vector3(-0.925, 0, L.zDR + 0.01)), axis: 'y', max: -1.12, cur: 0, target: 0, speed: 1.5 },
    RR: { ...mkPart('doorRR', new THREE.Vector3(0.925, 0, L.zDR + 0.01)), axis: 'y', max: 1.12, cur: 0, target: 0, speed: 1.5 },
    frunk: { ...mkPart('hood', new THREE.Vector3(0, yHinge, zHinge)), axis: 'x', max: 0.95, cur: 0, target: 0, speed: 0.55 },
    trunk: { ...mkPart('lift', new THREE.Vector3(0, yTop(L.zLT) - 0.012, L.zLT)), axis: 'x', max: -1.3, cur: 0, target: 0, speed: 0.42 },
  };
  for (const [k, d] of Object.entries(doors)) { d.mesh.userData.action = k; interact.push(d.mesh); }
  const toLocal = (grp, g) => { g.translate(-grp.position.x, -grp.position.y, -grp.position.z); return g; };
  // static decals and trims are collected per group and merged into one mesh per group at the end
  const batches = new Map();
  const batchOf = (parent) => { let b = batches.get(parent); if (!b) batches.set(parent, (b = new Batch())); return b; };
  const addTo = (parent, g, mat) => { batchOf(parent).add(parent === chassis ? g : toLocal(parent, g), mat); };

  // ---------- lights ----------
  const Lm = {
    drl: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.2 }),
    head: new THREE.MeshStandardMaterial({ color: 0x8e979f, emissive: 0xf4f8ff, emissiveIntensity: 0, roughness: 0.08, metalness: 0.75 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x3a0505, emissive: 0xff0604, emissiveIntensity: 0.4, roughness: 0.2 }),
    sigF: new THREE.MeshStandardMaterial({ color: 0x3a2a05, emissive: 0xffa21a, emissiveIntensity: 0 }),
    sigR: new THREE.MeshStandardMaterial({ color: 0x3a1005, emissive: 0xff5a10, emissiveIntensity: 0 }),
    sigFL: null, sigFR: null,
    rev: new THREE.MeshStandardMaterial({ color: 0x777777, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.2 }),
    ambient: new THREE.MeshStandardMaterial({ color: 0x223344, emissive: 0x3d8bff, emissiveIntensity: 1.2 }),
    port: new THREE.MeshStandardMaterial({ color: 0x113322, emissive: 0x22ff66, emissiveIntensity: 0 }),
  };
  Lm.sigFL = Lm.sigF.clone(); Lm.sigFR = Lm.sigF.clone(); Lm.sigRL = Lm.sigR.clone(); Lm.sigRR = Lm.sigR.clone();
  const lens = viz ? M.trim : new THREE.MeshPhysicalMaterial({ color: 0x0a0b0d, metalness: 0.2, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.02 });
  const smoked = viz ? M.trim : new THREE.MeshPhysicalMaterial({ color: 0x1a0304, metalness: 0.1, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.02 });
  // front light bar: runs the full width of the nose just under the frunk lid's leading edge
  const edgeY = (x) => { const h = castSkin([x, 1.6, zHF(x)], [0, -1, 0]); return h ? h.p.y : 0.8; };
  const barDir = (x) => [-x * 0.95, 0, 1];
  const barPts = (x0, x1, n, dy) => { const pts = []; for (let i = 0; i <= n; i++) { const x = lerp(x0, x1, i / n); pts.push([x, edgeY(x) - dy, -2.6]); } return pts; };
  const barHits = hitsAlong(barPts(-0.76, 0.76, 64, 0.028), (p) => barDir(p[0]));
  addTo(chassis, ribbonGeometry(barHits, 0.026, 0.0012), lens);
  const mid = barHits.filter((h) => Math.abs(h.p.x) < 0.68);
  addTo(chassis, ribbonGeometry(mid, 0.0085, 0.0022), Lm.drl);
  for (const s of [-1, 1]) {
    const seg = barHits.filter((h) => h.p.x * s > 0.664 && h.p.x * s < 0.75);
    addTo(chassis, ribbonGeometry(seg, 0.0086, 0.0028, 0.006), s < 0 ? Lm.sigFL : Lm.sigFR);
  }
  // main headlamps: slim units low in the bumper corners
  // (built for the right side and mirrored)
  {
    const HY = 0.56;
    const housing = new THREE.Shape(); housing.moveTo(0.45, HY - 0.04); housing.lineTo(0.72, HY - 0.042); housing.quadraticCurveTo(0.84, HY - 0.04, 0.885, HY + 0.012);
    housing.quadraticCurveTo(0.875, HY + 0.05, 0.76, HY + 0.048); housing.lineTo(0.48, HY + 0.038); housing.quadraticCurveTo(0.415, HY + 0.035, 0.415, HY); housing.quadraticCurveTo(0.418, HY - 0.04, 0.45, HY - 0.04);
    const strip = new THREE.Shape(); strip.moveTo(0.6, HY + 0.012); strip.lineTo(0.76, HY + 0.016); strip.quadraticCurveTo(0.83, HY + 0.018, 0.85, HY + 0.008); strip.quadraticCurveTo(0.83, HY + 0.026, 0.76, HY + 0.026); strip.lineTo(0.6, HY + 0.021); strip.quadraticCurveTo(0.594, HY + 0.016, 0.6, HY + 0.012);
    const lamps = [[housing, lens, 0.0012], [strip, Lm.head, 0.0022]];
    for (const px of [0.475, 0.535]) { const c = new THREE.Shape(); c.absarc(px, HY - 0.002, 0.019, 0, Math.PI * 2, false); lamps.push([c, Lm.head, 0.0024]); }
    const ring = new THREE.Shape(); ring.moveTo(0.585, HY - 0.016); ring.lineTo(0.74, HY - 0.014); ring.lineTo(0.74, HY - 0.008); ring.lineTo(0.585, HY - 0.01); ring.lineTo(0.585, HY - 0.016);
    lamps.push([ring, M.trim, 0.0018]);
    for (const [sh, mat, lift] of lamps) {
      const g = decalGeometry(sh, [0, 0, -2.6], [1, 0, 0], [0, 1, 0], [-0.55, 0, 1], lift, 12);
      addTo(chassis, g, mat); addTo(chassis, mirrorGeo(g), mat);
    }
  }
  if (!viz) {
    // slim lower intake and the bumper camera
    addTo(chassis, decalGeometry(rrect(-0.42, 0.322, 0.42, 0.372, 0.024), [0, 0, -2.6], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.0012), M.seam);
    addTo(chassis, decalGeometry(rrect(-0.4, 0.33, 0.4, 0.336, 0.003), [0, 0, -2.6], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.0016), M.black);
    const cam = new THREE.Shape(); cam.absarc(0, 0.392, 0.011, 0, Math.PI * 2, false);
    addTo(chassis, decalGeometry(cam, [0, 0, -2.6], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.0015), lens);
  }
  // rear: full-width light bar on the liftgate joining C-shaped corner lamps
  const lift = doors.trunk.grp;
  // (laid out by azimuth about a vertical axis near the rear axle, so they wrap the corners evenly)
  const RB_Y = 1.035, rmap = radial(0.8, true), PHL = 20.3, PH0 = 21.5;
  {
    const hs = []; for (let i = 0; i <= 48; i++) { const h = rmap(lerp(-PHL, PHL, i / 48), RB_Y); if (h) hs.push(h); }
    addTo(lift, ribbonGeometry(hs, 0.026, 0.0012), smoked);
    addTo(lift, ribbonGeometry(hs, 0.0075, 0.0022), Lm.tail);
  }
  {
    // smoked lens over each corner, wrapping onto the quarter panel
    const ls = new THREE.Shape();
    ls.moveTo(PH0, RB_Y + 0.013); ls.lineTo(31, RB_Y + 0.016); ls.quadraticCurveTo(36.5, RB_Y + 0.018, 38.6, RB_Y - 0.006); ls.quadraticCurveTo(39.4, RB_Y - 0.05, 35.5, RB_Y - 0.082);
    ls.lineTo(27, RB_Y - 0.07); ls.quadraticCurveTo(PH0 + 0.4, RB_Y - 0.052, PH0, RB_Y - 0.02); ls.lineTo(PH0, RB_Y + 0.013);
    const lg = decalGeometry(ls, rmap, null, null, null, 0.0012, 12, null, [0.7, 0.016]);
    addTo(chassis, lg, smoked); addTo(chassis, mirrorGeo(lg), smoked);
    // the lit "C": the top stroke continues the bar, sweeps round the corner and returns along the bottom
    const cp = [];
    for (let i = 0; i <= 16; i++) cp.push([lerp(PH0, 34.5, i / 16), RB_Y]);
    for (let i = 1; i <= 12; i++) { const a = (i / 12) * Math.PI; cp.push([34.5 + Math.sin(a) * 2.9, RB_Y - 0.034 + Math.cos(a) * 0.034]); }
    for (let i = 1; i <= 12; i++) cp.push([lerp(34.5, 27.5, i / 12), RB_Y - 0.068]);
    const ch = cp.map(([a, b]) => rmap(a, b)).filter(Boolean);
    const cg = ribbonGeometry(ch, 0.0085, 0.0024);
    addTo(chassis, cg, Lm.tail); addTo(chassis, mirrorGeo(cg), Lm.tail);
    const sg = []; for (let i = 0; i <= 10; i++) { const h = rmap(lerp(26.5, 33.5, i / 10), RB_Y - 0.036); if (h) sg.push(h); }
    const sgg = ribbonGeometry(sg, 0.011, 0.0024);
    addTo(chassis, sgg, Lm.sigRR); addTo(chassis, mirrorGeo(sgg), Lm.sigRL);
    if (!viz) {
      // reverse lamps and reflectors in the lower bumper
      const rv = decalGeometry(rrect(12, 0.442, 19, 0.462, 0.008), rmap, null, null, null, 0.0016, 6, null, [0.8, 0.02]);
      addTo(chassis, rv, Lm.rev); addTo(chassis, mirrorGeo(rv), Lm.rev);
      const rf = decalGeometry(rrect(29, 0.468, 37, 0.482, 0.006), rmap, null, null, null, 0.0016, 6, null, [0.8, 0.02]);
      addTo(chassis, rf, smoked); addTo(chassis, mirrorGeo(rf), smoked);
    }
  }
  if (!viz) {
    // rear plate and TESLA wordmark on the liftgate
    const plateC = document.createElement('canvas'); plateC.width = 256; plateC.height = 128;
    const px = plateC.getContext('2d'); px.fillStyle = '#f4f4f0'; px.fillRect(0, 0, 256, 128); px.fillStyle = '#1b2a6b'; px.font = 'bold 64px Arial'; px.textAlign = 'center'; px.fillText('FSD 26', 128, 92); px.font = '18px Arial'; px.fillText('California', 128, 28);
    px.strokeStyle = '#333'; px.lineWidth = 4; px.strokeRect(2, 2, 252, 124);
    const plateT = new THREE.CanvasTexture(plateC); plateT.colorSpace = THREE.SRGBColorSpace;
    const PW = 0.155, PY0 = 0.768, PY1 = 0.923;
    addTo(lift, decalGeometry(rrect(-PW - 0.012, PY0 - 0.012, PW + 0.012, PY1 + 0.012, 0.012), [0, 0, 2.7], [1, 0, 0], [0, 1, 0], [0, 0, -1], 0.0012), M.black);
    const pg = decalGeometry(rrect(-PW, PY0, PW, PY1, 0.008), [0, 0, 2.7], [1, 0, 0], [0, 1, 0], [0, 0, -1], 0.0025, 4, [-PW, PY0, PW, PY1]);
    addTo(lift, pg, new THREE.MeshStandardMaterial({ map: plateT, roughness: 0.45 }));
    const wc = document.createElement('canvas'); wc.width = 512; wc.height = 64; const wx = wc.getContext('2d');
    wx.fillStyle = '#fff'; wx.font = '600 54px Arial'; wx.textAlign = 'center'; wx.textBaseline = 'middle';
    const word = 'T E S L A'; wx.fillText(word, 256, 34);
    const wt = new THREE.CanvasTexture(wc);
    const wg = decalGeometry(rrect(-0.17, 0.955, 0.17, 0.983, 0.001), [0, 0, 2.7], [1, 0, 0], [0, 1, 0], [0, 0, -1], 0.0015, 2, [-0.17, 0.955, 0.17, 0.983]);
    const badgeM = (tex) => new THREE.MeshPhysicalMaterial({ color: 0x0a0a0b, alphaMap: tex, transparent: true, metalness: 0.4, roughness: 0.2, clearcoat: 1, depthWrite: false });
    addTo(lift, wg, badgeM(wt));
    // chrome-delete "MODEL Y" and "DUAL MOTOR" badges low on the liftgate, either side of the plate
    for (const [text, x0, x1] of [['MODEL Y', 0.3, 0.43], ['DUAL MOTOR', -0.47, -0.3]]) {
      const bg = decalGeometry(rrect(x0, 0.79, x1, 0.807, 0.001), [0, 0, 2.7], [1, 0, 0], [0, 1, 0], [0, 0, -1], 0.0015, 2, [x0, 0.79, x1, 0.807]);
      addTo(lift, bg, badgeM(textTex(text, 512, 64, '600 48px Arial', true)));
    }
  }
  // charge port: the flap is cut out of the left rear quarter; a recess with the port sits behind it
  const cpHit = projectSkin([-1.3, L.cp.y, L.cp.z - L.cp.hz], [1, 0, 0]);
  const chargeFlap = new THREE.Group(); chargeFlap.position.set(cpHit.p.x + 0.004, L.cp.y, L.cp.z - L.cp.hz); chassis.add(chargeFlap);
  {
    const flap = new THREE.Mesh(parts.flap.g, matList); flap.castShadow = true; flap.userData.action = 'chargeport'; flap.position.copy(chargeFlap.position).negate(); chargeFlap.add(flap); interact.push(flap);
    if (!viz) { const fi = new THREE.Mesh(parts.flap.inner, M.inner); fi.position.copy(flap.position); chargeFlap.add(fi); }
    const c = projectSkin([-1.3, L.cp.y, L.cp.z], [1, 0, 0]);
    const cb = batchOf(chassis), o = new THREE.Object3D();
    const at = (geo, mat, back, dx = 0, dy = 0, dz = 0) => { o.position.copy(c.p).addScaledVector(c.n, -back); o.lookAt(c.p.clone().add(c.n)); o.translateX(dx); o.translateY(dy); o.translateZ(dz); cb.add(geo, mat, o); };
    at(new RoundedBoxGeometry(L.cp.hz * 2 + 0.01, L.cp.hy * 2 + 0.01, 0.05, 2, 0.012), M.seam, 0.04);
    at(new THREE.CircleGeometry(0.033, 24), M.black, 0.0138);
    at(new THREE.TorusGeometry(0.034, 0.005, 8, 28), Lm.port, 0.0132);
    for (const [dx, dy, r] of [[-0.012, 0.008, 0.006], [0.012, 0.008, 0.006], [0, -0.012, 0.004]]) at(new THREE.CircleGeometry(r, 12), M.seam, 0.0134, dx, dy, 0.0005);
  }

  // ---------- mirrors, handles, cameras ----------
  // mirror glass (and the cabin mirrors) pick up the paint's reflection map once the game assigns it
  const mirrorM = new THREE.MeshStandardMaterial({ color: 0xb4bac0, metalness: 1, roughness: 0.04 });
  const envMats = [mirrorM];
  const mirrorFold = { grps: [], cur: 0, target: 0 };
  for (const s of [-1, 1]) {
    const door = s < 0 ? doors.FL : doors.FR;
    // mirror: aero pod on a short black stalk at the front of the front door; the pod folds on a pivot
    // at the stalk root
    const mz = -0.8, base = projectSkin([s * 1.3, feat(mz).y8 - 0.035, mz], [-s, 0, 0]);
    const mg = new THREE.Group(); mg.position.set(base.p.x + s * 0.012, base.p.y + 0.02, mz + 0.03); mg.position.sub(door.grp.position); door.grp.add(mg);
    mirrorFold.grps.push({ grp: mg, s });
    const px = s * 0.073, py = 0.035, pb = new Batch(); // pod centre relative to the pivot
    const pod = new THREE.SphereGeometry(1, 30, 18), pp = pod.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      let x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
      const inb = (1 - x * s) / 2; // 1 at the inboard end
      const taper = 1 - 0.28 * inb ** 2;
      pp.setXYZ(i, x * 0.118 + s * 0.005, y * 0.066 * taper - inb * 0.008, (z < 0 ? z * 0.085 : z * 0.026) * taper);
    }
    pod.computeVertexNormals();
    pb.add(pod, M.paint, px, py, 0);
    const rimT = new THREE.TorusGeometry(1, 0.06, 6, 40); rimT.scale(0.108, 0.058, 0.4); pb.add(rimT, M.trim, px + s * 0.006, py - 0.003, 0.024);
    if (!viz) { const gl = new THREE.CircleGeometry(1, 36); gl.scale(0.104, 0.056, 1); pb.add(gl, mirrorM, px + s * 0.006, py - 0.003, 0.0255); }
    mg.add(pb.mesh({ shadow: true }));
    const db = batchOf(door.grp), p = door.grp.position, mp = mg.position.clone().add(p);
    db.add(new RoundedBoxGeometry(0.1, 0.034, 0.06, 2, 0.012), M.trim, mp.x + px - s * 0.09 - p.x, mp.y + py - 0.05 - p.y, mp.z - 0.012 - p.z, 0, 0, s * 0.35);
    db.add(new RoundedBoxGeometry(0.04, 0.07, 0.11, 2, 0.015), M.trim, mp.x + px - s * 0.125 - p.x, mp.y + py - 0.06 - p.y, mp.z - 0.005 - p.z);
    // flush door handles
    for (const [dk, z0] of [[s < 0 ? 'FL' : 'FR', 0.04], [s < 0 ? 'RL' : 'RR', 0.86]]) {
      const d = doors[dk], hy = feat(z0 + 0.08).y8 - 0.072;
      let g = decalGeometry(rrect(z0, hy - 0.015, z0 + 0.165, hy + 0.015, 0.012), [1.4, 0, 0], [0, 0, 1], [0, 1, 0], [-1, 0, 0], 0.0018);
      if (s < 0) g = mirrorGeo(g);
      addTo(d.grp, g, M.trim);
    }
    // side repeater camera on the front fender, and the B-pillar camera
    let g = decalGeometry(rrect(-1.16, 0.848, -1.1, 0.872, 0.011), [1.4, 0, 0], [0, 0, 1], [0, 1, 0], [-1, 0, 0], 0.0016);
    if (s < 0) g = mirrorGeo(g);
    addTo(chassis, g, M.trim);
    const lensC = new THREE.Shape(); lensC.absarc(-1.122, 0.86, 0.0055, 0, Math.PI * 2, false);
    g = decalGeometry(lensC, [1.4, 0, 0], [0, 0, 1], [0, 1, 0], [-1, 0, 0], 0.0024);
    if (s < 0) g = mirrorGeo(g);
    addTo(chassis, g, new THREE.MeshStandardMaterial({ color: 0x1a2230, metalness: 0.6, roughness: 0.05 }));
    if (!viz) {
      const bc = new THREE.Shape(); bc.absarc(0.3, 1.18, 0.009, 0, Math.PI * 2, false);
      g = decalGeometry(bc, [1.4, 0, 0], [0, 0, 1], [0, 1, 0], [-1, 0.25, 0], 0.0016);
      if (s < 0) g = mirrorGeo(g);
      addTo(chassis, g, new THREE.MeshStandardMaterial({ color: 0x1a2230, metalness: 0.6, roughness: 0.05 }));
    }
  }

  // ---------- wheel openings: rolled body-colour lips and black wheel-well liners ----------
  const linerM = viz ? M.trim : new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.95, side: THREE.DoubleSide });
  for (const az of [AXLE_F, AXLE_R]) for (const s of [-1, 1]) {
    const P = [], Nn = [], I = [];
    const prof = 7; // vertices across the lip
    let rows = 0;
    for (let i = 0; i <= 64; i++) {
      const ph = lerp(-0.42, Math.PI + 0.42, i / 64), z = az - Math.cos(ph) * RA, y = WHEEL_R + Math.sin(ph) * RA;
      if (y < fYb(z) + 0.035) continue;
      const h = projectSkin([s * 1.3, y, z], [-s, 0, 0]);
      if (!h || Math.abs(h.p.x) < 0.8) continue;
      const r = new THREE.Vector3(0, y - WHEEL_R, z - az).normalize(), n = h.n, rr = 0.007;
      const C = h.p.clone().addScaledVector(n, -rr);
      for (let j = 0; j < prof; j++) {
        let p, nn;
        if (j < 5) { const a = (j / 4) * (Math.PI / 2); nn = n.clone().multiplyScalar(Math.cos(a)).addScaledVector(r, -Math.sin(a)); p = C.clone().addScaledVector(nn, rr); }
        else { nn = r.clone().negate(); p = C.clone().addScaledVector(r, -rr).addScaledVector(n, j === 5 ? -0.02 : -0.05); }
        P.push(p.x, p.y, p.z); Nn.push(nn.x, nn.y, nn.z);
      }
      if (rows > 0) for (let j = 0; j < prof - 1; j++) { const a = (rows - 1) * prof + j, b = rows * prof + j; I.push(a, b, a + 1, a + 1, b, b + 1); }
      rows++;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
    // orient outward
    if (I.length) {
      const v = (k) => new THREE.Vector3(P[k * 3], P[k * 3 + 1], P[k * 3 + 2]);
      const fn = new THREE.Vector3().crossVectors(v(I[1]).sub(v(I[0])), v(I[2]).sub(v(I[0])));
      if (fn.dot(new THREE.Vector3(Nn[I[0] * 3], Nn[I[0] * 3 + 1], Nn[I[0] * 3 + 2])) < 0) for (let i = 0; i < I.length; i += 3) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; }
    }
    g.setIndex(I);
    batchOf(chassis).add(g, M.paint);
    // liner: an open drum over the wheel plus an inner wall (front walls sit inboard of full lock)
    const xin = az < 0 ? 0.465 : 0.6, xout = 0.93, wdt = xout - xin;
    batchOf(chassis).add(new THREE.CylinderGeometry(0.432, 0.432, wdt, 40, 1, true, -0.25, Math.PI + 0.5), linerM, s * (xin + wdt / 2), WHEEL_R, az, 0, 0, Math.PI / 2);
    batchOf(chassis).add(new THREE.CircleGeometry(0.432, 40, -0.25, Math.PI + 0.5), linerM, s * xin, WHEEL_R, az, 0, Math.PI / 2, 0);
  }

  // ---------- single front wiper, parked along the base of the windshield ----------
  let wiperArm = null;
  if (!viz) {
    const wx = -0.33, wz = zCowl(wx) + 0.012, top = castSkin([wx, 1.6, wz], [0, -1, 0]);
    const wiper = new THREE.Group(); wiper.position.set(wx, (top ? top.p.y : 1.0) + 0.012, wz);
    // local x runs across the glass (the arm at rest), local y up the glass, local z into it
    const up = new THREE.Vector3(0, yGlassAt(0, -0.85) - yGlassAt(0, -1.0), 0.15).normalize();
    const bx = new THREE.Vector3(1, 0, 0), bz = new THREE.Vector3().crossVectors(bx, up);
    wiper.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(bx, up, bz));
    chassis.add(wiper);
    wiperArm = new THREE.Group(); wiper.add(wiperArm);
    const wb = new Batch();
    wb.add(new THREE.CylinderGeometry(0.014, 0.016, 0.024, 12), M.black, 0, 0, -0.006, Math.PI / 2, 0, 0);
    wb.add(new THREE.BoxGeometry(0.66, 0.011, 0.009), M.black, 0.34, 0.014, -0.02);
    wb.add(new THREE.BoxGeometry(0.64, 0.022, 0.006), M.trim, 0.41, 0.002, -0.009);
    wiperArm.add(wb.mesh());
  }

  // ---------- wheels ----------
  const discTex = (() => {
    if (viz) return null;
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    x.fillStyle = '#8a8c8f'; x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 400; i++) { const v = 110 + Math.random() * 60; x.strokeStyle = `rgba(${v},${v},${v},0.25)`; x.beginPath(); x.arc(64, 64, 20 + Math.random() * 44, 0, Math.PI * 2); x.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const WM = {
    tire: new THREE.MeshStandardMaterial(viz ? { color: 0x141416, roughness: 0.88 } : { color: 0xffffff, map: tyreTexture(), roughness: 0.86 }),
    rim: viz ? new THREE.MeshStandardMaterial({ color: 0x8d9196, roughness: 0.4 }) : new THREE.MeshPhysicalMaterial({ color: 0x6a6e74, roughness: 0.3, metalness: 0.85, clearcoat: 0.7, clearcoatRoughness: 0.08 }),
    rimLip: viz ? new THREE.MeshStandardMaterial({ color: 0x8d9196, roughness: 0.4 }) : new THREE.MeshStandardMaterial({ color: 0x9a9ea3, roughness: 0.22, metalness: 0.9 }),
    rimInner: new THREE.MeshStandardMaterial({ color: 0x1d1e20, roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide }),
    rimWall: new THREE.MeshStandardMaterial({ color: 0x303236, roughness: 0.45, metalness: 0.6 }),
    cap: new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.25, metalness: 0.6 }),
    capLogo: new THREE.MeshStandardMaterial({ color: 0x9a9ea3, roughness: 0.3, metalness: 0.9 }),
    disc: new THREE.MeshStandardMaterial({ color: 0xffffff, map: discTex, roughness: 0.42, metalness: 0.85 }),
    hub: new THREE.MeshStandardMaterial({ color: 0x3a3b3d, roughness: 0.6, metalness: 0.6 }),
  };
  const wheels = [];
  const calG = (() => { const sh = new THREE.Shape(); sh.absarc(0, 0, 0.198, -0.45, 0.45, false); sh.absarc(0, 0, 0.132, 0.45, -0.45, true); return new THREE.ExtrudeGeometry(sh, { depth: 0.058, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 10 }); })();
  const calM = new THREE.MeshStandardMaterial({ color: 0x1c1c1f, roughness: 0.35, metalness: 0.3 });
  for (const [z, front] of [[AXLE_F, true], [AXLE_R, false]]) for (const s of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(s * TRACK, WHEEL_R, z);
    const spin = new THREE.Group(); pivot.add(spin);
    spin.add(wheelAssembly(WM, s, viz));
    if (!viz) {
      // caliper: an arc straddling the disc, upper rear on the front wheels and upper front on the rear
      const cal = new THREE.Mesh(calG, calM); cal.rotation.y = Math.PI / 2; cal.position.x = -s * 0.012 - 0.029;
      const cg = new THREE.Group(); cg.add(cal); cg.rotation.x = front ? 2.2 : 0.95; pivot.add(cg);
    }
    root.add(pivot);
    wheels.push({ pivot, spin, front, side: s });
  }

  // ---------- interior ----------
  // Everything static is batched into a few meshes (the large pieces cast shadows). Every clickable control
  // is a small mesh of its own so the driver's raycast can pick it, and every moving part (lids, visors,
  // windows, stalk, scroll wheels, mirrors) is a small mesh or group of its own.
  const I = { controls: [], byAction: new Map(), win: {}, lids: {}, gearM: {}, stalk: null, stalkFlick: 0, roll: 0, rollCur: 0, rollers: [], rearOn: false, rearM: null };
  let steeringSpin = null, screenMesh = null;
  const domeLights = [];
  if (!viz) {
    // --- procedural textures: perforated leather, carpet, the textile band, speaker grilles, the T ---
    const perfTex = canvasTex(128, 128, (x) => {
      x.fillStyle = '#242427'; x.fillRect(0, 0, 128, 128);
      x.fillStyle = '#0e0e10';
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { x.beginPath(); x.arc(8 + i * 16, 8 + j * 16, 2.2, 0, Math.PI * 2); x.fill(); }
      x.fillStyle = 'rgba(255,255,255,0.03)'; for (let i = 0; i < 300; i++) x.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
    }, { repeat: [5, 5] });
    const carpetTex = canvasTex(128, 128, (x) => {
      x.fillStyle = '#141415'; x.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 2600; i++) { const v = Math.round(14 + Math.random() * 24); x.fillStyle = `rgb(${v},${v},${v + 1})`; x.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5); }
    }, { repeat: [10, 10] });
    const fabricTex = canvasTex(64, 64, (x) => {
      x.fillStyle = '#4c4a47'; x.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 64; i += 4) { x.fillStyle = '#575552'; x.fillRect(i, 0, 2, 64); x.fillStyle = '#3e3c3a'; x.fillRect(0, i + 2, 64, 1); }
    }, { repeat: [40, 2] });
    const grilleTex = canvasTex(64, 64, (x) => {
      x.fillStyle = '#1c1c1e'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#050506';
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { x.beginPath(); x.arc(4 + i * 8, 4 + j * 8, 2, 0, Math.PI * 2); x.fill(); }
    }, { repeat: [16, 2] });
    const tTex = canvasTex(128, 128, (x) => {
      x.fillStyle = '#fff'; x.beginPath();
      x.moveTo(64, 118); x.lineTo(55, 58); x.lineTo(20, 48); x.quadraticCurveTo(64, 14, 108, 48); x.lineTo(73, 58); x.closePath(); x.fill();
    }, { srgb: false });
    const phoneTex = canvasTex(64, 128, (x) => {
      const gr = x.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#1b2a4a'); gr.addColorStop(1, '#070a14'); x.fillStyle = gr; x.fillRect(0, 0, 64, 128);
      x.fillStyle = '#fff'; x.font = 'bold 16px Arial'; x.textAlign = 'center'; x.fillText('9:41', 32, 40); x.fillStyle = '#000'; x.fillRect(22, 0, 20, 5);
    });
    const rearTex = canvasTex(256, 160, (x) => {
      x.fillStyle = '#000'; x.fillRect(0, 0, 256, 160);
      x.fillStyle = '#fff'; x.textAlign = 'center'; x.font = 'bold 44px Arial'; x.fillText('70°', 64, 86); x.fillText('70°', 192, 86);
      x.font = '14px Arial'; x.fillStyle = '#9aa0a8'; x.fillText('Climate', 128, 28); x.fillText('Media', 64, 136); x.fillText('Seat heat', 192, 136);
      x.fillStyle = '#3d8bff'; x.fillRect(96, 104, 64, 4);
    });
    const im = {
      dash: new THREE.MeshStandardMaterial({ color: 0x1f1f21, roughness: 0.82 }),
      black: new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.7 }),
      fabric: new THREE.MeshStandardMaterial({ map: fabricTex, roughness: 1 }),
      leather: new THREE.MeshPhysicalMaterial({ map: perfTex, roughness: 0.5, sheen: 0.3, sheenColor: new THREE.Color(0x3a3a3e), sheenRoughness: 0.7 }),
      hide: new THREE.MeshPhysicalMaterial({ color: 0x202023, roughness: 0.48, sheen: 0.3, sheenColor: new THREE.Color(0x3a3a3e), sheenRoughness: 0.7 }),
      gloss: new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.06, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03 }),
      carpet: new THREE.MeshStandardMaterial({ map: carpetTex, roughness: 1 }),
      metal: new THREE.MeshStandardMaterial({ color: 0xa8acb1, metalness: 0.85, roughness: 0.3 }),
      knurl: new THREE.MeshStandardMaterial({ color: 0x2c2d30, metalness: 0.7, roughness: 0.38 }),
      head: new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.95 }),
      grille: new THREE.MeshStandardMaterial({ map: grilleTex, roughness: 0.6 }),
      belt: new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.9 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.96 }),
      cup: new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.6 }),
      led: new THREE.MeshStandardMaterial({ color: 0x0a1a30, emissive: 0x3d8bff, emissiveIntensity: 0 }),
      hazard: new THREE.MeshStandardMaterial({ color: 0x5a1010, emissive: 0xff2a1a, emissiveIntensity: 0.15 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 1, roughness: 0.2, alphaMap: tTex, transparent: true }),
      phone: new THREE.MeshBasicMaterial({ map: phoneTex, toneMapped: false }),
    };
    envMats.push(im.gloss, im.chrome);
    I.mats = im;
    const big = new Batch(), small = new Batch();
    const B = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => big.add(geo, mat, x, y, z, rx, ry, rz);
    const S = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => small.add(geo, mat, x, y, z, rx, ry, rz);
    const RB = (w, h, d, r = 0.01, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, r);
    const BX = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const CY = (rt, rb, h, n = 16, open = false, t0 = 0, tl = Math.PI * 2) => new THREE.CylinderGeometry(rt, rb, h, n, 1, open, t0, tl);
    const H2 = Math.PI / 2;
    // a clickable control: its own mesh carrying the action and hover label, pushed in briefly when pressed
    const ctrlMesh = (m, parent, action, label, dir = [0, 0, -1], depth = 0.003) => {
      parent.add(m); m.userData.action = action; m.userData.inside = true; m.userData.label = label; interact.push(m);
      const c = { mesh: m, rest: m.position.clone(), dir: new THREE.Vector3(...dir), depth, t: 0 };
      I.controls.push(c); let l = I.byAction.get(action); if (!l) I.byAction.set(action, (l = [])); l.push(c);
      return m;
    };
    const ctrl = (geo, mat, parent, x, y, z, action, label, dir, depth, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); return ctrlMesh(m, parent, action, label, dir, depth); };
    const lid = (key, o) => { I.lids[key] = { cur: 0, target: 0, speed: 2.2, ...o }; return I.lids[key]; };

    // --- dashboard: a long low shelf under the cowl, a vertical lip, the textile band with the ambient
    // strip along its top edge, and the knee bolster curving under (side profile z, y extruded across) ---
    const prof = [[-1.07, 0.93], [-0.78, 0.952], [-0.63, 0.958], [-0.588, 0.952], [-0.566, 0.93], [-0.562, 0.902], [-0.58, 0.898], [-0.582, 0.8], [-0.566, 0.792], [-0.572, 0.7], [-0.63, 0.6], [-0.74, 0.56], [-0.92, 0.55], [-1.07, 0.55]];
    const sh = new THREE.Shape(); prof.forEach((p, i) => (i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1])));
    const dg = new THREE.ExtrudeGeometry(sh, { depth: 1.62, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2 });
    dg.rotateY(-Math.PI / 2); dg.translate(0.81, 0, 0);
    B(dg, im.dash);
    S(BX(1.56, 0.03, 0.1), im.black, 0, 0.94, -1.1);            // cowl trim under the windshield
    S(BX(1.3, 0.006, 0.09), im.grille, 0, 0.962, -0.95);         // slim sound-bar grille along the base of the glass
    S(BX(1.58, 0.08, 0.012), im.fabric, 0, 0.843, -0.58);        // textile band, recessed under the lip
    S(BX(1.58, 0.01, 0.02), im.black, 0, 0.889, -0.575);         // the vent slot: air comes out of the gap under the lip
    S(BX(1.58, 0.004, 0.006), Lm.ambient, 0, 0.897, -0.57);      // ambient light strip
    S(BX(1.6, 0.3, 0.04), im.black, 0, 0.42, -1.07);             // toe board
    for (const s of [-1, 1]) S(BX(0.2, 0.004, 0.004), Lm.ambient, s * 0.37, 0.53, -0.66); // footwell lights
    // glovebox: a lid in the passenger's knee bolster, hinged along its bottom edge
    {
      const gx = 0.46, gy = 0.6, gz = -0.615, tilt = 0.28;
      S(BX(0.52, 0.22, 0.004), im.black, gx, gy + 0.1 * Math.cos(tilt), gz + 0.1 * Math.sin(tilt) - 0.002, tilt); // shut line
      const gg = new THREE.Group(); gg.position.set(gx, gy, gz); gg.rotation.x = tilt; chassis.add(gg);
      const lg = new Batch(); lg.add(RB(0.5, 0.2, 0.025, 0.006), im.dash, 0, 0.1, 0.004); lg.add(RB(0.05, 0.012, 0.006, 0.002, 1), im.metal, 0, 0.17, 0.018);
      ctrlMesh(lg.mesh(), gg, 'glovebox', 'Glovebox', [0, 0, 0], 0);
      lid('glovebox', { grp: gg, apply: (f) => { gg.rotation.x = tilt + 1.15 * f; } });
    }
    // A-pillar trims from the dash corners up to the roof corners
    for (const s of [-1, 1]) S(barGeo([s * 0.76, 0.98, -1.0], [s * 0.6, yGlassAt(0.6, -0.42) - 0.03, -0.42], 0.07, 0.09), im.head);

    // --- touchscreen floating on a short stand ---
    const scr = new THREE.Group(); scr.position.set(0, 1.045, -0.585); scr.rotation.x = -0.12; chassis.add(scr);
    {
      const sb = new Batch();
      sb.add(RB(0.364, 0.222, 0.016, 0.006), im.gloss, 0, 0, 0);
      sb.add(RB(0.3, 0.17, 0.02, 0.008), im.black, 0, -0.01, -0.016);
      sb.add(RB(0.11, 0.1, 0.05, 0.012), im.black, 0, -0.1, -0.045);
      scr.add(sb.mesh());
    }
    screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.348, 0.207), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    screenMesh.position.z = 0.0085; screenMesh.userData.screen = true; scr.add(screenMesh);

    // --- steering column and the round two-spoke wheel with its scroll wheels ---
    const sw = new THREE.Group(); sw.position.set(EYE.x, 0.93, -0.33); sw.rotation.x = -0.38; chassis.add(sw);
    const spin = new THREE.Group(); sw.add(spin); steeringSpin = spin;
    {
      const cb = new Batch();
      cb.add(CY(0.04, 0.052, 0.3, 20), im.dash, 0, -0.005, -0.2, H2, 0, 0);
      cb.add(RB(0.22, 0.1, 0.22, 0.03), im.dash, 0, -0.075, -0.3);
      sw.add(cb.mesh());
      const wb = new Batch();
      wb.add(new THREE.TorusGeometry(0.183, 0.0185, 10, 48), im.hide);
      wb.add(new THREE.TorusGeometry(0.183, 0.0192, 8, 10, 0.16), new THREE.MeshStandardMaterial({ color: 0x3a3b3e, roughness: 0.6 }), 0, 0, 0, 0, 0, H2 - 0.08); // stitched top-centre mark
      wb.add(CY(0.07, 0.078, 0.05, 24), im.black, 0, 0, -0.025, H2, 0, 0);
      for (const s of [-1, 1]) {
        wb.add(RB(0.12, 0.046, 0.028, 0.01), im.hide, s * 0.118, -0.012, -0.004);
        wb.add(RB(0.1, 0.007, 0.004, 0.002, 1), im.metal, s * 0.12, -0.037, 0.011);
      }
      wb.add(RB(0.04, 0.12, 0.026, 0.01), im.hide, 0, -0.12, -0.004);
      wb.add(RB(0.006, 0.09, 0.004, 0.002, 1), im.metal, 0, -0.12, 0.011);
      spin.add(wb.mesh());
      // horn pad with the T and the FSD indicator
      const hb = new Batch();
      hb.add(RB(0.15, 0.125, 0.045, 0.02, 3), im.hide, 0, 0, 0);
      hb.add(new THREE.PlaneGeometry(0.034, 0.034), im.chrome, 0, 0.012, 0.0235);
      hb.add(BX(0.016, 0.004, 0.003), im.led, 0, 0.05, 0.0235);
      const horn = hb.mesh(); horn.position.set(0, 0, 0.006);
      ctrlMesh(horn, spin, 'horn', 'Horn', [0, 0, -1], 0.004);
      // scroll wheels: right engages FSD, left rolls the volume (upper half up, lower half down) and
      // presses for play / pause
      ctrl(CY(0.0125, 0.0125, 0.027, 18), im.knurl, spin, 0.082, -0.012, 0.016, 'fsd', 'Engage FSD', [0, 0, -1], 0.003, 0, 0, H2);
      I.rollers.push(
        ctrl(CY(0.0125, 0.0125, 0.027, 18, false, 0, Math.PI), im.knurl, spin, -0.082, -0.012, 0.016, 'volUp', 'Volume up', [0, 0, -1], 0.002, 0, 0, H2),
        ctrl(CY(0.0125, 0.0125, 0.027, 18, false, Math.PI, Math.PI), im.knurl, spin, -0.082, -0.012, 0.016, 'volDown', 'Volume down', [0, 0, -1], 0.002, 0, 0, H2),
        ctrl(CY(0.0135, 0.0135, 0.007, 18), im.metal, spin, -0.082, -0.012, 0.016, 'media', 'Play / pause', [0, 0, -1], 0.003, 0, 0, H2),
      );
      // turn-signal stalk on the left of the column (no gear stalk on the Juniper): lower half signals
      // left, upper half right, the button on its end works the wipers
      const stalk = new THREE.Group(); stalk.position.set(-0.068, 0.012, -0.075); stalk.rotation.y = 0.3; sw.add(stalk); I.stalk = stalk;
      ctrl(CY(0.011, 0.014, 0.125, 12, false, 0, Math.PI), im.black, stalk, -0.0625, 0, 0, 'sig:R', 'Right turn signal', [0, 0, 0], 0, 0, 0, H2);
      ctrl(CY(0.011, 0.014, 0.125, 12, false, Math.PI, Math.PI), im.black, stalk, -0.0625, 0, 0, 'sig:L', 'Left turn signal', [0, 0, 0], 0, 0, 0, H2);
      ctrl(CY(0.0115, 0.0115, 0.012, 12), im.knurl, stalk, -0.131, 0, 0, 'wiper', 'Wipers', [1, 0, 0], 0.003, 0, 0, H2);
    }

    // --- seats: sculpted cushions with bolsters, reclined backrests with integrated headrests ---
    const seat = (x, z, s) => {
      B(RB(0.5, 0.12, 0.5, 0.04, 3), im.leather, x, 0.515, z, 0.06);
      for (const q of [-1, 1]) B(RB(0.09, 0.075, 0.44, 0.03), im.leather, x + q * 0.215, 0.575, z - 0.02, 0.06);
      B(RB(0.5, 0.64, 0.11, 0.04, 3), im.leather, x, 0.86, z + 0.3, 0.2);
      for (const q of [-1, 1]) B(RB(0.08, 0.5, 0.13, 0.03), im.leather, x + q * 0.215, 0.85, z + 0.26, 0.2);
      B(RB(0.27, 0.17, 0.1, 0.04, 3), im.leather, x, 1.253, z + 0.381, 0.2);
      B(RB(0.52, 0.62, 0.04, 0.015), im.black, x, 0.847, z + 0.364, 0.2);
      B(BX(0.42, 0.12, 0.42), im.black, x, 0.4, z);
      for (const q of [-1, 1]) S(BX(0.03, 0.03, 0.56), im.metal, x + q * 0.18, 0.335, z + 0.03);
      for (const dz of [-0.1, 0.08]) S(RB(0.014, 0.012, 0.05, 0.004, 1), im.metal, x + s * 0.258, 0.5, z + dz); // seat adjusters
      S(RB(0.03, 0.07, 0.028, 0.006), im.black, x - s * 0.21, 0.575, z + 0.14);                                 // belt buckle
      S(BX(0.012, 0.006, 0.012), new THREE.MeshStandardMaterial({ color: 0xc0201a, roughness: 0.5 }), x - s * 0.21, 0.611, z + 0.14);
    };
    seat(-0.37, 0.02, -1); seat(0.37, 0.02, 1);
    // rear bench: three seats, headrests, belt buckles
    B(RB(1.34, 0.14, 0.5, 0.05, 3), im.leather, 0, 0.52, 1.0, 0.05);
    B(RB(1.36, 0.62, 0.12, 0.05, 3), im.leather, 0, 0.87, 1.29, 0.26);
    for (const x of [-0.3, 0.3]) { S(BX(0.012, 0.03, 0.46), im.black, x, 0.585, 1.0, 0.05); S(BX(0.012, 0.58, 0.03), im.black, x, 0.87, 1.235, 0.26); }
    for (const x of [-0.45, 0, 0.45]) B(RB(0.26, 0.14, 0.09, 0.035), im.leather, x, 1.24, 1.39, 0.26);
    for (const x of [-0.2, -0.08, 0.08, 0.2]) S(RB(0.028, 0.06, 0.024, 0.006), im.black, x, 0.6, 1.2);
    // floor: carpet, rubber mats, pedals
    B(BX(1.64, 0.02, 2.62), im.carpet, 0, 0.31, 0.25);
    for (const [x, z] of [[-0.37, -0.55], [0.37, -0.55], [-0.42, 0.55], [0.42, 0.55]]) S(BX(0.46, 0.008, 0.58), im.rubber, x, 0.324, z);
    S(BX(0.065, 0.13, 0.012), im.knurl, EYE.x + 0.1, 0.43, -0.86, -0.55);
    S(BX(0.1, 0.06, 0.014), im.knurl, EYE.x - 0.05, 0.45, -0.84, -0.4);
    S(BX(0.014, 0.2, 0.014), im.black, EYE.x - 0.05, 0.56, -0.82, -0.25);

    // --- centre console: cubby, two charging pads, cup holders under a sliding cover, the armrest bin and
    // the rear display on its back ---
    B(RB(0.26, 0.26, 0.8, 0.03), im.dash, 0, 0.49, -0.24);                       // front tub (z -0.64..0.16)
    B(BX(0.26, 0.04, 0.44), im.dash, 0, 0.38, 0.38);                              // bin floor and walls (z 0.16..0.6)
    for (const s of [-1, 1]) B(BX(0.025, 0.26, 0.44), im.dash, s * 0.1175, 0.49, 0.38);
    B(BX(0.26, 0.26, 0.03), im.dash, 0, 0.49, 0.585);
    S(BX(0.2, 0.004, 0.4), im.rubber, 0, 0.402, 0.38);
    S(BX(0.24, 0.006, 0.62), im.gloss, 0, 0.623, -0.3);                            // piano-black top
    S(BX(0.2, 0.004, 0.1), im.rubber, 0, 0.627, -0.56);                            // front cubby mat
    for (const s of [-1, 1]) {
      ctrl(BX(0.096, 0.005, 0.19), im.rubber, chassis, s * 0.058, 0.642, -0.37, 'pad:' + (s < 0 ? 'L' : 'R'), 'Phone charger', [0, -1, 0], 0.001, -0.12);
      const pb = new Batch(); pb.add(RB(0.074, 0.009, 0.152, 0.004), im.gloss); pb.add(new THREE.PlaneGeometry(0.066, 0.142), im.phone, 0, 0.0046, 0, -H2, 0, 0);
      const phone = pb.mesh(); phone.position.set(s * 0.058, 0.65, -0.37); phone.rotation.x = -0.12; phone.visible = false; chassis.add(phone);
      lid('pad:' + (s < 0 ? 'L' : 'R'), { on: false, mesh: phone });
      S(CY(0.038, 0.034, 0.06, 20, true), im.black, s * 0.055, 0.6, -0.12);         // cup holders
      S(new THREE.CircleGeometry(0.034, 20), im.rubber, s * 0.055, 0.571, -0.12, -H2, 0, 0);
    }
    {
      const cover = ctrl(RB(0.2, 0.006, 0.17, 0.003, 1), im.gloss, chassis, 0, 0.628, -0.12, 'cupholder', 'Cup holders', [0, 0, 0], 0);
      const cg = new Batch(); cg.add(CY(0.04, 0.034, 0.12, 20), im.cup); cg.add(CY(0.041, 0.041, 0.008, 20), im.black, 0, 0.062, 0);
      const cup = cg.mesh(); cup.position.set(0.055, 0.63, -0.12); cup.visible = false; chassis.add(cup);
      lid('cupholder', { speed: 2.5, apply: (f) => { cover.position.z = -0.12 + 0.17 * f; cup.visible = f > 0.4; } });
      S(BX(0.012, 0.004, 0.003), im.rubber, -0.02, 0.44, 0.602); S(BX(0.012, 0.004, 0.003), im.rubber, 0.02, 0.44, 0.602); // rear USB-C
      S(BX(0.16, 0.025, 0.004), im.black, 0, 0.41, 0.602);                                                            // rear vent
      // armrest lid hinged at the back of the bin
      const ag = new THREE.Group(); ag.position.set(0, 0.62, 0.6); chassis.add(ag);
      const lg = RB(0.27, 0.05, 0.44, 0.02); lg.translate(0, 0.025, -0.22);
      ctrlMesh(new THREE.Mesh(lg, im.hide), ag, 'armrest', 'Centre console', [0, 0, 0], 0);
      lid('armrest', { grp: ag, apply: (f) => { ag.rotation.x = 1.25 * f; } });
      // 8" rear display
      const rg = new THREE.Group(); rg.position.set(0, 0.53, 0.605); rg.rotation.x = -0.18; chassis.add(rg);
      const rb = new Batch(); rb.add(RB(0.2, 0.13, 0.012, 0.004), im.gloss); rg.add(rb.mesh());
      I.rearM = new THREE.MeshBasicMaterial({ map: rearTex, color: 0x000000, toneMapped: false });
      ctrl(new THREE.PlaneGeometry(0.172, 0.106), I.rearM, rg, 0, 0, 0.0065, 'rearScreen', 'Rear display', [0, 0, -1], 0.001);
    }

    // --- roof: crowned header boards, side rails, grab handles, the overhead console with the map lights,
    // the hazard button and the P R N D backup shifter, sun visors, the frameless mirror ---
    const header = (zc, depth, x0) => {
      const s2 = new THREE.Shape(), n = 10;
      for (let i = 0; i <= n; i++) { const x = lerp(-x0, x0, i / n), y = yGlassAt(x, zc) - 0.028; i ? s2.lineTo(x, y) : s2.moveTo(x, y); }
      for (let i = n; i >= 0; i--) s2.lineTo(lerp(-x0, x0, i / n), yGlassAt(lerp(-x0, x0, i / n), zc) - 0.062);
      s2.closePath();
      const g = new THREE.ExtrudeGeometry(s2, { depth, bevelEnabled: false }); g.translate(0, 0, zc - depth / 2); return g;
    };
    B(header(-0.33, 0.14, 0.64), im.head); B(header(1.2, 0.1, 0.6), im.head);
    for (const s of [-1, 1]) {
      const pts = []; for (let i = 0; i <= 6; i++) { const z = lerp(-0.3, 1.15, i / 6); pts.push([s * 0.62, yGlassAt(0.62, z) - 0.045, z]); }
      for (let i = 0; i < 6; i++) S(barGeo(pts[i], pts[i + 1], 0.09, 0.035), im.head);
      S(RB(0.028, 0.026, 0.2, 0.01), im.head, s * 0.58, yGlassAt(0.58, 0.8) - 0.085, 0.8);
    }
    S(RB(0.028, 0.026, 0.2, 0.01), im.head, 0.58, yGlassAt(0.58, -0.05) - 0.085, -0.05);
    const oy = yGlassAt(0, -0.2) - 0.03, oyb = oy - 0.032;
    B(RB(0.3, 0.032, 0.16, 0.01), im.head, 0, oy - 0.016, -0.2);
    ctrl(RB(0.032, 0.008, 0.022, 0.003, 1), im.hazard, chassis, 0, oyb - 0.003, -0.255, 'hazard', 'Hazard lights', [0, 1, 0], 0.003);
    ['P', 'R', 'N', 'D'].forEach((gk, i) => {
      const x = -0.054 + i * 0.036;
      ctrl(RB(0.03, 0.008, 0.02, 0.003, 1), im.black, chassis, x, oyb - 0.003, -0.2, 'gear:' + gk, { P: 'Park', R: 'Reverse', N: 'Neutral', D: 'Drive' }[gk], [0, 1, 0], 0.003);
      I.gearM[gk] = new THREE.MeshStandardMaterial({ color: 0x222224, emissive: 0xffffff, emissiveIntensity: 0.3, alphaMap: textTex(gk, 64, 64, 'bold 44px Arial'), transparent: true });
      S(new THREE.PlaneGeometry(0.016, 0.016), I.gearM[gk], x, oyb - 0.0075, -0.2, H2, 0, 0);
    });
    for (const s of [-1, 1]) {
      const key = 'dome:' + (s < 0 ? 'L' : 'R');
      const lensM = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, emissive: 0xfff1dd, emissiveIntensity: 0 });
      ctrl(CY(0.018, 0.018, 0.006, 16), lensM, chassis, s * 0.11, oyb - 0.002, -0.17, key, 'Reading light', [0, 1, 0], 0.002);
      const pl = new THREE.PointLight(0xfff1dd, 0, 2.4, 2); pl.position.set(s * 0.11, oyb - 0.03, -0.17); chassis.add(pl); domeLights.push(pl);
      lid(key, { speed: 6, apply: (f) => { lensM.emissiveIntensity = f * 2.5; pl.intensity = f * 2.5; } });
      // sun visor hinged along its front edge, a vanity mirror on the face that shows when it is down
      const vg = new THREE.Group(); vg.position.set(s * 0.36, yGlassAt(0.36, -0.3) - 0.075, -0.37); chassis.add(vg);
      const vb = new Batch(); vb.add(RB(0.3, 0.012, 0.16, 0.005), im.head, 0, 0, 0.08); vb.add(new THREE.PlaneGeometry(0.1, 0.07), mirrorM, s * 0.03, 0.0065, 0.08, -H2, 0, 0);
      ctrlMesh(vb.mesh(), vg, 'visor:' + (s < 0 ? 'L' : 'R'), 'Sun visor', [0, 0, 0], 0);
      lid('visor:' + (s < 0 ? 'L' : 'R'), { speed: 3, apply: (f) => { vg.rotation.x = 1.5 * f; } });
    }
    {
      const mv = new THREE.Group(); mv.position.set(0, 1.4, -0.29); mv.rotation.set(-0.06, -0.22, 0); chassis.add(mv);
      const mb = new Batch();
      mb.add(RB(0.25, 0.075, 0.022, 0.008), im.black);
      mb.add(new THREE.PlaneGeometry(0.236, 0.063), mirrorM, 0, 0, 0.0115);
      mb.add(BX(0.028, 0.028, 0.06), im.black, 0, 0.03, -0.035);
      mv.add(mb.mesh());
      S(RB(0.13, 0.045, 0.07, 0.015), im.black, 0, yGlassAt(0, -0.35) - 0.035, -0.345); // cabin camera housing on the glass
    }
    // B-pillar trims follow the inward lean of the greenhouse; belt guide and the retracted belt down each
    {
      const c = sectionCtrl(0.3), b = c[8], r = c[11], len = Math.hypot(r[0] - b[0], r[1] - b[1]) - 0.06, ang = Math.atan2(b[0] - r[0], r[1] - b[1]);
      for (const s of [-1, 1]) {
        const xm = (b[0] + r[0]) / 2 - 0.045, ym = (b[1] + r[1]) / 2;
        B(BX(0.03, len, 0.1), im.head, s * xm, ym, 0.3, 0, 0, s * ang);
        S(RB(0.03, 0.04, 0.06, 0.008), im.black, s * (xm - 0.012), ym + 0.1, 0.3, 0, 0, s * ang);
        S(barGeo([s * (xm - 0.024), ym + 0.08, 0.3], [s * (b[0] - 0.09), 0.5, 0.33], 0.003, 0.047), im.belt);
        S(RB(0.05, 0.03, 0.02, 0.006), im.metal, s * (b[0] - 0.09), 0.52, 0.33);
      }
    }
    // trunk + frunk tubs
    B(BX(1.36, 0.04, 0.88), im.carpet, 0, 0.66, 1.86);
    B(BX(0.88, 0.04, 0.9), im.carpet, 0, 0.6, -1.72);
    for (const s of [-1, 1]) S(BX(0.03, 0.17, 0.9), im.carpet, s * 0.445, 0.69, -1.72);
    S(BX(0.9, 0.17, 0.03), im.carpet, 0, 0.69, -2.155);

    // --- door cards: sill trim at the belt, ambient strip, textile band, armrest with the pull pocket, the
    // electronic release and window switches on the armrest, lower card with the map pocket and speaker;
    // the door's own glass becomes a pane that drops away from the top when the window opens ---
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    for (const [k, d] of Object.entries(doors)) {
      if (k === 'frunk' || k === 'trunk') continue;
      const s = k.endsWith('L') ? -1 : 1, front = k.startsWith('F'), p = d.grp.position, db = batchOf(d.grp);
      const z0 = front ? -0.95 : 0.33, z1 = front ? 0.26 : 1.0, zl = z1 - z0, zc = (z0 + z1) / 2;
      const D = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => db.add(geo, mat, s * x - p.x, y - p.y, z - p.z, rx, ry, rz);
      D(RB(0.07, 0.03, zl, 0.01), im.black, 0.82, 1.075, zc);
      D(BX(0.04, 0.16, zl), im.dash, 0.835, 0.985, zc);
      D(BX(0.004, 0.004, zl * 0.9), Lm.ambient, 0.808, 0.9, zc);
      D(BX(0.03, 0.082, zl * 0.94), im.fabric, 0.82, 0.852, zc);
      D(RB(0.1, 0.07, zl * 0.62, 0.025), im.hide, 0.79, 0.745, zc + 0.08);
      D(BX(0.07, 0.05, 0.2), im.black, 0.8, 0.72, zc - 0.22);
      D(RB(0.012, 0.012, 0.18, 0.005, 1), im.metal, 0.752, 0.74, zc - 0.22);
      D(BX(0.06, 0.3, zl * 0.96), im.dash, 0.845, 0.57, zc);
      D(BX(0.035, 0.11, zl * 0.5), im.black, 0.805, 0.47, zc + 0.05);
      if (front) D(BX(0.006, 0.15, 0.2), im.grille, 0.814, 0.6, zc - 0.25);
      const zb = front ? -0.44 : 0.47;
      ctrl(RB(0.018, 0.012, 0.045, 0.004), im.metal, d.grp, s * 0.78 - p.x, 0.787 - p.y, zb - p.z, k, 'Open door', [0, -1, 0], 0.003);
      const wins = front ? [[k, zb + 0.08], [s < 0 ? 'RL' : 'RR', zb + 0.125]] : [[k, zb + 0.08]];
      for (const [wk, wz] of wins) ctrl(RB(0.024, 0.01, 0.03, 0.003, 1), im.gloss, d.grp, s * 0.78 - p.x, 0.785 - p.y, wz - p.z, 'win:' + wk, 'Window', [0, -1, 0], 0.003);
      if (k === 'FL') ctrl(RB(0.024, 0.01, 0.03, 0.003, 1), im.gloss, d.grp, s * 0.78 - p.x, 0.785 - p.y, zb + 0.18 - p.z, 'mirrorFold', 'Fold mirrors', [0, -1, 0], 0.003);
      const dgeo = parts['door' + k].g;
      if (dgeo.groups.some((q) => q.materialIndex === 1)) {
        d.mesh.material = matList.map((m, i) => (i === 1 ? hidden : m));
        const pane = groupGeo(dgeo, 1), pa = pane.attributes.position;
        let yMin = 1e9, yMax = -1e9;
        for (let i = 0; i < pa.count; i++) { const y = pa.getY(i); yMin = Math.min(yMin, y); yMax = Math.max(yMax, y); }
        const cut = { value: yMax + 0.05 }, pm = M.glass.clone();
        pm.onBeforeCompile = (shd) => {
          shd.uniforms.uCut = cut;
          shd.vertexShader = shd.vertexShader.replace('#include <common>', '#include <common>\nvarying float vCutY;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvCutY = position.y;');
          shd.fragmentShader = shd.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uCut;\nvarying float vCutY;').replace('#include <clipping_planes_fragment>', 'if (vCutY > uCut) discard;\n#include <clipping_planes_fragment>');
        };
        pm.customProgramCacheKey = () => 'wincut';
        envMats.push(pm);
        const pmesh = new THREE.Mesh(pane, pm); pmesh.position.copy(p).negate(); d.grp.add(pmesh);
        I.win[k] = { cur: 0, target: 0, cut, yMin, yMax };
      }
    }
    chassis.add(big.mesh({ shadow: true }), small.mesh());
  }
  // merge the static decals, trims and door cards: one mesh per group
  for (const [parent, b] of batches) { const m = b.mesh({ shadow: parent !== chassis }); if (m) parent.add(m); }

  // headlight spots
  const spots = [];
  if (!viz) {
    for (const s of [-1, 1]) {
      const sp = new THREE.SpotLight(0xf4f6ff, 0, 95, 0.42, 0.55, 1.4);
      sp.position.set(s * 0.64, 0.52, -2.3);
      sp.target.position.set(s * 0.9, 0, -28);
      chassis.add(sp, sp.target);
      spots.push(sp);
    }
  }

  const car = {
    root, chassis, doors, wheels, steeringSpin, screenMesh, lights: Lm, spots, interact, mats: M, chargeFlap,
    setPaint(c) { applyFinish(M.paint, c); },
    toggle(name) { const d = doors[name]; if (!d) return false; d.target = d.target > 0.5 ? 0 : 1; return d.target > 0.5; },
    isOpen(name) { return doors[name].target > 0.5; },
    anyDoorOpen() { return ['FL', 'FR', 'RL', 'RR'].some((k) => doors[k].cur > 0.02 || doors[k].target > 0.5); },
    chargeOpen: 0, chargeTarget: 0,
    wiperPhase: 0,
    // an interior control was clicked: animate the press; true when the model handles the action itself
    press(action) {
      const l = I.byAction.get(action); if (l) for (const c of l) c.t = 1e-4;
      const ld = I.lids[action];
      if (action === 'sig:L' || action === 'sig:R') { I.stalkFlick = action === 'sig:R' ? -0.22 : 0.22; return false; }
      if (action === 'volUp' || action === 'volDown') { I.roll += action === 'volUp' ? -0.7 : 0.7; return false; }
      if (action.startsWith('win:')) { const w = I.win[action.slice(4)]; if (w) w.target = w.target > 0.5 ? 0 : 1; return true; }
      if (action.startsWith('pad:')) { if (ld) { ld.on = !ld.on; ld.mesh.visible = ld.on; } return true; }
      if (action === 'mirrorFold') { mirrorFold.target = mirrorFold.target > 0.5 ? 0 : 1; return true; }
      if (action === 'rearScreen') { I.rearOn = !I.rearOn; if (I.rearM) I.rearM.color.setScalar(I.rearOn ? 1 : 0); return true; }
      if (ld && ld.apply) { ld.target = ld.target > 0.5 ? 0 : 1; return true; }
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
      // reflections: the game hands the paint its environment map; the glass, mirrors and gloss share it
      const env = M.paint.envMap;
      if (env) for (const m of envMats) if (m.envMap !== env) { m.envMap = env; m.needsUpdate = true; }
      // interior: button presses, lids, windows, mirrors
      for (const c of I.controls) {
        if (c.t <= 0) continue;
        c.t += dt;
        const f = c.t < 0.18 ? Math.sin((c.t / 0.18) * Math.PI) : 0;
        if (c.depth > 0) c.mesh.position.copy(c.rest).addScaledVector(c.dir, f * c.depth);
        if (c.t >= 0.18) c.t = 0;
      }
      for (const ld of Object.values(I.lids)) { if (!ld.apply) continue; ld.cur += clamp(ld.target - ld.cur, -ld.speed * dt, ld.speed * dt); ld.apply(smooth(ld.cur)); }
      for (const w of Object.values(I.win)) { w.cur += clamp(w.target - w.cur, -dt * 0.4, dt * 0.4); w.cut.value = lerp(w.yMax + 0.05, w.yMin - 0.02, smooth(w.cur)); }
      mirrorFold.cur += clamp(mirrorFold.target - mirrorFold.cur, -dt * 0.7, dt * 0.7);
      for (const { grp, s } of mirrorFold.grps) grp.rotation.y = -s * 1.3 * smooth(mirrorFold.cur);
      if (!st) return;
      // stalk: a flick when pressed, held over while a signal is on; the left roller turns a notch
      if (I.stalk) {
        I.stalkFlick = lerp(I.stalkFlick, 0, Math.min(1, dt * 6));
        const held = st.signal === 'R' ? -0.14 : st.signal === 'L' ? 0.14 : 0;
        I.stalk.rotation.z = lerp(I.stalk.rotation.z, held + I.stalkFlick, Math.min(1, dt * 18));
        I.rollCur = lerp(I.rollCur, I.roll, Math.min(1, dt * 12));
        for (const r of I.rollers) r.rotation.x = I.rollCur - (st.volume || 0) * 3;
        I.mats.led.emissiveIntensity = st.fsd ? 3 : 0;
        I.mats.hazard.emissiveIntensity = st.hazard ? (st.blinkOn ? 3 : 0.4) : 0.15;
        for (const [gk, m] of Object.entries(I.gearM)) m.emissiveIntensity = st.gear === gk ? 3 : 0.35;
      }
      // single wiper: sweeps while on, finishes its stroke and parks when switched off
      if (wiperArm) {
        const rate = (Math.PI * 2) / 1.7;
        if (st.wipers || this.wiperPhase > 0) { this.wiperPhase += dt * rate; if (this.wiperPhase >= Math.PI * 2) this.wiperPhase = st.wipers ? this.wiperPhase - Math.PI * 2 : 0; }
        wiperArm.rotation.z = 1.75 * (1 - Math.cos(this.wiperPhase)) / 2;
      }
      // wheels: spin + Ackermann steering
      const R = Math.abs(st.steer) > 1e-4 ? 2.89 / Math.tan(st.steer) : 1e9;
      for (const w of wheels) {
        w.spin.rotation.x -= (st.v * dt) / WHEEL_R;
        if (w.front) {
          // st.steer > 0 = right. Right is +x, so the inner wheel for a right turn is s=+1.
          const ang = Math.abs(R) > 1e8 ? 0 : Math.atan(2.89 / (R - w.side * TRACK));
          w.pivot.rotation.y = -ang;
        }
      }
      // ~12:1 steering ratio (about 2.3 turns lock to lock), lightly damped like a real column
      if (steeringSpin) steeringSpin.rotation.z += (-st.steer * 12 - steeringSpin.rotation.z) * Math.min(1, dt * 14);
      chassis.rotation.x = lerp(chassis.rotation.x, clamp((st.accel || 0) * 0.0045, -0.03, 0.03), Math.min(1, dt * 5));
      chassis.rotation.z = lerp(chassis.rotation.z, clamp((st.latAcc || 0) * 0.006, -0.035, 0.035), Math.min(1, dt * 5));
      chassis.position.y = lerp(chassis.position.y, Math.abs(st.v) > 0.5 ? Math.sin(st.dist * 2.1) * 0.0025 : 0, Math.min(1, dt * 6));
      // lights
      const blink = st.blinkOn;
      const onL = (st.signal === 'L' || st.hazard) && blink, onR = (st.signal === 'R' || st.hazard) && blink;
      Lm.sigRL.emissiveIntensity = onL ? 4 : 0; Lm.sigRR.emissiveIntensity = onR ? 4 : 0;
      // the ends of the front light bar are DRL until they blink amber
      const drl = st.awake ? 2.4 : 0.15, sigL = !!(st.signal === 'L' || st.hazard), sigR = !!(st.signal === 'R' || st.hazard);
      Lm.sigFL.emissive.setHex(sigL ? 0xffa21a : 0xffffff); Lm.sigFL.color.setHex(sigL ? 0x3a2a05 : 0xffffff); Lm.sigFL.emissiveIntensity = sigL ? (onL ? 4 : 0) : drl;
      Lm.sigFR.emissive.setHex(sigR ? 0xffa21a : 0xffffff); Lm.sigFR.color.setHex(sigR ? 0x3a2a05 : 0xffffff); Lm.sigFR.emissiveIntensity = sigR ? (onR ? 4 : 0) : drl;
      Lm.head.emissiveIntensity = st.headlights ? 5 : 0;
      for (const sp of spots) sp.intensity = st.headlights ? 1800 : 0;
      Lm.tail.emissiveIntensity = st.braking ? 5.5 : st.headlights ? 1.6 : 0.4;
      Lm.rev.emissiveIntensity = st.gear === 'R' ? 4 : 0;
      Lm.drl.emissiveIntensity = st.awake ? 2.4 : 0.15;
      Lm.ambient.emissiveIntensity = st.awake ? 0.6 + st.night * 1.6 : 0;
      Lm.port.emissiveIntensity = this.chargeOpen > 0.5 ? (st.charging ? 2 + Math.sin(st.time * 3) * 1.2 : 1.5) : 0;
      Lm.port.emissive.setHex(st.charging ? 0x22ff66 : 0x3d8bff);
    },
  };
  return car;
}

// Camera positions on the car body (model frame) used by the vision system and the camera app.
export const CAMERAS = [
  { id: 'main', name: 'Main', pos: [0, 1.46, -0.36], yaw: 0, fov: 50, range: 150 },
  { id: 'narrow', name: 'Narrow', pos: [0.04, 1.46, -0.36], yaw: 0, fov: 35, range: 250 },
  { id: 'wide', name: 'Wide', pos: [-0.04, 1.46, -0.36], yaw: 0, fov: 120, range: 60 },
  { id: 'lpillar', name: 'Left Pillar', pos: [-0.9, 1.18, 0.3], yaw: -60, fov: 90, range: 80 },
  { id: 'rpillar', name: 'Right Pillar', pos: [0.9, 1.18, 0.3], yaw: 60, fov: 90, range: 80 },
  { id: 'lrep', name: 'Left Repeater', pos: [-0.96, 0.86, -1.13], yaw: -135, fov: 75, range: 100 },
  { id: 'rrep', name: 'Right Repeater', pos: [0.96, 0.86, -1.13], yaw: 135, fov: 75, range: 100 },
  { id: 'rear', name: 'Rear', pos: [0, 0.95, 2.36], yaw: 180, fov: 130, range: 50 },
];
