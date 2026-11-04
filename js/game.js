// Pickleball simulation: physics, rules, scoring, auto-movement, CPU.
// No rendering here. Coordinates: x across court, y up, z along court.
// Team 0 plays the near half (z > 0), team 1 the far half (z < 0).

import { CONFIG as C } from './config.js';

const HW = C.court.width / 2;
const HL = C.court.length / 2;
const K = C.court.kitchen;
const G = C.physics.gravity;
const R = C.physics.ballRadius;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
function gauss() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const sideSign = (team) => (team === 0 ? 1 : -1);  // z sign of team's half
export const rightX = (team) => (team === 0 ? 1 : -1);    // x sign of team's right side
export const netHeight = (x) => C.court.netCenter + (C.court.netPost - C.court.netCenter) * Math.min(1, (x / HW) ** 2);

// One physics step. Mutates b {pos, vel}. Returns 'net' | 'bounce' | null.
function physicsStep(b, dt) {
  const px = b.pos.x, py = b.pos.y, pz = b.pos.z;
  b.vel.y -= G * dt;
  b.pos.x += b.vel.x * dt;
  b.pos.y += b.vel.y * dt;
  b.pos.z += b.vel.z * dt;
  let ev = null;

  if (pz !== 0 && Math.sign(pz) !== Math.sign(b.pos.z)) {
    const f = pz / (pz - b.pos.z);
    const xN = px + (b.pos.x - px) * f;
    const yN = py + (b.pos.y - py) * f;
    if (Math.abs(xN) <= HW + 0.3 && yN < netHeight(xN) + R) {
      b.pos.z = Math.sign(pz) * 0.05;
      b.vel.z *= -0.12;
      b.vel.x *= 0.3;
      b.vel.y = Math.min(b.vel.y, 0) * 0.3;
      ev = 'net';
    }
  }

  if (b.pos.y < R && b.vel.y < 0) {
    b.pos.y = R;
    b.vel.y = -b.vel.y * C.physics.restitution;
    b.vel.x *= C.physics.friction;
    b.vel.z *= C.physics.friction;
    if (b.vel.y < 0.35) b.vel.y = 0;
    if (!ev) ev = 'bounce';
  }
  return ev;
}

// Velocity that lands the ball at target after T seconds, raising the arc until it clears the net.
function solveLaunch(from, target, T, clearance) {
  let t = T;
  for (let i = 0; i < 40; i++) {
    const vx = (target.x - from.x) / t;
    const vz = (target.z - from.z) / t;
    const vy = (target.y - from.y + 0.5 * G * t * t) / t;
    const tn = vz !== 0 ? -from.z / vz : -1;
    if (tn <= 0 || tn >= t) return { x: vx, y: vy, z: vz };
    const xN = from.x + vx * tn;
    const yN = from.y + vy * tn - 0.5 * G * tn * tn;
    if (yN >= netHeight(xN) + clearance) return { x: vx, y: vy, z: vz };
    t += 0.04;
  }
  const vx = (target.x - from.x) / t, vz = (target.z - from.z) / t;
  return { x: vx, y: (target.y - from.y + 0.5 * G * t * t) / t, z: vz };
}

export class Game {
  constructor(emit) {
    this.emit = emit || (() => {});
    this.players = [];
    this.ball = { pos: { x: 0, y: 1, z: 0 }, vel: { x: 0, y: 0, z: 0 } };
    this.phase = 'idle';
    this.time = 0;
  }

