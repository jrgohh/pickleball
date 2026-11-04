// Phone controller: join, motion swing detection, modifiers, feedback.

import { CONFIG } from './config.js';
import { createClient, isLocal } from './net.js';

const $ = (s) => document.querySelector(s);
const CC = CONFIG.controller;
const params = new URLSearchParams(location.search);

// ---------- Join screen ----------

$('#room').value = (params.get('room') || localStorage.getItem('pkl-room') || '').toUpperCase();
$('#name').value = localStorage.getItem('pkl-name') || '';
let sensitivity = localStorage.getItem('pkl-sens') || 'medium';
const sensSeg = $('#sens');
function paintSens() { sensSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === sensitivity)); }
paintSens();
sensSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  e.preventDefault();
  sensitivity = b.dataset.v;
  localStorage.setItem('pkl-sens', sensitivity);
  paintSens();
});

// Stable id so a phone that drops out gets its slot back. Local test tabs each get their own.
const idStore = isLocal() ? sessionStorage : localStorage;
let cid = idStore.getItem('pkl-cid');
if (!cid) { cid = Math.random().toString(36).slice(2, 10); idStore.setItem('pkl-cid', cid); }

let client = null;
let motionOK = false;

$('#join-btn').addEventListener('click', async () => {
  const room = $('#room').value.trim().toUpperCase();
  const name = $('#name').value.trim();
  if (room.length !== 4) { $('#join-err').textContent = 'Enter the 4-character room code shown on the TV.'; return; }
  if (!name) { $('#join-err').textContent = 'Enter your name.'; $('#name').focus(); return; }
  localStorage.setItem('pkl-room', room);
  localStorage.setItem('pkl-name', name);

  // iOS needs permission from a tap, and only over HTTPS
  motionOK = await enableMotion();
  $('#motion-note').hidden = motionOK;
  requestWakeLock();

  $('#join').hidden = true;
  $('#pad').hidden = false;
  $('#me').textContent = name;
  connect(room, name);
});

async function enableMotion() {
  if (typeof DeviceMotionEvent === 'undefined') return false;
  if (!window.isSecureContext) return false;
  try {
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      const r = await DeviceMotionEvent.requestPermission();
      if (r !== 'granted') return false;
    }
  } catch (e) {
    return false;
  }
  window.addEventListener('devicemotion', onMotion);
  // confirm sensors actually report
  return new Promise((res) => {
    let got = false;
    const probe = (e) => { if (e.rotationRate && e.rotationRate.alpha !== null) got = true; };
    window.addEventListener('devicemotion', probe);
    setTimeout(() => { window.removeEventListener('devicemotion', probe); res(got); }, 600);
  });
}

let wakeLock = null;
async function requestWakeLock() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* not fatal */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && client) requestWakeLock(); });

// ---------- Connection ----------

function connect(room, name) {
  client = createClient(room, {
    onStatus(s) {
      const el = $('#conn');
      const text = { connecting: 'Connecting', connected: 'Connected', disconnected: 'Reconnecting', 'no-room': 'Room not found', error: 'Retrying' }[s] || s;
      el.querySelector('.conn-text').textContent = text;
      el.className = 'conn ' + (s === 'connected' ? 'ok' : s === 'connecting' ? '' : 'bad');
      if (s === 'connected') client.send({ t: 'hello', name, cid });
      if (s === 'no-room') setStatus('Room not found', 'Check the code on the TV');
    },
    onMessage,
  });
}

let mode = 'lobby';
function onMessage(msg) {
  if (!msg) return;
  if (msg.t === 'welcome') {
    $('#chip').textContent = 'P' + msg.slot;
    document.documentElement.style.setProperty('--me', msg.color);
  } else if (msg.t === 'full') {
    setStatus('Game is full', 'Two players are already connected');
  } else if (msg.t === 'state') {
    mode = msg.mode;
    setStatus(msg.text, msg.sub || '');
    $('#zone').classList.toggle('serve', msg.mode === 'serve');
    $('#zone').classList.remove('cue');
    setAction(msg);
    if (msg.mode === 'serve') buzz(15);
  } else if (msg.t === 'cue') {
    $('#zone').classList.add('cue');
    setStatus('Your ball', '');
  } else if (msg.t === 'hit') {
    $('#zone').classList.remove('cue');
    const q = msg.q || 0;
    setStatus(q > 0.85 ? 'Perfect' : q > 0.5 ? 'Good' : 'Off timing', '');
    buzz(q > 0.85 ? 45 : 25);
    flash();
  }
}

function setStatus(text, sub) {
  $('#status').textContent = text;
  $('#sub').textContent = sub;
}

function setAction(msg) {
  const a = $('#action'), b = $('#action2');
  a.hidden = true; b.hidden = true;
  if (msg.mode === 'lobby' && msg.canStart) { a.textContent = 'Start game'; a.dataset.t = 'start'; a.hidden = false; }
  if (msg.mode === 'over' && msg.canRematch) {
    a.textContent = 'Rematch'; a.dataset.t = 'rematch'; a.hidden = false;
    b.textContent = 'Back to lobby'; b.dataset.t = 'lobby'; b.hidden = false;
  }
}
for (const id of ['#action', '#action2']) {
  $(id).addEventListener('pointerdown', (e) => e.stopPropagation());
  $(id).addEventListener('click', (e) => { e.stopPropagation(); client && client.send({ t: e.currentTarget.dataset.t }); });
}

// ---------- Swing detection ----------

let measuring = false, peak = 0, startT = 0, lastSwing = -10;

function onMotion(e) {
  const r = e.rotationRate;
  if (!r) return;
  const mag = Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0); // deg/s
  const now = performance.now() / 1000;
  const thr = CC.thresholds[sensitivity] || CC.thresholds.medium;
  if (measuring) {
    if (mag > peak) peak = mag;
    if (now - startT >= CC.window) {
      measuring = false;
      const power = Math.max(0, Math.min(1, (peak - thr) / (CC.maxRate - thr)));
      fireSwing(0.2 + power * 0.8, now - startT);
    }
    return;
  }
  if (now - lastSwing < CC.cooldown) return;
  if (mag > thr) { measuring = true; peak = mag; startT = now; }
}

function fireSwing(power, lag) {
  lastSwing = performance.now() / 1000;
  let p = power;
  if (held.dink) p = 0.08 + p * 0.18;
  const lob = held.lob;
  client && client.send({ t: 'swing', p, lob, lag });
  $('#meter-fill').style.width = Math.round(p * 100) + '%';
  $('#meter-label').textContent = (lob ? 'Lob' : p < 0.3 ? 'Soft' : p < 0.7 ? 'Medium' : 'Hard') + ' swing';
  flash();
}

// Tap fallback (no sensors, or desktop testing)
$('#zone').addEventListener('pointerdown', (e) => {
  if (motionOK) return;
  e.preventDefault();
  if (performance.now() / 1000 - lastSwing < 0.2) return;
  fireSwing(0.6, 0);
});

// Hold modifiers
const held = { dink: false, lob: false };
for (const k of ['dink', 'lob']) {
  const el = $('#' + k);
  const on = (e) => { e.preventDefault(); held[k] = true; el.classList.add('held'); };
  const off = (e) => { e.preventDefault(); held[k] = false; el.classList.remove('held'); };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('pointerleave', off);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ---------- Feedback ----------

function buzz(ms) { if (navigator.vibrate) navigator.vibrate(ms); }
let flashT = 0;
function flash() {
  const z = $('#zone');
  z.classList.add('flash');
  clearTimeout(flashT);
  flashT = setTimeout(() => z.classList.remove('flash'), 140);
}
