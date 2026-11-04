// Small synthesised sound effects (no audio files).

export class Sound {
  constructor() { this.ctx = null; this.enabled = true; }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  tone(freq, endFreq, dur, vol, type = 'sine') {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  click(vol, centre) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.03);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = centre;
    f.Q.value = 2.5;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t);
  }

  hit(quality = 0.7) {
    this.tone(1100 + quality * 300, 420, 0.07, 0.35);
    this.click(0.5, 2400);
  }
  bounce() { this.tone(520, 220, 0.06, 0.18); this.click(0.18, 1400); }
  net() { this.tone(160, 70, 0.18, 0.3, 'triangle'); }
  point() { this.tone(660, 660, 0.12, 0.12, 'triangle'); setTimeout(() => this.tone(880, 880, 0.18, 0.12, 'triangle'), 110); }
}
