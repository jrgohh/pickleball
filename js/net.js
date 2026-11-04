// Transport between TV (host) and phones (controllers).
// Production: PeerJS / WebRTC data channels (peer-to-peer, signalling via the public PeerJS server).
// Local test (?local=1): BroadcastChannel between tabs of the same browser.

import { CONFIG } from './config.js';

const Peer = window.Peer;

export function isLocal() {
  return new URLSearchParams(location.search).get('local') === '1';
}

// ---------- Host ----------

export function createHost(code, handlers) {
  return isLocal() ? localHost(code, handlers) : peerHost(code, handlers);
}

function peerHost(code, { onOpen, onError, onConnect, onMessage, onDisconnect }) {
  const peer = new Peer(CONFIG.peerPrefix + code, { debug: 1 });
  const conns = new Map();

  peer.on('open', () => onOpen && onOpen());
  peer.on('error', (err) => onError && onError(err));
  peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
  peer.on('connection', (conn) => {
    conn.on('open', () => {
      conns.set(conn.peer, conn);
      onConnect && onConnect(conn.peer);
    });
    conn.on('data', (msg) => onMessage && onMessage(conn.peer, msg));
    conn.on('close', () => {
      conns.delete(conn.peer);
      onDisconnect && onDisconnect(conn.peer);
    });
    conn.on('error', () => {});
  });

  return {
    send(id, msg) {
      const c = conns.get(id);
      if (c && c.open) c.send(msg);
    },
    destroy() { peer.destroy(); },
  };
}

function localHost(code, { onOpen, onConnect, onMessage, onDisconnect }) {
  const ch = new BroadcastChannel(CONFIG.peerPrefix + code);
  const known = new Set();
  ch.onmessage = (e) => {
    const { from, to, msg } = e.data || {};
    if (to !== 'host' || !from) return;
    if (msg && msg.t === 'bye') {
      known.delete(from);
      onDisconnect && onDisconnect(from);
      return;
    }
    if (!known.has(from)) {
      known.add(from);
      onConnect && onConnect(from);
    }
    onMessage && onMessage(from, msg);
  };
  setTimeout(() => onOpen && onOpen(), 0);
  return {
    send(id, msg) { ch.postMessage({ from: 'host', to: id, msg }); },
    destroy() { ch.close(); },
  };
}

// ---------- Controller ----------

export function createClient(code, handlers) {
  return isLocal() ? localClient(code, handlers) : peerClient(code, handlers);
}

function peerClient(code, { onStatus, onMessage }) {
  let peer = null;
  let conn = null;
  let closed = false;
  let retry = 0;

  function start() {
    onStatus('connecting');
    peer = new Peer({ debug: 1 });
    peer.on('open', connect);
    peer.on('error', (err) => {
      if (err && err.type === 'peer-unavailable') onStatus('no-room');
      else onStatus('error');
      scheduleRetry();
    });
  }

  function connect() {
    conn = peer.connect(CONFIG.peerPrefix + code, { serialization: 'json', reliable: true });
    conn.on('open', () => { retry = 0; onStatus('connected'); });
    conn.on('data', (msg) => onMessage(msg));
    conn.on('close', () => { onStatus('disconnected'); scheduleRetry(); });
  }

  function scheduleRetry() {
    if (closed) return;
    retry = Math.min(retry + 1, 5);
    setTimeout(() => {
      if (closed) return;
      if (conn && conn.open) return;
      try { peer && peer.destroy(); } catch (e) { /* ignore */ }
      start();
    }, 800 * retry);
  }

  start();

  return {
    send(msg) { if (conn && conn.open) conn.send(msg); },
    close() { closed = true; try { peer && peer.destroy(); } catch (e) { /* ignore */ } },
  };
}

function localClient(code, { onStatus, onMessage }) {
  const id = 'local-' + Math.random().toString(36).slice(2, 8);
  const ch = new BroadcastChannel(CONFIG.peerPrefix + code);
  ch.onmessage = (e) => {
    const { from, to, msg } = e.data || {};
    if (from === 'host' && to === id) onMessage(msg);
  };
  setTimeout(() => onStatus('connected'), 50);
  window.addEventListener('pagehide', () => ch.postMessage({ from: id, to: 'host', msg: { t: 'bye' } }));
  return {
    send(msg) { ch.postMessage({ from: id, to: 'host', msg }); },
    close() { ch.postMessage({ from: id, to: 'host', msg: { t: 'bye' } }); ch.close(); },
  };
}
