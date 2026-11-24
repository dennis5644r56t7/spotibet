// Production audio engine.
// Playback-only, file-based. All assets are self-hosted under /public so the app
// has zero external dependencies and is production-ready.
//
// Assets are expected to exist per-game:
//   /sounds/<game>/bet.mp3          bet / place chip
//   /sounds/<game>/win.mp3          win payout
//   /sounds/<game>/lose.mp3         lose / bust
//   /sounds/<game>/action.mp3       secondary action (spin, deal, reveal, etc.)
//   /music/<game>.mp3               looping background music (best as a ~30-60s seamless loop)
//
// If an asset is missing we simply no-op (an <audio> element with a 404 simply
// fails to play and emits no error to the user). There is no synthetic fallback.

type GameId =
  | 'aviator'
  | 'roulette'
  | 'blackjack'
  | 'slots'
  | 'mines'
  | 'dice';

interface AudioAsset {
  el: HTMLAudioElement | null;
  ready: boolean;
}

class AudioManager {
  private sfxCache = new Map<string, AudioAsset>();
  private music: HTMLAudioElement | null = null;
  private currentMusicGame: GameId | null = null;

  private volume = 0.7;
  private musicVolume = 0.45;
  private muted = false;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        this.muted = localStorage.getItem('casino_muted') === 'true';
        const vol = parseFloat(localStorage.getItem('casino_volume') || '');
        if (!Number.isNaN(vol)) this.volume = Math.min(1, Math.max(0, vol));
      } catch {
        /* ignore storage errors */
      }
    }
  }

  /** Load + cache a one-shot sfx element. */
  private sfx(game: GameId, name: string): HTMLAudioElement | null {
    const key = `${game}/${name}`;
    const hit = this.sfxCache.get(key);
    if (hit) return hit.el;

    const el = new Audio(`/sounds/${game}/${name}.mp3`);
    el.preload = 'auto';
    const asset: AudioAsset = { el, ready: false };
    el.addEventListener('canplaythrough', () => (asset.ready = true), { once: true });
    this.sfxCache.set(key, asset);
    return el;
  }

  /** Play a one-shot sound effect. Missing assets no-op silently. */
  private playSfx(game: GameId, name: string, volumeBoost = 1) {
    if (typeof window === 'undefined' || this.muted) return;
    const el = this.sfx(game, name);
    if (!el) return;
    try {
      el.volume = Math.min(1, this.volume * volumeBoost);
      el.currentTime = 0;
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* ignore */
    }
  }

  /* -------------------------------------------------------------------------- */
  /*  Per-game SFX                                                              */
  /* -------------------------------------------------------------------------- */

  // Aviator (multiplayer crash — the flagship keeps its own set)
  betAviator() { this.playSfx('aviator', 'bet', 1.1); }
  cashoutAviator() { this.playSfx('aviator', 'win', 1.1); }
  crashAviator() { this.playSfx('aviator', 'lose', 1.1); }
  takeoffAviator() { this.playSfx('aviator', 'takeoff', 1); }
  chipAviator() { this.playSfx('aviator', 'chip', 1); }

  // Roulette
  chipRoulette() { this.playSfx('roulette', 'chip'); }
  spinRoulette() { this.playSfx('roulette', 'spin'); }
  winRoulette() { this.playSfx('roulette', 'win', 1.1); }
  loseRoulette() { this.playSfx('roulette', 'lose'); }

  // Blackjack
  chipBlackjack() { this.playSfx('blackjack', 'chip'); }
  dealBlackjack() { this.playSfx('blackjack', 'deal'); }
  hitBlackjack() { this.playSfx('blackjack', 'hit'); }
  winBlackjack() { this.playSfx('blackjack', 'win', 1.1); }
  loseBlackjack() { this.playSfx('blackjack', 'lose'); }

  // Slots
  spinSlots() { this.playSfx('slots', 'spin'); }
  stopSlots() { this.playSfx('slots', 'stop'); }
  winSlots() { this.playSfx('slots', 'win', 1.15); }
  loseSlots() { this.playSfx('slots', 'lose'); }

  // Mines
  chipMines() { this.playSfx('mines', 'chip'); }
  revealMines() { this.playSfx('mines', 'reveal'); }
  cashoutMines() { this.playSfx('mines', 'win', 1.1); }
  explosionMines() { this.playSfx('mines', 'lose', 1.1); }

  // Dice
  chipDice() { this.playSfx('dice', 'chip'); }
  rollDice() { this.playSfx('dice', 'roll'); }
  winDice() { this.playSfx('dice', 'win', 1.1); }
  loseDice() { this.playSfx('dice', 'lose'); }

  /* -------------------------------------------------------------------------- */
  /*  Per-game looping background music                                         */
  /* -------------------------------------------------------------------------- */

  /** Start (or switch to) a game's background music. Pass null/undefined to stop. */
  playMusic(game: GameId | null) {
    if (typeof window === 'undefined') return;
    if (this.music) {
      this.music.pause();
      this.music.currentTime = 0;
      this.music = null;
      this.currentMusicGame = null;
    }
    if (!game || this.muted) return;

    const el = new Audio(`/music/${game}.mp3`);
    el.loop = true;
    el.volume = this.musicVolume;
    el.play().catch(() => {});
    this.music = el;
    this.currentMusicGame = game;
  }

  /** Stop any playing background music. */
  stopMusic() {
    if (this.music) {
      this.music.pause();
      this.music.currentTime = 0;
      this.music = null;
    }
    this.currentMusicGame = null;
  }

  /** Call this when the active tab/game changes so music follows the game. */
  setGame(game: GameId | null) {
    if (game === this.currentMusicGame) return;
    this.playMusic(game);
  }

  /* -------------------------------------------------------------------------- */
  /*  Master controls                                                            */
  /* -------------------------------------------------------------------------- */

  setMuted(m: boolean) {
    this.muted = m;
    try {
      localStorage.setItem('casino_muted', String(m));
    } catch { /* ignore */ }
    if (m) this.stopMusic();
    else this.setGame(this.currentMusicGame);
  }

  isMuted() {
    return this.muted;
  }

  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.music) this.music.volume = this.musicVolume;
    try {
      localStorage.setItem('casino_volume', String(this.volume));
    } catch { /* ignore */ }
  }

  getVolume() {
    return this.volume;
  }
}

export const audio = new AudioManager();