  // mode: '1v1' | '1vcpu' | '2vcpu' | 'demo'. names: {1: 'Gavin', 2: '...'}
  setup(mode, difficulty, names = {}) {
    this.mode = mode;
    this.cpu = C.cpu[difficulty] || C.cpu.normal;
    this.doubles = mode === '2vcpu' || mode === 'demo';
    const mk = (id, team, slot, name, court) => ({
      id, team, slot, name, court,
      pos: { x: 0, z: sideSign(team) * (HL + 0.3) }, vel: { x: 0, z: 0 },
      swingAt: -10, swingSide: 'fh', facing: team === 0 ? 0 : Math.PI,
    });
    const n1 = names[1] || 'Player 1', n2 = names[2] || 'Player 2';
    if (mode === '1v1') {
      this.players = [mk(0, 0, 1, n1, 'R'), mk(1, 1, 2, n2, 'R')];
    } else if (mode === '1vcpu') {
      this.players = [mk(0, 0, 1, n1, 'R'), mk(1, 1, null, 'CPU', 'R')];
    } else if (mode === '2vcpu') {
      this.players = [mk(0, 0, 1, n1, 'R'), mk(1, 0, 2, n2, 'L'), mk(2, 1, null, 'CPU 1', 'R'), mk(3, 1, null, 'CPU 2', 'L')];
    } else {
      this.players = [mk(0, 0, null, 'CPU A1', 'R'), mk(1, 0, null, 'CPU A2', 'L'), mk(2, 1, null, 'CPU B1', 'R'), mk(3, 1, null, 'CPU B2', 'L')];
    }
    this.teamNames = this.doubles
      ? [this.players[0].name + ' / ' + this.players[1].name, this.players[2].name + ' / ' + this.players[3].name]
      : [this.players[0].name, this.players[1].name];

    this.score = [0, 0];
    this.serving = 0;
    this.serverNum = this.doubles ? 2 : 1; // doubles starts at 0-0-2
    this.serverId = this.teamPlayer(0, 'R').id;
    this.winner = null;
    this.time = 0;
    this.startServe();
  }

  teamPlayers(team) { return this.players.filter((p) => p.team === team); }
  teamPlayer(team, court) {
    const ps = this.teamPlayers(team);
    return ps.find((p) => p.court === court) || ps[0];
  }
  playerBySlot(slot) { return this.players.find((p) => p.slot === slot); }
  speedOf(p) { return p.slot ? C.movement.humanSpeed : this.cpu.speed; }

  // ---------- Serve ----------

  startServe() {
    this.phase = 'serve';
    this.plan = null;
    this.pending = {};
    this.serveClock = 0;
    const server = this.players[this.serverId];
    const team = server.team, recv = 1 - team;
    const court = this.doubles ? server.court : (this.score[team] % 2 === 0 ? 'R' : 'L');
    if (!this.doubles) { server.court = court; this.teamPlayers(recv)[0].court = court; }
    this.serveCourt = court;
    const cs = court === 'R' ? 1 : -1;
    this.serveTargetSign = rightX(recv) * cs;
    this.receiverId = this.teamPlayer(recv, court).id;

    this.rally = { hits: 0, lastHit: team, bounces: 0, isServe: true, netMode: [false, false], teamHits: [0, 0] };

    // Positions
    for (const p of this.players) {
      const s = sideSign(p.team);
      const laneX = rightX(p.team) * (p.court === 'R' ? 1 : -1) * 1.5;
      p.home = { x: laneX, z: s * (HL + 0.35) };
      if (p.id === server.id) p.home = { x: rightX(team) * cs * 0.9, z: s * (HL + 0.45) };
      else if (p.id === this.receiverId) p.home = { x: rightX(recv) * cs * 1.3, z: s * (HL + 0.2) };
      else if (p.team === recv) p.home = { x: laneX, z: s * (K + 0.45) };
    }
    this.emit('serveReady', { slot: server.slot, serverId: server.id, call: this.scoreCall() });
  }

  serve(power) {
    const server = this.players[this.serverId];
    const recv = 1 - server.team;
    const sc = C.shots.serve;
    let err = 0.18 + Math.max(0, power - 0.85) * 3;
    const depth = lerp(sc.depth[0], sc.depth[1], power) + gauss() * err * 0.6;
    const x = this.serveTargetSign * (1.45 + gauss() * err);
    const target = { x, y: R, z: sideSign(recv) * depth };
    const from = { ...this.ballHoldPos(server) };
    this.ball.pos = from;
    this.ball.vel = solveLaunch(from, target, lerp(sc.time[0], sc.time[1], power), C.shots.clearance + 0.1);
    server.swingAt = this.time;
    server.swingSide = 'fh';
    this.rally.hits = 1;
    this.rally.teamHits[server.team] = 1;
    this.rally.lastHit = server.team;
    this.rally.bounces = 0;
    this.rally.isServe = true;
    this.phase = 'rally';
    this.emit('hit', { playerId: server.id, slot: server.slot, quality: 1, serve: true });
    this.plan = this.makePlan(recv);
  }

