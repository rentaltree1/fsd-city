// Player vehicle dynamics: kinematic bicycle model on the rear axle, Tesla-like one-pedal regen,
// speed-sensitive steering, curb ride height and collisions with buildings, poles and other cars.
import { WHEELBASE, CENTER_OFF, CAR_LEN, CAR_WID, clamp, lerp } from './config.js';

export class Vehicle {
  constructor(city) {
    this.city = city;
    this.x = 0; this.z = 0; this.h = 0; this.y = 0;
    this.v = 0; this.steer = 0; this.gear = 'P';
    this.accel = 0; this.latAcc = 0; this.dist = 0;
    this.battery = 0.24; this.charging = false; this.chargeKw = 0; this.chargeLimit = 0.9;
    this.signal = null; this.hazard = false; this.braking = false;
    this.onCollide = null;
  }
  get fx() { return Math.cos(this.h); }
  get fz() { return Math.sin(this.h); }
  get cx() { return this.x + Math.cos(this.h) * CENTER_OFF; }
  get cz() { return this.z + Math.sin(this.h) * CENTER_OFF; }
  get rangeMi() { return this.battery * 327; }
  place(x, z, h) { this.x = x; this.z = z; this.h = h; this.v = 0; this.steer = 0; }

  // input: {throttle, brake, steerIn}, cmd: FSD command {accel, steer} or null
  update(dt, input, cmd, others) {
    const v0 = this.v;
    const sp = Math.abs(this.v);
    const dir = this.gear === 'D' ? 1 : this.gear === 'R' ? -1 : 0;
    const powered = this.battery > 0.001 && !this.charging;
    if (cmd) {
      let a = cmd.accel;
      if (input.throttle > 0.05 && dir > 0) a = Math.max(a, input.throttle * 3.5);
      if (dir === 0) a = -Math.sign(this.v) * Math.min(sp / dt, 6);
      this.v += a * dt * (dir === 0 ? 1 : dir);
      if (dir !== 0 && Math.sign(this.v) === -dir) this.v = 0;
      this.steer = cmd.steer;
      this.braking = a < -0.8;
    } else {
      const maxSteer = 0.6 / (1 + (sp * sp) / 260);
      const target = input.steerIn * maxSteer;
      const rate = input.steerIn !== 0 ? 1.7 : 2.4;
      this.steer += clamp(target - this.steer, -rate * dt, rate * dt);
      let a = 0;
      if (dir !== 0 && powered) {
        const aMax = dir > 0 ? Math.min(5.6, 95 / Math.max(sp, 1)) : 2.6;
        if (input.throttle > 0) {
          if (dir < 0 && sp > 6.7) a = 0; else a = dir * input.throttle * aMax;
        }
      }
      // regen (one-pedal "Hold") and brakes act toward zero
      let decel = 0;
      if (dir !== 0 && input.throttle < 0.05) decel += 1.8 * Math.min(1, sp / 3) + (sp < 0.6 ? 2 : 0);
      decel += input.brake * 9;
      if (this.gear === 'P') decel += 12;
      decel += 0.0004 * sp * sp + 0.08;
      this.v += a * dt;
      const s = Math.sign(this.v), m = Math.abs(this.v) - decel * dt;
      this.v = m > 0 ? s * m : (a !== 0 && Math.sign(a) === s ? this.v : 0);
      this.braking = input.brake > 0.05 || (input.throttle < 0.05 && sp > 2 && dir !== 0);
    }
    this.accel = (this.v - v0) / dt * Math.sign(this.v || 1);
    // kinematics on the rear axle
    const yawRate = (this.v * Math.tan(this.steer)) / WHEELBASE;
    this.h += yawRate * dt;
    this.x += this.v * Math.cos(this.h) * dt;
    this.z += this.v * Math.sin(this.h) * dt;
    this.latAcc = this.v * yawRate;
    this.dist += Math.abs(this.v) * dt;
    // energy: game-accelerated consumption so charging matters
    if (Math.abs(this.v) > 0.1) this.battery = Math.max(0, this.battery - Math.abs(this.v) * dt * (1 + Math.max(0, this.accel) * 0.12) / 25000);
    this.collide(others);
    const gh = this.city.groundHeight(this.cx, this.cz, this.y);
    this.y = lerp(this.y, gh, Math.min(1, dt * 10));
  }

  corners() {
    const c = Math.cos(this.h), s = Math.sin(this.h), cx = this.cx, cz = this.cz;
    return { cx, cz, ax: [c, s], ay: [-s, c] };
  }

