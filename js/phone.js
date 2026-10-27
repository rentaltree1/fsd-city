// The phone you carry on foot (press 1): the Tesla app, with lock, climate, frunk/trunk, flash and honk,
// and Smart Summon — a map with you (blue dot) and the car (red arrow), the planned route in blue and a
// Come to Me button.
import { SUMMON_RANGE } from './fsd.js';

const ICON = {
  lock: '<path d="M7 11V8a5 5 0 0 1 10 0v3"/><rect x="5" y="11" width="14" height="10" rx="2"/>',
  unlock: '<path d="M7 11V8a5 5 0 0 1 9.6-2"/><rect x="5" y="11" width="14" height="10" rx="2"/>',
  fan: '<circle cx="12" cy="12" r="2"/><path d="M12 10c0-4 1-7 4-7 2 0 2 3 0 5M14 12c4 0 7 1 7 4 0 2-3 2-5 0M12 14c0 4-1 7-4 7-2 0-2-3 0-5M10 12c-4 0-7-1-7-4 0-2 3-2 5 0"/>',
  frunk: '<path d="M3 15h18M5 15l2-6h10l2 6M7 9l1-3h8l1 3"/>',
  flash: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z"/>',
  summon: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  horn: '<path d="M4 10v4h4l6 4V6l-6 4H4zM17 9a4 4 0 0 1 0 6M19.5 6.5a7.5 7.5 0 0 1 0 11"/>',
  bolt: '<path d="M13 2 5 14h6l-1 8 9-13h-6z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chev: '<path d="M9 5l7 7-7 7"/>',
};
const svg = (k, s = 22, c = '#171a20', w = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

// side view of a Model Y for the app's home screen
const CAR_SVG = `<svg viewBox="0 0 400 140" aria-hidden="true">
  <defs><linearGradient id="phb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9dcdf"/><stop offset=".55" stop-color="#b3b7bb"/><stop offset="1" stop-color="#8d9196"/></linearGradient></defs>
  <ellipse cx="200" cy="128" rx="170" ry="7" fill="rgba(0,0,0,.12)"/>
  <path d="M24 98c0-12 6-22 20-26l56-12c22-20 52-34 92-36 40-1 76 10 108 30l46 8c20 4 30 16 30 30v10c0 6-4 10-10 10H34c-6 0-10-4-10-10z" fill="url(#phb)"/>
  <path d="M112 60c22-18 48-28 82-29 34 0 64 9 92 28z" fill="#22262b"/>
  <path d="M196 32v28M120 92h210" stroke="#9aa0a6" stroke-width="2"/>
  <path d="M30 86h28M350 86h26" stroke="#e5e7e9" stroke-width="3" stroke-linecap="round"/>
  <circle cx="92" cy="110" r="22" fill="#1d1f22"/><circle cx="92" cy="110" r="12" fill="#6e7378"/>
  <circle cx="314" cy="110" r="22" fill="#1d1f22"/><circle cx="314" cy="110" r="12" fill="#6e7378"/>
</svg>`;

// the Cybertruck's faceted side profile
const TRUCK_SVG = `<svg viewBox="0 0 400 140" aria-hidden="true">
  <defs><linearGradient id="phc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d6d9dc"/><stop offset="1" stop-color="#9ea2a6"/></linearGradient></defs>
  <ellipse cx="200" cy="128" rx="178" ry="7" fill="rgba(0,0,0,.12)"/>
  <path d="M16 92 L30 62 L196 22 L392 62 L392 96 L380 106 L22 106 Z" fill="url(#phc)"/>
  <path d="M118 52 L196 26 L290 46 Z" fill="#22262b"/>
  <path d="M16 92 H392" stroke="#2a2b2d" stroke-width="3"/>
  <path d="M30 62 H120" stroke="#f2f4f6" stroke-width="3"/>
  <path d="M52 82 L82 74 L124 74 L140 96 L48 96 Z M262 82 L292 74 L336 74 L350 96 L256 96 Z" fill="#26272a"/>
  <circle cx="96" cy="106" r="24" fill="#1d1f22"/><circle cx="96" cy="106" r="13" fill="#55595e"/>
  <circle cx="304" cy="106" r="24" fill="#1d1f22"/><circle cx="304" cy="106" r="13" fill="#55595e"/>
</svg>`;

export class Phone {
  constructor(game, player) {
    this.g = game; this.player = player; this.open = false; this.page = 'home'; this.mapT = 0;
    this.el = document.getElementById('phone');
    this.el.innerHTML = `<div class="ph"><div class="ph-notch"></div>
      <div class="ph-bar"><span data-k="clock">9:41</span><span>5G ▮▮▮ ${''}<span data-k="pbatt">100%</span></span></div>
      <div class="ph-page on" data-p="home">
        <div class="ph-head"><div class="ph-name" data-k="vname">Rudy's Model Y</div><div class="ph-sub"><span class="ph-batt"><i data-k="bbar"></i></span><span data-k="range"></span><span data-k="pstate"></span></div></div>
        <div class="ph-car" data-k="carpic">${CAR_SVG}</div>
        <div class="ph-quick">
          <button class="ph-q" data-a="lock"><span data-k="lockico"></span><b data-k="locklbl">Lock</b></button>
          <button class="ph-q" data-a="climate"><span>${svg('fan')}</span><b>Climate</b></button>
          <button class="ph-q" data-a="frunk"><span>${svg('frunk')}</span><b>Frunk</b></button>
          <button class="ph-q" data-a="flash"><span>${svg('flash')}</span><b>Flash</b></button>
        </div>
        <div class="ph-list">
          <button class="ph-row" data-a="summon">${svg('summon', 24, '#3e6ae1')}<span>Smart Summon<small data-k="sumsub">Bring your car to you</small></span><span class="chev">${svg('chev', 18, '#a2a3a5')}</span></button>
          <button class="ph-row" data-a="honk">${svg('horn', 24)}<span>Honk Horn<small>Find your car</small></span></button>
          <button class="ph-row" data-a="trunk">${svg('frunk', 24)}<span>Open Trunk<small data-k="trunksub">Closed</small></span></button>
          <div class="ph-row" style="cursor:default">${svg('bolt', 24, '#33a852')}<span>Charging<small data-k="chg">Not plugged in</small></span></div>
        </div>
      </div>
      <div class="ph-page" data-p="summon">
        <div class="ph-top"><button class="ph-back" data-a="home" aria-label="Back">${svg('back', 22)}</button>Smart Summon</div>
        <div class="ph-map"><canvas></canvas><div class="ph-chip" data-k="chip"></div></div>
        <div class="ph-foot"><button class="ph-go" data-a="go">${svg('summon', 20, '#fff')}<span data-k="golbl">Come to Me</span></button>
          <div class="ph-note">Max 8 mph · stay within ${Math.round(SUMMON_RANGE * 3.28)} ft (${SUMMON_RANGE} m) · keep watching your car<br>Enter: Come to Me / Stop · 1: put the phone away</div></div>
      </div></div>`;
    this.k = {};
    this.el.querySelectorAll('[data-k]').forEach((n) => { this.k[n.dataset.k] = n; });
    this.canvas = this.el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.el.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-a]');
      if (!b) return;
      this.action(b.dataset.a);
    });
    this.climate = false;
  }

  toggle(force) {
    this.open = force ?? !this.open;
    this.el.classList.toggle('open', this.open);
    this.el.setAttribute('aria-hidden', String(!this.open));
    if (this.open) { document.exitPointerLock?.(); this.refresh(); }
  }
  show(p) {
    this.page = p;
    this.el.querySelectorAll('.ph-page').forEach((n) => n.classList.toggle('on', n.dataset.p === p));
    this.refresh();
  }
  action(a) {
    const act = this.g.act;
    if (a === 'home' || a === 'summon') { this.show(a); return; }
    if (a === 'lock') act.phoneLock();
    else if (a === 'climate') { this.climate = !this.climate; this.g.audio.chime('click'); }
    else if (a === 'frunk') act.toggle('frunk');
    else if (a === 'trunk') act.toggle('trunk');
    else if (a === 'flash') act.flash();
    else if (a === 'honk') act.honk();
    else if (a === 'go') {
      if (this.g.fsd.summon) act.stopSummon('Smart Summon stopped');
      else { const err = act.summon(); this.msg = err ? { t: err, err: true, until: performance.now() + 4000 } : null; }
    }
    this.refresh();
  }
  // keyboard shortcuts while the phone is out: Enter = Smart Summon / Come to Me / Stop, Backspace = back
  key(code) {
    if (code === 'Enter' || code === 'NumpadEnter') { this.action(this.page === 'summon' ? 'go' : 'summon'); return true; }
    if (code === 'Backspace') { this.show('home'); return true; }
    return false;
  }
  note(t, err = false) { this.msg = { t, err, until: performance.now() + 5000 }; this.refresh(); }

  refresh() {
    const g = this.g, car = g.car, st = g.state, k = this.k;
    const vn = g.vehicle ? g.vehicle.name : 'Model Y';
    if (this.vname !== vn) { this.vname = vn; k.vname.textContent = `Rudy's ${vn}`; k.carpic.innerHTML = vn === 'Cybertruck' ? TRUCK_SVG : CAR_SVG; }
    const now = new Date(); k.clock.textContent = `${((now.getHours() + 11) % 12) + 1}:${String(now.getMinutes()).padStart(2, '0')}`;
    k.pbatt.textContent = '82%';
    k.bbar.style.width = `${Math.max(2, Math.round(car.battery * 18))}px`;
    k.range.textContent = `${Math.round(car.battery * 100)}% · ${Math.round(car.rangeMi)} mi`;
    k.pstate.textContent = g.fsd.summon ? '· Summoning' : Math.abs(car.v) > 0.3 ? '· Moving' : car.charging ? '· Charging' : '· Parked';
    k.lockico.innerHTML = svg(st.locked ? 'lock' : 'unlock', 22, st.locked ? '#fff' : '#171a20');
    k.lockico.parentElement.classList.toggle('active', st.locked);
    k.locklbl.textContent = st.locked ? 'Locked' : 'Unlocked';
    this.el.querySelector('[data-a="climate"]').classList.toggle('active', this.climate);
    k.trunksub.textContent = g.model.isOpen('trunk') ? 'Open' : 'Closed';
    k.chg.textContent = car.charging ? `Charging · ${Math.round(car.chargeKw)} kW` : 'Not plugged in';
    // summon page
    const p = this.player, d = Math.hypot(p.x - car.cx, p.z - car.cz), sm = g.fsd.summon;
    k.golbl.textContent = sm ? 'Stop' : 'Come to Me';
    k.golbl.parentElement.classList.toggle('stop', !!sm);
    k.sumsub.textContent = sm ? (g.fsd.summonStatus || 'Coming to you') : d > SUMMON_RANGE ? `Car is ${Math.round(d)} m away` : 'Bring your car to you';
    let chip;
    if (this.msg && performance.now() < this.msg.until) chip = this.msg.err ? `<b>Can't summon:</b> ${this.msg.t}` : this.msg.t;
    else if (sm) chip = `<b>${g.fsd.summonStatus || 'Coming to you'}</b> · ${(Math.abs(car.v) * 2.237).toFixed(0)} mph · ${Math.round(d)} m away`;
    else if (p.mode !== 'foot') chip = 'Get out of the car to use Smart Summon';
    else if (d > SUMMON_RANGE) chip = `Your car is <b>${Math.round(d)} m</b> away — move within ${SUMMON_RANGE} m`;
    else chip = `Your car is <b>${Math.round(d)} m</b> away · tap Come to Me`;
    k.chip.innerHTML = chip;
    k.golbl.parentElement.disabled = !sm && (p.mode !== 'foot' || d > SUMMON_RANGE);
  }

  update(dt) {
    if (!this.open) return;
    this.mapT -= dt;
    if (this.mapT > 0) return;
    this.mapT = 1 / 30;
    this.refresh();
    if (this.page === 'summon') this.drawMap();
  }

  drawMap() {
    const cv = this.canvas, r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.max(10, Math.round(r.width * dpr)), H = Math.max(10, Math.round(r.height * dpr));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const c = this.ctx, g = this.g, car = g.car, city = g.city, p = this.player;
    // frame the person and the car (and the route) with some room around them
    let mnx = Math.min(p.x, car.cx), mxx = Math.max(p.x, car.cx), mnz = Math.min(p.z, car.cz), mxz = Math.max(p.z, car.cz);
    const route = g.fsd.summon && g.fsd.path ? g.fsd.path : null;
    if (route) for (let i = g.fsd.idx; i < route.n; i += 4) { mnx = Math.min(mnx, route.x[i]); mxx = Math.max(mxx, route.x[i]); mnz = Math.min(mnz, route.z[i]); mxz = Math.max(mxz, route.z[i]); }
    const span = Math.max(46, (mxx - mnx) * 1.35 + 18, ((mxz - mnz) * 1.35 + 18) * (W / H));
    // (shifted down a little so the status chip at the top doesn't cover anything)
    const s = W / span, vx = (mnx + mxx) / 2, vz = (mnz + mxz) / 2 - (22 * dpr) / s;
    const X = (x) => W / 2 + (x - vx) * s, Z = (z) => H / 2 + (z - vz) * s;
    const inView = (x, z, m = 30) => Math.abs(x - vx) < span / 2 + m && Math.abs(z - vz) < (span * H) / W / 2 + m;
    c.fillStyle = '#1d2023'; c.fillRect(0, 0, W, H);
    // grass blocks are the background; streets as wide strokes
    c.lineCap = 'round';
    for (const e of city.edges) {
      if (e.a > e.b) continue;
      const a = city.edgePoint(e, 0, 0), b = city.edgePoint(e, e.len, 0);
      if (!inView(a.x, a.z, e.len) && !inView(b.x, b.z, e.len)) continue;
      c.strokeStyle = '#3b3e43'; c.lineWidth = Math.max(2, e.hw * 2 * s);
      c.beginPath();
      if (e.curve) { for (let u = 0; u <= e.len; u += 6) { const q = city.edgePoint(e, u, 0); u ? c.lineTo(X(q.x), Z(q.z)) : c.moveTo(X(q.x), Z(q.z)); } }
      else { c.moveTo(X(a.x), Z(a.z)); c.lineTo(X(b.x), Z(b.z)); }
      c.stroke();
    }
    // buildings
    c.fillStyle = '#2c3035';
    for (const bd of city.buildings) {
      const q = bd.pts[0];
      if (!inView(q[0] ?? q.x, q[1] ?? q.z, 60)) continue;
      c.beginPath();
      bd.pts.forEach((pt, i) => { const x = pt[0] ?? pt.x, z = pt[1] ?? pt.z; i ? c.lineTo(X(x), Z(z)) : c.moveTo(X(x), Z(z)); });
      c.closePath(); c.fill();
    }
    // parking lots: asphalt and stall lines
    for (const lot of city.lots) {
      const poly = lot.poi && lot.poi.lotPoly;
      if (!poly || !inView(poly[0].x, poly[0].z, 120)) continue;
      c.fillStyle = '#34373c'; c.beginPath(); poly.forEach((q, i) => (i ? c.lineTo(X(q.x), Z(q.z)) : c.moveTo(X(q.x), Z(q.z)))); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.32)'; c.lineWidth = Math.max(1, 0.12 * s);
      c.beginPath();
      for (const st of lot.stalls) for (const du of [-1.45, 1.45]) { const a = lot.lp(st.u + du, st.wm), b = lot.lp(st.u + du, st.wm + st.n * 5.5); c.moveTo(X(a.x), Z(a.z)); c.lineTo(X(b.x), Z(b.z)); }
      c.stroke();
    }
    // other cars
    const box = (o, fill) => {
      c.save(); c.translate(X(o.x), Z(o.z)); c.rotate(o.h);
      c.fillStyle = fill; c.beginPath(); c.roundRect((-o.L / 2) * s, (-o.W / 2) * s, o.L * s, o.W * s, 0.5 * s); c.fill(); c.restore();
    };
    for (const o of g.traffic.vehicles) if (inView(o.x, o.z, 5)) box(o, '#7d8187');
    // range around you
    c.setLineDash([6 * dpr, 6 * dpr]); c.strokeStyle = 'rgba(62,106,225,0.55)'; c.lineWidth = 1.5 * dpr;
    c.beginPath(); c.arc(X(p.x), Z(p.z), SUMMON_RANGE * s, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
    // planned route
    if (route && route.n > 1) {
      c.strokeStyle = '#3e6ae1'; c.lineWidth = Math.max(4 * dpr, 1.4 * s); c.lineJoin = 'round';
      c.beginPath(); c.moveTo(X(car.cx), Z(car.cz));
      for (let i = g.fsd.idx; i < route.n; i++) c.lineTo(X(route.x[i]), Z(route.z[i]));
      c.stroke();
      const e = route.n - 1; c.fillStyle = '#3e6ae1'; c.beginPath(); c.arc(X(route.x[e]), Z(route.z[e]), 4 * dpr, 0, Math.PI * 2); c.fill();
    }
    // the car: a filled red arrow pointing where it faces
    {
      const L = Math.max(15 * dpr, 4.8 * s);
      c.save(); c.translate(X(car.cx), Z(car.cz)); c.rotate(car.h);
      c.fillStyle = '#e82127'; c.strokeStyle = '#fff'; c.lineWidth = 2 * dpr;
      c.beginPath(); c.moveTo(L * 0.55, 0); c.lineTo(-L * 0.45, L * 0.38); c.lineTo(-L * 0.22, 0); c.lineTo(-L * 0.45, -L * 0.38); c.closePath();
      c.fill(); c.stroke(); c.restore();
    }
    // you: blue dot with a soft halo
    const pr = 7 * dpr, t = performance.now() / 1000;
    c.fillStyle = `rgba(62,106,225,${0.18 + 0.1 * Math.sin(t * 3)})`; c.beginPath(); c.arc(X(p.x), Z(p.z), pr * 2.6, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(X(p.x), Z(p.z), pr + 2.5 * dpr, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#3e6ae1'; c.beginPath(); c.arc(X(p.x), Z(p.z), pr, 0, Math.PI * 2); c.fill();
    // scale bar
    const m = span > 200 ? 50 : span > 90 ? 20 : 10;
    c.fillStyle = 'rgba(255,255,255,.75)'; c.fillRect(14 * dpr, H - 18 * dpr, m * s, 3 * dpr);
    c.font = `${11 * dpr}px Inter, sans-serif`; c.fillText(`${Math.round(m * 3.28)} ft`, 14 * dpr, H - 24 * dpr);
  }
}