  ballHoldPos(p) {
    const rx = rightX(p.team);
    return { x: p.pos.x + rx * 0.45, y: 0.55, z: p.pos.z - sideSign(p.team) * 0.25 };
  }

  // ---------- Input ----------

  // Called when a phone (or keyboard) swings. lag = seconds of delay already known on the phone side.
  swing(slot, power, lob = false, lag = 0) {
    const p = this.playerBySlot(slot);
    if (!p) return;
    p.swingAt = this.time;
    const ts = this.time - (C.timing.latency + lag) * C.gameSpeed;

    if (this.phase === 'serve') {
      if (this.serverId === p.id && this.serveClock > 0.35) this.serve(power);
      return;
    }
    if (this.phase !== 'rally' || !this.plan || this.plan.playerId !== p.id) return;
    const plan = this.plan;
    p.swingSide = plan.side;
    const off = ts - plan.t;
    if (off < -C.timing.early) return; // whiff, too early
    if (off <= 0) { this.pending[slot] = { off, power, lob }; return; }
    if (off <= C.timing.late) this.executeHit(p, off, power, lob);
  }

  // ---------- Planning / movement ----------

  simulate(maxT = 4) {
    const b = { pos: { ...this.ball.pos }, vel: { ...this.ball.vel } };
    const dt = 1 / 120;
    const samples = [];
    let bounces = 0, firstBounce = null, net = false;
    for (let t = dt, i = 0; t <= maxT; t += dt, i++) {
      const ev = physicsStep(b, dt);
      if (ev === 'net') { net = true; break; }
      if (ev === 'bounce') {
        bounces++;
        if (bounces === 1) firstBounce = { x: b.pos.x, z: b.pos.z, t };
        if (bounces >= 2) break;
      }
      if (i % 2 === 0) samples.push({ t, x: b.pos.x, y: b.pos.y, z: b.pos.z, bounces });
    }
    return { samples, firstBounce, net };
  }

  bounceIsIn(x, z, team, isServe) {
    if (Math.sign(z) !== sideSign(team)) return false;
    if (Math.abs(x) > HW + R || Math.abs(z) > HL + R) return false;
    if (isServe) {
      if (Math.abs(z) <= K) return false;
      if (x * this.serveTargetSign < -R) return false;
    }
    return true;
  }

  makePlan(team) {
    const sim = this.simulate();
    if (sim.net || !sim.firstBounce) return null;
    if (!this.bounceIsIn(sim.firstBounce.x, sim.firstBounce.z, team, this.rally.isServe)) {
      return null; // looks out: let it go
    }
    const mustBounce = this.rally.hits <= 2;
    const s = sideSign(team);
    const rx = rightX(team);
    const off = C.movement.paddleOffset;
    let best = null;

    for (const p of this.teamPlayers(team)) {
      const speed = this.speedOf(p);
      for (const smp of sim.samples) {
        if (Math.sign(smp.z) !== s) continue;
        const az = Math.abs(smp.z);
        let ok = false;
        if (smp.bounces === 0) {
          ok = !mustBounce && smp.y >= 0.3 && smp.y <= 1.5 && az >= K + 0.1 && az <= HL + 1.5;
        } else if (smp.bounces === 1) {
          ok = smp.y >= 0.15 && smp.y <= 1.3 && az <= HL + 3 && smp.t >= sim.firstBounce.t + 0.06;
        }
        if (!ok) continue;
        for (const side of ['fh', 'bh']) {
          const sx = smp.x - rx * off * (side === 'fh' ? 1 : -1);
          const sz = smp.z + s * 0.25;
          const travel = Math.hypot(sx - p.pos.x, sz - p.pos.z);
          const avail = smp.t - C.movement.reaction;
          const slack = speed * avail - travel;
          const cost = travel + Math.abs(smp.y - 0.8) * 0.6 + (side === 'bh' ? 0.15 : 0);
          const reachable = slack >= 0;
          if (!best || (reachable && !best.reachable) || (reachable === best.reachable && (reachable ? cost < best.cost : slack > best.slack))) {
            best = {
              playerId: p.id, t: this.time + smp.t, pos: { x: smp.x, y: smp.y, z: smp.z },
              stand: { x: sx, z: sz }, side, reachable, cost, slack, volley: smp.bounces === 0,
            };
          }
        }
      }
    }
    if (best) {
      const p = this.players[best.playerId];
      if (p.slot) this.emit('cue', { slot: p.slot });
    }
    return best;
  }

