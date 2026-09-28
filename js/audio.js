// Title music + tiny 8-bit sound effects synthesized with WebAudio.
const TITLE_TRACKS = ['assets/music/silver-hand-man.mp3'];
// The ending theme (both story endings and the results after them):
// "I Made This and Then Cried Until 3 AM" by disappiercing.
const ENDING_TRACK = 'assets/music/i-made-this-and-then-cried-until-3-am.mp3';
// Plays once over the end credits: "This Should Be in a Video Game" by Pianomations.
const CREDITS_TRACK = 'assets/music/this-should-be-in-a-video-game.mp3';

// Older browser engines (e.g. some desktop wrappers) return nothing from play().
function safePlay(audio) {
  try {
    const p = audio.play();
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* ignore */ }
}

const Sound = {
  ctx: null,
  music: null,
  track: 0,
  fade: null,
  musicVolume: 0.55,

  // Start downloading the title music right away (playing it still needs a user gesture).
  preload() {
    if (!this.music) {
      this.music = new Audio(TITLE_TRACKS[0]);
      this.music.preload = 'auto';
      this.music.loop = true;
    }
  },

  // Must be called from a user gesture (browsers block audio before one).
  init() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* no audio */ }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    this.preload();
  },

  // True while the current song is still downloading / buffering.
  isLoading() {
    const m = this.music;
    return !!m && !m.error && m.networkState !== 3 && m.readyState < 3;
  },

  playMusic(restart) {
    if (!this.music) return;
    clearInterval(this.fade);
    if (restart) {
      this.track = 0;
      if (!this.music.src.endsWith(TITLE_TRACKS[0])) this.music.src = TITLE_TRACKS[0];
      this.music.currentTime = 0;
    }
    this.music.volume = this.musicVolume;
    safePlay(this.music);
  },

  // Switch the main player to another song (looped), from the start.
  playSong(src) {
    if (!this.music) return;
    clearInterval(this.fade);
    if (!this.music.src.endsWith(src)) this.music.src = src;
    try { this.music.currentTime = 0; } catch (e) { /* not loaded yet */ }
    this.music.loop = true;
    this.music.volume = this.musicVolume;
    safePlay(this.music);
  },
  // Back to the title song if something else was playing.
  ensureTitle() {
    if (this.music && !this.music.src.endsWith(TITLE_TRACKS[0])) this.playMusic(true);
  },

  fadeOutMusic(ms = 600) {
    const m = this.music;
    if (!m || m.paused) return;
    clearInterval(this.fade);
    const step = m.volume / (ms / 30);
    this.fade = setInterval(() => {
      m.volume = Math.max(0, m.volume - step);
      if (m.volume <= 0) {
        m.pause();
        clearInterval(this.fade);
      }
    }, 30);
  },

  // --- end credits song (its own player, so the title song can pick up where it left off)
  credits: null,
  creditsFade: null,
  playCredits() {
    this.fadeOutMusic(800);
    clearInterval(this.creditsFade);
    this.creditsFading = false;
    if (!this.credits) { this.credits = new Audio(CREDITS_TRACK); this.credits.preload = 'auto'; }
    const a = this.credits;
    a.loop = false;
    try { a.currentTime = 0; } catch (e) { /* not loaded yet */ }
    a.volume = this.musicVolume;
    safePlay(a);
  },
  // How far into the credits song we are ({ t, d } in seconds; d is 0 until it has loaded).
  creditsTime() {
    const a = this.credits;
    return a ? { t: a.currentTime || 0, d: isFinite(a.duration) ? a.duration : 0, ended: a.ended } : { t: 0, d: 0, ended: false };
  },
  fadeOutCredits(ms = 1000) {
    const a = this.credits;
    if (!a || a.paused || this.creditsFading) return;
    clearInterval(this.creditsFade);
    this.creditsFading = true;
    const step = Math.max(0.001, a.volume / (ms / 30));
    this.creditsFade = setInterval(() => {
      a.volume = Math.max(0, a.volume - step);
      if (a.volume <= 0) { a.pause(); clearInterval(this.creditsFade); this.creditsFading = false; }
    }, 30);
  },

  tone(type, f0, f1, dur, vol = 0.07, delay = 0) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    vol *= Config.sfx / 10;
    if (vol <= 0) return;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  },

  noise(dur, vol = 0.08) {
    const c = this.ctx;
    vol *= Config.sfx / 10;
    if (!c || vol <= 0) return;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = c.createBufferSource();
    const g = c.createGain();
    g.gain.value = vol;
    src.buffer = buf;
    src.connect(g).connect(c.destination);
    src.start();
  },

  sfx(name) {
    switch (name) {
      case 'move': this.tone('square', 660, 660, 0.05, 0.04); break;
      case 'select': this.tone('square', 523, 1046, 0.12, 0.05); break;
      case 'jump': this.tone('square', 280, 620, 0.12, 0.05); break;
      case 'walljump': this.tone('square', 360, 820, 0.1, 0.05); break;
      case 'spring': this.tone('square', 200, 1200, 0.25, 0.06); break;
      case 'crumble': this.noise(0.12, 0.05); break;
      case 'dash': this.noise(0.15, 0.06); this.tone('square', 900, 300, 0.15, 0.04); break;
      case 'crystal': [880, 1320].forEach((f, i) => this.tone('triangle', f, f, 0.1, 0.07, i * 0.06)); break;
      case 'ember': [784, 988, 1175].forEach((f, i) => this.tone('square', f, f, 0.07, 0.05, i * 0.05)); break;
      case 'fragment': [220, 262, 330, 247].forEach((f, i) => this.tone('triangle', f, f * 0.99, 0.35, 0.09, i * 0.18)); break;
      case 'whisper': this.noise(0.8, 0.03); this.tone('sine', 110, 55, 1.0, 0.08); break;
      case 'thunder': this.noise(1.6, 0.09); this.tone('triangle', 70, 30, 1.4, 0.14); break;
      case 'gust': this.noise(0.9, 0.05); break;
      case 'shoot': this.tone('square', 700, 200, 0.18, 0.04); break;
      case 'bosshit': this.noise(0.25, 0.1); this.tone('square', 900, 120, 0.4, 0.08); break;
      case 'pause': this.tone('square', 440, 440, 0.08, 0.05); break;
      case 'die':
        this.noise(0.3, 0.1);
        this.tone('triangle', 500, 60, 0.5, 0.12);
        break;
      case 'check':
        [523, 659, 784, 1046].forEach((f, i) => this.tone('square', f, f, 0.08, 0.05, i * 0.07));
        break;
      case 'clear':
        [392, 523, 659, 784, 659, 784, 1046].forEach((f, i) => this.tone('square', f, f, 0.12, 0.05, i * 0.1));
        break;
    }
  },
};
