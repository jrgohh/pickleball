// Three.js view of the game. Reads Game state each frame; owns no game logic.

import * as THREE from '../vendor/three.module.js';
import { CONFIG as C } from './config.js';
import { netHeight } from './game.js';

const HW = C.court.width / 2;
const HL = C.court.length / 2;
const K = C.court.kitchen;

const COLORS = {
  bg: 0x0b1620,
  apron: 0x1f3d36,
  court: 0x2a5b82,
  kitchen: 0x2f6792,
  line: 0xf3f5f2,
  ball: 0xe4f24c,
};

export const PLAYER_COLORS = { 1: '#f0a43a', 2: '#ee6b5b', cpu: ['#4cc3d1', '#7f9fe6'] };

export class Renderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.bg);
    this.scene.fog = new THREE.Fog(COLORS.bg, 22, 48);

    this.camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);
    this.camBase = new THREE.Vector3(0, 7.4, 14.2);
    this.camera.position.copy(this.camBase);
    this.lookAt = new THREE.Vector3(0, 0, -0.9);
    this.camera.lookAt(this.lookAt);

    this.buildLights();
    this.buildCourt();
    this.buildNet();
    this.buildBall();
    this.buildCue();
    this.playerMeshes = [];
    this.ripples = [];
    this.trail = [];

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // keep the whole court in view on narrower screens
    this.camera.fov = w / h < 1.5 ? 50 : 42;
    this.camera.updateProjectionMatrix();
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xdfeeff, 0x1a2a22, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(-6, 14, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -10; sc.right = 10; sc.top = 12; sc.bottom = -12; sc.near = 1; sc.far = 40;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
  }

  plane(w, d, color, y = 0) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color, roughness: 0.92 }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.receiveShadow = true;
    this.scene.add(m);
    return m;
  }

  buildCourt() {
    this.plane(60, 60, 0x0f1e1a, -0.01);
    this.plane(C.court.width + 6, C.court.length + 9, COLORS.apron, 0);
    this.plane(C.court.width, C.court.length, COLORS.court, 0.001);
    const kz = this.plane(C.court.width, K * 2, COLORS.kitchen, 0.002);
    kz.position.z = 0;

    const lw = 0.05;
    const lineMat = new THREE.MeshBasicMaterial({ color: COLORS.line });
    const line = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.004, z);
      this.scene.add(m);
    };
    line(C.court.width + lw, lw, 0, HL);
    line(C.court.width + lw, lw, 0, -HL);
    line(lw, C.court.length, HW, 0);
    line(lw, C.court.length, -HW, 0);
    line(C.court.width, lw, 0, K);
    line(C.court.width, lw, 0, -K);
    line(lw, HL - K, 0, (HL + K) / 2);
    line(lw, HL - K, 0, -(HL + K) / 2);
  }

  buildNet() {
    const W = C.court.width + 0.6;
    // net mesh texture
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 64;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, 256, 64);
    g.strokeStyle = 'rgba(20,24,28,0.85)';
    g.lineWidth = 1;
    for (let x = 0; x <= 256; x += 6) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 64); g.stroke(); }
    for (let y = 0; y <= 64; y += 6) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(8, 1);

    // shape the net so it sags in the middle like the real one
    const geo = new THREE.PlaneGeometry(W, 1, 24, 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const top = netHeight(Math.min(Math.abs(x), HW) * Math.sign(x));
      pos.setY(i, y > 0 ? top : 0.02);
    }
    geo.computeVertexNormals();
    const net = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, roughness: 1 }));
    net.castShadow = true;
    this.scene.add(net);

    // tape along the top
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const x = -W / 2 + (W * i) / 24;
      pts.push(new THREE.Vector3(x, netHeight(Math.min(Math.abs(x), HW) * Math.sign(x)), 0));
    }
    const tape = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.025, 6, false),
      new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.6 }),
    );
    this.scene.add(tape);

    const postMat = new THREE.MeshStandardMaterial({ color: 0x2b2f33, metalness: 0.4, roughness: 0.5 });
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, C.court.netPost + 0.05, 12), postMat);
      post.position.set(s * W / 2, (C.court.netPost + 0.05) / 2, 0);
      post.castShadow = true;
      this.scene.add(post);
    }
  }

  buildBall() {
    const vis = 0.07; // drawn larger than real (0.037) so it reads on a TV
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(vis, 20, 14),
      new THREE.MeshStandardMaterial({ color: COLORS.ball, roughness: 0.55, emissive: 0x3a4410, emissiveIntensity: 0.6 }),
    );
    this.ball.castShadow = true;
    this.scene.add(this.ball);

    // blob shadow straight below for depth reading
    this.ballShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.09, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.ballShadow);

    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 3), 3));
    this.trailLine = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: COLORS.ball, transparent: true, opacity: 0.35 }));
    this.scene.add(this.trailLine);
  }

  buildCue() {
    this.cue = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.4, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    this.cue.rotation.x = -Math.PI / 2;
    this.cue.position.y = 0.01;
    this.cue.visible = false;
    this.scene.add(this.cue);
  }

  makeLabel(text, color) {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 64;
    const g = cv.getContext('2d');
    g.font = '600 30px "Inter", "Segoe UI", system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(8,14,20,0.72)';
    const w = Math.min(250, g.measureText(text).width + 28);
    g.beginPath();
    g.roundRect((256 - w) / 2, 10, w, 44, 6);
    g.fill();
    g.fillStyle = color;
    g.fillRect((256 - w) / 2, 10, 4, 44);
    g.fillStyle = '#f2f4f5';
    g.fillText(text, 128, 33);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.scale.set(1.6, 0.4, 1);
    sp.position.y = 2.15;
    sp.renderOrder = 10;
    return sp;
  }

  setPlayers(players, showLabels = true) {
    for (const m of this.playerMeshes) this.scene.remove(m.group);
    this.playerMeshes = [];
    let cpuIdx = 0;
    for (const p of players) {
      const color = p.slot ? PLAYER_COLORS[p.slot] : PLAYER_COLORS.cpu[cpuIdx++ % 2];
      p.color = color;
      this.playerMeshes.push(this.makePlayer(p, color, showLabels));
    }
  }

  makePlayer(p, color, showLabels) {
    const group = new THREE.Group();
    const shirt = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b232b, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xd9a77f, roughness: 0.7 });

    const legs = [];
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.6, 4, 8), dark);
      leg.position.set(s * 0.11, 0.42, 0);
      leg.castShadow = true;
      group.add(leg);
      legs.push(leg);
    }
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.45, 6, 12), shirt);
    torso.position.y = 1.12;
    torso.castShadow = true;
    group.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), skin);
    head.position.y = 1.62;
    head.castShadow = true;
    group.add(head);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.145, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), shirt);
    cap.position.y = 1.64;
    group.add(cap);

    // arm + paddle on the right side (local +x), pivot at shoulder
    const arm = new THREE.Group();
    arm.position.set(0.24, 1.32, 0);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.42, 4, 8), skin);
    upper.rotation.z = Math.PI / 2;
    upper.position.x = 0.24;
    upper.castShadow = true;
    arm.add(upper);
    const paddle = new THREE.Group();
    paddle.position.x = 0.52;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8), dark);
    handle.rotation.z = Math.PI / 2;
    handle.position.x = 0.06;
    paddle.add(handle);
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.02, 0.2), new THREE.MeshStandardMaterial({ color: 0x20262c, roughness: 0.4 }));
    face.position.x = 0.24;
    face.rotation.x = Math.PI / 2;
    face.castShadow = true;
    paddle.add(face);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.025, 0.21), shirt);
    edge.position.x = 0.24;
    edge.rotation.x = Math.PI / 2;
    edge.scale.set(1, 0.6, 1);
    paddle.add(edge);
    arm.add(paddle);
    group.add(arm);

    const label = showLabels ? this.makeLabel(p.name, color) : null;
    if (label) group.add(label);

    this.scene.add(group);
    return { group, arm, legs, torso, label, color: new THREE.Color(color) };
  }

  addRipple(x, z, color = 0xffffff) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.06, 0.1, 28),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.012, z);
    this.scene.add(m);
    this.ripples.push({ m, age: 0 });
  }

  draw(game, dt) {
    const t = game.time;

    // players
    game.players.forEach((p, i) => {
      const pm = this.playerMeshes[i];
      if (!pm) return;
      pm.group.position.set(p.pos.x, 0, p.pos.z);
      pm.group.rotation.y = p.facing;
      const speed = Math.hypot(p.vel.x, p.vel.z);
      const stride = Math.sin(t * 14) * Math.min(1, speed / 3) * 0.5;
      pm.legs[0].rotation.x = stride;
      pm.legs[1].rotation.x = -stride;
      pm.group.position.y = Math.abs(Math.sin(t * 14)) * Math.min(1, speed / 3) * 0.04;

      // swing: arm sweeps from back to front around the vertical axis
      const sp = (t - p.swingAt) / 0.26;
      let yaw, pitch = -0.35;
      if (sp >= 0 && sp < 1) {
        const e = 1 - (1 - sp) ** 3;
        if (p.swingSide === 'bh') yaw = lerp(-2.3, 0.2, e);
        else yaw = lerp(1.3, -1.5, e);
        pitch = lerp(-0.6, 0.15, e);
        pm.torso.rotation.y = yaw * 0.25;
      } else {
        yaw = 0.35;
        pm.torso.rotation.y = 0;
      }
      pm.arm.rotation.set(0, yaw, pitch);
    });

    // ball
    const b = game.ball.pos;
    this.ball.position.set(b.x, b.y, b.z);
    this.ballShadow.position.set(b.x, 0.008, b.z);
    const h = Math.max(0, b.y);
    this.ballShadow.material.opacity = Math.max(0.12, 0.5 - h * 0.12);
    this.ballShadow.scale.setScalar(1 + h * 0.15);

    this.trail.push(b.x, b.y, b.z);
    if (this.trail.length > 36) this.trail.splice(0, 3);
    const arr = this.trailLine.geometry.attributes.position.array;
    for (let i = 0; i < 36; i++) arr[i] = this.trail[i] !== undefined ? this.trail[i] : this.trail[this.trail.length - 3 + (i % 3)];
    this.trailLine.geometry.attributes.position.needsUpdate = true;
    this.trailLine.visible = game.phase === 'rally' || game.phase === 'pointover';

    // cue ring under the phone player who should hit next
    const plan = game.plan;
    if (plan && game.phase === 'rally' && game.players[plan.playerId].slot) {
      const p = game.players[plan.playerId];
      this.cue.visible = true;
      this.cue.position.x = plan.stand.x;
      this.cue.position.z = plan.stand.z;
      this.cue.material.color.set(p.color);
      const pulse = 1 + Math.sin(t * 10) * 0.08;
      this.cue.scale.setScalar(pulse);
    } else if (game.phase === 'serve' && game.players[game.serverId].slot) {
      const p = game.players[game.serverId];
      this.cue.visible = true;
      this.cue.position.x = p.pos.x;
      this.cue.position.z = p.pos.z;
      this.cue.material.color.set(p.color);
      this.cue.scale.setScalar(1 + Math.sin(t * 6) * 0.06);
    } else {
      this.cue.visible = false;
    }

    // ripples
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.age += dt;
      r.m.scale.setScalar(1 + r.age * 9);
      r.m.material.opacity = Math.max(0, 0.8 - r.age * 1.6);
      if (r.age > 0.5) { this.scene.remove(r.m); this.ripples.splice(i, 1); }
    }

    // gentle camera drift following the ball sideways
    const targetX = Math.max(-1.2, Math.min(1.2, b.x * 0.18));
    this.camera.position.x += (targetX - this.camera.position.x) * Math.min(1, dt * 2);
    this.camera.lookAt(this.lookAt.x + this.camera.position.x * 0.5, this.lookAt.y, this.lookAt.z);

    this.renderer.render(this.scene, this.camera);
  }
}

function lerp(a, b, t) { return a + (b - a) * t; }