  homeFor(p) {
    const s = sideSign(p.team);
    const net = this.rally.netMode[p.team];
    const z = s * (net ? K + 0.45 : HL + 0.35);
    if (!this.doubles) return { x: clamp(this.ball.pos.x * 0.45, -2, 2), z };
    const laneX = rightX(p.team) * (p.court === 'R' ? 1 : -1) * 1.45;
    return { x: laneX + clamp(this.ball.pos.x * 0.25, -0.8, 0.8), z };
  }

  movePlayers(dt) {
    for (const p of this.players) {
      let target;
      if (this.phase === 'rally' && this.plan && this.plan.playerId === p.id) target = this.plan.stand;
      else if (this.phase === 'serve') target = p.home;
      else if (this.phase === 'rally') target = this.homeFor(p);
      else target = null;

      let vx = 0, vz = 0;
      if (target) {
        const dx = target.x - p.pos.x, dz = target.z - p.pos.z;
        const d = Math.hypot(dx, dz);
        const max = this.speedOf(p) * (this.phase === 'serve' ? 1.4 : 1);
        if (d > 0.01) {
          const sp = Math.min(max, d * 8);
          vx = (dx / d) * sp; vz = (dz / d) * sp;
        }
      }
      // light smoothing
      p.vel.x += (vx - p.vel.x) * Math.min(1, dt * 14);
      p.vel.z += (vz - p.vel.z) * Math.min(1, dt * 14);
      p.pos.x += p.vel.x * dt;
      p.pos.z += p.vel.z * dt;
      // never cross into the other half
      const s = sideSign(p.team);
      if (p.pos.z * s < 0.3) p.pos.z = s * 0.3;
    }
  }

  // ---------- Hitting ----------

  executeHit(p, off, power, lob) {
    const plan = this.plan;
    const dist = Math.hypot(p.pos.x - plan.stand.x, p.pos.z - plan.stand.z);
    if (dist > C.movement.reach + 0.25) return false; // not there in time

    const t = C.timing;
    const d = off - t.ideal;
    const aim = clamp(d < 0 ? d / (t.early + t.ideal) : d / (t.late - t.ideal), -1, 1);
    this.applyShot(p, aim, power, lob, 0);
    return true;
  }

  applyShot(p, aim, power, lob, extraErr, fault = null) {
    const team = p.team, opp = 1 - team;
    const from = { x: this.ball.pos.x, y: Math.max(this.ball.pos.y, 0.12), z: this.ball.pos.z };
    const sh = C.shots;
    const t = C.timing;

    let depth, T, clearance = sh.clearance;
    if (lob) {
      depth = lerp(sh.lob.depth[0], sh.lob.depth[1], power);
      T = lerp(sh.lob.time[0], sh.lob.time[1], power);
      clearance = 1.2;
    } else if (power < sh.softPower) {
      const k = power / sh.softPower;
      depth = lerp(sh.dink.depth[0], sh.dink.depth[1], k);
      T = lerp(sh.dink.time[0], sh.dink.time[1], k);
      // a soft swing from deep court becomes a longer drop shot
      const distToNet = Math.abs(from.z);
      if (distToNet > K + 1.5) T += (distToNet - K) * 0.09;
      clearance = 0.08;
    } else {
      const k = (power - sh.softPower) / (1 - sh.softPower);
      depth = lerp(sh.drive.depth[0], sh.drive.depth[1], k);
      T = lerp(sh.drive.time[0], sh.drive.time[1], k);
    }

    // Lateral aim from timing: early = pull, late = push (mirrored on backhand)
    const side = this.plan ? this.plan.side : 'fh';
    const rLocal = (side === 'fh' ? aim : -aim) * sh.aimRange;
    let x = from.x * 0.3 + rightX(team) * rLocal;

    const over = Math.max(0, Math.abs(aim) - t.errorStart) / (1 - t.errorStart);
    const err = 0.12 + over * 1.3 + extraErr + Math.max(0, power - 0.9) * 2.5;
    x += gauss() * err;
    depth += gauss() * err * 0.8;
    clearance -= over * 0.35 + extraErr * 0.25;
    if (fault === 'long') depth = HL + rand(0.4, 1.4);
    else if (fault === 'wide') x = Math.sign(x || 1) * (HW + rand(0.3, 1.0));
    x = clamp(x, -HW - 2, HW + 2);

    this.ball.pos = from;
    if (fault === 'net') {
      const dz = Math.abs(from.z);
      const tNet = T * Math.min(0.9, dz / (dz + depth));
      const tgt = { x: from.x + (x - from.x) * 0.5, y: netHeight(0) * rand(0.35, 0.8), z: sideSign(opp) * 0.06 };
      this.ball.vel = solveLaunch(from, tgt, tNet, -10);
    } else {
      const target = { x, y: R, z: sideSign(opp) * Math.max(0.3, depth) };
      this.ball.vel = solveLaunch(from, target, T, clearance);
    }

    p.swingAt = this.time;
    p.swingSide = side;
    const r = this.rally;
    r.hits++;
    r.teamHits[team]++;
    r.lastHit = team;
    r.bounces = 0;
    r.isServe = false;
    if (team === this.serving ? r.teamHits[team] >= 2 : r.teamHits[team] >= 1) r.netMode[team] = !lob || r.netMode[team];
    this.pending = {};
    const quality = 1 - Math.abs(aim);
    this.emit('hit', { playerId: p.id, slot: p.slot, quality, lob, soft: power < sh.softPower });
    this.plan = this.makePlan(opp);
  }

