// TV / host page: lobby, connections, game loop, HUD.

import { Game } from './game.js';
import { Renderer, PLAYER_COLORS } from './render.js';
import { createHost, isLocal } from './net.js';
import { Sound } from './sound.js';
import qrcode from '../vendor/qrcode.mjs';

const $ = (s) => document.querySelector(s);

const sound = new Sound();
const renderer = new Renderer($('#view'));
let screen = 'lobby';
let mode = '1vcpu';
let difficulty = 'normal';

// slot: { conn: id | 'kbd', cid, name, connected }
const slots = { 1: null, 2: null };
const connSlot = new Map();

const game = new Game(onGameEvent);

// ---------- Room ----------

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() { let s = ''; for (let i = 0; i < 4; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)]; return s; }

let code = sessionStorage.getItem('pkl-room') || newCode();
let host = null;

function openRoom() {
  sessionStorage.setItem('pkl-room', code);
  $('#room-code').textContent = code;
  const url = new URL('controller.html', location.href);
  url.search = '';
  url.searchParams.set('room', code);
  if (isLocal()) url.searchParams.set('local', '1');
  const href = url.toString();
  $('#join-url').textContent = href.replace(/^https?:\/\//, '');
  const qr = qrcode(0, 'M');
  qr.addData(href);
  qr.make();
  $('#qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  window.__joinUrl = href;

  host = createHost(code, {
    onOpen() { setNet(isLocal() ? 'Local test mode (same browser only)' : 'Ready. Phones can join.', 'ok'); },
    onError(err) {
      if (err && err.type === 'unavailable-id') {
        host.destroy(); code = newCode(); openRoom();
      } else {
        setNet('Connection problem: ' + (err && err.type ? err.type : 'unknown') + '. Retrying.', 'err');
      }
    },
    onConnect() {},
    onMessage: onNetMessage,
    onDisconnect(id) {
      const s = connSlot.get(id);
      connSlot.delete(id);
      if (!s || !slots[s] || slots[s].conn !== id) return;
      if (screen === 'lobby') slots[s] = null;
      else slots[s].connected = false;
      renderSlots();
    },
  });
}

function setNet(text, cls) {
  const el = $('#net-status');
  el.textContent = text;
  el.className = 'net-status ' + (cls || '');
}

// ---------- Messages ----------

function send(slot, msg) {
  const s = slots[slot];
  if (s && s.conn !== 'kbd' && s.connected) host.send(s.conn, msg);
}

function onNetMessage(id, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'hello') {
    const name = String(msg.name || '').slice(0, 14).trim();
    let slot = [1, 2].find((n) => slots[n] && slots[n].cid === msg.cid);
    if (!slot) slot = [1, 2].find((n) => !slots[n]);
    if (!slot) { host.send(id, { t: 'full' }); return; }
    slots[slot] = { conn: id, cid: msg.cid, name: name || 'Player ' + slot, connected: true };
    connSlot.set(id, slot);
    host.send(id, { t: 'welcome', slot, color: PLAYER_COLORS[slot], name: slots[slot].name });
    renderSlots();
    pushState(slot);
    return;
  }
  const slot = connSlot.get(id);
  if (!slot) return;
  if (msg.t === 'swing') {
    sound.unlock();
    if (screen === 'game') game.swing(slot, clamp01(+msg.p || 0), !!msg.lob, Math.min(0.2, Math.max(0, +msg.lag || 0)));
  } else if (msg.t === 'start' && slot === 1 && screen === 'lobby') {
    startGame();
  } else if (msg.t === 'rematch' && slot === 1 && screen === 'over') {
    startGame();
  } else if (msg.t === 'lobby' && slot === 1 && screen === 'over') {
    toLobby();
  }
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

const needed = () => (mode === '1vcpu' ? 1 : 2);
const ready = () => [1, 2].slice(0, needed()).every((n) => slots[n]);

// What each phone should show right now
function pushState(slot) {
  const s = slots[slot];
  if (!s) return;
  let st;
  if (screen === 'lobby') {
    const inGame = slot <= needed();
    st = {
      t: 'state', mode: 'lobby',
      text: inGame ? 'You are in. Waiting for the game to start.' : 'Mode is ' + modeLabel() + '. You will watch this one.',
      canStart: slot === 1 && ready(),
    };
  } else if (screen === 'over') {
    const p = game.playerBySlot(slot);
    const won = p && p.team === game.winner;
    st = { t: 'state', mode: 'over', text: p ? (won ? 'You win' : 'Game over') : 'Game over', sub: game.score.join(' - '), canRematch: slot === 1 };
  } else {
    const p = game.playerBySlot(slot);
    if (!p) st = { t: 'state', mode: 'watch', text: 'Watching' };
    else if (game.phase === 'serve' && game.serverId === p.id) st = { t: 'state', mode: 'serve', text: 'Your serve', sub: game.scoreCall() };
    else st = { t: 'state', mode: 'play', text: 'Rally', sub: game.scoreCall() };
  }
  send(slot, st);
}
const pushAll = () => { pushState(1); pushState(2); };

// ---------- Game events ----------

function onGameEvent(type, d) {
  if (screen !== 'game') {
    if (type === 'bounce') renderer.addRipple(d.x, d.z);
    return;
  }
  switch (type) {
    case 'serveReady':
      pushAll();
      updateHud();
      break;
    case 'hit':
      sound.hit(d.quality);
      if (d.slot) send(d.slot, { t: 'hit', q: d.quality });
      if (d.serve) pushAll();
      break;
    case 'cue':
      send(d.slot, { t: 'cue' });
      break;
    case 'bounce':
      sound.bounce();
      renderer.addRipple(d.x, d.z);
      break;
    case 'net':
      sound.net();
      break;
    case 'point': {
      sound.point();
      const who = game.teamNames[d.winTeam];
      const reason = { Out: 'Out', Net: 'Into the net', 'Service fault': 'Service fault', Winner: 'Winner', Fault: 'Fault' }[d.reason] || d.reason;
      showBanner(reason, d.note === 'Point' ? 'Point ' + who : d.note);
      updateHud();
      break;
    }
    case 'gameover':
      showOver();
      break;
  }
}

let bannerTimer = 0;
function showBanner(text, sub) {
  const b = $('#banner');
  b.innerHTML = '';
  b.append(text);
  if (sub) { const s = document.createElement('small'); s.textContent = sub; b.append(s); }
  b.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.remove('show'), 1900);
}

function updateHud() {
  for (const t of [0, 1]) {
    const row = document.querySelector(`.scorebug .row[data-team="${t}"]`);
    row.querySelector('.tname').textContent = game.teamNames[t];
    row.querySelector('.tscore').textContent = game.score[t];
    row.classList.toggle('serving', game.serving === t);
  }
  $('#call').textContent = 'Score call ' + game.scoreCall();
}

// ---------- Screens ----------

function modeLabel() { return { '1v1': '1 v 1', '1vcpu': '1 v CPU', '2vcpu': '2 v 2 CPU' }[mode]; }

function renderSlots() {
  for (const n of [1, 2]) {
    const li = document.querySelector(`#slots li[data-slot="${n}"]`);
    const s = slots[n];
    li.classList.toggle('on', !!s && s.connected);
    li.classList.toggle('away', !!s && !s.connected);
    li.querySelector('.slot-name').textContent = s ? s.name : 'Player ' + n;
    li.querySelector('.slot-state').textContent = !s ? 'Waiting' : s.conn === 'kbd' ? 'Keyboard' : s.connected ? 'Connected' : 'Reconnecting';
    li.style.opacity = n > needed() ? 0.45 : 1;
  }
  const ok = ready();
  $('#start-btn').disabled = !ok;
  const missing = [1, 2].slice(0, needed()).filter((n) => !slots[n]).length;
  $('#start-hint').textContent = ok ? 'Press Enter or tap Start on Player 1’s phone' : `Waiting for ${missing} player${missing > 1 ? 's' : ''}`;
  $('#cpu-block').style.display = mode === '1v1' ? 'none' : '';
  if (screen === 'lobby') pushAll();
}

function startGame() {
  if (!ready()) return;
  sound.unlock();
  screen = 'game';
  const names = { 1: slots[1] && slots[1].name, 2: slots[2] && slots[2].name };
  game.setup(mode, difficulty, names);
  renderer.setPlayers(game.players, true);
  $('#lobby').hidden = true;
  $('#over').hidden = true;
  $('#hud').hidden = false;
  $('#keys').hidden = ![1, 2].some((n) => slots[n] && slots[n].conn === 'kbd');
  updateHud();
  pushAll();
}

function showOver() {
  screen = 'over';
  const w = game.winner;
  $('#over-title').textContent = game.teamNames[w] + ' win' + (game.doubles || /\//.test(game.teamNames[w]) ? '' : 's');
  $('#over-score').textContent = game.score[0] + ' - ' + game.score[1];
  $('#over').hidden = false;
  pushAll();
}

function toLobby() {
  screen = 'lobby';
  $('#over').hidden = true;
  $('#hud').hidden = true;
  $('#lobby').hidden = false;
  for (const n of [1, 2]) if (slots[n] && !slots[n].connected && slots[n].conn !== 'kbd') slots[n] = null;
  startDemo();
  renderSlots();
}

function startDemo() {
  game.setup('demo', 'normal');
  renderer.setPlayers(game.players, false);
}

// ---------- Controls on the TV page ----------

function seg(id, onPick) {
  const el = $(id);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    onPick(b.dataset.v);
  });
}
seg('#mode-seg', (v) => { mode = v; renderSlots(); });
seg('#diff-seg', (v) => { difficulty = v; });
$('#start-btn').addEventListener('click', startGame);
$('#rematch-btn').addEventListener('click', startGame);
$('#lobby-btn').addEventListener('click', toLobby);
$('#kbd-btn').addEventListener('click', () => {
  const n = [1, 2].find((k) => !slots[k]);
  if (!n) return;
  slots[n] = { conn: 'kbd', cid: 'kbd' + n, name: 'Keys ' + n, connected: true };
  renderSlots();
});

const KEYS = {
  KeyA: [1, 0.15, false], KeyS: [1, 0.65, false], KeyD: [1, 0.6, true],
  KeyJ: [2, 0.15, false], KeyK: [2, 0.65, false], KeyL: [2, 0.6, true],
};
window.addEventListener('keydown', (e) => {
  sound.unlock();
  if (e.repeat) return;
  if (e.code === 'Enter') {
    if (screen === 'lobby') startGame();
    else if (screen === 'over') startGame();
    return;
  }
  if (e.code === 'Escape' && screen === 'over') { toLobby(); return; }
  const k = KEYS[e.code];
  if (k && screen === 'game' && slots[k[0]] && slots[k[0]].conn === 'kbd') game.swing(k[0], k[1], k[2], 0);
});
window.addEventListener('pointerdown', () => sound.unlock());

// ---------- Loop ----------

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.update(dt);
  if (screen === 'lobby' && game.phase === 'gameover') startDemo();
  renderer.draw(game, dt);
  requestAnimationFrame(frame);
}

openRoom();
startDemo();
renderSlots();
requestAnimationFrame(frame);

// for automated checks
window.__pkl = { game, slots, startGame, get screen() { return screen; } };
