// Procedural textures drawn on canvases: asphalt with baked lane markings, concrete,
// grass, building facades (colour + roughness/metalness + lit-window emissive), signs.
import * as THREE from 'three';
import { rng } from './config.js';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function toTex(c, { repeat = true, srgb = true, flipY = false, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.flipY = flipY;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

// Tileable fractal value noise in [0,1]
export function fbm(w, h, { oct = 5, cells = 4, seed = 1, gain = 0.5 } = {}) {
  const r = rng(seed);
  const out = new Float32Array(w * h);
  let amp = 1, total = 0;
  for (let o = 0; o < oct; o++) {
    const c = cells << o;
    const g = new Float32Array(c * c);
    for (let i = 0; i < g.length; i++) g[i] = r();
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * c, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
      const ya = (y0 % c) * c, yb = ((y0 + 1) % c) * c;
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * c, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
        const xa = x0 % c, xb = (x0 + 1) % c;
        const v = (g[ya + xa] * (1 - sx) + g[ya + xb] * sx) * (1 - sy) + (g[yb + xa] * (1 - sx) + g[yb + xb] * sx) * sy;
        out[y * w + x] += v * amp;
      }
    }
    total += amp; amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

export function normalFromHeight(hm, w, h, strength = 2) {
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = hm[y * w + ((x - 1 + w) % w)], r = hm[y * w + ((x + 1) % w)];
    const u = hm[((y - 1 + h) % h) * w + x], b = hm[((y + 1) % h) * w + x];
    let nx = (l - r) * strength, ny = (u - b) * strength, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const i = (y * w + x) * 4;
    d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Asphalt: large-scale tone variation, fine grain and light aggregate stones.
function asphaltPixels(w, h, seed, base = [58, 59, 62]) {
  const big = fbm(w, h, { oct: 4, cells: 3, seed });
  const fine = fbm(w, h, { oct: 2, cells: 64, seed: seed + 7 });
  const r = rng(seed + 3);
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data;
  const hm = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    let v = (big[i] - 0.5) * 22 + (fine[i] - 0.5) * 26 + (r() - 0.5) * 16;
    let hh = fine[i] * 0.6 + r() * 0.4;
    if (r() < 0.018) { v += 30 + r() * 30; hh += 0.6; }
    else if (r() < 0.01) { v -= 18; hh -= 0.3; }
    d[i * 4] = base[0] + v; d[i * 4 + 1] = base[1] + v; d[i * 4 + 2] = base[2] + v * 1.02; d[i * 4 + 3] = 255;
    hm[i] = hh;
  }
  ctx.putImageData(img, 0, 0);
  return { c, ctx, hm };
}

// Paint with wear: draw on a separate canvas then erode alpha with noise.
function wornPaint(w, h, seed, draw) {
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  draw(ctx);
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  const n = fbm(w, h, { oct: 3, cells: 16, seed });
  const r = rng(seed + 11);
  for (let i = 0; i < w * h; i++) {
    if (!d[i * 4 + 3]) continue;
    let a = 0.78 + n[i] * 0.3;
    if (n[i] < 0.3 || r() < 0.05) a *= 0.45;
    d[i * 4 + 3] *= Math.min(1, a);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function tireWear(ctx, w, h, mPerPx, offsets) {
  for (const off of offsets) {
    for (const t of [-0.85, 0.85]) {
      const x = (off + t + 7.6) / mPerPx;
      const g = ctx.createLinearGradient(x - 0.4 / mPerPx, 0, x + 0.4 / mPerPx, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(10,10,12,0.13)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(x - 0.4 / mPerPx, 0, 0.8 / mPerPx, h);
    }
    const x = (off + 7.6) / mPerPx;
    const g = ctx.createLinearGradient(x - 0.35 / mPerPx, 0, x + 0.35 / mPerPx, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(20,18,14,0.09)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x - 0.35 / mPerPx, 0, 0.7 / mPerPx, h);
  }
}

const YELLOW = '#d8b23a', WHITE = '#e9e9e4';

// Mid-block road: 15.2 m across (u), 12 m along (v), repeating.
export function roadMidTextures() {
  const W = 512, H = 512, mx = 15.2 / W, my = 12 / H;
  const { c, ctx, hm } = asphaltPixels(W, H, 21);
  tireWear(ctx, W, H, mx, [-5.4, -1.8, 1.8, 5.4]);
  const X = (m) => (m + 7.6) / mx;
  const paint = wornPaint(W, H, 33, (p) => {
    p.fillStyle = YELLOW;
    p.fillRect(X(-0.22), 0, 0.12 / mx, H);
    p.fillRect(X(0.10), 0, 0.12 / mx, H);
    p.fillStyle = WHITE;
    for (const s of [-1, 1]) {
      p.fillRect(X(s * 3.6 - 0.06), 0, 0.12 / mx, 3 / my);
      p.fillRect(X(s * 7.2 - 0.075), 0, 0.15 / mx, H);
    }
  });
  ctx.drawImage(paint, 0, 0);
  const pd = paint.getContext('2d').getImageData(0, 0, W, H).data;
  for (let i = 0; i < W * H; i++) hm[i] += pd[i * 4 + 3] / 255 * 0.5;
  return { map: toTex(c), normalMap: toTex(normalFromHeight(hm, W, H, 3), { srgb: false }) };
}

// Road end zone at each intersection: 15.2 m across, 4.2 m along. v=0 at the intersection box edge.
// Continental crosswalk + stop line on the incoming (w>0) half.
export function roadEndTextures() {
  const W = 512, H = 144, mx = 15.2 / W, my = 4.2 / H;
  const { c, ctx, hm } = asphaltPixels(W, H, 41);
  tireWear(ctx, W, H, mx, [-5.4, -1.8, 1.8, 5.4]);
  const X = (m) => (m + 7.6) / mx, Y = (m) => m / my;
  const paint = wornPaint(W, H, 55, (p) => {
    p.fillStyle = WHITE;
    for (let w = -6.9; w < 7.0; w += 1.2) p.fillRect(X(w), Y(0.3), 0.6 / mx, 3.0 / my);
    p.fillRect(X(0.1), Y(3.55), 7.1 / mx, 0.42 / my);
    p.fillStyle = YELLOW;
    p.fillRect(X(-0.22), Y(3.3), 0.12 / mx, H - Y(3.3));
    p.fillRect(X(0.10), Y(3.3), 0.12 / mx, H - Y(3.3));
  });
  ctx.drawImage(paint, 0, 0);
  const pd = paint.getContext('2d').getImageData(0, 0, W, H).data;
  for (let i = 0; i < W * H; i++) hm[i] += pd[i * 4 + 3] / 255 * 0.5;
  return { map: toTex(c), normalMap: toTex(normalFromHeight(hm, W, H, 3), { srgb: false }) };
}

// Residential street (9.2 m kerb to kerb, one lane each way, unmarked): worn wheel paths only.
export function localMidTextures() {
  const W = 320, H = 512, mx = 9.2 / W;
  const { c, ctx, hm } = asphaltPixels(W, H, 23, [62, 62, 64]);
  const g = (off) => { for (const t of [-0.85, 0.85]) { const x = (off + t + 4.6) / mx; const gr = ctx.createLinearGradient(x - 14, 0, x + 14, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(12,12,14,0.11)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gr; ctx.fillRect(x - 14, 0, 28, H); } };
  g(-2); g(2);
  return { map: toTex(c), normalMap: toTex(normalFromHeight(hm, W, H, 3), { srgb: false }) };
}
// Residential approach to a stop sign: 9.2 m across, 4.2 m along, a white stop bar on the incoming half.
export function localEndTextures() {
  const W = 320, H = 144, mx = 9.2 / W, my = 4.2 / H;
  const { c, ctx, hm } = asphaltPixels(W, H, 43, [62, 62, 64]);
  const X = (m) => (m + 4.6) / mx, Y = (m) => m / my;
  const paint = wornPaint(W, H, 57, (p) => { p.fillStyle = WHITE; p.fillRect(X(0.15), Y(3.5), 4.2 / mx, 0.45 / my); });
  ctx.drawImage(paint, 0, 0);
  const pd = paint.getContext('2d').getImageData(0, 0, W, H).data;
  for (let i = 0; i < W * H; i++) hm[i] += pd[i * 4 + 3] / 255 * 0.5;
  return { map: toTex(c), normalMap: toTex(normalFromHeight(hm, W, H, 3), { srgb: false }) };
}

// Freeway carriageway: 15.6 m across (2 m median apron, three 3.7 m lanes, 2.5 m shoulder), 12 m along.
export function freewayTextures() {
  const W = 512, H = 400, mx = 15.6 / W, my = 12 / H;
  const { c, ctx, hm } = asphaltPixels(W, H, 91, [56, 57, 60]);
  const X = (m) => (m + 2) / mx;
  for (const off of [1.85, 5.55, 9.25]) for (const t of [-0.85, 0.85]) {
    const x = X(off + t), g = ctx.createLinearGradient(x - 0.4 / mx, 0, x + 0.4 / mx, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(10,10,12,0.14)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x - 0.4 / mx, 0, 0.8 / mx, H);
  }
  const paint = wornPaint(W, H, 93, (p) => {
    p.fillStyle = YELLOW; p.fillRect(X(0.12), 0, 0.14 / mx, H);
    p.fillStyle = WHITE;
    for (const w of [3.7, 7.4]) p.fillRect(X(w - 0.07), 0, 0.14 / mx, 3 / my);
    p.fillRect(X(11.1), 0, 0.16 / mx, H);
  });
  ctx.drawImage(paint, 0, 0);
  const pd = paint.getContext('2d').getImageData(0, 0, W, H).data;
  for (let i = 0; i < W * H; i++) hm[i] += pd[i * 4 + 3] / 255 * 0.5;
  return { map: toTex(c), normalMap: toTex(normalFromHeight(hm, W, H, 3), { srgb: false }) };
}
// Ramp: one 3.7 m lane with solid edge lines, 4.8 m across, 12 m along.
export function rampTextures() {
  const W = 160, H = 400, mx = 4.8 / W, my = 12 / H;
  const { c, ctx, hm } = asphaltPixels(W, H, 95, [57, 58, 61]);
  const X = (m) => m / mx;
  const paint = wornPaint(W, H, 97, (p) => { p.fillStyle = WHITE; p.fillRect(X(0.5), 0, 0.14 / mx, H); p.fillRect(X(4.16), 0, 0.14 / mx, H); });
  ctx.drawImage(paint, 0, 0);
  const pd = paint.getContext('2d').getImageData(0, 0, W, H).data;
  for (let i = 0; i < W * H; i++) hm[i] += pd[i * 4 + 3] / 255 * 0.5;
  void my;
  return { map: toTex(c), normalMap: toTex(normalFromHeight(hm, W, H, 3), { srgb: false }) };
}

export function asphaltTextures(seed = 61, base) {
  const { c, hm } = asphaltPixels(512, 512, seed, base);
  return { map: toTex(c), normalMap: toTex(normalFromHeight(hm, 512, 512, 3), { srgb: false }) };
}

export function concreteTextures() {
  const W = 512, n = fbm(W, W, { oct: 5, cells: 4, seed: 71 }), r = rng(72);
  const c = makeCanvas(W, W), ctx = c.getContext('2d');
  const img = ctx.createImageData(W, W), d = img.data, hm = new Float32Array(W * W);
  for (let i = 0; i < W * W; i++) {
    const v = 168 + (n[i] - 0.5) * 30 + (r() - 0.5) * 14;
    d[i * 4] = v; d[i * 4 + 1] = v - 2; d[i * 4 + 2] = v - 6; d[i * 4 + 3] = 255;
    hm[i] = n[i] * 0.3 + r() * 0.15;
  }
  ctx.putImageData(img, 0, 0);
  // 3 m tile with joints every 1.5 m
  ctx.fillStyle = 'rgba(60,58,55,0.55)';
  for (let k = 0; k < 2; k++) {
    ctx.fillRect(k * W / 2, 0, 3, W);
    ctx.fillRect(0, k * W / 2, W, 3);
    for (let y = 0; y < W; y++) { hm[y * W + k * W / 2] = -0.5; hm[(k * W / 2) * W + y] = -0.5; }
  }
  return { map: toTex(c), normalMap: toTex(normalFromHeight(hm, W, W, 2), { srgb: false }) };
}

export function grassTextures() {
  const W = 512, n = fbm(W, W, { oct: 5, cells: 4, seed: 81 }), f = fbm(W, W, { oct: 2, cells: 96, seed: 82 }), r = rng(83);
  const c = makeCanvas(W, W), ctx = c.getContext('2d');
  const img = ctx.createImageData(W, W), d = img.data, hm = new Float32Array(W * W);
  for (let i = 0; i < W * W; i++) {
    const v = (n[i] - 0.5) * 40 + (f[i] - 0.5) * 40 + (r() - 0.5) * 22;
    d[i * 4] = 62 + v * 0.6; d[i * 4 + 1] = 98 + v; d[i * 4 + 2] = 44 + v * 0.4; d[i * 4 + 3] = 255;
    hm[i] = f[i] * 0.7 + r() * 0.3;
  }
  ctx.putImageData(img, 0, 0);
  return { map: toTex(c), normalMap: toTex(normalFromHeight(hm, W, W, 2), { srgb: false }) };
}

// Building facades. Each returns colour map, roughness(G)/metalness(B) map and emissive (lit windows).
export function facadeTextures(kind, seed) {
  const W = 512, r = rng(seed);
  const cols = { glass: 8, office: 6, brick: 6, dark: 8 }[kind];
  const rows = { glass: 8, office: 8, brick: 6, dark: 8 }[kind];
  const cw = W / cols, rh = W / rows;
  const map = makeCanvas(W, W), m = map.getContext('2d');
  const rmC = makeCanvas(W, W), rm = rmC.getContext('2d');
  const em = makeCanvas(W, W), e = em.getContext('2d');
  e.fillStyle = '#000'; e.fillRect(0, 0, W, W);
  const n = fbm(W, W, { oct: 4, cells: 4, seed: seed + 1 });
  const wall = { glass: [70, 84, 96], office: [196, 190, 178], brick: [132, 70, 54], dark: [48, 50, 54] }[kind];
  const img = m.createImageData(W, W), d = img.data;
  for (let i = 0; i < W * W; i++) {
    const v = (n[i] - 0.5) * 26 + (r() - 0.5) * 10;
    d[i * 4] = wall[0] + v; d[i * 4 + 1] = wall[1] + v; d[i * 4 + 2] = wall[2] + v; d[i * 4 + 3] = 255;
  }
  m.putImageData(img, 0, 0);
  rm.fillStyle = 'rgb(0,220,0)'; rm.fillRect(0, 0, W, W); // rough, non metal walls
  if (kind === 'brick') {
    m.fillStyle = 'rgba(205,195,180,0.35)';
    for (let y = 0; y < W; y += 6) {
      m.fillRect(0, y, W, 1);
      for (let x = (y / 6) % 2 ? 0 : 7; x < W; x += 14) m.fillRect(x, y, 1, 6);
    }
  }
  const warm = ['#ffd49a', '#ffe2b0', '#fff1d0', '#cfe6ff', '#ffc77a'];
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    let x0, y0, ww, hh;
    if (kind === 'glass') { x0 = cx * cw + 2; y0 = cy * rh + rh * 0.2; ww = cw - 4; hh = rh * 0.8 - 2; }
    else if (kind === 'office') { x0 = cx * cw + cw * 0.06; y0 = cy * rh + rh * 0.3; ww = cw * 0.88; hh = rh * 0.52; }
    else if (kind === 'brick') { x0 = cx * cw + cw * 0.28; y0 = cy * rh + rh * 0.22; ww = cw * 0.44; hh = rh * 0.58; }
    else { x0 = cx * cw + cw * 0.12; y0 = cy * rh + rh * 0.1; ww = cw * 0.76; hh = rh * 0.8; }
    const tint = 0.85 + r() * 0.3;
    const g = m.createLinearGradient(0, y0, 0, y0 + hh);
    const base = kind === 'glass' ? [92, 126, 150] : kind === 'dark' ? [40, 56, 70] : [52, 66, 80];
    g.addColorStop(0, `rgb(${base[0] * tint + 30},${base[1] * tint + 30},${base[2] * tint + 30})`);
    g.addColorStop(1, `rgb(${base[0] * tint},${base[1] * tint},${base[2] * tint})`);
    m.fillStyle = g; m.fillRect(x0, y0, ww, hh);
    if (kind === 'brick' || kind === 'office') { m.strokeStyle = kind === 'brick' ? '#e8e2d6' : '#8a8f94'; m.lineWidth = 3; m.strokeRect(x0, y0, ww, hh); }
    if (kind === 'glass' || kind === 'dark') { m.fillStyle = 'rgba(200,205,210,0.6)'; m.fillRect(x0 + ww / 2 - 1, y0, 2, hh); }
    rm.fillStyle = `rgb(0,${10 + r() * 20},${kind === 'office' || kind === 'brick' ? 140 : 235})`;
    rm.fillRect(x0, y0, ww, hh);
    if (r() < (kind === 'office' ? 0.45 : 0.32)) {
      e.fillStyle = warm[Math.floor(r() * warm.length)];
      e.globalAlpha = 0.45 + r() * 0.55;
      e.fillRect(x0 + 1, y0 + 1, ww - 2, hh - 2);
      e.globalAlpha = 1;
    }
  }
  if (kind === 'glass') { // spandrel floor lines
    m.fillStyle = 'rgba(30,36,42,0.85)';
    for (let cy = 0; cy < rows; cy++) m.fillRect(0, cy * rh, W, rh * 0.2);
  }
  return { map: toTex(map, { flipY: true }), rm: toTex(rmC, { srgb: false, flipY: true }), emissive: toTex(em, { flipY: true }) };
}

export function sidingTextures() {
  // 5 m wide x 3 m tall tile: lap siding with one window, white trim.
  const W = 256, H = 160, c = makeCanvas(W, H), x = c.getContext('2d');
  x.fillStyle = '#f2f0ea'; x.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 6) { x.fillStyle = 'rgba(0,0,0,0.08)'; x.fillRect(0, y, W, 1.5); }
  x.fillStyle = '#fafafa'; x.fillRect(88, 40, 80, 70);
  x.fillStyle = '#4c5a66'; x.fillRect(94, 46, 68, 58);
  x.fillStyle = '#fafafa'; x.fillRect(126, 46, 4, 58); x.fillRect(94, 73, 68, 3);
  const e = makeCanvas(W, H), ex = e.getContext('2d');
  ex.fillStyle = '#000'; ex.fillRect(0, 0, W, H);
  ex.fillStyle = '#ffcf8a'; ex.fillRect(94, 46, 68, 58);
  return { map: toTex(c), emissive: toTex(e) };
}

export function shingleTexture() {
  const W = 256, c = makeCanvas(W, W), x = c.getContext('2d'), r = rng(91);
  x.fillStyle = '#555'; x.fillRect(0, 0, W, W);
  for (let y = 0; y < W; y += 16) for (let k = 0; k < W; k += 20) {
    const v = 70 + r() * 40;
    x.fillStyle = `rgb(${v},${v - 4},${v - 8})`;
    x.fillRect(k + ((y / 16) % 2) * 10, y, 19, 15);
  }
  return toTex(c);
}

export function arrowTexture(type, only) {
  // Arrow pointing to canvas top (flipY true => forward). 1.2 m x 3.2 m decal.
  const W = 128, H = 340, c = makeCanvas(W, H), x = c.getContext('2d');
  x.fillStyle = WHITE; x.strokeStyle = WHITE; x.lineCap = 'butt'; x.lineJoin = 'miter';
  const cx = W / 2, top = only ? 40 : 20;
  const shaft = (x0, y0, x1, y1) => { x.lineWidth = 16; x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke(); };
  const head = (tx, ty, ang) => {
    x.save(); x.translate(tx, ty); x.rotate(ang);
    x.beginPath(); x.moveTo(0, -34); x.lineTo(24, 4); x.lineTo(-24, 4); x.closePath(); x.fill(); x.restore();
  };
  const base = H - 20;
  if (type.includes('S')) { shaft(cx, base, cx, top + 34); head(cx, top + 34, 0); }
  if (type.includes('L')) {
    shaft(cx, base, cx, 150); x.lineWidth = 16; x.beginPath(); x.moveTo(cx, 158); x.quadraticCurveTo(cx, 110, cx - 26, 110); x.stroke(); head(cx - 26, 110, -Math.PI / 2);
  }
  if (type.includes('R')) {
    shaft(cx, base, cx, 150); x.lineWidth = 16; x.beginPath(); x.moveTo(cx, 158); x.quadraticCurveTo(cx, 110, cx + 26, 110); x.stroke(); head(cx + 26, 110, Math.PI / 2);
  }
  if (only) { x.font = 'bold 30px Arial'; x.textAlign = 'center'; x.fillText('ONLY', cx, 32); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function radialTexture(inner = 'rgba(255,255,255,1)', size = 128) {
  const c = makeCanvas(size, size), x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner); g.addColorStop(0.5, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function stopSignTexture() {
  const W = 256, c = makeCanvas(W, W), x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, W);
  x.fillStyle = '#c8102e'; x.fillRect(10, 10, W - 20, W - 20);
  x.fillStyle = '#fff'; x.font = 'bold 76px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('STOP', W / 2, W / 2 + 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function signTexture(text, sub, bg = '#1d1f22', fg = '#ffffff') {
  const W = 1024, H = 200, c = makeCanvas(W, H), x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '600 84px Inter, Arial, sans-serif';
  x.fillText(text, W / 2, sub ? 80 : H / 2);
  if (sub) { x.font = '400 40px Inter, Arial, sans-serif'; x.globalAlpha = 0.75; x.fillText(sub, W / 2, 156); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// Neutral (grey ~0.5) detail used to break up the vertex-coloured terrain up close and far away.
export function detailTextures() {
  const W = 512, n = fbm(W, W, { oct: 5, cells: 4, seed: 131 }), f = fbm(W, W, { oct: 2, cells: 80, seed: 132 }), r = rng(133);
  const c = makeCanvas(W, W), ctx = c.getContext('2d'), img = ctx.createImageData(W, W), d = img.data, hm = new Float32Array(W * W);
  for (let i = 0; i < W * W; i++) {
    const v = 128 + (n[i] - 0.5) * 60 + (f[i] - 0.5) * 50 + (r() - 0.5) * 24;
    d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    hm[i] = n[i] * 0.5 + f[i] * 0.5 + r() * 0.15;
  }
  ctx.putImageData(img, 0, 0);
  return { map: toTex(c, { srgb: false }), normalMap: toTex(normalFromHeight(hm, W, W, 3), { srgb: false }) };
}

// Ground-floor shop fronts: 12 m x 4.6 m tile with sign band, big glazing, mullions and doors.
export function storefrontTextures() {
  const W = 512, H = 196, r = rng(141);
  const c = makeCanvas(W, H), x = c.getContext('2d');
  const rmC = makeCanvas(W, H), rm = rmC.getContext('2d');
  const e = makeCanvas(W, H), ex = e.getContext('2d');
  ex.fillStyle = '#000'; ex.fillRect(0, 0, W, H);
  x.fillStyle = '#5b5852'; x.fillRect(0, 0, W, H);
  rm.fillStyle = 'rgb(0,200,0)'; rm.fillRect(0, 0, W, H);
  const signs = ['#7a1f1f', '#1f3d6b', '#2f5a3a', '#1c1c1c', '#6b4a1f', '#4a2a5a'];
  const shops = 2;
  for (let s = 0; s < shops; s++) {
    const x0 = (s * W) / shops + 6, w = W / shops - 12;
    x.fillStyle = signs[Math.floor(r() * signs.length)]; x.fillRect(x0, 8, w, 34);
    x.fillStyle = 'rgba(255,255,255,0.85)'; x.font = 'bold 20px Arial'; x.textAlign = 'center';
    x.fillText(['CAFE', 'MARKET', 'BOOKS', 'DELI', 'BAKERY', 'PHARMACY', 'SALON', 'BANK'][Math.floor(r() * 8)], x0 + w / 2, 32);
    ex.fillStyle = '#ffe6b8'; ex.fillRect(x0, 8, w, 34);
    const g = x.createLinearGradient(0, 50, 0, H);
    g.addColorStop(0, '#2c3a44'); g.addColorStop(1, '#1a2228');
    x.fillStyle = g; x.fillRect(x0 + 4, 50, w - 8, H - 56);
    rm.fillStyle = 'rgb(0,18,230)'; rm.fillRect(x0 + 4, 50, w - 8, H - 56);
    ex.fillStyle = '#ffd59a'; ex.globalAlpha = 0.85; ex.fillRect(x0 + 4, 50, w - 8, H - 56); ex.globalAlpha = 1;
    x.fillStyle = '#2a2a2a';
    for (let k = 1; k < 4; k++) x.fillRect(x0 + 4 + ((w - 8) * k) / 4 - 2, 50, 4, H - 56);
    x.fillRect(x0 + 4, 50, w - 8, 4);
    x.fillStyle = '#3a2a1e'; x.fillRect(x0 + w / 2 - 22, 92, 44, H - 98);
    // awning
    x.fillStyle = r() < 0.5 ? '#8c2b2b' : '#2b4a8c'; x.fillRect(x0 - 2, 42, w + 4, 10);
  }
  // world-UV v runs up from the ground, so let the canvas bottom map to v=0
  return { map: toTex(c, { flipY: true }), rm: toTex(rmC, { srgb: false, flipY: true }), emissive: toTex(e, { flipY: true }) };
}

export function waterNormalTexture() {
  const W = 256, a = fbm(W, W, { oct: 4, cells: 8, seed: 151 }), b = fbm(W, W, { oct: 3, cells: 24, seed: 152 });
  const hm = new Float32Array(W * W);
  for (let i = 0; i < W * W; i++) hm[i] = a[i] * 0.6 + b[i] * 0.4;
  return toTex(normalFromHeight(hm, W, W, 6), { srgb: false });
}

export function doorTexture() {
  const c = makeCanvas(64, 128), x = c.getContext('2d');
  x.fillStyle = '#f4f2ec'; x.fillRect(0, 0, 64, 128);
  x.fillStyle = ['#2f3e52', '#6b2222', '#2f4a36', '#3a2a20'][Math.floor(Math.random() * 4)]; x.fillRect(6, 6, 52, 122);
  x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(12, 14, 40, 44); x.fillRect(12, 68, 40, 50);
  x.fillStyle = '#c8b273'; x.beginPath(); x.arc(48, 72, 3.5, 0, 7); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function garageTexture() {
  const c = makeCanvas(128, 112), x = c.getContext('2d');
  x.fillStyle = '#efefea'; x.fillRect(0, 0, 128, 112);
  for (let y = 4; y < 112; y += 27) { x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(0, y, 128, 2); for (let k = 0; k < 4; k++) x.strokeRect(6 + k * 30, y + 5, 26, 18); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function stallLineTexture() {
  const c = makeCanvas(16, 16), x = c.getContext('2d');
  x.fillStyle = WHITE; x.fillRect(0, 0, 16, 16);
  return toTex(c);
}