  cpuHit(p) {
    const team = p.team;
    const skill = this.cpu.skill;
    const atNet = this.rally.netMode[team];
    const oppAtNet = this.rally.netMode[1 - team];
    const y = this.ball.pos.y;
    let power, lob = false;
    if (atNet && y > 1.05 && Math.random() < 0.6) power = rand(0.82, 0.95); // put-away
    else if (atNet && y < 0.75 && Math.random() < 0.75) power = rand(0.08, 0.25);
    else if (!atNet && oppAtNet && Math.random() < 0.45) power = rand(0.12, 0.28);
    else power = rand(0.45, 0.85);
    if (oppAtNet && !atNet && Math.random() < 0.08) lob = true;

    // Unforced and forced errors: worse skill, faster incoming ball and volleys all add risk
    const vin = Math.hypot(this.ball.vel.x, this.ball.vel.z);
    const mistake = (1 - skill) * 0.45 + (this.plan.volley ? 0.06 : 0) + clamp((vin - 8) / 10, 0, 1) * 0.2 * (1.2 - skill);
    const extra = (1 - skill) * 0.35;
    let fault = null;
    if (Math.random() < mistake) { const r = Math.random(); fault = r < 0.4 ? 'net' : r < 0.75 ? 'long' : 'wide'; }

    // aim away from the nearest opponent
    const opps = this.teamPlayers(1 - team);
    const avgX = opps.reduce((a, o) => a + o.pos.x, 0) / opps.length;
    const want = -Math.sign(avgX || (Math.random() - 0.5)) * rand(0.2, 0.65);
    const side = this.plan.side;
    let aim = (side === 'fh' ? 1 : -1) * want * rightX(team);
    aim = clamp(aim + gauss() * (1 - skill) * 0.45, -1, 1);
    this.applyShot(p, aim, power, lob, extra, fault);
  }

  // ---------- Loop ----------

  update(dtReal) {
    const dt = dtReal * C.gameSpeed;
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.tick(h);
  }

