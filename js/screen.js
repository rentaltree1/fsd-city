// The 15.4" touchscreen. A 2D canvas (status bar, map, Nearby Charging, search, media card, controls,
// bottom bar) is composited over 3D renders (the FSD visualization on the left and live car cameras)
// into one render target that is mapped onto the screen mesh in the cabin. Clicks arrive as UV hits.
import * as THREE from 'three';
import { fmtTime, fmtDist, MPH, MI, S, CURB, G, nodeCoord, clamp, lerp, wrapAngle, WHEELBASE } from './config.js';
import { TRACKS } from './audio.js';
import { CAMERAS } from './car.js';
import { FSD, PROFILES } from './fsd.js';

export const SW = 1344, SH = 800, LW = 540, BB = 64;
const MAPW = SW - LW, MAPH = SH - BB;
const FONT = 'Inter, "Segoe UI", Roboto, Arial, sans-serif';
const BLUE = '#3e6ae1', RED = '#e82127', GREEN = '#20b85a';

const THEME = {
  day: { mapBg: '#e9ebe6', road: '#ffffff', block: '#e2e0da', blockDT: '#d9d6cf', blockSub: '#e6eadf', park: '#c4e2b4', water: '#a2cff0', bld: '#cbc7bf', label: '#5d6166', card: '#ffffff', text: '#171a20', sub: '#5c5e62', line: '#e6e6e6', bar: 'rgba(255,255,255,0.86)', vizText: '#171a20', chip: '#f1f1f1' },
  night: { mapBg: '#1b1c1f', road: '#3b3d42', block: '#26272b', blockDT: '#2b2c30', blockSub: '#242628', park: '#1f3324', water: '#1d3446', bld: '#323338', label: '#9ea2a8', card: '#2a2b2e', text: '#f2f2f2', sub: '#a3a6ab', line: '#3a3b3f', bar: 'rgba(28,29,31,0.88)', vizText: '#f2f2f2', chip: '#36373a' },
};

// ---------------------------------------------------------------- navigation state
export class Nav {
  constructor(city, vision) { this.city = city; this.planner = new FSD(city, vision); this.dest = null; this.timer = 0; this.src = null; this.err = null; }
  set(dest, car) { this.dest = dest; this.plan(car); }
  plan(car) { this.err = this.planner.plan(car, this.dest); this.src = this.err ? null : this.planner; }
  clear() { this.dest = null; this.planner.path = null; this.src = null; }
  update(dt, car, fsd) {
    if (!this.dest) { this.src = null; return; }
    if (fsd.engaged && fsd.dest === this.dest) { this.src = fsd; return; }
    if (!this.planner.path) { this.timer -= dt; if (this.timer < 0) { this.timer = 2; this.plan(car); } return; }
    this.src = this.planner;
    this.planner.updateProgress(car);
    this.timer -= dt;
    if (this.planner.offPath > 18 && this.timer < 0) { this.timer = 2; this.plan(car); }
  }
  remaining() { const s = this.src; return s && s.path ? Math.max(0, s.path.lastS - s.sCur) : 0; }
  maneuver() {
    const s = this.src; if (!s || !s.path) return null;
    for (const ev of s.events) {
      if (ev.s - s.sCur < -2) continue;
      if (ev.move && ev.move !== 'S' && ['light', 'stop', 'stop2', 'yield', 'turn'].includes(ev.type)) {
        if (ev.move === 'U') return { dist: ev.s - s.sCur, dir: 'L', text: 'Turn around in the cul-de-sac' };
        const left = ev.move.toUpperCase() === 'L', bear = ev.move === 'l' || ev.move === 'r';
        return { dist: ev.s - s.sCur, dir: left ? 'L' : 'R', text: `${bear ? 'Bear' : 'Turn'} ${left ? 'left' : 'right'} onto ${ev.toName}` };
      }
      if (ev.type === 'gear' || ev.type === 'end') return { dist: Math.max(0, ev.s - s.sCur - 40), dir: 'P', text: `Arrive at ${this.dest.name}` };
    }
    return null;
  }
}

