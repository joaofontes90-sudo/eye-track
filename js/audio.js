/**
 * Feedback de áudio usando Web Audio API e Web Speech Synthesis.
 */
class SoundManager {
  constructor() {
    this.ctx = null;
    this.speechSynthesis = window.speechSynthesis;
  }

  _initAudio() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playBeep(frequency = 600, duration = 0.1, type = 'sine') {
    try {
      this._initAudio();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {
      console.warn("Audio playback error:", e);
    }
  }

  playCalibrationChime(step = 1) {
    const freqs = [523.25, 659.25, 783.99, 987.77, 1046.50]; // Dó, Mi, Sol, Si, Dó agudo
    const freq = freqs[(step - 1) % freqs.length];
    this.playBeep(freq, 0.18, 'triangle');
  }

  playSuccessJingle() {
    [523.25, 659.25, 783.99, 1046.50].forEach((f, i) => {
      setTimeout(() => this.playBeep(f, 0.2, 'sine'), i * 110);
    });
  }

  speak(text) {
    if (!this.speechSynthesis) return;
    this.speechSynthesis.cancel(); // cancela falas pendentes
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    this.speechSynthesis.speak(utterance);
  }
}

export const sounds = new SoundManager();
