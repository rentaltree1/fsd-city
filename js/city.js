// The city: arterials framing curvy suburban subdivisions (T-junctions, cul-de-sacs, small residential
// intersections), lanes and turn rules, traffic lights, two-way and all-way stops, the river with its
// bridges, Broadway, downtown towers, midtown blocks, suburban houses, parks, POI lots and Superchargers.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { S, CURB, WALK, STOP, nodeCoord, rng, clamp } from './config.js';
import * as TX from './textures.js';
import { Terrain } from './terrain.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// [name, category, rough block i, j on a 20x20 planning chart, side, kW] — the street that ends up
// nearest that spot (long enough for a lot, with room behind it) gets the parking lot.
const POIS = [
  ['Supercharger Downtown', 'charger', 8, 7, 'S', 250],
  ['Supercharger Midtown North', 'charger', 11, 4, 'W', 250],
  ['Supercharger Westfield', 'charger', 2, 8, 'E', 250],
  ['Supercharger Eastside', 'charger', 16, 11, 'N', 250],
  ['Supercharger Southpoint', 'charger', 7, 16, 'N', 150],
  ['Supercharger Northgate', 'charger', 13, 1, 'S', 250],
  ['Home', 'home', 3, 3, 'S'],
  ['Work', 'work', 10, 6, 'N'],
  ['City Hall', 'civic', 9, 7, 'N'],
  ['Grand Central Mall', 'shopping', 11, 11, 'W'],
  ['Hudson Coffee Roasters', 'food', 7, 10, 'E'],
  ['Memorial Hospital', 'health', 5, 12, 'N'],
  ['Lincoln High School', 'school', 14, 14, 'W'],
  ['Fresh Market Grocery', 'shopping', 15, 7, 'W'],
  ['Sunset Diner', 'food', 1, 13, 'N'],
  ['Oak Ridge Library', 'civic', 16, 4, 'E'],
  ['Harbor Fitness', 'fitness', 12, 13, 'S'],
  ['Riverside Apartments', 'home', 4, 15, 'E'],
  ['Maple Grove Elementary', 'school', 17, 16, 'N'],
  ['Pine Street Pizza', 'food', 5, 0, 'S'],
  ['Tesla Service Center', 'service', 17, 9, 'W'],
];
export const RIVER_HALF = 14;            // water + quay edge
// Road classes: half width to the kerb, sidewalk width, lanes per direction and their offsets, kerb
// return radius at corners. Arterials are two lanes each way; residential streets one lane, unmarked.
export const ROAD = {
  art: { hw: 7.6, sw: 4.0, lanes: 2, off: [1.8, 5.4], kerb: 6.0 },
  dt: { hw: 7.6, sw: 4.4, lanes: 2, off: [1.8, 5.4], kerb: 4.5 },
  loc: { hw: 4.6, sw: 3.2, lanes: 1, off: [2.2], kerb: 5.0 },
};
export const BULB_R = 11;                // cul-de-sac kerb radius
// river course through the hills; inside the city it is replaced by two lazy bends (see buildGraph)
const RIVER_CTRL = [[-3500, -1520], [-2900, -1420], [-2350, -1120], [-1950, -1010], [-1620, -770], [-1300, -680], [-1100, -550],
  [1100, 550], [1320, 690], [1620, 860], [1930, 830], [2330, 1110], [2850, 1310], [3500, 1500]];
const FAR = { d: 1e9, ad: 1e9, s: 0, tx: 1, tz: 0 };

export function pointInPoly(x, z, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function polyArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return a / 2;
}
function densify(poly, step) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}
// oriented rectangles for planning: centre, local x axis (cos y, -sin y), local z axis (sin y, cos y)
const mkO = (cx, cz, hx, hz, yaw) => ({ cx, cz, hx, hz, ax: [Math.cos(yaw), -Math.sin(yaw)], ay: [Math.sin(yaw), Math.cos(yaw)] });
const oPts = (o, k = 1) => {
  const out = [];
  for (const [a, b] of [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [0, 0]]) {
    out.push([o.cx + o.ax[0] * o.hx * a * k + o.ay[0] * o.hz * b * k, o.cz + o.ax[1] * o.hx * a * k + o.ay[1] * o.hz * b * k]);
  }
  return out;
};
function oOverlap(A, B, m = 0) {
  for (const ax of [A.ax, A.ay, B.ax, B.ay]) {
    const ra = A.hx * Math.abs(A.ax[0] * ax[0] + A.ax[1] * ax[1]) + A.hz * Math.abs(A.ay[0] * ax[0] + A.ay[1] * ax[1]);
    const rb = B.hx * Math.abs(B.ax[0] * ax[0] + B.ax[1] * ax[1]) + B.hz * Math.abs(B.ay[0] * ax[0] + B.ay[1] * ax[1]);
    if (Math.abs((B.cx - A.cx) * ax[0] + (B.cz - A.cz) * ax[1]) > ra + rb + m) return false;
  }
  return true;
}
const oInside = (o, x, z) => { const dx = x - o.cx, dz = z - o.cz; return Math.abs(dx * o.ax[0] + dz * o.ax[1]) < o.hx && Math.abs(dx * o.ay[0] + dz * o.ay[1]) < o.hz; };

