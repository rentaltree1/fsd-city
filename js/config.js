// Shared world constants and small helpers.
// World frame: x east, z south, y up. 2D headings h are atan2(dz, dx); a right turn increases h.
export const S = 100;            // distance between intersections (m)
export const G = 20;             // grid lines per axis
export const HALF = (G - 1) / 2;
export const LANE_W = 3.6;
export const LANE_OFF = [1.8, 5.4]; // lane centre offsets right of the road centreline
export const CURB = 7.6;         // centreline to curb face
export const WALK = 11.6;        // centreline to back of sidewalk
export const STOP = 11.5;        // node centre to stop line
// The player's vehicle (Model Y or Cybertruck). These are live bindings: setVehicleDims() changes them
// for every module that imports them.
export let WHEELBASE = 2.89;
export let FRONT_OFF = 3.85;     // rear axle to front bumper
export let REAR_OFF = 0.95;      // rear axle to rear bumper
export let CENTER_OFF = 1.445;   // rear axle to the body centre
export let CAR_LEN = 4.797, CAR_WID = 1.921, CAR_H = 1.624;
export function setVehicleDims({ L, W, H, wheelbase, axleR }) {
  WHEELBASE = wheelbase; CENTER_OFF = axleR; CAR_LEN = L; CAR_WID = W; CAR_H = H;
  FRONT_OFF = axleR + L / 2; REAR_OFF = L / 2 - axleR;
}
export const MPH = 2.23694;
export const MI = 1609.34;

export const nodeCoord = (i) => (i - HALF) * S;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const wrapAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
// three.js yaw (rotation.y) for an object whose local -z should point along (dx,dz)
export const yawFromDir = (dx, dz) => Math.atan2(-dx, -dz);
export const yawFromHeading = (h) => -h - Math.PI / 2;

export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export function district(bi, bj) {
  if (bi >= 6 && bi <= 12 && bj >= 6 && bj <= 12) return 'downtown';
  if (bi >= 4 && bi <= 14 && bj >= 4 && bj <= 14) return 'midtown';
  return 'suburb';
}
export const isLightNode = (i, j) => i >= 4 && i <= 15 && j >= 4 && j <= 15;

export function fmtTime(hours) {
  const h = Math.floor(hours) % 24, m = Math.floor((hours - Math.floor(hours)) * 60);
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
export function fmtDist(m) {
  const mi = m / MI;
  if (mi < 0.1) return `${Math.max(50, Math.round(m * 3.28084 / 50) * 50)} ft`;
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
}
