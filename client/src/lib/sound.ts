// Sound engine with a distinct audio identity per game.
//
// - Aviator keeps its original Spribe royalty sprite (it is the flagship and the
//   sprite belongs to it).
// - Every other game synthesizes its own sounds with the Web Audio API so it no
//   longer reuses Aviator audio. Each game has a unique chip / win / loss voice.
//
// Synthesis is fully self-contained (no extra audio files required).

const MUSIC_VOLUME = 0.1;

class SoundEngine {
  private audio: HTMLAudioElement | null = null;
  private isMuted: boolean = false;
  private ctx: AudioContext | null = null;

  // ---- Background music (the real Spribe track) ----
  // Music is a separate, looping <audio> element with its own volume and its
  // own on/off switch. It is never routed through the one-shot sprite player.
  private music: HTMLAudioElement | null = null;
  private musicEnabled: boolean = true;
  private musicStarted: boolean = false;
  private gestureBound: boolean = false;

  constructor() {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('casino_muted');
      this.isMuted = saved === 'true';
      const savedMusic = localStorage.getItem('casino_music');
      this.musicEnabled = savedMusic !== 'false';
      try {
        this.audio = new Audio('/spribe/sprite_audio.mp3');
        this.audio.preload = 'auto';
      } catch (e) {}
      // Browsers block autoplay until a gesture; startMusic() falls back to
      // waiting for the first tap/keypress.
      this.startMusic();
    }
  }

  // ============================================================
  // Background music
  // ============================================================

  private ensureMusic(): HTMLAudioElement | null {
    if (typeof window === 'undefined') return null;
    if (!this.music) {
      try {
        const el = new Audio('/spribe/bg_music.mp3');
        el.loop = true;
        el.volume = MUSIC_VOLUME;
        el.preload = 'auto';
        this.music = el;
      } catch (e) {
        return null;
      }
    }
    return this.music;
  }

  private bindFirstGesture() {
    if (this.gestureBound || typeof window === 'undefined') return;
    this.gestureBound = true;
    const handler = () => {
      window.removeEventListener('pointerdown', handler);
      window.removeEventListener('keydown', handler);
      window.removeEventListener('touchstart', handler);
      this.gestureBound = false;
      this.startMusic();
    };
    window.addEventListener('pointerdown', handler);
    window.addEventListener('keydown', handler);
    window.addEventListener('touchstart', handler);
  }

  public startMusic() {
    if (!this.musicEnabled) return;
    if (this.musicStarted) return;
    const el = this.ensureMusic();
    if (!el) return;
    const attempt = el.play();
    if (attempt && typeof attempt.then === 'function') {
      attempt
        .then(() => {
          this.musicStarted = true;
        })
        .catch(() => {
          this.bindFirstGesture();
        });
    } else {
      this.musicStarted = true;
    }
  }

  public stopMusic() {
    try {
      this.music?.pause();
    } catch (e) {}
  }

  public toggleMusic(): boolean {
    this.musicEnabled = !this.musicEnabled;
    if (typeof window !== 'undefined') {
      localStorage.setItem('casino_music', String(this.musicEnabled));
    }
    if (this.musicEnabled) {
      this.musicStarted = false;
      this.startMusic();
    } else {
      this.stopMusic();
    }
    return this.musicEnabled;
  }

  public getMusicEnabled(): boolean {
    return this.musicEnabled;
  }

  // Lazily create a shared AudioContext (must follow a user gesture).
  private getCtx(): AudioContext | null {
    if (this.isMuted) return null;
    if (typeof window === 'undefined') return null;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    } catch (e) {
      return null;
    }
  }

  // ---- Generic Web Audio helpers ----

  private tone(
    freq: number,
    startDelay: number,
    duration: number,
    opts: {
      type?: OscillatorType;
      volume?: number;
      slideTo?: number;
      attack?: number;
      decayExp?: number;
    } = {}
  ) {
    const ctx = this.getCtx();
    if (!ctx) return;
    try {
      const t0 = ctx.currentTime + startDelay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const vol = opts.volume ?? 0.2;
      const attack = opts.attack ?? 0.005;
      const end = t0 + duration;

      osc.type = opts.type ?? 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (opts.slideTo) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), end);
      }

      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);

      // Optional exponential decay shaping for percussive sounds
      if (opts.decayExp) {
        gain.gain.setValueAtTime(vol, t0 + attack);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration * opts.decayExp);
      }

      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(end + 0.02);
    } catch (e) {}
  }

  private noiseBurst(duration: number, startDelay: number, volume = 0.15, lowpass = 600) {
    const ctx = this.getCtx();
    if (!ctx) return;
    try {
      const t0 = ctx.currentTime + startDelay;
      const bufferSize = Math.floor(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = lowpass;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(volume, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      src.connect(filt).connect(gain).connect(ctx.destination);
      src.start(t0);
    } catch (e) {}
  }

  private playSprite(startSeconds: number, durationSeconds: number) {
    if (this.isMuted) return;
    if (typeof window === 'undefined') return;
    try {
      if (!this.audio) {
        this.audio = new Audio('/spribe/sprite_audio.mp3');
      }
      const soundInstance = new Audio('/spribe/sprite_audio.mp3');
      soundInstance.currentTime = startSeconds;
      soundInstance.volume = 0.3;
      soundInstance.play().then(() => {
        setTimeout(() => {
          try {
            soundInstance.pause();
          } catch (e) {}
        }, durationSeconds * 1000);
      }).catch(() => {});
    } catch (err) {}
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (typeof window !== 'undefined') {
      localStorage.setItem('casino_muted', String(this.isMuted));
    }
    if (this.isMuted) {
      this.stopMusic();
    } else if (this.musicEnabled) {
      this.musicStarted = false;
      this.startMusic();
    }
    return this.isMuted;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  // ============================================================
  // AVIATOR  (original Spribe sprite — unchanged)
  // ============================================================
  public playBet() {
    this.playSprite(0, 0.52);
  }
  public playCrash() {
    this.playSprite(2.0, 2.57);
  }
  public playTakeoff() {
    this.playSprite(6.0, 1.51);
  }
  public playCashout() {
    this.playSprite(9.0, 4.02);
  }
  public playWin() {
    this.playSprite(9.0, 4.02);
  }
  public playChip() {
    this.playSprite(0, 0.25);
  }

  // ============================================================
  // ROULETTE  — wooden wheel, bright bell chips
  // ============================================================
  public rouletteChip() {
    // short wood-tick like a chip dropped on felt
    this.noiseBurst(0.05, 0, 0.12, 900);
    this.tone(880, 0, 0.06, { type: 'triangle', volume: 0.1 });
  }
  public rouletteWin() {
    // bright two-note bell ringer
    this.tone(1046.5, 0, 0.35, { type: 'sine', volume: 0.22 });
    this.tone(1568, 0.12, 0.5, { type: 'sine', volume: 0.25 });
    this.tone(2093, 0.24, 0.6, { type: 'sine', volume: 0.2 });
  }
  public rouletteLoss() {
    // soft low thud, gentle let-down
    this.tone(220, 0, 0.4, { type: 'sine', volume: 0.18, slideTo: 140 });
  }

  // ============================================================
  // BLACKJACK — card dealing ticks, fanfare win
  // ============================================================
  public blackjackChip() {
    // quick two-stroke card swish
    this.noiseBurst(0.04, 0, 0.1, 1600);
    this.tone(1320, 0.03, 0.05, { type: 'square', volume: 0.05 });
  }
  public blackjackWin() {
    // short fanfare: rising major arpeggio
    this.tone(523.25, 0, 0.18, { type: 'triangle', volume: 0.2 });
    this.tone(659.25, 0.12, 0.18, { type: 'triangle', volume: 0.2 });
    this.tone(783.99, 0.24, 0.32, { type: 'triangle', volume: 0.22 });
  }
  public blackjackLoss() {
    // low descending minor phrase
    this.tone(392, 0, 0.2, { type: 'sine', volume: 0.18 });
    this.tone(311.13, 0.14, 0.35, { type: 'sine', volume: 0.18, slideTo: 220 });
  }

  // ============================================================
  // SLOTS    — reel stops, coin-ding jackpot
  // ============================================================
  public slotsChip() {
    // mechanical reel click
    this.tone(220, 0, 0.08, { type: 'square', volume: 0.08 });
    this.noiseBurst(0.04, 0, 0.08, 700);
  }
  public slotsWin() {
    // cascading coin dings
    this.tone(880, 0, 0.15, { type: 'sine', volume: 0.2 });
    this.tone(987.77, 0.12, 0.15, { type: 'sine', volume: 0.2 });
    this.tone(1318.5, 0.24, 0.2, { type: 'sine', volume: 0.22 });
    this.tone(1760, 0.36, 0.4, { type: 'sine', volume: 0.24 });
  }
  public slotsLoss() {
    // dull drop with a wobble
    this.tone(300, 0, 0.35, { type: 'sawtooth', volume: 0.1, slideTo: 150 });
  }

  // ============================================================
  // MINES    — crystal blips, sparkle win, explosion loss
  // ============================================================
  public minesChip() {
    // crystal tap
    this.tone(1568, 0, 0.09, { type: 'sine', volume: 0.12 });
  }
  public minesGem() {
    // bright rising sparkle for revealing a safe gem
    this.tone(1046.5, 0, 0.12, { type: 'sine', volume: 0.16 });
    this.tone(1568, 0.07, 0.14, { type: 'sine', volume: 0.18 });
  }
  public minesCashout() {
    // cash-out chime (gem cluster)
    this.tone(1046.5, 0, 0.14, { type: 'sine', volume: 0.18 });
    this.tone(1396.9, 0.1, 0.16, { type: 'sine', volume: 0.2 });
    this.tone(2093, 0.2, 0.4, { type: 'sine', volume: 0.22 });
  }
  public minesWin() {
    this.minesCashout();
  }
  public minesLoss() {
    // low explosion rumble (NOT the Aviator crash)
    this.noiseBurst(0.7, 0, 0.3, 320);
    this.tone(90, 0, 0.6, { type: 'sine', volume: 0.3, slideTo: 45 });
  }

  // ============================================================
  // DICE     — cube rattles, tumbling win
  // ============================================================
  public diceChip() {
    // rattle tick
    this.noiseBurst(0.05, 0, 0.1, 1200);
    this.tone(620, 0, 0.06, { type: 'triangle', volume: 0.09 });
  }
  public diceWin() {
    // dice tumble then a decisive success chime
    this.noiseBurst(0.18, 0, 0.12, 1800);
    this.tone(659.25, 0.1, 0.16, { type: 'triangle', volume: 0.18 });
    this.tone(880, 0.22, 0.35, { type: 'triangle', volume: 0.22 });
  }
  public diceLoss() {
    // flat low buzz
    this.tone(196, 0, 0.3, { type: 'sawtooth', volume: 0.12, slideTo: 160 });
  }
}

export const sound = new SoundEngine();
