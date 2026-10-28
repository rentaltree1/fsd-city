// Game bootstrap: renderer, world, player on foot / in the car, input, FSD, charging, cameras, loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { clamp, lerp, wrapAngle, yawFromHeading, REAR_OFF, MPH, CAR_LEN, CAR_WID, CAR_H, CENTER_OFF, WHEELBASE, setVehicleDims } from './config.js';
import { City } from './city.js';
import { Traffic } from './traffic.js';
import { Vehicle, obbVsAabb, obbVsCircle, obbVsObb } from './vehicle.js';
import { buildModelY, EYE, CAMERAS, PAINTS } from './car.js';
import { Vision, FSD, SUMMON_RANGE } from './fsd.js';
import { Phone } from './phone.js';
import { Viz } from './viz.js';
import { CarScreen, Nav, SW, SH } from './screen.js';
import { CarAudio } from './audio.js';
import { DayNight } from './sky.js';
import { setNPCNight } from './npc.js';
import { TOUCH, TouchUI } from './touch.js';

const DEG = Math.PI / 180;
const $ = (id) => document.getElementById(id);
const setLoad = (t) => { const el = $('loadmsg'); if (el) el.textContent = t; };
const frame = () => new Promise((r) => setTimeout(r, 30));
// the same message worded for a keyboard or for a touchscreen
const tw = (desk, touch) => (TOUCH ? touch : desk);
if (TOUCH) {
  document.documentElement.classList.add('touch');
  // Safari's own pinch zoom would fight the game's
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault());
}

