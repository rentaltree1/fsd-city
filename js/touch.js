// Touch controls for phones (and tablets). On foot: a thumbstick that appears where the left thumb lands
// (push to the rim to run) and Get in / Phone buttons; looking around is a drag on the view itself (main.js).
// In the car: a steering wheel to drag left and right (tap its hub to honk), analog brake and accelerator
// pedals (slide up to press harder), P R N D, turn signals, the FSD button, the car's touchscreen as a big
// panel, the camera view, Get out and a menu with the rest. The controls report what they want each
// frame (move, steer, throttle, brake) and call back for one-off actions.

export const TOUCH = (() => {
  try {
    if (/[?&]touch=1\b/.test(location.search)) return true;
    if (/[?&]touch=0\b/.test(location.search)) return false;
    return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;
  } catch (err) { return false; }
})();

const I = {
  wheel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.2"/><path d="M3.5 10.5c5-1.6 12-1.6 17 0M12 14.2V21M9.8 13.4 5 19M14.2 13.4 19 19"/>',
  screen: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  view: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  door: '<path d="M14 3H6v18h8M10 12h11M18 9l3 3-3 3"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  enter: '<path d="M10 3h8v18h-8M3 12h11M11 9l3 3-3 3"/>',
  left: '<path d="M10 6 4 12l6 6M4 12h16"/>',
  right: '<path d="M14 6l6 6-6 6M20 12H4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  hazard: '<path d="M12 3 2.5 20h19z"/><path d="M12 9.5 7.6 17h8.8z"/>',
  light: '<path d="M14 6c4 0 7 2.7 7 6s-3 6-7 6zM3 8h7M3 12h7M3 16h7"/>',
  horn: '<path d="M4 10v4h4l6 4V6l-6 4H4zM17 9a4 4 0 0 1 0 6"/>',
  sound: '<path d="M4 10v4h4l6 4V6l-6 4H4zM17 9a4 4 0 0 1 0 6M19.5 6.5a7.5 7.5 0 0 1 0 11"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1.1.9-1.1 1.6v.5M12 17h.01"/>',
  gfx: '<path d="M4 18 9 9l4 6 2.5-3.5L20 18z"/><circle cx="16" cy="6.5" r="1.8"/>',
  rotate: '<rect x="3" y="7" width="12" height="14" rx="2"/><path d="M16 3a6 6 0 0 1 5 5M21 4.5V8h-3.5"/>',
};
const icon = (k, s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k]}</svg>`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// keep getting a finger's moves after it slides off the control (some browsers refuse: then it just doesn't)
const capture = (el, id) => { try { el.setPointerCapture(id); } catch (err) { /* not capturable */ } };

export class TouchUI {
  constructor(on) {
    this.on = on; // { action(name, arg), audio() }
    this.move = { x: 0, y: 0 }; this.steer = 0; this.throttle = 0; this.brake = 0;
    this.steering = false; this.mode = null; this.screenOpen = false; this.menuOpen = false;
    document.documentElement.classList.add('touch');
    const el = this.el = document.createElement('div');
    el.id = 'touch';
    el.innerHTML = `
      <div class="t-foot">
        <div class="t-zone" aria-hidden="true"></div>
        <div class="t-stick" aria-hidden="true"><div class="t-knob"></div></div>
        <div class="t-col t-foot-btns">
          <button class="t-btn t-big t-blue" data-a="enter" hidden>${icon('enter', 26)}<span>Get in</span></button>
          <button class="t-btn" data-a="phone">${icon('phone')}<span>Phone</span></button>
        </div>
        <button class="t-btn t-help" data-a="help" aria-label="Controls">${icon('help')}</button>
      </div>
      <div class="t-car">
        <div class="t-top">
          <button class="t-fsd" data-a="fsd"><span class="t-fsd-ico">${icon('wheel', 22)}</span><span class="t-fsd-txt"><b>FSD</b><small data-k="fsdsub">Supervised</small></span></button>
          <div class="t-speed" aria-live="off"><b data-k="mph">0</b><small>mph</small><i data-k="gear">P</i></div>
          <div class="t-row">
            <button class="t-btn t-sq" data-a="screen" aria-label="Touchscreen">${icon('screen')}</button>
            <button class="t-btn t-sq" data-a="view" aria-label="Camera view">${icon('view')}</button>
            <button class="t-btn t-sq" data-a="exit" aria-label="Get out">${icon('door')}</button>
            <button class="t-btn t-sq" data-a="menu" aria-label="More">${icon('more')}</button>
          </div>
        </div>
        <div class="t-menu" role="menu">
          <button data-a="hazard" role="menuitem">${icon('hazard', 20)}<span>Hazards</span></button>
          <button data-a="lights" role="menuitem">${icon('light', 20)}<span data-k="lights">Headlights: Auto</span></button>
          <button data-a="mute" role="menuitem">${icon('sound', 20)}<span data-k="mute">Sound on</span></button>
          <button data-a="quality" role="menuitem">${icon('gfx', 20)}<span data-k="quality">Graphics</span></button>
          <button data-a="help" role="menuitem">${icon('help', 20)}<span>Controls</span></button>
        </div>
        <div class="t-drive">
          <div class="t-signals">
            <button class="t-btn t-sig" data-a="sigL" aria-label="Left turn signal">${icon('left', 24)}</button>
            <button class="t-btn t-sig" data-a="sigR" aria-label="Right turn signal">${icon('right', 24)}</button>
          </div>
          <div class="t-wheel" aria-label="Steering wheel: drag left or right, tap the middle to honk">
            <svg class="t-wheel-svg" viewBox="0 0 120 120" aria-hidden="true">
              <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="9"/>
              <path d="M12 52c30-10 66-10 96 0" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="9" stroke-linecap="round"/>
              <path d="M60 74v38" stroke="rgba(255,255,255,.9)" stroke-width="9" stroke-linecap="round"/>
              <circle cx="60" cy="64" r="15" fill="rgba(30,32,36,.95)" stroke="rgba(255,255,255,.9)" stroke-width="4"/>
              <path d="M53 60h14M60 60v9" stroke="#e82127" stroke-width="3" stroke-linecap="round"/>
              <circle cx="60" cy="8" r="4" fill="#3e6ae1"/>
            </svg>
          </div>
        </div>
        <div class="t-right">
          <div class="t-gears" role="radiogroup" aria-label="Gear">
            ${['P', 'R', 'N', 'D'].map((g) => `<button data-a="gear" data-g="${g}" role="radio">${g}</button>`).join('')}
          </div>
          <div class="t-pedals">
            <div class="t-pedal t-brake" aria-label="Brake"><i></i><span>BRAKE</span></div>
            <div class="t-pedal t-accel" aria-label="Accelerator"><i></i><span>GO</span></div>
          </div>
        </div>
        <button class="t-btn t-close" data-a="screen" aria-label="Close the touchscreen">${icon('close')}<span>Road</span></button>
      </div>
      <div class="t-rotate" hidden><span>${icon('rotate', 22)}</span><span>Turn your phone sideways for the best driving view</span><button data-a="norotate" aria-label="Dismiss">${icon('close', 18)}</button></div>`;
    document.body.appendChild(el);
    this.k = {};
    el.querySelectorAll('[data-k]').forEach((n) => { this.k[n.dataset.k] = n; });
    this.q = (s) => el.querySelector(s);
    this.rotateDismissed = false;

    // every touch on the controls stays on the controls (the view behind doesn't also see it)
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) el.addEventListener(t, (e) => { if (e.target !== el) e.stopPropagation(); });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      this.on.audio();
      const a = b.dataset.a;
      if (a === 'menu') { this.setMenu(!this.menuOpen); return; }
      if (a === 'norotate') { this.rotateDismissed = true; this.q('.t-rotate').hidden = true; return; }
      if (b.closest('.t-menu')) this.setMenu(false);
      this.on.action(a, b.dataset.g);
    });
    this.stick(); this.wheel(); this.pedal(this.q('.t-accel'), 'throttle', 0.5); this.pedal(this.q('.t-brake'), 'brake', 0.65);
  }

  setMenu(open) { this.menuOpen = open; this.q('.t-menu').classList.toggle('open', open); }

  // floating thumbstick: appears under the thumb, the knob follows it out to the rim
  stick() {
    const zone = this.q('.t-zone'), base = this.q('.t-stick'), knob = this.q('.t-knob'), R = 52;
    let id = null, ox = 0, oy = 0;
    zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      this.on.audio();
      id = e.pointerId; capture(zone, id);
      ox = e.clientX; oy = e.clientY;
      base.style.left = `${ox}px`; base.style.top = `${oy}px`; base.classList.add('on');
      knob.style.transform = 'translate(-50%,-50%)';
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - ox, dy = e.clientY - oy;
      const l = Math.hypot(dx, dy);
      // dragged past the rim: the stick follows the thumb so it never has to come back to find it
      if (l > R * 1.25) { ox += dx * (1 - (R * 1.25) / l); oy += dy * (1 - (R * 1.25) / l); base.style.left = `${ox}px`; base.style.top = `${oy}px`; dx = e.clientX - ox; dy = e.clientY - oy; }
      const m = Math.min(1, Math.hypot(dx, dy) / R), a = Math.atan2(dy, dx);
      this.move.x = Math.cos(a) * m; this.move.y = -Math.sin(a) * m;
      knob.style.transform = `translate(calc(-50% + ${Math.cos(a) * m * R}px), calc(-50% + ${Math.sin(a) * m * R}px))`;
    });
    const end = (e) => { if (e.pointerId !== id) return; id = null; this.move.x = this.move.y = 0; base.classList.remove('on'); };
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
  }

  // steering: drag sideways anywhere on the wheel; a quick tap on the hub sounds the horn
  wheel() {
    const w = this.q('.t-wheel'), svg = this.q('.t-wheel-svg');
    let id = null, x0 = 0, t0 = 0, moved = 0, hub = false, hornT = null;
    w.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      this.on.audio();
      id = e.pointerId; capture(w, id);
      x0 = e.clientX; t0 = performance.now(); moved = 0;
      const r = w.getBoundingClientRect();
      hub = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height * 0.53)) < r.width * 0.17;
      if (hub) hornT = setTimeout(() => { this.horning = true; this.on.action('hornOn'); }, 180);
      this.steering = true;
    });
    w.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - x0;
      moved = Math.max(moved, Math.abs(dx));
      if (moved > 8 && hornT) { clearTimeout(hornT); hornT = null; }
      if (moved > 8 && !this.horning) this.steer = clamp(dx / 95, -1, 1);
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null; this.steering = false; this.steer = 0;
      if (hornT) { clearTimeout(hornT); hornT = null; if (hub && moved <= 8 && performance.now() - t0 < 400) this.on.action('honk'); }
      if (this.horning) { this.horning = false; this.on.action('hornOff'); }
    };
    w.addEventListener('pointerup', end); w.addEventListener('pointercancel', end);
    this.wheelSvg = svg;
  }

  // a pedal: pressing it gives `base`, sliding up presses harder (and down eases off)
  pedal(el, key, base) {
    const bar = el.querySelector('i');
    let id = null;
    const set = (e) => {
      const r = el.getBoundingClientRect(), f = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
      this[key] = clamp(base + (f - 0.35) * 0.9, 0.2, 1);
      bar.style.transform = `scaleY(${this[key]})`;
    };
    el.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      this.on.audio();
      id = e.pointerId; capture(el, id); el.classList.add('on'); set(e);
      if (key === 'brake') this.on.action('brake');
    });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
    const end = (e) => { if (e.pointerId !== id) return; id = null; this[key] = 0; el.classList.remove('on'); bar.style.transform = 'scaleY(0)'; };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }

  // safe-area insets (Dynamic Island, home indicator) in CSS px
  insets() {
    if (!this.probe) {
      this.probe = document.createElement('div');
      this.probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
      document.body.appendChild(this.probe);
    }
    const s = getComputedStyle(this.probe);
    return { t: parseFloat(s.paddingTop) || 0, r: parseFloat(s.paddingRight) || 0, b: parseFloat(s.paddingBottom) || 0, l: parseFloat(s.paddingLeft) || 0 };
  }

  // where the car's touchscreen goes when it's opened (CSS px): as big as fits beside the pedals
  panelRect() {
    const ins = this.insets(), W = innerWidth, H = innerHeight, portrait = H > W;
    const aspect = 1344 / 800;
    if (portrait) {
      const w = W - Math.max(8, ins.l) - Math.max(8, ins.r), h = w / aspect;
      return { x: Math.max(8, ins.l), y: Math.max(ins.t + 60, (H - h) * 0.32), w, h };
    }
    const right = Math.max(10, ins.r) + 132, left = Math.max(10, ins.l);
    let h = H - Math.max(8, ins.t) - Math.max(10, ins.b), w = h * aspect;
    if (w > W - left - right - 8) { w = W - left - right - 8; h = w / aspect; }
    return { x: left, y: Math.max(8, ins.t) + (H - Math.max(8, ins.t) - Math.max(10, ins.b) - h) / 2, w, h };
  }

  // per-frame state from the game
  update(s) {
    const mode = s.inCar ? 'car' : 'foot';
    if (mode !== this.mode) {
      this.mode = mode; this.el.dataset.mode = mode;
      this.move.x = this.move.y = 0; this.steer = 0; this.throttle = 0; this.brake = 0; this.setMenu(false);
    }
    this.el.classList.toggle('screen-open', !!s.screenOpen);
    this.el.classList.toggle('phone-open', !!s.phoneOpen);
    this.q('[data-a="enter"]').hidden = !s.nearDoor;
    if (s.inCar) {
      this.k.mph.textContent = String(Math.round(s.mph));
      this.k.gear.textContent = s.gear;
      for (const b of this.el.querySelectorAll('.t-gears button')) { const on = b.dataset.g === s.gear; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
      const f = this.q('.t-fsd');
      f.classList.toggle('on', s.fsd);
      this.k.fsdsub.textContent = s.fsd ? (s.fsdStatus || 'Engaged') : s.dest ? `to ${s.dest}` : 'Supervised';
      this.q('[data-a="sigL"]').classList.toggle('on', s.signal === 'L' || s.hazard);
      this.q('[data-a="sigR"]').classList.toggle('on', s.signal === 'R' || s.hazard);
      this.q('[data-a="sigL"]').classList.toggle('blink', (s.signal === 'L' || s.hazard) && s.blinkOn);
      this.q('[data-a="sigR"]').classList.toggle('blink', (s.signal === 'R' || s.hazard) && s.blinkOn);
      this.q('[data-a="hazard"]').classList.toggle('on', s.hazard);
      this.k.lights.textContent = `Headlights: ${s.headlights}`;
      this.k.mute.textContent = s.muted ? 'Sound off' : 'Sound on';
      this.k.quality.textContent = `Graphics: ${s.quality}`;
      // the wheel turns with the car's actual steering
      this.wheelSvg.style.transform = `rotate(${(s.steerAngle / 0.6) * 140}deg)`;
    }
    const rot = this.q('.t-rotate');
    rot.hidden = this.rotateDismissed || !(s.inCar && innerHeight > innerWidth);
  }
}
