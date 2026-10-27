// All sounds are synthesized with Web Audio, modelled on the Model Y's: soft inverter whine and road
// noise, the low-speed Pedestrian Warning System hum (below ~15 mph and in reverse), tick-tock turn
// signals, Autopilot engage/disengage chimes, take-over alarm, park-assist beeps, door thunks, horn,
// lock chirp, charging chime and a small generative music player for the media card.
export const TRACKS = [
  { title: 'Midnight Autopilot', artist: 'Model Y Radio', album: 'Night Drive', bpm: 84, prog: [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 65]], hue: 220 },
  { title: 'Supercharged', artist: 'Lo-Fi Drive', album: 'Summer Hits of the Grid', bpm: 92, prog: [[50, 53, 57, 60], [55, 58, 62, 65], [48, 52, 55, 58], [53, 57, 60, 64]], hue: 12 },
  { title: 'City Lights', artist: 'Synthwave FM', album: 'Downtown', bpm: 100, prog: [[52, 55, 59, 62], [48, 52, 55, 59], [55, 59, 62, 66], [50, 54, 57, 61]], hue: 290 },
];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class CarAudio {
  constructor() { this.ctx = null; this.muted = false; this.volume = 0.8; this.track = 0; this.playing = false; this.musicVol = 0.5; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    // white noise buffer
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    const loopNoise = () => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; s.start(); return s; };
    // drivetrain
    this.whine = ctx.createOscillator(); this.whine.type = 'sine';
    this.whine2 = ctx.createOscillator(); this.whine2.type = 'triangle';
    this.whineG = ctx.createGain(); this.whineG.gain.value = 0;
    this.whine.connect(this.whineG); this.whine2.connect(this.whineG); this.whineG.connect(this.master);
    this.whine.start(); this.whine2.start();
    this.hum = ctx.createOscillator(); this.hum.type = 'sawtooth';
    const humF = ctx.createBiquadFilter(); humF.type = 'lowpass'; humF.frequency.value = 180;
    this.humG = ctx.createGain(); this.humG.gain.value = 0;
    this.hum.connect(humF).connect(this.humG).connect(this.master); this.hum.start();
    // road + wind
    const road = loopNoise(); this.roadF = ctx.createBiquadFilter(); this.roadF.type = 'bandpass'; this.roadF.frequency.value = 400; this.roadF.Q.value = 0.7;
    this.roadG = ctx.createGain(); this.roadG.gain.value = 0; road.connect(this.roadF).connect(this.roadG).connect(this.master);
    const wind = loopNoise(); const wf = ctx.createBiquadFilter(); wf.type = 'highpass'; wf.frequency.value = 900;
    this.windG = ctx.createGain(); this.windG.gain.value = 0; wind.connect(wf).connect(this.windG).connect(this.master);
    // pedestrian warning system
    this.pws = [ctx.createOscillator(), ctx.createOscillator(), ctx.createOscillator()];
    this.pws[0].type = 'sawtooth'; this.pws[1].type = 'sawtooth'; this.pws[2].type = 'sine';
    const pf = ctx.createBiquadFilter(); pf.type = 'bandpass'; pf.frequency.value = 700; pf.Q.value = 1.2;
    this.pwsG = ctx.createGain(); this.pwsG.gain.value = 0;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 3.2; const lfoG = ctx.createGain(); lfoG.gain.value = 9;
    lfo.connect(lfoG); for (const o of this.pws) { lfoG.connect(o.frequency); o.connect(pf); o.start(); }
    lfo.start(); pf.connect(this.pwsG).connect(this.master);
    // music bus
    this.musicG = ctx.createGain(); this.musicG.gain.value = this.musicVol;
    const mf = ctx.createBiquadFilter(); mf.type = 'lowpass'; mf.frequency.value = 5200;
    this.musicG.connect(mf).connect(this.master);
    this.nextBeat = 0; this.beat = 0;
    setInterval(() => this.schedule(), 90);
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05); }
  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); if (this.master && !this.muted) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05); }

  update(s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, sp = Math.abs(s.v), k = 0.08;
    const inside = s.inside ? 1 : 0.0;
    const near = s.inside ? 1 : Math.max(0, 1 - s.dist / 30);
    this.whine.frequency.setTargetAtTime(380 + sp * 62, t, k);
    this.whine2.frequency.setTargetAtTime(760 + sp * 124, t, k);
    this.whineG.gain.setTargetAtTime((Math.min(0.018, sp * 0.0012) + s.load * 0.012) * near, t, k);
    this.hum.frequency.setTargetAtTime(38 + sp * 6, t, k);
    this.humG.gain.setTargetAtTime(Math.min(0.06, sp * 0.004 + s.load * 0.02) * near, t, k);
    this.roadF.frequency.setTargetAtTime(260 + sp * 22, t, k);
    this.roadG.gain.setTargetAtTime(Math.min(0.2, sp * 0.0095) * near * (s.inside ? 0.8 : 1), t, k);
    this.windG.gain.setTargetAtTime(Math.min(0.12, sp * sp * 0.00011) * near, t, k);
    const pwsOn = s.awake && (s.gear === 'R' || (s.gear === 'D' && sp > 0.05 && sp < 6.7));
    const base = s.gear === 'R' ? 330 : 260 + sp * 14;
    this.pws[0].frequency.setTargetAtTime(base, t, k); this.pws[1].frequency.setTargetAtTime(base * 1.5, t, k); this.pws[2].frequency.setTargetAtTime(base * 2, t, k);
    const pwsLevel = pwsOn ? (s.inside ? 0.012 : 0.06 * near) * (s.gear === 'R' ? 1.3 : 0.6 + sp * 0.06) : 0;
    this.pwsG.gain.setTargetAtTime(pwsLevel, t, 0.12);
    this.musicG.gain.setTargetAtTime(this.playing ? this.musicVol * (s.inside ? 1 : 0.15) : 0, t, 0.2);
  }

  tone(freq, dur, { type = 'sine', vol = 0.2, at = 0, attack = 0.005, glide = null, dest = null } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + at, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest || this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  noise(dur, { f = 1000, q = 1, type = 'bandpass', vol = 0.3, at = 0, dest = null } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + at, s = this.ctx.createBufferSource(), fl = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = this.noiseBuf; fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(dest || this.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  bell(f, at, vol = 0.16) { this.tone(f, 0.7, { vol, at }); this.tone(f * 2.01, 0.4, { vol: vol * 0.25, at }); this.tone(f * 3.0, 0.25, { vol: vol * 0.08, at }); }

  chime(name) {
    switch (name) {
      case 'fsdOn': this.bell(1046.5, 0); this.bell(1568, 0.11); break;
      case 'fsdOff': this.bell(1568, 0); this.bell(1046.5, 0.11); break;
      case 'arrive': this.bell(1046.5, 0); this.bell(1318.5, 0.14); this.bell(1568, 0.28); break;
      case 'takeover': for (let i = 0; i < 8; i++) { this.tone(i % 2 ? 1250 : 1650, 0.12, { type: 'square', vol: 0.09, at: i * 0.14 }); } break;
      case 'alert': this.bell(880, 0, 0.12); break;
      case 'error': this.tone(440, 0.15, { type: 'triangle', vol: 0.15 }); this.tone(440, 0.15, { type: 'triangle', vol: 0.15, at: 0.2 }); break;
      case 'lock': this.tone(1800, 0.05, { vol: 0.08 }); this.tone(2400, 0.06, { vol: 0.08, at: 0.06 }); break;
      case 'unlock': this.tone(2400, 0.05, { vol: 0.08 }); this.tone(1800, 0.06, { vol: 0.08, at: 0.06 }); break;
      case 'charge': this.bell(784, 0, 0.12); this.bell(1175, 0.16, 0.12); break;
      case 'gear': this.noise(0.03, { f: 2600, q: 4, vol: 0.12 }); this.tone(900, 0.06, { vol: 0.05 }); break;
      case 'click': this.noise(0.02, { f: 3500, q: 3, vol: 0.08 }); break;
      case 'park': this.tone(2050, 0.07, { vol: 0.07 }); break;
      case 'seat': this.tone(740, 0.3, { vol: 0.09 }); break;
      default: break;
    }
  }
  tick(high) { this.noise(0.018, { f: high ? 2900 : 2100, q: 6, vol: 0.22 }); this.tone(high ? 1900 : 1500, 0.02, { vol: 0.03 }); }
  door(open, loud = 1) {
    if (open) { this.noise(0.05, { f: 1800, q: 2, vol: 0.12 * loud }); this.tone(220, 0.08, { vol: 0.05 * loud }); }
    else { this.noise(0.18, { f: 140, q: 0.8, type: 'lowpass', vol: 0.65 * loud }); this.tone(68, 0.2, { vol: 0.25 * loud }); this.noise(0.04, { f: 1200, q: 2, vol: 0.08 * loud, at: 0.02 }); }
  }
  motorRun(dur) { this.tone(110, dur, { type: 'sawtooth', vol: 0.025, attack: 0.2 }); this.tone(165, dur, { type: 'sine', vol: 0.02, attack: 0.2 }); }
  thud(strength) { this.noise(0.3, { f: 120, q: 0.7, type: 'lowpass', vol: Math.min(0.9, strength * 0.12) }); this.noise(0.15, { f: 900, q: 1, vol: Math.min(0.4, strength * 0.05) }); }
  hornOn() {
    if (!this.ctx || this.hornNodes) return;
    const g = this.ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(0.16, this.ctx.currentTime, 0.01);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200;
    const a = this.ctx.createOscillator(), b = this.ctx.createOscillator();
    a.type = b.type = 'square'; a.frequency.value = 415; b.frequency.value = 498;
    a.connect(f); b.connect(f); f.connect(g).connect(this.master); a.start(); b.start();
    this.hornNodes = { g, a, b };
  }
  hornOff() {
    if (!this.hornNodes) return;
    const { g, a, b } = this.hornNodes, t = this.ctx.currentTime;
    g.gain.setTargetAtTime(0, t, 0.02); a.stop(t + 0.15); b.stop(t + 0.15); this.hornNodes = null;
  }

  // ---- generative music
  togglePlay() { this.init(); this.playing = !this.playing; if (this.playing && this.ctx) this.nextBeat = this.ctx.currentTime + 0.05; return this.playing; }
  skip(d) { this.track = (this.track + d + TRACKS.length) % TRACKS.length; this.beat = 0; }
  schedule() {
    if (!this.ctx || !this.playing) return;
    const tr = TRACKS[this.track], spb = 60 / tr.bpm;
    while (this.nextBeat < this.ctx.currentTime + 0.35) {
      const t0 = this.nextBeat - this.ctx.currentTime, b = this.beat;
      const chord = tr.prog[Math.floor(b / 4) % tr.prog.length];
      if (b % 4 === 0) for (const n of chord) { this.tone(mtof(n), spb * 3.9, { vol: 0.035, at: t0, attack: 0.25, dest: this.musicG }); this.tone(mtof(n + 12), spb * 2, { type: 'triangle', vol: 0.008, at: t0, attack: 0.05, dest: this.musicG }); }
      this.tone(mtof(chord[0] - 24), spb * 0.9, { type: 'triangle', vol: 0.11, at: t0, attack: 0.01, dest: this.musicG });
      if (b % 2 === 0) this.tone(110, 0.25, { vol: 0.22, at: t0, glide: 42, dest: this.musicG });
      else this.noise(0.14, { f: 1800, q: 0.8, vol: 0.08, at: t0, dest: this.musicG });
      this.noise(0.03, { f: 8000, q: 1, type: 'highpass', vol: 0.04, at: t0, dest: this.musicG });
      this.noise(0.03, { f: 8000, q: 1, type: 'highpass', vol: 0.025, at: t0 + spb / 2, dest: this.musicG });
      if (b % 8 === 6) this.tone(mtof(chord[2] + 12), spb * 0.5, { type: 'sine', vol: 0.03, at: t0 + spb / 2, dest: this.musicG });
      this.nextBeat += spb; this.beat++;
    }
  }
}
