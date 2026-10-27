// Day/night cycle: physical sky, sun/moon shadow light that follows the player, hemisphere fill,
// stars, fog tint, exposure and a periodically regenerated PMREM environment for reflections.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { clamp, lerp, smooth } from './config.js';
import { TOUCH } from './touch.js';

export class DayNight {
  constructor(renderer, scene) {
    this.renderer = renderer; this.scene = scene;
    this.sky = new Sky(); this.sky.scale.setScalar(9500); scene.add(this.sky);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 5; u.rayleigh.value = 1.4; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
    // Reflection/IBL environment: a gradient sky with a bounded sun glow. The physical Sky's sun disc
    // is so bright that as an environment map it floods every shadow, so it is only used for display.
    this.envScene = new THREE.Scene();
    this.envMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { zen: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, gnd: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color() } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 zen, hor, gnd, sunDir, sunCol; varying vec3 vDir;
        void main(){ vec3 d = normalize(vDir); float y = d.y;
          vec3 c = y > 0.0 ? mix(hor, zen, pow(clamp(y,0.0,1.0), 0.55)) : mix(hor * 0.6, gnd, clamp(-y * 4.0, 0.0, 1.0));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          c += sunCol * (pow(s, 600.0) * 9.0 + pow(s, 12.0) * 0.35);
          gl_FragColor = vec4(c, 1.0); }`,
    });
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), this.envMat));
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null; this.lastEnvEl = 999; this.envTimer = 0;

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = -95; sc.right = 95; sc.top = 95; sc.bottom = -95; sc.near = 10; sc.far = 900;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd6ff, 0x5b5348, 0.8); scene.add(this.hemi);
    scene.fog = new THREE.Fog(0xb8c8d8, 450, 5200);
    // stars
    const n = 2500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2, y = Math.random() * 0.95 + 0.05, r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(th) * r * 4400; pos[i * 3 + 1] = y * 4400; pos[i * 3 + 2] = Math.sin(th) * r * 4400;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    scene.add(this.stars);
    const moonC = document.createElement('canvas'); moonC.width = moonC.height = 128;
    const mx = moonC.getContext('2d'); const g = mx.createRadialGradient(64, 64, 10, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,245,1)'); g.addColorStop(0.42, 'rgba(240,240,230,1)'); g.addColorStop(0.5, 'rgba(200,210,255,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    mx.fillStyle = g; mx.fillRect(0, 0, 128, 128);
    const mt = new THREE.CanvasTexture(moonC); mt.colorSpace = THREE.SRGBColorSpace;
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: mt, fog: false, transparent: true, depthWrite: false }));
    this.moon.scale.setScalar(230); scene.add(this.moon);
    this.sunDir = new THREE.Vector3();
    this.night = 0;
    this.hours = 15.73;
  }

  update(dt, hours, focus, camera) {
    this.hours = hours;
    const el = 62 * Math.sin(((hours - 6) / 12) * Math.PI) * (Math.PI / 180);
    const az = ((hours - 6) / 12) * Math.PI;
    this.sunDir.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).normalize();
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    const elD = el * 180 / Math.PI;
    const night = this.night = smooth((4 - elD) / 10);
    const dusk = clamp(1 - Math.abs(elD - 3) / 14, 0, 1);
    u.rayleigh.value = 1.2 + dusk * 1.6;
    u.turbidity.value = 4 + dusk * 5;
    const eu = this.envMat.uniforms;
    const mixC = (day, dk, nt) => new THREE.Color(...day).lerp(new THREE.Color(...dk), dusk * 0.8).lerp(new THREE.Color(...nt), night);
    eu.zen.value.copy(mixC([0.22, 0.42, 0.85], [0.2, 0.24, 0.42], [0.006, 0.01, 0.022]));
    eu.hor.value.copy(mixC([0.78, 0.84, 0.92], [1.0, 0.56, 0.32], [0.025, 0.03, 0.05]));
    eu.gnd.value.copy(mixC([0.2, 0.19, 0.17], [0.16, 0.12, 0.1], [0.008, 0.008, 0.01]));
    eu.sunDir.value.copy(night > 0.5 ? new THREE.Vector3(-this.sunDir.x, Math.max(0.35, -this.sunDir.y), -this.sunDir.z) : this.sunDir);
    eu.sunCol.value.setRGB(1, 0.9 - dusk * 0.3, 0.8 - dusk * 0.4).multiplyScalar(night > 0.5 ? 0.04 : Math.max(0, 1 - night * 2));
    this.sky.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    this.stars.material.opacity = night * 0.9;
    // light source: sun by day, moon by night
    const moonDir = new THREE.Vector3(-this.sunDir.x, Math.max(0.35, -this.sunDir.y), -this.sunDir.z).normalize();
    const ld = night > 0.5 ? moonDir : this.sunDir;
    const snap = 2;
    const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
    const fy = focus.y || 0;
    this.sun.target.position.set(fx, fy, fz);
    this.sun.position.set(fx + ld.x * 400, fy + ld.y * 400, fz + ld.z * 400);
    const sunI = clamp(Math.sin(el) * 4, 0, 1) * 3.2;
    const warm = new THREE.Color().setHSL(0.08, 0.8, 0.55 + clamp(elD / 30, 0, 1) * 0.42);
    if (night > 0.5) { this.sun.color.setRGB(0.62, 0.7, 1.0); this.sun.intensity = 0.18 * (night - 0.5) * 2; }
    else { this.sun.color.copy(warm); this.sun.intensity = sunI * (1 - night * 2); }
    this.hemi.intensity = lerp(0.35, 0.05, night);
    this.hemi.color.setRGB(lerp(0.75, 0.2, night), lerp(0.84, 0.25, night), lerp(1.0, 0.45, night));
    this.hemi.groundColor.setRGB(lerp(0.36, 0.05, night), lerp(0.33, 0.05, night), lerp(0.29, 0.07, night));
    const fogDay = new THREE.Color(0xb9c9d9), fogDusk = new THREE.Color(0xd9a88a), fogNight = new THREE.Color(0x0b0f18);
    const fc = fogDay.clone().lerp(fogDusk, dusk * 0.7).lerp(fogNight, night);
    this.scene.fog.color.copy(fc);
    this.renderer.toneMappingExposure = lerp(0.62, 1.05, night);
    this.moon.position.copy(camera.position).addScaledVector(moonDir, 4300);
    this.moon.material.opacity = night;
    // regenerate reflections when the sun moves enough
    this.envTimer -= dt;
    // (phones: less often, each one is a stutter there)
    if (this.envTimer <= 0 && Math.abs(elD - this.lastEnvEl) > (TOUCH ? 2.5 : 0.6)) {
      this.envTimer = TOUCH ? 8 : 1.5; this.lastEnvEl = elD;
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 1000);
      if (this.envRT) this.envRT.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
    }
    return night;
  }
}
