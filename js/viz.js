// The FSD visualization on the left of the touchscreen. It only draws what the vision system has
// detected (tracked vehicles, readable traffic lights, stop signs) plus lane markings and the blue
// planned path. In Park it becomes the car-status view with clickable doors, frunk and trunk.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { S, STOP, CURB, yawFromHeading, lerp, wrapAngle } from './config.js';
import { buildModelY, CAMERAS } from './car.js';

const THEMES = {
  day: { bg: 0xe4e5e7, ground: 0xd8dadd, road: 0xc9ccd0, white: 0xffffff, yellow: 0xe0b23c, curb: 0xa4a8ad, veh: 0x8f969d, vehPark: 0xa9aeb3 },
  night: { bg: 0x17181a, ground: 0x1d1e21, road: 0x2a2c30, white: 0xd8dbde, yellow: 0xc79a2a, curb: 0x50545a, veh: 0x9aa1a8, vehPark: 0x6c7177 },
};

export class Viz {
  constructor(city) {
    this.city = city;
    const sc = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, 540 / 736, 0.1, 500);
    sc.add(new THREE.HemisphereLight(0xffffff, 0x666666, 2.2));
    const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(-30, 60, 20); sc.add(dl);
    this.dl = dl;
    this.mats = {
      ground: new THREE.MeshBasicMaterial({ color: 0 }), road: new THREE.MeshBasicMaterial({ color: 0 }),
      white: new THREE.MeshBasicMaterial({ color: 0 }), yellow: new THREE.MeshBasicMaterial({ color: 0 }), curb: new THREE.MeshBasicMaterial({ color: 0 }),
      veh: new THREE.MeshStandardMaterial({ color: 0, roughness: 0.5, transparent: true }), vehPark: new THREE.MeshStandardMaterial({ color: 0, roughness: 0.6, transparent: true }),
      vglass: new THREE.MeshStandardMaterial({ color: 0x3e4349, roughness: 0.3, transparent: true }),
      stop: new THREE.MeshBasicMaterial({ color: 0xe0403a, transparent: true, opacity: 0.9 }),
    };
    const g = new THREE.PlaneGeometry(6000, 6000); g.rotateX(-Math.PI / 2);
    this.groundMesh = new THREE.Mesh(g, this.mats.ground); sc.add(this.groundMesh);
    this.buildMarkings();
    this.ego = buildModelY({ viz: true });
    sc.add(this.ego.root);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 5.2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }));
    shadow.position.y = 0.02; shadow.userData.shadow = true; this.ego.root.add(shadow);
    // vehicle pool
    const body = new RoundedBoxGeometry(1, 0.55, 1, 3, 0.12); body.translate(0, 0.55, 0);
    const cab = new RoundedBoxGeometry(0.84, 0.42, 0.55, 3, 0.12); cab.translate(0, 1.0, 0.05);
    this.vehPool = [];
    for (let i = 0; i < 60; i++) {
      const grp = new THREE.Group();
      const b = new THREE.Mesh(body, this.mats.veh), c = new THREE.Mesh(cab, this.mats.vglass);
      grp.add(b, c); grp.visible = false; sc.add(grp);
      this.vehPool.push({ grp, b, c, x: 0, z: 0, h: 0, id: null });
    }
    // traffic light icons + stop signs
    this.lightPool = [];
    for (let i = 0; i < 4; i++) {
      const grp = new THREE.Group();
      const box = new THREE.Mesh(new RoundedBoxGeometry(0.6, 1.5, 0.45, 2, 0.1), new THREE.MeshStandardMaterial({ color: 0x2a2c2f }));
      grp.add(box);
      const lamps = [0, 1, 2].map((k) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), new THREE.MeshBasicMaterial({ color: 0x333333 })); m.position.set(0, 0.45 - k * 0.45, -0.2); grp.add(m); return m; });
      grp.visible = false; sc.add(grp);
      this.lightPool.push({ grp, lamps });
    }
    this.signPool = [];
    for (let i = 0; i < 4; i++) {
      const oct = new THREE.Mesh(new THREE.CircleGeometry(0.55, 8).rotateZ(Math.PI / 8), new THREE.MeshBasicMaterial({ color: 0xd8302a, side: THREE.DoubleSide }));
      oct.visible = false; sc.add(oct); this.signPool.push(oct);
    }
    this.stopBar = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.mats.stop);
    this.stopBar.visible = false; sc.add(this.stopBar);
    // planned path ribbon
    this.pathN = 70;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array((this.pathN + 1) * 2 * 3), 3));
    pg.setAttribute('color', new THREE.BufferAttribute(new Float32Array((this.pathN + 1) * 2 * 4), 4));
    const idx = []; for (let i = 0; i < this.pathN; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    pg.setIndex(idx);
    this.pathMesh = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.pathMesh.renderOrder = 3; this.pathMesh.frustumCulled = false; sc.add(this.pathMesh);
    // camera coverage cones
    this.cones = new THREE.Group(); sc.add(this.cones); this.cones.visible = false;
    this.camH = 0; this.camInit = false;
    this.setTheme(false);
  }

  // swap the ego car model (Model Y / Cybertruck)
  setEgo(build) {
    const old = this.ego, shadow = old.root.children.find((o) => o.userData.shadow);
    this.scene.remove(old.root);
    this.ego = build({ viz: true });
    if (shadow) this.ego.root.add(shadow);
    this.scene.add(this.ego.root);
    const d = this.dark; this.dark = null; this.setTheme(!!d);
  }

  buildMarkings() {
    const quads = { white: [], yellow: [], curb: [], road: [] };
    const city = this.city;
    // curved edges are split into short straight pieces
    const q = (arr, e, u0, u1, w0, w1) => {
      const n = e.curve ? Math.max(1, Math.ceil((u1 - u0) / 3)) : 1;
      for (let k = 0; k < n; k++) {
        const a0 = u0 + ((u1 - u0) * k) / n, a1 = u0 + ((u1 - u0) * (k + 1)) / n;
        const a = city.edgePoint(e, a0, w0), b = city.edgePoint(e, a1, w0), c = city.edgePoint(e, a1, w1), d = city.edgePoint(e, a0, w1);
        arr.push([a, b, c, d]);
      }
    };
    const fwdCurved = new Set(); for (const r of city.hillRoads || []) for (const e of r.fwd) fwdCurved.add(e);
    for (const e of city.edges) {
      if (e.curve ? fwdCurved.has(e) : e.a < e.b) {
        const L = e.len, gA = !city.nodes[e.a].pass, gB = !city.nodes[e.b].pass, W = e.hw;
        const r0 = gA ? e.ra : 0, r1 = gB ? L - e.rb : L;
        q(quads.road, e, r0, r1, -W, W);
        for (const s of [-1, 1]) {
          if (e.lanes === 2) q(quads.yellow, e, gA ? e.sa + 0.3 : 0, gB ? L - e.sb - 0.3 : L, s * 0.1, s * 0.24);
          q(quads.curb, e, r0, r1, s * (W - 0.05), s * (W + 0.15));
          if (e.lanes === 2) for (let u = (gA ? e.sa + 0.3 : 0); u < L - 14; u += 12) q(quads.white, e, u, u + 3, s * 3.54, s * 3.66);
        }
      }
      if (e.zb) q(quads.white, e, e.len - e.sb + 0.15, e.len - e.sb + 0.55, 0.1, e.hw - 0.4);
    }
    for (const j of city.junctions) {
      const c = { x: j.n.x, z: j.n.z }, pts = j.pts;
      for (let i = 0; i < pts.length; i++) quads.road.push([c, pts[i], pts[(i + 1) % pts.length], c]);
    }
    const ys = { road: 0.005, white: 0.012, yellow: 0.012, curb: 0.012 };
    for (const [k, list] of Object.entries(quads)) {
      const pos = [], idx = [];
      for (const qd of list) {
        const b = pos.length / 3;
        for (const p of qd) pos.push(p.x, ys[k], p.z);
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0, side: THREE.DoubleSide }));
      this.mats[k] = m.material;
      this.scene.add(m);
    }
  }

  setTheme(dark) {
    if (this.dark === dark) return;
    this.dark = dark;
    const t = dark ? THEMES.night : THEMES.day;
    this.bg = new THREE.Color(t.bg);
    // the map fades out beyond what the cameras can make out
    this.scene.fog = new THREE.Fog(t.bg, 55, 105);
    this.mats.ground.color.setHex(t.ground); this.mats.road.color.setHex(t.road);
    this.mats.white.color.setHex(t.white); this.mats.yellow.color.setHex(t.yellow); this.mats.curb.color.setHex(t.curb);
    this.mats.veh.color.setHex(t.veh); this.mats.vehPark.color.setHex(t.vehPark);
    for (const k of ['paint']) this.ego.mats[k].color.setHex(dark ? 0xbfc3c8 : 0xd4d6d9);
  }

  buildCones() {
    {
      const colors = { main: 0x3e6ae1, narrow: 0x7a5af8, wide: 0x26a69a, lpillar: 0xf5a623, rpillar: 0xf5a623, lrep: 0xe5484d, rrep: 0xe5484d, rear: 0x8e8e93 };
      for (const cam of CAMERAS) {
        const r = Math.min(cam.range, 60), half = (cam.fov / 2) * Math.PI / 180;
        const sh = new THREE.Shape(); sh.moveTo(0, 0);
        for (let i = 0; i <= 16; i++) { const a = -half + (2 * half * i) / 16; sh.lineTo(Math.sin(a) * r, -Math.cos(a) * r); }
        sh.lineTo(0, 0);
        const geo = new THREE.ShapeGeometry(sh); geo.rotateX(Math.PI / 2);
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colors[cam.id], transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }));
        m.position.set(cam.pos[0], 0.04, cam.pos[2]); m.rotation.y = -cam.yaw * Math.PI / 180;
        this.cones.add(m);
      }
    }
  }

  update(dt, st) {
    const car = st.car;
    const yaw = yawFromHeading(car.h);
    this.ego.root.position.set(car.cx, 0, car.cz);
    this.ego.root.rotation.y = yaw;
    for (const k of Object.keys(this.ego.doors)) { this.ego.doors[k].cur = st.doors[k].cur; this.ego.doors[k].target = st.doors[k].target; }
    this.ego.update(0, { v: car.v, steer: car.steer, accel: 0, latAcc: 0, dist: 0, signal: car.signal, blinkOn: st.blinkOn, headlights: false, braking: car.braking, gear: car.gear, awake: true, night: 0, time: 0, charging: car.charging });
    this.ego.root.position.y = 0;
    // camera
    const park = st.parkView;
    if (!this.camInit) { this.camH = car.h; this.camInit = true; }
    this.camH += wrapAngle(car.h - this.camH) * Math.min(1, dt * 3);
    const fx = Math.cos(this.camH), fz = Math.sin(this.camH);
    if (park) {
      const lx = -7.4, lz = -5.6; // model frame: left (-x) and front (-z)
      const rx = -fz, rz = fx; // world right
      const ox = rx * lx + fx * -lz, oz = rz * lx + fz * -lz;
      this.camera.position.set(car.cx + ox, 3.6, car.cz + oz);
      this.camera.fov = 34;
      this.camera.lookAt(car.cx + fx * -0.2, 0.55, car.cz + fz * -0.2);
    } else {
      this.camera.fov = 52;
      this.camera.position.set(car.cx - fx * 8.5, 5.3, car.cz - fz * 8.5);
      this.camera.lookAt(car.cx + fx * 13, 0, car.cz + fz * 13);
    }
    this.camera.updateProjectionMatrix();
    // vehicles (only what vision tracks). Each track keeps its own model for as long as it's tracked, and
    // the model glides along with the track (extrapolated between the 20 Hz vision updates)
    const tracks = park ? [] : [...st.tracks.values()].sort((a, b) => ((a.x - car.cx) ** 2 + (a.z - car.cz) ** 2) - ((b.x - car.cx) ** 2 + (b.z - car.cz) ** 2)).slice(0, this.vehPool.length);
    const live = new Set(tracks.map((t) => t.id));
    for (const p of this.vehPool) if (p.id !== null && !live.has(p.id)) { p.id = null; p.grp.visible = false; }
    for (const tr of tracks) {
      let p = this.vehPool.find((q) => q.id === tr.id);
      if (!p) { p = this.vehPool.find((q) => q.id === null); if (!p) continue; p.id = tr.id; p.x = tr.x; p.z = tr.z; p.h = tr.h; }
      const k = Math.min(1, dt * 8);
      p.x += Math.cos(p.h) * tr.v * dt; p.z += Math.sin(p.h) * tr.v * dt;
      p.x = lerp(p.x, tr.x, k); p.z = lerp(p.z, tr.z, k); p.h += wrapAngle(tr.h - p.h) * k;
      p.grp.visible = true;
      p.grp.position.set(p.x, 0, p.z); p.grp.rotation.y = yawFromHeading(p.h);
      p.grp.scale.set(tr.W, tr.H / 1.6, tr.L);
      p.b.material = tr.parked ? this.mats.vehPark : this.mats.veh;
    }
    // traffic lights + stop signs
    const lights = park ? [] : [...st.lights.values()];
    this.lightPool.forEach((lp, i) => {
      const L = lights[i];
      if (!L) { lp.grp.visible = false; return; }
      lp.grp.visible = true; lp.grp.position.set(L.x, 4.6, L.z);
      lp.grp.rotation.y = Math.atan2(-L.edge.dx, -L.edge.dz);
      const on = { R: 0, Y: 1, G: 2 }[L.state];
      const cols = [0xff3b30, 0xffcc00, 0x34c759];
      lp.lamps.forEach((m, k) => m.material.color.setHex(k === on ? cols[k] : 0x3a3a3a));
    });
    const signs = park ? [] : [...st.signs.values()];
    this.signPool.forEach((o, i) => {
      const s = signs[i];
      if (!s) { o.visible = false; return; }
      o.visible = true; o.position.set(s.x, 2.4, s.z); o.rotation.y = Math.atan2(-s.edge.dx, -s.edge.dz);
    });
    // red stop line when stopping
    if (!park && st.stopLine) {
      const { e } = st.stopLine;
      const p = this.city.edgePoint(e, e.len - e.sb + 0.35, e.hw / 2);
      this.stopBar.visible = true; this.stopBar.position.set(p.x, 0.03, p.z);
      this.stopBar.rotation.y = Math.atan2(-e.dx, -e.dz);
      this.stopBar.scale.set(e.hw - 0.5, 1, 0.55);
    } else this.stopBar.visible = false;
    // planned path
    const pts = park ? [] : st.path || [];
    const pos = this.pathMesh.geometry.attributes.position, col = this.pathMesh.geometry.attributes.color;
    const N = this.pathN;
    if (pts.length > 1) {
      this.pathMesh.visible = true;
      for (let i = 0; i <= N; i++) {
        const f = i / N, k = f * (pts.length - 1), k0 = Math.floor(k), k1 = Math.min(pts.length - 1, k0 + 1), t = k - k0;
        const x = lerp(pts[k0][0], pts[k1][0], t), z = lerp(pts[k0][1], pts[k1][1], t);
        const a = pts[Math.max(0, k0 - 1)], b = pts[Math.min(pts.length - 1, k0 + 1)];
        let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        const w = 0.85;
        pos.setXYZ(i * 2, x - tz * w, 0.04, z + tx * w); pos.setXYZ(i * 2 + 1, x + tz * w, 0.04, z - tx * w);
        const alpha = 0.85 * (1 - f * f) * Math.min(1, i / 3 + 0.3);
        const c = this.dark ? [0.32, 0.5, 1.0] : [0.2, 0.4, 0.95];
        col.setXYZW(i * 2, c[0], c[1], c[2], alpha); col.setXYZW(i * 2 + 1, c[0], c[1], c[2], alpha);
      }
      pos.needsUpdate = true; col.needsUpdate = true;
    } else this.pathMesh.visible = false;
    // camera coverage overlay
    this.cones.visible = !park && st.showCones;
    if (this.cones.visible) {
      if (!this.cones.children.length && !this.conesLoading) { this.conesLoading = true; this.buildCones(); }
      this.cones.position.set(car.cx, 0, car.cz); this.cones.rotation.y = yaw;
    }
  }

  render(renderer, rt, x, y, w, h) {
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    rt.viewport.set(x, y, w, h); rt.scissor.set(x, y, w, h); rt.scissorTest = true;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(this.bg, 1); renderer.clear();
    renderer.render(this.scene, this.camera);
  }

  // screen-space helpers for the Park view
  project(localPt, w, h) {
    const v = localPt.clone(); this.ego.root.localToWorld(v); v.project(this.camera);
    return [(v.x * 0.5 + 0.5) * w, (1 - (v.y * 0.5 + 0.5)) * h, v.z < 1];
  }
  pick(nx, ny) {
    const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const meshes = Object.entries(this.ego.doors).map(([k, d]) => { d.mesh.userData.key = k; return d.mesh; });
    const hit = rc.intersectObjects(meshes, false)[0];
    return hit ? hit.object.userData.key : null;
  }
}