  collide(others) {
    const ob = this.corners(), HALF_L = CAR_LEN / 2, HALF_W = CAR_WID / 2;
    let hit = 0;
    const push = (nx, nz, d) => {
      this.x += nx * d; this.z += nz * d;
      const vn = this.v * (Math.cos(this.h) * nx + Math.sin(this.h) * nz);
      if (vn < 0) { hit = Math.max(hit, Math.abs(this.v)); this.v *= -0.15; }
    };
    for (const o of this.city.queryObstacles(ob.cx, ob.cz)) {
      if (o.type === 'box') {
        const r = obbVsAabb(ob.cx, ob.cz, ob.ax, ob.ay, HALF_L, HALF_W, o);
        if (r) push(r[0], r[1], r[2]);
      } else {
        const r = obbVsCircle(ob.cx, ob.cz, ob.ax, ob.ay, HALF_L, HALF_W, o.x, o.z, o.r);
        if (r) push(r[0], r[1], r[2]);
      }
    }
    for (const o of others) {
      if (Math.abs(o.x - ob.cx) > 7 || Math.abs(o.z - ob.cz) > 7) continue;
      const r = obbVsObb(ob.cx, ob.cz, this.h, HALF_L, HALF_W, o.x, o.z, o.h, o.L / 2, o.W / 2);
      if (r) push(r[0], r[1], r[2]);
    }
    const lim = 5900;
    this.x = clamp(this.x, -lim, lim); this.z = clamp(this.z, -lim, lim);
    if (hit > 1.2 && this.onCollide) this.onCollide(hit);
  }
}

function project(cx, cz, ax, ay, hl, hw, nx, nz) {
  const c = cx * nx + cz * nz, r = hl * Math.abs(ax[0] * nx + ax[1] * nz) + hw * Math.abs(ay[0] * nx + ay[1] * nz);
  return [c - r, c + r];
}
function satAxes(axes, A, B) {
  let best = null;
  for (const [nx, nz] of axes) {
    const a = A(nx, nz), b = B(nx, nz);
    const o = Math.min(a[1] - b[0], b[1] - a[0]);
    if (o <= 0) return null;
    if (!best || o < best[2]) {
      const sgn = (a[0] + a[1]) / 2 < (b[0] + b[1]) / 2 ? -1 : 1;
      best = [nx * sgn, nz * sgn, o];
    }
  }
  return best;
}
// o: a box obstacle, oriented (x, z, ax, ay, hx, hz) or axis-aligned (minx..maxz)
export function obbVsAabb(cx, cz, ax, ay, hl, hw, o) {
  const bx = o.ax ? o.x : (o.minx + o.maxx) / 2, bz = o.ax ? o.z : (o.minz + o.maxz) / 2;
  const ex = o.ax ? o.hx : (o.maxx - o.minx) / 2, ez = o.ax ? o.hz : (o.maxz - o.minz) / 2;
  const ba = o.ax || [1, 0], bb = o.ay || [0, 1];
  return satAxes([ba, bb, ax, ay], (nx, nz) => project(cx, cz, ax, ay, hl, hw, nx, nz), (nx, nz) => project(bx, bz, ba, bb, ex, ez, nx, nz));
}
export function obbVsObb(cx, cz, h, hl, hw, ox, oz, oh, ol, ow) {
  const ax = [Math.cos(h), Math.sin(h)], ay = [-Math.sin(h), Math.cos(h)];
  const bx = [Math.cos(oh), Math.sin(oh)], by = [-Math.sin(oh), Math.cos(oh)];
  return satAxes([ax, ay, bx, by], (nx, nz) => project(cx, cz, ax, ay, hl, hw, nx, nz), (nx, nz) => project(ox, oz, bx, by, ol, ow, nx, nz));
}
export function obbVsCircle(cx, cz, ax, ay, hl, hw, px, pz, r) {
  const dx = px - cx, dz = pz - cz;
  const lx = clamp(dx * ax[0] + dz * ax[1], -hl, hl), ly = clamp(dx * ay[0] + dz * ay[1], -hw, hw);
  const qx = cx + ax[0] * lx + ay[0] * ly, qz = cz + ax[1] * lx + ay[1] * ly;
  const ddx = qx - px, ddz = qz - pz, d = Math.hypot(ddx, ddz);
  if (d >= r || d < 1e-6) return null;
  return [ddx / d, ddz / d, r - d];
}
