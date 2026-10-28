// Traffic and parked vehicles: fourteen body styles generated procedurally. Each body is lofted from
// rounded cross-sections whose width, sill, crease and top heights follow per-type side-profile curves,
// with wheel arches cut into the sides, a separate greenhouse loft (glass, pillars, roof), and lights,
// grilles, plates and trim projected onto the surface as thin decals. Geometry is built once per type and
// merged into one mesh with material groups (+ the tail-light mesh, + four wheel meshes when animated).
import * as THREE from 'three';

// ---------------------------------------------------------------- small maths
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0]; };
const area2 = (a, b, c) => { const n = crs(sub(b, a), sub(c, a)); return n[0] * n[0] + n[1] * n[1] + n[2] * n[2]; };

// Monotone cubic (PCHIP) through [[x, y], ...], held flat beyond the ends.
function curve(pts) {
  const n = pts.length, X = pts.map((p) => p[0]), Y = pts.map((p) => p[1]);
  if (n === 1) return () => Y[0];
  const h = [], d = [];
  for (let i = 0; i < n - 1; i++) { h.push(X[i + 1] - X[i]); d.push((Y[i + 1] - Y[i]) / h[i]); }
  const m = new Array(n);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  }
  return (x) => {
    if (x <= X[0]) return Y[0];
    if (x >= X[n - 1]) return Y[n - 1];
    let i = 0; while (x > X[i + 1]) i++;
    const t = (x - X[i]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * Y[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * Y[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

// ---------------------------------------------------------------- shared detail atlas (256 x 256)
// One canvas shared by every car: licence plates, grille meshes, lamp clusters, badge, tyre tread, brake
// disc. Every vertex carries a uv; plain surfaces point at the white swatch, so the same materials work
// textured and untextured. Regions: [x, y, w, h] in pixels.
const REG = {
  white: [0, 0, 64, 64], plateA: [64, 0, 64, 32], plateB: [64, 32, 64, 32], badge: [128, 0, 32, 32], tread: [160, 0, 32, 32],
  disc: [192, 0, 64, 64], grilleHex: [0, 64, 128, 48], grilleBar: [0, 112, 128, 48], grilleSlat: [0, 160, 128, 48],
  headA: [128, 64, 128, 48], headB: [128, 112, 128, 48], headR: [128, 160, 48, 48], red: [176, 160, 32, 32],
  tailB: [208, 160, 48, 96], tailA: [0, 208, 128, 48], tailC: [128, 208, 80, 48],
};
// uv inside a region; a across (0 = left), b up (0 = bottom), kept 1.5 px inside the border
function uvOf(reg, a, b) {
  const [x, y, w, h] = REG[reg];
  return [(x + 1.5 + a * (w - 3)) / 256, 1 - (y + h - 1.5 - b * (h - 3)) / 256];
}
const UV_WHITE = uvOf('white', 0.5, 0.5), UV_RED = uvOf('red', 0.5, 0.5);
function drawAtlas() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  const fill = (col, X, Y, W, H) => { x.fillStyle = col; x.fillRect(X, Y, W, H); };
  const rrect = (X, Y, W, H, r, col) => {
    x.fillStyle = col; x.beginPath(); x.moveTo(X + r, Y); x.lineTo(X + W - r, Y); x.quadraticCurveTo(X + W, Y, X + W, Y + r);
    x.lineTo(X + W, Y + H - r); x.quadraticCurveTo(X + W, Y + H, X + W - r, Y + H); x.lineTo(X + r, Y + H);
    x.quadraticCurveTo(X, Y + H, X, Y + H - r); x.lineTo(X, Y + r); x.quadraticCurveTo(X, Y, X + r, Y); x.fill();
  };
  const circ = (X, Y, r, col) => { x.fillStyle = col; x.beginPath(); x.arc(X, Y, r, 0, Math.PI * 2); x.fill(); };
  const ring = (X, Y, r, w, col) => { x.strokeStyle = col; x.lineWidth = w; x.beginPath(); x.arc(X, Y, r, 0, Math.PI * 2); x.stroke(); };
  const R = (reg, f) => { const [rx, ry, rw, rh] = REG[reg]; x.save(); x.translate(rx, ry); x.beginPath(); x.rect(0, 0, rw, rh); x.clip(); f(rw, rh); x.restore(); };
  fill('#ffffff', 0, 0, 256, 256);
  // licence plates (two numbers)
  const plate = (txt, band) => (w, h) => {
    fill('#edeee9', 0, 0, w, h); x.strokeStyle = '#9a9ea2'; x.lineWidth = 2; x.strokeRect(1, 1, w - 2, h - 2);
    fill(band, 3, 3, w - 6, 4);
    x.fillStyle = '#1e2b4f'; x.font = 'bold 17px Arial, Helvetica, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(txt, w / 2, h / 2 + 3);
  };
  R('plateA', plate('7KX 482', '#2b4b8c')); R('plateB', plate('4RE 915', '#8c2b2b'));
  // badge: chrome ring, dark enamel centre, chrome chevron
  R('badge', (w, h) => {
    fill('#8e9094', 0, 0, w, h); circ(16, 16, 14, '#d9dbdf'); circ(16, 16, 10.5, '#1c1e22'); ring(16, 16, 12.2, 1.5, '#f2f3f5');
    x.strokeStyle = '#e6e8ec'; x.lineWidth = 3; x.beginPath(); x.moveTo(9, 20); x.lineTo(16, 10); x.lineTo(23, 20); x.stroke();
  });
  // tyre tread tile: plain sidewall rows top and bottom, ribs with grooves and lateral slots (symmetric in x)
  R('tread', (w, h) => {
    fill('#cfcfcf', 0, 0, w, h); fill('#b4b4b4', 0, 6, w, 20);
    for (const y of [9, 15.5, 22]) fill('#3a3a3a', 0, y, w, 2);
    for (const sx of [7, 23]) fill('#505050', sx, 6, 2, 20);
    fill('#9a9a9a', 0, 6, w, 1); fill('#9a9a9a', 0, 25, w, 1);
  });
  // brake disc behind the spokes (planar map of the rim dish)
  R('disc', (w, h) => {
    fill('#15161a', 0, 0, w, h); circ(32, 32, 29, '#1d1e22'); circ(32, 32, 27, '#6e7075'); ring(32, 32, 22, 1, '#55575c'); ring(32, 32, 17, 1, '#5c5e63');
    circ(32, 32, 12, '#45474c'); circ(32, 32, 9, '#2a2b2f');
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; circ(32 + Math.cos(a) * 6, 32 + Math.sin(a) * 6, 1.6, '#9a9ca0'); }
    for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; circ(32 + Math.cos(a) * 19.5, 32 + Math.sin(a) * 19.5, 1.1, '#3a3b3f'); }
  });
  // grilles: honeycomb mesh, horizontal bars, vertical chrome slats (all symmetric about the centre)
  R('grilleHex', (w, h) => {
    fill('#4a4d52', 0, 0, w, h);
    const r = 4.2, dx = r * 1.732, dy = r * 1.5;
    for (let row = -1; row < h / dy + 1; row++) for (let col = -1; col < w / dx + 1; col++) {
      const cx = col * dx + (row & 1 ? dx / 2 : 0), cy = row * dy + 3;
      x.fillStyle = '#121316'; x.beginPath();
      for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + (k / 6) * Math.PI * 2; x[k ? 'lineTo' : 'moveTo'](cx + (r - 0.9) * Math.cos(a), cy + (r - 0.9) * Math.sin(a)); }
      x.fill();
    }
  });
  R('grilleBar', (w, h) => {
    fill('#101114', 0, 0, w, h);
    for (let y = 3; y < h - 2; y += 9) { fill('#8d9196', 0, y, w, 4); fill('#c9ccd0', 0, y, w, 1.2); fill('#55585c', 0, y + 3, w, 1); }
  });
  R('grilleSlat', (w, h) => {
    fill('#0f1013', 0, 0, w, h);
    for (let sx = 2; sx < w; sx += 8) { fill('#aeb2b7', sx, 0, 4, h); fill('#e3e6ea', sx, 0, 1.4, h); fill('#6a6e73', sx + 3, 0, 1, h); }
  });
  // headlamp clusters: inboard at the left, outboard at the right
  const projector = (X, Y, r) => { circ(X, Y, r, '#9ea2a8'); circ(X, Y, r * 0.8, '#1a1c22'); ring(X, Y, r * 0.62, 1.2, '#cfd3d8'); circ(X, Y, r * 0.42, '#e8ecf2'); circ(X, Y, r * 0.2, '#ffffff'); };
  R('headA', (w, h) => {
    fill('#1a1c20', 0, 0, w, h); rrect(30, 6, 94, 36, 6, '#45484e'); rrect(34, 9, 86, 30, 5, '#2a2c31');
    projector(96, 24, 14); projector(62, 25, 10);
    rrect(6, 36, 118, 5, 2, '#fbfaf2'); rrect(119, 8, 5, 33, 2, '#fbfaf2'); rrect(6, 10, 18, 5, 2, '#e9a53a');
  });
  R('headB', (w, h) => {
    fill('#1a1c20', 0, 0, w, h); rrect(8, 6, 116, 36, 5, '#3c3f45'); rrect(11, 9, 110, 30, 4, '#24262b');
    projector(46, 26, 12); projector(94, 26, 12); rrect(10, 6, 112, 5, 2, '#fbfaf2'); rrect(8, 36, 16, 5, 2, '#e9a53a');
  });
  R('headR', (w, h) => { fill('#2a2c30', 0, 0, w, h); circ(24, 24, 23, '#c9ccd0'); circ(24, 24, 20, '#2e3136'); ring(24, 24, 16, 2.5, '#fbfaf2'); circ(24, 24, 11, '#9ea2a8'); circ(24, 24, 7, '#f4f6f8'); circ(24, 24, 3, '#ffffff'); });
  // tail lamps: A = full-width bar, B = upright block with a C-shaped bar, C = horizontal block pair
  R('red', (w, h) => fill('#ff2a1c', 0, 0, w, h));
  R('tailA', (w, h) => {
    fill('#4a0a0a', 0, 0, w, h); rrect(2, 2, 124, 44, 4, '#5e0c0c'); rrect(6, 18, 118, 12, 3, '#ff2a1c'); rrect(8, 21, 114, 5, 2, '#ff6a52');
    rrect(84, 8, 40, 32, 5, '#ff2a1c'); rrect(90, 12, 30, 24, 4, '#8a1010'); rrect(6, 33, 30, 9, 2, '#d9801c');
  });
  R('tailB', (w, h) => {
    fill('#4a0a0a', 0, 0, w, h); rrect(2, 2, 44, 92, 4, '#5e0c0c'); rrect(6, 6, 36, 10, 3, '#ff2a1c'); rrect(6, 6, 10, 70, 3, '#ff2a1c');
    rrect(6, 66, 36, 10, 3, '#ff2a1c'); rrect(8, 8, 6, 66, 2, '#ff6a52'); rrect(20, 20, 20, 42, 3, '#8a1010'); rrect(20, 80, 22, 10, 2, '#d9801c');
  });
  R('tailC', (w, h) => {
    fill('#4a0a0a', 0, 0, w, h); rrect(2, 2, 76, 44, 4, '#5e0c0c'); rrect(6, 10, 68, 10, 3, '#ff2a1c'); rrect(8, 13, 64, 4, 2, '#ff6a52');
    rrect(40, 24, 34, 18, 3, '#ff2a1c'); rrect(44, 27, 26, 12, 2, '#8a1010'); rrect(6, 26, 30, 14, 2, '#d9801c');
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
export const npcAtlas = drawAtlas();

// ---------------------------------------------------------------- materials
// misc: colour per vertex; the vertex alpha encodes the finish: < 0.5 metal (roughness = a * 2),
// >= 0.5 dielectric (roughness = (a - 0.5) * 2). glass: colour per vertex is the tint, alpha the opacity.
export const npcMats = {
  glass: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.04, metalness: 0.2, transparent: true, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.5 }),
  black: new THREE.MeshStandardMaterial({ color: 0x0e0f10, roughness: 0.62, metalness: 0.0 }),
  misc: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, map: npcAtlas, envMapIntensity: 1.2 }),
  head: new THREE.MeshStandardMaterial({ color: 0xffffff, map: npcAtlas, emissive: 0xfff4e0, emissiveMap: npcAtlas, emissiveIntensity: 0.25, roughness: 0.3, metalness: 0.0 }),
  tail: new THREE.MeshStandardMaterial({ color: 0xffffff, map: npcAtlas, emissive: 0xffffff, emissiveMap: npcAtlas, emissiveIntensity: 0.35, roughness: 0.2, metalness: 0.0 }),
  brake: new THREE.MeshStandardMaterial({ color: 0xffffff, map: npcAtlas, emissive: 0xffffff, emissiveMap: npcAtlas, emissiveIntensity: 3.5, roughness: 0.2, metalness: 0.0 }),
};
npcMats.misc.onBeforeCompile = (sh) => {
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * (vColor.a < 0.5 ? vColor.a * 2.0 : (vColor.a - 0.5) * 2.0);')
    .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vColor.a < 0.5 ? 1.0 : 0.0;');
};
npcMats.rim = npcMats.misc; // legacy alias