// ---------------------------------------------------------------- the screen
export class CarScreen {
  constructor(renderer, game, viz) {
    this.r = renderer; this.g = game; this.viz = viz;
    this.rt = new THREE.WebGLRenderTarget(SW, SH, { samples: 4, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    this.rt.texture.anisotropy = 8;
    this.cv = document.createElement('canvas'); this.cv.width = SW; this.cv.height = SH;
    this.ctx = this.cv.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.cv); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.oScene = new THREE.Scene(); this.oCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.oScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })));
    this.hits = []; this.wheels = []; this.drag = null;
    this.panel = null;          // 'search' | 'charging' | 'controls' | 'camera'
    this.search = { text: '', focused: false, scroll: 0 };
    this.chargeScroll = 0; this.controlsScroll = 0;
    this.zoom = 0.85; this.pan = null; this.headingUp = false;
    this.alert = null; this.t = 0; this.acc = 0;
    this.camTimer = 0;
  }

  // ---------- input
  isTyping() { return this.search.focused; }
  click(px, py) {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h) {
        h.fn(px - h.x, py - h.y); this.g.audio.chime('click');
        if (this.search.focused) document.getElementById('kbd')?.focus({ preventScroll: true });
        return true;
      }
    }
    if (this.search.focused) this.blurSearch();
    if (px < LW && py < MAPH && this.parkView()) {
      const k = this.viz.pick((px / LW) * 2 - 1, -((py / MAPH) * 2 - 1));
      if (k) { this.g.act.toggle(k); return true; }
    }
    return false;
  }
  wheel(px, py, dy) {
    for (let i = this.wheels.length - 1; i >= 0; i--) {
      const h = this.wheels[i];
      if (px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h) { h.fn(dy); return true; }
    }
    return false;
  }
  pointer(px, py, type) {
    const inMap = px > LW && py < MAPH && !this.panelCovers(px, py);
    if (type === 'down' && inMap) this.drag = { px, py, moved: 0 };
    else if (type === 'move' && this.drag) {
      const dx = px - this.drag.px, dy = py - this.drag.py;
      this.drag.moved += Math.abs(dx) + Math.abs(dy);
      if (this.drag.moved > 4) {
        const c = this.mapCenter();
        const [wx, wz] = this.unrot(-dx / this.zoom, -dy / this.zoom);
        this.pan = { x: c.x + wx, z: c.z + wz };
      }
      this.drag.px = px; this.drag.py = py;
    } else if (type === 'up') { const d = this.drag; this.drag = null; return d && d.moved > 4; }
    return false;
  }
  panelCovers(px, py) { return this.panel && px > LW + 10 && px < LW + 356 && py > 46 && py < 640; }
  // Characters arrive through a hidden <input> (see focusSearch); keys here only control the field.
  key(e) {
    if (!this.search.focused) return false;
    const k = e.key;
    if (k === 'Escape') this.blurSearch();
    else if (k === 'Enter') { const r = this.results(); if (r[0]) this.choose(r[0]); }
    return true;
  }
  focusSearch() {
    this.search.focused = true; this.panel = 'search';
    const el = document.getElementById('kbd');
    if (el) { el.value = this.search.text; el.focus({ preventScroll: true }); }
  }
  blurSearch() {
    this.search.focused = false;
    const el = document.getElementById('kbd');
    if (el && document.activeElement === el) el.blur();
  }
  onInput(value) { this.search.text = value.slice(0, 40); this.search.scroll = 0; }
  results() {
    const q = this.search.text.trim().toLowerCase(), car = this.g.car;
    let list = this.g.city.pois.slice();
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || p.cat.includes(q) || p.address.toLowerCase().includes(q) || (q.includes('charg') && p.cat === 'charger'));
    return list.sort((a, b) => Math.hypot(a.x - car.cx, a.z - car.cz) - Math.hypot(b.x - car.cx, b.z - car.cz));
  }
  choose(poi) {
    this.blurSearch(); this.search.text = ''; this.panel = null; this.pan = null;
    this.g.act.setDest(poi);
  }
  showAlert(title, sub, color = BLUE, dur = 4) { this.alert = { title, sub, color, until: this.t + dur }; }
  parkView() { const c = this.g.car; return c.gear === 'P' && !this.g.fsd.engaged; }

  // ---------- drawing helpers
  rr(x, y, w, h, r) { const c = this.ctx; c.beginPath(); c.roundRect(x, y, w, h, r); }
  fillRR(x, y, w, h, r, col, shadow = false) {
    const c = this.ctx;
    if (shadow) { c.save(); c.shadowColor = 'rgba(0,0,0,0.18)'; c.shadowBlur = 18; c.shadowOffsetY = 4; }
    this.rr(x, y, w, h, r); c.fillStyle = col; c.fill();
    if (shadow) c.restore();
  }
  text(t, x, y, size, col, { w = 500, align = 'left', base = 'middle', max } = {}) {
    const c = this.ctx; c.font = `${w} ${size}px ${FONT}`; c.fillStyle = col; c.textAlign = align; c.textBaseline = base;
    if (max) { let s = t; while (c.measureText(s).width > max && s.length > 3) s = s.slice(0, -2); if (s !== t) s = s.slice(0, -1) + '…'; c.fillText(s, x, y); }
    else c.fillText(t, x, y);
  }
  hit(x, y, w, h, fn) { this.hits.push({ x, y, w, h, fn }); }
  wheelArea(x, y, w, h, fn) { this.wheels.push({ x, y, w, h, fn }); }

  icon(name, x, y, s, col, lw = 2.2) {
    const c = this.ctx; c.save(); c.translate(x, y); c.scale(s / 24, s / 24); c.strokeStyle = col; c.fillStyle = col; c.lineCap = 'round'; c.lineJoin = 'round';
    c.lineWidth = lw;
    switch (name) {
      case 'bolt': c.beginPath(); c.moveTo(13, 2); c.lineTo(5, 14); c.lineTo(11, 14); c.lineTo(10, 22); c.lineTo(19, 9); c.lineTo(13, 9); c.closePath(); c.fill(); break;
      case 'lock': case 'unlock': c.strokeRect(5, 11, 14, 10); c.beginPath(); if (name === 'lock') c.arc(12, 10, 4.5, Math.PI, 0); else c.arc(12, 10, 4.5, Math.PI, -0.3); c.lineTo(name === 'lock' ? 16.5 : 16.3, name === 'lock' ? 11 : 8); c.moveTo(7.5, 10); c.lineTo(7.5, 11); c.stroke(); break;
      case 'search': c.beginPath(); c.arc(10, 10, 6.5, 0, Math.PI * 2); c.moveTo(15, 15); c.lineTo(21, 21); c.stroke(); break;
      case 'close': c.beginPath(); c.moveTo(6, 6); c.lineTo(18, 18); c.moveTo(18, 6); c.lineTo(6, 18); c.stroke(); break;
      case 'pin': c.beginPath(); c.moveTo(12, 22); c.bezierCurveTo(4, 13, 5, 3, 12, 3); c.bezierCurveTo(19, 3, 20, 13, 12, 22); c.fill(); break;
      case 'user': c.beginPath(); c.arc(12, 8, 4, 0, Math.PI * 2); c.stroke(); c.beginPath(); c.arc(12, 22, 8, Math.PI * 1.1, Math.PI * 1.9); c.stroke(); break;
      case 'car': c.beginPath(); c.moveTo(3, 15); c.quadraticCurveTo(4, 9, 8, 8.5); c.lineTo(15, 8); c.quadraticCurveTo(19, 9, 21, 13); c.lineTo(21, 16); c.lineTo(3, 16); c.closePath(); c.stroke(); c.beginPath(); c.arc(7.5, 16.5, 2, 0, 7); c.arc(16.5, 16.5, 2, 0, 7); c.fill(); break;
      case 'seat': c.beginPath(); c.moveTo(8, 3); c.lineTo(10, 14); c.lineTo(18, 15); c.moveTo(7, 20); c.lineTo(19, 20); c.stroke(); break;
      case 'heat': for (const dx of [7, 12, 17]) { c.beginPath(); c.moveTo(dx, 21); c.bezierCurveTo(dx - 3, 16, dx + 3, 12, dx, 7); c.stroke(); } break;
      case 'phone': c.beginPath(); c.moveTo(6, 3); c.lineTo(10, 3); c.lineTo(11, 8); c.lineTo(8.5, 10); c.quadraticCurveTo(10, 14, 14, 15.5); c.lineTo(16, 13); c.lineTo(21, 14); c.lineTo(21, 18); c.quadraticCurveTo(20, 21, 16, 21); c.quadraticCurveTo(4, 18, 3, 6); c.quadraticCurveTo(3, 3, 6, 3); c.fill(); break;
      case 'camera': c.beginPath(); c.roundRect(2, 7, 14, 11, 2); c.stroke(); c.beginPath(); c.moveTo(16, 11); c.lineTo(22, 7.5); c.lineTo(22, 17.5); c.lineTo(16, 14); c.stroke(); break;
      case 'dots': for (const dx of [5, 12, 19]) { c.beginPath(); c.arc(dx, 12, 2, 0, 7); c.fill(); } break;
      case 'music': c.beginPath(); c.arc(12, 12, 10, 0, 7); c.fill(); c.strokeStyle = '#111'; c.lineWidth = 1.8; for (const [yy, a, b] of [[9, 7, 17], [12.5, 8, 16], [16, 9, 15]]) { c.beginPath(); c.moveTo(a, yy); c.quadraticCurveTo(12, yy - 2, b, yy + 0.5); c.stroke(); } break;
      case 'chart': c.beginPath(); c.roundRect(3, 3, 18, 18, 4); c.fill(); c.strokeStyle = '#111'; c.lineWidth = 2; c.beginPath(); c.moveTo(6, 16); c.lineTo(10, 11); c.lineTo(13, 14); c.lineTo(18, 7); c.stroke(); break;
      case 'grid': for (const yy of [5, 12, 19]) for (const xx of [5, 12, 19]) { c.beginPath(); c.arc(xx, yy, 1.8, 0, 7); c.fill(); } break;
      case 'volume': c.beginPath(); c.moveTo(3, 9); c.lineTo(7, 9); c.lineTo(12, 4); c.lineTo(12, 20); c.lineTo(7, 15); c.lineTo(3, 15); c.closePath(); c.fill(); break;
      case 'chevL': c.beginPath(); c.moveTo(15, 5); c.lineTo(8, 12); c.lineTo(15, 19); c.stroke(); break;
      case 'chevR': c.beginPath(); c.moveTo(9, 5); c.lineTo(16, 12); c.lineTo(9, 19); c.stroke(); break;
      case 'heart': c.beginPath(); c.moveTo(12, 20); c.bezierCurveTo(-1, 11, 6, 1, 12, 7); c.bezierCurveTo(18, 1, 25, 11, 12, 20); c.stroke(); break;
      case 'prev': c.beginPath(); c.moveTo(19, 5); c.lineTo(9, 12); c.lineTo(19, 19); c.closePath(); c.fill(); c.fillRect(5, 5, 2.5, 14); break;
      case 'next': c.beginPath(); c.moveTo(5, 5); c.lineTo(15, 12); c.lineTo(5, 19); c.closePath(); c.fill(); c.fillRect(16.5, 5, 2.5, 14); break;
      case 'play': c.beginPath(); c.moveTo(7, 4); c.lineTo(20, 12); c.lineTo(7, 20); c.closePath(); c.fill(); break;
      case 'pause': c.fillRect(6, 4, 4, 16); c.fillRect(14, 4, 4, 16); break;
      case 'shuffle': c.beginPath(); c.moveTo(3, 7); c.lineTo(8, 7); c.lineTo(16, 17); c.lineTo(21, 17); c.moveTo(3, 17); c.lineTo(8, 17); c.lineTo(16, 7); c.lineTo(21, 7); c.moveTo(18, 4); c.lineTo(21, 7); c.lineTo(18, 10); c.moveTo(18, 14); c.lineTo(21, 17); c.lineTo(18, 20); c.stroke(); break;
      case 'list': for (const yy of [6, 12, 18]) { c.beginPath(); c.moveTo(4, yy); c.lineTo(20, yy); c.stroke(); } break;
      case 'eq': for (const [xx, y0] of [[6, 9], [12, 15], [18, 7]]) { c.beginPath(); c.moveTo(xx, 4); c.lineTo(xx, 20); c.stroke(); c.beginPath(); c.arc(xx, y0, 2.4, 0, 7); c.fill(); } break;
      case 'compass': c.beginPath(); c.moveTo(12, 2); c.lineTo(17, 20); c.lineTo(12, 16); c.lineTo(7, 20); c.closePath(); c.fill(); break;
      case 'target': c.beginPath(); c.arc(12, 12, 7, 0, 7); c.moveTo(12, 1); c.lineTo(12, 5); c.moveTo(12, 19); c.lineTo(12, 23); c.moveTo(1, 12); c.lineTo(5, 12); c.moveTo(19, 12); c.lineTo(23, 12); c.stroke(); c.beginPath(); c.arc(12, 12, 2.5, 0, 7); c.fill(); break;
      case 'settings': c.beginPath(); c.arc(12, 12, 3.5, 0, 7); c.stroke(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; c.beginPath(); c.moveTo(12 + Math.cos(a) * 6, 12 + Math.sin(a) * 6); c.lineTo(12 + Math.cos(a) * 9.5, 12 + Math.sin(a) * 9.5); c.stroke(); } break;
      case 'wheel': c.beginPath(); c.arc(12, 12, 9.5, 0, 7); c.stroke(); c.beginPath(); c.moveTo(2.5, 11); c.quadraticCurveTo(12, 8, 21.5, 11); c.moveTo(12, 14); c.lineTo(12, 21.5); c.stroke(); c.beginPath(); c.arc(12, 12.5, 2.5, 0, 7); c.fill(); break;
      case 'airbag': c.font = `700 7px ${FONT}`; c.textAlign = 'center'; c.fillText('PASS', 12, 7); c.fillText('AIRBAG', 12, 14); c.fillText('ON', 12, 21); break;
      case 'plug': c.beginPath(); c.roundRect(6, 8, 12, 9, 3); c.stroke(); c.beginPath(); c.moveTo(9, 3); c.lineTo(9, 8); c.moveTo(15, 3); c.lineTo(15, 8); c.moveTo(12, 17); c.lineTo(12, 22); c.stroke(); break;
      case 'arrowL': case 'arrowR': { c.save(); if (name === 'arrowR') { c.translate(24, 0); c.scale(-1, 1); } c.beginPath(); c.moveTo(20, 21); c.lineTo(20, 12); c.quadraticCurveTo(20, 8, 15, 8); c.lineTo(6, 8); c.stroke(); c.beginPath(); c.moveTo(9, 3); c.lineTo(4, 8); c.lineTo(9, 13); c.stroke(); c.restore(); break; }
      case 'flag': c.beginPath(); c.moveTo(5, 22); c.lineTo(5, 3); c.lineTo(19, 7); c.lineTo(5, 12); c.stroke(); break;
      case 'light': c.beginPath(); c.arc(9, 12, 6, Math.PI / 2, -Math.PI / 2); c.closePath(); c.stroke(); for (const yy of [7, 12, 17]) { c.beginPath(); c.moveTo(17, yy); c.lineTo(22, yy); c.stroke(); } break;
      case 'hazard': c.beginPath(); c.moveTo(12, 3); c.lineTo(22, 20); c.lineTo(2, 20); c.closePath(); c.stroke(); c.beginPath(); c.moveTo(12, 9); c.lineTo(17, 17); c.lineTo(7, 17); c.closePath(); c.stroke(); break;
      default: break;
    }
    c.restore();
  }

  // ---------- frame
  update(dt) {
    this.t += dt; this.acc += dt;
    if (this.acc < (this.minDt || 1 / 30)) return;
    const fdt = this.acc; this.acc = 0;
    this.draw(fdt);
    this.renderRT(fdt);
  }

  theme() { return this.g.state.night > 0.5 ? THEME.night : THEME.day; }

  draw(dt) {
    const c = this.ctx, g = this.g, T = this.theme();
    this.hits = []; this.wheels = [];
    c.clearRect(0, 0, SW, SH);
    const camApp = this.panel === 'camera', reverse = g.car.gear === 'R';
    if (!camApp && !reverse) this.drawMap(T); else { c.fillStyle = '#000'; c.fillRect(LW, 0, MAPW, MAPH); }
    if (camApp) this.drawCameraFrames(T);
    if (reverse && !camApp) this.drawReverse(T);
    this.drawLeft(T, dt);
    this.drawTopBar(T);
    if (!camApp) {
      if (this.panel === 'charging') this.drawCharging(T);
      else if (this.panel === 'controls') this.drawControls(T);
      else if (!reverse) this.drawSearchOrNav(T);
      if (!reverse) { this.drawToolbar(T); this.drawMedia(T); }
    }
    this.drawBottom(T);
    this.tex.needsUpdate = true;
  }

  mapCenter() { const car = this.g.car; return this.pan ? this.pan : { x: car.cx, z: car.cz }; }
  rotAngle() { return this.headingUp ? -this.g.car.h - Math.PI / 2 : 0; }
  rot(dx, dz) { const a = this.rotAngle(), c = Math.cos(a), s = Math.sin(a); return [dx * c - dz * s, dx * s + dz * c]; }
  unrot(dx, dz) { const a = -this.rotAngle(), c = Math.cos(a), s = Math.sin(a); return [dx * c - dz * s, dx * s + dz * c]; }

  drawMap(T) {
    const c = this.ctx, g = this.g, city = g.city, z = this.zoom;
    const cen = this.mapCenter();
    const ox = LW + MAPW * 0.56, oy = MAPH * (this.headingUp ? 0.64 : 0.52);
    const W2M = (x, zz) => { const [a, b] = this.rot(x - cen.x, zz - cen.z); return [ox + a * z, oy + b * z]; };
    this.W2M = W2M;
    c.save(); c.beginPath(); c.rect(LW, 0, MAPW, MAPH); c.clip();
    c.fillStyle = T.mapBg; c.fillRect(LW, 0, MAPW, MAPH);
    c.save(); c.translate(ox, oy); c.rotate(this.rotAngle()); c.scale(z, z); c.translate(-cen.x, -cen.z);
    const relief = this.reliefImage();
    c.globalAlpha = T === THEME.night ? 0.35 : 1;
    { const sp = g.city.terrain.size; c.drawImage(relief, -sp / 2, -sp / 2, sp, sp); }
    c.globalAlpha = 1;
    // the city: flat ground inside the limits, then every street and junction at its real width
    const poly = (pts, close = true) => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); if (close) c.closePath(); };
    poly(city.cityPoly.map((p) => [p.x, p.z])); c.fillStyle = T.blockSub; c.fill();
    c.lineCap = 'butt'; c.strokeStyle = T.road;
    for (const hw of [13.6, 7.6, 4.6, 4.2]) {
      c.lineWidth = hw * 2; c.beginPath();
      for (const e of city.edges) if (!e.curve && e.a < e.b && e.hw === hw) { c.moveTo(e.ax, e.az); c.lineTo(e.bx, e.bz); }
      c.stroke();
    }
    c.fillStyle = T.road;
    for (const j of city.junctions) { poly(j.n.jpoly); c.fill(); }
    // winding hill roads
    c.lineJoin = 'round'; c.lineCap = 'round';
    for (const r of city.hillRoads) {
      c.beginPath();
      r.pts.forEach((p, i) => (i ? c.lineTo(p.x, p.z) : c.moveTo(p.x, p.z)));
      c.strokeStyle = T === THEME.night ? '#55585e' : '#c9c6bf'; c.lineWidth = 19; c.stroke();
      c.strokeStyle = T.road; c.lineWidth = 15; c.stroke();
    }
    const view = (MAPW + MAPH) / z;
    c.lineJoin = 'round';
    for (const b of city.blocks) {
      if (Math.abs(b.cx - cen.x) > view || Math.abs(b.cz - cen.z) > view) continue;
      c.fillStyle = b.park ? T.park : b.district === 'downtown' ? T.blockDT : b.district === 'suburb' ? T.blockSub : T.block;
      for (const pc of b.slabPieces) { poly(pc); c.fill(); c.strokeStyle = T.line; c.lineWidth = 1.2 / z; c.stroke(); }
    }
    c.fillStyle = T.water;
    for (const w of city.water) { c.beginPath(); c.ellipse(w.x, w.z, w.rx, w.rz, 0, 0, Math.PI * 2); c.fill(); }
    // the river and the bridges over it
    c.lineCap = 'butt';
    c.beginPath(); city.riverPts.forEach((p, i) => (i ? c.lineTo(p.x, p.z) : c.moveTo(p.x, p.z)));
    c.strokeStyle = T.water; c.lineWidth = 28; c.stroke();
    c.strokeStyle = T.road;
    for (const br of city.bridges) { const a = city.edgePoint(br.e, br.u0, 0), b = city.edgePoint(br.e, br.u1, 0); c.lineWidth = br.e.hw * 2; c.beginPath(); c.moveTo(a.x, a.z); c.lineTo(b.x, b.z); c.stroke(); }
    if (z > 0.9) {
      c.fillStyle = T.bld;
      for (const b of city.buildings) {
        if (Math.abs(b.pts[0][0] - cen.x) > view * 0.7 || Math.abs(b.pts[0][1] - cen.z) > view * 0.7) continue;
        poly(b.pts); c.fill();
      }
      c.fillStyle = this.g.state.night > 0.5 ? '#2f3034' : '#dcdcdc';
      for (const p of city.pois) if (p.lotPoly) { poly(p.lotPoly.map((q) => [q.x, q.z])); c.fill(); }
    }
    c.restore();
    // route
    const src = g.nav.src;
    if (src && src.path) {
      const p = src.path; c.lineJoin = 'round'; c.lineCap = 'round';
      c.beginPath(); let first = true;
      for (let i = Math.max(0, src.idx); i < p.n; i += 2) { const [x, y] = W2M(p.x[i], p.z[i]); if (first) { c.moveTo(x, y); first = false; } else c.lineTo(x, y); }
      const [ex, ey] = W2M(p.x[p.n - 1], p.z[p.n - 1]); c.lineTo(ex, ey);
      c.strokeStyle = '#2b4fb8'; c.lineWidth = Math.max(6, 11 * Math.min(1.4, z)); c.stroke();
      c.strokeStyle = '#4a7cf0'; c.lineWidth = Math.max(4, 7 * Math.min(1.4, z)); c.stroke();
    }
    // labels
    if (z > 0.45) {
      c.font = `500 ${z > 1.4 ? 13 : 12}px ${FONT}`; c.fillStyle = T.label; c.textAlign = 'center'; c.textBaseline = 'middle';
      const step = z > 1.4 ? 2 : z > 0.8 ? 3 : 5;
      for (const e of city.edges) {
        if (e.curve || e.a > e.b || (e.chainPos || 0) % step !== 0) continue;
        const mx = (e.ax + e.bx) / 2, mz = (e.az + e.bz) / 2;
        if (Math.abs(mx - cen.x) > view * 0.6 || Math.abs(mz - cen.z) > view * 0.6) continue;
        const [x, y] = W2M(mx, mz);
        if (x < LW || x > SW || y < 0 || y > MAPH) continue;
        c.save(); c.translate(x, y);
        let a = Math.atan2(e.dz, e.dx) + this.rotAngle(); if (a > Math.PI / 2) a -= Math.PI; if (a < -Math.PI / 2) a += Math.PI;
        c.rotate(a); c.fillText(e.name, 0, 0); c.restore();
      }
    }
    // POIs
    for (const p of city.pois) {
      const [x, y] = W2M(p.x, p.z);
      if (x < LW - 20 || x > SW + 20 || y < -20 || y > MAPH + 20) continue;
      const isDest = g.nav.dest === p;
      if (p.cat === 'charger') {
        c.save(); c.translate(x - 13, y - 30); this.icon('pin', 0, 0, 26, isDest ? BLUE : RED); this.icon('bolt', 7.5, 4.5, 11, '#fff'); c.restore();
      } else {
        c.beginPath(); c.arc(x, y - 4, isDest ? 9 : 6, 0, 7); c.fillStyle = isDest ? BLUE : '#7d8288'; c.fill(); c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke();
      }
      if (z > 1.0 || isDest) this.text(p.name, x, y + 12, 12, T.text, { w: 600, align: 'center' });
      this.hit(x - 16, y - 32, 32, 36, () => { this.panel = null; this.g.act.setDest(p); });
    }
    // car arrow
    const car = g.car, [cx, cy] = W2M(car.cx, car.cz);
    c.save(); c.translate(cx, cy); c.rotate(car.h + Math.PI / 2 + this.rotAngle());
    c.beginPath(); c.moveTo(0, -14); c.lineTo(10, 11); c.lineTo(0, 5); c.lineTo(-10, 11); c.closePath();
    c.fillStyle = RED; c.fill(); c.lineWidth = 3; c.strokeStyle = '#fff'; c.stroke(); c.restore();
    c.restore();
    this.wheelArea(LW, 0, MAPW, MAPH, (dy) => { this.zoom = clamp(this.zoom * (dy > 0 ? 0.87 : 1.15), 0.12, 4); });
  }

  // Shaded-relief image of the hills and mountains (built once from the terrain heights)
  reliefImage() {
    if (this._relief) return this._relief;
    const t = this.g.city.terrain, N = 512, span = t.size, cell = span / N;
    const cv = document.createElement('canvas'); cv.width = cv.height = N;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(N, N), d = img.data;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -span / 2 + (i + 0.5) * cell, z = -span / 2 + (j + 0.5) * cell;
      const h = t.heightAt(x, z), hx = t.heightAt(x + cell, z) - h, hz = t.heightAt(x, z + cell) - h;
      const shade = clamp(0.9 + (-hx * 0.7 - hz * 0.7) / cell * 0.7, 0.6, 1.08);
      let r = 214, g = 228, b = 200;
      if (h > 60) { const k = clamp((h - 60) / 300, 0, 1); r = lerp(r, 206, k); g = lerp(g, 200, k); b = lerp(b, 178, k); }
      if (h > 430) { const k = clamp((h - 430) / 120, 0, 1); r = lerp(r, 248, k); g = lerp(g, 250, k); b = lerp(b, 252, k); }
      const o = (j * N + i) * 4;
      d[o] = r * shade; d[o + 1] = g * shade; d[o + 2] = b * shade; d[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this._relief = cv;
    return cv;
  }

  drawTopBar(T) {
    const c = this.ctx, g = this.g, car = g.car;
    if (!(this.panel === 'camera' || car.gear === 'R')) { c.fillStyle = T.bar; c.fillRect(LW, 0, MAPW, 44); }
    const onDark = this.panel === 'camera' || car.gear === 'R';
    const col = onDark ? '#f2f2f2' : T.text;
    // battery in the left panel, like the car
    const lc = T.vizText;
    this.text(`${Math.round(car.rangeMi)} mi`, LW - 62, 24, 17, lc, { w: 500, align: 'right' });
    c.strokeStyle = lc; c.lineWidth = 1.6; this.rr(LW - 54, 17, 30, 14, 3); c.stroke();
    c.fillStyle = car.battery < 0.1 ? RED : car.charging ? GREEN : lc; c.fillRect(LW - 52, 19, 26 * clamp(car.battery, 0.03, 1), 10);
    c.fillRect(LW - 23, 21, 2.5, 6);
    this.icon(g.state.locked ? 'lock' : 'unlock', LW + 22, 12, 22, col, 2);
    this.hit(LW + 14, 6, 38, 34, () => g.act.lock());
    this.text(fmtTime(g.state.hours), LW + 112, 24, 18, col, { w: 600, align: 'center' });
    this.text(`${Math.round(g.state.temp)}°F`, LW + 188, 24, 18, col, { w: 500, align: 'center' });
    this.icon('airbag', LW + 228, 10, 24, onDark ? '#e5484d' : '#e5484d');
    this.icon('user', LW + 272, 11, 22, col, 2);
    this.text('Rudy', LW + 300, 24, 18, col, { w: 500 });
  }

  // the Supercharger we're heading for, once we're close and not yet in its lot
  chargerLot() {
    const g = this.g, car = g.car, d = g.nav && g.nav.dest;
    if (!d || d.cat !== 'charger' || !d.lot || car.charging || car.gear === 'R') return null;
    if (Math.hypot(car.cx - d.x, car.cz - d.z) > 170) return null;
    return d.lot;
  }
  // Site map of the Supercharger: the stall row seen at an angle, cars in the occupied stalls, free
  // stalls outlined in blue; tap one and Self-Driving backs into it
  drawStallPicker(T, lot) {
    const c = this.ctx, g = this.g, fsd = g.fsd;
    const x0 = 62, y0 = 192, w = 466, h = 400;
    this.fillRR(x0, y0, w, h, 18, '#26272b', true);
    this.text('Tesla Supercharger', x0 + 46, y0 + 24, 13, '#9a9ca2', { w: 500 });
    this.icon('bolt', x0 + 18, y0 + 13, 20, RED);
    this.text(lot.poi.name.replace('Supercharger ', ''), x0 + 46, y0 + 46, 20, '#f2f2f2', { w: 600 });
    const target = fsd.engaged && fsd.dest && fsd.dest.lot === lot && fsd.stall ? fsd.stall : fsd.pickStall(lot);
    this.text(fsd.chosenStall === target ? `Backing into stall ${target.k + 1}` : 'Tap a stall to choose where to park', x0 + 18, y0 + h - 22, 13, '#b8babf', { w: 500 });
    c.save();
    c.beginPath(); c.roundRect(x0, y0 + 62, w, h - 96, 0); c.clip();
    const S0 = lot.stalls[0].u, S1 = lot.stalls[lot.stalls.length - 1].u;
    const uC = (S0 + S1) / 2, wC = 25, k = Math.min(10, 330 / ((S1 - S0 + 4) * 0.86)), ox = x0 + w / 2, oy = y0 + 62 + (h - 96) / 2 + 4;
    const P = (u, ww) => [ox + ((u - uC) * 0.86 - (ww - wC) * 0.62) * k, oy + ((u - uC) * 0.34 + (ww - wC) * 0.66) * k];
    const quad = (u0, u1, w0, w1, fill, stroke, lw = 1.5) => {
      c.beginPath(); [[u0, w0], [u1, w0], [u1, w1], [u0, w1]].forEach(([u, ww], i) => { const [x, y] = P(u, ww); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.closePath();
      if (fill) { c.fillStyle = fill; c.fill(); }
      if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
    };
    // street, sidewalk with the driveway, the lot
    quad(10, 110, -7.6, 7.6, '#45464b');
    for (let u = 12; u < 108; u += 6) quad(u, u + 3, -0.12, 0.12, '#6c6d72');
    quad(10, 32, 7.6, 11.6, '#57585d'); quad(40, 110, 7.6, 11.6, '#57585d');
    quad(29, 85, 11.6, 31.5, '#34353a');
    quad(32, 40, 7.6, 11.6, '#34353a');
    // stalls, cars and charger posts
    const hitBoxes = [];
    for (const st of lot.stalls) {
      const u = st.u, mine = st === target;
      if (st.occupied) {
        quad(u - 1.45, u + 1.45, 24.1, 29.9, null, '#55565b', 1);
        quad(u - 0.95, u + 0.95, 24.6, 29.4, '#9b9da2');
        quad(u - 0.8, u + 0.8, 25.6, 28.2, '#c9cbcf');
        quad(u - 0.7, u + 0.7, 25.9, 26.6, '#6f7176');
      } else {
        quad(u - 1.35, u + 1.35, 24.2, 29.8, mine ? 'rgba(62,106,225,0.85)' : 'rgba(62,106,225,0.22)', mine ? '#9db8ff' : '#4f7cf0', mine ? 2.5 : 1.8);
        const pts = [[u - 1.4, 24.1], [u + 1.4, 24.1], [u + 1.4, 29.9], [u - 1.4, 29.9]].map(([a, b]) => P(a, b));
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        hitBoxes.push([Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), st]);
      }
      quad(u - 1.15, u - 0.75, 30.1, 30.7, '#e9e9eb');
      quad(u - 1.15, u - 0.75, 30.1, 30.25, RED);
    }
    // our car, if it's in the picture
    const me = g.city.edgeLocal(lot.edge, g.car.x, g.car.z);
    if (me.u > 8 && me.u < 112 && me.w > -10 && me.w < 34) {
      const [x, y] = P(me.u, me.w);
      c.beginPath(); c.arc(x, y, 7, 0, 7); c.fillStyle = '#ffffff'; c.fill(); c.lineWidth = 3; c.strokeStyle = BLUE; c.stroke();
    }
    c.restore();
    for (const [x, y, ww, hh, st] of hitBoxes) this.hit(x, y, ww, hh, () => g.act.chooseStall(lot, st));
  }

  drawLeft(T, dt) {
    const c = this.ctx, g = this.g, car = g.car, fsd = g.fsd;
    const park = this.parkView();
    // FSD button (top left)
    if (fsd.engaged) {
      this.fillRR(18, 10, 300, 52, 26, BLUE, true);
      this.icon('wheel', 32, 22, 28, '#fff', 2.4);
      this.text('Self-Driving (Supervised)', 70, 30, 17, '#fff', { w: 600 });
      const off = Math.round(fsd.vOff / 0.44704);
      this.text(`${fsd.profile} · ${off >= 0 ? '+' : ''}${off} mph`, 70, 48, 12, 'rgba(255,255,255,0.8)', { w: 500 });
      this.hit(18, 10, 300, 52, () => g.act.fsdButton());
    } else {
      const avail = g.fsdAvailable();
      this.fillRR(18, 10, 352, 52, 26, avail.ok ? BLUE : '#8a8f96', true);
      this.icon('wheel', 32, 22, 28, '#fff', 2.4);
      this.text('Start Supervised Full Self-Driving', 70, 36, 17, '#fff', { w: 600 });
      this.hit(18, 10, 352, 52, () => g.act.fsdButton());
    }
    if (park) {
      // car status view labels
      const lab = (key, pt, title) => {
        const [x, y, ok] = this.viz.project(pt, LW, MAPH);
        if (!ok) return;
        const open = g.model.isOpen(key);
        this.text(title, x, y - 10, 15, T.sub, { w: 500, align: 'center' });
        this.text(open ? 'Close' : 'Open', x, y + 10, 19, T.vizText, { w: 600, align: 'center' });
        this.hit(x - 45, y - 26, 90, 50, () => g.act.toggle(key));
      };
      lab('frunk', new THREE.Vector3(-0.2, 1.25, -2.2), 'Frunk');
      lab('trunk', new THREE.Vector3(0.2, 2.15, 2.0), 'Trunk');
      const [lx, ly, lok] = this.viz.project(new THREE.Vector3(0, 2.05, 0.3), LW, MAPH);
      if (lok) { this.icon(g.state.locked ? 'lock' : 'unlock', lx - 13, ly - 13, 26, T.vizText, 2.2); this.hit(lx - 22, ly - 22, 44, 44, () => g.act.lock()); }
      const [bx, by, bok] = this.viz.project(new THREE.Vector3(-1.15, 1.05, 2.1), LW, MAPH);
      if (bok) { this.icon('bolt', bx - 12, by - 12, 24, g.model.chargeTarget > 0.5 ? GREEN : T.vizText); this.hit(bx - 22, by - 22, 44, 44, () => g.act.chargePort()); }
      this.text('Tap a door to open it', LW / 2, MAPH - 150, 14, T.sub, { align: 'center' });
    } else {
      // speed, gear and limit
      const mph = Math.round(Math.abs(car.v) * MPH);
      this.text(String(mph), 92, 122, 76, T.vizText, { w: 600, align: 'center' });
      this.text('MPH', 92, 170, 15, T.sub, { w: 600, align: 'center' });
      const lim = g.state.speedLimit;
      if (lim) {
        this.fillRR(176, 86, 58, 74, 8, '#ffffff'); c.strokeStyle = '#111'; c.lineWidth = 2.5; this.rr(181, 91, 48, 64, 5); c.stroke();
        this.text('SPEED', 205, 104, 10, '#111', { w: 700, align: 'center' }); this.text('LIMIT', 205, 116, 10, '#111', { w: 700, align: 'center' });
        this.text(String(lim), 205, 140, 26, '#111', { w: 700, align: 'center' });
      }
      if (fsd.engaged && fsd.status) {
        this.fillRR(250, 98, 270, 40, 20, T === THEME.night ? 'rgba(40,42,46,0.9)' : 'rgba(255,255,255,0.92)', true);
        this.text(fsd.status, 385, 118, 14, T.vizText, { w: 500, align: 'center', max: 250 });
      }
      const lotNear = this.chargerLot();
      if (lotNear) this.drawStallPicker(T, lotNear);
      // turn signal arrows
      const on = g.state.blinkOn;
      if ((car.signal === 'L' || car.hazard) && on) this.icon('arrowL', 250, 150, 30, GREEN, 3);
      if ((car.signal === 'R' || car.hazard) && on) this.icon('arrowR', 480, 150, 30, GREEN, 3);
      // park assist distance (vision based)
      if (car.gear === 'R' && g.state.rearGap < 3.5) {
        const d = g.state.rearGap, col = d < 0.6 ? RED : d < 1.5 ? '#f5a623' : GREEN;
        this.fillRR(LW / 2 - 70, MAPH - 120, 140, 46, 23, col, true);
        this.text(`${Math.max(0, Math.round(d * 39.37))} in`, LW / 2, MAPH - 97, 20, '#fff', { w: 700, align: 'center' });
      }
    }
    // gear selector strip (Juniper: on-screen drive mode)
    const gears = ['P', 'R', 'N', 'D'];
    this.fillRR(10, 210, 40, 196, 20, T === THEME.night ? 'rgba(60,62,66,0.65)' : 'rgba(255,255,255,0.7)');
    gears.forEach((gg, i) => {
      const y = 232 + i * 46, act = car.gear === gg;
      if (act) this.fillRR(14, y - 19, 32, 38, 16, BLUE);
      this.text(gg, 30, y + 1, 19, act ? '#fff' : T.sub, { w: 700, align: 'center' });
      this.hit(10, y - 22, 40, 44, () => g.act.setGear(gg));
    });
    // charging card
    const st = g.state;
    if (car.charging || (park && st.chargeAvail)) {
      const y = MAPH - 128;
      this.fillRR(70, y, 400, 108, 16, T.card, true);
      if (car.charging) {
        this.text('Charging', 92, y + 26, 18, GREEN, { w: 700 });
        this.text(`${Math.round(car.battery * 100)}%  ·  ${Math.round(car.chargeKw)} kW  ·  +${Math.round(car.chargeKw * 3.9)} mi/hr`, 92, y + 54, 15, T.text, { w: 500 });
        const left = Math.max(0, (car.chargeLimit - car.battery) * 100 * 0.6);
        this.text(`${Math.ceil(left / 60) > 1 ? Math.ceil(left / 60) + ' min' : Math.ceil(left) + ' sec'} remaining to ${Math.round(car.chargeLimit * 100)}%`, 92, y + 80, 13, T.sub);
        this.fillRR(330, y + 34, 122, 44, 22, '#e8e8e8'); this.text('Stop', 391, y + 56, 16, '#171a20', { w: 600, align: 'center' });
        this.hit(330, y + 34, 122, 44, () => g.act.stopCharge());
      } else {
        this.text(st.chargeAvail.lot.poi.name, 92, y + 28, 16, T.text, { w: 700, max: 300 });
        this.text(`${st.chargeAvail.lot.poi.kw} kW available · Battery ${Math.round(car.battery * 100)}%`, 92, y + 54, 14, T.sub);
        this.fillRR(92, y + 68, 200, 32, 16, GREEN); this.text('Start Charging', 192, y + 84, 15, '#fff', { w: 600, align: 'center' });
        this.hit(92, y + 64, 200, 40, () => g.act.startCharge());
      }
    }
    if (this.alert && this.t < this.alert.until) {
      const a = this.alert, y = car.charging || (park && st.chargeAvail) ? MAPH - 200 : MAPH - 96;
      this.fillRR(40, y, LW - 80, 64, 14, a.color, true);
      this.text(a.title, 62, y + (a.sub ? 22 : 32), 17, '#fff', { w: 700, max: LW - 120 });
      if (a.sub) this.text(a.sub, 62, y + 44, 13, 'rgba(255,255,255,0.85)', { max: LW - 120 });
    }
  }

  drawSearchOrNav(T) {
    const g = this.g, nav = g.nav;
    const x = LW + 16, y = 54, w = 330;
    if (nav.dest) {
      const m = nav.maneuver();
      this.fillRR(x, y, w, 84, 14, '#1f2023', true);
      if (m) {
        if (m.dir === 'P') this.icon('flag', x + 16, y + 22, 40, '#fff', 3);
        else this.icon(m.dir === 'L' ? 'arrowL' : 'arrowR', x + 16, y + 20, 42, '#fff', 3);
        this.text(fmtDist(m.dist), x + 72, y + 30, 24, '#fff', { w: 700 });
        this.text(m.text, x + 72, y + 58, 14, '#cfd2d6', { max: w - 90 });
      } else this.text(nav.err || 'Calculating route…', x + 20, y + 42, 15, '#fff');
      // ETA card
      const rem = nav.remaining(), mins = Math.max(1, Math.round(rem / 8.5 / 60 + 0.3));
      const ey = 578;
      this.fillRR(x, ey, w, 56, 14, T.card, true);
      const arrive = fmtTime(g.state.hours + mins / 60);
      const batt = Math.max(0, Math.round((g.car.battery - rem / 25000) * 100));
      this.text(`${mins} min`, x + 18, ey + 20, 17, T.text, { w: 700 });
      this.text(`${fmtDist(rem)} · ${arrive}`, x + 18, ey + 40, 13, T.sub);
      this.icon('bolt', x + 188, ey + 18, 18, batt < 10 ? RED : T.sub);
      this.text(`${batt}%`, x + 210, ey + 28, 15, batt < 10 ? RED : T.text, { w: 600 });
      this.fillRR(x + w - 50, ey + 10, 36, 36, 18, T.chip); this.icon('close', x + w - 44, ey + 16, 24, T.text, 2.4);
      this.hit(x + w - 54, ey + 6, 44, 44, () => g.act.cancelNav());
      return;
    }
    // search field
    const s = this.search;
    this.fillRR(x, y, w, 50, 12, T.card, true);
    this.icon('search', x + 14, y + 13, 24, T.sub, 2.4);
    if (s.text || s.focused) {
      this.text(s.text, x + 48, y + 26, 18, T.text, { w: 500, max: w - 80 });
      if (s.focused && Math.floor(this.t * 2) % 2 === 0) {
        this.ctx.font = `500 18px ${FONT}`;
        const tw = Math.min(w - 80, this.ctx.measureText(s.text).width);
        this.ctx.fillStyle = BLUE; this.ctx.fillRect(x + 49 + tw, y + 13, 2, 26);
      }
    } else this.text('Navigate', x + 48, y + 26, 18, T.sub, { w: 500 });
    this.hit(x, y, w, 50, () => this.focusSearch());
    if (this.panel === 'search') {
      const list = this.results(), ly = y + 60, rowH = 62, maxRows = 7;
      const lh = Math.min(list.length, maxRows) * rowH + 40;
      this.fillRR(x, ly, w, lh, 14, T.card, true);
      this.text(s.text ? 'Results' : 'Places', x + 18, ly + 20, 14, T.sub, { w: 600 });
      this.fillRR(x + w - 40, ly + 6, 30, 30, 15, T.chip); this.icon('close', x + w - 36, ly + 10, 22, T.text, 2.2);
      this.hit(x + w - 44, ly + 2, 40, 38, () => { this.panel = null; this.blurSearch(); s.text = ''; });
      s.scroll = clamp(s.scroll, 0, Math.max(0, list.length - maxRows));
      const car = this.g.car;
      for (let i = 0; i < Math.min(maxRows, list.length - s.scroll); i++) {
        const p = list[i + s.scroll], ry = ly + 40 + i * rowH;
        if (i) { this.ctx.fillStyle = T.line; this.ctx.fillRect(x + 16, ry, w - 32, 1); }
        this.ctx.beginPath(); this.ctx.arc(x + 34, ry + rowH / 2, 16, 0, 7); this.ctx.fillStyle = p.cat === 'charger' ? RED : T.chip; this.ctx.fill();
        this.icon(p.cat === 'charger' ? 'bolt' : 'pin', x + 24, ry + rowH / 2 - 10, 20, p.cat === 'charger' ? '#fff' : T.sub);
        this.text(p.name, x + 62, ry + 22, 16, T.text, { w: 600, max: w - 140 });
        this.text(p.cat === 'charger' ? `${p.kw} kW max · ${p.address}` : p.address, x + 62, ry + 43, 13, T.sub, { max: w - 140 });
        this.text(fmtDist(Math.hypot(p.x - car.cx, p.z - car.cz)), x + w - 16, ry + rowH / 2, 13, T.sub, { align: 'right' });
        this.hit(x, ry, w, rowH, () => this.choose(p));
      }
      this.wheelArea(x, ly, w, lh, (dy) => { s.scroll += dy > 0 ? 1 : -1; });
    }
  }

  drawCharging(T) {
    const g = this.g, car = g.car, x = LW + 16, y = 54, w = 320, h = 560;
    this.fillRR(x, y, w, h, 14, T.card, true);
    this.text('Nearby Charging', x + 18, y + 30, 19, T.text, { w: 700 });
    this.icon('close', x + w - 38, y + 18, 22, T.text, 2.2);
    this.hit(x + w - 48, y + 8, 44, 44, () => { this.panel = null; });
    const fy = y + 62;
    ['bolt', 'plug', 'bolt'].forEach((ic, i) => { this.fillRR(x + 18 + i * 52, fy, 44, 32, 16, i === 0 ? T.chip : 'transparent'); this.icon(ic, x + 28 + i * 52, fy + 4, 24, i === 2 ? T.sub : T.text); });
    const list = g.city.pois.filter((p) => p.cat === 'charger').sort((a, b) => Math.hypot(a.x - car.cx, a.z - car.cz) - Math.hypot(b.x - car.cx, b.z - car.cz));
    const rowH = 76, top = fy + 46, maxRows = Math.floor((h - (top - y)) / rowH);
    this.chargeScroll = clamp(this.chargeScroll, 0, Math.max(0, list.length - maxRows));
    for (let i = 0; i < Math.min(maxRows, list.length - this.chargeScroll); i++) {
      const p = list[i + this.chargeScroll], ry = top + i * rowH;
      this.ctx.fillStyle = T.line; this.ctx.fillRect(x + 16, ry, w - 32, 1);
      this.text(p.name.replace('Supercharger ', 'Supercharger '), x + 18, ry + 28, 15, T.text, { w: 600, max: w - 90 });
      this.text(`${p.kw} kW max`, x + 18, ry + 50, 13, T.sub);
      this.ctx.save(); this.ctx.translate(x + w - 42, ry + 14); this.icon('pin', 0, 0, 24, RED); this.icon('bolt', 7, 4, 10, '#fff'); this.ctx.restore();
      this.text(fmtDist(Math.hypot(p.x - car.cx, p.z - car.cz)), x + w - 30, ry + 56, 12, T.sub, { align: 'center' });
      this.hit(x, ry, w, rowH, () => { this.panel = null; g.act.setDest(p); });
    }
    this.wheelArea(x, top, w, h - (top - y), (dy) => { this.chargeScroll += dy > 0 ? 1 : -1; });
  }

  drawToolbar(T) {
    const x = SW - 50, g = this.g;
    const items = [
      ['compass', () => { this.headingUp = !this.headingUp; }, this.headingUp],
      ['target', () => { this.pan = null; }, !!this.pan],
      ['bolt', () => { this.panel = this.panel === 'charging' ? null : 'charging'; }, this.panel === 'charging'],
      ['settings', () => { this.panel = this.panel === 'controls' ? null : 'controls'; }, this.panel === 'controls'],
    ];
    items.forEach(([ic, fn, act], i) => {
      const y = 60 + i * 56;
      this.fillRR(x - 4, y - 4, 44, 44, 22, act ? BLUE : T.card, true);
      this.icon(ic, x + 6, y + 6, 24, act ? '#fff' : T.text, 2.2);
      this.hit(x - 6, y - 6, 48, 48, fn);
    });
    // zoom buttons
    this.fillRR(x - 4, 296, 44, 88, 22, T.card, true);
    this.text('+', x + 18, 318, 26, T.text, { w: 500, align: 'center' });
    this.text('−', x + 18, 362, 26, T.text, { w: 500, align: 'center' });
    this.hit(x - 4, 296, 44, 44, () => { this.zoom = clamp(this.zoom * 1.3, 0.12, 4); });
    this.hit(x - 4, 340, 44, 44, () => { this.zoom = clamp(this.zoom / 1.3, 0.12, 4); });
  }

  drawMedia(T) {
    const g = this.g, a = g.audio, tr = TRACKS[a.track];
    const x = LW + 16, y = 648, w = MAPW - 32, h = 78;
    this.fillRR(x, y, w, h, 14, T.card, true);
    const grd = this.ctx.createLinearGradient(x + 10, y + 9, x + 70, y + 69);
    grd.addColorStop(0, `hsl(${tr.hue},70%,55%)`); grd.addColorStop(1, `hsl(${(tr.hue + 60) % 360},70%,25%)`);
    this.fillRR(x + 10, y + 9, 60, 60, 6, grd);
    this.text(tr.title, x + 84, y + 22, 16, T.text, { w: 700, max: 220 });
    this.text(tr.artist, x + 84, y + 41, 13, T.sub, { max: 220 });
    this.icon('music', x + 84, y + 52, 14, GREEN);
    this.text(tr.album, x + 103, y + 60, 12, T.sub, { max: 200 });
    const cx = x + 400;
    this.icon('heart', cx - 70, y + 27, 24, T.text, 2);
    this.icon('prev', cx - 20, y + 27, 24, T.text); this.hit(cx - 28, y + 16, 40, 44, () => a.skip(-1));
    this.fillRR(cx + 24, y + 19, 40, 40, 20, 'transparent');
    this.icon(a.playing ? 'pause' : 'play', cx + 32, y + 27, 26, T.text); this.hit(cx + 20, y + 14, 48, 50, () => { a.togglePlay(); });
    this.icon('next', cx + 86, y + 27, 24, T.text); this.hit(cx + 78, y + 16, 40, 44, () => a.skip(1));
    this.icon('shuffle', cx + 140, y + 27, 24, T.sub, 2);
    this.icon('list', x + w - 132, y + 27, 24, T.text, 2.2);
    this.icon('search', x + w - 90, y + 27, 24, T.text, 2.2);
    this.icon('eq', x + w - 46, y + 27, 24, T.text, 2);
  }

  drawControls(T) {
    const g = this.g, st = g.settings, x = LW + 16, y = 54, w = MAPW - 80, h = 580, c = this.ctx;
    this.fillRR(x, y, w, h, 16, T.card, true);
    this.text('Controls', x + 22, y + 30, 20, T.text, { w: 700 });
    this.icon('close', x + w - 40, y + 18, 22, T.text, 2.2); this.hit(x + w - 50, y + 8, 46, 46, () => { this.panel = null; });
    const tiles = [
      ['light', `Headlights: ${st.headlights}`, () => g.act.cycleHeadlights(), st.headlights !== 'Off'],
      [g.state.locked ? 'lock' : 'unlock', g.state.locked ? 'Locked' : 'Unlocked', () => g.act.lock(), g.state.locked],
      ['car', g.model.isOpen('frunk') ? 'Close Frunk' : 'Open Frunk', () => g.act.toggle('frunk'), g.model.isOpen('frunk')],
      ['car', g.model.isOpen('trunk') ? 'Close Trunk' : 'Open Trunk', () => g.act.toggle('trunk'), g.model.isOpen('trunk')],
      ['bolt', g.model.chargeTarget > 0.5 ? 'Close Port' : 'Charge Port', () => g.act.chargePort(), g.model.chargeTarget > 0.5],
      ['hazard', 'Hazards', () => g.act.hazard(), g.car.hazard],
    ];
    const tw = (w - 44 - 5 * 10) / 6;
    tiles.forEach(([ic, label, fn, act], i) => {
      const tx = x + 22 + i * (tw + 10), ty = y + 58;
      this.fillRR(tx, ty, tw, 88, 12, act ? BLUE : T.chip);
      this.icon(ic, tx + tw / 2 - 14, ty + 14, 28, act ? '#fff' : T.text, 2.2);
      this.text(label, tx + tw / 2, ty + 66, 12, act ? '#fff' : T.text, { w: 600, align: 'center', max: tw - 8 });
      this.hit(tx, ty, tw, 88, fn);
    });
    const seg = (label, yy, opts, cur, fn) => {
      this.text(label, x + 22, yy + 18, 15, T.text, { w: 600 });
      const sx = x + 230, sw = (w - 252) / opts.length;
      this.fillRR(sx, yy, w - 252, 38, 10, T.chip);
      opts.forEach((o, i) => {
        const on = String(o) === String(cur);
        if (on) this.fillRR(sx + i * sw + 3, yy + 3, sw - 6, 32, 8, T === THEME.night ? '#55575c' : '#ffffff');
        this.text(String(o), sx + i * sw + sw / 2, yy + 19, 14, on ? T.text : T.sub, { w: on ? 700 : 500, align: 'center' });
        this.hit(sx + i * sw, yy, sw, 38, () => fn(o));
      });
    };
    seg('Self-Driving profile', y + 170, Object.keys(PROFILES), g.fsd.profile, (o) => { g.fsd.setProfile(o, g.car); });
    seg('Show camera coverage', y + 220, ['Off', 'On'], st.showCones ? 'On' : 'Off', (o) => { st.showCones = o === 'On'; });
    seg('Time of day', y + 270, ['Morning', 'Afternoon', 'Sunset', 'Night'], st.timePreset || '', (o) => g.act.setTime(o));
    seg('Day/night speed', y + 320, ['Paused', '1x', '60x', '240x'], st.timeLabel, (o) => g.act.setTimeScale(o));
    seg('Graphics', y + 370, ['Low', 'High'], st.quality, (o) => g.act.setQuality(o));
    this.text('Paint', x + 22, y + 440, 15, T.text, { w: 600 });
    Object.entries(g.vehicle.paints).forEach(([name, col], i) => {
      const px = x + 230 + i * 62, py = y + 420;
      c.beginPath(); c.arc(px + 20, py + 20, 20, 0, 7); c.fillStyle = '#' + col.toString(16).padStart(6, '0'); c.fill();
      c.lineWidth = st.paint === name ? 4 : 1; c.strokeStyle = st.paint === name ? BLUE : '#9a9a9a'; c.stroke();
      this.hit(px, py, 40, 40, () => g.act.setPaint(name));
    });
    this.text(st.paint, x + 230, y + 478, 13, T.sub);
    this.text(`${g.vehicle.full} · Software 2026.38.6 · FSD (Supervised) v14`, x + 22, y + h - 26, 12, T.sub);
  }

  // all eight exterior cameras: pillars either side of the main camera, repeaters either side of the
  // wide camera, then the narrow and rear cameras
  camLayout() {
    const gap = 8, x0 = LW + 10, y0 = 50, w = (MAPW - 20 - gap * 2) / 3, h = (MAPH - 50 - 24 - gap * 2) / 3;
    const at = (col, row, id, ww = w) => ({ id, x: x0 + col * (w + gap), y: y0 + row * (h + gap), w: ww, h });
    return [
      at(0, 0, 'lpillar'), at(1, 0, 'main'), at(2, 0, 'rpillar'),
      at(0, 1, 'lrep'), at(1, 1, 'wide'), at(2, 1, 'rrep'),
      { ...at(0, 2, 'narrow'), w: (w * 3 + gap * 2 - gap) / 2 }, { ...at(0, 2, 'rear'), x: x0 + (w * 3 + gap * 2 + gap) / 2, w: (w * 3 + gap * 2 - gap) / 2 },
    ];
  }

  drawCameraFrames(T) {
    const c = this.ctx, g = this.g;
    c.clearRect(LW, 44, MAPW, MAPH - 44);
    for (const v of this.camLayout()) {
      c.clearRect(v.x, v.y, v.w, v.h);
      const cam = CAMERAS.find((k) => k.id === v.id);
      this.fillRR(v.x + 8, v.y + 8, 130, 26, 13, 'rgba(0,0,0,0.55)');
      this.text(cam.name, v.x + 18, v.y + 21, 13, '#fff', { w: 600 });
      // detections drawn from the vision tracks projected through this camera
      const pc = g.carCamera(v.id, v.w / v.h);
      c.save(); c.beginPath(); c.rect(v.x, v.y, v.w, v.h); c.clip();
      c.lineWidth = 2;
      for (const tr of g.vision.tracks.values()) {
        if (!tr.cams.includes(v.id)) continue;
        const box = this.projectBox(pc, tr, v);
        if (!box) continue;
        c.strokeStyle = tr.parked ? '#f5a623' : '#30d158'; c.strokeRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
        this.text(`${tr.type} ${Math.round(Math.hypot(tr.x - g.car.cx, tr.z - g.car.cz))}m`, box[0] + 2, box[1] - 8, 11, '#30d158', { w: 600 });
      }
      c.restore();
    }
    this.text('Vision: 8 cameras · objects outlined are what Self-Driving sees', LW + 20, MAPH - 10, 12, '#bbb');
    this.fillRR(SW - 58, 52, 44, 44, 22, '#222'); this.icon('close', SW - 48, 62, 24, '#fff', 2.4);
    this.hit(SW - 62, 48, 52, 52, () => { this.panel = null; });
  }
  projectBox(cam, tr, v) {
    const pts = [], hl = tr.L / 2, hw = tr.W / 2, c = Math.cos(tr.h), s = Math.sin(tr.h);
    for (const a of [-hl, hl]) for (const b of [-hw, hw]) for (const y of [0, tr.H]) {
      const p = new THREE.Vector3(tr.x + c * a - s * b, y, tr.z + s * a + c * b).project(cam);
      if (p.z > 1 || p.z < -1) return null;
      pts.push([v.x + (p.x * 0.5 + 0.5) * v.w, v.y + (1 - (p.y * 0.5 + 0.5)) * v.h]);
    }
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  drawReverse(T) {
    const c = this.ctx, v = { x: LW + 8, y: 46, w: MAPW - 16, h: MAPH - 54 };
    c.clearRect(v.x, v.y, v.w, v.h);
    // guide lines following the current steering angle
    // guide lines: reversing with steer k bends the rear toward the car's right by k*d^2/2
    const car = this.g.car, pc = this.g.carCamera('rear', v.w / v.h);
    const k = Math.tan(car.steer) / WHEELBASE, fx = Math.cos(car.h), fz = Math.sin(car.h);
    const bx = car.x - fx * 0.95, bz = car.z - fz * 0.95;
    for (const side of [-0.95, 0.95]) {
      c.beginPath();
      let first = true;
      for (let d = 0.4; d <= 5; d += 0.2) {
        const lat = side + (k * d * d) / 2;
        const px = bx - fx * d - fz * lat, pz = bz - fz * d + fx * lat;
        const p = new THREE.Vector3(px, 0.02, pz).project(pc);
        const sx = v.x + (p.x * 0.5 + 0.5) * v.w, sy = v.y + (1 - (p.y * 0.5 + 0.5)) * v.h;
        if (first) { c.moveTo(sx, sy); first = false; } else c.lineTo(sx, sy);
      }
      c.strokeStyle = 'rgba(255,214,10,0.9)'; c.lineWidth = 4; c.stroke();
    }
    this.fillRR(v.x + 10, v.y + 10, 100, 28, 14, 'rgba(0,0,0,0.55)');
    this.text('Rear camera', v.x + 22, v.y + 24, 13, '#fff', { w: 600 });
  }

  drawBottom(T) {
    const c = this.ctx, g = this.g, st = g.state, y = MAPH;
    c.fillStyle = '#0d0d0e'; c.fillRect(0, y, SW, BB);
    const ic = '#d6d6d6', cy = y + BB / 2;
    this.icon('car', 30, cy - 14, 30, ic, 2); this.hit(16, y, 60, BB, () => { this.panel = this.panel === 'controls' ? null : 'controls'; });
    this.icon('chevL', 160, cy - 12, 24, '#8a8a8a', 2.4); this.hit(150, y, 40, BB, () => { st.driverTemp = Math.max(60, st.driverTemp - 1); });
    this.text(String(st.driverTemp), 214, cy + 1, 26, '#f2f2f2', { w: 500, align: 'center' });
    this.icon('chevR', 244, cy - 12, 24, '#8a8a8a', 2.4); this.hit(236, y, 40, BB, () => { st.driverTemp = Math.min(84, st.driverTemp + 1); });
    const seatIcon = (x, lvl, fn) => { this.icon('seat', x, cy - 14, 26, lvl ? '#ff6b3d' : ic, 2.2); for (let i = 0; i < 3; i++) { c.fillStyle = i < lvl ? '#ff6b3d' : '#444'; c.fillRect(x + 2 + i * 8, cy + 15, 6, 3); } this.hit(x - 8, y, 44, BB, fn); };
    seatIcon(340, st.seatL, () => { st.seatL = (st.seatL + 1) % 4; });
    this.icon('phone', 456, cy - 12, 24, GREEN); this.hit(446, y, 44, BB, () => this.showAlert('Phone', 'No phone connected via Bluetooth'));
    this.icon('camera', 530, cy - 12, 26, ic, 2.2); this.hit(518, y, 48, BB, () => { this.panel = this.panel === 'camera' ? null : 'camera'; });
    this.icon('dots', 598, cy - 12, 24, ic); this.hit(586, y, 44, BB, () => this.showAlert('Toybox', 'Not available while driving'));
    this.icon('music', 670, cy - 13, 26, GREEN); this.hit(656, y, 50, BB, () => g.audio.togglePlay());
    this.icon('chart', 740, cy - 13, 26, GREEN); this.hit(726, y, 50, BB, () => this.showAlert('Energy', `${Math.round(g.car.battery * 100)}% · ${Math.round(g.car.rangeMi)} mi estimated range`));
    this.icon('grid', 810, cy - 12, 24, ic); this.hit(796, y, 48, BB, () => { this.panel = this.panel === 'controls' ? null : 'controls'; });
    seatIcon(990, st.seatR, () => { st.seatR = (st.seatR + 1) % 4; });
    this.icon('chevL', 1080, cy - 12, 24, '#8a8a8a', 2.4); this.hit(1070, y, 40, BB, () => { st.passTemp = Math.max(60, st.passTemp - 1); });
    this.text(String(st.passTemp), 1130, cy + 1, 26, '#f2f2f2', { w: 500, align: 'center' });
    this.icon('chevR', 1160, cy - 12, 24, '#8a8a8a', 2.4); this.hit(1152, y, 40, BB, () => { st.passTemp = Math.min(84, st.passTemp + 1); });
    this.icon('volume', 1272, cy - 12, 24, ic);
    if (g.audio.muted) { this.icon('close', 1290, cy - 8, 16, ic, 2.4); }
    else { c.strokeStyle = ic; c.lineWidth = 2; c.beginPath(); c.arc(1286, cy, 7, -0.8, 0.8); c.stroke(); }
    this.hit(1260, y, 60, BB, () => g.audio.setMuted(!g.audio.muted));
    this.wheelArea(1240, y, 104, BB, (dy) => g.audio.setVolume(g.audio.volume + (dy > 0 ? -0.08 : 0.08)));
  }

  // ---------- render into the screen texture
  renderRT(dt) {
    const r = this.r, g = this.g;
    const prevTarget = r.getRenderTarget();
    const ac = r.autoClear; r.autoClear = false;
    // clear all (except while the camera grid is up: its views refresh a couple per frame and keep
    // their last picture in between)
    const camApp = this.panel === 'camera';
    if (!camApp || !this.camWasOpen) {
      this.rt.viewport.set(0, 0, SW, SH); this.rt.scissor.set(0, 0, SW, SH); this.rt.scissorTest = false;
      r.setRenderTarget(this.rt); r.setClearColor(0x000000, 1); r.clear();
    }
    // visualization (left)
    this.viz.setTheme(g.state.night > 0.5);
    this.viz.update(dt, g.vizState());
    this.viz.render(r, this.rt, 0, BB, LW, MAPH);
    // cameras
    this.camTimer -= dt;
    if (camApp) {
      const views = this.camLayout();
      const n = this.camWasOpen ? 2 : views.length;
      for (let i = 0; i < n; i++) { const v = views[(this.camRR = ((this.camRR || 0) + 1) % views.length)]; g.renderCam(v.id, this.rt, v.x, SH - v.y - v.h, v.w, v.h); }
    } else if (g.car.gear === 'R') {
      g.renderCam('rear', this.rt, LW + 8, SH - 46 - (MAPH - 54), MAPW - 16, MAPH - 54);
    }
    // 2D overlay
    this.rt.viewport.set(0, 0, SW, SH); this.rt.scissor.set(0, 0, SW, SH); this.rt.scissorTest = false;
    r.setRenderTarget(this.rt);
    r.render(this.oScene, this.oCam);
    r.setRenderTarget(prevTarget);
    r.autoClear = ac;
    this.camWasOpen = camApp;
  }
}
