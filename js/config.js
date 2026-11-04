// All tunable values live here. Units: metres, seconds, m/s.

export const CONFIG = {
  // Global simulation speed. 1 = real-time physics. Lower = easier to time swings.
  gameSpeed: 0.85,

  court: {
    width: 6.10,        // 20 ft
    length: 13.41,      // 44 ft
    kitchen: 2.13,      // non-volley zone depth from net (7 ft)
    netCenter: 0.86,    // 34 in
    netPost: 0.91,      // 36 in
  },

  physics: {
    gravity: 9.81,
    ballRadius: 0.037,
    restitution: 0.62,  // vertical bounce
    friction: 0.82,     // horizontal speed kept on bounce
  },

  rules: {
    pointsToWin: 11,
    winBy: 2,
    scoring: 'sideout', // 'sideout' (traditional) or 'rally'
  },

  // Swing timing window, relative to the moment the ball reaches the contact point.
  timing: {
    early: 0.40,        // swing up to this many seconds early still connects
    late: 0.12,         // ...or this late
    ideal: -0.06,       // perfect timing sits slightly early (feels right with display lag)
    latency: 0.04,      // assumed phone-to-PC network delay, subtracted from swing time
    errorStart: 0.72,   // aim beyond this (0..1) starts adding miss error
  },

  shots: {
    clearance: 0.14,    // target height above net tape
    aimRange: 2.5,      // max lateral steer from timing (m)
    dink:  { depth: [0.6, 1.6], time: [1.15, 0.95] },
    drive: { depth: [3.6, 6.0], time: [1.05, 0.62] },
    lob:   { depth: [5.4, 6.2], time: [2.0, 1.8] },
    serve: { depth: [3.8, 5.9], time: [1.30, 0.95] },
    softPower: 0.30,    // swings below this power become dinks / drops
  },

  movement: {
    humanSpeed: 5.2,    // auto-move speed for phone-controlled players
    reaction: 0.10,
    reach: 0.55,        // how close a player must get to their hitting spot
    paddleOffset: 0.50, // ball sits this far to the side of the body at contact
  },

  cpu: {
    easy:   { speed: 3.6, skill: 0.55, serveDelay: 1.6 },
    normal: { speed: 4.4, skill: 0.80, serveDelay: 1.3 },
    hard:   { speed: 5.2, skill: 0.90, serveDelay: 1.0 },
  },

  // Phone swing detection (rotation rate in deg/s).
  controller: {
    thresholds: { low: 420, medium: 320, high: 230 }, // sensitivity -> trigger level
    maxRate: 1500,      // rotation rate that counts as full power
    window: 0.07,       // seconds after trigger to measure peak
    cooldown: 0.40,
  },

  pointPause: 2.2,      // seconds between rallies
  peerPrefix: 'rdpickle-',
};