// Patch a standard material so its UVs come from the geometry's real size: instanced boxes use their own
// (rotated, scaled) frame so facades line up with each building's corners; other meshes use world position.
export function worldUV(mat, sx, sy, roofColor = null) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uvScale = { value: new THREE.Vector2(sx, sy) };
    sh.uniforms.roofColor = { value: new THREE.Color(roofColor ?? 0) };
    sh.vertexShader = 'uniform vec2 uvScale;\nvarying float vRoof;\n' + sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
      vec2 fuv;
      #ifdef USE_INSTANCING
        vec4 wpU = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vec3 isc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vec3 lpU = (position + vec3(0.5, 0.0, 0.5)) * isc;
        // u runs left-to-right as seen from outside each face (so lettering on signs isn't mirrored)
        fuv = abs(normal.x) > 0.5 ? vec2(-sign(normal.x) * lpU.z, wpU.y) : vec2(sign(normal.z + 0.001) * lpU.x, wpU.y);
        vRoof = abs(normal.y) > 0.5 ? 1.0 : 0.0;
      #else
        vec4 wpU = modelMatrix * vec4(position, 1.0);
        vec3 wnU = normalize(mat3(modelMatrix) * normal);
        fuv = abs(wnU.x) > 0.5 ? vec2(-sign(wnU.x) * wpU.z, wpU.y) : vec2(sign(wnU.z + 0.001) * wpU.x, wpU.y);
        vRoof = abs(wnU.y) > 0.5 ? 1.0 : 0.0;
      #endif
      if (vRoof > 0.5) fuv = wpU.xz;
      fuv *= uvScale;
      #ifdef USE_MAP
        vMapUv = fuv;
      #endif
      #ifdef USE_EMISSIVEMAP
        vEmissiveMapUv = fuv;
      #endif
      #ifdef USE_ROUGHNESSMAP
        vRoughnessMapUv = fuv;
      #endif
      #ifdef USE_METALNESSMAP
        vMetalnessMapUv = fuv;
      #endif
      #ifdef USE_NORMALMAP
        vNormalMapUv = fuv;
      #endif
    `);
    let fs = 'uniform vec3 roofColor;\nvarying float vRoof;\n' + sh.fragmentShader;
    if (roofColor !== null) {
      fs = fs.replace('#include <map_fragment>', '#include <map_fragment>\n if (vRoof > 0.5) diffuseColor.rgb = roofColor;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n if (vRoof > 0.5) totalEmissiveRadiance = vec3(0.0);')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n if (vRoof > 0.5) roughnessFactor = 0.85;')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n if (vRoof > 0.5) metalnessFactor = 0.0;');
    }
    sh.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => 'wuv' + (roofColor !== null ? 'r' : '');
  return mat;
}

const dummy = new THREE.Object3D();
function instanced(geo, mat, items, place, { shadow = true, receive = true, colors = null } = {}) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  m.count = items.length;
  items.forEach((it, i) => { place(it, dummy); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); if (colors) m.setColorAt(i, colors(it)); });
  m.castShadow = shadow; m.receiveShadow = receive;
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  return m;
}

// e1 arrives at a node (its end tangent dx,dz), e2 leaves it (its start tangent sdx,sdz).
export function moveType(e1, e2) {
  const dot = e1.dx * e2.sdx + e1.dz * e2.sdz, cross = e1.dx * e2.sdz - e1.dz * e2.sdx;
  const a = Math.atan2(cross, dot);
  if (Math.abs(a) < 0.5) return 'S';
  if (Math.abs(a) > 2.5) return 'U';
  if (a > 0) return a < 1.05 ? 'r' : 'R';
  return a > -1.05 ? 'l' : 'L';
}
export const isLeft = (m) => m === 'L' || m === 'l';

// Winding two-lane roads that leave the city and climb into the hills, looping back to town.
const HILL_ROADS = [
  { name: 'Ridge Hwy', a: [990, -150], b: [960, -650], limit: 20, lookout: 'Ridgeview Lookout',
    ctrl: [[1035, -150], [1180, -112], [1340, -55], [1505, -128], [1640, -300], [1652, -500], [1525, -668], [1335, -736], [1160, -672], [1040, -650]] },
  { name: 'Canyon Rd', a: [-990, 250], b: [-950, 650], limit: 15.6, lookout: 'Canyon Overlook', houses: true,
    ctrl: [[-1035, 250], [-1195, 288], [-1380, 226], [-1565, 330], [-1648, 522], [-1522, 702], [-1300, 722], [-1150, 652], [-1040, 650]] },
];

export class City {
  constructor(scene) {
    this.scene = scene;
    this.rand = rng(20260);
    this.simT = 0;
    this.obstGrid = new Map();
    this.occGrid = new Map();
    this.buildings = [];
    this.water = [];
    this.lots = [];
    this.pois = [];
    this.signals = {};
    this.stopSigns = {};
    this.chargers = [];
    this.terrain = new Terrain();
    this.buildGraph();
    this.buildHillRoads();
    this.computeJunctions();
    this.assignLanes();
    this.assignControls();
    this.buildRiverIndex();
    this.buildFaces();
    this.buildIndex();
    this.findBridges();
    this.terrain.addRiver(this.riverPts, RIVER_HALF);
    this.terrain.setCity(this.cityPoly);
    this.terrain.build();
    this.planBlocks();
    this.buildGround();
    this.buildRoads();
    this.buildHillRoadMeshes();
    this.buildRiver();
    this.buildBlocks();
    this.buildFurniture();
  }

  // ---------- street network ----------
  // Like a Midwestern suburb: long arterials (a ring road at the city limits, Circle Blvd, Broadway,
  // six spoke roads and two avenues through the core) frame superblocks, and each superblock is filled
  // with its own subdivision: gently curving parallel streets joined by short cross streets at
  // T-junctions, cul-de-sacs where a street can't reach an arterial, and no junction closer than ~50 m
  // to the next one on an arterial.
  buildGraph() {
    const R = rng(9187), TAU = Math.PI * 2;
    const edgeR = (a) => 1010 * (1 + 0.06 * Math.sin(3 * a + 0.7) + 0.045 * Math.sin(5 * a + 2.3) + 0.025 * Math.sin(8 * a + 4.1));
    const CC = [30, 20], circR = (a) => 540 * (1 + 0.07 * Math.sin(2 * a + 1.1) + 0.04 * Math.sin(5 * a));
    const inCircle = (x, z, m = 0) => Math.hypot(x - CC[0], z - CC[1]) < circR(Math.atan2(z - CC[1], x - CC[0])) + m;
    const rc = new THREE.CatmullRomCurve3(RIVER_CTRL.map((p) => new THREE.Vector3(p[0], 0, p[1])), false, 'centripetal');
    this.riverPts = rc.getSpacedPoints(Math.round(rc.getLength() / 4))
      .map((v) => ({ x: v.x, z: Math.abs(v.x) < 1100 ? v.x / 2 + 75 * Math.sin((Math.PI * v.x) / 550) : v.z }));
    this.buildRiverIndex();

    const lines = [];
    const mkLine = (pts, cls, name, o = {}) => { const L = { pts, cls, name, closed: !!o.closed, ends: o.ends || ['T', 'T'], kind: o.kind || cls, limit: o.limit }; lines.push(L); return L; };
    const sample = (ctrl, step = 4) => {
      const c = new THREE.CatmullRomCurve3(ctrl.map((p) => new THREE.Vector3(p[0], 0, p[1])), false, 'centripetal');
      return c.getSpacedPoints(Math.max(2, Math.round(c.getLength() / step))).map((v) => [v.x, v.z]);
    };
    // ---- arterials
    { const pts = []; for (let k = 0; k < 1600; k++) { const a = (k / 1600) * TAU, r = edgeR(a); pts.push([Math.cos(a) * r, Math.sin(a) * r]); } mkLine(pts, 'art', 'Perimeter Rd', { closed: true, kind: 'ring', limit: 17.9 }); }
    { const pts = []; for (let k = 0; k < 900; k++) { const a = (k / 900) * TAU, r = circR(a); pts.push([CC[0] + Math.cos(a) * r, CC[1] + Math.sin(a) * r]); } mkLine(pts, 'art', 'Circle Blvd', { closed: true, kind: 'circ', limit: 15.6 }); }
    const perim = (a, extra) => [Math.cos(a) * (edgeR(a) + extra), Math.sin(a) * (edgeR(a) + extra)];
    {
      const a0 = Math.atan2(700, -760), a1 = Math.atan2(-760, 700);
      mkLine(sample([perim(a0, 7), perim(a0, -70), [-430, 330], [-90, 50], [250, -210], [480, -520], perim(a1, -70), perim(a1, 7)]), 'art', 'Broadway', { kind: 'bw', limit: 15.6 });
    }
    const SPOKES = [[0.1, 'Edgewood Dr'], [0.95, 'Meade St'], [1.75, 'Ballard Rd'], [3.05, 'Apple Creek Rd'], [3.85, 'Lightning Dr'], [4.65, 'French Rd']];
    for (const [a, name] of SPOKES) {
      let rc0 = 250;
      while (inCircle(Math.cos(a) * rc0, Math.sin(a) * rc0)) rc0 += 2;
      const r0 = rc0 - 7, r1 = edgeR(a) + 7, ph = R() * 6.28, pts = [];
      for (let r = r0; r <= r1; r += 4) { const t = (r - r0) / (r1 - r0), aa = a + 0.045 * Math.sin(Math.PI * t * 1.4 + ph) * (r0 / r); pts.push([Math.cos(aa) * r, Math.sin(aa) * r]); }
      mkLine(pts, 'art', name, { kind: 'spoke', limit: 17.9 });
    }
    const clipToCircle = (pts) => {
      const inside = pts.map(([x, z]) => inCircle(x, z, 7));
      let best = null;
      for (let i = 0; i < pts.length; i++) {
        if (!inside[i] || (i && inside[i - 1])) continue;
        let j = i; while (j + 1 < pts.length && inside[j + 1]) j++;
        if (!best || j - i > best[1] - best[0]) best = [i, j];
      }
      return pts.slice(best[0], best[1] + 1);
    };
    { const pts = []; for (let x = -900; x <= 900; x += 4) pts.push([x, 165 + 38 * Math.sin(x / 260 + 0.4)]); mkLine(clipToCircle(pts), 'dt', 'Main St', { kind: 'core', limit: 13.4 }); }
    { const pts = []; for (let z = -900; z <= 900; z += 4) pts.push([155 + 34 * Math.sin(z / 240 + 1), z]); mkLine(clipToCircle(pts), 'dt', 'Park Ave', { kind: 'core', limit: 13.4 }); }
    const arterials = lines.slice();

    // ---- distance to the arterials, city mask, river, and the superblocks between them (5 m raster)
    const GS = 5, GN = 480, G0 = -1200, gi = (v) => Math.floor((v - G0) / GS), cx = (i) => G0 + (i + 0.5) * GS;
    const distA = new Float32Array(GN * GN).fill(1e4);
    for (const L of arterials) for (const [x, z] of L.pts) {
      const i0 = gi(x), j0 = gi(z), rr = 22;
      for (let j = Math.max(0, j0 - rr); j <= Math.min(GN - 1, j0 + rr); j++) for (let i = Math.max(0, i0 - rr); i <= Math.min(GN - 1, i0 + rr); i++) {
        const d = Math.hypot(cx(i) - x, cx(j) - z), k = j * GN + i;
        if (d < distA[k]) distA[k] = d;
      }
    }
    const city = new Uint8Array(GN * GN), rivD = new Float32Array(GN * GN);
    for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
      const x = cx(i), z = cx(j), k = j * GN + i;
      if (Math.hypot(x, z) < edgeR(Math.atan2(z, x)) - 6) { city[k] = 1; rivD[k] = this.riverInfo(x, z).ad; }
    }
    const at = (arr, x, z, def) => { const i = gi(x), j = gi(z); return i < 0 || j < 0 || i >= GN || j >= GN ? def : arr[j * GN + i]; };
    const dA = (x, z) => at(distA, x, z, 0), inCityR = (x, z) => at(city, x, z, 0) === 1, rD = (x, z) => at(rivD, x, z, 0);
    const lab = new Int32Array(GN * GN).fill(-1), comps = [];
    for (let k0 = 0; k0 < GN * GN; k0++) {
      if (lab[k0] >= 0 || !city[k0] || distA[k0] < 9) continue;
      const id = comps.length, cells = [k0], st = [k0]; lab[k0] = id;
      while (st.length) {
        const k = st.pop(), i = k % GN, j = (k / GN) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= GN || jj >= GN) continue;
          const q = jj * GN + ii;
          if (lab[q] < 0 && city[q] && distA[q] >= 9) { lab[q] = id; cells.push(q); st.push(q); }
        }
      }
      comps.push(cells);
    }

    // ---- subdivisions: parallel curving streets + staggered cross streets + cul-de-sacs
    const NAMES = ['Oak', 'Maple', 'Cedar', 'Elm', 'Walnut', 'Spruce', 'Chestnut', 'Willow', 'Birch', 'Aspen', 'Hawthorn', 'Juniper', 'Magnolia', 'Laurel',
      'Sycamore', 'Poplar', 'Hickory', 'Linden', 'Alder', 'Cypress', 'Clearfield', 'Stratford', 'Benton', 'Wentworth', 'Carrington', 'Fernwood', 'Haymeadow',
      'Waterford', 'Silentwind', 'Bellevue', 'Flint Rock', 'Clearwater', 'Morning Sun', 'Sierra', 'Pondview', 'Gusty', 'Melody', 'Keystone', 'Wyndmere',
      'Sundance', 'Greenleaf', 'Corridor', 'Fallcreek', 'Sableridge', 'Gazebohill', 'Altamont', 'Canvasback', 'Drake', 'Glory', 'Braeburn', 'Appleview',
      'Benvalley', 'Everbreeze', 'Stargaze', 'Snowden', 'Windingbrook', 'Providence', 'Tuscany', 'Milestone', 'Prairiewater', 'Evergreen', 'Cherryvale',
      'Summerset', 'Rosemary', 'Kurt', 'Melman', 'Rose', 'Schun', 'Ashbury', 'Highland', 'Forest', 'Ridge', 'Cherry', 'Locust', 'Mulberry', 'Peach', 'Vine',
      'Holly', 'Ivy', 'Fern', 'Clover', 'Heather', 'Primrose', 'Rosewood', 'Briarwood', 'Foxtail', 'Hidden Creek', 'Timber', 'Meadowlark', 'Bluebird', 'Cardinal',
      'Kingfisher', 'Heron', 'Quail', 'Pheasant', 'Thistle', 'Goldenrod', 'Sage', 'Larkspur', 'Juneberry'];
    for (let k = NAMES.length - 1; k > 0; k--) { const q = Math.floor(R() * (k + 1)); [NAMES[k], NAMES[q]] = [NAMES[q], NAMES[k]]; }
    const usedNames = new Set(); let ni = 0;
    const nameOf = (sfx) => { for (let t = 0; t < 300; t++) { const n = `${NAMES[ni++ % NAMES.length]} ${sfx[Math.floor(R() * sfx.length)]}`; if (!usedNames.has(n)) { usedNames.add(n); return n; } } return 'Unnamed Ln'; };
    const PARAMS = {
      sub: { cls: 'loc', rail: 98, rung: 125, buf: 60, amp: 14, lam: 170, stub: 0.22, sfxR: ['Dr', 'Ln', 'Way'], sfxC: ['St', 'Ln', 'Pl'] },
      mid: { cls: 'loc', rail: 90, rung: 110, buf: 50, amp: 8, lam: 220, stub: 0.1, sfxR: ['St', 'Ave'], sfxC: ['St', 'Pl'] },
      dt: { cls: 'dt', rail: 96, rung: 100, buf: 52, amp: 3, lam: 300, stub: 0, sfxR: ['St', 'Ave'], sfxC: ['St'] },
    };
    const tEnds = [];
    comps.forEach((cells, cid) => {
      if (cells.length * GS * GS < 9000) return;
      let mx = 0, mz = 0;
      for (const k of cells) { mx += cx(k % GN); mz += cx((k / GN) | 0); }
      mx /= cells.length; mz /= cells.length;
      let sxx = 0, szz = 0, sxz = 0;
      for (const k of cells) { const x = cx(k % GN) - mx, z = cx((k / GN) | 0) - mz; sxx += x * x; szz += z * z; sxz += x * z; }
      const P = !inCircle(mx, mz) ? PARAMS.sub : Math.hypot(mx, mz) < 330 ? PARAMS.dt : PARAMS.mid;
      const th = 0.5 * Math.atan2(2 * sxz, sxx - szz) + (R() - 0.5) * 0.5;
      const ux = Math.cos(th), uz = Math.sin(th), vx = -uz, vz = ux;
      let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
      for (const k of cells) { const x = cx(k % GN) - mx, z = cx((k / GN) | 0) - mz, u = x * ux + z * uz, v = x * vx + z * vz; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      const inComp = (x, z) => at(lab, x, z, -1) === cid;
      const valid = (x, z) => inComp(x, z) && dA(x, z) >= P.buf && rD(x, z) >= 50;
      const span = v1 - v0 - 2 * P.buf;
      if (span < -30) return;
      const nr = Math.max(1, Math.floor(Math.max(0, span) / P.rail) + 1), vs = [];
      for (let k = 0; k < nr; k++) vs.push((v0 + v1) / 2 + (k - (nr - 1) / 2) * P.rail);
      const NU = Math.ceil((u1 - u0 + 80) / 4) + 1, U = (i) => u0 - 40 + i * 4;
      const rails = vs.map((v, k) => {
        const ph = R() * 6.28, pts = [];
        for (let i = 0; i < NU; i++) {
          const u = U(i), vv = v + P.amp * Math.sin(u / P.lam + ph), x = mx + ux * u + vx * vv, z = mz + uz * u + vz * vv;
          pts.push(valid(x, z) ? [x, z] : null);
        }
        return { pts, k };
      });
      // each continuous run of a rail is a street; its ends reach out to the arterial if they can
      const railLines = rails.map(() => []);
      rails.forEach((rl, k) => {
        let i = 0;
        while (i < NU) {
          if (!rl.pts[i]) { i++; continue; }
          let j = i; while (j + 1 < NU && rl.pts[j + 1]) j++;
          if (j - i >= 13) {
            const pts = rl.pts.slice(i, j + 1).map((p) => p.slice()), ends = ['D', 'D'], ext = [0, 0];
            for (const side of [0, 1]) {
              const a = side ? pts[pts.length - 2] : pts[1], b = side ? pts[pts.length - 1] : pts[0];
              let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz); dx /= l; dz /= l;
              const add = []; let x = b[0], z = b[1], ok = false;
              for (let s = 0; s < (P.buf + 24) / 2; s++) {
                x += dx * 2; z += dz * 2;
                if (!inCityR(x, z) || rD(x, z) < 50) break;
                if (s % 2 === 1) add.push([x, z]);
                if (dA(x, z) < 3.2) {
                  const bx = x - dx * 8, bz = z - dz * 8;
                  const gx = dA(bx + 5, bz) - dA(bx - 5, bz), gz = dA(bx, bz + 5) - dA(bx, bz - 5), gl = Math.hypot(gx, gz) || 1;
                  if (-(dx * gx + dz * gz) / gl > 0.55) { add.push([x, z], [x + dx * 8, z + dz * 8]); ok = true; }
                  break;
                }
              }
              if (!ok && R() < 0.78) {
                // no straight run at the arterial: curve round to meet it square on instead
                let hit = null;
                for (let da = -1.2; da <= 1.2; da += 0.15) {
                  const cx2 = Math.cos(da), sx2 = Math.sin(da), hx = dx * cx2 - dz * sx2, hz = dx * sx2 + dz * cx2;
                  for (let s = 6; s < 120; s += 3) {
                    const qx = b[0] + hx * s, qz = b[1] + hz * s;
                    if (!inCityR(qx, qz) || rD(qx, qz) < 50) break;
                    if (dA(qx, qz) < 3.2) { if (!hit || s < hit.s) hit = { s, qx, qz }; break; }
                  }
                }
                if (hit && hit.s > 20) {
                  // arrive along the arterial's normal: back off from the hit point along the distance gradient
                  const gx = dA(hit.qx + 5, hit.qz) - dA(hit.qx - 5, hit.qz), gz = dA(hit.qx, hit.qz + 5) - dA(hit.qx, hit.qz - 5), gl = Math.hypot(gx, gz) || 1;
                  const nx = gx / gl, nz = gz / gl, lead = Math.min(28, hit.s * 0.45);
                  const p0 = b, p1 = [b[0] + dx * lead, b[1] + dz * lead], p2 = [hit.qx + nx * lead, hit.qz + nz * lead], p3 = [hit.qx - nx * 8, hit.qz - nz * 8];
                  const L2 = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]), n2 = Math.max(4, Math.round(L2 / 4)), curve = [];
                  let good = true;
                  for (let q = 1; q <= n2; q++) {
                    const t = q / n2, u2 = 1 - t, x2 = u2 * u2 * u2 * p0[0] + 3 * u2 * u2 * t * p1[0] + 3 * u2 * t * t * p2[0] + t * t * t * p3[0], z2 = u2 * u2 * u2 * p0[1] + 3 * u2 * u2 * t * p1[1] + 3 * u2 * t * t * p2[1] + t * t * t * p3[1];
                    if (!inCityR(x2, z2) || rD(x2, z2) < 48 || (t < 0.7 && at(lab, x2, z2, -1) !== cid && dA(x2, z2) > 12)) { good = false; break; }
                    curve.push([x2, z2]);
                  }
                  if (good) { add.length = 0; add.push(...curve); ok = true; }
                }
              }
              if (ok) { ends[side] = 'T'; ext[side] = add.length; if (side) pts.push(...add); else pts.unshift(...add.reverse()); }
            }
            const L = mkLine(pts, P.cls, nameOf(P.sfxR), { ends, kind: 'sub', limit: P.cls === 'dt' ? 13.4 : 11.2 });
            L.ext = ext; L.i0 = i; L.i1 = j; L.dA = dA;
            railLines[k].push(L);
          }
          i = j + 1;
        }
      });
      // cross streets between neighbouring rails, staggered so they meet the rails at T-junctions
      for (let k = 0; k + 1 < rails.length; k++) {
        const A = rails[k], B = rails[k + 1];
        const runOk = (rl, i) => { for (let q = i - 5; q <= i + 5; q++) if (q < 0 || q >= NU || !rl.pts[q]) return false; return true; };
        for (let u = u0 + P.rung * (0.5 + (k % 2) * 0.5); u < u1; u += P.rung * (0.85 + R() * 0.3)) {
          const i = Math.round((u - (u0 - 40)) / 4);
          if (!runOk(A, i) || !runOk(B, i)) continue;
          const a = A.pts[i], b = B.pts[i];
          let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz); dx /= l; dz /= l;
          if (!valid((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) continue;
          if (R() < P.stub) mkLine([[a[0] - dx * 4, a[1] - dz * 4], [a[0] + dx * l * 0.52, a[1] + dz * l * 0.52]], P.cls, nameOf(['Ct', 'Cir']), { ends: ['T', 'D'], kind: 'sub', limit: 11.2 });
          else mkLine([[a[0] - dx * 4, a[1] - dz * 4], [b[0] + dx * 4, b[1] + dz * 4]], P.cls, nameOf(P.sfxC), { kind: 'sub', limit: P.cls === 'dt' ? 13.4 : 11.2 });
        }
      }
      for (const list of railLines) for (const L of list) for (const side of [0, 1]) if (L.ends[side] === 'T') tEnds.push({ L, side });
    });

    // ---- keep junctions on the arterials well apart: a street that would join too close to another
    // junction ends in a cul-de-sac instead
    const artX = this.lineCrossings(arterials).map((c) => [c.x, c.z]), accepted = [];
    for (let k = tEnds.length - 1; k > 0; k--) { const q = Math.floor(R() * (k + 1)); [tEnds[k], tEnds[q]] = [tEnds[q], tEnds[k]]; }
    for (const t of tEnds) {
      const p = t.side ? t.L.pts[t.L.pts.length - 2] : t.L.pts[1];
      const far = (list, d) => list.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) > d);
      if (far(accepted, 55) && far(artX, 80)) { accepted.push(p); continue; }
      const pts = t.L.pts;
      for (let n = t.L.ext[t.side]; n > 0; n--) t.side ? pts.pop() : pts.shift();
      while (pts.length > 2) { const e2 = t.side ? pts[pts.length - 1] : pts[0]; if (dA(e2[0], e2[1]) >= 36) break; t.side ? pts.pop() : pts.shift(); }
      t.L.ends[t.side] = 'D';
    }
    this.buildNet(lines.filter((L) => L.pts.length >= 2));
    this.diagEdges = this.edges.filter((e) => e.kind === 'bw');
    this.warp = (gx, gz) => [gx * 0.95, gz * 0.95];
  }

  // All crossings between segments of different lines: [{i, si, j, sj, x, z}]
  lineCrossings(lines) {
    const C = 40, hash = new Map(), out = [];
    lines.forEach((L, li) => {
      const P = L.pts;
      L.cum = [0];
      for (let k = 1; k < P.length; k++) L.cum.push(L.cum[k - 1] + Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]));
      for (let k = 0; k + 1 < P.length; k++) {
        const a = P[k], b = P[k + 1];
        for (let x = Math.floor(Math.min(a[0], b[0]) / C); x <= Math.floor(Math.max(a[0], b[0]) / C); x++)
          for (let z = Math.floor(Math.min(a[1], b[1]) / C); z <= Math.floor(Math.max(a[1], b[1]) / C); z++) {
            const key = x * 100000 + z; if (!hash.has(key)) hash.set(key, []); hash.get(key).push([li, k]);
          }
      }
    });
    const seen = new Set();
    for (const list of hash.values()) for (let p = 0; p < list.length; p++) for (let q = p + 1; q < list.length; q++) {
      const [i, k] = list[p], [j, l] = list[q];
      if (i === j) continue;
      const key = i < j ? `${i},${k},${j},${l}` : `${j},${l},${i},${k}`;
      if (seen.has(key)) continue; seen.add(key);
      const A = lines[i].pts, B = lines[j].pts, a = A[k], b = A[k + 1], c = B[l], d = B[l + 1];
      const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1], den = rx * sz - rz * sx;
      if (Math.abs(den) < 1e-9) continue;
      const qx = c[0] - a[0], qz = c[1] - a[1], t = (qx * sz - qz * sx) / den, u = (qx * rz - qz * rx) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      out.push({ i, si: lines[i].cum[k] + t * Math.hypot(rx, rz), j, sj: lines[j].cum[l] + u * Math.hypot(sx, sz), x: a[0] + rx * t, z: a[1] + rz * t });
    }
    return out;
  }

  // Turn a set of polylines into the street graph: junctions where lines cross (nearby crossings merged),
  // dead-end pieces kept as cul-de-sacs, dangling overshoots trimmed, and each piece simplified into a
  // chain of straight segments joined by bend nodes. Only the largest connected network is kept.
  buildNet(lines) {
    for (const L of lines) { // densify to <= 4 m, close rings
      const P = L.closed ? L.pts.concat([L.pts[0]]) : L.pts, out = [P[0]];
      for (let k = 1; k < P.length; k++) {
        const a = P[k - 1], b = P[k], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
        for (let q = 1; q <= n; q++) out.push([a[0] + ((b[0] - a[0]) * q) / n, a[1] + ((b[1] - a[1]) * q) / n]);
      }
      L.pts = out;
    }
    const X = this.lineCrossings(lines);
    // cluster crossings within 18 m into junctions
    const par = X.map((_, i) => i), find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
    { const h = new Map(); X.forEach((c, i) => { const k = Math.floor(c.x / 18) * 100000 + Math.floor(c.z / 18); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const q of h.get(k + a * 100000 + b) || []) if (Math.hypot(X[q].x - c.x, X[q].z - c.z) < 18) par[find(q)] = find(i); if (!h.has(k)) h.set(k, []); h.get(k).push(i); }); }
    let J = [], jOf = new Map();
    X.forEach((c, i) => { const r = find(i); if (!jOf.has(r)) { jOf.set(r, J.length); J.push({ x: 0, z: 0, n: 0 }); } const j = J[jOf.get(r)]; j.x += c.x; j.z += c.z; j.n++; });
    for (const j of J) { j.x /= j.n; j.z /= j.n; }
    const jPar = J.map((_, i) => i), jf = (i) => (jPar[i] === i ? i : (jPar[i] = jf(jPar[i])));
    const pointAt = (L, s) => {
      const P = L.pts, C = L.cum, tot = C[C.length - 1]; if (L.closed) s = ((s % tot) + tot) % tot; s = clamp(s, 0, tot);
      let lo = 0, hi = C.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (C[m] < s) lo = m; else hi = m; }
      const t = (s - C[lo]) / Math.max(1e-6, C[hi] - C[lo]); return [P[lo][0] + (P[hi][0] - P[lo][0]) * t, P[lo][1] + (P[hi][1] - P[lo][1]) * t];
    };
    let pieces;
    for (let pass = 0; pass < 6; pass++) {
      const cuts = lines.map(() => new Map());
      X.forEach((c, i) => {
        const j = jf(jOf.get(find(i)));
        for (const [li, s] of [[c.i, c.si], [c.j, c.sj]]) { const m = cuts[li]; if (!m.has(j)) m.set(j, []); m.get(j).push(s); }
      });
      pieces = [];
      lines.forEach((L, li) => {
        const tot = L.cum[L.cum.length - 1];
        const list = [...cuts[li].entries()].map(([j, ss]) => ({ j, s: ss.reduce((a, b) => a + b, 0) / ss.length })).sort((a, b) => a.s - b.s);
        if (!list.length) return;
        if (L.closed) {
          for (let k = 0; k < list.length; k++) { const a = list[k], b = list[(k + 1) % list.length]; pieces.push({ L, s0: a.s, s1: b.s + (k + 1 === list.length ? tot : 0), n0: a.j, n1: b.j }); }
          return;
        }
        for (let k = 0; k + 1 < list.length; k++) pieces.push({ L, s0: list[k].s, s1: list[k + 1].s, n0: list[k].j, n1: list[k + 1].j });
        const head = list[0].s, tail = tot - list[list.length - 1].s;
        if (L.ends[0] === 'D' && head >= 40) pieces.push({ L, s0: 0, s1: head, n0: -1, n1: list[0].j, deadAt: 0 });
        if (L.ends[1] === 'D' && tail >= 40) pieces.push({ L, s0: list[list.length - 1].s, s1: tot, n0: list[list.length - 1].j, n1: -1, deadAt: 1 });
      });
      // pieces too short for two junctions: merge the junctions and try again
      let merged = false;
      for (const p of pieces) if (p.n0 >= 0 && p.n1 >= 0 && p.n0 !== p.n1 && p.s1 - p.s0 < (p.L.cls === 'loc' ? 30 : 40)) { jPar[jf(p.n0)] = jf(p.n1); merged = true; }
      if (!merged) break;
    }
    // positions of merged junctions
    const JP = new Map();
    J.forEach((j, i) => { const r = jf(i); if (!JP.has(r)) JP.set(r, { x: 0, z: 0, n: 0 }); const q = JP.get(r); q.x += j.x * j.n; q.z += j.z * j.n; q.n += j.n; });
    for (const q of JP.values()) { q.x /= q.n; q.z /= q.n; }
    // chains of points per piece (Douglas-Peucker simplified)
    const dp = (P, tol) => {
      if (P.length < 3) return P;
      const keep = new Uint8Array(P.length); keep[0] = keep[P.length - 1] = 1;
      const st = [[0, P.length - 1]];
      while (st.length) {
        const [a, b] = st.pop(); let md = 0, mi = -1;
        const ax = P[a][0], az = P[a][1], bx = P[b][0], bz = P[b][1], L = Math.hypot(bx - ax, bz - az) || 1;
        for (let i = a + 1; i < b; i++) { const d = Math.abs((bx - ax) * (az - P[i][1]) - (ax - P[i][0]) * (bz - az)) / L; if (d > md) { md = d; mi = i; } }
        if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
      }
      return P.filter((_, i) => keep[i]);
    };
    const chains = [], pairSeen = new Set();
    for (const p of pieces) {
      const L = p.L, a = p.n0 >= 0 ? JP.get(jf(p.n0)) : null, b = p.n1 >= 0 ? JP.get(jf(p.n1)) : null;
      if (p.n0 >= 0 && p.n1 >= 0 && jf(p.n0) === jf(p.n1)) continue;
      const pts = [a ? [a.x, a.z] : pointAt(L, p.s0)];
      const step = 4, m0 = p.s0 + (a ? 7 : 0), m1 = p.s1 - (b ? 7 : 0);
      for (let s = m0 + step; s < m1; s += step) pts.push(pointAt(L, s));
      pts.push(b ? [b.x, b.z] : pointAt(L, p.s1));
      let simp = dp(pts, L.cls === 'loc' ? 0.9 : 1.6);
      // long segments are split so lighting/parking spacing stays sensible
      const out = [simp[0]];
      for (let k = 1; k < simp.length; k++) { const q = simp[k - 1], r = simp[k], n = Math.ceil(Math.hypot(r[0] - q[0], r[1] - q[1]) / 170); for (let t = 1; t <= n; t++) out.push([q[0] + ((r[0] - q[0]) * t) / n, q[1] + ((r[1] - q[1]) * t) / n]); }
      simp = out;
      const ka = p.n0 >= 0 ? jf(p.n0) : `d${chains.length}a`, kb = p.n1 >= 0 ? jf(p.n1) : `d${chains.length}b`, pk = [ka, kb].sort().join('|');
      if (simp.length === 2 && pairSeen.has(pk)) simp.splice(1, 0, [(simp[0][0] + simp[1][0]) / 2 + 0.5, (simp[0][1] + simp[1][1]) / 2 + 0.5]);
      pairSeen.add(pk);
      chains.push({ L, ka, kb, pts: simp, s0: p.s0 });
    }
    // largest connected network only
    const cp = new Map(), cf = (k) => { if (!cp.has(k)) cp.set(k, k); const v = cp.get(k); if (v === k) return k; const r = cf(v); cp.set(k, r); return r; };
    for (const c of chains) cp.set(cf(c.ka), cf(c.kb));
    const size = new Map(); for (const c of chains) { const r = cf(c.ka); size.set(r, (size.get(r) || 0) + 1); }
    let big = null; for (const [r, n] of size) if (!big || n > size.get(big)) big = r;
    // nodes and edges
    this.nodes = []; this.edges = [];
    const nodeFor = new Map();
    const mkNode = (x, z, kind) => { const n = { id: this.nodes.length, x, z, gx: x, gz: z, kind, out: {}, in: {}, queue: [], offset: ((this.nodes.length * 37) % 8) * 4 }; this.nodes.push(n); return n; };
    const getJ = (k, p, kind) => { if (!nodeFor.has(k)) nodeFor.set(k, mkNode(p[0], p[1], kind)); return nodeFor.get(k); };
    const lineSeg = new Map();
    for (const c of chains) {
      if (cf(c.ka) !== big) continue;
      const L = c.L, spec = ROAD[L.cls];
      const ns = [getJ(c.ka, c.pts[0], 'jn')];
      for (let k = 1; k + 1 < c.pts.length; k++) ns.push(mkNode(c.pts[k][0], c.pts[k][1], L.kind));
      ns.push(getJ(c.kb, c.pts[c.pts.length - 1], 'jn'));
      let pos = lineSeg.get(L) || 0;
      for (let k = 0; k + 1 < ns.length; k++) {
        const A = ns[k], B = ns[k + 1];
        if (A === B || Math.hypot(B.x - A.x, B.z - A.z) < 1) continue;
        for (const [P, Q] of [[A, B], [B, A]]) {
          const e = this.addStraight(P, Q, 'n' + Q.id, L.kind === 'bw' ? 'd' : 'r', L.limit || 11.2, L.name);
          Object.assign(e, { cls: L.cls, kind: L.kind, hw: spec.hw, sw: spec.sw, lanes: spec.lanes, laneOff: spec.off, kerb: spec.kerb, chainPos: pos });
        }
        pos++;
      }
      lineSeg.set(L, pos);
    }
  }
  addStraight(A, B, dir, axis, limit, name) {
    const dx = B.x - A.x, dz = B.z - A.z, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len;
    const e = {
      id: this.edges.length, a: A.id, b: B.id, dx: ux, dz: uz, sdx: ux, sdz: uz, dir, h: Math.atan2(uz, ux),
      ax: A.x, az: A.z, bx: B.x, bz: B.z, rx: -uz, rz: ux, len, axis, limit, name,
    };
    this.edges.push(e);
    A.out[dir] = e; B.in['n' + A.id] = e; // keyed by the neighbour it leads to / comes from
    return e;
  }
  edgePoint(e, u, w) {
    if (!e.curve) return { x: e.ax + e.dx * u + e.rx * w, z: e.az + e.dz * u + e.rz * w };
    const { xs, zs, cum } = e.curve, n = xs.length;
    let x, z, tx, tz;
    if (u <= 0) { tx = e.sdx; tz = e.sdz; x = xs[0] + tx * u; z = zs[0] + tz * u; }
    else if (u >= e.len) { tx = e.dx; tz = e.dz; x = xs[n - 1] + tx * (u - e.len); z = zs[n - 1] + tz * (u - e.len); }
    else {
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] < u) lo = m; else hi = m; }
      const t = (u - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo]);
      tx = xs[hi] - xs[lo]; tz = zs[hi] - zs[lo];
      const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      x = xs[lo] + (xs[hi] - xs[lo]) * t; z = zs[lo] + (zs[hi] - zs[lo]) * t;
    }
    return { x: x - tz * w, z: z + tx * w };
  }
  edgeTangent(e, u) {
    if (!e.curve) return [e.dx, e.dz];
    const a = this.edgePoint(e, u - 1, 0), b = this.edgePoint(e, u + 1, 0), l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return [(b.x - a.x) / l, (b.z - a.z) / l];
  }
  // The lanes feeding edge e's end: e itself, then (back through bend nodes, which are just kinks in
  // one street) the edges before it, each with `off` = the distance from that edge's end to e's end.
  feeders(e, maxLen = 120) {
    const out = [{ e, off: 0 }];
    let cur = e, off = 0;
    while (off + cur.len < maxLen) {
      const A = this.nodes[cur.a];
      if (!A.bend) break;
      const prev = Object.values(A.in).find((x) => x.a !== cur.b);
      if (!prev || out.some((o) => o.e === prev)) break;
      off += cur.len; cur = prev; out.push({ e: cur, off });
    }
    return out;
  }
  edgeLocal(e, x, z) {
    if (!e.curve) { const px = x - e.ax, pz = z - e.az; return { u: px * e.dx + pz * e.dz, w: px * e.rx + pz * e.rz }; }
    const { xs, zs, cum } = e.curve;
    let best = 1e18, bi = 0;
    for (let i = 0; i < xs.length; i++) { const d = (xs[i] - x) ** 2 + (zs[i] - z) ** 2; if (d < best) { best = d; bi = i; } }
    const j = bi < xs.length - 1 ? bi + 1 : bi - 1;
    let tx = xs[Math.max(bi, j)] - xs[Math.min(bi, j)], tz = zs[Math.max(bi, j)] - zs[Math.min(bi, j)];
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const px = x - xs[bi], pz = z - zs[bi];
    let u = cum[bi] + px * tx + pz * tz;
    if (bi === 0 && u < 0) u = px * e.sdx + pz * e.sdz;
    if (bi === xs.length - 1 && u > e.len) u = e.len + px * e.dx + pz * e.dz;
    return { u, w: -px * tz + pz * tx };
  }

  buildHillRoads() {
    this.hillRoads = []; this.curvedEdges = []; this.scenic = [];
    const mkEdge = (A, B, xs, zs, limit, name) => {
      const cum = [0];
      for (let i = 1; i < xs.length; i++) cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
      const n = xs.length, len = cum[n - 1];
      let sdx = xs[1] - xs[0], sdz = zs[1] - zs[0], l = Math.hypot(sdx, sdz); sdx /= l; sdz /= l;
      let dx = xs[n - 1] - xs[n - 2], dz = zs[n - 1] - zs[n - 2]; l = Math.hypot(dx, dz); dx /= l; dz /= l;
      const e = {
        id: this.edges.length, a: A.id, b: B.id, dx, dz, sdx, sdz, h: Math.atan2(dz, dx), ax: A.x, az: A.z, bx: B.x, bz: B.z,
        rx: -dz, rz: dx, len, axis: 'h', limit, name, curve: { xs, zs, cum }, dir: B.pass ? 'F' : 'H',
        cls: 'art', kind: 'hill', hw: ROAD.art.hw, sw: ROAD.art.sw, lanes: 2, laneOff: ROAD.art.off, kerb: ROAD.art.kerb, chainPos: 0,
      };
      this.edges.push(e); this.curvedEdges.push(e);
      return e;
    };
    for (const R of HILL_ROADS) {
      // a bend of the ring road well away from any junction
      const jns = this.nodes.filter((n) => Object.keys(n.out).length > 2);
      const ringNode = ([x, z]) => this.nodes.filter((n) => n.kind === 'ring' && Object.keys(n.out).length === 2 && jns.every((j) => Math.hypot(j.x - n.x, j.z - n.z) > 70))
        .reduce((b, n) => ((n.x - x) ** 2 + (n.z - z) ** 2 < (b.x - x) ** 2 + (b.z - z) ** 2 ? n : b));
      const A = ringNode(R.a), B = ringNode(R.b);
      // leave the ring road heading straight out of town, then pick up the route through the hills
      const nrm = (x, z) => { const l = Math.hypot(x, z); return [x / l, z / l]; };
      const d0 = nrm(A.x, A.z), d1 = nrm(B.x, B.z), rOut = Math.max(Math.hypot(A.x, A.z), Math.hypot(B.x, B.z)) + 70;
      const ctrl = R.ctrl.filter(([x, z]) => Math.hypot(x, z) > rOut);
      const pts = [[A.x, A.z], [A.x + d0[0] * 30, A.z + d0[1] * 30], [A.x + d0[0] * 60, A.z + d0[1] * 60], ...ctrl,
        [B.x + d1[0] * 60, B.z + d1[1] * 60], [B.x + d1[0] * 30, B.z + d1[1] * 30], [B.x, B.z]];
      const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], 0, p[1])), false, 'centripetal');
      const total = curve.getLength(), ns = Math.round(total / 2);
      const sp = curve.getSpacedPoints(ns).map((v) => ({ x: v.x, z: v.z }));
      this.terrain.addRoad(sp);
      const nseg = Math.max(2, Math.round(total / 300)), per = Math.floor(ns / nseg);
      const nodes = [A];
      for (let k = 1; k < nseg; k++) {
        const p = sp[k * per];
        const pn = { id: this.nodes.length, x: p.x, z: p.z, pass: true, light: false, offset: 0, out: {}, in: {}, queue: [] };
        this.nodes.push(pn); nodes.push(pn);
      }
      nodes.push(B);
      const road = { name: R.name, pts: sp, fwd: [], bwd: [], houses: !!R.houses };
      for (let k = 0; k < nseg; k++) {
        const i0 = k * per, i1 = k === nseg - 1 ? ns : (k + 1) * per;
        const xs = [], zs = [];
        for (let i = i0; i <= i1; i++) { xs.push(sp[i].x); zs.push(sp[i].z); }
        const N0 = nodes[k], N1 = nodes[k + 1];
        const f = mkEdge(N0, N1, xs, zs, R.limit, R.name);
        const b = mkEdge(N1, N0, xs.slice().reverse(), zs.slice().reverse(), R.limit, R.name);
        b.dir = N0.pass ? 'B' : 'H';
        N0.out[N0.pass ? 'F' : 'H'] = f; N1.in[N1.pass ? 'F' : 'H'] = f;
        N1.out[N1.pass ? 'B' : 'H'] = b; N0.in[N0.pass ? 'B' : 'H'] = b;
        road.fwd.push(f); road.bwd.push(b);
      }
      this.hillRoads.push(road);
      const mid = road.fwd[Math.floor(nseg / 2)], u = mid.len * 0.5, p = this.edgePoint(mid, u, 6.6);
      this.scenic.push({ name: R.lookout, cat: 'scenic', roadside: true, edge: mid, u, x: p.x, z: p.z, kw: 0, address: R.name });
    }
  }

  // Junction geometry. Around each node the streets are sorted by angle; between neighbours the two
  // kerb lines (each street's own width) meet at a corner, rounded off with a kerb return of the
  // narrower street's radius. Each street's paint starts where its kerbs leave the junction (ra / rb).
  // Bends (two streets) get no rounding; dead ends (one street) get a round cul-de-sac.
  computeJunctions() {
    this.junctions = [];
    for (const e of this.edges) { e.rev = Object.values(this.nodes[e.b].out).find((o) => o.b === e.a) || null; e.walk = e.hw + e.sw; }
    for (const n of this.nodes) {
      if (n.pass) continue;
      const outs = Object.values(n.out).map((e) => ({ e, a: Math.atan2(e.sdz, e.sdx) })).sort((p, q) => p.a - q.a);
      const m = outs.length;
      n.sorted = outs.map((o) => o.e);
      n.bend = m === 2; n.bulb = m === 1;
      n.corners = outs.map((o, k) => {
        let phi = m === 1 ? Math.PI * 2 : outs[(k + 1) % m].a - o.a;
        if (phi <= 0) phi += Math.PI * 2;
        return this.cornerGeom(o.e, outs[(k + 1) % m].e, phi, 0, 0);
      });
      n.r = 0;
      outs.forEach((o, k) => {
        const e = o.e, cl = n.corners[(k - 1 + m) % m], cr = n.corners[k];
        e.ra = n.bulb ? Math.sqrt(BULB_R * BULB_R - e.hw * e.hw) : Math.max(cl.uf + cl.t, cr.ue + cr.t, n.bend ? 0.4 : 3);
        n.r = Math.max(n.r, n.bulb ? BULB_R : e.ra);
      });
      const pts = [];
      outs.forEach((o, k) => {
        pts.push(this.edgePoint(o.e, o.e.ra, -o.e.hw), this.edgePoint(o.e, o.e.ra, o.e.hw));
        pts.push(...this.cornerPath(n, k));
      });
      n.jpoly = pts.map((p) => [p.x, p.z]);
      this.junctions.push({ n, pts });
    }
    for (const e of this.edges) {
      const A = this.nodes[e.a], B = this.nodes[e.b];
      if (A.pass) e.ra = 0;
      e.rb = B.pass ? 0 : e.rev.ra;
    }
  }
  // corner between street e (its right kerb) and the next street f anticlockwise (its left kerb), with
  // extra offsets de/df (sidewalks): where the two lines meet (ue along e, uf along f) and the return
  cornerGeom(e, f, phi, de, df) {
    const We = e.hw + de, Wf = f.hw + df, s = Math.sin(phi), c = Math.cos(phi);
    let ue, uf;
    if (Math.abs(s) > 0.2) { ue = (Wf + We * c) / s; uf = (We + Wf * c) / s; }
    else { ue = uf = Math.max(We, Wf) / Math.tan(phi / 2); }
    const fil = phi < 2.75, R = Math.max(0.6, Math.min(e.kerb, f.kerb) - (de + df) * 0.3);
    return { phi, ue, uf, We, Wf, fil, t: fil ? Math.min(R / Math.tan(phi / 2), 8 + (de + df) / 2) : 0 };
  }
  // the kerb around corner k of node n: from street k's right kerb to street k+1's left kerb (walk:
  // the back of the sidewalk instead)
  cornerPath(n, k, walk = false) {
    const m = n.sorted.length, e = n.sorted[k], f = n.sorted[(k + 1) % m];
    if (m === 1) { // all the way round the cul-de-sac
      const Rb = BULB_R + (walk ? e.sw : 0), W = e.hw + (walk ? e.sw : 0), ua = Math.sqrt(Math.max(1, Rb * Rb - W * W));
      const th = Math.atan2(e.sdz, e.sdx), b = Math.atan2(W, ua), out = [];
      for (let i = 0; i <= 28; i++) { const a = th + b + ((Math.PI * 2 - 2 * b) * i) / 28; out.push({ x: n.x + Math.cos(a) * Rb, z: n.z + Math.sin(a) * Rb }); }
      return out;
    }
    const cg = walk ? this.cornerGeom(e, f, n.corners[k].phi, e.sw, f.sw) : n.corners[k];
    if (!cg.fil) return [this.edgePoint(e, cg.ue, cg.We)];
    const A = this.edgePoint(e, cg.ue + cg.t, cg.We), X = this.edgePoint(e, cg.ue, cg.We), B = this.edgePoint(f, cg.uf + cg.t, -cg.Wf);
    const out = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, d = t * t;
      out.push({ x: a * A.x + b * X.x + d * B.x, z: a * A.z + b * X.z + d * B.z });
    }
    return out;
  }

  // Turn options at the end of each street, classified by angle (S, bear l/r, turn L/R, U round a
  // cul-de-sac), and which lane may take which: the painted arrows.
  assignLanes() {
    this.laneMoves = []; this.moveEdge = [];
    for (const e of this.edges) {
      const nb = this.nodes[e.b];
      if (nb.bulb) { this.moveEdge[e.id] = { U: e.rev }; this.laneMoves[e.id] = e.lanes === 2 ? ['U', 'U'] : ['U']; continue; }
      const all = [];
      for (const o of Object.values(nb.out)) {
        if (o.b === e.a) continue;
        const dot = e.dx * o.sdx + e.dz * o.sdz, cross = e.dx * o.sdz - e.dz * o.sdx, a = Math.atan2(cross, dot);
        if (Math.abs(a) < 2.5) all.push({ o, a });
      }
      // hairpins sharper than ~126° aren't allowed unless there's no other way out
      const easy = all.filter((c) => Math.abs(c.a) < 2.2), cands = easy.length ? easy : all;
      const mv = {};
      cands.sort((p, q) => Math.abs(p.a) - Math.abs(q.a));
      if (cands.length && Math.abs(cands[0].a) < 0.5) mv.S = cands.shift().o;
      const lf = cands.filter((c) => c.a < 0).sort((p, q) => p.a - q.a), rt = cands.filter((c) => c.a > 0).sort((p, q) => q.a - p.a);
      if (lf.length === 1) mv[lf[0].a < -1.05 ? 'L' : 'l'] = lf[0].o; else if (lf.length > 1) { mv.L = lf[0].o; mv.l = lf[lf.length - 1].o; }
      if (rt.length === 1) mv[rt[0].a > 1.05 ? 'R' : 'r'] = rt[0].o; else if (rt.length > 1) { mv.R = rt[0].o; mv.r = rt[rt.length - 1].o; }
      this.moveEdge[e.id] = mv;
      if (e.lanes === 1) { this.laneMoves[e.id] = [Object.keys(mv).join('') || 'S']; continue; }
      const L = !!(mv.L || mv.l), Sx = !!mv.S, R = !!(mv.R || mv.r), r = this.rand(), big = Object.keys(nb.out).length >= 4;
      let l0 = '', l1 = '';
      if (mv.L) l0 += 'L';
      if (mv.l) l0 += 'l';
      if (mv.R) l1 += 'R';
      if (mv.r) l1 += 'r';
      if (Sx) {
        if (L && R && big && r < 0.22) l0 += 'S';
        else if (L && R && big && r < 0.38) l1 = 'S' + l1;
        else { l0 += 'S'; l1 = 'S' + l1; }
      }
      if (!l0) l0 = l1;
      if (!l1) l1 = l0;
      this.laneMoves[e.id] = [l0, l1];
    }
  }
  moveOf(e, next) {
    for (const [m, o] of Object.entries(this.moveEdge[e.id])) if (o === next) return m;
    return 'S';
  }
  // Who stops where. Arterial crossings get signals; a side street meeting an arterial (or the stem of a
  // residential T) gets a stop sign while the through road keeps going; residential crossroads are
  // all-way stops; bends and cul-de-sacs are uncontrolled. Opposing approaches share signal phases.
  assignControls() {
    for (const e of this.edges) { e.ctl = 'none'; e.phase = 0; e.opp = null; }
    for (const n of this.nodes) {
      n.light = false;
      if (n.pass || n.bend || n.bulb) continue;
      const ins = Object.values(n.in), major = (e) => e.cls !== 'loc';
      const nMaj = ins.filter(major).length;
      // opposing approach pairs (straight through each other)
      const pairs = [];
      for (let i = 0; i < ins.length; i++) for (let j = i + 1; j < ins.length; j++) { const d = ins[i].dx * ins[j].dx + ins[i].dz * ins[j].dz; if (d < -0.6) pairs.push([d, i, j]); }
      pairs.sort((p, q) => p[0] - q[0]);
      const used = new Set(), pr = [];
      for (const [, i, j] of pairs) if (!used.has(i) && !used.has(j)) { used.add(i); used.add(j); pr.push([i, j]); ins[i].opp = ins[j]; ins[j].opp = ins[i]; }
      if (nMaj >= 3) {
        n.light = true;
        let ph = 0;
        for (const [i, j] of pr) { ins[i].phase = ins[j].phase = ph++; }
        ins.forEach((e, i) => { if (!used.has(i)) e.phase = ph++; });
        n.phases = Math.max(2, ph);
        for (const e of ins) e.ctl = 'light';
      } else if (nMaj >= 1) {
        for (const e of ins) e.ctl = major(e) ? 'none' : 'stop2';
      } else if (ins.length >= 4 || !pr.length) {
        for (const e of ins) e.ctl = 'stop4';
      } else {
        const [i, j] = pr[0];
        ins.forEach((e, q) => { e.ctl = q === i || q === j ? 'none' : 'stop2'; });
      }
    }
    // stop line / crosswalk zones (4.2 m) only where traffic has to stop
    for (const e of this.edges) e.zb = e.ctl === 'none' ? 0 : 3.9;
    for (const e of this.edges) {
      const A = this.nodes[e.a], B = this.nodes[e.b];
      e.sa = A.pass ? STOP : e.ra + (e.rev ? e.rev.zb : 0);
      e.sb = B.pass ? STOP : e.rb + e.zb;
    }
  }
  lightState(node, phase, t = this.simT) {
    const P = node.phases || 2, q = (((t + node.offset) % (P * 16)) + P * 16) % (P * 16), p = q - (phase || 0) * 16;
    // 11 s green, 3 s yellow, then 2 s all-red so the junction clears before the next phase
    return p >= 0 && p < 11 ? 'G' : p >= 11 && p < 14 ? 'Y' : 'R';
  }

  // ---------- river ----------
  buildRiverIndex() {
    const P = this.riverPts;
    this.rCum = [0];
    for (let i = 1; i < P.length; i++) this.rCum.push(this.rCum[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z));
    this.rHash = new Map();
    for (let i = 0; i < P.length - 1; i++) {
      const k = Math.floor((P[i].x + P[i + 1].x) / 100) * 100000 + Math.floor((P[i].z + P[i + 1].z) / 100);
      if (!this.rHash.has(k)) this.rHash.set(k, []);
      this.rHash.get(k).push(i);
    }
  }
  // signed lateral offset d from the river centre line (normal (-tz, tx)), |d|, and distance s along it
  riverInfo(x, z, needSign = false) {
    const P = this.riverPts, kx = Math.floor(x / 50), kz = Math.floor(z / 50);
    let best = 1e18, bi = -1;
    const test = (i) => {
      const A = P[i], B = P[i + 1], sx = B.x - A.x, sz = B.z - A.z, L2 = sx * sx + sz * sz;
      let t = ((x - A.x) * sx + (z - A.z) * sz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = (A.x + sx * t - x) ** 2 + (A.z + sz * t - z) ** 2;
      if (d < best) { best = d; bi = i; }
    };
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = this.rHash.get((kx + a) * 100000 + kz + b); if (l) for (const i of l) test(i); }
    if (bi < 0) { if (!needSign) return FAR; for (let i = 0; i < P.length - 1; i++) test(i); }
    const A = P[bi], B = P[bi + 1], L = Math.hypot(B.x - A.x, B.z - A.z), tx = (B.x - A.x) / L, tz = (B.z - A.z) / L;
    const px = x - A.x, pz = z - A.z;
    return { d: -px * tz + pz * tx, ad: Math.sqrt(best), s: this.rCum[bi] + clamp(px * tx + pz * tz, 0, L), tx, tz };
  }
  riverAbs(x, z) { return this.riverInfo(x, z).ad; }
  riverDist(x, z) { return this.riverInfo(x, z).ad; }
  riverAt(s, off) {
    const P = this.riverPts, C = this.rCum;
    let lo = 0, hi = C.length - 1;
    s = clamp(s, 0, C[hi]);
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (C[m] < s) lo = m; else hi = m; }
    const L = C[hi] - C[lo] || 1, t = (s - C[lo]) / L, tx = (P[hi].x - P[lo].x) / L, tz = (P[hi].z - P[lo].z) / L;
    return [P[lo].x + (P[hi].x - P[lo].x) * t - tz * off, P[lo].z + (P[hi].z - P[lo].z) * t + tx * off];
  }
  // Remove the river channel |d| < H from a polygon: the pieces left on either bank, closed along the quay.
  cutRiver(poly, H = RIVER_HALF) {
    let near = false;
    for (const p of poly) if (this.riverInfo(p[0], p[1]).ad < H + 120) { near = true; break; }
    if (!near) return { pieces: [poly], cut: false };
    const dense = densify(poly, 2), info = dense.map((p) => this.riverInfo(p[0], p[1], true));
    if (info.every((q) => q.ad > H + 0.5)) return { pieces: [poly], cut: false };
    const n = dense.length, pieces = [];
    for (const side of [1, -1]) {
      const ins = info.map((q) => side * q.d > H);
      if (!ins.some(Boolean)) continue;
      if (ins.every(Boolean)) { pieces.push(dense); continue; }
      const cross = (i, j) => {
        const t = (side * H - info[i].d * side) / (side * (info[j].d - info[i].d));
        return { p: [dense[i][0] + (dense[j][0] - dense[i][0]) * t, dense[i][1] + (dense[j][1] - dense[i][1]) * t], s: info[i].s + (info[j].s - info[i].s) * t };
      };
      for (let i0 = 0; i0 < n; i0++) {
        if (!ins[i0] || ins[(i0 - 1 + n) % n]) continue;
        const run = []; let i = i0;
        while (ins[i] && run.length < n) { run.push(dense[i]); i = (i + 1) % n; }
        const a = cross((i0 - 1 + n) % n, i0), b = cross((i - 1 + n) % n, i);
        const piece = [a.p, ...run, b.p], steps = Math.max(1, Math.ceil(Math.abs(a.s - b.s) / 3));
        for (let k = 1; k < steps; k++) piece.push(this.riverAt(b.s + ((a.s - b.s) * k) / steps, side * H));
        if (Math.abs(polyArea(piece)) > 30) pieces.push(piece);
      }
    }
    return { pieces, cut: true };
  }
  // A bridge deck under every stretch of street that passes over the water (with margin for the
  // quays); a pier where the street crosses the centre line.
  findBridges() {
    this.bridges = [];
    for (const e of this.edges) {
      if (e.curve || e.a > e.b) continue;
      const reach = RIVER_HALF + e.hw + 6;
      let u0 = null, u1 = null, uc = null, prev = null;
      for (let u = 0; u <= e.len + 1e-6; u += 1) {
        const p = this.edgePoint(e, u, 0), q = this.riverInfo(p.x, p.z);
        if (q.ad < reach) { if (u0 === null) u0 = u; u1 = u; }
        if (prev && q.ad < 60 && prev.ad < 60 && Math.sign(q.d) !== Math.sign(prev.d)) uc = u - 0.5;
        prev = q;
      }
      if (u0 === null) continue;
      u0 = Math.max(0, u0 - 1); u1 = Math.min(e.len, u1 + 1);
      const c = this.edgePoint(e, uc ?? (u0 + u1) / 2, 0), ri = this.riverInfo(c.x, c.z, true);
      this.bridges.push({ e, u0, u1, uc, tx: ri.tx, tz: ri.tz });
      e.bridge = { u0, u1 }; e.rev.bridge = { u0: e.len - u1, u1: e.len - u0 };
    }
  }

  // ---------- blocks (the faces of the street graph) ----------
  buildFaces() {
    const seen = new Uint8Array(this.edges.length), faces = [];
    for (const e0 of this.edges) {
      if (e0.curve || seen[e0.id]) continue;
      const cyc = []; let g = e0;
      for (let guard = 0; guard < 20000; guard++) {
        seen[g.id] = 1; cyc.push(g);
        const b = this.nodes[g.b], m = b.sorted.length, k = b.sorted.indexOf(g.rev);
        let nx = b.sorted[(k - 1 + m) % m];
        if (nx.curve) nx = b.sorted[(k - 2 + m) % m]; // a hill road: only on the outside of the city
        g = nx;
        if (g === e0) break;
      }
      let area = 0;
      for (const q of cyc) area += q.ax * q.bz - q.bx * q.az;
      faces.push({ cyc, area: area / 2 });
    }
    let oi = 0;
    faces.forEach((f, i) => { if (Math.abs(f.area) > Math.abs(faces[oi].area)) oi = i; });
    const outer = faces[oi], sg = Math.sign(outer.area);
    this.ring = outer.cyc.map((g) => [g.ax, g.az]);
    this.faces = faces.filter((f) => f !== outer && Math.sign(f.area) !== sg);
    for (const f of this.faces) {
      for (const g of f.cyc) g.face = f;
      const ns = f.cyc.map((g) => this.nodes[g.a]);
      f.gx = ns.reduce((s, n) => s + n.gx, 0) / ns.length; f.gz = ns.reduce((s, n) => s + n.gz, 0) / ns.length;
      f.cx = ns.reduce((s, n) => s + n.x, 0) / ns.length; f.cz = ns.reduce((s, n) => s + n.z, 0) / ns.length;
      const slab = this.facePolygon(f, false), inner = this.facePolygon(f, true);
      const cs = this.cutRiver(slab), ci = this.cutRiver(inner);
      f.slabPieces = cs.pieces; f.innerPieces = ci.pieces; f.cut = cs.cut;
      f.area = Math.abs(polyArea(inner));
    }
    // the city limits (terrain stays flat inside): the outer ring road pushed out by 26 m
    const P = this.ring, n = P.length, out = [];
    for (let i = 0; i < n; i++) {
      const a = P[(i - 1 + n) % n], b = P[(i + 1) % n];
      let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz); tx /= l; tz /= l;
      let nx = tz, nz = -tx;
      if (pointInPoly(P[i][0] + nx * 2, P[i][1] + nz * 2, P)) { nx = -nx; nz = -nz; }
      out.push({ x: P[i][0] + nx * 26, z: P[i][1] + nz * 26 });
    }
    this.cityPoly = out;
  }
  facePolygon(f, walk) {
    const pts = [];
    for (const g of f.cyc) { const a = this.nodes[g.a]; pts.push(...this.cornerPath(a, a.sorted.indexOf(g), walk).reverse()); }
    return pts.map((p) => [p.x, p.z]);
  }

  // ---------- spatial queries ----------
  buildIndex() {
    this.eHash = new Map();
    for (const e of this.edges) {
      for (let u = -10; u <= e.len + 10; u += 6) {
        const p = this.edgePoint(e, u, 0);
        for (const ox of [-14, 0, 14]) for (const oz of [-14, 0, 14]) {
          const k = Math.floor((p.x + ox) / 40) * 100000 + Math.floor((p.z + oz) / 40);
          let l = this.eHash.get(k);
          if (!l) this.eHash.set(k, (l = []));
          if (!l.includes(e)) l.push(e);
        }
      }
    }
  }
  edgesNear(x, z) { return this.eHash.get(Math.floor(x / 40) * 100000 + Math.floor(z / 40)) || []; }
  // Is (x,z) on a street, junction or bridge deck?
  onRoad(x, z, pad = 0) {
    const near = this.edgesNear(x, z);
    for (const e of near) {
      const { u, w } = this.edgeLocal(e, x, z);
      if (u > -1 && u < e.len + 1 && Math.abs(w) < e.hw + pad) return true;
    }
    for (const e of near) {
      const n = this.nodes[e.a];
      if (n.jpoly && (x - n.x) ** 2 + (z - n.z) ** 2 < (n.r + 4) ** 2 && pointInPoly(x, z, n.jpoly)) return true;
    }
    return false;
  }
  inCity(x, z) { return this.terrain.cityDist(x, z) < -10; }
  cellOf(x, z) { return [Math.floor((x - nodeCoord(0)) / S), Math.floor((z - nodeCoord(0)) / S)]; }
  addToGrid(grid, o) {
    const [a0, b0] = this.cellOf(o.minx, o.minz), [a1, b1] = this.cellOf(o.maxx, o.maxz);
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) {
      const k = a * 1000 + b;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(o);
    }
  }
  // oriented box obstacle: centre, half sizes along its local x / z axes, rotated by yaw (three.js rotation.y)
  addOBB(x, z, hx, hz, yaw, h, occ = true) {
    const c = Math.cos(yaw), s = Math.sin(yaw), ex = Math.abs(c) * hx + Math.abs(s) * hz, ez = Math.abs(s) * hx + Math.abs(c) * hz;
    const o = { type: 'box', x, z, hx, hz, ax: [c, -s], ay: [s, c], h, minx: x - ex, maxx: x + ex, minz: z - ez, maxz: z + ez };
    this.addToGrid(this.obstGrid, o);
    if (occ && h > 2.5) this.addToGrid(this.occGrid, o);
    return o;
  }
  addBox(minx, maxx, minz, maxz, h, occ = true) { return this.addOBB((minx + maxx) / 2, (minz + maxz) / 2, (maxx - minx) / 2, (maxz - minz) / 2, 0, h, occ); }
  addCircle(x, z, r) { this.addToGrid(this.obstGrid, { type: 'circle', x, z, r, minx: x - r, maxx: x + r, minz: z - r, maxz: z + r }); }
  queryObstacles(x, z) {
    const [a, b] = this.cellOf(x, z), out = new Set();
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const l = this.obstGrid.get((a + i) * 1000 + b + j);
      if (l) for (const o of l) out.add(o);
    }
    return out;
  }
  // closest point of a box obstacle to (x,z)
  closestOnBox(o, x, z) {
    const dx = x - o.x, dz = z - o.z;
    const lx = clamp(dx * o.ax[0] + dz * o.ax[1], -o.hx, o.hx), lz = clamp(dx * o.ay[0] + dz * o.ay[1], -o.hz, o.hz);
    return [o.x + o.ax[0] * lx + o.ay[0] * lz, o.z + o.ax[1] * lx + o.ay[1] * lz];
  }
  // Line of sight test against building volumes (used by the camera-based vision system)
  segmentBlocked(x0, z0, x1, z1) {
    const [a0, b0] = this.cellOf(Math.min(x0, x1), Math.min(z0, z1)), [a1, b1] = this.cellOf(Math.max(x0, x1), Math.max(z0, z1));
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) {
      const l = this.occGrid.get(a * 1000 + b);
      if (!l) continue;
      for (const o of l) {
        const px = x0 - o.x, pz = z0 - o.z, qx = x1 - o.x, qz = z1 - o.z;
        const sx = px * o.ax[0] + pz * o.ax[1], sz = px * o.ay[0] + pz * o.ay[1];
        const dx = qx * o.ax[0] + qz * o.ax[1] - sx, dz = qx * o.ay[0] + qz * o.ay[1] - sz;
        let t0 = 0, t1 = 1;
        if (Math.abs(dx) < 1e-6) { if (sx < -o.hx || sx > o.hx) continue; }
        else { let ta = (-o.hx - sx) / dx, tb = (o.hx - sx) / dx; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); }
        if (Math.abs(dz) < 1e-6) { if (sz < -o.hz || sz > o.hz) continue; }
        else { let ta = (-o.hz - sz) / dz, tb = (o.hz - sz) / dz; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); }
        if (t0 <= t1) return true;
      }
    }
    return false;
  }
  // how far (0..1) a segment from (x0,y0,z0) to (x1,y1,z1) gets before it goes into a building
  segmentHit(x0, y0, z0, x1, y1, z1) {
    const [a0, b0] = this.cellOf(Math.min(x0, x1), Math.min(z0, z1)), [a1, b1] = this.cellOf(Math.max(x0, x1), Math.max(z0, z1));
    let best = 1;
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) {
      const l = this.occGrid.get(a * 1000 + b);
      if (!l) continue;
      for (const o of l) {
        const px = x0 - o.x, pz = z0 - o.z, qx = x1 - o.x, qz = z1 - o.z;
        const sx = px * o.ax[0] + pz * o.ax[1], sz = px * o.ay[0] + pz * o.ay[1];
        const dx = qx * o.ax[0] + qz * o.ax[1] - sx, dz = qx * o.ay[0] + qz * o.ay[1] - sz;
        let t0 = 0, t1 = 1;
        if (Math.abs(dx) < 1e-6) { if (sx < -o.hx || sx > o.hx) continue; }
        else { let ta = (-o.hx - sx) / dx, tb = (o.hx - sx) / dx; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); }
        if (Math.abs(dz) < 1e-6) { if (sz < -o.hz || sz > o.hz) continue; }
        else { let ta = (-o.hz - sz) / dz, tb = (o.hz - sz) / dz; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); }
        if (t0 <= t1 && t0 < best && y0 + (y1 - y0) * t0 < o.h) best = t0;
      }
    }
    return best;
  }
  groundHeight(x, z) {
    if (this.terrain.cityDist(x, z) > -6) return Math.max(0, this.terrain.heightAt(x, z));
    if (this.onRoad(x, z, 0)) return 0;
    if (this.riverAbs(x, z) < RIVER_HALF) return -1.6;
    return pointInPoly(x, z, this.ring) ? 0.15 : 0;
  }
  // nearest directed edge aligned with heading h at (x,z)
  locate(x, z, h, maxW = null) {
    const fx = Math.cos(h), fz = Math.sin(h);
    let best = null, bestScore = 1e9;
    for (const e of this.edgesNear(x, z)) {
      const { u, w } = this.edgeLocal(e, x, z);
      if (u < -8 || u > e.len + 8 || w < -1.5 || w > (maxW ?? e.hw)) continue;
      const [tx, tz] = this.edgeTangent(e, Math.min(e.len, Math.max(0, u)));
      const al = tx * fx + tz * fz;
      if (al < 0.6) continue;
      const score = Math.abs(w - e.hw / 2) + (u < e.sa || u > e.len - e.sb ? 4 : 0) - al * 2;
      if (score < bestScore) { bestScore = score; best = { e, u, w }; }
    }
    return best;
  }

  // ---------- planning ----------
  planBlocks() {
    for (const f of this.faces) {
      const r = Math.hypot(f.cx, f.cz), th = Math.atan2(f.cz, f.cx), rr = r * (1 + 0.16 * Math.sin(3 * th + 1.3));
      f.district = rr < 340 ? 'downtown' : rr < 610 ? 'midtown' : 'suburb';
      f.park = null; f.poi = null;
    }
    this.blocks = this.faces;
    // parks: Central Park where Broadway crosses the river, two neighbourhood parks
    const bwBridge = this.bridges.find((b) => b.e.axis === 'd'), cpAt = bwBridge ? this.edgePoint(bwBridge.e, bwBridge.uc, 0) : { x: 0, z: 0 };
    const byDist = (x, z) => this.faces.slice().sort((a, b) => Math.hypot(a.cx - x, a.cz - z) - Math.hypot(b.cx - x, b.cz - z));
    byDist(cpAt.x, cpAt.z).slice(0, 4).forEach((f, k) => { if (k === 0 || Math.hypot(f.cx - cpAt.x, f.cz - cpAt.z) < 150) f.park = 'Central Park'; });
    for (const [name, x, z] of [['Riverside Park', -600, 560], ['Lakeview Park', 560, -640]]) {
      const f = byDist(x, z).find((q) => !q.park && !q.cut);
      if (f) f.park = name;
    }
    const inInner = (f, p) => f.innerPieces.some((pc) => pointInPoly(p.x, p.z, pc));
    const lotFits = (e) => {
      for (const u of [24, 57, 90]) for (const w of [WALK + 0.5, 22, 34]) {
        const p = this.edgePoint(e, u, w);
        if (!inInner(e.face, p) || this.riverAbs(p.x, p.z) < RIVER_HALF + 4) return false;
      }
      return true;
    };
    const R2 = rng(31);
    for (const [name, cat, bi, bj, side, kw] of POIS) {
      let gx = nodeCoord(bi) + S / 2, gz = nodeCoord(bj) + S / 2;
      if (side === 'N') gz -= S / 2; else if (side === 'S') gz += S / 2; else if (side === 'W') gx -= S / 2; else gx += S / 2;
      const [tx, tz] = this.warp(gx, gz);
      let e = null, bs = 1e18;
      for (const c of this.edges) {
        if (c.curve || c.axis === 'd' || c.lanes !== 2 || !c.face || c.face.poi || c.face.park || c.bridge) continue;
        if (c.sa > 30 || c.len - c.sb < 92) continue;
        const m = this.edgePoint(c, 57, 20), d = (m.x - tx) ** 2 + (m.z - tz) ** 2;
        if (d >= bs || !lotFits(c)) continue;
        bs = d; e = c;
      }
      if (!e) continue;
      const block = e.face, lot = this.makeLot(e, cat === 'charger');
      const entryPt = this.edgePoint(e, lot.du, 5.4);
      const num = 100 + (e.chainPos || 0) * 100 + 2 * Math.round(R2() * 24);
      const poi = { id: this.pois.length, name, cat, kw: kw || 0, block, edge: e, lot, x: entryPt.x, z: entryPt.z, address: `${num} ${e.name}` };
      lot.poi = poi;
      block.poi = poi;
      this.pois.push(poi);
      this.lots.push(lot);
    }
    this.planStores(inInner);
    // Central Park: pull over at the kerb on its longest street without a bridge
    let cp = null;
    for (const f of this.faces) if (f.park === 'Central Park') for (const g of f.cyc) if (g.axis !== 'd' && !g.bridge && !this.nodes[g.b].bulb && (!cp || g.len - g.sa - g.sb > cp.len - cp.sa - cp.sb)) cp = g;
    if (cp) { const u = (cp.sa + cp.len - cp.sb) / 2, pw = cp.hw - 1.4, p = this.edgePoint(cp, u, pw); this.scenic.push({ name: 'Central Park', cat: 'park', roadside: true, pullW: pw, edge: cp, u, x: p.x, z: p.z, kw: 0, address: `${cp.name} at Central Park` }); }
    if (this.diagEdges.some((d) => !d.bridge && d.len - d.sb - d.sa > 40)) {
      const ok = this.diagEdges.filter((d) => !d.bridge && d.len - d.sb - d.sa > 40);
      const e = ok.reduce((b, d) => (Math.hypot((d.ax + d.bx) / 2 + 330, (d.az + d.bz) / 2 - 330) < Math.hypot((b.ax + b.bx) / 2 + 330, (b.az + b.bz) / 2 - 330) ? d : b));
      const u = (e.sa + e.len - e.sb) / 2, p = this.edgePoint(e, u, 6.2);
      this.scenic.push({ name: 'Broadway Theater District', cat: 'food', roadside: true, pullW: 6.2, edge: e, u, x: p.x, z: p.z, kw: 0, address: 'Broadway' });
    }
    {
      const [tx, tz] = this.warp(260, 130);
      let best = null, bd = 1e18;
      for (const b of this.bridges) for (const [e, u0] of [[b.e, b.u0], [b.e.rev, b.e.len - b.u1]]) {
        if (e.axis === 'd' || u0 - e.sa < 34) continue;
        const p = this.edgePoint(e, u0 - 12, e.hw - 1.4), d = (p.x - tx) ** 2 + (p.z - tz) ** 2;
        if (d < bd) { bd = d; best = { e, u: u0 - 12, p }; }
      }
      if (best) this.scenic.push({ name: 'Riverwalk Promenade', cat: 'park', roadside: true, pullW: best.e.hw - 1.4, edge: best.e, u: best.u, x: best.p.x, z: best.p.z, kw: 0, address: `${best.e.name} at the river` });
    }
    for (const s of this.scenic) { s.id = this.pois.length; this.pois.push(s); }
  }

  makeLot(e, charger) {
    const lp = (u, w) => this.edgePoint(e, u, w);
    const stalls = [];
    // Driveway at u=36; aisle centre at w=18.6; stall mouths at w=24.1; back-in rear axle at w=28.6.
    // wm/n/aw describe any stall generically: mouth line, which way (±w) the stall runs, its aisle centre
    for (let k = 0; k < 11; k++) {
      const u = 48 + k * 2.9;
      stalls.push({ k, u, wm: 24.1, n: 1, aw: 18.6, F: lp(u, 28.6), Q: lp(u, 24.1), P1: lp(u + 5.5, 18.6), h: e.h - Math.PI / 2, occupied: false, charger });
    }
    // drivable aisles (local u, w): driveway mouth -> aisle, aisle runs past the stalls
    const aisles = { nodes: [[36, WALK], [36, 18.6], [31, 18.6], [83, 18.6]], links: [[0, 1], [1, 2], [1, 3]] };
    return { edge: e, du: 36, stalls, charger, lp, aisles, gates: [0], bounds: [29, 85, WALK, 31.5] };
  }

  // Big-box stores: a 96 m lot with four rows of stalls on two aisles, cross aisles at both ends, two
  // driveways, and the store behind a walkway. Only main roads with room in the block get one.
  planStores(inInner) {
    const L = 96, names = ['Northwoods Outfitters', 'Valley Fresh Supermarket', 'Fox River Home & Garden', 'Lakeshore Supercenter', 'Cedar Crossing Market'];
    const lotC = this.lots.map((l) => this.edgePoint(l.edge, 57, 25));
    const cands = [];
    for (const e of this.edges) {
      if (e.curve || e.lanes !== 2 || !e.face || e.face.park || e.bridge) continue;
      const W0 = e.walk;
      for (let u0 = e.sa + 6; u0 + L <= e.len - e.sb - 6; u0 += 6) {
        let D = 0;
        for (const d of [70, 64]) {
          let ok = true;
          for (let a = 0; a <= 12 && ok; a++) for (let b = 0; b <= 9 && ok; b++) {
            const p = this.edgePoint(e, u0 + (L * a) / 12, W0 + 0.5 + ((d - 0.5) * b) / 9);
            if (!inInner(e.face, p) || this.riverAbs(p.x, p.z) < RIVER_HALF + 8) ok = false;
          }
          if (ok) { D = d; break; }
        }
        if (!D) continue;
        const c = this.edgePoint(e, u0 + L / 2, W0 + D / 2);
        if (lotC.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < 105)) continue;
        cands.push({ e, u0, D, c }); break;
      }
    }
    // spread out, nearest-to-home first so one is handy
    const home = this.pois.find((p) => p.name === 'Home') || { x: 0, z: 0 };
    cands.sort((a, b) => Math.hypot(a.c.x - home.x, a.c.z - home.z) - Math.hypot(b.c.x - home.x, b.c.z - home.z));
    const chosen = [];
    for (const c of cands) {
      if (chosen.length >= names.length) break;
      if (chosen.some((o) => Math.hypot(o.c.x - c.c.x, o.c.z - c.c.z) < 330 || o.e.face === c.e.face && Math.hypot(o.c.x - c.c.x, o.c.z - c.c.z) < 140)) continue;
      chosen.push(c);
    }
    const R2 = rng(77);
    chosen.forEach((c, i) => {
      const lot = this.makeBigLot(c.e, c.u0, c.D);
      const e = c.e, entry = this.edgePoint(e, lot.du, 5.4);
      const num = 200 + (e.chainPos || 0) * 100 + 2 * Math.round(R2() * 30);
      const poi = { id: this.pois.length, name: names[i], cat: 'shopping', kw: 0, block: e.face, edge: e, lot, x: entry.x, z: entry.z, address: `${num} ${e.name}`, store: true };
      lot.poi = poi;
      (e.face.stores ||= []).push(poi);
      this.pois.push(poi);
      this.lots.push(lot);
      lotC.push(c.c);
    });
  }
  makeBigLot(e, u0, D) {
    const lp = (u, w) => this.edgePoint(e, u, w);
    const W0 = e.walk, L = 96, uL = u0 + 3.5, uR = u0 + L - 3.5;
    const a1 = W0 + 10, a2 = W0 + 28;
    // rows: [mouth w, direction the stall runs from its mouth, aisle centre]
    const rows = [[W0 + 6.5, -1, a1], [W0 + 13.5, 1, a1], [W0 + 24.5, -1, a2], [W0 + 31.5, 1, a2]];
    const stalls = [];
    rows.forEach(([wm, n, aw], row) => {
      for (let k = 0; k < 28; k++) {
        const u = u0 + 7 + 1.45 + k * 2.9;
        const c = lp(u, wm + n * 2.75), hIn = Math.atan2(e.rz * n, e.rx * n);
        stalls.push({ k: stalls.length, row, u, wm, n, aw, cx: c.x, cz: c.z, hIn, h: hIn, occupied: false, charger: false });
      }
    });
    // aisles 1 and 2 between the rows, the fire lane along the store front, cross aisles at both ends
    const a3 = W0 + 40.5;
    const aisles = {
      nodes: [[uL, W0], [uL, a1], [uL, a2], [uR, W0], [uR, a1], [uR, a2], [uL, a3], [uR, a3]],
      links: [[0, 1], [1, 2], [1, 4], [2, 5], [4, 5], [3, 4], [2, 6], [6, 7], [5, 7]],
    };
    return { big: true, edge: e, u0, L, D, du: uL, du2: uR, W0, a1, a2, a3, stalls, charger: false, lp, aisles, gates: [0, 3], bounds: [u0, u0 + L, W0, W0 + 44] };
  }

  // ---------- geometry ----------
  buildGround() {
    this.grassTex = TX.grassTextures();
    const d = TX.detailTextures();
    this.terrain.addToScene(this.scene, d.map, d.normalMap);
  }

  buildRoads() {
    const mid = TX.roadMidTextures(), end = TX.roadEndTextures(), box = TX.asphaltTextures(61);
    const lmid = TX.localMidTextures(), lend = TX.localEndTextures();
    this.asphalt = box; this.roadTex = { mid, end };
    const geo = () => ({ p: [], uv: [], idx: [] });
    const G1 = geo(), G2 = geo(), G3 = geo(), L1 = geo(), L2 = geo();
    const quad = (g, pts, uvs) => {
      const b = g.p.length / 3;
      for (let i = 0; i < 4; i++) { g.p.push(pts[i].x, 0, pts[i].z); g.uv.push(uvs[i][0], uvs[i][1]); }
      // ensure upward facing
      const ax = pts[1].x - pts[0].x, az = pts[1].z - pts[0].z, bx = pts[2].x - pts[0].x, bz = pts[2].z - pts[0].z;
      const ny = az * bx - ax * bz;
      if (ny > 0) g.idx.push(b, b + 1, b + 2, b, b + 2, b + 3); else g.idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    };
    const boxUV = (pts) => pts.map((p) => [p.x / 8, p.z / 8]);
    for (const e of this.edges) {
      if (e.curve || e.a > e.b) continue;
      const P = (u, w) => this.edgePoint(e, u, w), W = e.hw, loc = e.lanes === 1, gm = loc ? L1 : G1, ge = loc ? L2 : G2, vr = loc ? 16 : 12;
      // at bends the strips run on through the node so neighbouring pieces overlap instead of leaving a seam
      const bA = this.nodes[e.a].bend, bB = this.nodes[e.b].bend;
      const zA = e.ra, zB = e.len - e.rb, u0 = bA ? -0.35 : e.sa + (e.rev.zb ? 0.3 : 0), u1 = bB ? e.len + 0.35 : e.len - e.sb - (e.zb ? 0.3 : 0);
      quad(gm, [P(u0, -W), P(u1, -W), P(u1, W), P(u0, W)], [[0, 0], [0, (u1 - u0) / vr], [1, (u1 - u0) / vr], [1, 0]]);
      // B end (stop line for +d traffic) and A end (stop line for -d traffic, texture rotated 180)
      if (e.zb) quad(ge, [P(u1, -W), P(zB, -W), P(zB, W), P(u1, W)], [[0, 1], [0, 0], [1, 0], [1, 1]]);
      if (e.rev.zb) quad(ge, [P(zA, -W), P(u0, -W), P(u0, W), P(zA, W)], [[1, 0], [1, 1], [0, 1], [0, 0]]);
    }
    // junctions: a fan around each node out to the kerb returns
    for (const j of this.junctions) {
      const c = { x: j.n.x, z: j.n.z }, pts = j.pts;
      for (let i = 0; i < pts.length; i++) { const tri = [c, pts[i], pts[(i + 1) % pts.length], c]; quad(G3, tri, boxUV(tri)); }
    }
    const mk = (g, tex, rough, lift) => {
      if (!g.p.length) return;
      const bg = new THREE.BufferGeometry();
      for (let i = 1; i < g.p.length; i += 3) g.p[i] += lift; // painted strips sit a hair above plain junction asphalt
      bg.setAttribute('position', new THREE.Float32BufferAttribute(g.p, 3));
      bg.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
      bg.setIndex(g.idx); bg.computeVertexNormals();
      const m = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: rough, metalness: 0 }));
      m.receiveShadow = true;
      this.scene.add(m);
    };
    mk(G1, mid, 0.92, 0.012); mk(G2, end, 0.92, 0.012); mk(G3, box, 0.93, 0);
    mk(L1, lmid, 0.93, 0.008); mk(L2, lend, 0.93, 0.01);

    // lane arrows on two-lane approaches to signals
    const arrowItems = {};
    for (const e of this.edges) {
      if (this.nodes[e.b].pass || e.lanes !== 2 || e.ctl !== 'light') continue;
      const lm = this.laneMoves[e.id], hasS = !!this.moveEdge[e.id].S;
      for (let l = 0; l < 2; l++) {
        const t = lm[l], only = (t === 'L' || t === 'R') && hasS;
        const key = t + (only ? '_ONLY' : '');
        for (const u of [e.len - e.sb - 7, e.len - e.sb - 32]) {
          if (u < e.sa + 6) continue;
          const p = this.edgePoint(e, u, e.laneOff[l]), [tx, tz] = this.edgeTangent(e, u);
          if (!e.curve && this.riverAbs(p.x, p.z) < RIVER_HALF + 18) continue; // not on bridge decks
          (arrowItems[key] ||= []).push({ x: p.x, z: p.z, y: 0.03 + (e.curve ? this.groundHeight(p.x, p.z) + 0.04 : 0), yaw: Math.atan2(-tx, -tz) });
        }
      }
    }
    const ageo = new THREE.PlaneGeometry(1, 1); ageo.rotateX(-Math.PI / 2);
    for (const [key, items] of Object.entries(arrowItems)) {
      const [type, only] = key.split('_');
      const mat = new THREE.MeshStandardMaterial({ map: TX.arrowTexture(type.toUpperCase(), !!only), transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });
      this.scene.add(instanced(ageo, mat, items, (it, d) => { d.position.set(it.x, it.y, it.z); d.rotation.set(0, it.yaw, 0); d.scale.set(1.25, 1, 3.3); }, { shadow: false }));
    }
  }

  // River: animated water surface, bridge decks (with sidewalks, parapets, piers), quay railings.
  buildRiver() {
    const pts = this.riverPts, n = pts.length;
    const pos = [], uv = [], idx = [];
    let s = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      if (i) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      const W = RIVER_HALF + 3;
      pos.push(pts[i].x - tz * W, -1.6, pts[i].z + tx * W, pts[i].x + tz * W, -1.6, pts[i].z - tx * W);
      uv.push(0, s / 30, 1, s / 30);
      if (i) { const k = (i - 1) * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    if (g.attributes.normal.getY(0) < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
    const wn = TX.waterNormalTexture(); wn.repeat.set(2, 1);
    this.waterMat = new THREE.MeshStandardMaterial({ color: 0x1b3640, roughness: 0.06, metalness: 0.35, normalMap: wn, normalScale: new THREE.Vector2(0.35, 0.35) });
    const water = new THREE.Mesh(g, this.waterMat); water.receiveShadow = true;
    this.scene.add(water);

    // bridges wherever a street (or Broadway) crosses the river
    const decks = [], walks = [], parapets = [], piers = [];
    for (const br of this.bridges) {
      const e = br.e, u0 = br.u0, u1 = br.u1, W = e.hw + e.sw;
      const c = this.edgePoint(e, (u0 + u1) / 2, 0), yaw = Math.atan2(-e.dx, -e.dz), L = u1 - u0 + 2.4;
      decks.push({ x: c.x, z: c.z, yaw, L, W: 2 * W + 0.4 });
      for (const sd of [-1, 1]) {
        const p = this.edgePoint(e, (u0 + u1) / 2, sd * (e.hw + e.sw / 2)), q = this.edgePoint(e, (u0 + u1) / 2, sd * (W - 0.05));
        walks.push({ x: p.x, z: p.z, yaw, L, W: e.sw });
        parapets.push({ x: q.x, z: q.z, yaw, L });
      }
      if (br.uc !== null) { const pc = this.edgePoint(e, br.uc, 0); piers.push({ x: pc.x, z: pc.z, yaw: Math.atan2(br.tx, br.tz), s: (2 * W) / 22 }); }
    }
    const box = new THREE.BoxGeometry(1, 1, 1);
    const stone = new THREE.MeshStandardMaterial({ color: 0xb9b2a5, roughness: 0.85 });
    this.scene.add(instanced(box, stone, decks, (b, d) => { d.position.set(b.x, -0.85, b.z); d.rotation.set(0, b.yaw, 0); d.scale.set(b.W, 1.7, b.L); }));
    this.scene.add(instanced(box, new THREE.MeshStandardMaterial({ color: 0xa8a49c, roughness: 0.9 }), walks, (b, d) => { d.position.set(b.x, 0.075, b.z); d.rotation.set(0, b.yaw, 0); d.scale.set(b.W, 0.15, b.L); }));
    this.scene.add(instanced(box, stone, parapets, (b, d) => { d.position.set(b.x, 0.68, b.z); d.rotation.set(0, b.yaw, 0); d.scale.set(0.35, 1.06, b.L); }));
    const pierGeo = new THREE.BoxGeometry(3, 1, 22); pierGeo.translate(0, 0.5, 0);
    // piers are streamlined along the current
    this.scene.add(instanced(pierGeo, stone, piers, (b, d) => { d.position.set(b.x, -4.6, b.z); d.rotation.set(0, b.yaw, 0); d.scale.set(1, 3, b.s); }));

    // wrought-iron railing along both quays (with gaps at the bridges); the car can't drive through it
    const posts = [], rails = [];
    for (const sd of [-1, 1]) {
      let prev = null;
      for (let s2 = 0; s2 <= this.rCum[this.rCum.length - 1]; s2 += 3) {
        const [px, pz] = this.riverAt(s2, sd * (RIVER_HALF - 0.3));
        if (this.terrain.cityDist(px, pz) > -14 || this.onRoad(px, pz, 4.5)) { prev = null; continue; }
        posts.push({ x: px, z: pz });
        this.addCircle(px, pz, 0.3);
        if (prev) rails.push({ a: prev, b: { x: px, z: pz } });
        prev = { x: px, z: pz };
      }
    }
    const iron = new THREE.MeshStandardMaterial({ color: 0x1d1f21, roughness: 0.5, metalness: 0.6 });
    const postGeo = new THREE.BoxGeometry(0.07, 1.05, 0.07); postGeo.translate(0, 0.675, 0);
    this.scene.add(instanced(postGeo, iron, posts, (p, d) => { d.position.set(p.x, 0, p.z); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); }));
    const railGeo = new THREE.BoxGeometry(0.05, 0.06, 1); railGeo.translate(0, 0, 0.5);
    for (const y of [1.17, 0.6]) this.scene.add(instanced(railGeo, iron, rails, (r, d) => { d.position.set(r.a.x, y, r.a.z); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); d.lookAt(r.b.x, y, r.b.z); d.scale.set(1, 1, Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z)); }));
  }

  // Hill roads: draped asphalt with lane paint, gravel shoulders and steel guard rails.
  buildHillRoadMeshes() {
    const acc = () => ({ p: [], uv: [], idx: [] });
    const MID = acc(), END = acc(), SH = acc();
    const posts = [], rails = [];
    const H = (x, z) => Math.max(0, this.terrain.heightAt(x, z));
    const strip = (g, e, u0, u1, w0, w1, uvf) => {
      const steps = Math.max(1, Math.ceil((u1 - u0) / 2));
      const base = g.p.length / 3;
      for (let k = 0; k <= steps; k++) {
        const u = u0 + ((u1 - u0) * k) / steps;
        for (const w of [w0, w1]) {
          const p = this.edgePoint(e, u, w);
          g.p.push(p.x, H(p.x, p.z) + 0.07, p.z);
          g.uv.push(...uvf(u, w));
        }
      }
      for (let k = 0; k < steps; k++) {
        const a = base + k * 2;
        g.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    };
    for (const road of this.hillRoads) {
      road.fwd.forEach((e, k) => {
        const first = k === 0, last = k === road.fwd.length - 1;
        const u0 = first ? e.ra : 0, u1 = last ? e.len - e.rb : e.len;
        const m0 = first ? e.sa + 0.3 : u0, m1 = last ? e.len - e.sb - 0.3 : u1;
        strip(MID, e, m0, m1, -CURB, CURB, (u, w) => [(w + CURB) / (2 * CURB), u / 12]);
        if (first) strip(END, e, u0, m0, -CURB, CURB, (u, w) => [(CURB - w) / (2 * CURB), (u - u0) / 4.2]);
        if (last) strip(END, e, m1, u1, -CURB, CURB, (u, w) => [(w + CURB) / (2 * CURB), (u1 - u) / 4.2]);
        for (const s of [-1, 1]) strip(SH, e, u0 + (first ? 14 : 0), u1 - (last ? 14 : 0), s < 0 ? -10 : CURB, s < 0 ? -CURB : 10, (u, w) => [w / 4, u / 4]);
        // guard rail posts every 4 m
        for (const s of [-1, 1]) {
          let prev = null;
          for (let u = (first ? 30 : 0); u <= (last ? e.len - 30 : e.len); u += 4) {
            const p = this.edgePoint(e, u, s * 10.4), y = H(p.x, p.z);
            posts.push({ x: p.x, y, z: p.z });
            if (prev) rails.push({ a: prev, b: { x: p.x, y, z: p.z } });
            prev = { x: p.x, y, z: p.z };
          }
        }
      });
    }
    const mk = (g, tex, rough) => {
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(g.p, 3));
      bg.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
      bg.setIndex(g.idx); bg.computeVertexNormals();
      // make sure the strips face up
      const nrm = bg.attributes.normal; let up = 0;
      for (let i = 0; i < nrm.count; i += 50) up += nrm.getY(i);
      if (up < 0) { const ix = bg.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } bg.computeVertexNormals(); }
      const m = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: rough, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
      m.receiveShadow = true;
      this.scene.add(m);
    };
    mk(MID, this.roadTex.mid, 0.92); mk(END, this.roadTex.end, 0.92); mk(SH, TX.asphaltTextures(77, [92, 88, 80]), 1);
    const metal = new THREE.MeshStandardMaterial({ color: 0xb4b8bc, metalness: 0.75, roughness: 0.35 });
    const postGeo = new THREE.BoxGeometry(0.12, 0.8, 0.12); postGeo.translate(0, 0.4, 0);
    this.scene.add(instanced(postGeo, metal, posts, (p, d) => { d.position.set(p.x, p.y, p.z); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); }));
    const railGeo = new THREE.BoxGeometry(0.06, 0.3, 1); railGeo.translate(0, 0, 0.5);
    this.scene.add(instanced(railGeo, metal, rails, (r, d) => {
      d.position.set(r.a.x, r.a.y + 0.62, r.a.z); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1);
      d.lookAt(r.b.x, r.b.y + 0.62, r.b.z);
      d.scale.set(1, 1, Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y, r.b.z - r.a.z));
    }));
  }

  buildBlocks() {
    const R = this.rand;
    const conc = TX.concreteTextures();
    const slabMat = worldUV(new THREE.MeshStandardMaterial({ map: conc.map, normalMap: conc.normalMap, roughness: 0.9 }), 1 / 3, 1 / 3);
    const lawnMat = worldUV(new THREE.MeshStandardMaterial({ map: this.grassTex.map, normalMap: this.grassTex.normalMap, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }), 1 / 6, 1 / 6);
    const lotTex = TX.asphaltTextures(64, [50, 51, 54]);
    const lotMat = worldUV(new THREE.MeshStandardMaterial({ map: lotTex.map, normalMap: lotTex.normalMap, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 1 / 8, 1 / 8);
    const lawnPolys = [], lotPlanes = [], stallLines = [], wheelStops = [];
    const bld = { glass: [], office: [], brick: [], dark: [] }, roofBoxes = [];
    const houses = [], roofs = [], driveways = [], trees = [];
    this.trees = trees;
    // local (lx along the building's x, lz along its z) to world for a yawed footprint
    const loc = (x, z, yaw, lx, lz) => ({ x: x + Math.cos(yaw) * lx + Math.sin(yaw) * lz, z: z - Math.sin(yaw) * lx + Math.cos(yaw) * lz });
    const footprint = (x, z, w, d, yaw) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => { const p = loc(x, z, yaw, (a * w) / 2, (b * d) / 2); return [p.x, p.z]; });

    const storefronts = [], cornices = [], waterTowers = [], crowns = [], spires = [];
    // A building is a composition: shop-front ground floor, optional podium, shaft with setbacks,
    // and a top (cornice, water tank, pyramid crown or antenna spire) depending on height and style.
    const addBuilding = (x, z, w, d, h, kind, yaw = 0, simple = false) => {
      const fl = kind === 'brick' ? 3.3 : 3.6;
      h = Math.max(fl * 2, Math.round(h / fl) * fl);
      const c = 0.85 + R() * 0.25;
      this.addOBB(x, z, w / 2, d / 2, yaw, h);
      this.buildings.push({ pts: footprint(x, z, w, d, yaw), h, kind });
      if (!simple) storefronts.push({ x, z, w: w + 0.35, d: d + 0.35, h: 4.6, yaw });
      let topW = w, topD = d, top = h;
      if (h > 48 && !simple) {
        const podKind = kind === 'brick' ? 'brick' : R() < 0.5 ? 'office' : 'brick';
        const ph = (podKind === 'brick' ? 3.3 : 3.6) * (3 + Math.floor(R() * 2));
        bld[podKind].push({ x, z, w, d, h: ph, y: 0, c, yaw });
        cornices.push({ x, z, w: w + 0.7, d: d + 0.7, y: ph, yaw });
        topW = w * (0.78 + R() * 0.1); topD = d * (0.78 + R() * 0.1);
        if (h > 100) {
          const brk = Math.round((h * (0.55 + R() * 0.15)) / fl) * fl;
          bld[kind].push({ x, z, w: topW, d: topD, h: brk, y: 0, c, yaw });
          topW *= 0.72; topD *= 0.72;
          bld[kind].push({ x, z, w: topW, d: topD, h: h - brk, y: brk, c, yaw });
        } else bld[kind].push({ x, z, w: topW, d: topD, h, y: 0, c, yaw });
        const r = R();
        if (kind !== 'brick' && r < 0.4) { const ch = 8 + R() * 14; crowns.push({ x, z, w: topW * 0.96, d: topD * 0.96, y: h, h: ch, yaw }); top = h + ch; }
        else if (r < 0.65) roofBoxes.push({ x, z, w: topW * 0.5, d: topD * 0.5, h: 4 + R() * 4, y: h, yaw });
        if (h > 140 || R() < 0.15) spires.push({ x, z, y: top, h: 18 + R() * 34 });
      } else {
        bld[kind].push({ x, z, w, d, h, y: 0, c, yaw });
        cornices.push({ x, z, w: w + 0.8, d: d + 0.8, y: h - 0.6, yaw });
        if (kind === 'brick' && R() < 0.45) waterTowers.push({ ...loc(x, z, yaw, (R() - 0.5) * w * 0.4, (R() - 0.5) * d * 0.4), y: h });
        else if (R() < 0.8) roofBoxes.push({ ...loc(x, z, yaw, (R() - 0.5) * w * 0.5, (R() - 0.5) * d * 0.5), w: 2 + R() * 4, d: 2 + R() * 4, h: 1.2 + R() * 2.5, y: h, yaw });
      }
      return h;
    };
    const pickKind = (h, dist) => {
      const r = R();
      if (dist === 'downtown' && h > 55) return r < 0.55 ? 'glass' : r < 0.82 ? 'dark' : 'office';
      if (dist === 'downtown') return r < 0.3 ? 'glass' : r < 0.65 ? 'office' : 'brick';
      return r < 0.45 ? 'brick' : r < 0.85 ? 'office' : 'dark';
    };
    const towerHeight = (cx, cz, dist) => {
      const r = Math.hypot(cx, cz);
      if (dist === 'downtown') return 18 + 200 * Math.exp(-((r / 300) ** 2)) * (0.3 + 0.7 * R()) + R() * 18;
      return 10 + R() * 24;
    };
    const addTree = (x, z, s = 1, type = R() < 0.25 ? 1 : 0) => { trees.push({ x, z, y: 0.15, s: s * (0.8 + R() * 0.5), type, c: R() }); this.addCircle(x, z, 0.35); };
    const doors = [], garages = [], porches = [], chimneys = [];
    const sidings = [0xf2efe8, 0xd9d2c3, 0xa9b6c2, 0xb8c2ad, 0xe6dccb, 0x8c97a3, 0xc9b9a6, 0xf5f5f2, 0x6f7d8a, 0x9b8b76];
    // A house: walls, gable or hip roof, chimney, front door with porch roof and an optional garage door.
    // (x,z) centre, w along local x, d along local z, front faces local +z rotated by yaw.
    const addHouse = (x, z, w, d, yaw, y0 = 0) => {
      const two = R() < 0.55, h = two ? 5.8 : 3.2, col = sidings[Math.floor(R() * sidings.length)];
      const base = y0 - (y0 > 0.5 ? 1.5 : 0);
      houses.push({ x, z, w, d, h: h + (y0 - base), y: base, yaw, col });
      const hip = R() < 0.35, rh = hip ? 2.2 + R() : 1.8 + R() * 1.4;
      roofs.push({ x, z, w: w + 0.8, d: d + 0.8, h: rh, y: y0 + h, yaw, hip, col: R() });
      const at = (lx, lz) => loc(x, z, yaw, lx, lz);
      if (R() < 0.6) { const p = at(w * 0.28 * (R() < 0.5 ? -1 : 1), -d * 0.15); chimneys.push({ ...p, y: y0 + h, h: rh + 1.2, yaw }); }
      const garage = w > 9.5 && R() < 0.7, side = R() < 0.5 ? -1 : 1;
      const dp = at(garage ? -side * w * 0.22 : 0, d / 2 + 0.03);
      doors.push({ ...dp, y: y0, yaw });
      porches.push({ ...at(garage ? -side * w * 0.22 : 0, d / 2 + 0.75), y: y0 + 2.6, yaw });
      if (garage) garages.push({ ...at(side * w * 0.25, d / 2 + 0.03), y: y0, yaw });
      this.addOBB(x, z, w / 2, d / 2, yaw, h + 2);
      this.buildings.push({ pts: footprint(x, z, w, d, yaw), h, kind: 'house' });
    };
    const slabGeos = [];
    const shapeOf = (poly) => new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
    const yawAlong = (g) => Math.atan2(-g.dz, g.dx); // local x along the street, local z into the block

    for (const f of this.faces) {
      // raised sidewalk + block; pieces cut by the river drop to the riverbed as stone quay walls
      for (const pc of f.slabPieces) {
        const g = new THREE.ExtrudeGeometry(shapeOf(pc), { depth: f.cut ? 5.15 : 0.15, bevelEnabled: false, curveSegments: 1 });
        g.rotateX(-Math.PI / 2); g.translate(0, f.cut ? -5 : 0, 0);
        slabGeos.push(g.index ? g.toNonIndexed() : g);
      }
      const inner = f.innerPieces, slab = f.slabPieces, placed = [], blocked = new Map();
      const inside = (x, z) => inner.some((pc) => pointInPoly(x, z, pc));
      const fits = (o, m = 0) => oPts(o).every(([x, z]) => inside(x, z) && this.riverAbs(x, z) > RIVER_HALF + 2) && !placed.some((q) => oOverlap(o, q, m));
      const free = (x, z) => inside(x, z) && this.riverAbs(x, z) > RIVER_HALF + 3 && !placed.some((q) => oInside(q, x, z));
      const block = (g, u0, u1) => { if (!blocked.has(g)) blocked.set(g, []); blocked.get(g).push([u0, u1]); };
      const isBlocked = (g, u) => (blocked.get(g) || []).some(([a, b]) => u > a && u < b);
      const randIn = () => {
        let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
        for (const pc of inner) for (const [x, z] of pc) { mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mnz = Math.min(mnz, z); mxz = Math.max(mxz, z); }
        return () => [mnx + R() * (mxx - mnx), mnz + R() * (mxz - mnz)];
      };
      const streetTrees = () => {
        for (const g of f.cyc) for (let u = g.ra + 9; u < g.len - g.rb - 9; u += 19 + R() * 4) {
          if (isBlocked(g, u)) continue;
          const p = this.edgePoint(g, u, g.hw + g.sw / 2);
          if (R() < 0.75 && slab.some((pc) => pointInPoly(p.x, p.z, pc)) && this.riverAbs(p.x, p.z) > RIVER_HALF + 3) addTree(p.x, p.z, 0.9);
        }
      };

      if (f.poi) {
        const poi = f.poi, lot = poi.lot, e = poi.edge, ye = yawAlong(e);
        const rectO = (u0, u1, w0, w1) => { const p = this.edgePoint(e, (u0 + u1) / 2, (w0 + w1) / 2); return mkO(p.x, p.z, (u1 - u0) / 2, (w1 - w0) / 2, ye); };
        const lr = rectO(29, 85, WALK, 31.5), ap = rectO(32, 40, CURB, WALK);
        lotPlanes.push({ x: lr.cx, z: lr.cz, w: 56, d: 31.5 - WALK, yaw: ye }, { x: ap.cx, z: ap.cz, w: 8, d: WALK - CURB, yaw: ye });
        poi.lotPoly = [lot.lp(29, WALK), lot.lp(85, WALK), lot.lp(85, 31.5), lot.lp(29, 31.5)];
        placed.push(rectO(23, 91, WALK - 1, 33.5));
        block(e, 24, 48);
        for (const st of lot.stalls) {
          for (const du of [-1.45, 1.45]) {
            const a = lot.lp(st.u + du, 24.1), c = lot.lp(st.u + du, 29.9);
            stallLines.push({ x: (a.x + c.x) / 2, z: (a.z + c.z) / 2, yaw: Math.atan2(-e.rx, -e.rz), len: 5.8 });
          }
          const ws = lot.lp(st.u, 29.35);
          wheelStops.push({ x: ws.x, z: ws.z, yaw: Math.atan2(-e.rx, -e.rz) });
          if (lot.charger) {
            const cp = lot.lp(st.u - 0.95, 30.4);
            this.chargers.push({ x: cp.x, z: cp.z, yaw: Math.atan2(-e.rx, -e.rz), stall: st, lot });
            this.addCircle(cp.x, cp.z, 0.3);
          }
        }
        // POI building behind the lot, as deep as the block allows
        let o = null, far = f.district === 'suburb' ? 62 : 87;
        for (; far >= 44; far -= 4) { o = rectO(14, 86, 35, far); if (fits(o)) break; o = null; }
        const sp = lot.lp(62, 34.9);
        if (o) {
          let h = f.district === 'downtown' ? towerHeight(o.cx, o.cz, 'downtown') * 0.8 : f.district === 'midtown' ? 12 + R() * 16 : poi.cat === 'charger' ? 5 : 7 + R() * 4;
          if (poi.cat === 'charger' && f.district === 'suburb') h = 4;
          const kind = poi.cat === 'health' || poi.cat === 'civic' ? 'office' : poi.cat === 'shopping' ? 'dark' : pickKind(h, f.district);
          const hh = addBuilding(o.cx, o.cz, 72, far - 35, h, kind, ye);
          placed.push(o);
          poi.sign = { x: sp.x, z: sp.z, yaw: Math.atan2(-e.rx, -e.rz), y: Math.min(hh - 1.5, 6.5) };
        } else poi.sign = { x: sp.x, z: sp.z, yaw: Math.atan2(-e.rx, -e.rz), y: 3.2 };
      }

      // big-box stores: asphalt lot, two driveways, four rows of striped stalls, walkway and the store
      for (const poi of f.stores || []) {
        const lot = poi.lot, e = poi.edge, ye = yawAlong(e), W0 = lot.W0, u0 = lot.u0, L = lot.L;
        const rectO = (a0, a1, b0, b1) => { const p = this.edgePoint(e, (a0 + a1) / 2, (b0 + b1) / 2); return mkO(p.x, p.z, (a1 - a0) / 2, (b1 - b0) / 2, ye); };
        const lr = rectO(u0, u0 + L, W0, W0 + 44);
        lotPlanes.push({ x: lr.cx, z: lr.cz, w: L, d: 44, yaw: ye });
        for (const ug of [lot.du, lot.du2]) { const ap = rectO(ug - 3.6, ug + 3.6, CURB, W0); lotPlanes.push({ x: ap.cx, z: ap.cz, w: 7.2, d: W0 - CURB, yaw: ye }); }
        const ww = rectO(u0 + 6, u0 + L - 6, W0 + 44, W0 + 48);
        driveways.push({ x: ww.cx, z: ww.cz, w: L - 12, d: 4, yaw: ye });
        // the fire lane's kerb line in front of the walkway
        { const a = lot.lp(u0 + 7, W0 + 43.9), b = lot.lp(u0 + L - 7, W0 + 43.9); stallLines.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, yaw: Math.atan2(e.dx, e.dz), len: L - 14 }); }
        placed.push(rectO(u0 - 2, u0 + L + 2, W0 - 1, W0 + lot.D + 1));
        block(e, u0 - 5, u0 + L + 5);
        poi.lotPoly = [lot.lp(u0, W0), lot.lp(u0 + L, W0), lot.lp(u0 + L, W0 + 44), lot.lp(u0, W0 + 44)];
        const lineYaw = Math.atan2(-e.rx, -e.rz);
        for (const st of lot.stalls) {
          for (const du of [-1.45, 1.45]) {
            const a = lot.lp(st.u + du, st.wm), c = lot.lp(st.u + du, st.wm + st.n * 5.5);
            stallLines.push({ x: (a.x + c.x) / 2, z: (a.z + c.z) / 2, yaw: lineYaw, len: 5.5 });
          }
        }
        // landscaped islands with a tree at the ends of the double rows
        for (const uu of [u0 + 6.15, u0 + L - 6.15]) {
          const p = lot.lp(uu, W0 + 19); addTree(p.x, p.z, 0.9);
          const isl = rectO(uu - 0.75, uu + 0.75, W0 + 14.5, W0 + 23.5);
          driveways.push({ x: isl.cx, z: isl.cz, w: 1.5, d: 9, yaw: ye });
        }
        const bd = lot.D - 48, o = rectO(u0 + 8, u0 + L - 8, W0 + 48, W0 + 48 + bd);
        const hh = addBuilding(o.cx, o.cz, L - 16, bd, 8 + R() * 3, R() < 0.5 ? 'brick' : 'office', ye);
        placed.push(o);
        const sp = lot.lp(u0 + L / 2, W0 + 47.85);
        poi.sign = { x: sp.x, z: sp.z, yaw: lineYaw, y: Math.min(hh - 1.4, 6.6) };
      }

      if (f.park) {
        lawnPolys.push(...inner);
        let pond = null;
        if (!f.cut && inner.length) {
          const pc = inner[0], cx = pc.reduce((s, p) => s + p[0], 0) / pc.length, cz = pc.reduce((s, p) => s + p[1], 0) / pc.length;
          const cand = { x: cx + (R() - 0.5) * 10, z: cz + (R() - 0.5) * 8, rx: 16, rz: 11 };
          let ok = true;
          for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; if (!free(cand.x + Math.cos(a) * (cand.rx + 5), cand.z + Math.sin(a) * (cand.rz + 5))) ok = false; }
          if (ok) { pond = cand; this.water.push(pond); }
        }
        const rp = randIn();
        for (let k = 0; k < f.area / 75; k++) {
          const [x, z] = rp();
          if (!free(x, z)) continue;
          if (pond && ((x - pond.x) / (pond.rx + 3)) ** 2 + ((z - pond.z) / (pond.rz + 3)) ** 2 < 1) continue;
          addTree(x, z, 1.15);
        }
        streetTrees();
        continue;
      }

      if (f.district === 'suburb') {
        lawnPolys.push(...inner);
        // houses face the street, set back behind front lawns, with a driveway to the kerb
        for (const g of f.cyc) {
          const yh = Math.atan2(g.dz, -g.dx), ya = yawAlong(g);
          if (g.cls !== 'loc') { // back yards face the arterial: a screen of trees instead of front doors
            for (let u = g.ra + 6; u < g.len - g.rb - 6; u += 9 + R() * 5) { const p = this.edgePoint(g, u, g.walk + 3 + R() * 3); if (free(p.x, p.z)) addTree(p.x, p.z, 1, R() < 0.5 ? 1 : 0); }
            continue;
          }
          let u = 4 + R() * 6;
          while (u < g.len - 4) {
            const fw = 9 + R() * 3.2, fd = 8 + R() * 2.6, set = 5 + R() * 4;
            const p = this.edgePoint(g, u + fw / 2, g.walk + set + fd / 2);
            const o = mkO(p.x, p.z, fw / 2 + 1.6, fd / 2 + 1.6, ya);
            if (!isBlocked(g, u + fw / 2) && fits(o)) {
              addHouse(p.x, p.z, fw, fd, yh, 0.15);
              placed.push(o);
              const du = u + fw / 2 + (R() < 0.5 ? -1 : 1) * fw * 0.25, dw = this.edgePoint(g, du, g.walk + set / 2);
              driveways.push({ x: dw.x, z: dw.z, w: 3.2, d: set, yaw: ya });
              block(g, du - 3, du + 3);
              u += fw + 6 + R() * 7;
            } else u += 4;
          }
        }
        const rp = randIn();
        for (let k = 0; k < f.area / 450; k++) { const [x, z] = rp(); if (free(x, z)) addTree(x, z); }
        streetTrees();
        continue;
      }

      // downtown / midtown: buildings line every street of the block, following its direction
      const dt = f.district === 'downtown';
      for (const g of f.cyc) {
        const ya = yawAlong(g);
        let u = 0;
        while (u < g.len) {
          const bw = dt ? 18 + R() * 18 : 14 + R() * 12;
          let dp = dt ? 24 + R() * 18 : 16 + R() * 14, ok = false;
          while (dp >= 10) {
            const p = this.edgePoint(g, u + bw / 2, g.walk + 1 + dp / 2), o = mkO(p.x, p.z, bw / 2, dp / 2, ya);
            if (fits(o, 1.2)) {
              placed.push(o);
              if (!dt && R() < 0.1) { for (let t = 0; t < 3; t++) { const q = loc(p.x, p.z, ya, (R() - 0.5) * bw * 0.7, (R() - 0.5) * dp * 0.7); addTree(q.x, q.z, 1.1); } }
              else { const h = towerHeight(p.x, p.z, f.district); addBuilding(p.x, p.z, bw, dp, h, pickKind(h, f.district), ya); }
              ok = true; break;
            }
            dp *= 0.75;
          }
          u += ok ? bw + (dt ? 0.8 : 2.5) : 3;
        }
      }
      // a tower in the middle of roomy downtown blocks; courtyard trees in midtown
      if (dt && R() < 0.7) {
        const g = f.cyc.reduce((a, b) => (b.len > a.len ? b : a)), ya = yawAlong(g);
        const pc = inner[0], cx = pc.reduce((s, p) => s + p[0], 0) / pc.length, cz = pc.reduce((s, p) => s + p[1], 0) / pc.length;
        for (let s = 40; s >= 20; s -= 4) {
          const o = mkO(cx, cz, s / 2, s / 2, ya);
          if (fits(o, 2)) { placed.push(o); const h = towerHeight(cx, cz, 'downtown') * 1.35; addBuilding(cx, cz, s, s, h, pickKind(h, 'downtown'), ya); break; }
        }
      }
      if (!dt) { const rp = randIn(); for (let k = 0; k < 8; k++) { const [x, z] = rp(); if (free(x, z)) addTree(x, z, 1.1); } }
      if (!dt) streetTrees();
    }

    // Hilltop homes along the canyon road, facing the road, stepped into the slope
    for (const road of this.hillRoads) {
      if (!road.houses) continue;
      const pts = road.pts;
      let side = 1;
      for (let k = 90; k < pts.length - 90; k += 26) {
        side = -side;
        const a = pts[k - 1], b = pts[k + 1];
        let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz); tx /= l; tz /= l;
        const nx = -tz * side, nz = tx * side, off = 27 + R() * 6;
        const x = pts[k].x + nx * off, z = pts[k].z + nz * off;
        if (this.terrain.slopeAt(x, z) > 0.42 || this.terrain.nearestRoad(x, z)[0] < 20 || this.terrain.cityDist(x, z) < 30) continue;
        const y0 = Math.max(0, this.terrain.heightAt(x, z));
        addHouse(x, z, 10 + R() * 4, 9 + R() * 3, Math.atan2(-nx, -nz), y0);
        for (let t = 0; t < 3; t++) { const tx2 = x + (R() - 0.5) * 30, tz2 = z + (R() - 0.5) * 30; if (this.terrain.nearestRoad(tx2, tz2)[0] > 14 && Math.hypot(tx2 - x, tz2 - z) > 9) trees.push({ x: tx2, z: tz2, y: this.terrain.heightAt(tx2, tz2) - 0.2, s: 1 + R() * 0.4, type: R() < 0.4 ? 1 : 0, c: R() }); }
      }
    }
    // forests on the hills
    for (const t of this.terrain.scatterTrees(16000)) trees.push(t);

    // slabs and lawns
    { const m = new THREE.Mesh(mergeGeometries(slabGeos), slabMat); m.receiveShadow = true; this.scene.add(m); }
    if (lawnPolys.length) {
      const geos = lawnPolys.map((poly) => { const g = new THREE.ShapeGeometry(shapeOf(poly), 1); g.rotateX(-Math.PI / 2); g.translate(0, 0.152, 0); return g.index ? g.toNonIndexed() : g; });
      const m = new THREE.Mesh(mergeGeometries(geos), lawnMat); m.receiveShadow = true; this.scene.add(m);
    }
    const box1 = new THREE.BoxGeometry(1, 1, 1); box1.translate(0, 0.5, 0);
    const plane = new THREE.PlaneGeometry(1, 1); plane.rotateX(-Math.PI / 2);
    const flat = (y) => (b, d) => { d.position.set(b.x, y, b.z); d.rotation.set(0, b.yaw || 0, 0); d.scale.set(b.w, 1, b.d); };
    this.scene.add(instanced(plane, lotMat, lotPlanes, flat(0.155), { shadow: false }));
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.scene.add(instanced(plane, lineMat, stallLines, (s, d) => { d.position.set(s.x, 0.158, s.z); d.rotation.set(0, s.yaw, 0); d.scale.set(0.11, 1, s.len); }, { shadow: false }));
    const dwMat = worldUV(new THREE.MeshStandardMaterial({ map: conc.map, roughness: 0.9, color: 0xdddddd, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 1 / 3, 1 / 3);
    this.scene.add(instanced(plane, dwMat, driveways, flat(0.156), { shadow: false }));
    const wsGeo = new THREE.BoxGeometry(1.8, 0.13, 0.2); wsGeo.translate(0, 0.065 + 0.15, 0);
    this.scene.add(instanced(wsGeo, new THREE.MeshStandardMaterial({ color: 0xb9b6ae, roughness: 0.9 }), wheelStops, (s, d) => { d.position.set(s.x, 0, s.z); d.rotation.set(0, s.yaw, 0); d.scale.set(1, 1, 1); }));

    // buildings
    this.buildingMats = [];
    const fac = { glass: [1 / 24, 1 / 28.8], office: [1 / 21, 1 / 28.8], brick: [1 / 18, 1 / 19.8], dark: [1 / 24, 1 / 28.8] };
    const yawed = (b, d) => { d.position.set(b.x, b.y, b.z); d.rotation.set(0, b.yaw || 0, 0); d.scale.set(b.w, b.h, b.d); };
    let seed = 100;
    for (const [kind, items] of Object.entries(bld)) {
      if (!items.length) continue;
      const t = TX.facadeTextures(kind, seed++);
      const mat = worldUV(new THREE.MeshStandardMaterial({ map: t.map, roughnessMap: t.rm, metalnessMap: t.rm, emissiveMap: t.emissive, emissive: 0xffffff, emissiveIntensity: 0, roughness: 1, metalness: 1 }), fac[kind][0], fac[kind][1], 0x3b3c3e);
      this.buildingMats.push(mat);
      this.scene.add(instanced(box1, mat, items, yawed, { colors: (b) => new THREE.Color(b.c, b.c, b.c) }));
    }
    this.scene.add(instanced(box1, new THREE.MeshStandardMaterial({ color: 0x8a8c8e, roughness: 0.8 }), roofBoxes, yawed));
    const sf = TX.storefrontTextures();
    this.shopMat = worldUV(new THREE.MeshStandardMaterial({ map: sf.map, roughnessMap: sf.rm, metalnessMap: sf.rm, emissiveMap: sf.emissive, emissive: 0xffffff, emissiveIntensity: 0, roughness: 1, metalness: 1 }), 1 / 12, 1 / 4.6, 0x9a958c);
    this.buildingMats.push(this.shopMat);
    this.scene.add(instanced(box1, this.shopMat, storefronts, (b, d) => { d.position.set(b.x, 0, b.z); d.rotation.set(0, b.yaw, 0); d.scale.set(b.w, b.h, b.d); }));
    this.scene.add(instanced(box1, new THREE.MeshStandardMaterial({ color: 0xc4bdb0, roughness: 0.85 }), cornices, (b, d) => { d.position.set(b.x, b.y, b.z); d.rotation.set(0, b.yaw, 0); d.scale.set(b.w, 0.7, b.d); }));
    const pyr = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1); pyr.rotateY(Math.PI / 4); pyr.translate(0, 0.5, 0);
    this.scene.add(instanced(pyr, new THREE.MeshStandardMaterial({ color: 0x2a3a48, roughness: 0.15, metalness: 0.9 }), crowns, yawed));
    const spireGeo = new THREE.CylinderGeometry(0.12, 0.55, 1, 8); spireGeo.translate(0, 0.5, 0);
    this.scene.add(instanced(spireGeo, new THREE.MeshStandardMaterial({ color: 0xa9adb2, roughness: 0.3, metalness: 0.8 }), spires, (b, d) => { d.position.set(b.x, b.y, b.z); d.rotation.set(0, 0, 0); d.scale.set(1, b.h, 1); }));
    this.beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false });
    this.scene.add(instanced(new THREE.SphereGeometry(0.45, 10, 8), this.beaconMat, spires, (b, d) => { d.position.set(b.x, b.y + b.h, b.z); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); }, { shadow: false }));
    // classic wooden rooftop water tanks
    const wt = [];
    const tank = new THREE.CylinderGeometry(2.1, 2.1, 3.4, 16); tank.translate(0, 4.6, 0); wt.push(tank);
    const cap = new THREE.ConeGeometry(2.3, 1.4, 16); cap.translate(0, 7.0, 0); wt.push(cap);
    for (const [lx, lz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) { const leg = new THREE.CylinderGeometry(0.1, 0.12, 2.9, 6); leg.translate(lx, 1.45, lz); wt.push(leg); }
    const wtGeo = mergeGeometries(wt.map((g) => g.index ? g.toNonIndexed() : g));
    this.scene.add(instanced(wtGeo, new THREE.MeshStandardMaterial({ color: 0x6e5038, roughness: 0.9 }), waterTowers, (b, d) => { d.position.set(b.x, b.y, b.z); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); }));

    // houses
    const sid = TX.sidingTextures();
    this.houseMat = worldUV(new THREE.MeshStandardMaterial({ map: sid.map, emissiveMap: sid.emissive, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.85 }), 1 / 5, 1 / 3, 0x444444);
    this.scene.add(instanced(box1, this.houseMat, houses, yawed, { colors: (b) => new THREE.Color(b.col) }));
    const shingle = TX.shingleTexture(); shingle.repeat.set(4, 2);
    const roofMat = new THREE.MeshStandardMaterial({ map: shingle, roughness: 0.9 });
    const roofCol = (r) => new THREE.Color().setHSL(0.07, 0.15, 0.22 + r.col * 0.25);
    this.scene.add(instanced(prismGeometry(), roofMat, roofs.filter((r) => !r.hip), yawed, { colors: roofCol }));
    this.scene.add(instanced(pyr, roofMat, roofs.filter((r) => r.hip), yawed, { colors: roofCol }));
    const chimGeo = new THREE.BoxGeometry(0.75, 1, 0.75); chimGeo.translate(0, 0.5, 0);
    this.scene.add(instanced(chimGeo, new THREE.MeshStandardMaterial({ color: 0x7a4436, roughness: 0.9 }), chimneys, (b, d) => { d.position.set(b.x, b.y, b.z); d.rotation.set(0, b.yaw, 0); d.scale.set(1, b.h, 1); }));
    const doorGeo = new THREE.PlaneGeometry(1.05, 2.15); doorGeo.translate(0, 1.08, 0);
    this.scene.add(instanced(doorGeo, new THREE.MeshStandardMaterial({ map: TX.doorTexture(), roughness: 0.6 }), doors, (b, d) => { d.position.set(b.x, b.y, b.z); d.rotation.set(0, b.yaw, 0); d.scale.set(1, 1, 1); }, { shadow: false }));
    const garGeo = new THREE.PlaneGeometry(2.6, 2.2); garGeo.translate(0, 1.1, 0);
    this.scene.add(instanced(garGeo, new THREE.MeshStandardMaterial({ map: TX.garageTexture(), roughness: 0.55 }), garages, (b, d) => { d.position.set(b.x, b.y, b.z); d.rotation.set(0, b.yaw, 0); d.scale.set(1, 1, 1); }, { shadow: false }));
    const porchGeo = new THREE.BoxGeometry(2.2, 0.14, 1.5);
    this.scene.add(instanced(porchGeo, new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.8 }), porches, (b, d) => { d.position.set(b.x, b.y, b.z); d.rotation.set(0, b.yaw, 0); d.scale.set(1, 1, 1); }));

    // trees: trunks, clustered broadleaf crowns and layered conifers
    const trunk = new THREE.CylinderGeometry(0.12, 0.2, 1, 6); trunk.translate(0, 0.5, 0);
    const pr = rng(5);
    const blobs = [];
    for (const [ox, oy, oz, r] of [[0, 0, 0, 1], [0.55, -0.15, 0.2, 0.72], [-0.5, -0.1, -0.25, 0.75], [0.1, 0.45, -0.1, 0.7], [-0.2, -0.2, 0.55, 0.65]]) {
      const b = new THREE.IcosahedronGeometry(r, 1);
      const p = b.attributes.position;
      for (let i = 0; i < p.count; i++) { const k = 0.85 + pr() * 0.25; p.setXYZ(i, p.getX(i) * k + ox, p.getY(i) * k * 0.9 + oy, p.getZ(i) * k + oz); }
      blobs.push(b);
    }
    const crown = mergeGeometries(blobs); crown.computeVertexNormals();
    const tiers = [];
    for (let k = 0; k < 3; k++) { const c = new THREE.ConeGeometry(1 - k * 0.22, 0.5, 9); c.translate(0, 0.25 + k * 0.27, 0); tiers.push(c.toNonIndexed()); }
    const cone = mergeGeometries(tiers); cone.computeVertexNormals();
    const leaf = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    const ty = (t) => (t.y ?? 0.15);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1 });
    // city trees cast shadows; the thousands of hillside trees don't (they're mostly far away)
    for (const group of [trees.filter((t) => t.y === 0.15), trees.filter((t) => t.y !== 0.15)]) {
      const shadow = group.length && group[0].y === 0.15;
      this.scene.add(instanced(trunk, trunkMat, group, (t, d) => { d.position.set(t.x, ty(t), t.z); d.rotation.set(0, 0, 0); d.scale.set(t.s, (t.type ? 2.2 : 3.2) * t.s, t.s); }, { shadow }));
      const decid = group.filter((t) => !t.type), conif = group.filter((t) => t.type);
      this.scene.add(instanced(crown, leaf, decid, (t, d) => { d.position.set(t.x, ty(t) + 4.2 * t.s, t.z); d.rotation.set(0, t.c * 6, 0); d.scale.set(2.3 * t.s, 2.3 * t.s, 2.3 * t.s); }, { shadow, colors: (t) => new THREE.Color().setHSL(0.24 + t.c * 0.07, 0.45, 0.2 + t.c * 0.1) }));
      this.scene.add(instanced(cone, leaf, conif, (t, d) => { d.position.set(t.x, ty(t) + 1.2 * t.s, t.z); d.rotation.set(0, t.c * 6, 0); d.scale.set(2.1 * t.s, 8 * t.s, 2.1 * t.s); }, { shadow, colors: (t) => new THREE.Color().setHSL(0.3 + t.c * 0.05, 0.4, 0.13 + t.c * 0.06) }));
    }

    // ponds
    for (const w of this.water) {
      const g = new THREE.CircleGeometry(1, 48); g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ color: 0x1f3d4c, roughness: 0.04, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02 }));
      m.position.set(w.x, 0.17, w.z); m.scale.set(w.rx, 1, w.rz); m.receiveShadow = true;
      this.scene.add(m);
    }

    // POI signs
    for (const poi of this.pois) {
      if (!poi.sign) continue;
      const g = new THREE.PlaneGeometry(9, 1.75);
      const sub = poi.cat === 'charger' ? `${poi.kw} kW · ${poi.lot.stalls.length} stalls` : poi.address;
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: TX.signTexture(poi.name, sub), emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0, roughness: 0.5 }));
      m.material.emissiveMap = m.material.map;
      m.position.set(poi.sign.x, poi.sign.y, poi.sign.z); m.rotation.y = poi.sign.yaw;
      this.scene.add(m);
      (this.signMats ||= []).push(m.material);
    }

    // Superchargers (V3 style posts) + pylons
    const postGeo = new RoundedBoxGeometry(0.34, 1.62, 0.26, 3, 0.07); postGeo.translate(0, 0.81 + 0.15, 0);
    const capGeo = new THREE.BoxGeometry(0.352, 0.05, 0.272); capGeo.translate(0, 1.42 + 0.15, 0);
    const holsterGeo = new THREE.BoxGeometry(0.12, 0.2, 0.06); holsterGeo.translate(0, 1.05 + 0.15, 0.15);
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 1.0 + 0.15, 0.16), new THREE.Vector3(0.05, 0.45, 0.32), new THREE.Vector3(0.06, 0.2, 0.38), new THREE.Vector3(0.02, 0.5, 0.25), new THREE.Vector3(0, 1.12, 0.17)]);
    const cableGeo = new THREE.TubeGeometry(curve, 30, 0.022, 6, false);
    const cmat = this.chargerLightMat = new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff1010, emissiveIntensity: 2.0 });
    const place = (c, d) => { d.position.set(c.x, 0, c.z); d.rotation.set(0, c.yaw, 0); d.scale.set(1, 1, 1); };
    this.scene.add(instanced(postGeo, new THREE.MeshPhysicalMaterial({ color: 0xe6e8ea, roughness: 0.25, metalness: 0.3, clearcoat: 0.6 }), this.chargers, place));
    this.scene.add(instanced(capGeo, cmat, this.chargers, place, { shadow: false }));
    this.scene.add(instanced(holsterGeo, new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.5 }), this.chargers, place));
    this.scene.add(instanced(cableGeo, new THREE.MeshStandardMaterial({ color: 0x0d0d0e, roughness: 0.45 }), this.chargers, place));
  }

  buildFurniture() {
    const poles = [], arms = [], heads = [], pools = [];
    const nearDriveway = (x, z) => this.lots.some((l) => {
      const c = this.edgeLocal(l.edge, x, z);
      if (c.w < 4 || c.w > 14) return false;
      return l.big ? Math.abs(c.u - l.du) < 6 || Math.abs(c.u - l.du2) < 6 : c.u > 29 && c.u < 43;
    });
    for (const e of this.edges) {
      if (e.curve || e.a > e.b) continue;
      const span = e.len - e.ra - e.rb - 16;
      if (span < 6) continue;
      const n = Math.max(1, Math.round(span / 34));
      for (let k = 0; k < n; k++) {
        const u = e.ra + 8 + (span * (k + 0.5)) / n;
        for (const side of [-1, 1]) {
          const p = this.edgePoint(e, u, side * (e.hw + 0.65));
          if (nearDriveway(p.x, p.z) || this.onRoad(p.x, p.z, 0.3)) continue;
          if (this.riverAbs(p.x, p.z) < RIVER_HALF + 1 && !(e.bridge && u > e.bridge.u0 && u < e.bridge.u1)) continue;
          const tx = -e.rx * side, tz = -e.rz * side;
          poles.push({ x: p.x, z: p.z });
          arms.push({ x: p.x, z: p.z, yaw: Math.atan2(-tz, tx) });
          heads.push({ x: p.x + tx * 1.75, z: p.z + tz * 1.75, yaw: Math.atan2(-tz, tx) });
          const q = this.edgePoint(e, u, side * 4.2);
          pools.push({ x: q.x, z: q.z });
          this.addCircle(p.x, p.z, 0.2);
        }
      }
    }
    const metal = new THREE.MeshStandardMaterial({ color: 0x55595e, roughness: 0.5, metalness: 0.6 });
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.13, 8, 8); poleGeo.translate(0, 4.15, 0);
    const armGeo = new THREE.BoxGeometry(1.8, 0.09, 0.1); armGeo.translate(0.9, 8.0, 0);
    const headGeo = new THREE.BoxGeometry(0.7, 0.12, 0.32); headGeo.translate(0, 7.92, 0);
    const pl = (it, d) => { d.position.set(it.x, 0, it.z); d.rotation.set(0, it.yaw || 0, 0); d.scale.set(it.sx || 1, 1, 1); };
    this.scene.add(instanced(poleGeo, metal, poles, pl));
    this.scene.add(instanced(armGeo, metal, arms, pl));
    this.lampMat = new THREE.MeshStandardMaterial({ color: 0x777777, emissive: 0xffd9a0, emissiveIntensity: 0 });
    this.scene.add(instanced(headGeo, this.lampMat, heads, pl, { shadow: false }));
    const poolGeo = new THREE.PlaneGeometry(1, 1); poolGeo.rotateX(-Math.PI / 2);
    this.poolMat = new THREE.MeshBasicMaterial({ map: TX.radialTexture(), color: 0xffc98a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    this.pools = instanced(poolGeo, this.poolMat, pools, (it, d) => { d.position.set(it.x, 0.03, it.z); d.rotation.set(0, 0, 0); d.scale.set(17, 1, 17); }, { shadow: false, receive: false });
    this.pools.renderOrder = 2;
    this.scene.add(this.pools);

    // traffic signals (far-side mast arms) and stop signs
    const sigPoles = [], sigArms = [], sigHeads = [], lamps = [];
    const stopPosts = [], stopFaces = [];
    this.lampInfo = [];
    for (const n of this.nodes) {
      if (n.pass) continue;
      for (const e of Object.values(n.in)) {
        if (e.ctl === 'none') continue;
        const at = (a, w) => ({ x: n.x + e.dx * a + e.rx * w, z: n.z + e.dz * a + e.rz * w });
        const faceYaw = Math.atan2(-e.dx, -e.dz);
        if (e.ctl === 'light') {
          // mast arm on the far-right kerb corner of the junction (the corner whose bisector points
          // most nearly ahead-right of this approach), on the sidewalk just behind the kerb
          const m = n.sorted.length, ang = (o) => Math.atan2(o.sdz, o.sdx), want = Math.atan2(e.dz, e.dx) + Math.PI / 4;
          let best = null;
          for (let k = 0; k < m; k++) {
            const o = n.sorted[k], cr = n.corners[k], bis = ang(o) + cr.phi / 2;
            const diff = Math.abs(Math.atan2(Math.sin(bis - want), Math.cos(bis - want)));
            if (!best || diff < best.diff) best = { k, bis, diff, cr, o };
          }
          const X = this.edgePoint(best.o, best.cr.ue, best.cr.We), bx = Math.cos(best.bis), bz = Math.sin(best.bis);
          let pole = null;
          for (let s = 1.6; s < 9 && !pole; s += 0.8) { const p = { x: X.x + bx * s, z: X.z + bz * s }; if (!this.onRoad(p.x, p.z, 0.4)) pole = p; }
          pole ||= { x: X.x + bx * 9, z: X.z + bz * 9 };
          // the pole in this approach's frame (a along, pw to the right); heads hang over its lanes
          const a = (pole.x - n.x) * e.dx + (pole.z - n.z) * e.dz, pw = (pole.x - n.x) * e.rx + (pole.z - n.z) * e.rz;
          sigPoles.push(pole);
          this.addCircle(pole.x, pole.z, 0.25);
          if (pw > 2.5) sigArms.push({ ...pole, yaw: Math.atan2(e.rz, -e.rx), sx: Math.min(14, pw - 0.3) / 9 });
          const hs = [];
          for (const w0 of [5.4, 1.8]) {
            const w = pw > 2.5 ? Math.max(w0, pw - 13.5) : pw + (w0 > 3 ? 0.45 : -0.45);
            const hp = at(a, w);
            sigHeads.push({ ...hp, yaw: faceYaw });
            hs.push(hp);
            [0, 1, 2].forEach((c) => {
              const lp = at(a - 0.17, w);
              lamps.push({ x: lp.x, z: lp.z, y: 5.95 - c * 0.33, yaw: faceYaw });
              this.lampInfo.push({ node: n, phase: e.phase, c });
            });
          }
          this.signals[e.id] = { node: n, heads: hs, x: hs[0].x, z: hs[0].z, y: 5.6 };
        } else {
          let p = at(-(e.sb + 0.8), e.hw + 1.0);
          for (let w = e.hw + 1.8; w < e.hw + 6 && this.onRoad(p.x, p.z, 0.3); w += 0.8) p = at(-(e.sb + 0.8), w);
          stopPosts.push(p);
          stopFaces.push({ ...p, yaw: faceYaw });
          this.stopSigns[e.id] = { x: p.x, z: p.z, node: n };
        }
      }
    }
    const sp = new THREE.CylinderGeometry(0.14, 0.18, 6.6, 10); sp.translate(0, 3.3, 0);
    this.scene.add(instanced(sp, metal, sigPoles, pl));
    const sa = new THREE.BoxGeometry(9.0, 0.16, 0.16); sa.translate(4.5, 6.35, 0);
    this.scene.add(instanced(sa, metal, sigArms, pl));
    const sh = new RoundedBoxGeometry(0.42, 1.12, 0.3, 2, 0.05); sh.translate(0, 5.62, 0);
    this.scene.add(instanced(sh, new THREE.MeshStandardMaterial({ color: 0x1a1b1c, roughness: 0.6 }), sigHeads, pl));
    const lg = new THREE.CircleGeometry(0.125, 16);
    this.lampMesh = instanced(lg, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), lamps, (it, d) => { d.position.set(it.x, it.y, it.z); d.rotation.set(0, it.yaw, 0); d.scale.set(1, 1, 1); }, { shadow: false, receive: false, colors: () => new THREE.Color(0.1, 0.1, 0.1) });
    this.scene.add(this.lampMesh);
    const post = new THREE.CylinderGeometry(0.035, 0.035, 2.6, 6); post.translate(0, 1.3 + 0.15, 0);
    this.scene.add(instanced(post, new THREE.MeshStandardMaterial({ color: 0x9a9da0, metalness: 0.6, roughness: 0.4 }), stopPosts, pl));
    const oct = new THREE.CircleGeometry(0.38, 8); oct.rotateZ(Math.PI / 8); oct.translate(0, 2.45, 0);
    const octBack = oct.clone(); octBack.rotateY(Math.PI);
    this.scene.add(instanced(oct, new THREE.MeshStandardMaterial({ map: TX.stopSignTexture(), roughness: 0.4 }), stopFaces, (it, d) => { d.position.set(it.x, 0, it.z); d.rotation.set(0, it.yaw, 0); d.translateZ(0.02); d.scale.set(1, 1, 1); }));
    this.scene.add(instanced(octBack, new THREE.MeshStandardMaterial({ color: 0x8d9093, roughness: 0.6 }), stopFaces, (it, d) => { d.position.set(it.x, 0, it.z); d.rotation.set(0, it.yaw, 0); d.scale.set(1, 1, 1); }));
    this.updateLamps(true);
  }

  updateLamps(force = false) {
    if (!this.lampMesh) return;
    const col = new THREE.Color();
    const on = [[3.2, 0.12, 0.08], [3.0, 1.6, 0.1], [0.15, 2.6, 1.2]], off = [[0.08, 0.02, 0.02], [0.08, 0.06, 0.01], [0.02, 0.07, 0.04]];
    this.lampInfo.forEach((li, i) => {
      const st = this.lightState(li.node, li.phase);
      const lit = (st === 'R' && li.c === 0) || (st === 'Y' && li.c === 1) || (st === 'G' && li.c === 2);
      const v = lit ? on[li.c] : off[li.c];
      col.setRGB(v[0], v[1], v[2]);
      this.lampMesh.setColorAt(i, col);
    });
    this.lampMesh.instanceColor.needsUpdate = true;
    void force;
  }

  update(dt, night) {
    this.simT += dt;
    this._lt = (this._lt || 0) + dt;
    if (this._lt > 0.2) { this._lt = 0; this.updateLamps(); }
    const n = clamp(night, 0, 1);
    for (const m of this.buildingMats) m.emissiveIntensity = n * 1.4;
    this.houseMat.emissiveIntensity = n * 0.9;
    this.lampMat.emissiveIntensity = n * 3.5;
    if (this.waterMat) { this.waterMat.normalMap.offset.set(this.simT * 0.004, -this.simT * 0.035); }
    if (this.beaconMat) { const on = (this.simT % 1.6) < 0.5; this.beaconMat.color.setRGB(on ? 1 + n * 3 : 0.25, on ? 0.08 : 0.02, on ? 0.05 : 0.02); }
    this.poolMat.opacity = n * 0.5;
    if (this.signMats) for (const m of this.signMats) m.emissiveIntensity = n * 0.8;
  }
}

function prismGeometry() {
  // gable roof: base -0.5..0.5 (x,z) at y=0, ridge along x at y=1
  const v = [], uv = [];
  const A = [-0.5, 0, -0.5], B = [0.5, 0, -0.5], C = [0.5, 0, 0.5], D = [-0.5, 0, 0.5], E = [-0.5, 1, 0], F = [0.5, 1, 0];
  const tri = (a, b, c, ua, ub, uc) => { v.push(...a, ...b, ...c); uv.push(...ua, ...ub, ...uc); };
  tri(A, E, F, [0, 0], [0, 1], [1, 1]); tri(A, F, B, [0, 0], [1, 1], [1, 0]);
  tri(C, F, E, [1, 0], [1, 1], [0, 1]); tri(C, E, D, [1, 0], [0, 1], [0, 0]);
  tri(D, E, A, [0, 0], [0.5, 1], [1, 0]); tri(B, F, C, [0, 0], [0.5, 1], [1, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
