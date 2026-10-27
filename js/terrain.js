// Terrain around the city: rolling foothills that start at the city limits and rise into a ring of
// ridged mountains with rock on steep faces and snow on the peaks. Hill roads are carved into it
// with graded, smoothed profiles. Heights live in a 10 m grid that everything samples (cars, trees, roads).
import * as THREE from 'three';
import { clamp, lerp, smooth, rng } from './config.js';

export const CITY_EDGE = 975;

function hash2(x, y) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
function fbm(x, y, oct) {
  let s = 0, a = 1, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
function ridged(x, y, oct) {
  let s = 0, a = 1, f = 1, n = 0, w = 1;
  for (let i = 0; i < oct; i++) {
    let v = 1 - Math.abs(vnoise(x * f, y * f) * 2 - 1);
    v *= v; v *= w; w = clamp(v * 1.6, 0, 1);
    s += a * v; n += a; a *= 0.5; f *= 2.1;
  }
  return s / n;
}

// d: distance outside the city limits (<= 0 inside)
export function rawHeight(x, z, d) {
  if (d <= 0) return -0.05;
  // foothills: broad swells plus sharper ridges, rising quickly past the city limits
  const broad = fbm(x / 520 + 3.1, z / 520 - 7.3, 5), sharp = ridged(x / 260 - 4.4, z / 260 + 9.1, 4);
  const hills = Math.max(0, (broad - 0.3) * 230 + sharp * 70 + 10);
  let h = smooth(d / 300) * hills;
  if (d > 600) h += smooth((d - 600) / 1500) * Math.pow(ridged(x / 1150 + 11.7, z / 1150 + 2.2, 5), 1.4) * 820;
  return h - 0.05;
}

export class Terrain {
  constructor() {
    this.size = 7200; this.cell = 10; this.N = this.size / this.cell;
    this.h = null; this.roads = [];
  }
  addRoad(pts) { this.roads.push({ pts, y: null }); }
  addRiver(pts, half) { this.river = { pts, half }; }
  setCity(poly) { this.cityPoly = poly; }
  // Signed distance to the city limits on the height grid (negative inside): scanline fill of the
  // outline, then a two-pass chamfer distance transform each way.
  computeCityMask() {
    const N = this.N, c = this.cell, half = this.size / 2, P = this.cityPoly, N1 = N + 1;
    const inside = new Uint8Array(N1 * N1);
    for (let j = 0; j <= N; j++) {
      const z = j * c - half, xs = [];
      for (let k = 0; k < P.length; k++) {
        const a = P[k], b = P[(k + 1) % P.length];
        if ((a.z > z) !== (b.z > z)) xs.push(a.x + ((z - a.z) / (b.z - a.z)) * (b.x - a.x));
      }
      xs.sort((p, q) => p - q);
      for (let t = 0; t + 1 < xs.length; t += 2) {
        const i0 = Math.max(0, Math.ceil((xs[t] + half) / c)), i1 = Math.min(N, Math.floor((xs[t + 1] + half) / c));
        for (let i = i0; i <= i1; i++) inside[j * N1 + i] = 1;
      }
    }
    const chamfer = (d) => {
      const a = c, b = c * Math.SQRT2;
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
        const k = j * N1 + i; let v = d[k];
        if (i > 0) v = Math.min(v, d[k - 1] + a);
        if (j > 0) { v = Math.min(v, d[k - N1] + a); if (i > 0) v = Math.min(v, d[k - N1 - 1] + b); if (i < N) v = Math.min(v, d[k - N1 + 1] + b); }
        d[k] = v;
      }
      for (let j = N; j >= 0; j--) for (let i = N; i >= 0; i--) {
        const k = j * N1 + i; let v = d[k];
        if (i < N) v = Math.min(v, d[k + 1] + a);
        if (j < N) { v = Math.min(v, d[k + N1] + a); if (i < N) v = Math.min(v, d[k + N1 + 1] + b); if (i > 0) v = Math.min(v, d[k + N1 - 1] + b); }
        d[k] = v;
      }
    };
    const dOut = new Float32Array(N1 * N1), dIn = new Float32Array(N1 * N1);
    for (let k = 0; k < N1 * N1; k++) { dOut[k] = inside[k] ? 0 : 1e9; dIn[k] = inside[k] ? 1e9 : 0; }
    chamfer(dOut); chamfer(dIn);
    const cd = this.cityD = new Float32Array(N1 * N1);
    for (let k = 0; k < N1 * N1; k++) cd[k] = inside[k] ? -(dIn[k] - c / 2) : dOut[k] - c / 2;
  }
  cityDist(x, z) {
    if (!this.cityD) return 1e4;
    const half = this.size / 2, c = this.cell, fx = (x + half) / c, fz = (z + half) / c;
    if (fx < 0 || fz < 0 || fx >= this.N || fz >= this.N) return 1e4;
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, d = this.cityD, N1 = this.N + 1;
    const a = d[j * N1 + i], b = d[j * N1 + i + 1], cc = d[(j + 1) * N1 + i], dd = d[(j + 1) * N1 + i + 1];
    return (a + (b - a) * tx) * (1 - tz) + (cc + (dd - cc) * tx) * tz;
  }
  // river channel: quay-walled inside the city, a natural valley with sloping banks outside
  carveRiver() {
    if (!this.river) return;
    const { pts, half } = this.river;
    const N = this.N, c = this.cell, half2 = this.size / 2, h = this.h, BED = -4.5, R = half + 70;
    // stamp distance-to-river into the grid from each centre-line sample
    const dist = this.riverD = new Float32Array((N + 1) * (N + 1)).fill(1e9);
    for (const p of pts) {
      const i0 = Math.max(0, Math.floor((p.x - R + half2) / c)), i1 = Math.min(N, Math.ceil((p.x + R + half2) / c));
      const j0 = Math.max(0, Math.floor((p.z - R + half2) / c)), j1 = Math.min(N, Math.ceil((p.z + R + half2) / c));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i * c - half2 - p.x, j * c - half2 - p.z), k = this.idx(i, j);
        if (d < dist[k]) dist[k] = d;
      }
    }
    this.riverNear = (x, z) => {
      const i = Math.round((x + half2) / c), j = Math.round((z + half2) / c);
      return i < 0 || j < 0 || i > N || j > N ? 1e9 : dist[this.idx(i, j)];
    };
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const x = i * c - half2, z = j * c - half2, d = dist[this.idx(i, j)];
      if (d > R) continue;
      const k = this.idx(i, j), inCity = this.cityD[k] < 20;
      if (d < half + (inCity ? 6 : 0)) h[k] = BED;
      else if (!inCity) h[k] = lerp(BED, h[k], smooth((d - half) / 70));
    }
  }

  idx(i, j) { return j * (this.N + 1) + i; }
  build() {
    const N = this.N, c = this.cell, half = this.size / 2;
    const h = this.h = new Float32Array((N + 1) * (N + 1));
    this.sink = new Float32Array((N + 1) * (N + 1)); // render-only drop under roads so grass never pokes through
    this.computeCityMask();
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) h[this.idx(i, j)] = rawHeight(i * c - half, j * c - half, this.cityD[this.idx(i, j)]);
    // road profiles: follow the land but smoothed and graded (max ~8%), pinned to 0 at the city
    const hash = new Map();
    this.roadHash = hash;
    for (const r of this.roads) {
      const n = r.pts.length, ys = new Float32Array(n);
      for (let k = 0; k < n; k++) ys[k] = Math.max(0, this.rawAt(r.pts[k].x, r.pts[k].z));
      const sm = new Float32Array(n), W = 28;
      for (let k = 0; k < n; k++) { let s = 0, m = 0; for (let q = Math.max(0, k - W); q <= Math.min(n - 1, k + W); q++) { s += ys[q]; m++; } sm[k] = s / m; }
      for (let k = 0; k < 12; k++) { sm[k] = 0; sm[n - 1 - k] = 0; }
      // grade limit (10%) that only ever lowers the road: where the land is too steep the road cuts down
      // into it (the hillside is carved back below) instead of lifting the pinned ends off the ground
      for (let k = 1; k < n; k++) sm[k] = Math.min(sm[k], sm[k - 1] + Math.hypot(r.pts[k].x - r.pts[k - 1].x, r.pts[k].z - r.pts[k - 1].z) * 0.1);
      for (let k = n - 2; k >= 0; k--) sm[k] = Math.min(sm[k], sm[k + 1] + Math.hypot(r.pts[k].x - r.pts[k + 1].x, r.pts[k].z - r.pts[k + 1].z) * 0.1);
      r.y = sm;
      for (let k = 0; k < n; k += 2) {
        const p = r.pts[k], key = Math.floor(p.x / 40) * 10000 + Math.floor(p.z / 40);
        if (!hash.has(key)) hash.set(key, []);
        hash.get(key).push([p.x, p.z, sm[k]]);
      }
    }
    // carve: flat under the road, blending back to the hillside over ~25 m
    const nearest = (x, z, reach = 1) => {
      let best = 1e9, by = 0;
      const kx = Math.floor(x / 40), kz = Math.floor(z / 40);
      for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) {
        const l = hash.get((kx + a) * 10000 + kz + b); if (!l) continue;
        for (const s of l) { const d = (s[0] - x) ** 2 + (s[1] - z) ** 2; if (d < best) { best = d; by = s[2]; } }
      }
      return [Math.sqrt(best), by];
    };
    this.nearestRoad = (x, z) => nearest(x, z);
    this.carveRiver();
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const x = i * c - half, z = j * c - half;
      if (this.cityD[this.idx(i, j)] < -20) continue;
      const k = this.idx(i, j);
      // where the road cuts deep into a hill the banks lean back further (about 1 in 1.1), not a cliff
      const [d, ry] = nearest(x, z, h[k] > 25 ? 3 : 1);
      const blend = Math.min(110, 29 + Math.max(0, h[k] - ry) * 0.9);
      if (d > 21 + blend) continue;
      if (d < 21) { h[k] = ry; this.sink[k] = 0.3; }  // flat bench under road + shoulders (grid is 10 m)
      else h[k] = lerp(h[k], ry, 1 - smooth((d - 21) / blend));
      // inside the city limits the streets and junctions are drawn at ground level: stay under them
      if (this.cityD[k] < 0) { h[k] = Math.min(h[k], -0.05); this.sink[k] = 0.3; }
    }
    // town streets running along the city limits (the ring road, its junctions): the hills start back
    // from their sidewalks, never over them
    if (this.streetNear) for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const k = this.idx(i, j), cd = this.cityD[k];
      if (cd < -30 || cd > 90 || h[k] <= -0.05) continue;
      const x = i * c - half, z = j * c - half;
      if (!this.streetNear(x, z, 38)) continue;
      if (this.streetNear(x, z, 12)) { h[k] = -0.05; this.sink[k] = 0.3; }
      else if (this.streetNear(x, z, 24)) h[k] = Math.min(h[k], h[k] * 0.35);
      else if (this.streetNear(x, z, 38)) h[k] = Math.min(h[k], h[k] * 0.7);
    }
  }
  rawAt(x, z) { return rawHeight(x, z, this.cityDist(x, z)); }
  heightAt(x, z) {
    const half = this.size / 2, c = this.cell;
    const fx = (x + half) / c, fz = (z + half) / c;
    if (fx < 0 || fz < 0 || fx >= this.N || fz >= this.N) return rawHeight(x, z, 1e4);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, h = this.h, N1 = this.N + 1;
    const a = h[j * N1 + i], b = h[j * N1 + i + 1], cc = h[(j + 1) * N1 + i], d = h[(j + 1) * N1 + i + 1];
    return (a + (b - a) * tx) * (1 - tz) + (cc + (d - cc) * tx) * tz;
  }
  slopeAt(x, z) {
    const e = 6, dx = this.heightAt(x + e, z) - this.heightAt(x - e, z), dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  mesh(range, step, drop = 0) {
    const n = Math.round((range * 2) / step), pos = new Float32Array((n + 1) * (n + 1) * 3), col = new Float32Array((n + 1) * (n + 1) * 3);
    const c = new THREE.Color();
    const R = rng(11);
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const x = -range + i * step, z = -range + j * step, k = (j * (n + 1) + i) * 3;
      let y = this.heightAt(x, z);
      if (step === this.cell) { const gi = Math.round((x + this.size / 2) / this.cell), gj = Math.round((z + this.size / 2) / this.cell); y -= this.sink[this.idx(gi, gj)]; }
      if (drop && Math.abs(x) < 2780 && Math.abs(z) < 2780) y -= drop;
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      const s = this.slopeAt(x, z), v = vnoise(x / 37, z / 37) * 0.5 + vnoise(x / 9, z / 9) * 0.5;
      const inCity = this.cityDist(x, z) < 0;
      // grass -> dry grass -> rock by slope, snow on peaks
      c.setRGB(0.2 + v * 0.07, 0.3 + v * 0.08, 0.12 + v * 0.04);
      if (!inCity) {
        if (y > 90) c.lerp(new THREE.Color(0.3, 0.31, 0.2), clamp((y - 90) / 160, 0, 1));
        // forest canopy reads as dark green patches from a distance
        const fd = vnoise(x / 260, z / 260);
        if (y < 380) c.lerp(new THREE.Color(0.08 + v * 0.04, 0.16 + v * 0.05, 0.08), smooth((fd - 0.5) / 0.16) * 0.85 * (1 - smooth((s - 0.55) / 0.2)));
        c.lerp(new THREE.Color(0.3 + v * 0.06, 0.28 + v * 0.05, 0.25 + v * 0.05), smooth((s - 0.45) / 0.3));
        if (y > 380) c.lerp(new THREE.Color(0.92, 0.94, 0.97), smooth((y - 380 - v * 70) / 110) * (1 - smooth((s - 1.3) / 0.6)));
      }
      if (y < -1) c.setRGB(0.16 + v * 0.05, 0.15 + v * 0.04, 0.11); // riverbed
      void R;
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
    }
    const idx = new Uint32Array(n * n * 6);
    let t = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, cc = a + n + 1, d = cc + 1;
      idx[t++] = a; idx[t++] = cc; idx[t++] = b; idx[t++] = b; idx[t++] = cc; idx[t++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    return g;
  }

  addToScene(scene, detailMap, detailNormal) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: detailMap, normalMap: detailNormal, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.97 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'varying vec3 vWP;\n' + sh.fragmentShader
        .replace('#include <map_fragment>', '#ifdef USE_MAP\n vec4 tA = texture2D(map, vWP.xz / 7.0); vec4 tB = texture2D(map, vWP.xz / 61.0); vec4 tC = texture2D(map, vWP.xz / 420.0);\n diffuseColor.rgb *= (tA.r * 0.4 + tB.r * 0.35 + tC.r * 0.25) * 2.0;\n#endif')
        .replace('#include <normal_fragment_maps>', '#ifdef USE_NORMALMAP\n vec3 mapN = texture2D(normalMap, vWP.xz / 7.0).xyz * 2.0 - 1.0; mapN.xy *= normalScale; normal = normalize(normal + vec3(mapN.x, 0.0, mapN.y) * 0.35);\n#endif');
    };
    mat.customProgramCacheKey = () => 'terrain';
    // (the coarse far-field mesh sits well below the fine one wherever both exist: its 40 m cells would
    // otherwise bridge over road cuttings)
    // each is cut into tiles so the parts behind the camera (or outside the shadow's reach) are skipped
    this.meshes = [...this.tiles(this.mesh(2800, 10), 8, mat), ...this.tiles(this.mesh(this.size / 2, 40, 300), 4, mat)];
    for (const m of this.meshes) { m.receiveShadow = true; scene.add(m); }
  }
  // split a square grid mesh into k x k meshes that share its vertex buffers, each with its own bounds
  tiles(g, k, mat) {
    const pos = g.attributes.position, n = Math.round(Math.sqrt(pos.count)) - 1, out = [];
    for (let tj = 0; tj < k; tj++) for (let ti = 0; ti < k; ti++) {
      const i0 = Math.floor((ti * n) / k), i1 = Math.floor(((ti + 1) * n) / k), j0 = Math.floor((tj * n) / k), j1 = Math.floor(((tj + 1) * n) / k);
      const idx = new Uint32Array((i1 - i0) * (j1 - j0) * 6), box = new THREE.Box3(), v = new THREE.Vector3();
      let t = 0;
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
        const a = j * (n + 1) + i, b = a + 1, cc = a + n + 1, d = cc + 1;
        idx[t++] = a; idx[t++] = cc; idx[t++] = b; idx[t++] = b; idx[t++] = cc; idx[t++] = d;
      }
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) box.expandByPoint(v.fromBufferAttribute(pos, j * (n + 1) + i));
      const tg = new THREE.BufferGeometry();
      for (const name in g.attributes) tg.setAttribute(name, g.attributes[name]);
      tg.setIndex(new THREE.BufferAttribute(idx, 1));
      tg.boundingBox = box; tg.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
      out.push(new THREE.Mesh(tg, mat));
    }
    return out;
  }

  // forest on the hills, avoiding roads, cliffs and the snowline
  scatterTrees(count, seed = 5) {
    const R = rng(seed), out = [];
    for (let k = 0; k < count * 12 && out.length < count; k++) {
      const x = (R() * 2 - 1) * 2100, z = (R() * 2 - 1) * 2100;
      if (this.cityDist(x, z) < 15) continue;
      const dens = vnoise(x / 260, z / 260);
      if (dens < 0.47 && R() > 0.04) continue; // trees grow in the dark forest patches, a few strays elsewhere
      const y = this.heightAt(x, z);
      if (y > 370 || this.slopeAt(x, z) > 0.62) continue;
      if (this.nearestRoad(x, z)[0] < 16 || (this.riverNear && this.riverNear(x, z) < 30)) continue;
      out.push({ x, z, y: y - 0.2, s: 0.9 + R() * 0.9, type: y > 60 || R() < 0.8 ? 1 : 0, c: R() });
    }
    return out;
  }
}