export const COLORS = [
  0xf2f2ef, 0xe4e2da, 0xf2f2ef, 0x0d0e10, 0x17191c, 0xb3b7bb, 0x8d9196, 0x5b5f64,
  0x33363b, 0x1b2c4f, 0x2b5597, 0x8e1618, 0x531a1e, 0x26392f, 0xbfb49c, 0x5c4330,
];
// paint: clearcoat over a metallic base whose normal is jittered per ~3 mm cell (metal flake), fading
// out with distance so it never shimmers on far cars; roughness and flake strength vary per colour
const paintCache = new Map();
const paintShader = (sh) => {
  sh.uniforms.flake = sh.flakeU;
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFlakeP;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlakeP = transformed;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFlakeP; uniform float flake;')
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
    { vec3 fp = floor(vFlakeP * 340.0);
      vec3 hh = fract(sin(vec3(dot(fp, vec3(127.1, 311.7, 74.7)), dot(fp, vec3(269.5, 183.3, 246.1)), dot(fp, vec3(113.5, 271.9, 124.6)))) * 43758.5453) - 0.5;
      normal = normalize(normal + hh * flake * smoothstep(22.0, 6.0, length(vViewPosition))); }`);
};
function paint(color) {
  let m = paintCache.get(color);
  if (!m) {
    const r = ((color >> 16) & 255) / 255, g = ((color >> 8) & 255) / 255, b = (color & 255) / 255;
    const lum = 0.3 * r + 0.59 * g + 0.11 * b, sat = Math.max(r, g, b) - Math.min(r, g, b);
    const solid = lum > 0.82 || lum < 0.07;
    const h = ((color * 2654435761) >>> 0) / 4294967296; // per-colour wear
    m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.32 + h * 0.08, metalness: solid ? 0.25 : 0.6, clearcoat: 1, clearcoatRoughness: 0.05 + h * 0.03, envMapIntensity: 1.1 });
    const flakeU = { value: solid ? 0.015 : 0.045 + 0.025 * (1 - sat) };
    m.onBeforeCompile = (sh) => { sh.flakeU = flakeU; paintShader(sh); };
    m.customProgramCacheKey = () => 'npcpaint';
    paintCache.set(color, m);
  }
  return m;
}

// vertex colours (linear rgb, alpha = finish code, see npcMats.misc) for the misc material
const C = {
  tyre: [0.05, 0.05, 0.052, 0.95], rim: [0.62, 0.64, 0.66, 0.16], rimDark: [0.08, 0.082, 0.088, 0.2],
  chrome: [0.9, 0.91, 0.93, 0.05], dish: [0.6, 0.6, 0.62, 0.3], steel: [0.06, 0.06, 0.065, 0.28],
  steelW: [0.6, 0.61, 0.62, 0.22], hub: [0.45, 0.46, 0.48, 0.15], plate: [0.92, 0.92, 0.9, 0.78],
  bezel: [0.02, 0.022, 0.025, 0.56], grey: [0.22, 0.23, 0.24, 0.75], box: [0.78, 0.79, 0.78, 0.75],
  handle: [0.1, 0.1, 0.11, 0.65], amber: [0.9, 0.42, 0.04, 0.6], white: [0.9, 0.9, 0.9, 0.62],
  satin: [0.5, 0.51, 0.53, 0.3], tex: [1, 1, 1, 0.72], texM: [1, 1, 1, 0.12], seat: [0.085, 0.082, 0.08, 0.95],
  skin: [0.3, 0.2, 0.14, 0.9], screen: [0.03, 0.03, 0.035, 0.52], mirror: [0.8, 0.82, 0.85, 0.02], lens: [0.25, 0.02, 0.02, 0.55],
};
// glass tints (rgb × material colour, alpha = opacity)
const GL = { wind: [0.2, 0.24, 0.28, 0.58], side: [0.15, 0.17, 0.2, 0.62], tint: [0.06, 0.065, 0.07, 0.86], lamp: [0.8, 0.82, 0.86, 0.3], roof: [0.05, 0.055, 0.06, 0.9] };
const WHITE = [1, 1, 1, 1];
// material keys that are really the misc material with a colour
const MCOL = { chrome: C.chrome, plate: C.plate, bezel: C.bezel, grey: C.grey, handle: C.handle, boxw: C.box, amber: C.amber, white: C.white, satin: C.satin, tex: C.tex, texM: C.texM, lens: C.lens };
const matKey = (m) => (MCOL[m] ? 'misc' : m);

// ---------------------------------------------------------------- mesh builder
class MB {
  constructor(uv0 = UV_WHITE) { this.P = []; this.N = []; this.C = []; this.U = []; this.uv0 = uv0; this.I = {}; this.tg = []; this.acc = {}; }
  v(p, n, c = WHITE, uv = this.uv0) {
    this.P.push(p[0], p[1], p[2]); this.N.push(n[0], n[1], n[2]); this.C.push(c[0], c[1], c[2], c[3]); this.U.push(uv[0], uv[1]);
    return this.P.length / 3 - 1;
  }
  t(m, a, b, c) { (this.I[m] || (this.I[m] = [])).push(a, b, c); }
  append(o, tf) {
    const base = this.P.length / 3;
    for (let i = 0; i < o.P.length / 3; i++) {
      const [p, n] = tf([o.P[i * 3], o.P[i * 3 + 1], o.P[i * 3 + 2]], [o.N[i * 3], o.N[i * 3 + 1], o.N[i * 3 + 2]]);
      this.v(p, n, o.C.slice(i * 4, i * 4 + 4), [o.U[i * 2], o.U[i * 2 + 1]]);
    }
    for (const m in o.I) { const l = this.I[m] || (this.I[m] = []); for (const x of o.I[m]) l.push(x + base); }
  }
  clone() {
    const M = new MB(this.uv0); M.P = this.P.slice(); M.N = this.N.slice(); M.C = this.C.slice(); M.U = this.U.slice();
    for (const m in this.I) M.I[m] = this.I[m].slice();
    return M;
  }
  tris() { let n = 0; for (const m in this.I) n += this.I[m].length / 3; return n; }
  geo(order) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2));
    if (order.includes('misc') || order.includes('glass')) g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 4));
    const idx = [];
    order.forEach((m, k) => {
      const l = this.I[m]; if (!l || !l.length) return;
      g.addGroup(idx.length, l.length, k);
      for (let i = 0; i < l.length; i++) idx.push(l[i]);
    });
    g.setIndex(idx);
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}
function mirrorMB(src) {
  const M = new MB(src.uv0);
  M.P = src.P.map((v, i) => (i % 3 === 0 ? -v : v)); M.N = src.N.map((v, i) => (i % 3 === 0 ? -v : v)); M.C = src.C.slice(); M.U = src.U.slice();
  for (const m in src.I) { const l = src.I[m], o = []; for (let i = 0; i < l.length; i += 3) o.push(l[i], l[i + 2], l[i + 1]); M.I[m] = o; }
  return M;
}

// Smooth grid surface. P[i][j] = [x,y,z] (right half, x >= 0); cross(dj, di) points outward.
// mat(i, j) names the material of cell (i..i+1, j..j+1) (null skips it). Mirrored to x < 0 unless o.mir === false.
function gridNormals(P, flip, mir) {
  const R = P.length, Cn = P[0].length, N = [];
  for (let i = 0; i < R; i++) { const row = []; for (let j = 0; j < Cn; j++) row.push([0, 0, 0]); N.push(row); }
  const ac = (n, v) => { n[0] += v[0]; n[1] += v[1]; n[2] += v[2]; };
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < Cn - 1; j++) {
    const a = P[i][j], b = P[i][j + 1], c = P[i + 1][j], d = P[i + 1][j + 1];
    const n1 = crs(sub(b, a), sub(c, a)), n2 = crs(sub(b, c), sub(d, c));
    ac(N[i][j], n1); ac(N[i][j + 1], n1); ac(N[i + 1][j], n1);
    ac(N[i + 1][j], n2); ac(N[i][j + 1], n2); ac(N[i + 1][j + 1], n2);
  }
  const sg = flip ? -1 : 1;
  for (let i = 0; i < R; i++) for (let j = 0; j < Cn; j++) {
    let n = nrm(N[i][j]); n = [n[0] * sg, n[1] * sg, n[2] * sg];
    if (mir && Math.abs(P[i][j][0]) < 1e-5) n = nrm([0, n[1], n[2]]);
    N[i][j] = n;
  }
  return N;
}
function grid(M, P, mat, o = {}) {
  const R = P.length, Cn = P[0].length, mir = o.mir !== false, N = gridNormals(P, o.flip, mir);
  const col = o.col || WHITE, colF = typeof col === 'function' ? col : () => col, uvF = o.uv || null;
  const half = (mx) => {
    const id = P.map((row, i) => row.map((p, j) => M.v([p[0] * mx, p[1], p[2]], [N[i][j][0] * mx, N[i][j][1], N[i][j][2]], colF(i, j), uvF ? uvF(i, j) : M.uv0)));
    const fl = (o.flip ? 1 : 0) ^ (mx < 0 ? 1 : 0);
    for (let i = 0; i < R - 1; i++) for (let j = 0; j < Cn - 1; j++) {
      const m0 = mat(i, j); if (!m0) continue;
      const m = matKey(m0);
      const a = id[i][j], b = id[i][j + 1], c = id[i + 1][j], d = id[i + 1][j + 1];
      if (area2(P[i][j], P[i][j + 1], P[i + 1][j]) > 1e-14) { fl ? M.t(m, a, c, b) : M.t(m, a, b, c); if (mx > 0 && o.tg) M.tg.push([a, b, c]); }
      if (area2(P[i + 1][j], P[i][j + 1], P[i + 1][j + 1]) > 1e-14) { fl ? M.t(m, c, d, b) : M.t(m, c, b, d); if (mx > 0 && o.tg) M.tg.push([c, b, d]); }
    }
  };
  half(1); if (mir) half(-1);
}

function quad(M, m, p0, p1, p2, p3, col, hint, uvs) {
  let n = nrm(crs(sub(p2, p0), sub(p3, p1)));
  let u = uvs || [M.uv0, M.uv0, M.uv0, M.uv0];
  if (hint && dot(n, hint) < 0) { n = [-n[0], -n[1], -n[2]]; const t = p1; p1 = p3; p3 = t; u = [u[0], u[3], u[2], u[1]]; }
  const k = matKey(m), cc = col || MCOL[m] || WHITE;
  const a = M.v(p0, n, cc, u[0]), b = M.v(p1, n, cc, u[1]), c = M.v(p2, n, cc, u[2]), d = M.v(p3, n, cc, u[3]);
  M.t(k, a, b, c); M.t(k, a, c, d);
}
// rectangle in a plane: centre c, half-axes ea / eb (vectors), textured with a region (a along ea, b along eb)
function rect(M, m, c, ea, eb, reg, col, hint) {
  const P = (sa, sb) => [c[0] + sa * ea[0] + sb * eb[0], c[1] + sa * ea[1] + sb * eb[1], c[2] + sa * ea[2] + sb * eb[2]];
  const uv = reg ? [uvOf(reg, 0, 0), uvOf(reg, 1, 0), uvOf(reg, 1, 1), uvOf(reg, 0, 1)] : null;
  quad(M, m, P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), col, hint || nrm(crs(ea, eb)), uv);
}
function box(M, m, c, h, col) {
  const P = (sx, sy, sz) => [c[0] + sx * h[0], c[1] + sy * h[1], c[2] + sz * h[2]];
  quad(M, m, P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1), col, [1, 0, 0]);
  quad(M, m, P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), col, [-1, 0, 0]);
  quad(M, m, P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), col, [0, 1, 0]);
  quad(M, m, P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), col, [0, -1, 0]);
  quad(M, m, P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), col, [0, 0, 1]);
  quad(M, m, P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), P(1, -1, -1), col, [0, 0, -1]);
}
// rounded box / blob (superellipsoid). Centred on x = 0 it is built as a right half and mirrored.
function blob(M, m, c, r, n = 3, nu = 8, nv = 6, col, o = {}) {
  const f = (w, e) => Math.sign(w) * Math.abs(w) ** (2 / e);
  const halfX = Math.abs(c[0]) < 1e-6;
  const P = [];
  for (let i = 0; i <= nv; i++) {
    const ph = -Math.PI / 2 + (i / nv) * Math.PI, row = [];
    for (let j = 0; j <= nu; j++) {
      const th = halfX ? -Math.PI / 2 + (j / nu) * Math.PI : (j / nu) * Math.PI * 2;
      const cp = f(Math.cos(ph), n);
      row.push([c[0] + r[0] * cp * f(Math.cos(th), n), c[1] + r[1] * f(Math.sin(ph), n), c[2] + r[2] * cp * f(Math.sin(th), n)]);
    }
    P.push(row);
  }
  grid(M, P, () => m, { flip: true, col: col || MCOL[m], mir: o.mir !== false, tg: o.tg });
}
// surface of revolution about the x axis; prof = [[x, r], ...] traversed so the outside is on (dr, -dx)
// uvf(i, k, ph, p) may give each vertex a uv (profile point i, segment k, angle ph)
function revolve(M, m, prof, seg, col, ph0 = 0, uvf = null) {
  const n2 = prof.map((p, i) => {
    const a = prof[Math.max(0, i - 1)], b = prof[Math.min(prof.length - 1, i + 1)];
    const dx = b[0] - a[0], dr = b[1] - a[1], l = Math.hypot(dx, dr) || 1;
    return [dr / l, -dx / l];
  });
  const ids = [];
  for (let k = 0; k < seg; k++) {
    const ph = ph0 + (k / seg) * Math.PI * 2, c = Math.cos(ph), s = Math.sin(ph);
    ids.push(prof.map((p, i) => M.v([p[0], p[1] * c, p[1] * s], [n2[i][0], n2[i][1] * c, n2[i][1] * s], col, uvf ? uvf(i, k, ph, p) : M.uv0)));
  }
  for (let k = 0; k < seg; k++) {
    const k2 = (k + 1) % seg;
    for (let i = 0; i < prof.length - 1; i++) {
      if (prof[i][1] < 1e-6 && prof[i + 1][1] < 1e-6) continue;
      const a = ids[k][i], b = ids[k][i + 1], c = ids[k2][i], d = ids[k2][i + 1];
      if (prof[i][1] > 1e-6) M.t(m, a, b, c);
      if (prof[i + 1][1] > 1e-6) M.t(m, c, b, d);
    }
  }
}

// ---------------------------------------------------------------- ray projection onto the body (decals)
const VIEWS = { front: [0, 1, 2, -1], rear: [0, 1, 2, 1], side: [2, 1, 0, 1], top: [0, 2, 1, 1] };
const CELL = 0.12;
function accel(M, view) {
  let A = M.acc[view];
  if (A && A.n === M.tg.length) return A;
  const [iu, iv] = VIEWS[view], map = new Map(), P = M.P;
  for (const t of M.tg) {
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const k of t) { const u = P[k * 3 + iu], v = P[k * 3 + iv]; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    for (let a = Math.floor(u0 / CELL); a <= Math.floor(u1 / CELL); a++) for (let b = Math.floor(v0 / CELL); b <= Math.floor(v1 / CELL); b++) {
      const key = a + ',' + b; let l = map.get(key); if (!l) map.set(key, (l = [])); l.push(t);
    }
  }
  A = M.acc[view] = { n: M.tg.length, map };
  return A;
}
function rayHit(M, view, u, v) {
  const [iu, iv, id, sg] = VIEWS[view], list = accel(M, view).map.get(Math.floor(u / CELL) + ',' + Math.floor(v / CELL));
  if (!list) return null;
  const P = M.P, N = M.N;
  let best = null, bd = -Infinity;
  for (const t of list) {
    const a = t[0] * 3, b = t[1] * 3, c = t[2] * 3;
    const ax = P[a + iu], ay = P[a + iv], bx = P[b + iu], by = P[b + iv], cx = P[c + iu], cy = P[c + iv];
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-14) continue;
    const l1 = ((by - cy) * (u - cx) + (cx - bx) * (v - cy)) / det, l2 = ((cy - ay) * (u - cx) + (ax - cx) * (v - cy)) / det, l3 = 1 - l1 - l2;
    if (l1 < -1e-7 || l2 < -1e-7 || l3 < -1e-7) continue;
    const d = (P[a + id] * l1 + P[b + id] * l2 + P[c + id] * l3) * sg;
    if (d > bd) { bd = d; best = [a, b, c, l1, l2, l3]; }
  }
  if (!best) return null;
  const [a, b, c, l1, l2, l3] = best;
  const p = [0, 1, 2].map((k) => P[a + k] * l1 + P[b + k] * l2 + P[c + k] * l3);
  const n = nrm([0, 1, 2].map((k) => N[a + k] * l1 + N[b + k] * l2 + N[c + k] * l3));
  return { p, n };
}
// emit a grid of [pos, normal] (or null) points as a decal; triangles oriented along the normals
function decalGrid(M, m, G, o) {
  const k = matKey(m), col = o.col || MCOL[m] || WHITE, uvF = o.uv || null;
  for (const mx of o.mir === false ? [1] : [1, -1]) {
    const id = G.map((row, i) => row.map((q, j) => (q ? M.v([q[0][0] * mx, q[0][1], q[0][2]], [q[1][0] * mx, q[1][1], q[1][2]], col, uvF ? uvF(i, j) : M.uv0) : -1)));
    const pos = (i, j) => { const q = G[i][j][0]; return [q[0] * mx, q[1], q[2]]; };
    const nn = (i, j) => { const q = G[i][j][1]; return [q[0] * mx, q[1], q[2]]; };
    const tri = (i0, j0, i1, j1, i2, j2) => {
      const p0 = pos(i0, j0), p1 = pos(i1, j1), p2 = pos(i2, j2);
      const fn = crs(sub(p1, p0), sub(p2, p0));
      if (dot(fn, fn) < 1e-16) return;
      if (dot(fn, nn(i0, j0)) >= 0) M.t(k, id[i0][j0], id[i1][j1], id[i2][j2]);
      else M.t(k, id[i0][j0], id[i2][j2], id[i1][j1]);
    };
    for (let i = 0; i < G.length - 1; i++) for (let j = 0; j < G[0].length - 1; j++) {
      if (!G[i][j] || !G[i + 1][j] || !G[i][j + 1] || !G[i + 1][j + 1]) continue;
      tri(i, j, i + 1, j, i, j + 1); tri(i + 1, j, i + 1, j + 1, i, j + 1);
    }
  }
}
const shapeFn = (sh) => (sh.q
  ? (a, b) => { const [p0, p1, p2, p3] = sh.q; return [lerp(lerp(p0[0], p1[0], a), lerp(p3[0], p2[0], a), b), lerp(lerp(p0[1], p1[1], a), lerp(p3[1], p2[1], a), b)]; }
  : (a, b) => { const [cu, cv, ru, rv] = sh.e; return [cu + ru * b * Math.cos(a * Math.PI * 2), cv + rv * b * Math.sin(a * Math.PI * 2)]; });
// general ray (origin o, direction d) against the targets near a region; nearest hit
function rayGen(M, key, o, d, near) {
  let A = M.acc[key];
  if (!A || A.n !== M.tg.length) {
    const P = M.P, list = [];
    for (const t of M.tg) {
      let ok = false;
      for (const k of t) if (near(P[k * 3], P[k * 3 + 1], P[k * 3 + 2])) { ok = true; break; }
      if (ok) list.push(t);
    }
    A = M.acc[key] = { n: M.tg.length, list };
  }
  const P = M.P, N = M.N;
  let best = null, bt = Infinity;
  for (const t of A.list) {
    const a = t[0] * 3, b = t[1] * 3, c = t[2] * 3;
    const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const pv = crs(d, e2), det = dot(e1, pv);
    if (Math.abs(det) < 1e-12) continue;
    const tv = [o[0] - P[a], o[1] - P[a + 1], o[2] - P[a + 2]], u = dot(tv, pv) / det;
    if (u < -1e-7 || u > 1 + 1e-7) continue;
    const qv = crs(tv, e1), v = dot(d, qv) / det;
    if (v < -1e-7 || u + v > 1 + 1e-7) continue;
    const tt = dot(e2, qv) / det;
    if (tt > 0 && tt < bt) { bt = tt; best = [a, b, c, 1 - u - v, u, v]; }
  }
  if (!best) return null;
  const [a, b, c, l1, l2, l3] = best;
  return { p: [0, 1, 2].map((k) => P[a + k] * l1 + P[b + k] * l2 + P[c + k] * l3), n: nrm([0, 1, 2].map((k) => N[a + k] * l1 + N[b + k] * l2 + N[c + k] * l3)) };
}
// ray decal: shape in view-plane coordinates (front/rear: x,y · side: s,y · top: x,s), projected on M.
// 'cornerF' / 'cornerR' wrap round the rounded front / rear corner: coordinates (angle in degrees, y),
// 0 = straight ahead / behind, 90 = straight out to the side, rays aimed at the corner's plan centre.
// d = [material, shape, na, nb, offset, colour, region]: with a region the decal is textured from the
// atlas (a along the shape's first edge, b up; polar for ellipses). Front-view shapes may reach x < 0
// (the targets are the right half: the hit is mirrored), so plates and badges need not be mirrored.
function rdecal(M, T, d, view, into) {
  const [m, sh, na = sh.e ? 14 : 6, nb = 2, off = 0.004, col, reg] = d;
  const f = shapeFn(sh), G = [];
  const corner = view === 'cornerF' || view === 'cornerR';
  let cx = 0, cz = 0, zs = 1;
  if (corner) {
    const R = view === 'cornerF' ? T.ef.p : T.er.p;
    cx = (T.Wc || T.W) / 2 - R; zs = view === 'cornerF' ? -1 : 1;
    cz = view === 'cornerF' ? R - T.L / 2 : T.Le - R - T.L / 2;
  }
  const near = (x, y, z) => x > cx - 0.7 && Math.abs(z - cz) < 0.9;
  for (let i = 0; i <= na; i++) {
    const row = [];
    for (let j = 0; j <= nb; j++) {
      let [u, v] = f(i / na, j / nb), h;
      if (corner) {
        const th = (u * Math.PI) / 180, dir = [Math.sin(th), 0, Math.cos(th) * zs];
        h = rayGen(M, view, [cx + dir[0] * 2.5, v, cz + dir[2] * 2.5], [-dir[0], 0, -dir[2]], near);
      } else {
        if (view === 'side') u -= T.L / 2; else if (view === 'top') v -= T.L / 2;
        const neg = view !== 'side' && u < 0;
        h = rayHit(M, view, neg ? -u : u, v);
        if (h && neg) { h.p[0] = -h.p[0]; h.n[0] = -h.n[0]; }
      }
      row.push(h ? [[h.p[0] + h.n[0] * off, h.p[1] + h.n[1] * off, h.p[2] + h.n[2] * off], h.n] : null);
    }
    G.push(row);
  }
  let uv = null;
  if (reg) {
    // seen from the front the car's +x is on the viewer's left: flip so text reads correctly
    const flip = (view === 'front' || view === 'cornerF') && sh.mir === false;
    uv = sh.e ? (i, j) => { const a = (i / na) * Math.PI * 2, b = j / nb; return uvOf(reg, 0.5 + 0.5 * b * Math.cos(a), 0.5 + 0.5 * b * Math.sin(a)); }
      : (i, j) => uvOf(reg, flip ? 1 - i / na : i / na, j / nb);
  }
  decalGrid(into || M, m, G, { col, mir: sh.mir, uv });
}
// surface record of a lofted grid for decals: stations, 3D points and smooth normals, u = column index
function surfRec(st, P) { return { st, P, N: gridNormals(P, false, true) }; }
// exact decal on a loft grid: a convex polygon in (s, u) parameter space is clipped against every grid
// triangle and mapped through it, so the decal lies exactly on the faceted surface (offset along normals)
// d = [material, shape, , , offset, colour, region, doubleSided]; a region maps the polygon's bounding
// box in (s, u) onto the atlas region (a along s, b along u)
function cdecal(M, rec, d) {
  const [m, sh, , , off = 0.003, col, reg, ds] = d;
  const poly = sh.q;
  const k = matKey(m), cc = col || MCOL[m] || WHITE;
  let s0 = Infinity, s1 = -Infinity, u0 = Infinity, u1 = -Infinity;
  for (const [s, u] of poly) { s0 = Math.min(s0, s); s1 = Math.max(s1, s); u0 = Math.min(u0, u); u1 = Math.max(u1, u); }
  const uvAt = reg ? (s, u) => uvOf(reg, (s - s0) / Math.max(1e-6, s1 - s0), (u - u0) / Math.max(1e-6, u1 - u0)) : () => M.uv0;
  const { st, P, N } = rec, tris = [];
  const clip = (pg, a, b, c) => { // keep the side of line a-b on which c lies
    const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const sc = side(c) >= 0 ? 1 : -1, out = [];
    for (let i = 0; i < pg.length; i++) {
      const p = pg[i], q2 = pg[(i + 1) % pg.length], dp = side(p) * sc, dq = side(q2) * sc;
      if (dp >= 0) out.push(p);
      if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); out.push([p[0] + (q2[0] - p[0]) * t, p[1] + (q2[1] - p[1]) * t]); }
    }
    return out;
  };
  for (let i = 0; i < st.length - 1; i++) {
    if (st[i + 1] < s0 || st[i] > s1) continue;
    for (let j = 0; j < P[0].length - 1; j++) {
      if (j + 1 < u0 || j > u1) continue;
      const A = [st[i], j], B = [st[i], j + 1], Cc = [st[i + 1], j], D = [st[i + 1], j + 1];
      for (const [ta, tb, tc, ia, ib, ic] of [[A, B, Cc, [i, j], [i, j + 1], [i + 1, j]], [Cc, B, D, [i + 1, j], [i, j + 1], [i + 1, j + 1]]]) {
        let pg = clip(clip(clip(poly, ta, tb, tc), tb, tc, ta), tc, ta, tb);
        if (pg.length < 3) continue;
        const det = (tb[1] - tc[1]) * (ta[0] - tc[0]) + (tc[0] - tb[0]) * (ta[1] - tc[1]);
        if (Math.abs(det) < 1e-12) continue;
        const pa = P[ia[0]][ia[1]], pb = P[ib[0]][ib[1]], pc = P[ic[0]][ic[1]], na = N[ia[0]][ia[1]], nb = N[ib[0]][ib[1]], nc = N[ic[0]][ic[1]];
        const vs = pg.map(([s, u]) => {
          const l1 = ((tb[1] - tc[1]) * (s - tc[0]) + (tc[0] - tb[0]) * (u - tc[1])) / det, l2 = ((tc[1] - ta[1]) * (s - tc[0]) + (ta[0] - tc[0]) * (u - tc[1])) / det, l3 = 1 - l1 - l2;
          const n = nrm([0, 1, 2].map((e) => na[e] * l1 + nb[e] * l2 + nc[e] * l3));
          return [[0, 1, 2].map((e) => pa[e] * l1 + pb[e] * l2 + pc[e] * l3 + n[e] * off), n, uvAt(s, u)];
        });
        for (let t = 1; t < vs.length - 1; t++) tris.push([vs[0], vs[t], vs[t + 1]]);
      }
    }
  }
  for (const mx of sh.mir === false ? [1] : [1, -1]) for (const t of tris) {
    const p = t.map((v) => [v[0][0] * mx, v[0][1], v[0][2]]), n = t.map((v) => [v[1][0] * mx, v[1][1], v[1][2]]);
    const fn = crs(sub(p[1], p[0]), sub(p[2], p[0]));
    if (dot(fn, fn) < 1e-16) continue;
    const id = p.map((pp, e) => M.v(pp, n[e], cc, t[e][2]));
    if (dot(fn, n[0]) >= 0) M.t(k, id[0], id[1], id[2]); else M.t(k, id[0], id[2], id[1]);
    if (ds) { // inside face too (pillars seen through the far window)
      const jd = p.map((pp, e) => M.v(pp, [-n[e][0], -n[e][1], -n[e][2]], cc, t[e][2]));
      if (dot(fn, n[0]) >= 0) M.t(k, jd[0], jd[2], jd[1]); else M.t(k, jd[0], jd[1], jd[2]);
    }
  }
}

// ---------------------------------------------------------------- body sections
// lower body: under-floor, wheel-well liner and ceiling, rocker + lower side, crease, upper side to the top
function lowerSec(T, s, xe = 0) {
  const hw = T.hw(s), yt = T.top(s), fl = T.fl(s);
  const ya = Math.max(fl, T.archY(s));
  const ys = clamp(T.crease(s), ya + 0.035, yt - 0.03);
  const b = ys - ya, f = clamp(b / 0.3, 0.15, 1);
  const tk = T.sec.tuck * f, ln = Math.min(T.sec.lean * f, tk * 0.8), rr = Math.min(T.sec.rock, b * 0.4);
  const xB = hw - tk, y0 = ya + rr;
  const lower = [[xB, ya], [xB + (tk - ln) * 0.7071, ya + rr * 0.2929], [hw - ln, y0]];
  const tc = T.cladY ? clamp((T.cladY(s) - y0) / Math.max(1e-3, ys - y0), 0.15, 0.85) : 0.45;
  for (const t of [tc, 1]) lower.push([hw - ln * (1 - t), lerp(y0, ys, t)]);
  const upper = [], n = T.sec.n, tp = T.sec.taper;
  for (let k = 0; k <= 5; k++) {
    const th = (k / 5) * Math.PI / 2, ex = k === 5 ? 0 : Math.cos(th) ** (2 / n), ey = k === 0 ? 0 : Math.sin(th) ** (2 / n);
    upper.push([xe + (hw - xe) * ex * (1 - tp * ey), ys + (yt - ys) * ey]);
  }
  const xi = Math.min(T.xi, xB - 0.01);
  const S = { under: [[0, fl], [xi, fl]], liner: [[xi, fl], [xi, ya]], ceil: [[xi, ya], [xB, ya]], lower, upper, skin: [...lower, ...upper.slice(1)] };
  // crisp edge where the fender side turns into the bonnet / deck (separate normals either side)
  const ke = T.sec.edge;
  if (ke && !xe) { S.upper = upper.slice(0, ke + 1); S.top = upper.slice(ke); }
  return S;
}
function upperYAt(T, s, x) {
  const up = lowerSec(T, s).upper;
  if (x >= up[0][0]) return up[0][1];
  for (let k = 0; k < up.length - 1; k++) if (up[k + 1][0] <= x) return lerp(up[k][1], up[k + 1][1], (up[k][0] - x) / Math.max(1e-6, up[k][0] - up[k + 1][0]));
  return up[up.length - 1][1];
}
function skinU(T, s, x) {
  const sk = lowerSec(T, s).skin;
  for (let j = 4; j < sk.length - 1; j++) if (sk[j][0] >= x && sk[j + 1][0] <= x) return j + (sk[j][0] - x) / Math.max(1e-6, sk[j][0] - sk[j + 1][0]);
  return 6;
}
// greenhouse: belt trim, side glass, window frame, roof rail (corner), roof / windscreen / back light
function greenSec(T, s) {
  const G = T.g, hw = T.hw(s), bw = hw - G.inset;
  const yb = upperYAt(T, s, bw) - 0.006;
  const h = Math.max(0, G.roofF(s) - yb), yr = yb + h;
  const rc = Math.min(G.rc, h * 0.38), cr = Math.min(G.crown, h * 0.12);
  const ln = G.lean, p0 = Math.atan(ln), c0 = Math.cos(p0), s0 = Math.sin(p0);
  const ySide = yr - cr - rc + rc * s0;
  const yT = yb + Math.min(G.trimH, h * 0.1), yF = Math.max(yT, ySide - Math.min(G.frameH, h * 0.1));
  const xAt = (y) => bw - ln * (y - yb);
  const P1 = [xAt(ySide), ySide], cx = P1[0] - rc * c0, cy = yr - cr - rc, pm = (p0 + Math.PI / 2) / 2;
  return [[bw, yb], [xAt(yT), yT], [xAt((yT + yF) / 2), (yT + yF) / 2], [xAt(yF), yF], P1,
    [cx + rc * Math.cos(pm), cy + rc * Math.sin(pm)], [cx, yr - cr], [cx * 0.5, yr - cr * 0.25], [0, yr]];
}
function bedSec(T, s) {
  const hw = T.hw(s), xe = hw - 0.055, xin = hw - 0.085, yt = T.top(s), yf = T.bed.floor;
  const S = lowerSec(T, s, xe);
  S.rail = [[xe, yt], [xin, yt]]; S.wall = [[xin, yt], [xin, yf]]; S.bfloor = [[xin, yf], [0, yf]];
  S.skin = [...S.skin, [xin, yt]];
  return S;
}
function boxSec(B) {
  const { hw, y0, y1 } = B, r = 0.06, arc = (cx, cy, a0) => [0, 1, 2, 3].map((k) => { const a = a0 + (k / 3) * Math.PI / 2; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
  const S = { bot: [[0, y0], [hw - r, y0]], c1: arc(hw - r, y0 + r, -Math.PI / 2), side: [[hw, y0 + r], [hw, y1 - r]], c2: arc(hw - r, y1 - r, 0), top: [[hw - r, y1], [0, y1]] };
  S.skin = [...S.bot, ...S.c1.slice(1), ...S.side.slice(1), ...S.c2.slice(1), ...S.top.slice(1)];
  return S;
}

// stations along the length: dense in the end roundings and around the arches, gaps <= maxGap
function stations(T, s0, s1, maxGap, extra = []) {
  const req = [s0, s1, ...extra], cand = [], brkV = [], Le = T.Le;
  const endz = (R, from, dir) => { for (let k = 0; k <= 4; k++) cand.push(from + dir * R * (1 - Math.sin((k / 4) * Math.PI / 2))); };
  if (s0 <= 1e-6) { endz(T.ef.p, 0, 1); endz(T.ef.t, 0, 1); endz(T.ef.b, 0, 1); }
  if (s1 >= Le - 1e-6) { endz(T.er.p, Le, -1); endz(T.er.t, Le, -1); endz(T.er.b, Le, -1); }
  for (const w of T.axles) {
    if (w.s - w.R < s0 + 0.02 || w.s + w.R > s1 - 0.02) continue;
    for (let k = -4; k <= 4; k++) cand.push(w.s + w.R * Math.sin((k / 5) * Math.PI / 2));
    const e = [w.s - w.R - 0.004, w.s - w.R, w.s + w.R, w.s + w.R + 0.004];
    req.push(...e); brkV.push(...e);
  }
  const all = [...new Set(req.map((v) => +v.toFixed(6)))].filter((v) => v >= s0 - 1e-9 && v <= s1 + 1e-9);
  for (const c of cand) if (c > s0 && c < s1 && all.every((x) => Math.abs(x - c) > 0.018)) all.push(c);
  all.sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < all.length; i++) {
    if (i > 0) { const g = all[i] - all[i - 1], n = Math.ceil(g / maxGap - 1e-9); for (let k = 1; k < n; k++) out.push(all[i - 1] + (g * k) / n); }
    out.push(all[i]);
  }
  const br = brkV.map((v) => out.findIndex((x) => Math.abs(x - v) < 1e-5)).filter((i) => i > 0 && i < out.length - 1);
  return { st: out, br: [...new Set(br)].sort((a, b) => a - b) };
}

// loft a section function along stations, with hard breaks at the arch edges, plus end caps
function loft(M, T, lf) {
  const { st, br } = stations(T, lf.s0, lf.s1, lf.gap || 0.26, lf.extra);
  const secs = st.map((s) => lf.sec(s));
  for (const nm of Object.keys(secs[0])) {
    if (nm === 'skin') continue;
    const P = secs.map((sec, i) => sec[nm].map(([x, y]) => [x, y, T.z(st[i], x, y)]));
    // only the strips that the wheel arches cut need hard edges at the arch ends
    const segs = ['under', 'liner', 'ceil', 'lower'].includes(nm) ? [0, ...br, st.length - 1] : [0, st.length - 1];
    for (let k = 0; k < segs.length - 1; k++) {
      const a = segs[k], b = segs[k + 1]; if (b <= a) continue;
      grid(M, P.slice(a, b + 1), (i, j) => lf.mat(nm, (st[a + i] + st[a + i + 1]) / 2, j), { tg: true, col: lf.col });
    }
  }
  const cap = (i, dir) => {
    const s = st[i], sk = secs[i].skin.map(([x, y]) => [x, y, T.z(s, x, y)]);
    const ax = [0, sk[sk.length - 1][1] - sk[0][1], sk[sk.length - 1][2] - sk[0][2]];
    let n = nrm(crs([1, 0, 0], ax)); if (n[2] * dir < 0) n = [-n[0], -n[1], -n[2]];
    for (const mx of [1, -1]) {
      const R = sk.map((p) => M.v([p[0] * mx, p[1], p[2]], [n[0], n[1], n[2]], lf.col || WHITE));
      const Cc = sk.map((p) => M.v([0, p[1], p[2]], n, lf.col || WHITE));
      for (let j = 0; j < sk.length - 1; j++) {
        const m = matKey(lf.capMat ? lf.capMat(s, j) : 'paint');
        const tri = (a, b, c, pa, pb, pc) => {
          const fn = crs(sub(pb, pa), sub(pc, pa)); if (dot(fn, fn) < 1e-14) return;
          if (dot(fn, n) >= 0) M.t(m, a, b, c); else M.t(m, a, c, b);
          if (mx > 0) M.tg.push(dot(fn, n) >= 0 ? [a, b, c] : [a, c, b]);
        };
        const pr = (k) => [sk[k][0] * mx, sk[k][1], sk[k][2]], pc = (k) => [0, sk[k][1], sk[k][2]];
        tri(Cc[j], R[j], R[j + 1], pc(j), pr(j), pr(j + 1));
        tri(Cc[j], R[j + 1], Cc[j + 1], pc(j), pr(j + 1), pc(j + 1));
      }
    }
  };
  if (lf.capF) cap(0, -1);
  if (lf.capR) cap(st.length - 1, 1);
  return surfRec(st, secs.map((sec, i) => sec.skin.map(([x, y]) => [x, y, T.z(st[i], x, y)])));
}

// ---------------------------------------------------------------- wheels
// cv: how far (m) the spokes sink from the rim lip to the hub (concave face); flat: aero disc
const STYLES = {
  five: { n: 5, wi: 0.05, wo: 0.074, cv: 0.012 }, six: { n: 6, wi: 0.04, wo: 0.06, cv: 0.022 }, split: { n: 5, wi: 0.019, wo: 0.026, twin: 0.13, cv: 0.028 },
  multi: { n: 10, wi: 0.017, wo: 0.028, cv: 0.026 }, seven: { n: 7, wi: 0.03, wo: 0.048, cv: 0.03 }, aero: { n: 5, wi: 0.075, wo: 0.2, flat: true, cv: 0.004 },
  offroad: { n: 6, wi: 0.055, wo: 0.07, deep: true, cv: 0.045 }, steel: { steel: true }, truck: { steel: true, hub: 0.05 },
};
function spoke(M, ph, r0, r1, w0, w1, x0, x1, dep, col) {
  const er = [0, Math.cos(ph), Math.sin(ph)], et = [0, -Math.sin(ph), Math.cos(ph)];
  const P = (x, r, t) => [x, er[1] * r + et[1] * t, er[2] * r + et[2] * t];
  const a = P(x0, r0, -w0 / 2), b = P(x0, r0, w0 / 2), c = P(x1, r1, w1 / 2), d = P(x1, r1, -w1 / 2);
  const ma = P(x0 + 0.005, r0, 0), md = P(x1 + 0.004, r1, 0), bk = (p) => [p[0] - dep, p[1], p[2]];
  quad(M, 'misc', a, ma, md, d, col, [1, 0, 0]);
  quad(M, 'misc', ma, b, c, md, col, [1, 0, 0]);
  quad(M, 'misc', a, d, bk(d), bk(a), col, [0, -et[1], -et[2]]);
  quad(M, 'misc', b, c, bk(c), bk(b), col, et);
}
function wheelMB(T, rear) {
  const w = T.wh, M = new MB(), R = w.r, rr = w.r * w.rim, seg = 18, hw = w.w / 2, dual = rear && w.dual;
  // tyre: bead, sidewall bulge, shoulder, tread (the tread tile is mirrored every other segment, so it tiles)
  const tv = [0.03, 0.06, 0.12, 0.2, 0.3, 0.7, 0.8, 0.9, 0.97];
  const tyre = (x0) => revolve(M, 'misc', [[x0 + hw - 0.014, rr + 0.004], [x0 + hw + 0.002, rr + (R - rr) * 0.42], [x0 + hw - 0.006, R - 0.03], [x0 + hw - 0.028, R - 0.006],
    [x0 + hw - 0.048, R], [x0 - hw + 0.04, R], [x0 - hw + 0.022, R - 0.006], [x0 - hw, R - 0.036], [x0 - hw + 0.012, rr + 0.004]], seg, C.tyre, 0,
    (i, k) => uvOf('tread', k & 1, tv[i]));
  let xf = hw;
  if (dual) { tyre(hw + 0.006); tyre(-hw - 0.006); xf = 2 * hw + 0.006; } else tyre(0);
  const st = STYLES[w.style] || STYLES.five, rc = w.col || C.rim;
  revolve(M, 'misc', [[xf - 0.04, rr - 0.03], [xf - 0.012, rr + 0.004]], seg, rc);
  if (st.steel) {
    const xr = dual ? xf - 0.07 : xf;
    revolve(M, 'misc', [[xr - 0.045, 0], [xr - 0.045, rr * 0.3], [xr - 0.03, rr * 0.42], [xr - 0.03, rr * 0.62], [xr - 0.05, rr * 0.8], [xf - 0.04, rr - 0.03]], seg, rc);
    const hb = st.hub || 0;
    revolve(M, 'misc', [[xr - 0.02 + hb, 0], [xr - 0.024 + hb, rr * 0.16], [xr - 0.04, rr * 0.3]], 10, C.hub);
    for (let k = 0; k < 6; k++) {
      const ph = (k / 6) * Math.PI * 2 + 0.26, c = Math.cos(ph), s = Math.sin(ph), r0 = rr * 0.47, r1 = rr * 0.58, t = rr * 0.06, x = xr - 0.028;
      const P = (r, tt) => [x, c * r - s * tt, s * r + c * tt];
      quad(M, 'misc', P(r0, -t), P(r0, t), P(r1, t), P(r1, -t), C.steel, [1, 0, 0]);
    }
  } else {
    // dish: the brake disc (atlas) at the bottom of the barrel, then the barrel wall up to the lip
    const xd = xf - (st.deep ? 0.1 : 0.07), rd = rr - 0.04;
    revolve(M, 'misc', [[xd, 0], [xd, rd], [xf - 0.04, rr - 0.03]], seg, C.dish, 0,
      (i, k, ph, p) => { const q = (0.47 * p[1]) / rd; return uvOf('disc', 0.5 + q * Math.cos(ph), 0.5 + q * Math.sin(ph)); });
    const hubR = rr * 0.27, x1 = xf - 0.012, x0 = x1 - st.cv;
    for (let k = 0; k < st.n; k++) {
      const ph = (k / st.n) * Math.PI * 2;
      if (st.twin) { spoke(M, ph - st.twin / 2, hubR * 0.85, rr - 0.03, st.wi, st.wo, x0, x1, 0.035, rc); spoke(M, ph + st.twin / 2, hubR * 0.85, rr - 0.03, st.wi, st.wo, x0, x1, 0.035, rc); }
      else spoke(M, ph, hubR * 0.85, rr - 0.03, st.wi, st.wo, x0, x1, 0.035, rc);
    }
    revolve(M, 'misc', [[x0 + 0.007, 0], [x0 + 0.003, hubR * 0.6], [x0 - 0.005, hubR], [x0 - 0.032, hubR * 1.05]], 8, rc, Math.PI / st.n);
    revolve(M, 'misc', [[x0 + 0.009, 0], [x0 + 0.007, hubR * 0.42], [x0 + 0.002, hubR * 0.5]], 6, C.hub);
  }
  return M;
}

// ---------------------------------------------------------------- vehicle specs
// s runs from the front bumper (0) to the rear (L); heights in metres above the ground.
const q = (a, b, c, d, mir) => ({ q: [a, b, c, d], mir });
const el = (cx, cy, rx, ry, mir) => ({ e: [cx, cy, rx, ry], mir });
const expand = (sh, d) => { const c = [0, 1].map((k) => sh.q.reduce((a, p) => a + p[k], 0) / 4); return { q: sh.q.map((p) => [p[0] + Math.sign(p[0] - c[0]) * d, p[1] + Math.sign(p[1] - c[1]) * d]), mir: sh.mir }; };
// licence plate (atlas number) in a dark frame; full width so the number reads correctly
const plateF = (y, reg = 'plateA') => [
  ['bezel', q([-0.166, y - 0.012], [0.166, y - 0.012], [0.166, y + 0.162], [-0.166, y + 0.162], false), 2, 1, 0.006],
  ['plate', q([-0.153, y], [0.153, y], [0.153, y + 0.15], [-0.153, y + 0.15], false), 2, 1, 0.009, undefined, reg],
];
// a lamp cluster: glossy black bezel, the cluster graphic (projectors / DRL, lit at night) inset in it,
// and a clear lens over the lot; ix in the shape's first unit (metres, or degrees for corner decals)
const lamp = (pts, ix = 0.012, iy = ix * 0.8, lens = 'head', n = 6, reg = lens === 'head' ? 'headA' : 'tailA') => {
  const c = [0, 1].map((k) => (pts[0][k] + pts[1][k] + pts[2][k] + pts[3][k]) / 4);
  const ins = pts.map((p) => [p[0] + Math.sign(c[0] - p[0]) * ix, p[1] + Math.sign(c[1] - p[1]) * iy]);
  return [['bezel', q(...pts), n, 2, 0.004], [lens, q(...ins), n, 2, 0.007, undefined, reg], ['glass', q(...pts), n, 2, 0.011, GL.lamp]];
};
const lampC = (pts, lens = 'head', reg) => lamp(pts, 4, 0.012, lens, 8, reg);
// grille: atlas mesh / bars / slats, with an optional surround; badge: chrome emblem
const grille = (reg, sh, frame, na = 4) => [
  ...(frame ? [[frame, expand(sh, 0.018), na, 2, 0.004]] : []),
  [reg === 'grilleSlat' ? 'texM' : 'tex', sh, na, 2, 0.0065, undefined, reg],
];
const badge = (y, r = 0.042, x = 0) => ['texM', el(x, y, r, r, false), 12, 1, 0.01, undefined, 'badge'];
const fog = (x, y, r) => [['bezel', el(x, y, r, r * 0.8), 10, 1, 0.005], ['head', el(x, y, r * 0.66, r * 0.52), 10, 1, 0.008, undefined, 'headR']];
const reverse = (x, y, w = 0.08, h = 0.04) => ['white', q([x - w / 2, y], [x + w / 2, y], [x + w / 2, y + h], [x - w / 2, y + h]), 1, 1, 0.006];
const DEF = {
  sec: { tuck: 0.07, lean: 0.025, rock: 0.06, taper: 0.07, n: 4.2, edge: 3 },
  ef: { p: 0.38, t: 0.08, b: 0.08, rake: 0.1 }, er: { p: 0.3, t: 0.08, b: 0.1, rake: 0.05 },
  g: { inset: 0.075, lean: 0.3, rc: 0.09, crown: 0.03, trimH: 0.022, frameH: 0.018, trim: 'black', frame: 'black', rail: 'paint', roofM: 'paint', rearM: 'glass', mirS: 0.2 },
};

const sedanBase = {
  L: 4.8, W: 1.84,
  wh: { r: 0.335, w: 0.225, rim: 0.66, style: 'split', sF: 0.96, sR: 3.79 },
  floor: [[0, 0.22], [0.4, 0.19], [0.96, 0.175], [3.4, 0.175], [4.25, 0.21], [4.8, 0.28]],
  top: [[0, 0.79], [0.3, 0.825], [0.96, 0.875], [1.62, 0.94], [2.6, 0.965], [3.95, 1.0], [4.45, 1.02], [4.8, 1.0]],
  crease: [[0, 0.69], [0.96, 0.765], [3.0, 0.81], [4.8, 0.85]],
  ef: { p: 0.34, t: 0.07, b: 0.06, rake: 0.11 }, er: { p: 0.28, t: 0.08, b: 0.1, rake: 0.06 },
  val: 2, bz: [0.42, 0.4],
  g: { sA: 1.62, sW: 2.38, sR: 3.22, sC: 3.98, roof: [[1.62, null], [2.38, 1.395], [2.85, 1.45], [3.22, 1.415], [3.98, null]] },
  pil: [['black', q([2.62, 0.4], [2.71, 0.4], [2.69, 3.4], [2.6, 3.4])], ['paint', q([3.48, 0.4], [4.02, 0.4], [4.02, 4.05], [3.16, 4.05]), 5, 4]],
  seams: [1.52, 2.66, 3.47], handles: [2.1, 3.12], seats: [2.66, 3.5], fin: true, sunroof: [2.5, 3.08], exh: [[0.45, 'chrome']], deck: true,
  front: [
    ['black', q([0, 0.26], [0.6, 0.26], [0.54, 0.37], [0, 0.38]), 6, 2],
    ...grille('grilleHex', q([0, 0.275], [0.55, 0.275], [0.5, 0.36], [0, 0.365]), null, 6),
    ...grille('grilleHex', q([0, 0.43], [0.44, 0.444], [0.413, 0.596], [0, 0.606]), 'chrome', 5),
    badge(0.52),
    ...plateF(0.29),
  ],
  frontC: lampC([[-20, 0.6], [58, 0.625], [62, 0.71], [-18, 0.72]]),
  rear: [
    ['black', q([0, 0.27], [0.75, 0.27], [0.72, 0.35], [0, 0.35]), 6, 1],
    ...plateF(0.56), badge(0.79, 0.034), reverse(0.52, 0.755, 0.1, 0.035),
  ],
  rearC: lampC([[-30, 0.8], [64, 0.8], [68, 0.912], [-28, 0.918]], 'tail'),
};

const RAW = {
  hatch: {
    L: 4.2, W: 1.8,
    wh: { r: 0.315, w: 0.205, rim: 0.64, style: 'five', sF: 0.86, sR: 3.47 },
    floor: [[0, 0.22], [0.35, 0.19], [0.86, 0.175], [3.3, 0.175], [3.85, 0.22], [4.2, 0.28]],
    top: [[0, 0.76], [0.3, 0.8], [0.86, 0.86], [1.38, 0.93], [2.3, 0.965], [3.4, 1.0], [3.95, 1.025], [4.2, 1.0]],
    crease: [[0, 0.66], [0.86, 0.73], [2.3, 0.785], [4.2, 0.86]],
    ef: { p: 0.38, t: 0.08, b: 0.06, rake: 0.12 }, er: { p: 0.28, t: 0.06, b: 0.1, rake: 0.0 },
    val: 2, bz: [0.4, 0.35],
    g: { sA: 1.38, sW: 2.08, sR: 3.6, sC: 4.125, rp: 6.35, roof: [[1.38, null], [2.08, 1.385], [2.6, 1.44], [3.22, 1.41], [3.6, 1.345], [4.125, null]] },
    pil: [['black', q([2.4, 0.4], [2.48, 0.4], [2.46, 3.4], [2.38, 3.4])], ['paint', q([3.08, 0.4], [4.2, 0.4], [4.2, 4.05], [3.36, 4.05]), 5, 4]],
    seams: [1.44, 2.44, 3.24], handles: [1.95, 2.92], roofSpoiler: true, seats: [2.42, 3.3], fin: true, exh: [[0.42, 'black']],
    front: [
      ['black', q([0, 0.3], [0.52, 0.3], [0.5, 0.43], [0, 0.44]), 6, 2],
      ...grille('grilleHex', q([0, 0.315], [0.49, 0.315], [0.47, 0.415], [0, 0.425]), null, 6),
      ...grille('grilleHex', q([0, 0.52], [0.33, 0.53], [0.31, 0.6], [0, 0.605]), 'black', 4),
      badge(0.565, 0.036),
      ...plateF(0.32, 'plateB'),
      ...fog(0.66, 0.37, 0.05),
    ],
    frontC: lampC([[-24, 0.55], [54, 0.58], [58, 0.665], [-22, 0.645]]),
    rear: [
      ...plateF(0.58, 'plateB'),
      ['black', q([0, 0.28], [0.7, 0.28], [0.66, 0.36], [0, 0.36]), 6, 1],
      badge(0.8, 0.034), reverse(0.5, 0.76, 0.1, 0.035),
    ],
    rearC: lampC([[-28, 0.8], [58, 0.8], [62, 0.9], [-24, 0.915]], 'tail', 'tailC'),
  },
  sedan: sedanBase,
  taxi: { ...sedanBase, paint: 0xf2b705, wh: { ...sedanBase.wh, style: 'steel', col: C.steel, rim: 0.62 }, sign: true, stripe: true, sunroof: null, fin: false, exh: [[0.45, 'black']] },
  luxury: {
    L: 5.1, W: 1.9,
    wh: { r: 0.35, w: 0.245, rim: 0.7, style: 'multi', col: [0.75, 0.76, 0.78, 0.18], sF: 1.0, sR: 4.08 },
    floor: [[0, 0.22], [0.45, 0.19], [1.0, 0.175], [3.8, 0.175], [4.55, 0.21], [5.1, 0.28]],
    top: [[0, 0.84], [0.3, 0.87], [1.0, 0.91], [1.95, 0.98], [3.0, 1.0], [4.25, 1.04], [4.75, 1.06], [5.1, 1.03]],
    crease: [[0, 0.74], [1.0, 0.8], [3.0, 0.84], [5.1, 0.89]],
    ef: { p: 0.3, t: 0.06, b: 0.06, rake: 0.04 }, er: { p: 0.3, t: 0.08, b: 0.1, rake: 0.05 },
    sec: { n: 4.8 }, val: 1, bz: [0.42, 0.4],
    g: { sA: 1.95, sW: 2.72, sR: 3.66, sC: 4.36, trim: 'chrome', frame: 'chrome', roof: [[1.95, null], [2.72, 1.425], [3.2, 1.48], [3.66, 1.445], [4.36, null]] },
    pil: [['black', q([3.0, 0.4], [3.09, 0.4], [3.07, 3.4], [2.98, 3.4])], ['paint', q([3.78, 0.4], [4.4, 0.4], [4.4, 4.05], [3.58, 4.05]), 5, 4]],
    seams: [1.85, 3.04, 3.85], handles: [2.45, 3.5], handleM: 'chrome', strips: [['chrome', 1.3, 4.0, 2.55, 2.75]],
    seats: [3.04, 3.9], tintS: 3.04, fin: true, sunroof: [2.85, 3.5], exh: [[0.5, 'chrome'], [-0.5, 'chrome']], deck: true,
    front: [
      ...grille('grilleSlat', q([0, 0.425], [0.305, 0.425], [0.287, 0.695], [0, 0.695]), 'chrome', 4),
      badge(0.56, 0.04),
      ['black', q([0.42, 0.3], [0.8, 0.31], [0.78, 0.4], [0.44, 0.4]), 4, 1],
      ...grille('grilleHex', q([0.435, 0.312], [0.785, 0.322], [0.765, 0.39], [0.455, 0.388]), null, 4),
      ...plateF(0.3),
    ],
    frontC: lampC([[-30, 0.665], [56, 0.68], [60, 0.752], [-28, 0.745]]),
    rearC: lampC([[-40, 0.85], [70, 0.85], [72, 0.94], [-38, 0.945]], 'tail'),
    rear: [
      ['chrome', q([0, 0.875], [0.42, 0.875], [0.42, 0.89], [0, 0.89]), 4, 1, 0.005],
      ['black', q([0, 0.28], [0.8, 0.28], [0.78, 0.35], [0, 0.35]), 6, 1],
      ...plateF(0.6), badge(0.815, 0.034), reverse(0.55, 0.79, 0.1, 0.035),
    ],
  },
  coupe: {
    L: 4.55, W: 1.9,
    wh: { r: 0.335, w: 0.255, rim: 0.72, style: 'split', col: C.rimDark, sF: 1.0, sR: 3.72 },
    floor: [[0, 0.21], [0.4, 0.15], [1.0, 0.135], [3.4, 0.135], [4.05, 0.17], [4.55, 0.26]],
    top: [[0, 0.66], [0.3, 0.72], [1.0, 0.815], [1.85, 0.89], [2.6, 0.92], [3.5, 0.95], [4.25, 0.98], [4.55, 0.96]],
    crease: [[0, 0.6], [1.0, 0.765], [2.3, 0.76], [3.72, 0.8], [4.55, 0.83]],
    hips: [[0, -0.05], [1.0, -0.012], [2.2, -0.045], [3.72, 0], [4.55, -0.03]],
    ef: { p: 0.45, t: 0.09, b: 0.06, rake: 0.15 }, er: { p: 0.32, t: 0.08, b: 0.08, rake: 0.06 },
    sec: { tuck: 0.08, lean: 0.03, rock: 0.05, taper: 0.1, n: 3.6 }, val: 3, bz: [0.45, 0.42],
    g: { sA: 1.85, sW: 2.62, sR: 3.2, sC: 4.12, inset: 0.1, lean: 0.38, rc: 0.08, roof: [[1.85, null], [2.62, 1.27], [2.92, 1.3], [3.2, 1.27], [4.12, null]] },
    pil: [['paint', q([3.15, 0.4], [4.2, 0.4], [4.2, 4.05], [2.98, 4.05]), 5, 4]],
    seams: [1.64, 3.08], handles: [2.85], seats: [2.95, 3.45], fin: true, exh: [[0.42, 'chrome'], [-0.42, 'chrome']], deck: true,
    front: [
      ['black', q([0, 0.22], [0.44, 0.23], [0.42, 0.42], [0, 0.42]), 5, 2],
      ...grille('grilleHex', q([0, 0.235], [0.42, 0.245], [0.4, 0.405], [0, 0.405]), null, 5),
      ['black', q([0.5, 0.25], [0.78, 0.27], [0.76, 0.41], [0.5, 0.4]), 4, 2],
      ...grille('grilleHex', q([0.515, 0.265], [0.765, 0.283], [0.745, 0.395], [0.515, 0.387]), null, 3),
      badge(0.47, 0.036),
      ...plateF(0.25, 'plateB'),
    ],
    frontC: lamp([[-12, 0.52], [52, 0.56], [58, 0.61], [-8, 0.575]], 4, 0.01, 'head', 10),
    rearC: lamp([[-34, 0.815], [62, 0.82], [66, 0.87], [-32, 0.872]], 4, 0.01, 'tail', 10),
    rear: [
      ['black', q([0, 0.24], [0.72, 0.24], [0.7, 0.4], [0, 0.4]), 6, 2],
      ...grille('grilleHex', q([0, 0.255], [0.7, 0.255], [0.68, 0.385], [0, 0.385]), null, 6),
      ...plateF(0.6, 'plateB'), badge(0.78, 0.032),
    ],
    spoiler: true,
  },
  wagon: {
    ...sedanBase, L: 4.85,
    wh: { r: 0.335, w: 0.225, rim: 0.66, style: 'six', sF: 0.96, sR: 3.82 },
    floor: [[0, 0.22], [0.4, 0.19], [0.96, 0.175], [3.5, 0.175], [4.3, 0.21], [4.85, 0.28]],
    top: [[0, 0.79], [0.3, 0.825], [0.96, 0.875], [1.62, 0.94], [2.6, 0.965], [4.0, 1.0], [4.85, 1.0]],
    crease: [[0, 0.69], [0.96, 0.765], [3.0, 0.81], [4.85, 0.85]],
    er: { p: 0.28, t: 0.06, b: 0.1, rake: 0.0 },
    g: { sA: 1.62, sW: 2.38, sR: 4.5, sC: 4.775, rp: 6.3, roof: [[1.62, null], [2.38, 1.405], [2.9, 1.47], [4.0, 1.455], [4.5, 1.42], [4.775, null]] },
    pil: [['black', q([2.62, 0.4], [2.71, 0.4], [2.69, 3.4], [2.6, 3.4])], ['black', q([3.56, 0.4], [3.64, 0.4], [3.6, 3.4], [3.52, 3.4])],
      ['paint', q([4.16, 0.4], [4.9, 0.4], [4.9, 4.05], [4.34, 4.05]), 5, 4]],
    rails: 'chrome', roofSpoiler: true, seats: [2.66, 3.58], tintS: 2.66, sunroof: [2.5, 3.1], deck: false,
    rear: [
      ['black', q([0, 0.28], [0.75, 0.28], [0.72, 0.36], [0, 0.36]), 6, 1],
      ...plateF(0.6), badge(0.82, 0.034), reverse(0.5, 0.77, 0.1, 0.035),
    ],
    rearC: lampC([[-30, 0.8], [60, 0.8], [64, 0.915], [-28, 0.92]], 'tail'),
  },
  crossover: {
    L: 4.45, W: 1.84,
    wh: { r: 0.35, w: 0.225, rim: 0.62, style: 'five', sF: 0.9, sR: 3.55, gap: 0.06 },
    floor: [[0, 0.29], [0.4, 0.25], [0.9, 0.215], [3.3, 0.215], [3.95, 0.27], [4.45, 0.34]],
    top: [[0, 0.88], [0.3, 0.92], [0.9, 0.98], [1.38, 1.03], [2.3, 1.06], [3.6, 1.09], [4.2, 1.09], [4.45, 1.07]],
    crease: [[0, 0.8], [0.9, 0.83], [2.5, 0.87], [4.45, 0.93]],
    clad: 0.17, flare: 0.032,
    ef: { p: 0.4, t: 0.09, b: 0.1, rake: 0.1 }, er: { p: 0.28, t: 0.07, b: 0.12, rake: 0.03 },
    sec: { tuck: 0.06, lean: 0.02, rock: 0.06, taper: 0.07, n: 4.2 }, val: 3, bz: [0.42, 0.4],
    g: { sA: 1.38, sW: 2.12, sR: 4.08, sC: 4.37, rp: 6.35, inset: 0.08, lean: 0.24, rc: 0.1, rail: 'black', roof: [[1.38, null], [2.12, 1.575], [2.8, 1.63], [3.7, 1.605], [4.08, 1.565], [4.37, null]] },
    pil: [['black', q([2.42, 0.4], [2.51, 0.4], [2.49, 3.4], [2.4, 3.4])], ['black', q([3.33, 0.4], [3.41, 0.4], [3.45, 3.4], [3.37, 3.4])],
      ['paint', q([3.86, 0.4], [4.45, 0.4], [4.45, 3.6], [3.98, 3.6]), 5, 4]],
    seams: [1.46, 2.46, 3.35], handles: [1.98, 2.95], seats: [2.46, 3.37], tintS: 2.46, fin: true, sunroof: [2.3, 2.9], exh: [[0.5, 'chrome']],
    rails: 'black', roofSpoiler: true,
    front: [
      ...grille('grilleBar', q([0, 0.56], [0.35, 0.57], [0.33, 0.655], [0, 0.66]), 'chrome', 4),
      badge(0.61, 0.038),
      ['black', q([0, 0.37], [0.5, 0.37], [0.44, 0.52], [0, 0.52]), 5, 2],
      ...grille('grilleHex', q([0, 0.385], [0.48, 0.385], [0.43, 0.505], [0, 0.505]), null, 5),
      ...plateF(0.36),
      ...fog(0.67, 0.42, 0.045),
    ],
    frontC: lampC([[-20, 0.645], [52, 0.675], [56, 0.75], [-18, 0.722]]),
    rear: [
      ['black', q([0, 0.36], [0.8, 0.36], [0.78, 0.48], [0, 0.48]), 6, 1],
      ...plateF(0.68), badge(0.92, 0.034), reverse(0.55, 0.84, 0.1, 0.035),
    ],
    rearC: lampC([[-36, 0.88], [54, 0.88], [58, 0.975], [-34, 0.985]], 'tail', 'tailC'),
  },
  suv: {
    L: 4.9, W: 1.95,
    wh: { r: 0.375, w: 0.245, rim: 0.64, style: 'six', sF: 1.0, sR: 3.95, gap: 0.06 },
    floor: [[0, 0.33], [0.45, 0.28], [1.0, 0.235], [3.7, 0.235], [4.35, 0.29], [4.9, 0.37]],
    top: [[0, 0.99], [0.3, 1.03], [1.0, 1.08], [1.55, 1.13], [2.5, 1.15], [4.0, 1.17], [4.6, 1.17], [4.9, 1.15]],
    crease: [[0, 0.9], [1.0, 0.91], [2.5, 0.95], [4.9, 0.99]],
    clad: 0.18, flare: 0.035,
    ef: { p: 0.4, t: 0.09, b: 0.1, rake: 0.08 }, er: { p: 0.3, t: 0.07, b: 0.12, rake: 0.03 },
    sec: { tuck: 0.06, lean: 0.02, rock: 0.06, taper: 0.06, n: 4.6 }, val: 3, bz: [0.45, 0.42],
    g: { sA: 1.55, sW: 2.3, sR: 4.55, sC: 4.815, rp: 6.35, inset: 0.08, lean: 0.22, rc: 0.1, roof: [[1.55, null], [2.3, 1.705], [3.0, 1.76], [4.2, 1.745], [4.55, 1.715], [4.815, null]] },
    pil: [['black', q([2.78, 0.4], [2.87, 0.4], [2.85, 3.4], [2.76, 3.4])], ['black', q([3.76, 0.4], [3.84, 0.4], [3.86, 3.4], [3.78, 3.4])],
      ['paint', q([4.22, 0.4], [4.95, 0.4], [4.95, 4.05], [4.4, 4.05]), 5, 4]],
    seams: [1.62, 2.82, 3.8], handles: [2.2, 3.35], seats: [2.82, 3.8], tintS: 2.82, fin: true, sunroof: [2.45, 3.1], exh: [[0.55, 'chrome']],
    rails: 'chrome', roofSpoiler: true,
    front: [
      ...grille('grilleBar', q([0, 0.6], [0.44, 0.6], [0.42, 0.835], [0, 0.835]), 'chrome', 4),
      badge(0.72, 0.046),
      ['black', q([0, 0.42], [0.52, 0.42], [0.48, 0.54], [0, 0.54]), 5, 2],
      ...grille('grilleHex', q([0.2, 0.435], [0.5, 0.435], [0.465, 0.525], [0.2, 0.525]), null, 3),
      ...plateF(0.42),
      ...fog(0.7, 0.5, 0.04),
    ],
    frontC: lampC([[-16, 0.785], [54, 0.805], [58, 0.89], [-14, 0.875]], 'head', 'headB'),
    rear: [
      ['black', q([0, 0.4], [0.86, 0.4], [0.84, 0.5], [0, 0.5]), 6, 1],
      ...plateF(0.74), badge(1.0, 0.038), reverse(0.6, 0.915, 0.1, 0.035),
    ],
    rearC: lampC([[-28, 0.955], [58, 0.955], [62, 1.05], [-26, 1.06]], 'tail', 'tailC'),
  },
  offroad: {
    L: 4.75, Lb: 4.5, W: 1.95,
    wh: { r: 0.395, w: 0.265, rim: 0.54, style: 'offroad', col: C.rimDark, sF: 0.86, sR: 3.62, gap: 0.08, inset: 0.0 },
    floor: [[0, 0.46], [0.4, 0.39], [0.86, 0.34], [3.4, 0.34], [3.95, 0.39], [4.5, 0.46]],
    top: [[0, 1.08], [0.2, 1.09], [0.86, 1.11], [1.55, 1.15], [3.0, 1.16], [4.5, 1.16]],
    crease: [[0, 1.0], [4.5, 1.02]],
    flare: 0.075,
    ef: { p: 0.14, t: 0.05, b: 0.05, rake: 0.02 }, er: { p: 0.12, t: 0.04, b: 0.05, rake: 0.0 },
    sec: { tuck: 0.05, lean: 0.012, rock: 0.05, taper: 0.03, n: 6 }, val: 3, bz: [0.3, 0.3],
    g: { sA: 1.55, sW: 1.86, sR: 4.4, sC: 4.455, rp: 6.5, inset: 0.06, lean: 0.07, rc: 0.05, crown: 0.012, roof: [[1.55, null], [1.86, 1.83], [2.3, 1.855], [4.4, 1.855], [4.455, null]] },
    pil: [['black', q([2.62, 0.4], [2.72, 0.4], [2.72, 3.4], [2.62, 3.4])], ['paint', q([3.55, 0.4], [3.72, 0.4], [3.72, 4.05], [3.55, 4.05]), 2, 4],
      ['paint', q([4.18, 0.4], [4.6, 0.4], [4.6, 4.05], [4.18, 4.05]), 3, 4]],
    seams: [1.62, 2.67, 3.52], handles: [2.2, 3.18], hinges: true, seats: [2.67, 3.6], tintS: 2.67, mast: true, exh: [[0.5, 'black']], flaps: true,
    front: [
      ['black', q([0, 0.71], [0.4, 0.71], [0.4, 0.99], [0, 0.99]), 4, 3],
      ...grille('grilleHex', q([0, 0.72], [0.39, 0.72], [0.39, 0.98], [0, 0.98]), null, 4),
      ...[0.05, 0.13, 0.21, 0.29].map((x) => ['paint', q([x, 0.73], [x + 0.045, 0.73], [x + 0.045, 0.97], [x, 0.97]), 1, 2, 0.009]),
      ['chrome', el(0.62, 0.87, 0.115, 0.115), 16, 1, 0.005], ['head', el(0.62, 0.87, 0.095, 0.095), 16, 2, 0.008, undefined, 'headR'],
      ['glass', el(0.62, 0.87, 0.1, 0.1), 16, 1, 0.012, GL.lamp],
      ['amber', q([0.48, 0.73], [0.56, 0.73], [0.56, 0.77], [0.48, 0.77]), 1, 1, 0.006],
    ],
    rear: [
      ['tail', q([0.8, 0.72], [0.92, 0.72], [0.92, 0.98], [0.8, 0.98]), 2, 3, 0.006, undefined, 'tailB'],
      ['bezel', q([0.79, 0.71], [0.93, 0.71], [0.93, 0.99], [0.79, 0.99]), 2, 3, 0.003],
      ['glass', q([0.79, 0.71], [0.93, 0.71], [0.93, 0.99], [0.79, 0.99]), 2, 3, 0.01, GL.lamp],
      ['bezel', q([-0.52, 0.5], [-0.17, 0.5], [-0.17, 0.67], [-0.52, 0.67], false), 2, 1, 0.006],
      ['plate', q([-0.5, 0.515], [-0.19, 0.515], [-0.19, 0.655], [-0.5, 0.655], false), 2, 1, 0.009, undefined, 'plateB'],
    ],
    bumpers: true, spare: true,
  },
  pickup: {
    L: 5.85, W: 2.03,
    wh: { r: 0.41, w: 0.275, rim: 0.62, style: 'six', sF: 1.05, sR: 4.75, gap: 0.07 },
    floor: [[0, 0.5], [0.5, 0.4], [1.05, 0.35], [4.0, 0.37], [4.75, 0.38], [5.85, 0.48]],
    top: [[0, 1.2], [0.3, 1.23], [1.05, 1.27], [2.05, 1.32], [3.5, 1.34], [5.85, 1.34]],
    crease: [[0, 1.08], [5.85, 1.14]],
    flare: 0.045,
    ef: { p: 0.22, t: 0.08, b: 0.1, rake: 0.05 }, er: { p: 0.08, t: 0.03, b: 0.06, rake: 0.0 },
    sec: { tuck: 0.06, lean: 0.015, rock: 0.06, taper: 0.04, n: 5.5 }, val: 3, bz: [0.4, 0.3],
    g: { sA: 2.05, sW: 2.66, sR: 3.46, sC: 3.525, inset: 0.07, lean: 0.12, rc: 0.07, roof: [[2.05, null], [2.66, 1.87], [3.0, 1.92], [3.46, 1.9], [3.525, null]] },
    pil: [['black', q([2.98, 0.4], [3.08, 0.4], [3.07, 3.4], [2.97, 3.4])], ['paint', q([3.36, 0.4], [3.6, 0.4], [3.6, 4.05], [3.36, 4.05]), 2, 4]],
    seams: [2.08, 3.02, 3.5], handles: [2.55, 3.32], seats: [3.02, null], fin: true, exh: [[0.6, 'chrome']], flaps: true,
    cab: 3.53, bed: { s0: 3.6, floor: 0.92 },
    front: [
      ...grille('grilleBar', q([0, 0.71], [0.49, 0.71], [0.49, 1.05], [0, 1.05]), 'chrome', 4),
      badge(0.88, 0.05),
      ...grille('grilleHex', q([0.2, 0.545], [0.62, 0.545], [0.6, 0.66], [0.2, 0.66]), 'black', 3),
      ...lamp([[0.55, 0.88], [0.95, 0.9], [0.95, 1.07], [0.55, 1.07]], 0.016, 0.0128, 'head', 6, 'headB'),
      ...plateF(0.5),
    ],
    rear: [
      ['tail', q([0.875, 0.92], [0.995, 0.92], [0.995, 1.29], [0.875, 1.29]), 2, 4, 0.006, undefined, 'tailB'],
      ['bezel', q([0.865, 0.91], [1.005, 0.91], [1.005, 1.3], [0.865, 1.3]), 2, 4, 0.003],
      ['black', q([0, 1.18], [0.12, 1.18], [0.12, 1.225], [0, 1.225]), 2, 1, 0.006],
    ],
    rearBumper: 'chrome',
  },
  van: {
    L: 5.15, W: 2.0,
    wh: { r: 0.36, w: 0.235, rim: 0.62, style: 'five', sF: 0.98, sR: 4.0, gap: 0.06 },
    floor: [[0, 0.27], [0.4, 0.23], [0.98, 0.2], [3.8, 0.2], [4.55, 0.26], [5.15, 0.32]],
    top: [[0, 0.86], [0.3, 0.92], [0.98, 1.02], [1.36, 1.08], [2.5, 1.1], [4.5, 1.12], [5.15, 1.1]],
    crease: [[0, 0.8], [0.98, 0.84], [5.15, 0.9]],
    ef: { p: 0.42, t: 0.1, b: 0.1, rake: 0.14 }, er: { p: 0.3, t: 0.06, b: 0.12, rake: 0.02 },
    val: 2, bz: [0.45, 0.42], roofSpoiler: true,
    g: { sA: 1.36, sW: 2.28, sR: 4.9, sC: 5.085, rp: 6.35, inset: 0.08, lean: 0.2, rc: 0.13, roof: [[1.36, null], [2.28, 1.69], [3.0, 1.78], [4.5, 1.77], [4.9, 1.725], [5.085, null]] },
    pil: [['black', q([2.5, 0.4], [2.6, 0.4], [2.58, 3.4], [2.48, 3.4])], ['black', q([3.76, 0.4], [3.84, 0.4], [3.84, 3.4], [3.76, 3.4])],
      ['paint', q([4.5, 0.4], [5.2, 0.4], [5.2, 4.05], [4.62, 4.05]), 5, 4]],
    seams: [1.46, 2.55, 3.8], handles: [2.05, 2.75], slider: [2.62, 4.45], seats: [2.55, 3.8], tintS: 2.55, mast: true, exh: [[0.5, 'black']],
    front: [
      ...grille('grilleBar', q([0, 0.5], [0.38, 0.5], [0.36, 0.6], [0, 0.6]), 'chrome', 4),
      badge(0.55, 0.038),
      ['black', q([0, 0.33], [0.55, 0.33], [0.5, 0.44], [0, 0.44]), 5, 2],
      ...grille('grilleHex', q([0.2, 0.345], [0.53, 0.345], [0.49, 0.425], [0.2, 0.425]), null, 3),
      ...plateF(0.36, 'plateB'),
    ],
    frontC: lampC([[-24, 0.62], [50, 0.6], [56, 0.72], [-22, 0.705]], 'head', 'headB'),
    rear: [
      ['tail', q([0.6, 0.9], [0.8, 0.9], [0.76, 1.38], [0.62, 1.38]), 2, 5, 0.006, undefined, 'tailB'],
      ['bezel', q([0.59, 0.89], [0.81, 0.89], [0.77, 1.39], [0.61, 1.39]), 2, 5, 0.003],
      ['glass', q([0.59, 0.89], [0.81, 0.89], [0.77, 1.39], [0.61, 1.39]), 2, 5, 0.01, GL.lamp],
      ['black', q([0, 0.3], [0.85, 0.3], [0.83, 0.42], [0, 0.42]), 6, 1],
      ['chrome', q([0, 0.9], [0.42, 0.9], [0.42, 0.915], [0, 0.915]), 4, 1, 0.005],
      ...plateF(0.62, 'plateB'), badge(0.84, 0.036),
    ],
  },
  cargo: {
    L: 5.93, W: 2.02,
    wh: { r: 0.355, w: 0.235, rim: 0.58, style: 'steel', col: C.steel, sF: 0.94, sR: 4.6, gap: 0.07 },
    floor: [[0, 0.37], [0.4, 0.33], [0.94, 0.31], [4.6, 0.31], [5.93, 0.4]],
    top: [[0, 0.93], [0.25, 0.99], [0.94, 1.17], [1.14, 1.25], [2.5, 1.27], [5.93, 1.27]],
    crease: [[0, 0.86], [0.94, 0.9], [5.93, 1.0]],
    ef: { p: 0.3, t: 0.12, b: 0.12, rake: 0.12 }, er: { p: 0.08, t: 0.03, b: 0.08, rake: 0.0 },
    sec: { tuck: 0.05, lean: 0.015, rock: 0.06, taper: 0.03, n: 5 }, val: 3, bz: [0.4, 0.25],
    g: { sA: 1.14, sW: 1.86, sR: 5.86, sC: 5.905, inset: 0.04, lean: 0.06, rc: 0.22, crown: 0.04, rearM: 'paint', mirS: 0.12, roof: [[1.14, null], [1.86, 2.37], [2.35, 2.52], [5.0, 2.55], [5.86, 2.54], [5.905, null]] },
    pil: [['paint', q([2.3, 0.3], [6.0, 0.3], [6.0, 4.05], [2.3, 4.05]), 12, 4], ['black', q([2.22, 0.3], [2.3, 0.3], [2.3, 3.6], [2.22, 3.6]), 1, 4]],
    seams: [1.2, 2.26, 3.3, 5.0], handles: [1.85, 3.38], slider: [2.4, 4.9], bigMirror: true, seats: [2.26, null], mast: true, exh: [[0.55, 'black']], flaps: true,
    front: [
      ...grille('grilleBar', q([0, 0.68], [0.5, 0.68], [0.48, 0.9], [0, 0.9]), 'black', 4),
      badge(0.79, 0.04),
      ...grille('grilleHex', q([0.2, 0.47], [0.58, 0.47], [0.56, 0.58], [0.2, 0.58]), 'black', 3),
      ...plateF(0.42, 'plateB'),
    ],
    frontC: lampC([[-30, 0.82], [40, 0.78], [46, 0.97], [-28, 0.97]], 'head', 'headB'),
    rear: [
      ['bezel', q([0.04, 1.53], [0.76, 1.53], [0.76, 2.14], [0.04, 2.14]), 3, 2, 0.004],
      ['glass', q([0.06, 1.55], [0.74, 1.55], [0.74, 2.12], [0.06, 2.12]), 3, 2, 0.006, GL.tint],
      ['black', q([0, 0.42], [0.008, 0.42], [0.008, 2.42], [0, 2.42]), 1, 6, 0.006],
      ['tail', q([0.86, 0.48], [0.985, 0.48], [0.985, 1.12], [0.86, 1.12]), 2, 3, 0.006, undefined, 'tailB'],
      ['bezel', q([0.85, 0.47], [0.995, 0.47], [0.995, 1.13], [0.85, 1.13]), 2, 3, 0.003],
      ...plateF(0.62, 'plateB'),
      ['handle', q([0.03, 1.1], [0.05, 1.1], [0.05, 1.4], [0.03, 1.4]), 1, 2, 0.008],
    ],
  },
  truck: {
    L: 7.0, Lb: 2.35, W: 2.3, Wc: 2.1,
    wh: { r: 0.4, w: 0.23, rim: 0.6, style: 'truck', col: C.steelW, sF: 1.08, sR: 5.15, gap: 0.07, dual: true },
    floor: [[0, 0.5], [0.5, 0.46], [1.08, 0.45], [2.35, 0.47]],
    top: [[0, 1.08], [0.3, 1.15], [0.9, 1.3], [1.3, 1.38], [2.35, 1.4]],
    crease: [[0, 0.98], [2.35, 1.06]],
    ef: { p: 0.25, t: 0.1, b: 0.1, rake: 0.1 }, er: { p: 0.05, t: 0.03, b: 0.03, rake: 0 },
    sec: { tuck: 0.05, lean: 0.015, rock: 0.06, taper: 0.03, n: 5 }, val: 3, bz: [0.4, 0.2],
    g: { sA: 1.3, sW: 1.78, sR: 2.26, sC: 2.325, inset: 0.05, lean: 0.06, rc: 0.15, crown: 0.03, rearM: 'paint', mirS: 0.1, roof: [[1.3, null], [1.78, 2.3], [2.05, 2.36], [2.26, 2.36], [2.325, null]] },
    pil: [['paint', q([2.12, 0.3], [2.4, 0.3], [2.4, 4.05], [2.12, 4.05]), 2, 4]],
    seams: [1.3, 2.1], handles: [1.95], bigMirror: true, seats: [2.08, null], mast: true, flaps: true,
    box: { s0: 2.45, hw: 1.15, y0: 1.08, y1: 3.12 },
    front: [
      ...grille('grilleBar', q([0, 0.8], [0.46, 0.8], [0.46, 0.98], [0, 0.98]), 'chrome', 4),
      badge(0.89, 0.05),
      ...plateF(0.62),
    ],
    frontC: lampC([[-44, 0.8], [30, 0.8], [34, 0.98], [-42, 0.98]], 'head', 'headB'),
    rear: [],
  },
  ev: {
    L: 4.75, W: 1.92,
    wh: { r: 0.345, w: 0.245, rim: 0.68, style: 'aero', col: [0.3, 0.31, 0.32, 0.3], sF: 0.92, sR: 3.82 },
    floor: [[0, 0.2], [0.4, 0.17], [0.92, 0.16], [3.6, 0.16], [4.2, 0.2], [4.75, 0.28]],
    top: [[0, 0.7], [0.3, 0.755], [0.92, 0.83], [1.48, 0.92], [3.0, 0.975], [4.2, 1.0], [4.75, 0.98]],
    crease: [[0, 0.66], [0.92, 0.78], [3.0, 0.8], [4.75, 0.86]],
    ef: { p: 0.5, t: 0.14, b: 0.08, rake: 0.18 }, er: { p: 0.3, t: 0.08, b: 0.1, rake: 0.08 },
    sec: { tuck: 0.08, lean: 0.03, rock: 0.06, taper: 0.09, n: 3.4 }, val: 2, bz: [0.45, 0.42],
    g: { sA: 1.48, sW: 2.25, sR: 3.35, sC: 4.38, inset: 0.09, lean: 0.32, rc: 0.09, roofM: 'glass', rail: 'black', roof: [[1.48, null], [2.25, 1.395], [2.75, 1.44], [3.35, 1.39], [4.0, 1.18], [4.38, null]] },
    pil: [['black', q([2.6, 0.4], [2.68, 0.4], [2.66, 3.4], [2.58, 3.4])], ['paint', q([3.55, 0.4], [4.45, 0.4], [4.45, 4.05], [3.3, 4.05]), 5, 4]],
    seams: [1.56, 2.64, 3.5], flush: true, handles: [2.15, 3.2], seats: [2.64, 3.55], fin: true, exh: [],
    front: [
      ['black', q([0, 0.26], [0.5, 0.26], [0.45, 0.36], [0, 0.36]), 5, 2],
      ...grille('grilleHex', q([0, 0.275], [0.48, 0.275], [0.43, 0.345], [0, 0.35]), null, 5),
      ...plateF(0.37),
      ['head', q([0, 0.566], [0.5, 0.572], [0.5, 0.581], [0, 0.575]), 6, 1, 0.006],
      badge(0.63, 0.034),
    ],
    frontC: lamp([[8, 0.552], [52, 0.585], [58, 0.635], [12, 0.6]], 4, 0.01, 'head', 10),
    rear: [
      ['tail', q([0, 0.845], [0.6, 0.845], [0.6, 0.895], [0, 0.895]), 8, 2],
      ['bezel', q([0, 0.83], [0.62, 0.83], [0.62, 0.91], [0, 0.91]), 8, 2, 0.003],
      ['glass', q([0, 0.83], [0.62, 0.83], [0.62, 0.91], [0, 0.91]), 8, 2, 0.01, GL.lamp],
      ['black', q([0, 0.28], [0.76, 0.28], [0.72, 0.38], [0, 0.38]), 6, 1],
      ...plateF(0.6), badge(0.785, 0.032),
    ],
    rearC: lamp([[-10, 0.845], [62, 0.845], [66, 0.895], [-10, 0.895]], 0, 0, 'tail', 10, 'red').slice(1)
      .concat([['bezel', q([-10, 0.83], [64, 0.83], [68, 0.91], [-10, 0.91]), 10, 2, 0.003]]),
  },
};

function prep(name, o) {
  const T = { name, ...o };
  T.sec = { ...DEF.sec, ...o.sec }; T.ef = { ...DEF.ef, ...o.ef }; T.er = { ...DEF.er, ...o.er };
  T.g = { ...DEF.g, ...o.g };
  T.wh = { inset: 0.025, gap: 0.05, rim: 0.65, style: 'five', col: C.rim, ...o.wh };
  T.val = o.val ?? 2; T.bz = o.bz || [0.42, 0.4];
  const L = T.L, Le = (T.Le = T.Lb || L), Wb = (T.Wc || T.W) / 2;
  const fC = curve(o.floor), tC = curve(o.top), cC = curve(o.crease), hC = o.hips ? curve(o.hips) : () => 0;
  const drop = (d, R) => (d >= R || R <= 0 ? 0 : R - Math.sqrt(Math.max(0, R * R - (R - d) * (R - d))));
  T.hw = (s) => Wb + hC(s) - drop(s, T.ef.p) - drop(Le - s, T.er.p);
  T.top = (s) => tC(s) - drop(s, T.ef.t) - drop(Le - s, T.er.t);
  T.fl = (s) => fC(s) + drop(s, T.ef.b) + drop(Le - s, T.er.b);
  T.crease = cC;
  const R = T.wh.r + T.wh.gap;
  T.axles = [{ s: T.wh.sF, R, front: true }, { s: T.wh.sR, R, front: false }];
  T.archY = (s) => { let y = -1; for (const a of T.axles) { const d = s - a.s; if (Math.abs(d) <= a.R + 1e-9) y = Math.max(y, T.wh.r + Math.sqrt(Math.max(0, a.R * a.R - d * d))); } return y; };
  T.cladY = T.clad ? (s) => T.fl(s) + T.clad : null;
  T.wx = Wb - T.wh.inset - T.wh.w / 2;
  T.wxR = T.wh.dual ? T.W / 2 - 0.05 - T.wh.w - 0.006 : T.wx;
  T.xi = T.wx - T.wh.w / 2 - 0.035;
  const zf = Math.max(T.ef.p, T.ef.t) + 0.45, zr = Math.max(T.er.p, T.er.t) + 0.45;
  const f0 = T.fl(0), f1 = T.top(0), r0 = T.fl(Le), r1 = T.top(Le);
  T.z = (s, x, y) => {
    let z = s - L / 2;
    if (T.ef.rake && s < zf) z += T.ef.rake * (1 - sstep(0, zf, s)) * clamp((y - f0) / (f1 - f0), 0, 1);
    if (T.er.rake && s > Le - zr) z -= T.er.rake * sstep(Le - zr, Le, s) * clamp((y - r0) / (r1 - r0), 0, 1);
    return z;
  };
  T.g.roofF = curve(T.g.roof.map(([s, y]) => [s, y ?? upperYAt(T, s, T.hw(s) - T.g.inset) - 0.02]));
  return T;
}
const SPECS = {};
for (const k in RAW) SPECS[k] = prep(k, RAW[k]);

export const NPC_TYPES = {};
for (const k in SPECS) {
  const T = SPECS[k];
  NPC_TYPES[k] = { L: T.L, W: T.W, H: Math.max(...T.g.roof.map((p) => p[1] || 0), T.box ? T.box.y1 : 0) + (T.sign ? 0.3 : 0), wb: T.wh.sR - T.wh.sF, r: T.wh.r };
}
export const TYPE_WEIGHTS = [
  ['sedan', 0.18], ['suv', 0.13], ['crossover', 0.13], ['hatch', 0.1], ['pickup', 0.09], ['ev', 0.07], ['van', 0.05],
  ['luxury', 0.05], ['wagon', 0.04], ['offroad', 0.04], ['taxi', 0.04], ['coupe', 0.03], ['cargo', 0.035], ['truck', 0.015],
];

// ---------------------------------------------------------------- assembling one type
function lowerMat(T) {
  return (nm, s, j) => {
    if (nm === 'under' || nm === 'liner' || nm === 'ceil' || nm === 'wall' || nm === 'bfloor') return 'black';
    if (nm === 'lower') {
      if (T.clad && j <= 2) return 'black';
      if ((s < T.bz[0] || s > T.Le - T.bz[1]) && j < T.val) return 'black';
    }
    return 'paint';
  };
}
function capMat(T) { const lm = lowerMat(T); return (s, j) => (j < 4 ? lm('lower', s, j) : 'paint'); }

// cabin: a dark tub just inside the glass (so the far side of the car is not see-through), dash with
// binnacle and screen, steering wheel, seats with headrests, rear bench, a driver; cheap blobs in dark
// materials, only what shows through the glass
function interior(M, T) {
  const G = T.g, [sF, sR] = T.seats || [G.sW + 0.9, null];
  const yb = (s) => upperYAt(T, s, T.hw(s) - G.inset) - 0.006;
  const s0 = G.sA - 0.12, s1 = Math.min(G.sC + 0.14, T.cab ? T.cab - 0.04 : T.Le - 0.06), mid = (s0 + s1) / 2;
  const yF = T.fl(mid) + 0.14, xw = (s) => T.hw(s) - G.inset - 0.04, Z = (s, y = yb(s)) => T.z(s, 0, y);
  const n = 6, P = [];
  for (let k = 0; k <= n; k++) {
    const s = lerp(s0, s1, k / n), x = xw(s), yt = yb(s) + 0.05;
    P.push([[x, yt], [x, yF], [0, yF]].map(([px, py]) => [px, py, T.z(s, px, py)]));
  }
  grid(M, P, () => 'black', {});
  for (const [s, dir] of [[s0, 1], [s1, -1]]) {
    const x = xw(s), yt = yb(s) + 0.05, z = Z(s, yF);
    quad(M, 'black', [-x, yF, z], [x, yF, z], [x, yt, z], [-x, yt, z], null, [0, 0, dir]);
  }
  if (T.deck && sR) { // parcel shelf behind the rear seat
    const sa = sR + 0.12, x = xw(sa), y = yb(sa) - 0.015;
    quad(M, 'black', [-x, y, Z(sa)], [x, y, Z(sa)], [x, y, Z(s1)], [-x, y, Z(s1)], null, [0, 1, 0]);
  }
  // dash, binnacle, centre screen, steering wheel (driver on the left)
  const sd = G.sA + 0.3, yd = yb(sd);
  blob(M, 'black', [0, yd - 0.1, Z(sd)], [xw(sd) - 0.02, 0.085, 0.25], 3, 8, 4);
  blob(M, 'black', [-0.37, yd - 0.03, Z(sd + 0.2)], [0.15, 0.05, 0.09], 3, 6, 3);
  blob(M, 'misc', [0, yd - 0.02, Z(sd + 0.18)], [0.13, 0.065, 0.012], 5, 4, 2, C.screen);
  {
    const W = new MB(), prof = [];
    for (let k = 0; k <= 6; k++) { const t = (k / 6) * Math.PI * 2; prof.push([0.016 * Math.cos(t), 0.185 + 0.016 * Math.sin(t)]); }
    revolve(W, 'misc', prof, 10, C.handle);
    const sw = G.sA + 0.64, c = [-0.37, yb(sw) - 0.07, Z(sw)], e1 = [0, 0.42, 0.9], e2 = [1, 0, 0], e3 = [0, 0.9, -0.42];
    const tf = (p) => [0, 1, 2].map((k) => p[0] * e1[k] + p[1] * e2[k] + p[2] * e3[k]);
    M.append(W, (p, nn) => { const q2 = tf(p); return [[q2[0] + c[0], q2[1] + c[1], q2[2] + c[2]], tf(nn)]; });
    blob(M, 'black', [c[0] - e1[0] * 0.02, c[1] - e1[1] * 0.02, c[2] - e1[2] * 0.02], [0.07, 0.045, 0.06], 3, 6, 3);
  }
  // seats: cushion, backrest, headrest; the driver's torso and head
  const seat = (x, s, w) => {
    blob(M, 'misc', [x, yF + 0.19, Z(s - 0.28)], [w, 0.09, 0.27], 2.6, 6, 3, C.seat);
    blob(M, 'misc', [x, yb(s) - 0.1, Z(s)], [w - 0.01, 0.3, 0.08], 2.6, 6, 4, C.seat);
    blob(M, 'misc', [x, yb(s) + 0.3, Z(s + 0.01)], [0.11, 0.07, 0.05], 2.6, 6, 3, C.seat);
  };
  seat(-0.37, sF, 0.25); seat(0.37, sF, 0.25);
  blob(M, 'black', [-0.37, yb(sF) + 0.02, Z(sF - 0.1)], [0.22, 0.24, 0.13], 2.6, 6, 3);
  blob(M, 'misc', [-0.37, yb(sF) + 0.3, Z(sF - 0.14)], [0.1, 0.12, 0.1], 2.6, 7, 4, C.skin);
  if (sR) {
    const w = xw(sR) - 0.1;
    blob(M, 'misc', [0, yF + 0.19, Z(sR - 0.28)], [w, 0.09, 0.27], 2.6, 6, 3, C.seat);
    blob(M, 'misc', [0, yb(sR) - 0.12, Z(sR)], [w, 0.28, 0.08], 2.6, 6, 4, C.seat);
    for (const x of [-0.36, 0.36]) blob(M, 'misc', [x, yb(sR) + 0.26, Z(sR + 0.01)], [0.11, 0.07, 0.05], 2.6, 6, 3, C.seat);
  }
}
// chrome / black exhaust tip under the rear bumper: the open end faces +z
function exhaust(M, x, y, z, kind) {
  const E = new MB(), col = kind === 'black' ? C.steel : C.chrome;
  revolve(E, 'misc', [[0, 0.024], [0, 0.034], [-0.14, 0.034], [-0.14, 0.028]], 8, col);
  revolve(E, 'misc', [[0, 0.024], [-0.04, 0]], 8, C.dish);
  M.append(E, (p, n) => [[x + p[1], y + p[2], z + p[0]], [n[1], n[2], n[0]]]);
}

function buildType(name) {
  const T = SPECS[name], L = T.L, G = T.g;
  const M = new MB(), TL = new MB(UV_RED);
  // --- lower body
  const lm = lowerMat(T), cm = capMat(T);
  let bodyRec;
  if (T.bed) {
    bodyRec = loft(M, T, { s0: 0, s1: T.cab, sec: (s) => lowerSec(T, s), mat: lm, capMat: cm, capF: true, capR: true });
    loft(M, T, { s0: T.bed.s0, s1: L, sec: (s) => bedSec(T, s), mat: lm, capMat: cm, capF: true, capR: true });
  } else {
    bodyRec = loft(M, T, { s0: 0, s1: T.Le, sec: (s) => lowerSec(T, s), mat: lm, capMat: cm, capF: true, capR: true });
  }
  const ph = { lower: M.tris() }, nSt = bodyRec.st.length;
  let gRec;
  // --- greenhouse
  {
    const c = [G.sA, G.sW, G.sR, G.sC];
    for (const f of [0.05, 0.18, 0.4, 0.7]) c.push(lerp(G.sA, G.sW, f));
    for (const d of [0.06, 0.18]) c.push(G.sW + d, G.sR - d);
    for (const f of [0.35, 0.7, 0.92]) c.push(lerp(G.sR, G.sC, f));
    const all = [];
    for (const v of c.filter((v) => v >= G.sA && v <= G.sC).sort((a, b) => a - b)) if (!all.length || v - all[all.length - 1] > 0.012) all.push(v);
    const st = [];
    for (let i = 0; i < all.length; i++) { if (i) { const g = all[i] - all[i - 1], n = Math.ceil(g / 0.3 - 1e-9); for (let k = 1; k < n; k++) st.push(all[i - 1] + (g * k) / n); } st.push(all[i]); }
    const P = st.map((s) => greenSec(T, s).map(([x, y]) => [x, y, T.z(s, x, y)]));
    const gm = (i, j) => {
      const s = (st[i] + st[i + 1]) / 2;
      if (j === 0) return G.trim;
      if (j <= 2) return 'glass';
      if (j === 3) return G.frame;
      if (j <= 5) return G.rail;
      return s < G.sW ? 'glass' : s < G.sR ? G.roofM : G.rearM;
    };
    const isGlass = (i, j) => gm(i, j) === 'glass';
    grid(M, P, (i, j) => (isGlass(i, j) ? null : gm(i, j)), { tg: true, col: G.trim === 'chrome' ? C.chrome : undefined });
    // the glass gets its own vertices: tint per pane (windscreen, side, privacy glass behind tintS)
    const tintS = T.tintS ?? Infinity;
    grid(M, P, (i, j) => (isGlass(i, j) ? 'glass' : null), { tg: true, col: (i, j) => (j >= 6 && st[i] < G.sW - 0.01 ? GL.wind : st[i] >= tintS ? GL.tint : j >= 6 && G.roofM === 'glass' && st[i] > G.sW && st[i] < G.sR + 0.01 ? GL.roof : GL.side) });
    // headliner and the inside of the pillars: the same loft, 2 cm inside, facing in (so the roof is
    // not see-through from below and the far pillars read as dark through the near window)
    const Ng = gridNormals(P, false, true);
    const Pi = P.map((row, i) => row.map((p, j) => [p[0] - Ng[i][j][0] * 0.022, p[1] - Ng[i][j][1] * 0.022, p[2] - Ng[i][j][2] * 0.022]));
    grid(M, Pi, (i, j) => (isGlass(i, j) ? null : 'black'), { flip: true });
    gRec = surfRec(st, P);
    ph.green = M.tris() - ph.lower; ph.gst = st.length; ph.st = nSt;
  }
  // --- separate parts that should receive decals
  if (T.box) {
    const B = T.box, S = boxSec(B);
    for (const nm of ['bot', 'c1', 'side', 'c2', 'top']) {
      const P = [B.s0, L].map((s) => S[nm].map(([x, y]) => [x, y, s - L / 2]));
      grid(M, P, () => 'boxw', { tg: true, col: C.box });
    }
    for (const [s, dir] of [[B.s0, -1], [L, 1]]) {
      const sk = S.skin.map(([x, y]) => [x, y, s - L / 2]);
      for (let j = 0; j < sk.length - 1; j++) {
        const a = sk[j], b = sk[j + 1];
        if (Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(a[0]) < 1e-6) continue;
        for (const mx of [1, -1]) quad(M, 'boxw', [0, a[1], a[2]], [a[0] * mx, a[1], a[2]], [b[0] * mx, b[1], b[2]], [0, b[1], b[2]], C.box, [0, 0, dir]);
        const n = [0, 0, dir], i0 = M.v([0, a[1], a[2]], n), i1 = M.v([a[0], a[1], a[2]], n), i2 = M.v([b[0], b[1], b[2]], n), i3 = M.v([0, b[1], b[2]], n);
        M.tg.push([i0, i1, i2], [i0, i2, i3]);
      }
    }
  }
  // --- greenhouse decals: pillars (double-sided: their inside shows through the far window)
  for (const d of T.pil || []) cdecal(M, gRec, [d[0], d[1], 0, 0, 0.003, undefined, undefined, true]);
  // body-coloured D-pillars seen from behind, so the back light is narrower than the roof
  if (G.rp) cdecal(M, gRec, ['paint', q([G.sR - 0.03, 3.9], [G.sC + 0.01, 3.9], [G.sC + 0.01, G.rp], [G.sR - 0.03, G.rp]), 0, 0, 0.003, undefined, undefined, true]);
  if (T.roofSpoiler) {
    const sec = greenSec(T, G.sR), cx = sec[6][0], y = sec[8][1];
    blob(M, 'paint', [0, y - 0.006, G.sR + 0.035 - L / 2], [cx + 0.025, 0.028, 0.11], 4, 8, 4);
  }
  // sunroof (dark glass in a black frame), wipers at the base of the windscreen, high-mounted brake light
  if (T.sunroof) {
    const [a, b] = T.sunroof;
    cdecal(M, gRec, ['black', q([a - 0.03, 6.5], [b + 0.03, 6.5], [b + 0.03, 8], [a - 0.03, 8]), 0, 0, 0.003]);
    cdecal(M, gRec, ['glass', q([a, 6.62], [b, 6.62], [b, 8], [a, 8]), 0, 0, 0.005, GL.roof]);
  }
  if (!T.box) cdecal(M, gRec, ['black', q([G.sA + 0.04, 6.2], [G.sA + 0.075, 6.2], [G.sA + 0.1, 7.85], [G.sA + 0.065, 7.85]), 0, 0, 0.004]);
  else cdecal(M, gRec, ['black', q([G.sA + 0.04, 6.3], [G.sA + 0.08, 6.3], [G.sA + 0.1, 7.9], [G.sA + 0.06, 7.9]), 0, 0, 0.004]);
  if (G.sC - G.sR > 0.3) cdecal(TL, gRec, ['tail', q([G.sR + 0.025, 7.55], [G.sR + 0.055, 7.55], [G.sR + 0.055, 8], [G.sR + 0.025, 8]), 0, 0, 0.004]);
  else if (!T.box) cdecal(TL, gRec, ['tail', q([G.sC - 0.012, 7.6], [G.sC - 0.004, 7.6], [G.sC - 0.004, 8], [G.sC - 0.012, 8]), 0, 0, 0.004]);
  // --- body-side decals: shut lines (doors, bonnet, boot), handles, side repeater, fuel filler
  const seams = T.seams || [];
  for (const s of seams) {
    const uT = skinU(T, s, T.hw(s) - G.inset + 0.004);
    cdecal(M, bodyRec, ['black', q([s - 0.006, 2.3], [s + 0.006, 2.3], [s + 0.006, uT], [s - 0.006, uT]), 0, 0, 0.0025]);
  }
  if (seams.length > 1) cdecal(M, bodyRec, ['black', q([seams[0], 2.26], [seams[seams.length - 1], 2.26], [seams[seams.length - 1], 2.36], [seams[0], 2.36]), 0, 0, 0.0025]);
  if (!T.box) {
    const h0 = T.ef.p + 0.12, h1 = G.sA - 0.05;
    cdecal(M, bodyRec, ['black', q([h0, 6.94], [h1, 6.94], [h1, 7.06], [h0, 7.06]), 0, 0, 0.0025]);
    cdecal(M, bodyRec, ['black', q([h0, 7], [h0 + 0.012, 7], [h0 + 0.012, 9], [h0, 9]), 0, 0, 0.0025]);
  }
  if (T.deck) {
    const d0 = G.sC + 0.05, d1 = T.Le - T.er.p - 0.1;
    cdecal(M, bodyRec, ['black', q([d0, 6.94], [d1, 6.94], [d1, 7.06], [d0, 7.06]), 0, 0, 0.0025]);
    cdecal(M, bodyRec, ['black', q([d1, 7], [d1 + 0.012, 7], [d1 + 0.012, 9], [d1, 9]), 0, 0, 0.0025]);
  }
  for (const s of T.handles || []) {
    if (T.flush) cdecal(M, bodyRec, ['satin', q([s, 4.22], [s + 0.16, 4.22], [s + 0.16, 4.4], [s, 4.4]), 0, 0, 0.004]);
    else {
      const hm = T.handleM || 'handle';
      cdecal(M, bodyRec, ['black', q([s - 0.012, 4.06], [s + 0.172, 4.06], [s + 0.172, 4.56], [s - 0.012, 4.56]), 0, 0, 0.0035]);
      cdecal(M, bodyRec, [hm, q([s + 0.015, 4.16], [s + 0.15, 4.16], [s + 0.15, 4.46], [s + 0.015, 4.46]), 0, 0, 0.0055]);
    }
  }
  {
    const s = T.wh.sF + T.wh.r + T.wh.gap + 0.08;
    cdecal(M, bodyRec, ['amber', q([s, 3.74], [s + 0.09, 3.74], [s + 0.09, 3.96], [s, 3.96]), 0, 0, 0.003]);
    const fs = T.wh.sR - T.wh.r - T.wh.gap - 0.22, fu = 4.9, oct = (r, ru) => [0, 1, 2, 3, 4, 5, 6, 7].map((k) => { const a = (k / 8) * Math.PI * 2 + Math.PI / 8; return [fs + r * Math.cos(a), fu + ru * Math.sin(a)]; });
    if (!T.box && !T.bed) {
      cdecal(M, bodyRec, ['black', { q: oct(0.085, 0.3), mir: false }, 0, 0, 0.003]);
      cdecal(M, bodyRec, ['paint', { q: oct(0.072, 0.25), mir: false }, 0, 0, 0.0045]);
    }
  }
  if (T.slider) cdecal(M, bodyRec, ['black', q([T.slider[0], 4.55], [T.slider[1], 4.55], [T.slider[1], 4.72], [T.slider[0], 4.72]), 0, 0, 0.003]);
  if (T.stripe) cdecal(M, bodyRec, ['black', q([1.5, 3.55], [3.9, 3.55], [3.9, 3.73], [1.5, 3.73]), 0, 0, 0.0025]);
  for (const [m, s0, s1, u0, u1] of T.strips || []) cdecal(M, bodyRec, [m, q([s0, u0], [s1, u0], [s1, u1], [s0, u1]), 0, 0, 0.003]);
  // --- wheel-arch flares
  if (T.flare) {
    for (const a of T.axles) {
      const yc = T.wh.r, flY = T.fl(a.s - a.R) + 0.01, pm = Math.min(Math.acos(clamp((flY - yc) / a.R, -1, 1)), 1.9), hw = T.hw(a.s);
      const prof = [[a.R - 0.004, hw - 0.03], [a.R + T.flare * 0.5, hw + 0.024], [a.R + T.flare + 0.015, hw - 0.02]];
      const P = [];
      for (let k = 0; k <= 10; k++) {
        const ph = -pm + (k / 10) * 2 * pm;
        P.push(prof.map(([r, x]) => { const y = yc + r * Math.cos(ph), s = a.s + r * Math.sin(ph); return [x, y, T.z(s, x, y)]; }));
      }
      grid(M, P, () => 'black', {});
    }
  }
  // --- front / rear / side decals (ray projected)
  for (const d of T.front || []) rdecal(M, T, d, 'front');
  for (const d of T.rear || []) rdecal(M, T, d, 'rear', d[0] === 'tail' ? TL : M);
  for (const d of T.frontC || []) rdecal(M, T, d, 'cornerF');
  for (const d of T.rearC || []) rdecal(M, T, d, 'cornerR', d[0] === 'tail' ? TL : M);
  ph.decals = M.tris() - ph.lower - ph.green;
  // --- mirrors (housing, stalk, mirror glass on the back)
  {
    const s = G.sA + G.mirS, bw = T.hw(s) - G.inset, yb = upperYAt(T, s, bw), z = T.z(s, bw, yb);
    if (T.bigMirror) {
      blob(M, 'black', [bw + 0.13, yb + 0.02, z], [0.13, 0.018, 0.018], 4, 6, 4);
      blob(M, 'black', [bw + 0.25, yb + 0.16, z + 0.02], [0.045, 0.17, 0.05], 4, 8, 6);
      for (const sx of [1, -1]) rect(M, 'misc', [sx * (bw + 0.25), yb + 0.16, z + 0.071], [0.03, 0, 0], [0, 0.14, 0], null, C.mirror, [0, 0, 1]);
    } else {
      blob(M, 'paint', [bw + 0.115, yb + 0.085, z + 0.02], [0.1, 0.058, 0.045], 3, 7, 4);
      blob(M, 'black', [bw + 0.03, yb + 0.05, z + 0.03], [0.04, 0.02, 0.04], 4, 4, 2);
      for (const sx of [1, -1]) rect(M, 'misc', [sx * (bw + 0.115), yb + 0.085, z + 0.064], [0.084, 0, 0], [0, 0.048, 0], null, C.bezel, [0, 0, 1]);
      for (const sx of [1, -1]) rect(M, 'misc', [sx * (bw + 0.115), yb + 0.085, z + 0.067], [0.075, 0, 0], [0, 0.04, 0], null, C.mirror, [0, 0, 1]);
    }
  }
  // --- extras
  const roofY = (x, s) => { const h = rayHit(M, 'top', x, s - L / 2); return h ? h.p[1] : G.roofF(s); };
  if (T.rails) {
    const xr = T.hw((G.sW + G.sR) / 2) - G.inset - G.lean * 0.4 - G.rc - 0.1, s0 = G.sW + 0.12, s1 = G.sR - 0.04, P = [];
    for (let k = 0; k <= 10; k++) {
      const s = lerp(s0, s1, k / 10), y = roofY(xr, s) + lerp(0.012, 0.05, Math.min(1, Math.sin((k / 10) * Math.PI) * 4)), z = s - L / 2, w = 0.016;
      P.push([[xr - w, y - w, z], [xr + w, y - w, z], [xr + w, y + w, z], [xr - w, y + w, z], [xr - w, y - w, z]]);
    }
    grid(M, P, () => T.rails, { col: MCOL[T.rails] });
  }
  if (T.sign) {
    const s = (G.sW + G.sR) / 2, y = roofY(0, s);
    box(M, 'black', [0, y + 0.02, s - L / 2], [0.3, 0.025, 0.14]);
    blob(M, 'head', [0, y + 0.115, s - L / 2], [0.36, 0.075, 0.13], 5, 8, 4);
  }
  if (T.fin) { // shark-fin aerial at the back of the roof
    const s = (T.bed ? G.sR : G.sR - 0.12) - 0.09, y = roofY(0, s);
    blob(M, 'black', [0, y + 0.004, s - L / 2 + 0.04], [0.024, 0.036, 0.1], 2.4, 6, 3);
  }
  if (T.mast) { // whip aerial at the front corner of the roof
    const s = G.sA + 0.3, y = roofY(0.55, s);
    box(M, 'black', [0.55, y + 0.2, s - L / 2], [0.006, 0.22, 0.006]);
    box(M, 'black', [0.55, y + 0.01, s - L / 2], [0.02, 0.012, 0.02]);
  }
  if (T.spoiler) {
    const s = T.Le - 0.14, y = T.top(s);
    blob(M, 'paint', [0, y + 0.012, s - L / 2], [0.66, 0.022, 0.1], 4, 8, 4);
  }
  if (T.bumpers) {
    box(M, 'black', [0, 0.6, -L / 2 + 0.08], [0.93, 0.1, 0.08]);
    box(M, 'black', [0, 0.58, T.Le - L / 2 - 0.02], [0.9, 0.09, 0.07]);
    box(M, 'grey', [0, 0.56, -L / 2 + 0.002], [0.12, 0.05, 0.004]);
  }
  for (const [x, kind, ye] of T.exh || []) exhaust(M, x, ye ?? T.fl(T.Le) - 0.065, T.Le - L / 2 - 0.005 - (T.bumpers ? 0.06 : 0), kind);
  if (T.flaps) for (const a of T.axles) {
    if (a.front && !T.box) continue;
    const yF = T.fl(a.s + a.R + 0.03);
    for (const sx of [1, -1]) box(M, 'black', [sx * (a.front ? T.wx : T.wxR), yF - 0.12, a.s + a.R + 0.02 - L / 2], [T.wh.w / 2 + 0.03, 0.15, 0.006]);
  }
  if (T.bed) {
    const yt = T.top(L - 0.1), yf = T.bed.floor, xin = T.hw(L - 0.3) - 0.085, zb = T.bed.s0 - L / 2, zt = L / 2;
    quad(M, 'black', [-xin, yf, zb + 0.06], [xin, yf, zb + 0.06], [xin, yt, zb + 0.06], [-xin, yt, zb + 0.06], null, [0, 0, 1]);
    quad(M, 'paint', [-xin, yt, zb], [xin, yt, zb], [xin, yt, zb + 0.06], [-xin, yt, zb + 0.06], null, [0, 1, 0]);
    quad(M, 'black', [-xin, yf, zt - 0.06], [xin, yf, zt - 0.06], [xin, yt, zt - 0.06], [-xin, yt, zt - 0.06], null, [0, 0, -1]);
    quad(M, 'paint', [-xin, yt, zt - 0.06], [xin, yt, zt - 0.06], [xin, yt, zt], [-xin, yt, zt], null, [0, 1, 0]);
    box(M, T.rearBumper || 'black', [0, 0.56, L / 2 - 0.02], [0.96, 0.08, 0.06]);
    box(M, 'black', [0, 0.47, L / 2 + 0.01], [0.04, 0.03, 0.05]);
    rect(M, 'plate', [0, 0.56, L / 2 + 0.041], [0.153, 0, 0], [0, 0.075, 0], 'plateA', C.plate, [0, 0, 1]);
  }
  interior(M, T);
  if (T.box) {
    const B = T.box, zr = L / 2;
    // chassis, fuel tank, rear bumper with lamps, mud flaps
    for (const sx of [-1, 1]) {
      box(M, 'black', [sx * 0.43, 0.72, (B.s0 + L) / 2 - L / 2 - 0.1], [0.05, 0.12, (L - B.s0) / 2]);
      box(M, 'black', [sx * 0.98, 0.32, T.wh.sR + 0.62 - L / 2], [0.12, 0.2, 0.01]);
      box(TL, 'tail', [sx * 0.9, 0.62, zr + 0.002], [0.08, 0.035, 0.012]);
      box(M, 'amber', [sx * 1.08, 3.05, zr + 0.004], [0.04, 0.025, 0.01]);
      box(M, 'amber', [sx * (B.hw + 0.004), 1.15, (B.s0 + 0.2) - L / 2], [0.008, 0.025, 0.04]);
    }
    box(M, 'chrome', [0.72, 0.62, 2.85 - L / 2], [0.16, 0.16, 0.38]);
    box(M, 'black', [0, 0.6, zr - 0.04], [1.08, 0.08, 0.04]);
    box(M, 'black', [0, 0.98, 2.4 - L / 2], [0.5, 0.12, 0.08]);
    // roll-up door
    rdecal(M, T, ['grey', q([0.98, 1.12], [1.06, 1.12], [1.06, 3.04], [0.98, 3.04]), 1, 2, 0.006], 'rear');
    rdecal(M, T, ['grey', q([0, 2.98], [1.0, 2.98], [1.0, 3.04], [0, 3.04]), 2, 1, 0.006], 'rear');
    for (let y = 1.32; y < 2.95; y += 0.27) rdecal(M, T, ['grey', q([0, y], [0.98, y], [0.98, y + 0.012], [0, y + 0.012]), 2, 1, 0.005], 'rear');
    rdecal(M, T, ['grey', q([0, 1.13], [0.12, 1.13], [0.12, 1.2], [0, 1.2]), 1, 1, 0.008], 'rear');
    rect(M, 'plate', [0, 0.6, zr + 0.001], [0.153, 0, 0], [0, 0.075, 0], 'plateB', C.plate, [0, 0, 1]);
  }
  // --- wheels
  const wR = wheelMB(T, false), wL = mirrorMB(wR);
  const wRr = T.wh.dual ? wheelMB(T, true) : wR, wLr = T.wh.dual ? mirrorMB(wRr) : wL;
  const wpos = [];
  for (const a of T.axles) for (const sx of [1, -1]) {
    const x = sx * (a.front ? T.wx : T.wxR);
    wpos.push({ x, y: T.wh.r, z: a.s - L / 2, front: a.front, mb: sx > 0 ? (a.front ? wR : wRr) : (a.front ? wL : wLr) });
  }
  if (T.spare) {
    const zs = T.Le - L / 2 + 0.145, ys = 0.86;
    M.append(wR, (p, n) => [[-p[2], p[1] + ys, p[0] + zs], [-n[2], n[1], n[0]]]);
    box(M, 'black', [0, ys, zs - 0.1], [0.06, 0.06, 0.04]);
  }
  const order = ['paint', 'glass', 'black', 'misc', 'head'];
  const MW = M.clone();
  for (const w of wpos) MW.append(w.mb, (p, n) => [[p[0] + w.x, p[1] + w.y, p[2] + w.z], n]);
  const body = M.geo(order), bodyW = MW.geo(order), tail = TL.geo(['tail']);
  const geoW = new Map();
  for (const w of wpos) if (!geoW.has(w.mb)) geoW.set(w.mb, w.mb.geo(['misc']));
  const H = Math.max(bodyW.boundingBox.max.y, 0);
  NPC_TYPES[name].H = H;
  return {
    body, bodyW, tail, L, W: T.W, H, wb: T.wh.sR - T.wh.sF, r: T.wh.r,
    wheels: wpos.map((w) => ({ x: w.x, y: w.y, z: w.z, front: w.front, geo: geoW.get(w.mb) })),
    tris: { body: M.tris(), parked: MW.tris(), tail: TL.tris(), wheel: wR.tris(), ...ph },
  };
}

const geoCache = new Map();
function getType(name) {
  let g = geoCache.get(name);
  if (!g) { g = buildType(name); geoCache.set(name, g); }
  return g;
}

export function makeNPCCar(name, color, opts = {}) {
  if (!SPECS[name]) name = 'sedan';
  const G = getType(name), T = SPECS[name];
  const col = T.paint ?? color;
  const mats = [paint(col), npcMats.glass, npcMats.black, npcMats.misc, npcMats.head];
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(opts.animated ? G.body : G.bodyW, mats);
  mesh.castShadow = true; mesh.receiveShadow = true;
  const tail = new THREE.Mesh(G.tail, npcMats.tail);
  group.add(mesh, tail);
  const out = { group, tail, L: G.L, W: G.W, H: G.H, type: name, color: col, wb: G.wb };
  if (opts.animated) {
    out.wheels = G.wheels.map((w) => {
      const pivot = new THREE.Group(); pivot.position.set(w.x, w.y, w.z);
      const spin = new THREE.Mesh(w.geo, npcMats.misc);
      spin.castShadow = true; spin.receiveShadow = true;
      pivot.add(spin); group.add(pivot);
      return { pivot, spin, front: w.front, r: G.r };
    });
  }
  return out;
}

export function pickType(r) {
  let a = 0;
  for (const [n, w] of TYPE_WEIGHTS) { a += w; if (r < a) return n; }
  return 'sedan';
}

export function setNPCNight(n) {
  npcMats.head.emissiveIntensity = 0.2 + n * 3.0;
  npcMats.tail.emissiveIntensity = 0.3 + n * 1.2;
}

// build statistics for test pages
export function npcTypeStats(name) { return getType(name).tris; }