  tick(dt) {
    this.time += dt;
    if (this.phase === 'idle' || this.phase === 'gameover') return;

    if (this.phase === 'serve') {
      this.serveClock += dt;
      this.movePlayers(dt);
      const server = this.players[this.serverId];
      const hold = this.ballHoldPos(server);
      const bob = Math.abs(Math.sin(this.serveClock * 3.2)) * 0.35;
      this.ball.pos = { x: hold.x, y: hold.y + bob, z: hold.z };
      this.ball.vel = { x: 0, y: 0, z: 0 };
      if (!server.slot && this.serveClock > this.cpu.serveDelay) this.serve(rand(0.35, 0.75));
      return;
    }

    // ball
    const ev = physicsStep(this.ball, dt);
    if (this.phase === 'rally') {
      if (ev === 'net') this.endRally(1 - this.rally.lastHit, 'Net');
      else if (ev === 'bounce') this.onBounce();
    }
    if (ev === 'bounce') this.emit('bounce', { x: this.ball.pos.x, z: this.ball.pos.z });
    if (ev === 'net') this.emit('net', {});

    if (this.phase === 'rally') {
      this.movePlayers(dt);
      const plan = this.plan;
      if (plan && this.time >= plan.t) {
        const p = this.players[plan.playerId];
        if (!p.slot) {
          if (plan.reachable && Math.hypot(p.pos.x - plan.stand.x, p.pos.z - plan.stand.z) < C.movement.reach + 0.25) this.cpuHit(p);
          else this.plan = null;
        } else {
          const pend = this.pending[p.slot];
          if (pend) {
            delete this.pending[p.slot];
            if (!this.executeHit(p, pend.off, pend.power, pend.lob)) this.plan = null;
          } else if (this.time > plan.t + C.timing.late) {
            this.plan = null; // missed
          }
        }
      }
      // ball flew far away without anyone touching it: settle as a bounce out
      if (this.phase === 'rally' && (Math.abs(this.ball.pos.z) > HL + 12 || Math.abs(this.ball.pos.x) > HW + 12)) {
        this.endRally(1 - this.rally.lastHit, 'Out');
      }
    } else if (this.phase === 'pointover') {
      this.pointClock += dt / C.gameSpeed;
      for (const p of this.players) { p.vel.x *= 0.9; p.vel.z *= 0.9; p.pos.x += p.vel.x * dt; p.pos.z += p.vel.z * dt; }
      if (this.pointClock > C.pointPause) {
        if (this.winner !== null) { this.phase = 'gameover'; this.emit('gameover', { winner: this.winner, score: [...this.score] }); }
        else this.startServe();
      }
    }
  }

  onBounce() {
    const r = this.rally;
    const { x, z } = this.ball.pos;
    const sideTeam = z > 0 ? 0 : 1;
    if (sideTeam === r.lastHit) { this.endRally(1 - r.lastHit, 'Fault'); return; }
    if (r.bounces === 0) {
      if (!this.bounceIsIn(x, z, sideTeam, r.isServe)) {
        this.endRally(sideTeam, r.isServe ? 'Service fault' : 'Out');
        return;
      }
      r.bounces = 1;
    } else {
      this.endRally(r.lastHit, 'Winner');
    }
  }

  endRally(winTeam, reason) {
    this.phase = 'pointover';
    this.pointClock = 0;
    this.plan = null;
    this.pending = {};
    let note = '';

    if (C.rules.scoring === 'rally') {
      this.score[winTeam]++;
      if (winTeam === this.serving) { this.swapCourts(winTeam); note = 'Point'; }
      else { this.serving = winTeam; this.serverNum = 1; this.serverId = this.teamPlayer(winTeam, 'R').id; note = 'Side out'; }
    } else if (winTeam === this.serving) {
      this.score[winTeam]++;
      this.swapCourts(winTeam);
      note = 'Point';
    } else if (this.doubles && this.serverNum === 1) {
      this.serverNum = 2;
      const partner = this.teamPlayers(this.serving).find((p) => p.id !== this.serverId);
      this.serverId = partner.id;
      note = 'Second server';
    } else {
      this.serving = 1 - this.serving;
      this.serverNum = 1;
      this.serverId = this.teamPlayer(this.serving, 'R').id;
      note = 'Side out';
    }

    const w = winTeam, l = 1 - winTeam;
    if (this.score[w] >= C.rules.pointsToWin && this.score[w] - this.score[l] >= C.rules.winBy) this.winner = w;
    this.emit('point', { winTeam, reason, note, call: this.scoreCall(), score: [...this.score], gameOver: this.winner !== null });
  }

  swapCourts(team) {
    if (!this.doubles) return;
    for (const p of this.teamPlayers(team)) p.court = p.court === 'R' ? 'L' : 'R';
  }

  scoreCall() {
    const s = this.serving;
    const base = `${this.score[s]}-${this.score[1 - s]}`;
    return this.doubles && C.rules.scoring === 'sideout' ? `${base}-${this.serverNum}` : base;
  }
}
