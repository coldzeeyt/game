// Player settings (saved in the browser / desktop app).

// Graphics presets, from potato to NASA. Each one really changes what gets drawn.
const GFX_LEVELS = [
  { name: 'POTATO', desc: 'RUNS ON A LITERAL POTATO', layers: 0, stars: 0, mist: false, deco: false, rain: 0, dust: 0, particles: false, scanlines: false },
  { name: 'TOASTER', desc: 'IT CAN ALSO MAKE BREAD', layers: 1, stars: 0, mist: false, deco: false, rain: 40, dust: 0, particles: true, scanlines: false },
  { name: "GRANDMA'S LAPTOP", desc: 'STILL HAS INTERNET EXPLORER', layers: 3, stars: 6, mist: false, deco: true, rain: 80, dust: 16, particles: true, scanlines: false },
  { name: 'GAMER RIG', desc: 'THE RGB MAKES IT FASTER', layers: 3, stars: 14, mist: true, deco: true, rain: 140, dust: 36, particles: true, scanlines: false },
  { name: 'NASA PC', desc: 'CAN RENDER THE ENTIRE UNIVERSE', layers: 3, stars: 40, mist: true, deco: true, rain: 240, dust: 70, particles: true, scanlines: true },
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

const Config = {
  key: 'precipice.settings',
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
    } catch (e) { /* defaults */ }
  },
  save() {
    try {
      localStorage.setItem(this.key, JSON.stringify({ gfx: this.gfx, res: this.res, music: this.music, sfx: this.sfx }));
    } catch (e) { /* storage unavailable */ }
  },
};
Config.load();
