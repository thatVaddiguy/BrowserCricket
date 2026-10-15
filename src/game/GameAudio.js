/** Optional Web Audio synthesis. No recordings, URLs, or autoplay requests. */
export class GameAudio {
  constructor() { this.context = null; this.enabled = false; }

  enable(enabled) {
    this.enabled = enabled;
    if (!enabled) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!this.context && Audio) this.context = new Audio();
      if (this.context?.state === 'suspended') this.context.resume().catch(() => {});
    } catch { this.context = null; }
  }

  play(type) {
    const context = this.context;
    if (!this.enabled || context?.state !== 'running') return;
    const now = context.currentTime;
    if (type === 'cheer' || type === 'groan') {
      // A crowd is band-passed noise: a swelling roar for boundaries, a short falling sigh for wickets.
      const cheer = type === 'cheer', duration = cheer ? 1.9 : 1.1;
      const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
      source.buffer = buffer;
      filter.type = 'bandpass';
      filter.Q.value = 0.7;
      filter.frequency.setValueAtTime(cheer ? 700 : 520, now);
      filter.frequency.linearRampToValueAtTime(cheer ? 1150 : 260, now + duration);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(cheer ? 0.11 : 0.06, now + (cheer ? 0.35 : 0.12));
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      source.connect(filter); filter.connect(gain); gain.connect(context.destination);
      source.start(now);
      return;
    }
    if (type === 'boundary') {
      for (const [i, frequency] of [440, 554.37, 659.25].entries()) {
        const osc = context.createOscillator(), gain = context.createGain();
        osc.type = 'sine'; osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0, now + i * 0.065);
        gain.gain.linearRampToValueAtTime(0.025, now + i * 0.065 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.065 + 0.35);
        osc.connect(gain); gain.connect(context.destination);
        osc.start(now + i * 0.065); osc.stop(now + i * 0.065 + 0.36);
      }
      return;
    }
    const duration = type === 'wicket' ? 0.22 : 0.09;
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
    const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
    source.buffer = buffer;
    filter.type = 'lowpass';
    filter.frequency.value = type === 'bounce' ? 330 : type === 'wicket' ? 2400 : 1250;
    gain.gain.value = type === 'bounce' ? 0.075 : 0.20;
    source.connect(filter); filter.connect(gain); gain.connect(context.destination);
    source.start();
  }

  dispose() {
    this.context?.close().catch(() => {});
    this.context = null;
  }
}