async function boot() {
  const canvas = $('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, TOUCH ? 2 : 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = TOUCH ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.06, 9000);
  camera.rotation.order = 'YXZ';

  setLoad('Lighting the sky…'); await frame();
  const sky = new DayNight(renderer, scene);
  setLoad('Paving roads and raising towers…'); await frame();
  const city = new City(scene);
  setLoad('Releasing traffic…'); await frame();
  const traffic = new Traffic(scene, city, TOUCH ? 36 : 48); // (phones: a few fewer cars about)
  const home = city.pois.find((p) => p.name === 'Home');
  const startStall = home.lot.stalls[3];
  for (const lot of city.lots) if (!lot.big) for (const st of lot.stalls) if (st !== startStall && Math.random() < (lot.charger ? 0.3 : 0.42)) traffic.addParked(st, lot);
  // store lots: busier near the entrance
  for (const lot of city.lots) if (lot.big) for (const st of lot.stalls) if (!st.occupied && Math.random() < 0.18 + 0.22 * (1 - Math.abs(st.u - (lot.u0 + lot.L / 2)) / (lot.L / 2)) * (st.row >= 2 ? 1 : 0.5)) traffic.addParked(st, lot);
  setLoad('Building your car…'); await frame();
  const car = new Vehicle(city);
  car.y = 0.15;
  startStall.occupied = true;
  const settings = { headlights: 'Auto', showCones: false, timePreset: 'Afternoon', timeLabel: '60x', timeScale: 60, quality: TOUCH ? 'Medium' : 'High', paint: 'Quicksilver' };
  // the cars you can drive: dimensions, cameras, driver's eye, door and charge port, paints
  const VEHICLES = {
    modely: {
      id: 'modely', name: 'Model Y', full: 'Model Y Long Range AWD', build: buildModelY, paints: PAINTS, paint: 'Quicksilver',
      spec: { L: 4.797, W: 1.921, H: 1.624, wheelbase: 2.89, axleR: 1.445, eye: EYE, driverDoor: [-1.2, 1.0, -0.2], chargePort: [-0.9, 0.93, 2.1], cameras: CAMERAS.map((c) => ({ ...c })) },
    },
  };
  let vehicle = VEHICLES.modely, model = null;
  const late = {}; // screen, game and viz, once they exist (a vehicle swap updates them too)
  const dome = new THREE.PointLight(0xfff1dd, 0, 3, 2); dome.position.set(0, 1.45, 0.2);
  // dynamic reflections for the paint
  const cubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.UnsignedByteType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cubeCam = new THREE.CubeCamera(0.5, 900, cubeRT); scene.add(cubeCam);
  // build (or swap to) a vehicle: its model, dimensions for physics/FSD/parking, its cameras, and parked
  // in the home stall
  function useVehicle(v) {
    if (model) { scene.remove(model.root); model.chassis.remove(dome); }
    vehicle = v; settings.paint = v.paint;
    setVehicleDims(v.spec);
    CAMERAS.splice(0, CAMERAS.length, ...v.spec.cameras.map((c) => ({ ...c })));
    model = v.build({ paint: v.paints[v.paint] });
    scene.add(model.root); model.chassis.add(dome);
    for (const m of [model.mats.paint, model.mats.trim, model.mats.glass, model.mats.roofglass]) if (m) m.envMap = cubeRT.texture;
    if (late.screen) { model.screenMesh.material.map = late.screen.rt.texture; model.screenMesh.material.needsUpdate = true; }
    if (late.game) { late.game.model = model; late.game.vehicle = v; }
    if (late.viz) late.viz.setEgo(v.build);
    for (const k in renderCamCache) delete renderCamCache[k];
    const p = home.lot.lp(startStall.u, 27.15 + CENTER_OFF);
    car.place(p.x, p.z, startStall.h);
  }
  const renderCamCache = {};
  useVehicle(vehicle);

  const vision = new Vision(city);
  const fsd = new FSD(city, vision);
  const nav = new Nav(city, vision);
  const audio = new CarAudio();
  const viz = new Viz(city);

  // ---------------- game state
  const state = {
    hours: 15.73, night: 0, temp: 84, locked: true, blinkOn: false, speedLimit: 25, rearGap: 9,
    chargeAvail: null, driverTemp: 67, passTemp: 70, seatL: 0, seatR: 0,
  };
  const player = { mode: 'foot', x: 0, z: 0, yaw: 0, pitch: -0.12, y: 1.7, lookYaw: 0, lookPitch: -0.05, camMode: 'fp', orbit: { a: 0.6, e: 0.35, d: 8 }, focusScreen: false };
  // start on foot a few steps from the car, looking at it
  function placePlayerNearCar() {
    const left = { x: Math.sin(car.h), z: -Math.cos(car.h) }, side = CAR_WID / 2 + 1.45, back = CAR_LEN / 2 + 0.1;
    player.x = car.cx + left.x * side - Math.cos(car.h) * back; player.z = car.cz + left.z * side - Math.sin(car.h) * back;
    const dx = car.cx - player.x, dz = car.cz - player.z;
    player.yaw = Math.atan2(-dx, -dz);
  }
  placePlayerNearCar();
  let cable = null;

  function carCamera(id, aspect) {
    const def = CAMERAS.find((c) => c.id === id);
    let cam = renderCamCache[id];
    if (!cam) { cam = renderCamCache[id] = new THREE.PerspectiveCamera(60, aspect, 0.08, 600); cam.rotation.order = 'YXZ'; }
    cam.aspect = aspect;
    const vf = 2 * Math.atan(Math.tan((def.fov * DEG) / 2) / aspect);
    cam.fov = Math.min(100, vf / DEG);
    cam.updateProjectionMatrix();
    model.root.updateMatrixWorld();
    cam.position.copy(model.chassis.localToWorld(new THREE.Vector3(...def.pos)));
    cam.rotation.set(id === 'rear' ? -0.32 : -0.04, yawFromHeading(car.h) - def.yaw * DEG, 0);
    cam.updateMatrixWorld();
    return cam;
  }
  function renderCam(id, rt, x, y, w, h) {
    const cam = carCamera(id, w / h);
    rt.viewport.set(x, y, w, h); rt.scissor.set(x, y, w, h); rt.scissorTest = true;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 1); renderer.clear();
    // the cameras look out through the glass: the touchscreen and wheel inside aren't in their view
    const hide = [model.screenMesh && model.screenMesh.parent, model.steeringSpin && model.steeringSpin.parent].filter(Boolean);
    for (const o of hide) o.visible = false;
    renderer.render(scene, cam);
    for (const o of hide) o.visible = true;
  }

  // (on a phone the car's screen is too small to read from the driver's view: alerts also show up top)
  const toast = (title, sub, color) => { screen.showAlert(title, sub, color); if (TOUCH) setHint(sub ? `${title} · ${sub}` : title, 4); };
  const isClosed = () => !model.anyDoorOpen() && !model.isOpen('frunk') && !model.isOpen('trunk');
  const act = {
    toggle(k) {
      if (state.locked && player.mode === 'foot') { toast('Car is locked', 'Walk up to it to unlock with your phone key'); audio.chime('error'); return; }
      if (fsd.engaged && Math.abs(car.v) > 0.3 && ['FL', 'FR', 'RL', 'RR'].includes(k)) { toast('Doors stay closed while driving'); return; }
      const open = model.toggle(k);
      if (k === 'frunk' || k === 'trunk') { audio.motorRun(k === 'trunk' ? 2.4 : 1.8); audio.chime('alert'); }
      else audio.door(open, player.mode === 'car' ? 1 : 0.7);
      if (!open && (k !== 'frunk' && k !== 'trunk')) setTimeout(() => audio.door(false, player.mode === 'car' ? 1 : 0.7), 250);
    },
    lock() { state.locked = !state.locked; audio.chime(state.locked ? 'lock' : 'unlock'); },
    // a button, switch, stalk or scroll wheel inside the car: the model animates it; the car acts on it
    interior(a) {
      if (model.press && model.press(a)) { audio.chime('click'); return; }
      if (['FL', 'FR', 'RL', 'RR'].includes(a)) { act.toggle(a); return; }
      if (a === 'hazard') { act.hazard(); audio.chime('click'); }
      else if (a === 'horn') act.honk();
      else if (a === 'sig:L' || a === 'sig:R') { const d = a.slice(-1); car.signal = car.signal === d ? null : d; signalArmed = false; audio.chime('click'); }
      else if (a === 'sig:off') { car.signal = null; }
      else if (a === 'wiper') { wipersT = 7; audio.chime('click'); }
      else if (a === 'lights') act.cycleHeadlights();
      else if (a.startsWith('gear:')) act.setGear(a.slice(5));
      else if (a === 'fsd') act.fsdButton();
      else if (a === 'media') { audio.togglePlay(); audio.chime('click'); }
      else if (a === 'volUp') audio.setVolume(audio.volume + 0.1);
      else if (a === 'volDown') audio.setVolume(audio.volume - 0.1);
      else audio.chime('click');
    },
    chargePort() { model.chargeTarget = model.chargeTarget > 0.5 ? 0 : 1; audio.chime('click'); if (model.chargeTarget < 0.5 && car.charging) act.stopCharge(); },
    startCharge() {
      if (!state.chargeAvail) { toast('No charger here', 'Back into a Supercharger stall to charge'); return; }
      model.chargeTarget = 1; audio.chime('click');
      setTimeout(() => {
        if (!state.chargeAvail) return;
        car.charging = true; car.gear = 'P'; audio.chime('charge'); buildCable(state.chargeAvail);
        toast('Charging started', `${state.chargeAvail.lot.poi.name} · ${state.chargeAvail.lot.poi.kw} kW`, '#20b85a');
      }, 1200);
    },
    stopCharge() {
      if (!car.charging) return;
      car.charging = false; car.chargeKw = 0; removeCable();
      setTimeout(() => { model.chargeTarget = 0; }, 900);
      toast('Charging stopped', `Battery ${Math.round(car.battery * 100)}%`);
    },
    setGear(gg) {
      if (player.mode !== 'car') return;
      if (gg === car.gear) return;
      if (car.charging && gg !== 'P') { toast('Unplug to drive', 'Stop charging first'); audio.chime('error'); return; }
      if (gg === 'P' && Math.abs(car.v) > 0.6) { toast('Slow down to shift into Park'); return; }
      if ((gg === 'D' && car.v < -0.8) || (gg === 'R' && car.v > 0.8)) { toast('Stop the car to change direction'); return; }
      if (fsd.engaged) disengage('Self-Driving disengaged', 'Gear changed by driver');
      car.gear = gg; audio.chime('gear');
    },
    fsdButton() {
      if (fsd.engaged) { disengage('Self-Driving canceled', 'You have control'); return; }
      const av = fsdAvailable();
      if (!av.ok) { toast('Self-Driving unavailable', av.reason, '#5c5e62'); audio.chime('error'); return; }
      if (car.charging) act.stopCharge();
      const leaving = fsd.findStall(car);
      const err = fsd.engage(car, nav.dest);
      if (err) { toast('Self-Driving unavailable', err, '#5c5e62'); audio.chime('error'); return; }
      if (leaving && leaving.st) leaving.st.occupied = false;
      audio.chime('fsdOn');
      toast('Self-Driving (Supervised) engaged', tw('Pay attention to the road. Press S, A or D to take over.', 'Pay attention to the road. Brake or steer to take over.'));
    },
    // a stall picked on the Supercharger map: Self-Driving backs into that one
    chooseStall(lot, st) {
      if (st.occupied) return;
      fsd.chosenStall = st;
      audio.chime('click');
      toast(`Stall ${st.k + 1} selected`, 'Self-Driving will back into this stall');
      if (fsd.engaged && fsd.dest && fsd.dest.lot === lot) { const err = fsd.plan(car, fsd.dest, { keepEvents: true }); if (err) disengage('Self-Driving disengaged', err); }
    },
    setDest(poi) {
      fsd.chosenStall = null;
      nav.set(poi, car);
      if (nav.err) toast('Route unavailable', nav.err, '#5c5e62');
      else toast(`Navigating to ${poi.name}`, poi.address);
      if (fsd.engaged) { const err = fsd.plan(car, poi); if (err) disengage('Self-Driving disengaged', err); }
    },
    cancelNav() { nav.clear(); if (fsd.engaged) fsd.plan(car, null); },
    cycleHeadlights() { const o = ['Auto', 'On', 'Off']; settings.headlights = o[(o.indexOf(settings.headlights) + 1) % 3]; },
    hazard() { car.hazard = !car.hazard; },
    setTime(o) { settings.timePreset = o; state.hours = { Morning: 8.5, Afternoon: 14.5, Sunset: 18.15, Night: 22.5 }[o]; },
    setTimeScale(o) { settings.timeLabel = o; settings.timeScale = { Paused: 0, '1x': 1, '60x': 60, '240x': 240 }[o]; },
    setQuality(q) { settings.quality = q; applyQuality(); },
    setPaint(name) { settings.paint = name; vehicle.paint = name; model.setPaint(vehicle.paints[name]); },
    // phone app
    phoneLock() { state.locked = !state.locked; audio.chime(state.locked ? 'lock' : 'unlock'); if (state.locked) { flashFor(0.6); } },
    flash() { flashFor(1.6); },
    honk() { audio.hornOn(); setTimeout(() => audio.hornOff(), 380); flashFor(0.6); },
    // Smart Summon: returns an error string, or null once the car is on its way
    summon() {
      if (player.mode !== 'foot') return 'Get out of the car first';
      if (fsd.engaged) return 'Self-Driving is already active';
      const d = Math.hypot(player.x - car.cx, player.z - car.cz);
      if (d > SUMMON_RANGE) return `Your car is ${Math.round(d)} m away — Smart Summon works within ${SUMMON_RANGE} m`;
      if (car.charging) return 'Unplug the charger first';
      if (model.anyDoorOpen() || model.isOpen('frunk') || model.isOpen('trunk')) return 'Close the doors, frunk and trunk first';
      if (car.battery < 0.01) return 'Battery too low';
      const r = fsd.planSummon(car, player.x, player.z);
      if (r.err) return r.err;
      fsd.engaged = true; fsd.status = 'Smart Summon'; fsd.summonStatus = 'Starting';
      state.locked = true; summonRetarget = 1.5;
      audio.chime('click'); flashFor(0.6);
      return null;
    },
    stopSummon(why) { stopSummon(why); },
  };
  let summonRetarget = 0, flashT = 0;
  function flashFor(t) { flashT = t; car.hazard = true; }
  function stopSummon(why) {
    if (!fsd.summon) return;
    fsd.summon = null; fsd.disengage(); car.signal = null;
    if (Math.abs(car.v) < 0.2) car.gear = 'P';
    audio.chime('fsdOff');
    phone.note(why || 'Smart Summon stopped', true);
  }
  function fsdAvailable() {
    if (player.mode !== 'car') return { ok: false, reason: 'Get in the driver seat first' };
    if (model.anyDoorOpen()) return { ok: false, reason: 'Close all doors' };
    if (model.isOpen('frunk') || model.isOpen('trunk')) return { ok: false, reason: 'Close the frunk and trunk' };
    if (car.battery < 0.005) return { ok: false, reason: 'Battery depleted — charge to continue' };
    return { ok: true };
  }
  function disengage(title, sub, alarm = false) {
    if (!fsd.engaged) return;
    fsd.disengage();
    car.signal = null;
    audio.chime(alarm ? 'takeover' : 'fsdOff');
    toast(title, sub, alarm ? '#e82127' : '#3e6ae1');
  }
  function buildCable(stallInfo) {
    removeCable();
    const ch = city.chargers.find((c) => c.stall === stallInfo.st);
    if (!ch) return;
    model.root.updateMatrixWorld();
    const port = model.chassis.localToWorld(new THREE.Vector3(...vehicle.spec.chargePort));
    const a = new THREE.Vector3(ch.x, 1.2, ch.z);
    const mid = a.clone().lerp(port, 0.5); mid.y = 0.35;
    const curve = new THREE.CatmullRomCurve3([a, a.clone().lerp(mid, 0.5).setY(0.6), mid, port.clone().lerp(mid, 0.4).setY(0.6), port]);
    cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.024, 8), new THREE.MeshStandardMaterial({ color: 0x0d0d0e, roughness: 0.4 }));
    cable.castShadow = true;
    scene.add(cable);
  }
  function removeCable() { if (cable) { scene.remove(cable); cable.geometry.dispose(); cable = null; } }

  const vizState = () => {
    const tracks = vision.tracks;
    let stopLine = null;
    if (fsd.engaged) {
      for (const ev of fsd.events) {
        if (ev.done) continue;
        if ((ev.type === 'light' || ev.type === 'stop' || ev.type === 'stop2') && ev.s - fsd.sCur < 70 && (ev.reason === 'light' || ev.type !== 'light') && ev.phase !== 'go' && !ev.commit) { stopLine = { e: ev.edge }; }
        break;
      }
    }
    const pts = fsd.engaged ? fsd.ahead(Math.max(16, Math.abs(car.v) * 2.2)) : null;
    return { car, tracks, lights: vision.lights, signs: vision.signs, path: pts, doors: model.doors, blinkOn: state.blinkOn, parkView: car.gear === 'P' && !fsd.engaged, stopLine, showCones: settings.showCones };
  };

  const game = { car, model, vehicle, city, fsd, vision, nav, audio, sky, traffic, settings, state, act, renderCam, carCamera, vizState, fsdAvailable };
  const screen = new CarScreen(renderer, game, viz);
  Object.assign(late, { screen, game, viz });
  const phone = new Phone(game, player);
  game.phone = phone;

  // ---------------- touch controls (phones, tablets)
  // touchScreen: the car's touchscreen opened up as a big panel over the view
  let touchScreen = false, lookTouchT = 0;
  const touch = TOUCH ? new TouchUI({ audio: () => audio.init(), action: touchAction }) : null;
  function touchAction(a, arg) {
    if (a === 'enter') tryEnter();
    else if (a === 'phone') phone.toggle();
    else if (a === 'help') $('help').classList.toggle('show');
    else if (a === 'fsd') act.fsdButton();
    else if (a === 'screen') { touchScreen = !touchScreen; screen.pointer(0, 0, 'up'); }
    else if (a === 'view') {
      const o = player.orbit;
      player.camMode = { fp: 'chase', chase: 'orbit', orbit: 'fp' }[player.camMode] || 'fp';
      if (player.camMode === 'orbit') { o.a = 2.5; o.e = 0.32; o.d = o.dT = 9; }
      if (player.camMode === 'fp') { player.lookYaw = 0; player.lookPitch = -0.08; zoomFov = 72; }
    } else if (a === 'exit') exitCar();
    else if (a === 'hazard') act.hazard();
    else if (a === 'lights') act.cycleHeadlights();
    else if (a === 'mute') audio.setMuted(!audio.muted);
    else if (a === 'quality') act.setQuality(settings.quality === 'High' ? 'Medium' : 'High');
    else if (a === 'sigL' || a === 'sigR') { const s = a === 'sigL' ? 'L' : 'R'; car.signal = car.signal === s ? null : s; signalArmed = false; }
    else if (a === 'gear') act.setGear(arg);
    else if (a === 'honk') { audio.hornOn(); setTimeout(() => audio.hornOff(), 320); }
    else if (a === 'hornOn') audio.hornOn();
    else if (a === 'hornOff') audio.hornOff();
    else if (a === 'brake') { if (fsd.engaged && !fsd.summon) disengage('Self-Driving disengaged', 'Brake pressed — you have control'); }
  }
  if (TOUCH) {
    $('help').innerHTML = `<h3>On foot</h3><div class="keys"><b>Left thumb</b><span>Walk · push to the edge to run</span><b>Drag</b><span>Look around</span><b>Tap</b><span>Open/close doors, frunk, trunk, charge port</span><b>Get in</b><span>Appears at the driver door</span><b>Phone</b><span>Tesla app and Smart Summon</span></div>
      <h3>Driving</h3><div class="keys"><b>Wheel</b><span>Drag left / right to steer · tap the middle to honk</span><b>GO · BRAKE</b><span>Press · slide up to press harder</span><b>P R N D</b><span>Gear</span><b>Arrows</b><span>Turn signals</span><b>Drag</b><span>Look around · orbit the car outside</span><b>Pinch</b><span>Zoom from the driver's seat out to around the car</span><b>Double tap</b><span>Back to the driver's view</span></div>
      <h3>Touchscreen</h3><div class="keys"><b>Screen button</b><span>Opens the car's screen big</span><b>Drag · pinch</b><span>Pan and zoom the map, scroll lists</span></div>
      <h3>Self-Driving (Supervised)</h3><div class="keys"><b>FSD</b><span>Engage (set a destination on the screen first)</span><b>Brake · steer</b><span>Take over</span><b>GO</b><span>Go faster without disengaging</span></div>`;
    $('help').addEventListener('click', () => $('help').classList.remove('show'));
  }
  // the touchscreen panel: where it is, and a quad that draws the screen's picture there
  const panelScene = new THREE.Scene(), panelCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  panelScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: screen.rt.texture, toneMapped: false, depthTest: false, depthWrite: false })));
  const panelOpen = () => touchScreen && player.mode === 'car';
  const panelAt = (x, y) => {
    if (!panelOpen()) return null;
    const r = touch.panelRect();
    if (x < r.x || y < r.y || x > r.x + r.w || y > r.y + r.h) return null;
    return { px: ((x - r.x) / r.w) * SW, py: ((y - r.y) / r.h) * SH };
  };
  // if anything grabs the mouse while the phone is out, give it straight back
  document.addEventListener('pointerlockchange', () => { if (phone.open && document.pointerLockElement) document.exitPointerLock(); });
  model.screenMesh.material.map = screen.rt.texture;
  model.screenMesh.material.needsUpdate = true;

  // ---------------- post processing
  let composer = null, bloom = null;
  function applyQuality() {
    const hi = settings.quality === 'High';
    // (phones: sharp at up to 2x even on Medium, without the bloom pass and its multisampled buffer)
    renderer.setPixelRatio(hi ? Math.min(devicePixelRatio, 1.5) : TOUCH ? Math.min(devicePixelRatio, 2) : 1);
    renderer.setSize(innerWidth, innerHeight);
    sky.sun.shadow.mapSize.set(hi && !TOUCH ? 2048 : 1024, hi && !TOUCH ? 2048 : 1024);
    if (sky.sun.shadow.map) { sky.sun.shadow.map.dispose(); sky.sun.shadow.map = null; }
    if (hi) {
      const rt = new THREE.WebGLRenderTarget(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio(), { type: THREE.HalfFloatType, samples: 4 });
      composer = new EffectComposer(renderer, rt);
      composer.addPass(new RenderPass(scene, camera));
      // a single NaN/Inf pixel (a sun glint overflowing half-float) would be smeared by the bloom blur into
      // black blocks over the whole view: scrub them before blooming
      composer.addPass(new ShaderPass({
        uniforms: { tDiffuse: { value: null } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0); gl_FragColor = vec4(clamp(c.rgb, 0.0, 40.0), c.a); }',
      }));
      bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.32, 0.45, 2.6);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
    } else composer = null;
  }
  applyQuality();
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    if (composer) composer.setSize(innerWidth, innerHeight);
  });

  // ---------------- input
  const keys = {};
  const ray = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let rightDrag = null, leftDown = null, hoverScreen = null, hoverLabel = null, wipersT = 0;
  const DISENGAGE = new Set(['KeyS', 'KeyA', 'KeyD', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
  addEventListener('keydown', (e) => {
    if (!started) return;
    if (player.mode === 'car' && screen.isTyping()) {
      // letters go into the hidden input; only Enter/Escape are handled here, and nothing drives the car
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); screen.key(e); }
      return;
    }
    if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (keys[e.code]) return;
    keys[e.code] = true;
    if (player.mode === 'car') {
      if (fsd.engaged && DISENGAGE.has(e.code)) disengage('Self-Driving disengaged', e.code === 'KeyS' || e.code === 'Space' || e.code === 'ArrowDown' ? 'Brake pressed — you have control' : 'Steering override — you have control');
      if (e.code === 'KeyP' || e.code === 'Digit1') act.setGear('P');
      if (e.code === 'KeyR' || e.code === 'Digit2') act.setGear('R');
      if (e.code === 'KeyN' || e.code === 'Digit3') act.setGear('N');
      if (e.code === 'KeyF' || e.code === 'Digit4') act.setGear('D');
      if (e.code === 'KeyZ') { car.signal = car.signal === 'L' ? null : 'L'; signalArmed = false; }
      if (e.code === 'KeyX') { car.signal = car.signal === 'R' ? null : 'R'; signalArmed = false; }
      if (e.code === 'KeyH') audio.hornOn();
      if (e.code === 'KeyL') act.cycleHeadlights();
      if (e.code === 'KeyV') { const o = ['fp', 'chase', 'orbit']; player.camMode = o[(o.indexOf(player.camMode) + 1) % 3]; }
      if (e.code === 'Tab') player.focusScreen = !player.focusScreen;
      if (e.code === 'KeyE') exitCar();
    } else {
      if (e.code === 'KeyE') tryEnter();
      if (e.code === 'Digit1' || e.code === 'Numpad1') phone.toggle();
      if (e.code === 'Escape' && phone.open) phone.toggle(false);
      if (phone.open && phone.key(e.code)) e.preventDefault();
    }
    if (e.code === 'KeyM') audio.setMuted(!audio.muted);
    if (e.code === 'Slash' || e.code === 'F1') $('help').classList.toggle('show');
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; if (e.code === 'KeyH') audio.hornOff(); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  $('kbd').addEventListener('input', (e) => screen.onInput(e.target.value));
  canvas.addEventListener('mousedown', (e) => { if (player.mode === 'car' && screen.isTyping()) e.preventDefault(); });
  $('kbd').addEventListener('blur', () => { setTimeout(() => { if (screen.search.focused && document.activeElement !== $('kbd') && player.mode !== 'car') screen.blurSearch(); }, 0); });
  const setMouse = (e) => { mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); };
  function screenHit() {
    if (player.mode !== 'car' || player.camMode !== 'fp') return null;
    ray.setFromCamera(mouse, camera);
    const hits = ray.intersectObjects([model.screenMesh, ...model.interact.filter((m) => m.userData.inside)], false);
    return hits[0] || null;
  }
  // touches on the view itself (the on-screen controls keep their own): one finger looks, orbits or taps,
  // two fingers pinch to zoom
  const touches = new Map();
  let pinch = null, lastTap = null, tapStart = null, panelDrag = null;
  const pinchDist = () => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const pinchMid = () => { const [a, b] = [...touches.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  canvas.addEventListener('pointerdown', (e) => {
    if (!started) return;
    audio.init();
    setMouse(e);
    const isTouch = e.pointerType === 'touch';
    if (isTouch) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        // a second finger: pinch, and whatever the first one was doing stops
        if (panelDrag) { screen.pointer(0, 0, 'up'); panelDrag = null; }
        if (leftDown && leftDown.screen) screen.pointer(0, 0, 'up');
        footDrag = null; leftDown = null; tapStart = null; lastTap = null;
        const m = pinchMid();
        pinch = { d: pinchDist(), panel: panelAt(m.x, m.y) };
        return;
      }
      if (touches.size > 2) return;
      const pp = panelAt(e.clientX, e.clientY);
      if (pp) { panelDrag = { id: e.pointerId, px: pp.px, py: pp.py, moved: 0, acc: 0, scrolled: false }; screen.pointer(pp.px, pp.py, 'down'); return; }
      // double tap in the car (two quick taps in one spot): back to the driver's seat, looking ahead
      const now = performance.now();
      if (player.mode === 'car' && lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) { player.camMode = 'fp'; player.lookYaw = 0; player.lookPitch = -0.08; zoomFov = 72; lastTap = null; }
      tapStart = { id: e.pointerId, t: now, x: e.clientX, y: e.clientY };
    }
    if (player.mode === 'foot') {
      if (document.pointerLockElement === canvas) { if (e.button === 0) footClick(false); return; }
      footDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
      // with the phone out the mouse stays free for tapping it (drag still looks around)
      if (!TOUCH && !lockFailed && !phone.open) tryLock();
      return;
    }
    if (e.button === 2) { rightDrag = { x: e.clientX, y: e.clientY }; return; }
    if (player.camMode !== 'fp') { leftDown = { id: e.pointerId, x: e.clientX, y: e.clientY, touch: isTouch }; return; }
    const h = screenHit();
    if (h && h.object === model.screenMesh) {
      leftDown = { id: e.pointerId, screen: true, x: e.clientX, y: e.clientY };
      screen.pointer(h.uv.x * SW, (1 - h.uv.y) * SH, 'down');
    } else if (h && h.object.userData.action) act.interior(h.object.userData.action);
    else leftDown = { id: e.pointerId, x: e.clientX, y: e.clientY, touch: isTouch };
  });
  addEventListener('pointermove', (e) => {
    if (!started) return;
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch) {
        if (touches.size < 2) return;
        const d = pinchDist(), r = d / pinch.d;
        if (!pinch.panel && player.mode === 'car' && player.camMode !== 'fp') {
          // outside the car the distance follows the fingers smoothly (closer than 4 m: back in the seat)
          const o = player.orbit;
          if (player.camMode === 'chase') { player.camMode = 'orbit'; o.a = 0; o.e = 0.3; o.d = o.dT = 8; }
          o.dT = Math.min(40, (o.dT ?? o.d) / r); pinch.d = d;
          if (o.dT < 4) { player.camMode = 'fp'; player.lookYaw = 0; player.lookPitch = -0.08; zoomFov = 72; o.dT = 6.5; pinch.d = d; }
        } else if (r > 1.12 || r < 0.89) {
          const dir = r > 1 ? -1 : 1; // fingers apart: zoom in
          if (pinch.panel) { const m = pinchMid(), pp = panelAt(m.x, m.y) || pinch.panel; screen.wheel(pp.px, pp.py, dir); }
          else zoomStep(dir);
          pinch.d = d;
        }
        return;
      }
    }
    if (panelDrag) {
      if (e.pointerId !== panelDrag.id) return;
      const pp = panelAt(e.clientX, e.clientY);
      if (!pp) return;
      panelDrag.moved += Math.abs(pp.px - panelDrag.px) + Math.abs(pp.py - panelDrag.py);
      screen.pointer(pp.px, pp.py, 'move');
      // outside the map a drag scrolls the list under the finger, a step per row
      if (!screen.drag) {
        panelDrag.acc += pp.py - panelDrag.py;
        while (Math.abs(panelDrag.acc) > 56) { const s = Math.sign(panelDrag.acc); screen.wheel(pp.px, pp.py, -s); panelDrag.acc -= s * 56; panelDrag.scrolled = true; }
      }
      panelDrag.px = pp.px; panelDrag.py = pp.py;
      return;
    }
    if (player.mode === 'foot' && document.pointerLockElement === canvas) {
      player.yaw -= e.movementX * 0.0022; player.pitch = clamp(player.pitch - e.movementY * 0.0022, -1.4, 1.4);
      return;
    }
    setMouse(e);
    const look = e.pointerType === 'touch' ? 0.0052 : 0.004;
    if (player.mode === 'foot') {
      if (footDrag && footDrag.id === e.pointerId) {
        const dx = e.clientX - footDrag.x, dy = e.clientY - footDrag.y;
        footDrag.moved += Math.abs(dx) + Math.abs(dy);
        player.yaw -= dx * look; player.pitch = clamp(player.pitch - dy * look, -1.4, 1.4);
        footDrag.x = e.clientX; footDrag.y = e.clientY;
      }
      return;
    }
    if (rightDrag) {
      if (player.camMode === 'fp') {
        player.lookYaw = clamp(player.lookYaw - (e.clientX - rightDrag.x) * 0.004, -2.4, 2.4);
        player.lookPitch = clamp(player.lookPitch - (e.clientY - rightDrag.y) * 0.004, -1.2, 0.9);
      } else {
        // outside: right-drag orbits around the car (left/right) and up/down over it
        if (player.camMode === 'chase') { player.camMode = 'orbit'; player.orbit.a = 0; player.orbit.e = 0.3; player.orbit.d = player.orbit.dT = 8; }
        player.orbit.a -= (e.clientX - rightDrag.x) * 0.006;
        player.orbit.e = clamp(player.orbit.e + (e.clientY - rightDrag.y) * 0.004, 0.03, 1.45);
      }
      rightDrag = { x: e.clientX, y: e.clientY }; player.focusScreen = false;
      return;
    }
    if (leftDown && !leftDown.screen && leftDown.id === e.pointerId) {
      const dx = e.clientX - leftDown.x, dy = e.clientY - leftDown.y;
      if (player.camMode !== 'fp') {
        if (player.camMode === 'chase') { player.camMode = 'orbit'; player.orbit.a = 0; player.orbit.e = 0.3; player.orbit.d = player.orbit.dT = 8; }
        player.orbit.a -= dx * 0.006; player.orbit.e = clamp(player.orbit.e + dy * 0.004, 0.05, 1.3);
      } else if (leftDown.touch) {
        // a finger dragged across the windscreen looks around the cabin
        player.lookYaw = clamp(player.lookYaw - dx * look, -2.4, 2.4);
        player.lookPitch = clamp(player.lookPitch - dy * look, -1.2, 0.9);
        lookTouchT = 0;
      }
      leftDown.x = e.clientX; leftDown.y = e.clientY;
    }
    const h = screenHit();
    hoverScreen = h && h.object === model.screenMesh ? h : null;
    hoverLabel = h && h.object.userData.label ? h.object.userData.label : null;
    if (leftDown && leftDown.screen && leftDown.id === e.pointerId && hoverScreen) screen.pointer(h.uv.x * SW, (1 - h.uv.y) * SH, 'move');
    if (e.pointerType !== 'touch') canvas.style.cursor = h ? 'pointer' : 'default';
  });
  const pointerEnd = (e, cancel) => {
    if (!started) return;
    const wasPinch = !!pinch;
    if (e.pointerType === 'touch') {
      touches.delete(e.pointerId); if (touches.size < 2) pinch = null;
      // a quick tap that didn't move (and wasn't part of a pinch) can be the first of a double tap
      const ts = tapStart && tapStart.id === e.pointerId ? tapStart : null;
      lastTap = ts && !wasPinch && performance.now() - ts.t < 260 && Math.hypot(e.clientX - ts.x, e.clientY - ts.y) < 12 ? { t: performance.now(), x: e.clientX, y: e.clientY } : null;
      if (ts) tapStart = null;
    }
    if (panelDrag && e.pointerId === panelDrag.id) {
      const dragged = screen.pointer(0, 0, 'up'), pp = panelAt(e.clientX, e.clientY);
      if (!cancel && !dragged && !panelDrag.scrolled && panelDrag.moved < 24 && pp) screen.click(pp.px, pp.py);
      panelDrag = null;
      return;
    }
    if (wasPinch) return;
    if (footDrag && footDrag.id === e.pointerId) { if (!cancel && footDrag.moved < 8 && player.mode === 'foot') { setMouse(e); footClick(true); } footDrag = null; return; }
    if (e.button === 2) { rightDrag = null; return; }
    if (leftDown && leftDown.id !== e.pointerId) return;
    if (leftDown && leftDown.screen) {
      setMouse(e);
      const dragged = screen.pointer(0, 0, 'up');
      const h = screenHit();
      if (!cancel && !dragged && h && h.object === model.screenMesh) screen.click(h.uv.x * SW, (1 - h.uv.y) * SH);
    }
    leftDown = null;
  };
  addEventListener('pointerup', (e) => pointerEnd(e, false));
  addEventListener('pointercancel', (e) => pointerEnd(e, true));
  // zoom a step: out (dir > 0) or in. In the car it runs continuously from the driver's seat out to a
  // view around the car and back
  function zoomStep(dir) {
    if (player.mode !== 'car') { zoomFov = clamp(zoomFov + dir * 4, 24, 80); return; }
    const o = player.orbit;
    if (player.camMode === 'fp') {
      if (dir > 0) {
        if (zoomFov < 72) { zoomFov = Math.min(72, zoomFov + 4); return; }
        player.camMode = 'orbit'; o.a = 0; o.e = 0.22; o.d = 4.2; o.dT = 6.5; player.focusScreen = false;
      } else zoomFov = Math.max(24, zoomFov - 4);
      return;
    }
    if (player.camMode === 'chase') player.camMode = 'orbit';
    o.dT = (o.dT ?? o.d) * (dir > 0 ? 1.12 : 0.89);
    if (o.dT < 4) { player.camMode = 'fp'; player.lookYaw = 0; player.lookPitch = -0.08; zoomFov = 72; o.dT = 6.5; return; }
    o.dT = Math.min(o.dT, 40);
  }
  canvas.addEventListener('wheel', (e) => {
    if (!started) return;
    e.preventDefault();
    setMouse(e);
    if (player.mode === 'car') {
      const h = screenHit();
      if (h && h.object === model.screenMesh && screen.wheel(h.uv.x * SW, (1 - h.uv.y) * SH, e.deltaY)) return;
    }
    zoomStep(Math.sign(e.deltaY));
  }, { passive: false });

  let zoomFov = 72, signalArmed = false, started = false, footDrag = null, lockFailed = false, headless = false;
  function tryLock() {
    try { const p = canvas.requestPointerLock?.(); if (p && p.catch) p.catch(() => { lockFailed = true; }); } catch (err) { lockFailed = true; }
  }

  // ---------------- on-foot interaction
  function footRay(useMouse) {
    ray.setFromCamera(useMouse ? mouse : new THREE.Vector2(0, 0), camera);
    ray.far = 3.6;
    const h = ray.intersectObjects(model.interact.filter((m) => !m.userData.inside), false)[0];
    ray.far = Infinity;
    return h;
  }
  function footClick(useMouse) {
    const h = footRay(useMouse);
    if (!h) return;
    const k = h.object.userData.action;
    if (k === 'chargeport') { if (state.chargeAvail) { if (car.charging) act.stopCharge(); else act.startCharge(); } else act.chargePort(); return; }
    act.toggle(k);
  }
  function driverDoorWorld() { model.root.updateMatrixWorld(); return model.chassis.localToWorld(new THREE.Vector3(...vehicle.spec.driverDoor)); }
  function tryEnter() {
    if (fsd.summon) {
      if (Math.abs(car.v) > 0.3) { setHint('Wait for your car to stop'); return; }
      stopSummon('You took over');
    }
    const d = driverDoorWorld();
    if (Math.hypot(player.x - d.x, player.z - d.z) > 2.6) { setHint('Walk to the driver door (front left) to get in'); return; }
    if (state.locked) { state.locked = false; audio.chime('unlock'); }
    const wasOpen = model.isOpen('FL');
    if (!wasOpen) { model.toggle('FL'); audio.door(true); }
    setTimeout(() => {
      // (a phone held upright mostly sees the dashboard from the seat: start behind the car instead)
      player.mode = 'car'; player.lookYaw = 0; player.lookPitch = -0.08; player.camMode = TOUCH && innerHeight > innerWidth ? 'chase' : 'fp';
      document.exitPointerLock?.();
      setTimeout(() => { if (model.isOpen('FL')) { model.toggle('FL'); setTimeout(() => audio.door(false), 450); } audio.chime('seat'); }, 500);
      toast('Welcome, Rudy', tw('Tap Start Supervised Full Self-Driving, or press F for Drive', 'Tap FSD to self-drive, or pick D and press GO'));
    }, wasOpen ? 150 : 650);
  }
  function exitCar() {
    if (fsd.engaged) disengage('Self-Driving canceled', 'Driver exited');
    if (Math.abs(car.v) > 0.5) { toast('Stop the car before getting out'); return; }
    if (car.gear !== 'P') { car.gear = 'P'; audio.chime('gear'); }
    if (!model.isOpen('FL')) { model.toggle('FL'); audio.door(true); }
    const left = { x: Math.sin(car.h), z: -Math.cos(car.h) };
    const side = CAR_WID / 2 + 0.95;
    player.x = car.cx + left.x * side - Math.cos(car.h) * 0.4; player.z = car.cz + left.z * side - Math.sin(car.h) * 0.4;
    player.yaw = yawFromHeading(car.h) + Math.PI * 0.5; player.pitch = -0.15;
    player.mode = 'foot'; touchScreen = false;
    setHint(tw('Click to look around · click the door to close it', 'Drag to look around · tap the door to close it'));
  }
  let hintT = 0;
  function setHint(t, dur = 3) { $('hint').textContent = t; $('hint').style.opacity = 1; hintT = dur; }

  // ---------------- loop
  let last = performance.now(), cubeFrame = 0, perceptT = 0, blinkT = 0, chargeCheckT = 0, beepT = 0, lowBattWarned = false, lastLocked = state.locked, throttle = 0;
  const clock = { simT: 0 };
  function update(dt) {
    clock.simT += dt;
    state.hours = (state.hours + (dt * settings.timeScale) / 3600) % 24;
    const focus = player.mode === 'car' ? { x: car.cx, y: car.y, z: car.cz } : { x: player.x, y: player.y - 1.7, z: player.z };
    const night = state.night = sky.update(dt, state.hours, focus, camera);
    state.temp = lerp(state.temp, 66 + 18 * (1 - night), dt * 0.05);
    city.update(dt, night);
    setNPCNight(night);
    // inputs
    const inCar = player.mode === 'car', typing = screen.isTyping();
    const k = (c) => !typing && keys[c];
    const tc = touch && inCar ? touch : null;
    const wantT = inCar ? Math.max(k('KeyW') || k('ArrowUp') ? 1 : 0, tc ? tc.throttle : 0) : 0;
    throttle += clamp(wantT - throttle, -dt * 4, dt * 2.6);
    const input = {
      throttle: inCar ? throttle : 0,
      brake: inCar ? Math.max(k('KeyS') || k('ArrowDown') || k('Space') ? 1 : 0, tc ? tc.brake : 0) : 0,
      steerIn: tc && tc.steering ? tc.steer : inCar ? (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0) : 0,
    };
    // turning the touch wheel takes over from Self-Driving, like the A / D keys
    if (tc && tc.steering && Math.abs(tc.steer) > 0.18 && fsd.engaged && !fsd.summon) disengage('Self-Driving disengaged', 'Steering override — you have control');
    // after looking around by touch, the driver's view drifts back to the road once the car is moving
    lookTouchT += dt;
    if (tc && player.camMode === 'fp' && !player.focusScreen && lookTouchT > 1.6 && Math.abs(car.v) > 2 && !(leftDown && leftDown.touch)) {
      player.lookYaw = lerp(player.lookYaw, 0, Math.min(1, dt * 1.6)); player.lookPitch = lerp(player.lookPitch, -0.08, Math.min(1, dt * 1.6));
    }
    // perception (all 8 cameras) at 20 Hz
    perceptT -= dt;
    if (perceptT <= 0) { perceptT = 0.05; vision.update(0.05, car, traffic.vehicles); }
    // self driving (and Smart Summon, which drives the car while you're outside it)
    let cmd = null;
    fsd.peds = inCar ? [] : [{ x: player.x, z: player.z }];
    if (fsd.engaged && fsd.summon) {
      // follow the owner if they walk off: re-plan from the aisle every so often
      summonRetarget -= dt;
      const sm = fsd.summon;
      if (summonRetarget <= 0 && car.gear === 'D' && Math.hypot(player.x - sm.x, player.z - sm.z) > 6 && !(fsd.lotOf(car) || {}).st) {
        summonRetarget = 1.5;
        const r = fsd.planSummon(car, player.x, player.z);
        if (r.err) stopSummon(r.err);
      }
      if (fsd.summon && Math.hypot(player.x - car.cx, player.z - car.cz) > SUMMON_RANGE + 15) stopSummon('You walked out of range');
    }
    if (fsd.engaged) {
      const out = fsd.step(dt, car, clock.simT);
      if (out.gear && out.gear !== car.gear) { car.gear = out.gear; audio.chime('gear'); }
      car.signal = out.signal;
      cmd = { accel: out.accel, steer: out.steer };
      if (fsd.summon) {
        fsd.summonStatus = fsd.pedStop ? 'Waiting for you to move' : car.gear === 'R' ? 'Backing out' : fsd.status.startsWith('Yielding') ? 'Yielding to traffic' : out.done ? 'Arrived' : 'Coming to you';
        if (out.takeover) { stopSummon('Stopped: something is in the way'); cmd = null; }
        else if (out.done) {
          car.gear = 'P'; fsd.disengage(); fsd.summon = null; car.signal = null; cmd = null;
          audio.chime('arrive'); phone.note(`<b>Your ${vehicle.name} has arrived</b> · ${tw('press E at the driver door to get in', 'tap Get in at the driver door')}`);
          setHint(`Your ${vehicle.name} is here · ${tw('press E at the driver door', 'tap Get in at the driver door')}`);
        } else if (out.replanOff) stopSummon('Stopped: off the planned path');
      } else if (out.takeover) disengage('Take over immediately', 'Self-Driving could not maintain a safe gap', true);
      else if (out.done) {
        const dest = fsd.dest, stall = fsd.stall;
        car.gear = 'P'; fsd.disengage(); car.signal = null; cmd = null;
        audio.chime('arrive');
        if (stall) stall.occupied = true;
        if (dest) { toast(`Arrived at ${dest.name}`, 'Parked · Self-Driving complete', '#20b85a'); nav.clear(); }
        if (dest && dest.cat === 'charger') setTimeout(() => { refreshChargeAvail(); act.startCharge(); }, 900);
      } else if (out.replan) fsd.plan(car, null, { keepEvents: true });
      else if (out.replanHint) { const keep = fsd.path; const err = fsd.plan(car, fsd.dest, { laneHint: out.replanHint, keepEvents: true }); if (err) fsd.path = keep; }
      else if (out.replanOff && !fsd._replanned) { fsd._replanned = true; const err = fsd.plan(car, fsd.dest); if (err) disengage('Self-Driving disengaged', err); setTimeout(() => { fsd._replanned = false; }, 1500); }
    } else if (car.signal && inCar) {
      // auto-cancel manual signals after the turn completes
      if (Math.abs(car.steer) > 0.22) signalArmed = true;
      else if (signalArmed && Math.abs(car.steer) < 0.04) { car.signal = null; signalArmed = false; }
    }
    if (!inCar && car.gear !== 'P' && !fsd.summon) car.gear = 'P';
    const others = traffic.vehicles;
    car.onCollide = (s) => { audio.thud(s); if (fsd.summon) stopSummon('Stopped: collision detected'); else if (fsd.engaged) disengage('Take over immediately', 'Collision detected', true); };
    car.update(dt, input, cmd, others);
    if (car.battery <= 0.001 && car.gear === 'D' && !lowBattWarned) { lowBattWarned = true; toast('Battery depleted', 'Charge at a Supercharger', '#e82127'); audio.chime('error'); }
    if (car.battery < 0.1 && !state.lowWarn) { state.lowWarn = true; toast('Low battery', 'Navigate to a Supercharger soon', '#f5a623'); audio.chime('alert'); }
    if (car.battery > 0.15) state.lowWarn = false;
    // charging
    chargeCheckT -= dt;
    if (chargeCheckT <= 0) { chargeCheckT = 0.3; refreshChargeAvail(); const loc = city.locate(car.x, car.z, car.h); if (loc) state.speedLimit = Math.round(loc.e.limit * MPH / 5) * 5; }
    if (car.charging) {
      const b = car.battery, taper = b < 0.5 ? 1 : b < 0.7 ? 0.72 : b < 0.8 ? 0.48 : 0.24;
      const kw = (state.chargeAvail ? state.chargeAvail.lot.poi.kw : 250) * taper;
      car.chargeKw = lerp(car.chargeKw, kw, dt * 2);
      car.battery = Math.min(1, car.battery + dt * 0.0062 * (kw / 250));
      if (car.battery >= car.chargeLimit) { act.stopCharge(); toast('Charging complete', `${Math.round(car.battery * 100)}% · ${Math.round(car.rangeMi)} mi`, '#20b85a'); audio.chime('charge'); }
    }
    // traffic
    traffic.update(dt, { x: car.cx, z: car.cz, y: car.y, v: Math.abs(car.v), h: car.v < 0 ? car.h + Math.PI : car.h, L: CAR_LEN, W: CAR_WID, route: fsd.engaged && car.v > 0.3 ? fsd.ahead(45) : null });
    // turn signals
    blinkT -= dt;
    if (blinkT <= 0) {
      blinkT = 0.36; state.blinkOn = !state.blinkOn;
      if ((car.signal || car.hazard) && inCar) audio.tick(state.blinkOn);
      if (!car.signal && !car.hazard) state.blinkOn = false;
    }
    // park assist from vision: distance behind the rear bumper
    state.rearGap = 9;
    if (car.gear === 'R') {
      state.rearGap = rearGap();
      beepT -= dt;
      if (state.rearGap < 2.2 && beepT <= 0 && inCar) { audio.chime('park'); beepT = state.rearGap < 0.45 ? 0.09 : 0.1 + state.rearGap * 0.35; }
    }
    // phone-key auto lock
    const dCar = Math.hypot(player.x - car.cx, player.z - car.cz);
    if (!inCar) {
      if (state.locked && dCar < 3.2) { state.locked = false; audio.chime('unlock'); setHint(tw('Unlocked with phone key · click a door, frunk or trunk · E to get in', 'Unlocked with phone key · tap a door, frunk or trunk to open it')); }
      else if (!state.locked && dCar > 7 && !model.anyDoorOpen()) { state.locked = true; audio.chime('lock'); }
    }
    if (state.locked !== lastLocked) lastLocked = state.locked;
    // model
    const awake = inCar || dCar < 6 || car.charging || !!fsd.summon || flashT > 0;
    model.root.position.set(car.cx, car.y, car.cz);
    model.root.rotation.order = 'YXZ';
    {
      // pitch with the ground (hills, the freeway's overpasses)
      const fx = Math.cos(car.h) * WHEELBASE / 2, fz = Math.sin(car.h) * WHEELBASE / 2;
      const hf = city.groundHeight(car.cx + fx, car.cz + fz, car.y), hr = city.groundHeight(car.cx - fx, car.cz - fz, car.y);
      model.root.rotation.x = lerp(model.root.rotation.x, Math.atan2(hf - hr, WHEELBASE), Math.min(1, dt * 8));
    }
    model.root.rotation.y = yawFromHeading(car.h);
    const headlights = settings.headlights === 'On' || (settings.headlights === 'Auto' && night > 0.35 && awake);
    wipersT = Math.max(0, wipersT - dt);
    model.update(dt, { v: car.v, steer: car.steer, accel: car.accel, latAcc: car.latAcc, dist: car.dist, signal: car.signal, hazard: car.hazard, blinkOn: state.blinkOn, headlights, braking: car.braking && awake, gear: car.gear, awake, night, time: clock.simT, charging: car.charging, fsd: fsd.engaged && !fsd.summon, volume: audio.volume, wipers: wipersT > 0 });
    dome.intensity = model.anyDoorOpen() ? 1.2 : 0;
    model.screenMesh.material.color.setScalar(awake ? (composer ? 1.45 / renderer.toneMappingExposure : 1) * lerp(1, 0.85, night) : 0.02);
    if (flashT > 0) { flashT -= dt; if (flashT <= 0) car.hazard = false; }
    phone.update(dt);
    if (inCar && phone.open) phone.toggle(false);
    // navigation + screen
    nav.update(dt, car, fsd);
    audio.update({ v: car.v, load: Math.max(0, car.accel) / 5, gear: car.gear, inside: inCar, dist: dCar, awake });
    updateCamera(dt);
    // (phones: the small in-car screen redraws 15 times a second, the opened-up one 30)
    if (TOUCH) screen.minDt = panelOpen() ? 1 / 30 : 1 / 15;
    if ((inCar || dCar < 12) && !headless) screen.update(dt);
    // hints
    hintT -= dt;
    if (hintT <= 0) {
      if (!inCar) {
        const h = document.pointerLockElement === canvas ? footRay() : null;
        const dd = driverDoorWorld();
        if (h) { const a = h.object.userData.action; $('hint').textContent = a === 'chargeport' ? (state.chargeAvail ? 'Click to plug in / unplug' : 'Click to open the charge port') : `Click to ${model.isOpen(a) ? 'close' : 'open'} ${({ FL: 'driver door', FR: 'passenger door', RL: 'rear left door', RR: 'rear right door', frunk: 'frunk', trunk: 'trunk' })[a]}`; $('hint').style.opacity = 1; }
        else if (Math.hypot(player.x - dd.x, player.z - dd.z) < 2.6) { $('hint').textContent = tw('Press E to get in', 'Tap Get in'); $('hint').style.opacity = 1; }
        else if (document.pointerLockElement !== canvas) { $('hint').textContent = tw('Drag to look around · WASD to walk · click doors to open', 'Left thumb to walk · drag to look · tap a door to open it'); $('hint').style.opacity = 1; }
        else $('hint').style.opacity = 0;
      } else if (hoverLabel && !hoverScreen) { $('hint').textContent = hoverLabel; $('hint').style.opacity = 1; }
      else $('hint').style.opacity = 0;
    }
    $('crosshair').style.display = !inCar && document.pointerLockElement === canvas ? 'block' : 'none';
    if (touch && !headless) {
      const dd = driverDoorWorld();
      touch.update({
        inCar, nearDoor: !inCar && Math.hypot(player.x - dd.x, player.z - dd.z) < 2.6, screenOpen: panelOpen(), phoneOpen: phone.open,
        mph: Math.abs(car.v) * MPH, gear: car.gear, fsd: fsd.engaged && !fsd.summon, fsdStatus: fsd.status, dest: nav.dest && nav.dest.name,
        signal: car.signal, hazard: car.hazard, blinkOn: state.blinkOn, headlights: settings.headlights, muted: audio.muted, quality: settings.quality, steerAngle: car.steer,
      });
    }
    // reflections: one face of the cube at a time, spread over frames (all six at once was a hitch)
    cubeFrame++;
    if (!headless && cubeFrame % (settings.quality === 'High' ? 2 : TOUCH ? 8 : 6) === 0) {
      const f = cubeFace = (cubeFace + 1) % 6;
      if (f === 0) cubeCam.position.set(car.cx, 1.1, car.cz);
      model.root.visible = false; if (cable) cable.visible = false;
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(cubeRT, f); renderer.render(scene, cubeCam.children[f]);
      renderer.setRenderTarget(prev);
      model.root.visible = true; if (cable) cable.visible = true;
    }
  }
  let cubeFace = 0;

  function refreshChargeAvail() {
    const s = fsd.findStall(car);
    state.chargeAvail = s && s.st && s.lot.charger && car.gear === 'P' && Math.abs(car.v) < 0.1 ? s : null;
    if (!state.chargeAvail && car.charging) act.stopCharge();
  }

  function rearGap() {
    const fx = Math.cos(car.h), fz = Math.sin(car.h);
    const bx = car.x - fx * REAR_OFF, bz = car.z - fz * REAR_OFF;
    let best = 9;
    const consider = (px, pz) => {
      const dx = px - bx, dz = pz - bz, along = -(dx * fx + dz * fz), lat = -dx * fz + dz * fx;
      if (along < -0.2 || Math.abs(lat) > 1.25) return;
      best = Math.min(best, Math.max(0, along));
    };
    for (const o of city.queryObstacles(bx, bz)) {
      if (o.type === 'circle') consider(o.x - (o.x - bx) / Math.max(0.01, Math.hypot(o.x - bx, o.z - bz)) * o.r, o.z - (o.z - bz) / Math.max(0.01, Math.hypot(o.x - bx, o.z - bz)) * o.r);
      else { const [px, pz] = city.closestOnBox(o, bx, bz); consider(px, pz); }
    }
    for (const tr of vision.tracks.values()) {
      const c = Math.cos(tr.h), s = Math.sin(tr.h);
      for (const a of [-tr.L / 2, 0, tr.L / 2]) for (const b of [-tr.W / 2, tr.W / 2]) consider(tr.x + c * a - s * b, tr.z + s * a + c * b);
    }
    return best;
  }

  const tmpV = new THREE.Vector3();
  // a tall (portrait) screen keeps about the same side-to-side view as a wide one
  const fovK = () => (camera.aspect < 1 ? 1.32 : 1);
  function updateCamera(dt) {
    if (window.__freeCam) { const f = window.__freeCam; camera.position.set(...f.pos); camera.lookAt(...f.look); camera.fov = f.fov || 60; camera.updateProjectionMatrix(); return; }
    if (player.mode === 'foot') {
      // (the thumbstick: walk, pushed out to the rim to run)
      const tm = touch && !phone.open ? touch.move : { x: 0, y: 0 }, stick = Math.hypot(tm.x, tm.y);
      const sp = keys.ShiftLeft || keys.ShiftRight || stick > 0.92 ? 4.2 : 1.7;
      const fwd = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + tm.y, str = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + tm.x;
      const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw), rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
      let mx = fx * fwd + rx * str, mz = fz * fwd + rz * str;
      const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; } else if (l > 0 && stick === 0) { mx /= l; mz /= l; }
      player.x += mx * sp * dt; player.z += mz * sp * dt;
      // collisions: buildings, poles, the Model Y and traffic
      for (const o of city.queryObstacles(player.x, player.z)) {
        if (o.type === 'circle') { const dx = player.x - o.x, dz = player.z - o.z, d = Math.hypot(dx, dz), r = o.r + 0.3; if (d < r && d > 1e-4) { player.x = o.x + (dx / d) * r; player.z = o.z + (dz / d) * r; } }
        else { const r = obbVsAabb(player.x, player.z, [1, 0], [0, 1], 0.3, 0.3, o); if (r) { player.x += r[0] * r[2]; player.z += r[1] * r[2]; } }
      }
      const bodies = [{ x: car.cx, z: car.cz, h: car.h, L: 4.8, W: 1.95 }, ...traffic.vehicles];
      for (const o of bodies) {
        if (Math.abs(o.x - player.x) > 6 || Math.abs(o.z - player.z) > 6) continue;
        const r = obbVsCircle(o.x, o.z, [Math.cos(o.h), Math.sin(o.h)], [-Math.sin(o.h), Math.cos(o.h)], o.L / 2, o.W / 2, player.x, player.z, 0.32);
        if (r) { player.x -= r[0] * r[2]; player.z -= r[1] * r[2]; }
      }
      const gy = city.groundHeight(player.x, player.z) + 1.68 + (l > 0 ? Math.sin(clock.simT * (sp > 2 ? 11 : 7.5)) * 0.025 : 0);
      player.y = lerp(player.y, gy, Math.min(1, dt * 12));
      camera.position.set(player.x, player.y, player.z);
      camera.rotation.set(player.pitch, player.yaw, 0);
      camera.fov = lerp(camera.fov, 72 * fovK(), dt * 4);
    } else if (player.camMode === 'fp') {
      model.root.updateMatrixWorld();
      if (player.focusScreen) {
        // lean toward and look at the screen
        player.lookYaw = lerp(player.lookYaw, -0.5, dt * 5); player.lookPitch = lerp(player.lookPitch, -0.21, dt * 5);
        camera.fov = lerp(camera.fov, 34, dt * 4);
        const eye = vehicle.spec.eye;
        tmpV.set(eye.x + 0.12, eye.y - 0.03, eye.z - 0.1);
      } else {
        camera.fov = lerp(camera.fov, Math.min(100, zoomFov * fovK()), dt * 6);
        tmpV.copy(vehicle.spec.eye);
      }
      const p = model.chassis.localToWorld(tmpV.clone());
      camera.position.copy(p);
      camera.rotation.set(player.lookPitch + model.chassis.rotation.x * 0.6, yawFromHeading(car.h) + player.lookYaw, 0);
    } else if (player.camMode === 'chase') {
      const fx = Math.cos(car.h), fz = Math.sin(car.h);
      const tx = car.cx - fx * 7.5, tz = car.cz - fz * 7.5;
      const gy = Math.max(car.y, city.groundHeight(tx, tz));
      camera.position.lerp(tmpV.set(tx, 2.8 + gy, tz), Math.min(1, dt * 4));
      camera.lookAt(car.cx + fx * 4, 1.0 + car.y, car.cz + fz * 4);
      camera.fov = lerp(camera.fov, 62 * fovK(), dt * 3);
    } else {
      // orbit around the car: follows its heading, distance eases toward the wheel's target
      const o = player.orbit, a = yawFromHeading(car.h) + o.a;
      o.d = lerp(o.d, o.dT ?? o.d, Math.min(1, dt * 6));
      const ty = car.y + 0.9 * (CAR_H / 1.62);
      camera.position.set(car.cx + Math.sin(a) * Math.cos(o.e) * o.d, ty + Math.sin(o.e) * o.d, car.cz + Math.cos(a) * Math.cos(o.e) * o.d);
      // a building between the car and the camera: come in to this side of it
      const hit = city.segmentHit(car.cx, ty, car.cz, camera.position.x, camera.position.y, camera.position.z);
      if (hit < 1) camera.position.lerpVectors(tmpV.set(car.cx, ty, car.cz), camera.position.clone(), Math.max(0.12, hit - 0.5 / o.d));
      camera.position.y = Math.max(camera.position.y, city.groundHeight(camera.position.x, camera.position.z) + 0.4);
      camera.lookAt(car.cx, ty, car.cz);
      camera.fov = lerp(camera.fov, 55 * fovK(), dt * 3);
    }
    camera.updateProjectionMatrix();
  }

  function render() {
    renderer.setRenderTarget(null);
    // (phones: the shadows are redrawn every other frame; the lighting keeps using the matching light
    // position in between, so they don't swim)
    renderer.shadowMap.needsUpdate = !TOUCH || (++shadowFrame & 1) === 0;
    if (composer) composer.render(); else renderer.render(scene, camera);
    if (panelOpen()) {
      const r = touch.panelRect(), ac = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setViewport(r.x, innerHeight - r.y - r.h, r.w, r.h); renderer.setScissor(r.x, innerHeight - r.y - r.h, r.w, r.h); renderer.setScissorTest(true);
      renderer.render(panelScene, panelCam);
      renderer.setScissorTest(false); renderer.setViewport(0, 0, innerWidth, innerHeight);
      renderer.autoClear = ac;
    }
  }

  let fpsAcc = 0, fpsN = 0, shadowFrame = 0;
  // phones: the render resolution follows the frame rate (sharper when there's headroom, softer instead
  // of stuttering when there isn't)
  // (a level that was too slow isn't tried again for half a minute)
  const res = { max: Math.min(devicePixelRatio, 2), acc: 0, n: 0, calm: 0, bad: Infinity, badT: 0 };
  function adaptResolution(rawDt) {
    if (!TOUCH || settings.quality === 'High' || document.hidden || rawDt > 0.25) return;
    res.acc += rawDt; res.n++; res.badT -= rawDt;
    if (res.acc < 1.5) return;
    const ms = (res.acc / res.n) * 1000; res.acc = 0; res.n = 0;
    const cur = renderer.getPixelRatio();
    let pr = cur;
    if (ms > 24) { res.bad = pr; res.badT = 30; res.calm = 0; pr = Math.max(1, pr - (ms > 34 ? 0.25 : 0.125)); }
    else if (ms < 18.5) {
      res.calm += 1.5;
      const up = Math.min(res.max, pr + 0.125);
      if (res.calm >= 6 && (up < res.bad || res.badT <= 0)) { res.calm = 0; pr = up; }
    } else res.calm = 0;
    if (pr !== cur) { renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight); }
  }
  function loop(now) {
    requestAnimationFrame(loop);
    const raw = (now - last) / 1000, dt = Math.min(0.05, raw); last = now;
    if (!started) { updateCamera(0.016); render(); return; }
    update(dt);
    render();
    adaptResolution(raw);
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) { $('fps').textContent = `${Math.round(fpsN / fpsAcc)} fps · ${player.mode === 'car' ? `${Math.round(Math.abs(car.v) * MPH)} mph · ${car.gear}` : 'on foot'}${fsd.engaged ? ' · FSD' : ''}`; fpsAcc = 0; fpsN = 0; }
  }
  // first shadow + env
  sky.update(0, state.hours, { x: car.cx, z: car.cz }, camera);
  model.root.position.set(car.cx, car.y, car.cz); model.root.rotation.y = yawFromHeading(car.h);
  model.update(0, { v: 0, steer: 0, accel: 0, latAcc: 0, dist: 0, signal: null, blinkOn: false, headlights: false, braking: false, gear: 'P', awake: false, night: 0, time: 0, charging: false });
  updateCamera(0.016);
  model.root.visible = false; cubeCam.position.set(car.cx, 1.1, car.cz); cubeCam.update(renderer, scene); model.root.visible = true;
  requestAnimationFrame(loop);
  $('loading').classList.add('ready');
  setLoad('Ready');
  $('start').disabled = false;
  // which car to drive (picked on the start screen, remembered in this browser)
  let choice = 'modely';
  try { choice = localStorage.getItem('fsdcity.car') || 'modely'; } catch (err) { /* storage unavailable */ }
  const pickBtns = [...document.querySelectorAll('.pk')];
  const showPick = () => pickBtns.forEach((b) => { const on = b.dataset.car === choice; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  pickBtns.forEach((b) => b.addEventListener('click', () => { choice = b.dataset.car; try { localStorage.setItem('fsdcity.car', choice); } catch (err) { /* ignore */ } showPick(); }));
  showPick();
  async function loadVehicle(id) {
    if (VEHICLES[id]) return VEHICLES[id];
    const m = await import('./cybertruck.js');
    return (VEHICLES.cybertruck = { id: 'cybertruck', name: 'Cybertruck', full: 'Cybertruck AWD', build: m.buildCybertruck, paints: m.CYBER_PAINTS, paint: 'Stainless', spec: m.CYBERTRUCK });
  }
  game.useVehicle = async (id) => { const v = await loadVehicle(id); useVehicle(v); placePlayerNearCar(); return v; };
  $('start').addEventListener('click', async () => {
    if (choice !== vehicle.id) {
      $('start').disabled = true; setLoad('Building your Cybertruck…');
      try { await game.useVehicle(choice); } catch (err) { console.error(err); setLoad('Could not load that car — starting in the Model Y'); }
    }
    started = true; audio.init();
    $('loading').classList.add('hide');
    if (!TOUCH) tryLock();
    setHint(tw('Walk to the front-left door · press E to get in', 'Walk to the driver door (front left) · tap Get in'));
  });
  // (debug: advance the simulation without rendering, e.g. for automated tests in a background tab)
  window.__game = Object.assign(game, { player, camera, scene, renderer, screen, simulate: (seconds, dt = 1 / 60) => { headless = true; try { for (let t = 0; t < seconds; t += dt) update(dt); } finally { headless = false; } } });
}

boot().catch((e) => { console.error(e); setLoad('Failed to start: ' + e.message); });
