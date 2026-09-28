// The game's version, shown on the title screen and used to name releases.
// Bump it together with a new UPDATE page in the changelog (Credits > Changelog).
const GAME_VERSION = '2.1';

// Player settings (saved in the browser / desktop app).

// Graphics presets, from bare bones to full detail. Each one really changes what gets drawn.
const GFX_LEVELS = [
  { name: 'BARE BONES', layers: 0, stars: 0, mist: false, deco: false, rain: 0, dust: 0, particles: false, scanlines: false },
  { name: 'SIMPLE', layers: 1, stars: 0, mist: false, deco: false, rain: 40, dust: 0, particles: true, scanlines: false },
  { name: 'STANDARD', layers: 3, stars: 6, mist: false, deco: true, rain: 80, dust: 16, particles: true, scanlines: false },
  { name: 'DETAILED', layers: 3, stars: 14, mist: true, deco: true, rain: 140, dust: 36, particles: true, scanlines: false },
  { name: 'FULL DETAIL', layers: 3, stars: 40, mist: true, deco: true, rain: 240, dust: 70, particles: true, scanlines: true },
];

// Display sizes (16:9). "Auto" fills the window in whole-pixel steps.
const RESOLUTIONS = [
  { name: 'AUTO (FIT WINDOW)', w: 0 },
  { name: '640 X 360', w: 640 },
  { name: '960 X 540', w: 960 },
  { name: '1280 X 720', w: 1280 },
  { name: '1920 X 1080', w: 1920 },
  { name: '2560 X 1440', w: 2560 },
];

// Default key bindings: two keys per action (arrow keys work out of the box).
const DEFAULT_KEYS = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  jump: ['Space', 'KeyZ'],
  dash: ['ShiftLeft', 'KeyX'],
  pause: ['Escape', 'KeyP'],
};
const copyKeys = (k) => JSON.parse(JSON.stringify(k));

// Friendly names for key codes (shown in the Controls tab and on signs).
function keyName(code) {
  if (!code) return '-';
  const names = {
    ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', ArrowUp: 'UP', ArrowDown: 'DOWN', Space: 'SPACE',
    ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL',
    AltLeft: 'L-ALT', AltRight: 'R-ALT', Enter: 'ENTER', NumpadEnter: 'ENTER', Escape: 'ESC',
    Backspace: 'BACKSPACE', Tab: 'TAB', CapsLock: 'CAPS', Comma: ',', Period: '.', Slash: '/',
    Semicolon: ';', Quote: "'", Minus: '-', Equal: '=', BracketLeft: '(', BracketRight: ')',
  };
  if (names[code]) return names[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return 'NUM ' + code.slice(6);
  return code.toUpperCase().slice(0, 10);
}

const Config = {
  key: 'precipice.settings',
  keys: copyKeys(DEFAULT_KEYS),
  gfx: 3,
  res: 0,
  music: 8,
  sfx: 8,
  get g() { return GFX_LEVELS[this.gfx]; },
  load() {
    try {
      const d = JSON.parse(localStorage.getItem(this.key)) || {};
      const pick = (v, max, def) => (Number.isInteger(v) && v >= 0 && v <= max ? v : def);
      this.gfx = pick(d.gfx, GFX_LEVELS.length - 1, this.gfx);
      this.res = pick(d.res, RESOLUTIONS.length - 1, this.res);
      this.music = pick(d.music, 10, this.music);
      this.sfx = pick(d.sfx, 10, this.sfx);
      if (d.keys) for (const a in DEFAULT_KEYS) if (Array.isArray(d.keys[a])) this.keys[a] = d.keys[a].slice(0, 2);
    } catch (e) { /* defaults */ }
  },
  save() {
    try {
      localStorage.setItem(this.key, JSON.stringify({ gfx: this.gfx, res: this.res, music: this.music, sfx: this.sfx, keys: this.keys }));
    } catch (e) { /* storage unavailable */ }
  },
};
Config.load();
