// Original Web Audio API Synthesizer for VEKTOR AI

class VektorSoundEngine {
  private ctx: AudioContext | null = null;
  private muted = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.muted = localStorage.getItem('vektor_sound_muted') === 'true';
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(val: boolean): void {
    this.muted = val;
    if (typeof window !== 'undefined') {
      localStorage.setItem('vektor_sound_muted', String(val));
    }
  }

  private getContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private playTone(freq: number, startTimeOffset: number, duration: number, type: OscillatorType, volume: number): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime + startTimeOffset;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  public playTaskStart(): void {
    this.playTone(440, 0, 0.12, 'sine', 0.05);
    this.playTone(554.37, 0.08, 0.16, 'triangle', 0.05);
  }

  public playTaskComplete(): void {
    this.playTone(523.25, 0, 0.14, 'sine', 0.06);
    this.playTone(659.25, 0.09, 0.14, 'sine', 0.06);
    this.playTone(783.99, 0.18, 0.28, 'triangle', 0.06);
  }

  public playError(): void {
    this.playTone(220, 0, 0.18, 'sawtooth', 0.04);
    this.playTone(185, 0.14, 0.24, 'sawtooth', 0.04);
  }

  public playLowCredit(): void {
    this.playTone(587.33, 0, 0.11, 'triangle', 0.05);
    this.playTone(587.33, 0.16, 0.15, 'triangle', 0.05);
  }
}

export const vektorSound = new VektorSoundEngine();
