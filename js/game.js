// PRECIPICE - main game: input, scenes, player physics and rendering.
(() => {
  // Internal pixel resolution: 16:9, scaled 4x to 1920x1080.
  const W = SCREEN_W; // 480
  const H = SCREEN_H; // 270
  const T = 16;

  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // The real visible area. iPad Safari can report stale window sizes right
  // after a rotation, so prefer the visual viewport when there is one.
  function viewSize() {
    const v = window.visualViewport;
    const w = v ? Math.min(innerWidth, Math.round(v.width * v.scale)) : innerWidth;
    const h = v ? Math.min(innerHeight, Math.round(v.height * v.scale)) : innerHeight;
    return [w || innerWidth, h || innerHeight];
  }

  function resize() {
    // Largest whole-number scale that fits (4x = 1920x1080); fall back to a
    // fractional scale on very small windows.
    const [vw, vh] = viewSize();
    const fit = Math.min(vw / W, vh / H);
    if (!(fit > 0)) return; // window not laid out yet (can happen in desktop wrappers)
    // phones and tablets fill the screen; computers keep crisp whole-number steps
    const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    let s = fit >= 1 && !touch ? Math.floor(fit) : fit;
    const res = RESOLUTIONS[Config.res];
    if (res.w) s = Math.min(res.w / W, fit); // chosen size, shrunk to fit the window
    canvas.style.width = W * s + 'px';
    canvas.style.height = H * s + 'px';
  }
  addEventListener('resize', resize);
  if (window.visualViewport) visualViewport.addEventListener('resize', resize);
  // After a rotation, undo any page zoom/scroll Safari applied and re-fit a few times
  // (the new size can take a moment to settle).
  addEventListener('orientationchange', () => {
    const meta = document.querySelector('meta[name=viewport]');
    if (meta) { const c = meta.content; meta.content = c + ', minimum-scale=1'; setTimeout(() => { meta.content = c; }, 50); }
    for (const t of [0, 100, 300, 700]) setTimeout(() => { scrollTo(0, 0); resize(); }, t);
  });
  resize();
  let lastSize = '';

  // ---------------------------------------------------------------- input
  const Input = { down: new Set(), pressed: new Set(), typed: [], any: false, mouse: { x: -1, y: -1, click: false, moved: false } };
  const NO_SCROLL = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  addEventListener('keydown', (e) => {
    if (NO_SCROLL.has(e.code)) e.preventDefault();
    Sound.init();
    if (!e.repeat) Input.pressed.add(e.code);
    if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey) Input.typed.push(e.key); // actual characters, for typing text
    Input.down.add(e.code);
    Input.any = true;
  });
  addEventListener('keyup', (e) => Input.down.delete(e.code));
  addEventListener('blur', () => Input.down.clear());
  const toCanvas = (e) => {
    const r = canvas.getBoundingClientRect();
    Input.mouse.x = ((e.clientX - r.left) * W) / r.width;
    Input.mouse.y = ((e.clientY - r.top) * H) / r.height;
  };
  canvas.addEventListener('mousemove', (e) => { toCanvas(e); Input.mouse.moved = true; });
  canvas.addEventListener('mousedown', (e) => {
    toCanvas(e);
    Sound.init();
    Input.mouse.click = true;
    Input.any = true;
  });

  const hit = (...codes) => codes.some((c) => Input.pressed.has(c));
  const held = (...codes) => codes.some((c) => Input.down.has(c));
  // Actions go through the player's key bindings (Settings > Controls).
  const keysFor = (a) => Config.keys[a] || [];
  const act = (a) => held(...keysFor(a));
  const tap = (a) => hit(...keysFor(a));
  // Menus always accept WASD, the arrow keys and the player's own bindings.
  const K = {
    get up() { return ['KeyW', 'ArrowUp', ...keysFor('up')]; },
    get down() { return ['KeyS', 'ArrowDown', ...keysFor('down')]; },
    get left() { return ['KeyA', 'ArrowLeft', ...keysFor('left')]; },
    get right() { return ['KeyD', 'ArrowRight', ...keysFor('right')]; },
    ok: ['Enter', 'NumpadEnter', 'Space'],
    back: ['Escape', 'Backspace'],
  };

  // ---------------------------------------------------------------- helpers
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  let frame = 0;
  const blink = (rate = 30) => Math.floor(frame / rate) % 2 === 0;

  // Dialog box: drop shadow, black outline, white frame with notched corners.
  function panel(x, y, w, h, border = '#fcfcfc') {
    x = Math.round(x);
    y = Math.round(y);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x + 3, y + 3, w, h);
    ctx.fillStyle = '#000000';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = border;
    ctx.fillRect(x + 2, y + 1, w - 4, 1);
    ctx.fillRect(x + 2, y + h - 2, w - 4, 1);
    ctx.fillRect(x + 1, y + 2, 1, h - 4);
    ctx.fillRect(x + w - 2, y + 2, 1, h - 4);
    ctx.fillStyle = '#0c0828';
    ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    ctx.fillStyle = '#342468';
    ctx.fillRect(x + 3, y + 3, w - 6, 1);
  }

  // Pop-open text box: grows from its centre line over ~8 frames (t = frames since it opened).
  function animatedPanel(x, y, w, h, t, border, closeT) {
    let k = Math.min(1, Math.max(0, t) / 8);
    if (closeT !== undefined) k = Math.min(k, Math.max(0, closeT) / 6);
    k = 1 - (1 - k) * (1 - k); // ease out
    const hh = Math.max(4, Math.round(h * k));
    panel(x, Math.round(y + (h - hh) / 2), w, hh, border);
    return k >= 1;
  }

  // Blinking "more / done" arrow in the corner of a finished text box.
  function doneArrow(x, y, color = PAL.y) {
    if (!blink(16)) return;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 5, 1);
    ctx.fillRect(x + 1, y + 1, 3, 1);
    ctx.fillRect(x + 2, y + 2, 1, 1);
  }

  // Replace {jump}, {left2}, ... in text with the player's current keys.
  function fillKeys(text) {
    return text.replace(/\{(\w+?)(2?)\}/g, (_, a, two) => keyName(keysFor(a)[two ? 1 : 0]));
  }

  // One ground tile: grass on top, earth that darkens with depth, and a dark
  // outline wherever the ground meets open air.
  function drawGround(px, py, tx, ty, isGround) {
    let d = 0;
    while (d < 7 && isGround(tx, ty - 1 - d)) d++;
    const shade = d <= 2 ? 0 : d <= 4 ? 1 : d <= 6 ? 2 : 3;
    ctx.drawImage(d === 0 ? TILES.grass : TILES.dirt[shade], px, py);
    const side = (x) => {
      if (d === 0) {
        ctx.fillStyle = '#005800';
        ctx.fillRect(x, py, 1, 5);
        ctx.fillStyle = '#2c1400';
        ctx.fillRect(x, py + 5, 1, 11);
      } else {
        ctx.fillStyle = '#2c1400';
        ctx.fillRect(x, py, 1, 16);
      }
    };
    if (!isGround(tx - 1, ty)) side(px);
    if (!isGround(tx + 1, ty)) side(px + 15);
    if (!isGround(tx, ty + 1)) {
      ctx.fillStyle = '#2c1400';
      ctx.fillRect(px, py + 15, 16, 1);
    }
  }

  function makeMenu(items, y, spacing = 18) {
    return {
      items, y, spacing, index: 0,
      rect(i) {
        const w = textWidth(this.items[i].label) + 24;
        return { x: W / 2 - w / 2, y: this.y + i * this.spacing - 4, w, h: 15 };
      },
      update() {
        const n = this.items.length;
        if (hit(...K.up)) { this.index = (this.index + n - 1) % n; Sound.sfx('move'); }
        if (hit(...K.down)) { this.index = (this.index + 1) % n; Sound.sfx('move'); }
        let chosen = hit(...K.ok);
        const m = Input.mouse;
        if (m.moved || m.click) {
          for (let i = 0; i < n; i++) {
            if (!overlap({ x: m.x, y: m.y, w: 1, h: 1 }, this.rect(i))) continue;
            if (m.moved && this.index !== i) { this.index = i; Sound.sfx('move'); }
            if (m.click) { this.index = i; chosen = true; }
          }
        }
        if (!chosen) return null;
        Sound.sfx('select');
        return this.items[this.index];
      },
      draw() {
        this.items.forEach((it, i) => {
          const y = this.y + i * this.spacing;
          const sel = i === this.index;
          drawTextOutlined(ctx, it.label, W / 2, y, sel ? PAL.c : '#b8c4f0', 1, 'center');
          if (sel) {
            const half = textWidth(it.label) / 2;
            const bob = blink(15) ? 0 : 1;
            drawTextOutlined(ctx, '>', W / 2 - half - 12 + bob, y, PAL.w);
            drawTextOutlined(ctx, '<', W / 2 + half + 7 - bob, y, PAL.w);
          }
        });
      },
    };
  }

  function drawTitleBackdrop() {
    drawBackground(ctx, frame * 0.25, frame);
    // A cliff edge with our hero staring into the abyss.
    const cliff = (x, y) => x >= 0 && x < 6 && y >= 12;
    for (let x = 0; x < 6; x++) for (let y = 12; y < 17; y++) drawGround(x * T, y * T, x, y, cliff);
    if (Config.g.deco) {
      ctx.drawImage(DECO.pine, 17, 12 * T - 25);
      ctx.drawImage(DECO.bush, 3 * T + 1, 12 * T - 6);
      ctx.drawImage(DECO.tuft, 6, 12 * T - 3);
      ctx.drawImage(DECO.tuft, 2 * T + 9, 12 * T - 3);
      ctx.drawImage(DECO.flowers[0], 4 * T + 10, 12 * T - 4);
      ctx.drawImage(DECO.rock, 2 * T + 1, 12 * T - 3);
    }
    ctx.drawImage(PLAYER_SPR.dash.idle.right, 6 * T - 13, 12 * T - 16);

    // Storm: lightning every 10 seconds; the Watcher is only seen in its light.
    const storm = frame % 600;
    if (storm < 110 && (storm < 90 || storm % 4 < 2)) ctx.drawImage(WATCHER_SPR.left, 392, 186);
    drawRain();
    if (storm < 12) {
      if (storm < 4 || (storm > 7 && storm < 10)) {
        ctx.fillStyle = 'rgba(220,220,255,' + (storm < 4 ? 0.45 : 0.25) + ')';
        ctx.fillRect(0, 0, W, H);
      }
      drawBolt(Math.floor(frame / 600));
    }
    drawTinyText(ctx, 'ColdzeeYT', W / 2, H - 9, '#6c7cc8');
  }

  // Animated rain: every drop's position is a pure function of the frame.
  function drawRain() {
    ctx.fillStyle = 'rgba(150,160,230,0.55)';
    for (let i = 0; i < Config.g.rain; i++) {
      const sp = 4 + (decoRoll(i, 1) % 30) / 10;
      const y = (decoRoll(i, 2) * 3 + frame * sp) % (H + 30) - 15;
      const x = ((decoRoll(i, 3) * 5 - y * 0.3) % (W + 40) + W + 40) % (W + 40) - 20;
      const len = 4 + (i % 3);
      for (let k = 0; k < len; k++) ctx.fillRect(Math.round(x + k * 0.3), Math.round(y - k), 1, 1);
    }
    // splashes on the cliff top
    ctx.fillStyle = '#a4b4fc';
    for (let i = 0; i < 4; i++) {
      const sx = (decoRoll(frame, i) * 7) % 96;
      ctx.fillRect(sx, 12 * T - 1 - (frame + i) % 2, 1, 1);
      ctx.fillRect(sx + 2, 12 * T - 2, 1, 1);
    }
  }

  function drawBolt(seed) {
    let x = 140 + (decoRoll(seed, 9) % 200);
    ctx.fillStyle = '#fcfcfc';
    for (let y = 0; y < 150; y += 6) {
      const nx = x + ((decoRoll(seed * 31 + y, 4) % 9) - 4);
      for (let k = 0; k < 6; k++) ctx.fillRect(Math.round(x + ((nx - x) * k) / 6), y + k, 1, 1);
      x = nx;
    }
  }

  // Shared per-frame logic for the title backdrop (thunder follows the flash).
  function titleUpdate() {
    if (frame % 600 === 25) Sound.sfx('thunder');
  }

  function drawLogo(y = 48) {
    y += Math.round(Math.sin(frame / 45) * 1.5);
    // Icy lettering: deep navy drop shadow, then white fading to sky blue.
    drawText(ctx, 'PRECIPICE', W / 2 + 3, y + 3, '#0c1c5c', 3, 'center');
    drawTextOutlined(ctx, 'PRECIPICE', W / 2, y, PAL.w, 3, 'center');
    const band = (top, h, col) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, y + top, W, h);
      ctx.clip();
      drawText(ctx, 'PRECIPICE', W / 2, y, col, 3, 'center');
      ctx.restore();
    };
    band(6, 6, PAL.C);
    band(12, 6, PAL.c);
    band(18, 3, '#0078f8');
  }

  // ---------------------------------------------------------------- scenes
  let scene = null;
  let fade = 0; // frames of fade-in left after a scene change
  const FADE = 16;
  function setScene(s, ...args) {
    scene = s;
    fade = FADE;
    if (s.enter) s.enter(...args);
  }

  function toTitle() {
    Sound.playMusic(true);
    setScene(Title);
  }

  function startLevel(def, run) {
    Sound.fadeOutMusic();
    setScene(Play, def, run);
  }

  // ---------------------------------------------------------------- save slots
  // Slots 0-2 are normal saves, slot 3 is the Hardcore run. A slot remembers the
  // campaign stage, the last checkpoint, collectables and play time.
  const Slots = {
    keys: ['precipice.slot1', 'precipice.slot2', 'precipice.slot3', 'precipice.hardcore'],
    HARDCORE: 3,
    load(i) {
      try {
        const d = JSON.parse(localStorage.getItem(this.keys[i]));
        return d && typeof d.stage === 'number' ? d : null;
      } catch (e) { return null; }
    },
    write(i, d) {
      d.updated = Date.now();
      try { localStorage.setItem(this.keys[i], JSON.stringify(d)); return true; } catch (e) { return false; }
    },
    fresh(hardcore) {
      return { stage: 0, cp: -1, stageTime: 0, stageDeaths: 0, e: [], f: [], totalTime: 0, totalDeaths: 0, found: {}, hardcore: !!hardcore, done: false };
    },
    // most recently played normal slot that isn't finished
    latest() {
      let best = -1, t = -1;
      for (let i = 0; i < 3; i++) {
        const d = this.load(i);
        if (d && !d.done && d.updated > t) { t = d.updated; best = i; }
      }
      return best;
    },
    any() { return [0, 1, 2].some((i) => this.load(i)); },
    // one-time move of the old single save into slot 1
    migrate() {
      try {
        const old = JSON.parse(localStorage.getItem('precipice.save'));
        if (old && !this.load(0)) {
          const d = this.fresh(false);
          Object.assign(d, { cp: old.cp, stageTime: old.time || 0, stageDeaths: old.deaths || 0, e: old.embers || [], f: old.fragments || [] });
          this.write(0, d);
        }
        localStorage.removeItem('precipice.save');
      } catch (e) { /* nothing to migrate */ }
    },
  };
  Slots.migrate();

  const orBools = (a = [], b = []) => Array.from({ length: Math.max(a.length, b.length) }, (_, i) => !!(a[i] || b[i]));

  // Totals across the whole campaign (for "EMBERS 12/234").
  const countTotals = (defs) => {
    let e = 0, f = 0;
    for (const def of defs) { const L = buildLevel(def); e += L.embers.length; f += L.fragments.length; }
    return { e, f };
  };
  const TOTALS = countTotals(CAMPAIGN);
  const TOTALS1 = countTotals(CAMPAIGN.slice(0, ACT2_START)); // Act I only

  function slotStats(d) {
    const found = Object.assign({}, d.found);
    const cur = CAMPAIGN[d.stage];
    if (cur && !d.done) {
      const was = found[cur.id] || {};
      found[cur.id] = { e: orBools(was.e, d.e), f: orBools(was.f, d.f) };
    }
    let e = 0, f = 0;
    for (const id in found) { e += found[id].e.filter(Boolean).length; f += found[id].f.filter(Boolean).length; }
    return { e, f, time: d.totalTime + d.stageTime, deaths: d.totalDeaths + d.stageDeaths };
  }

  function formatLong(frames) {
    const s = Math.floor(frames / 60);
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
    return h + ':' + (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  // Start (or resume) the campaign stored in a slot.
  function playSlot(i) {
    const data = Slots.load(i);
    if (!data) return;
    const run = { slot: i, data };
    if (data.done) { setScene(Ending, run); return; }
    const def = CAMPAIGN[Math.min(data.stage, CAMPAIGN.length - 1)];
    const fresh = data.cp < 0 && !data.stageTime;
    if (fresh && def.stage === 0) setScene(ChapterIntro, def.chapter, run);
    else startLevel(def, run);
  }

  const Splash = {
    update() {
      titleUpdate();
      if (Input.any) {
        Sound.init();
        Sound.playMusic(true);
        Sound.sfx('select');
        setScene(Title);
      }
    },
    draw() {
      drawTitleBackdrop();
      drawLogo();
      if (blink()) drawTextOutlined(ctx, 'PRESS ANY KEY', W / 2, 140, PAL.C, 1, 'center');
    },
  };

  const DOWNLOAD_URL = 'https://github.com/coldzeeyt/precipice/releases/latest/download/Precipice.exe';
  const ANDROID_URL = 'https://github.com/coldzeeyt/precipice/releases/latest/download/Precipice-Android.apk';

  // Leave the title screen alone for 10 minutes and the Watcher gets impatient.
  const IDLE_FRAMES = 60 * 60 * 10;
  const Title = {
    idleT: 0, uiA: 1, // frames without input; how visible the menus are (fades to 0 when idle)
    enter() {
      Sound.ensureTitle();
      this.idleT = 0;
      this.uiA = 1;
      this.cont = Slots.latest();
      const items = [];
      if (this.cont >= 0) items.push({ id: 'continue', label: 'CONTINUE' });
      items.push({ id: 'new', label: 'NEW GAME' });
      if (Slots.any()) items.push({ id: 'load', label: 'LOAD GAME' });
      items.push(
        { id: 'tutorial', label: 'TUTORIAL' },
        { id: 'guide', label: 'GUIDE' },
        { id: 'lore', label: 'LORE' },
        { id: 'settings', label: 'SETTINGS' },
        { id: 'credits', label: 'CREDITS' },
      );
      // In a web browser, offer the app for this device (built by GitHub Actions).
      const ua = navigator.userAgent;
      const isApp = /Electron/i.test(ua) || !!window.Capacitor;
      const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      if (!isApp && !isTouch) items.splice(items.length - 2, 0, { id: 'download', label: 'DOWNLOAD FOR PC', url: DOWNLOAD_URL });
      if (!isApp && /Android/i.test(ua)) items.splice(items.length - 2, 0, { id: 'download', label: 'DOWNLOAD FOR ANDROID', url: ANDROID_URL });
      this.menu = makeMenu(items, 88, items.length > 10 ? 12 : items.length > 9 ? 13 : 14);
      this.corner = -1; // -1: main menu, 0: ACCOUNT (bottom left), 1: MORE (bottom right), 2: STORIES (top)
    },
    // The extra buttons. LEFT/RIGHT reach the bottom corners, UP from the top of the menu reaches STORIES.
    cornerRects() {
      const a = this.cornerLabels();
      const wa = textWidth(a[0]) + 16, wb = textWidth(a[1]) + 16, wc = textWidth(a[2]) + 16;
      const r = [{ x: 6, y: H - 22, w: wa, h: 16 }, { x: W - 6 - wb, y: H - 22, w: wb, h: 16 }, { x: W / 2 - wc / 2, y: 14, w: wc, h: 16 }];
      r.push({ x: 6, y: 14, w: textWidth(a[3]) + 16, h: 16 }); // DEV NOTES (top left)
      return r;
    },
    cornerLabels() { return [(Account.loggedIn() ? 'ACCOUNT: ' + Account.user : 'ACCOUNT') + (Account.unread ? ' (' + Account.unread + ' NEW)' : ''), 'MORE', 'STORIES', 'DEV NOTES']; },
    setCorner(c) {
      if (c === this.corner) return;
      if (this.corner < 0) this.menuIndex = this.menu.index;
      this.corner = c;
      this.menu.index = c < 0 ? this.menuIndex : -1;
      Sound.sfx('move');
    },
    pickCorner() {
      Sound.sfx('select');
      setScene([AccountScene, More, Stories, DevNotes][this.corner]);
    },
    update() {
      titleUpdate();
      // idle easter egg: any key or mouse movement brings the menus back
      const woke = Input.any || Input.mouse.moved || Input.mouse.click;
      if (woke) this.idleT = 0; else this.idleT++;
      const target = this.idleT >= IDLE_FRAMES ? 0 : 1;
      this.uiA = target < this.uiA ? Math.max(0, this.uiA - 1 / 120) : Math.min(1, this.uiA + 1 / 30);
      if (this.uiA < 1) return; // (the input that woke it up only wakes it up)
      this.titleInput();
    },
    titleInput() {
      const m = Input.mouse;
      if (m.moved || m.click) {
        const over = this.cornerRects().findIndex((r) => overlap({ x: m.x, y: m.y, w: 1, h: 1 }, r));
        if (over >= 0) {
          this.setCorner(over);
          if (m.click) { this.pickCorner(); return; }
        } else if (this.corner >= 0 && m.moved && this.menu.items.some((it, i) => overlap({ x: m.x, y: m.y, w: 1, h: 1 }, this.menu.rect(i)))) {
          this.setCorner(-1);
        }
      }
      if (this.corner >= 2) {
        // top row: STORIES, and DEV NOTES to its left
        if (hit(...K.down)) { this.menuIndex = 0; this.setCorner(-1); }
        else if (hit(...K.left) && this.corner === 2) this.setCorner(3);
        else if (hit(...K.right) && this.corner === 3) this.setCorner(2);
        else if (hit(...K.ok)) this.pickCorner();
        return;
      }
      if (hit(...K.left)) this.setCorner(0);
      else if (hit(...K.right)) this.setCorner(1);
      else if (this.corner < 0 && this.menu.index === 0 && hit(...K.up)) { this.setCorner(2); return; }
      if (this.corner >= 0) {
        if (hit(...K.up, ...K.down)) this.setCorner(-1);
        else if (hit(...K.ok)) this.pickCorner();
        return;
      }
      const c = this.menu.update();
      if (!c) return;
      if (c.id === 'continue') playSlot(this.cont);
      else if (c.id === 'load') setScene(SlotSelect, 'load');
      else if (c.id === 'guide') setScene(Guide);
      else if (c.id === 'lore') setScene(Lore);
      else if (c.id === 'download') window.open(c.url, '_blank', 'noopener');
      else if (c.id === 'more') setScene(More);
      else if (c.id === 'new') setScene(SlotSelect, 'new');
      else if (c.id === 'tutorial') startLevel(LEVELS.tutorial);
      else if (c.id === 'settings') setScene(Settings);
      else if (c.id === 'credits') setScene(Credits);
    },
    draw() {
      drawTitleBackdrop();
      drawLogo();
      ctx.globalAlpha = this.uiA;
      const top = this.menu.y - 8, h = this.menu.items.length * this.menu.spacing + 10;
      ctx.fillStyle = 'rgba(8,6,28,0.6)';
      ctx.fillRect(W / 2 - 64, top, 128, h);
      ctx.fillStyle = '#342468';
      ctx.fillRect(W / 2 - 64, top, 128, 1);
      ctx.fillRect(W / 2 - 64, top + h - 1, 128, 1);
      this.menu.draw();
      const labels = this.cornerLabels();
      this.cornerRects().forEach((r, i) => {
        const sel = i === this.corner;
        ctx.fillStyle = sel ? 'rgba(60,188,252,0.25)' : 'rgba(8,6,28,0.7)';
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = sel ? PAL.c : '#342468';
        ctx.fillRect(r.x, r.y, r.w, 1);
        ctx.fillRect(r.x, r.y + r.h - 1, r.w, 1);
        ctx.fillRect(r.x, r.y, 1, r.h);
        ctx.fillRect(r.x + r.w - 1, r.y, 1, r.h);
        drawText(ctx, labels[i], r.x + r.w / 2, r.y + 5, sel ? PAL.c : '#b8c4f0', 1, 'center');
      });
      ctx.globalAlpha = 1;
      if (this.uiA < 1) this.drawWatcherTalk(1 - this.uiA);
    },
    // The Watcher steps out of the rain: "YOU REALLY CAN'T CHOOSE?"
    drawWatcherTalk(a) {
      ctx.globalAlpha = a;
      ctx.drawImage(WATCHER_SPR.left, 392, 186);
      const text = "YOU REALLY CAN'T CHOOSE?";
      const tw = textWidth(text), bx = 386 - tw, by = 150, bw = tw + 16, bh = 20;
      ctx.fillStyle = '#08061c'; ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = '#881400';
      ctx.fillRect(bx, by, bw, 1); ctx.fillRect(bx, by + bh - 1, bw, 1); ctx.fillRect(bx, by, 1, bh); ctx.fillRect(bx + bw - 1, by, 1, bh);
      // tail down to the Watcher
      for (let i = 0; i < 6; i++) { ctx.fillStyle = '#08061c'; ctx.fillRect(bx + bw - 12 + i, by + bh - 1 + i, 6 - i, 1); ctx.fillStyle = '#881400'; ctx.fillRect(bx + bw - 12 + i, by + bh - 1 + i, 1, 1); ctx.fillRect(bx + bw - 7, by + bh - 1 + i, 1, 1); }
      const shown = Math.floor(Math.max(0, a * 1.6 - 0.6) * text.length); // types out once the menus are gone
      drawText(ctx, text.slice(0, shown), bx + 8, by + 7, '#fcbcb0');
      ctx.globalAlpha = 1;
    },
  };

  // ---------------------------------------------------------------- dev notes
  // Notes from the developer, kept on the account server. Everyone can read
  // them; only the dev's account (COLDZEEYT) can write, and the server checks.
  const NOTE_COLS = 58, NOTE_ROWS = 13;
  function wrapNotes(text, cols = NOTE_COLS) {
    const NOTE_COLS = cols; // (shadows the default so messages can wrap narrower)
    const out = [];
    for (const para of text.split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        let w = word;
        while (w.length > NOTE_COLS) { if (line) { out.push(line); line = ''; } out.push(w.slice(0, NOTE_COLS)); w = w.slice(NOTE_COLS); }
        if ((line ? line.length + 1 : 0) + w.length > NOTE_COLS) { out.push(line); line = w; } else line = line ? line + ' ' + w : w;
      }
      out.push(line);
    }
    return out;
  }
  const DevNotes = {
    enter() {
      this.text = ''; this.loaded = false; this.dirty = false; this.saving = false; this.editT = 0; this.scroll = 0; this.t = 0; this.bs = 0;
      this.canEdit = Account.isDev();
      this.savedAt = 0;
      this.refresh();
    },
    // Fetch the latest notes from the server (the REFRESH button does this too).
    refresh() {
      if (this.dirty) this.save(); // the dev's unsaved typing goes up first
      this.status = 'LOADING...';
      Account.loadNotes().then((n) => {
        this.text = n.text || ''; this.savedAt = n.savedAt || 0; this.loaded = true; this.status = '';
        if (!this.canEdit) this.scroll = Math.max(0, wrapNotes(this.text).length - NOTE_ROWS); // readers start at the top
      }, (e) => { this.status = e.message; });
    },
    refreshRect() { return { x: W / 2 + 124, y: 20, w: 60, h: 14 }; }, // top right of the notes box
    playersRect() { return { x: W / 2 - 184, y: 20, w: 60, h: 14 }; }, // top left, dev only
    save() {
      if (!this.loaded || this.saving) return;
      this.saving = true; this.dirty = false; this.status = 'SAVING...';
      Account.saveNotes(this.text).then(() => { this.saving = false; if (!this.dirty) this.status = 'SAVED'; },
        (e) => { this.saving = false; this.dirty = true; this.status = 'NOT SAVED: ' + e.message; });
    },
    edit(text) { this.text = text.slice(0, 20000); this.dirty = true; this.editT = 0; this.scroll = 0; this.status = ''; },
    update() {
      titleUpdate();
      this.t++;
      if (hit('Escape') || (!this.canEdit && hit('Backspace'))) { if (this.dirty) this.save(); Sound.sfx('select'); setScene(Title); return; }
      const m = Input.mouse;
      const onRefresh = overlap({ x: m.x, y: m.y, w: 1, h: 1 }, this.refreshRect());
      this.hover = onRefresh;
      if ((m.click && onRefresh) || (!this.canEdit && hit('KeyR', 'F5'))) {
        Sound.sfx('select');
        if (hit('F5')) Input.pressed.delete('F5');
        this.refresh();
        return;
      }
      const onPlayers = this.canEdit && overlap({ x: m.x, y: m.y, w: 1, h: 1 }, this.playersRect());
      this.hoverP = onPlayers;
      if (m.click && onPlayers) { Sound.sfx('select'); if (this.dirty) this.save(); setScene(Players); return; }
      if (!this.loaded) return;
      const lines = wrapNotes(this.text).length;
      if (hit(...(this.canEdit ? ['ArrowUp'] : K.up))) this.scroll = Math.min(this.scroll + 1, Math.max(0, lines - NOTE_ROWS));
      if (hit(...(this.canEdit ? ['ArrowDown'] : K.down))) this.scroll = Math.max(0, this.scroll - 1);
      if (!this.canEdit) return;
      // the dev types
      if (IS_TOUCH && Input.mouse.click) {
        const add = prompt('ADD A LINE TO THE DEV NOTES');
        Input.down.clear();
        if (add) this.edit(this.text + (this.text ? '\n' : '') + add.toUpperCase());
      }
      let t = this.text;
      for (const ch of Input.typed) {
        const c = ch.toUpperCase();
        if (c === ' ' || FONT[c]) t += c;
      }
      if (hit('Enter', 'NumpadEnter')) t += '\n';
      this.bs = held('Backspace') ? this.bs + 1 : 0;
      if (hit('Backspace') || (this.bs > 24 && this.bs % 3 === 0)) t = t.slice(0, -1); // hold to keep deleting
      if (t !== this.text) this.edit(t);
      this.editT++;
      if (this.dirty && this.editT > 90) this.save(); // autosave 1.5 s after you stop typing
    },
    draw() {
      drawTitleBackdrop();
      panel(W / 2 - 200, 12, 400, 246, PAL.y);
      drawTextOutlined(ctx, 'DEV NOTES', W / 2, 20, PAL.y, 2, 'center');
      const when = this.savedAt ? '  -  UPDATED ' + new Date(this.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase() : '';
      drawText(ctx, (this.canEdit ? 'YOU CAN EDIT THESE' : 'FROM ColdzeeYT') + when, W / 2, 40, PAL.m, 1, 'center');
      const lines = wrapNotes(this.text);
      const start = Math.max(0, lines.length - NOTE_ROWS - this.scroll);
      if (this.loaded && !this.text && !this.canEdit) drawText(ctx, 'NO NOTES YET. CHECK BACK LATER!', W / 2, 120, PAL.n, 1, 'center');
      lines.slice(start, start + NOTE_ROWS).forEach((l, i) => drawText(ctx, l, W / 2 - 186, 56 + i * 12, PAL.w));
      if (this.canEdit && this.loaded && this.scroll === 0 && blink(15)) {
        const last = lines[lines.length - 1] || '';
        const row = Math.min(lines.length, NOTE_ROWS) - 1;
        ctx.fillStyle = PAL.y; ctx.fillRect(W / 2 - 186 + textWidth(last) + (last ? 1 : 0), 56 + row * 12 + 7, 5, 1);
      }
      if (start > 0) drawText(ctx, '^ MORE', W / 2 + 186, 56, PAL.n, 1, 'right');
      if (start + NOTE_ROWS < lines.length) drawText(ctx, 'v MORE', W / 2 + 186, 56 + (NOTE_ROWS - 1) * 12, PAL.n, 1, 'right');
      const st = this.status || (this.dirty ? 'EDITED' : '');
      drawText(ctx, st, W / 2 - 186, 238, st.startsWith('NOT') || st.startsWith('CANNOT') ? PAL.e : PAL.G);
      const help = !this.canEdit ? 'UP/DOWN: SCROLL   ESC: BACK' : IS_TOUCH ? 'TAP: ADD A LINE   PAUSE: BACK' : 'ENTER: NEW LINE   ESC: SAVE & BACK';
      drawText(ctx, help, W / 2 + 186, 238, PAL.n, 1, 'right');
      // REFRESH button (R for readers): fetch the newest notes
      const r = this.refreshRect();
      ctx.fillStyle = this.hover ? 'rgba(60,188,252,0.25)' : 'rgba(8,6,28,0.8)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = this.hover ? PAL.c : '#342468';
      ctx.fillRect(r.x, r.y, r.w, 1); ctx.fillRect(r.x, r.y + r.h - 1, r.w, 1); ctx.fillRect(r.x, r.y, 1, r.h); ctx.fillRect(r.x + r.w - 1, r.y, 1, r.h);
      drawText(ctx, 'REFRESH', r.x + r.w / 2, r.y + 4, this.hover ? PAL.c : '#b8c4f0', 1, 'center');
      if (this.canEdit) drawButton(this.playersRect(), 'PLAYERS', this.hoverP);
    },
  };

  function drawButton(r, label, sel) {
    ctx.fillStyle = sel ? 'rgba(60,188,252,0.25)' : 'rgba(8,6,28,0.8)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = sel ? PAL.c : '#342468';
    ctx.fillRect(r.x, r.y, r.w, 1); ctx.fillRect(r.x, r.y + r.h - 1, r.w, 1); ctx.fillRect(r.x, r.y, 1, r.h); ctx.fillRect(r.x + r.w - 1, r.y, 1, r.h);
    drawText(ctx, label, r.x + r.w / 2, r.y + 4, sel ? PAL.c : '#b8c4f0', 1, 'center');
  }

  // Players (dev only, from Dev Notes): every account, when it joined and last
  // logged in, and how far its cloud save has got. The server never has passwords.
  const Players = {
    enter() {
      this.list = null; this.scroll = 0; this.index = 0; this.status = 'LOADING...'; this.t = 0;
      this.load();
    },
    load() {
      Account.players().then((l) => { this.list = l; this.status = ''; }, (e) => { this.status = e.message; });
    },
    rowY(i) { return 66 + i * 12; },
    update() {
      titleUpdate();
      if (++this.t % 900 === 0) this.load(); // refresh who's online every 15 s
      if (hit(...K.back)) { Sound.sfx('select'); setScene(DevNotes); return; }
      if (!this.list) return;
      const n = this.list.length;
      if (hit(...K.down) && this.index < n - 1) { this.index++; Sound.sfx('move'); }
      if (hit(...K.up) && this.index > 0) { this.index--; Sound.sfx('move'); }
      const m = Input.mouse;
      let chosen = hit('Enter', 'NumpadEnter', 'Space');
      if (m.moved || m.click) for (let i = 0; i < 14; i++) {
        if (m.y < this.rowY(i) - 2 || m.y > this.rowY(i) + 9 || Math.abs(m.x - W / 2) > 214 || !this.list[this.scroll + i]) continue;
        this.index = this.scroll + i;
        if (m.click) chosen = true;
      }
      this.scroll = clamp(this.scroll, this.index - 13, this.index);
      const pl = this.list[this.index];
      if (chosen && pl && pl.name !== Account.user) { Sound.sfx('select'); setScene(Chat, pl.name, Players); }
    },
    progress(pl) {
      if (pl.done) return 'FINISHED!';
      if (pl.stage < 0) return pl.savedAt ? '-' : 'NO CLOUD SAVE';
      const def = CAMPAIGN[Math.min(pl.stage, CAMPAIGN.length - 1)];
      return 'STAGE ' + def.name.split(' ')[0];
    },
    draw() {
      drawTitleBackdrop();
      panel(W / 2 - 220, 8, 440, 254, PAL.y);
      drawTextOutlined(ctx, 'PLAYERS', W / 2, 16, PAL.y, 2, 'center');
      if (!this.list) { drawText(ctx, this.status, W / 2, 120, PAL.m, 1, 'center'); return; }
      const on = this.list.filter((p) => p.online).length;
      drawText(ctx, this.list.length + ' ACCOUNTS, ' + on + ' ONLINE (NO PASSWORDS ARE EVER STORED)', W / 2, 36, PAL.m, 1, 'center');
      const cols = [W / 2 - 208, W / 2 - 124, W / 2 - 70, W / 2 + 8, W / 2 + 120];
      ['NAME', 'JOINED', 'LAST SEEN', 'PROGRESS', 'ONLY UP'].forEach((h, i) => drawText(ctx, h, cols[i], 52, PAL.c));
      this.list.slice(this.scroll, this.scroll + 14).forEach((pl, i) => {
        const y = this.rowY(i), sel = this.scroll + i === this.index;
        if (sel) { ctx.fillStyle = 'rgba(60,188,252,0.15)'; ctx.fillRect(W / 2 - 214, y - 2, 428, 11); }
        ctx.fillStyle = pl.online ? PAL.G : '#3c3c5c'; ctx.fillRect(cols[0] - 5, y + 2, 3, 3); // online dot
        drawText(ctx, pl.name, cols[0], y, pl.name === Account.DEV ? PAL.y : PAL.w);
        drawText(ctx, ago(pl.created), cols[1], y, PAL.l);
        drawText(ctx, pl.online ? 'ONLINE' : ago(pl.lastSeen), cols[2], y, pl.online ? PAL.G : PAL.l);
        drawText(ctx, this.progress(pl), cols[3], y, pl.done ? PAL.G : PAL.w);
        drawText(ctx, pl.onlyUp ? pl.onlyUp + 'M' : '-', cols[4], y, PAL.C);
      });
      drawText(ctx, 'ENTER / CLICK: MESSAGE THEM', W / 2 - 208, 244, PAL.n);
      drawText(ctx, 'ESC: BACK', W / 2 + 208, 244, PAL.n, 1, 'right');
    },
  };

  // "5M AGO", "3H AGO", "SEP 28"
  function ago(t) {
    if (!t) return '-';
    const s = (Date.now() - t) / 1000;
    if (s < 60) return 'JUST NOW';
    if (s < 3600) return Math.floor(s / 60) + 'M AGO';
    if (s < 86400) return Math.floor(s / 3600) + 'H AGO';
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  }

  // ---------------------------------------------------------------- messages
  // Direct messages between the dev (COLDZEEYT) and players. The server only
  // allows dev <-> player conversations, never player <-> player.
  const MSG_COLS = 54;
  const Chat = {
    enter(name, back) {
      this.with = name; this.back = back || AccountScene; this.msgs = null; this.online = false;
      this.text = ''; this.status = 'LOADING...'; this.t = 0; this.bs = 0; this.sending = false;
      this.load();
    },
    load() {
      Account.conversation(this.with).then((c) => { this.msgs = c.messages; this.online = c.online; this.status = ''; Account.ping(); },
        (e) => { this.status = e.message; });
    },
    send() {
      const text = this.text.trim();
      if (!text || this.sending) return;
      this.sending = true; this.status = 'SENDING...';
      Account.sendMessage(this.with, text).then(() => { this.sending = false; this.text = ''; this.status = ''; Sound.sfx('check'); this.load(); },
        (e) => { this.sending = false; this.status = e.message; Sound.sfx('die'); });
    },
    update() {
      titleUpdate();
      this.t++;
      if (this.t % 300 === 0) this.load(); // check for replies every 5 s
      if (hit('Escape')) { Sound.sfx('select'); setScene(this.back); return; }
      if (IS_TOUCH && Input.mouse.click) {
        const v = prompt('MESSAGE TO ' + this.with);
        Input.down.clear();
        if (v) { this.text = v.toUpperCase().slice(0, 300); this.send(); }
        return;
      }
      let t = this.text;
      for (const ch of Input.typed) { const c = ch.toUpperCase(); if ((c === ' ' || FONT[c]) && t.length < 300) t += c; }
      this.bs = held('Backspace') ? this.bs + 1 : 0;
      if (hit('Backspace') || (this.bs > 24 && this.bs % 3 === 0)) t = t.slice(0, -1);
      this.text = t;
      if (hit('Enter', 'NumpadEnter')) this.send();
    },
    draw() {
      drawTitleBackdrop();
      panel(W / 2 - 200, 8, 400, 254, PAL.C);
      drawTextOutlined(ctx, this.with, W / 2, 16, PAL.C, 2, 'center');
      drawText(ctx, this.online ? 'ONLINE NOW' : 'OFFLINE (THEY WILL SEE IT LATER)', W / 2, 36, this.online ? PAL.G : PAL.m, 1, 'center');
      // messages, newest at the bottom
      const lines = [];
      for (const m of this.msgs || []) {
        const mine = m.from === Account.user;
        lines.push({ text: (mine ? 'YOU' : m.from) + '  ' + ago(m.at), color: mine ? PAL.c : PAL.y, head: true });
        for (const l of wrapNotes(m.text, MSG_COLS)) lines.push({ text: l, color: PAL.w });
      }
      if (this.msgs && !this.msgs.length) drawText(ctx, 'NO MESSAGES YET. SAY HI!', W / 2, 110, PAL.n, 1, 'center');
      lines.slice(-13).forEach((l, i) => drawText(ctx, l.text, W / 2 - 186, 50 + i * 12, l.color));
      // typing box
      ctx.fillStyle = 'rgba(8,6,28,0.9)'; ctx.fillRect(W / 2 - 190, 212, 380, 16);
      ctx.fillStyle = '#342468'; ctx.fillRect(W / 2 - 190, 212, 380, 1); ctx.fillRect(W / 2 - 190, 227, 380, 1);
      const shown = this.text.slice(-60);
      drawText(ctx, shown || (IS_TOUCH ? 'TAP TO WRITE A MESSAGE' : 'TYPE A MESSAGE...'), W / 2 - 186, 216, shown ? PAL.w : PAL.n);
      if (!IS_TOUCH && blink(15)) { ctx.fillStyle = PAL.y; ctx.fillRect(W / 2 - 186 + textWidth(shown) + 1, 223, 5, 1); }
      drawText(ctx, this.status, W / 2 - 186, 236, this.status.endsWith('...') ? PAL.m : PAL.e);
      drawText(ctx, IS_TOUCH ? 'PAUSE: BACK' : 'ENTER: SEND   ESC: BACK', W / 2 + 186, 236, PAL.n, 1, 'right');
      drawText(ctx, 'MESSAGES ARE KEPT ON THE GAME SERVER. BE NICE!', W / 2, 248, '#3c3c5c', 1, 'center');
    },
  };

  // The dev's inbox: every conversation, newest first.
  const Inbox = {
    enter() {
      this.list = null; this.index = 0; this.status = 'LOADING...';
      Account.inbox().then((l) => { this.list = l; this.status = ''; }, (e) => { this.status = e.message; });
    },
    update() {
      titleUpdate();
      if (hit(...K.back)) { Sound.sfx('select'); setScene(AccountScene); return; }
      if (!this.list || !this.list.length) return;
      const n = this.list.length;
      if (hit(...K.down)) this.index = Math.min(n - 1, this.index + 1);
      if (hit(...K.up)) this.index = Math.max(0, this.index - 1);
      const m = Input.mouse;
      let chosen = hit('Enter', 'NumpadEnter', 'Space');
      if (m.moved || m.click) this.list.slice(0, 12).forEach((c, i) => {
        if (m.y < 54 + i * 16 - 3 || m.y > 54 + i * 16 + 11) return;
        this.index = i; if (m.click) chosen = true;
      });
      if (chosen) { Sound.sfx('select'); setScene(Chat, this.list[this.index].with, Inbox); }
    },
    draw() {
      drawTitleBackdrop();
      panel(W / 2 - 200, 8, 400, 254, PAL.C);
      drawTextOutlined(ctx, 'MESSAGES', W / 2, 16, PAL.C, 2, 'center');
      if (!this.list) { drawText(ctx, this.status, W / 2, 120, PAL.m, 1, 'center'); return; }
      if (!this.list.length) drawText(ctx, 'NO MESSAGES YET. PICK SOMEONE IN DEV NOTES > PLAYERS.', W / 2, 110, PAL.n, 1, 'center');
      this.list.slice(0, 12).forEach((c, i) => {
        const y = 54 + i * 16, sel = i === this.index;
        if (sel) { ctx.fillStyle = 'rgba(60,188,252,0.15)'; ctx.fillRect(W / 2 - 190, y - 3, 380, 14); }
        drawText(ctx, c.with + (c.unread ? '  (' + c.unread + ' NEW)' : ''), W / 2 - 184, y, c.unread ? PAL.y : PAL.w);
        drawText(ctx, (c.last.from === Account.user ? 'YOU: ' : '') + c.last.text.slice(0, 28), W / 2 - 40, y, PAL.m);
        drawText(ctx, ago(c.last.at), W / 2 + 184, y, PAL.n, 1, 'right');
      });
      drawText(ctx, 'ENTER: OPEN   ESC: BACK', W / 2, 244, PAL.n, 1, 'center');
    },
  };

  // ---------------------------------------------------------------- stories
  // Story 1 is this game. The rest are slots for future storylines:
  // fill one in (name, about, open: true) when it's ready.
  const STORIES = [
    { name: 'STORY 1: PRECIPICE', about: 'ASH, THE EVERFLAME AND THE WATCHER', open: true },
    { name: 'STORY 2', about: 'A NEW STORYLINE' },
    { name: 'STORY 3', about: 'A NEW STORYLINE' },
    { name: 'STORY 4', about: 'A NEW STORYLINE' },
  ];
  const Stories = {
    enter() { this.index = 0; this.t = 0; this.locked = 0; },
    rowY(i) { return 58 + i * 38; },
    update() {
      titleUpdate();
      this.t++;
      if (this.locked > 0) this.locked--;
      const n = STORIES.length + 1; // + BACK
      if (hit(...K.up)) { this.index = (this.index + n - 1) % n; Sound.sfx('move'); }
      if (hit(...K.down)) { this.index = (this.index + 1) % n; Sound.sfx('move'); }
      if (hit(...K.back)) { Sound.sfx('select'); setScene(Title); return; }
      const m = Input.mouse;
      let chosen = hit(...K.ok);
      if (m.moved || m.click) {
        for (let i = 0; i < n; i++) {
          const y = i < STORIES.length ? this.rowY(i) : 216;
          if (m.y < y - 4 || m.y > y + (i < STORIES.length ? 30 : 12) || Math.abs(m.x - W / 2) > 160) continue;
          if (m.moved && this.index !== i) { this.index = i; Sound.sfx('move'); }
          if (m.click) { this.index = i; chosen = true; }
        }
      }
      if (!chosen) return;
      const st = STORIES[this.index];
      if (!st) { Sound.sfx('select'); setScene(Title); return; }
      if (st.open) { Sound.sfx('select'); setScene(Title); return; } // story 1 is the game you're in
      this.locked = 60;
      Sound.sfx('die');
    },
    draw() {
      drawTitleBackdrop();
      if (!animatedPanel(W / 2 - 170, 8, 340, 250, this.t)) return;
      drawTextOutlined(ctx, 'STORIES', W / 2, 18, PAL.C, 2, 'center');
      STORIES.forEach((st, i) => {
        const y = this.rowY(i), sel = i === this.index;
        const x = W / 2 - 150;
        ctx.fillStyle = sel ? (st.open ? 'rgba(60,188,252,0.18)' : 'rgba(120,120,140,0.18)') : 'rgba(8,6,28,0.6)';
        ctx.fillRect(x, y - 4, 300, 32);
        ctx.fillStyle = sel ? (st.open ? PAL.c : '#7c7c7c') : '#342468';
        ctx.fillRect(x, y - 4, 300, 1); ctx.fillRect(x, y + 27, 300, 1); ctx.fillRect(x, y - 4, 1, 32); ctx.fillRect(x + 299, y - 4, 1, 32);
        if (st.open) {
          drawText(ctx, st.name, x + 12, y + 2, sel ? PAL.c : PAL.w);
          drawText(ctx, st.about, x + 12, y + 14, PAL.m);
          drawText(ctx, 'PLAYING NOW', x + 288, y + 8, PAL.G, 1, 'right');
        } else {
          drawText(ctx, st.name + ': ???', x + 12, y + 2, '#6c6c6c');
          drawText(ctx, st.about, x + 12, y + 14, '#4c4c4c');
          ctx.globalAlpha = 0.55; Play.drawPadlock(x + 272, y + 5); ctx.globalAlpha = 1;
          drawText(ctx, 'COMING SOON', x + 262, y + 8, '#6c6c6c', 1, 'right');
        }
      });
      const bs = this.index === STORIES.length;
      drawText(ctx, (bs ? '> ' : '') + 'BACK' + (bs ? ' <' : ''), W / 2, 216, bs ? PAL.c : '#b8c4f0', 1, 'center');
      if (this.locked > 0) drawTextOutlined(ctx, 'NOT YET! THIS STORY IS STILL BEING WRITTEN.', W / 2, 236, PAL.y, 1, 'center');
    },
  };

  // ---------------------------------------------------------------- backstory
  const STORY = [
    { text: 'THEY SAY THAT AT THE TOP OF MOUNT PRECIPICE\nBURNS THE EVERFLAME:\nA FIRE THAT GRANTS A SINGLE WISH.' },
    { text: 'YEARS AGO, A CLIMBER NAMED ASH\nSET OUT TO FIND IT.\nASH NEVER CAME BACK DOWN.' },
    { text: "LAST NIGHT, AT THE FOOT OF THE CLIFFS,\nYOU FOUND ASH'S RED CAP.\nIT FIT YOU PERFECTLY." },
    { text: 'NOW YOU CLIMB.\nBUT SOMETHING UP THERE IS WAITING...\nAND IT KNOWS YOUR FACE.' },
    { title: 'YOUR OBJECTIVE', text: "REACH THE SUMMIT AND FIND THE EVERFLAME.\nGATHER EMBERS ALONG THE WAY.\nFIND ASH'S MEMORIES TO LEARN THE TRUTH." },
  ];
  const TYPE_SPEED = 0.8; // characters per frame

  const Story = {
    enter(run) { this.page = 0; this.t = 0; this.run = run; },
    update() {
      this.t++;
      if (hit('Escape')) { Sound.sfx('select'); setScene(ChapterIntro, 0, this.run); return; }
      if (hit(...K.ok) || Input.mouse.click) {
        const len = STORY[this.page].text.length;
        if ((this.t - 8) * TYPE_SPEED < len) { this.t = Math.ceil(len / TYPE_SPEED) + 8; return; }
        this.page++;
        this.t = 0;
        if (this.page >= STORY.length) { Sound.sfx('select'); setScene(ChapterIntro, 0, this.run); } else Sound.sfx('move');
      }
    },
    draw() {
      drawBackground(ctx, frame * 0.1, frame);
      // Mount Precipice, with the Everflame burning at its peak.
      const peakX = W / 2, peakY = 40;
      for (let x = peakX - 200; x <= peakX + 200; x += 3) {
        const top = Math.round((peakY + Math.abs(x - peakX) * 0.9 + (decoRoll(x, 5) % 4)) / 3) * 3;
        ctx.fillStyle = '#120a30';
        ctx.fillRect(x, top, 3, H - top);
        if (top < peakY + 34) {
          ctx.fillStyle = '#6c5cac';
          ctx.fillRect(x, top, 3, Math.min(6, peakY + 34 - top));
        }
      }
      // stepped round glow that pulses
      const glow = 9 + Math.round(Math.sin(frame / 10) * 2);
      for (const [r, a] of [[glow + 8, 0.1], [glow + 2, 0.2], [glow - 4, 0.35]]) {
        ctx.fillStyle = 'rgba(252,152,56,' + a + ')';
        for (let j = -r; j <= r; j++) {
          const half = Math.floor(Math.sqrt(r * r - j * j));
          ctx.fillRect(peakX - half, peakY - 5 + j, half * 2 + 1, 1);
        }
      }
      for (let i = 0; i < 28; i++) {
        const h = decoRoll(frame >> 2, i + 20) % 13;
        const spread = Math.max(1, 5 - (h >> 1));
        const fx = peakX + ((decoRoll(frame >> 2, i) % (spread * 2 + 1)) - spread);
        const fy = peakY - 1 - h;
        ctx.fillStyle = i % 3 === 0 ? PAL.w : i % 3 === 1 ? PAL.y : '#fc9838';
        ctx.fillRect(fx, fy, 1, 1);
      }

      const page = STORY[this.page];
      if (!page) return;
      const lines = page.text.split('\n');
      if (!animatedPanel(W / 2 - 170, 176, 340, 80, this.t, page.title ? PAL.y : '#fcfcfc')) return;
      let ty = 186;
      if (page.title) { drawText(ctx, page.title, W / 2, ty, PAL.y, 1, 'center'); ty += 14; }
      let budget = Math.floor((this.t - 8) * TYPE_SPEED);
      lines.forEach((l, i) => {
        drawText(ctx, l.slice(0, Math.max(0, budget)), W / 2 - textWidth(l) / 2, ty + i * 12, PAL.w);
        budget -= l.length;
      });
      drawText(ctx, 'ESC: SKIP', W / 2 - 160, 244, PAL.n);
      drawText(ctx, (this.page + 1) + '/' + STORY.length, W / 2, 244, PAL.n, 1, 'center');
      if (budget >= 0 && blink(20)) drawText(ctx, 'ENTER >', W / 2 + 162, 244, PAL.y, 1, 'right');
    },
  };

  // ---------------------------------------------------------------- guide
  // Icons reuse the in-game drawing code; (x, y) is the icon's centre.
  const at = (x, y) => ({ x: (x - 8) / T, y: (y - 8) / T });
  const ICONS = {
    ember: (x, y) => Play.drawEmber(at(x, y)),
    fragment: (x, y) => ctx.drawImage(FRAGMENT_SPR, x - 6, y - 7),
    checkpoint: (x, y) => ctx.drawImage(CHECKPOINT_SPR.on, x - 8, y - 14),
    crystal: (x, y) => Play.drawCrystal(Object.assign(at(x, y), { gone: 0 })),
    spring: (x, y) => Play.drawSpring(Object.assign(at(x, y - 4), { t: 0 })),
    crumble: (x, y) => ctx.drawImage(TILES.crumble, x - 8, y - 8),
    mover: (x, y) => Play.drawMover({ x: x - 16, y: y - 4, w: 32, h: 8 }),
    spikes: (x, y) => ctx.drawImage(TILES.spike, x - 8, y - 12),
    ice: (x, y) => ctx.drawImage(TILES.ice, x - 8, y - 8),
    saw: (x, y) => Play.drawSaw(x, y),
    key: (x, y) => Play.drawKey(x, y),
    gate: (x, y) => { Play.drawGateTile(x - 8, y - 8, true, true); },
    orb: (x, y) => Play.drawOrb(x, y),
    blocks: (x, y) => { Play.drawSwitchBlock(x - 16, y - 8, 'B', true); Play.drawSwitchBlock(x, y - 8, 'B', false); },
    // cycles cool -> smoke -> fire so the icon shows what a vent does
    vent: (x, y) => {
      ctx.save();
      ctx.beginPath(); ctx.rect(x - 12, y - 12, 24, 23); ctx.clip(); // keep the flames inside the icon's space
      Play.drawVent({ x: (x - 8) / T, y: (y + 10) / T, phase: ((60 + (frame % 140)) - (Play.hz || 0) % 200 + 400) % 200 });
      ctx.restore();
    },
    ladder: (x, y) => ctx.drawImage(TILES.ladder, x - 8, y - 8),
    thru: (x, y) => { Play.drawThru(x - 16, y - 3, true, false); Play.drawThru(x, y - 3, false, true); },
    wind: (x, y) => {
      ctx.fillStyle = '#dce6fc';
      [[-9, -4, 14], [-6, 0, 16], [-10, 4, 12]].forEach(([dx, dy, w]) => ctx.fillRect(x + dx, y + dy, w, 1));
      drawText(ctx, '<', x - 12, y - 3, '#dce6fc');
    },
  };
  const GUIDE = [
    { title: 'YOUR GOAL', text: [
      'REACH THE FLAG AT THE END OF EACH STAGE. THERE ARE',
      '5 CHAPTERS OF 10 STAGES, AND THE EVERFLAME WAITS',
      'AT THE VERY TOP OF THE LAST ONE.',
      '',
      'FALLING OFF A PRECIPICE OR TOUCHING SPIKES',
      'SENDS YOU BACK TO YOUR LAST CHECKPOINT.',
      '',
      'YOU HAVE 3 SAVE SLOTS. CHECKPOINTS AND FINISHED',
      'STAGES SAVE AUTOMATICALLY. USE CONTINUE OR LOAD',
      'GAME TO CARRY ON LATER.',
      'BEAT THE FINAL BOSS TO UNLOCK ACT II.',
    ] },
    { title: 'COLLECTABLES', items: [
      ['ember', 'EMBERS', 'SPARKS OF THE EVERFLAME. OPTIONAL, AND OFTEN', 'TUCKED AWAY IN HARD-TO-REACH SPOTS.'],
      ['fragment', 'MEMORY FRAGMENTS', "GLOWING RUNE STONES HOLDING PAGES OF ASH'S", 'DIARY. FIND THEM ALL TO LEARN THE TRUTH.'],
    ] },
    { title: 'THE MOUNTAIN', items: [
      ['checkpoint', 'CHECKPOINTS', 'RESPAWN HERE AND SAVE YOUR PROGRESS.'],
      ['crystal', 'DASH CRYSTALS', 'REFILL YOUR DASH IN MID-AIR.'],
      ['spring', 'SPRINGS', 'LAUNCH YOU SKY HIGH AND REFILL YOUR DASH.'],
      ['mover', 'MOVING PLATFORMS', 'RIDE THEM ACROSS WIDE GAPS.'],
      ['ladder', 'LADDERS', 'HOLD UP OR DOWN TO CLIMB. JUMP TO HOP OFF.'],
      ['thru', 'WOODEN PLATFORMS', 'JUMP UP THROUGH THEM AND LAND ON TOP.', 'PRESS DOWN TO DROP BACK THROUGH.'],
    ] },
    { title: 'PUZZLES', items: [
      ['key', 'KEYS', 'OFTEN TUCKED AWAY UP A LADDER OR ON A LEDGE.', 'LOOK AROUND BEFORE YOU RUSH AHEAD.'],
      ['gate', 'LOCKED GATES', 'WALK INTO ONE WITH A KEY TO OPEN IT.', "TOO TALL TO JUMP, AND YOU CAN'T CLIMB THEM."],
      ['orb', 'SWITCH ORBS', 'JUMP INTO ONE TO FLIP THE BLUE BLOCKS.', 'THE ORB SHOWS THE COLOUR IT WILL TURN ON.'],
      ['blocks', 'BLUE BLOCKS', 'SOLID OR GHOSTLY, DEPENDING ON THE ORBS.', 'THINK: WHICH ORDER GETS YOU THROUGH?'],
    ] },
    { title: 'HAZARDS', items: [
      ['spikes', 'SPIKES', 'DEADLY TO THE TOUCH. JUMP OVER THEM.'],
      ['crumble', 'CRUMBLING BLOCKS', 'FALL AWAY SOON AFTER YOU LAND ON THEM.'],
      ['wind', 'WIND (CHAPTER 3+)', 'GUSTS PUSH YOU BACK. WAIT FOR THE CALM.'],
      ['ice', 'ICE (CHAPTER 4+)', 'SLIPPERY! RUN, THEN LET GO TO SLIDE.'],
      ['saw', 'SAW BLADES (CHAPTER 2+)', 'ROLL BACK AND FORTH. JUMP OVER THEM.'],
      ['vent', 'FIRE VENTS (CHAPTER 3+)', 'SMOKE MEANS FIRE IS COMING. WAIT IT OUT.'],
    ] },
    { title: 'CONTROLS', text: () => {
      const k = (a) => keysFor(a).map(keyName).join(' / ');
      return [
        'MOVE LEFT ....... ' + k('left'),
        'MOVE RIGHT ...... ' + k('right'),
        'UP / DOWN ....... ' + k('up') + '  |  ' + k('down'),
        'JUMP ............ ' + k('jump') + '  (HOLD = HIGHER)',
        'DASH ............ ' + k('dash') + '  (AIM WITH ARROWS)',
        'PAUSE ........... ' + k('pause'),
        'LADDERS ......... HOLD UP / DOWN TO CLIMB',
        'WALLS ........... JUMP OFF THEM TO CLIMB',
        'F11 ............. FULLSCREEN (DESKTOP APP)',
        'CHANGE KEYS IN SETTINGS > CONTROLS',
      ];
    } },
  ];

  // How far any save has got (Infinity = the game has been finished).
  function storyReached(stage) {
    for (let i = 0; i <= Slots.HARDCORE; i++) {
      const d = Slots.load(i);
      if (d && (d.done || (stage !== Infinity && d.stage >= stage))) return true;
    }
    return false;
  }
  // A lore page that shows as ??? until the story gets there.
  function secretPage(title, unlocked, text) {
    return {
      title: () => (unlocked() ? title : '???'),
      text: () => (unlocked() ? text : ['THIS PAGE OF THE STORY IS STILL HIDDEN.', '', 'KEEP CLIMBING...']),
    };
  }

  const LORE = [
    { title: 'MOUNT PRECIPICE', text: [
      'MOUNT PRECIPICE RISES ABOVE THE CLOUDS, SO TALL',
      'THAT NO MAP HAS EVER SHOWN ITS PEAK. ITS CLIFFS',
      'ARE STEEP, ITS STORMS ARE CRUEL, AND ITS PATHS',
      'SEEM TO SHIFT WHEN NO ONE IS LOOKING.',
      '',
      'AT THE VERY TOP BURNS THE EVERFLAME. LEGEND SAYS',
      'ANYONE WHO REACHES IT MAY MAKE ONE WISH, BUT NO',
      'ONE WHO HAS CLIMBED FOR IT HAS EVER RETURNED.',
    ] },
    { title: 'ASH', text: [
      'ASH WAS THE BRAVEST CLIMBER THE VALLEY EVER KNEW.',
      'ASH WORE A RED CAP, CARRIED A NOTEBOOK, AND SPOKE',
      'OF THE EVERFLAME AS IF IT WERE CALLING.',
      '',
      'ONE WINTER MORNING ASH SET OFF ALONE. FOR DAYS A',
      'SMALL LIGHT COULD BE SEEN MOVING UP THE CLIFFS.',
      'THEN ONE NIGHT THE LIGHT WENT OUT.',
      'ONLY THE RED CAP EVER CAME BACK DOWN.',
    ] },
    { title: 'MEMORY FRAGMENTS', text: [
      'AS ASH CLIMBED, ASH WROTE. PAGES OF THAT DIARY',
      'ARE CARVED INTO STONES ALONG THE WAY, BY ASH OR',
      'BY SOMETHING ELSE. EACH FRAGMENT GLOWS VIOLET AND',
      'HOLDS A FEW WORDS FROM THE CLIMB.',
      '',
      'READ TOGETHER, THEY TELL WHAT REALLY HAPPENED ON',
      'THE MOUNTAIN. SOME ARE HIDDEN OFF THE BEATEN PATH.',
      'FIND THEM ALL IF YOU WANT THE TRUTH.',
    ] },
    { title: 'THE WATCHER', text: [
      'A SHAPE STANDS ON THE CLIFFS AHEAD OF YOU. IT HAS',
      'YOUR OUTLINE, YOUR CAP, AND TWO RED EYES.',
      'WHEN YOU COME CLOSE IT FADES AWAY, LEAVING ONLY A',
      'WHISPER ON THE WIND.',
      '',
      "ASH'S DIARY SPEAKS OF A SHADOW THAT FOLLOWED THE",
      "CLIMB AND WORE ASH'S FACE. NOW IT WEARS YOURS.",
    ] },
    { title: 'YOU', text: [
      "YOU FOUND ASH'S CAP AT THE FOOT OF THE CLIFFS, AND",
      'IT FIT AS IF IT HAD BEEN MADE FOR YOU.',
      '',
      'YOUR OBJECTIVE: CLIMB MOUNT PRECIPICE AND REACH',
      'THE EVERFLAME. GATHER ITS EMBERS ALONG THE WAY,',
      "FIND ASH'S MEMORY FRAGMENTS, AND LEARN WHAT THE",
      'WATCHER WANTS BEFORE YOU REACH THE TOP.',
    ] },
    // Wren's pages give away the endings, so they stay hidden until a save gets there.
    secretPage('WREN, THE FIRST CLIMBER', () => storyReached(ACT2_START), [
      'LONG BEFORE ASH, BEFORE THE VALLEY HAD A NAME,',
      'A CLIMBER CALLED WREN REACHED THE EVERFLAME FIRST.',
      '',
      'WREN FEARED ONE THING ABOVE ALL: BEING FORGOTTEN.',
      'SO WREN WISHED NEVER TO BE FORGOTTEN.',
      '',
      'THE FLAME GRANTED IT IN THE CRUELLEST WAY. WREN',
      'BURNED BLACK AND HOLLOW, AND THE MOUNTAIN BEGAN TO',
      'KEEP EVERY CLIMBER WHO CAME, SO THAT SOMEONE WOULD',
      'ALWAYS BE THERE TO REMEMBER.',
    ]),
    secretPage('THE BLACK FLAME', () => storyReached(ACT2_START), [
      'ON THE FAR SIDE OF THE SUMMIT BURNS A SECOND FIRE,',
      "BLACK AND COLD. IT IS WHAT WREN'S WISH BECAME.",
      '',
      'EVERY CLIMBER WHO WISHED FOR THEMSELVES WAS PULLED',
      'INTO IT, AND CAME OUT AS A SHADOW: A WATCHER.',
      '',
      'AT ITS HEART SITS THE HOLLOW: WREN, A THOUSAND',
      'YEARS LATER, WITH NO NAME LEFT, GUARDING THE ONE',
      'THING IT STILL HAS. ONLY A GIFT, GIVEN FREELY AND',
      'NOT TAKEN, CAN PUT IT OUT.',
    ]),
    secretPage('REMEMBERED', () => storyReached(Infinity), [
      'THE BLACK FLAME IS OUT. THE LOST CLIMBERS WALKED',
      'DOWN THE MOUNTAIN AS LIGHT, AND WREN WENT WITH THEM.',
      '',
      'FOR THE FIRST TIME IN A THOUSAND YEARS, WREN IS',
      'REMEMBERED: NOT BECAUSE OF A WISH, BUT BECAUSE',
      'SOMEONE CLIMBED ALL THAT WAY TO BRING WREN HOME.',
      '',
      '"MY NAME WAS WREN. THANK YOU FOR BRINGING ME HOME."',
    ]),
  ];

  // A flip-through book of pages (used by GUIDE and LORE).
  function makeBook(pages, back = () => Title) {
    return {
      enter() { this.page = 0; },
      update() {
        titleUpdate();
        const n = pages.length;
        const next = hit(...K.right);
        if (next || hit(...K.ok) || Input.mouse.click) {
          if (this.page === n - 1 && !next) { Sound.sfx('select'); setScene(back()); return; }
          if (this.page < n - 1) { this.page++; Sound.sfx('move'); }
        }
        if (hit(...K.left) && this.page > 0) { this.page--; Sound.sfx('move'); }
        if (hit(...K.back)) { Sound.sfx('select'); setScene(back()); }
      },
      draw() {
        drawTitleBackdrop();
        const page = pages[this.page];
        panel(W / 2 - 190, 20, 380, 232);
        drawTextOutlined(ctx, typeof page.title === 'function' ? page.title() : page.title, W / 2, 32, PAL.C, 2, 'center');
        const text = typeof page.text === 'function' ? page.text() : page.text;
        if (text) {
          text.forEach((l, i) => drawText(ctx, l, W / 2 - 170, 62 + i * 13, PAL.w));
        } else {
          // each entry takes the room its text needs, so two-line entries never overlap
          let y = 62;
          const pad = page.items.length > 5 ? 6 : page.items.length > 3 ? 10 : 20;
          for (const [icon, head, ...lines] of page.items) {
            ICONS[icon](W / 2 - 156, y + 4 + lines.length * 5);
            drawText(ctx, head, W / 2 - 132, y, PAL.c);
            lines.forEach((l, i) => drawText(ctx, l, W / 2 - 132, y + 11 + i * 10, PAL.w));
            y += 11 + lines.length * 10 + pad;
          }
        }
        const n = pages.length;
        drawText(ctx, (this.page > 0 ? '< ' : '  ') + (this.page + 1) + '/' + n + (this.page < n - 1 ? ' >' : '  '), W / 2, 236, PAL.C, 1, 'center');
        drawText(ctx, 'A/D: PAGE', W / 2 - 176, 236, PAL.n);
        drawText(ctx, 'ESC: BACK', W / 2 + 176, 236, PAL.n, 1, 'right');
      },
    };
  }
  const Guide = makeBook(GUIDE);
  const Lore = makeBook(LORE);

  // What became of everyone (end of the credits roll).
  const EPILOGUE = [
    ['THE WATCHER KNEW YOUR FACE BECAUSE YOU WORE IT:', "ASH'S CAP, ASH'S CLIMB."],
    ['LONG BEFORE ASH, WREN, THE FIRST CLIMBER,', 'WISHED NEVER TO BE FORGOTTEN, AND THE BLACK FLAME', 'MADE SURE NO ONE WHO CLIMBED COULD EVER LEAVE.'],
    ['NOW THE LOST CLIMBERS HAVE WALKED DOWN THE', 'MOUNTAIN AS LIGHT, AND THEY ARE REMEMBERED.'],
    ['THE EVERFLAME STILL BURNS AT THE SUMMIT,', 'BUT IT GRANTS NOTHING NOW EXCEPT WARMTH.'],
    ["ASH'S DIARY WAS FINISHED AT LAST,", "AND THE RED CAP HANGS BY ASH'S DOOR."],
    ['ASH WENT HOME, AND SOME NIGHTS A CAMPFIRE BURNS', 'AT THE FOOT OF MOUNT PRECIPICE, WAITING FOR THE', 'NEXT CLIMBER TO COME BACK DOWN.'],
  ];

  // Scrolling credits and thanks, after the true ending (Act II).
  const CreditsRoll = {
    enter(run) {
      this.run = run;
      this.y = H + 10; // top of the roll, scrolling up
      const L = [];
      const add = (text, color, scale = 1, gap = 12) => L.push({ text, color, scale, gap });
      add('PRECIPICE', PAL.C, 3, 40);
      add('A GAME BY ColdzeeYT', PAL.w, 1, 36);
      for (const [head, ...names] of CREDITS_ROWS) {
        add(head, PAL.c, 1, 12);
        names.forEach((n, i) => add(n, PAL.w, 1, i === names.length - 1 ? 28 : 12));
      }
      add('SPECIAL THANKS', PAL.y, 2, 26);
      add('CELESTE', PAL.w, 1, 14);
      add('GEOMETRY DASH (PLATFORMER MODE)', PAL.w, 1, 14);
      add('NEWGROUNDS', PAL.w, 1, 40);
      add('A NOTE FROM THE DEV', PAL.y, 2, 26);
      add('HOLY CRAP YOU PLAYED MY GAME!?!? WOW.', PAL.w, 1, 14);
      add('I HOPE YOU ENJOYED AND GG.', PAL.w, 1, 16);
      add('- ColdzeeYT', PAL.C, 1, 60);
      add('EPILOGUE', PAL.V, 2, 26);
      for (const para of EPILOGUE) {
        para.forEach((line, i) => add(line, PAL.w, 1, i === para.length - 1 ? 24 : 12));
      }
      L[L.length - 1].gap = 70;
      add('THANKS FOR PLAYING', PAL.y, 2, 0);
      this.lines = L;
      this.height = L.reduce((h, l) => h + l.gap, 0);
      this.done = false;
      this.t = 0;
      this.speed = 0;
      Sound.playCredits();
    },
    finish() {
      Sound.fadeOutCredits(1200);
      Sound.sfx('select');
      if (this.run) setScene(Ending, this.run, true); else setScene(Title);
    },
    update() {
      this.t++;
      if (hit('Escape')) { this.finish(); return; }
      // the last line stops in the middle of the screen
      const stop = H / 2 - 8 - this.height;
      // Timed to the song: the roll finishes with ~16 seconds of music left for Ash's scene.
      const song = Sound.creditsTime();
      if (!this.speed && song.d > 30) this.speed = Math.min(0.6, Math.max(0.2, (this.y - stop) / ((song.d - 16 - song.t) * 60)));
      const speed = Input.down.size > 0 ? 2 : this.speed || 0.35; // hold any key or button to speed up
      if (song.d && song.d - song.t < 4) Sound.fadeOutCredits(3800); // fade out over the last notes
      if (this.y > stop) this.y = Math.max(stop, this.y - speed);
      else if (!this.done) { this.done = true; this.t = 0; }
      if (this.done) this.y -= Math.min(1, this.t / 90) * 0.9; // as Ash walks in, the words drift up and away
      if (this.done && this.t > 300 && (hit(...K.ok) || Input.mouse.click)) this.finish(); // let Ash's scene play
    },
    draw() {
      drawBackground(ctx, frame * 0.15, frame);
      ctx.fillStyle = 'rgba(8,6,28,0.55)';
      ctx.fillRect(0, 0, W, H);
      let y = this.y;
      for (const l of this.lines) {
        if (y > -30 && y < H + 10) drawTextOutlined(ctx, l.text, W / 2, Math.round(y), l.color, l.scale, 'center');
        y += l.gap;
      }
      if (this.done) {
        this.drawAsh();
        if (this.t > 300 && blink(20)) drawText(ctx, 'PRESS ENTER', W - 8, 6, PAL.m, 1, 'right');
      } else drawText(ctx, 'HOLD ANY KEY: FASTER   ESC: SKIP', W - 8, 6, PAL.n, 1, 'right');
    },

    // After the credits: Ash, home at last, walks up to a campfire, warms up and waves.
    drawAsh() {
      const t = this.t, gy = H - 34; // ground line
      ctx.globalAlpha = Math.min(1, t / 40);
      // grassy ground in the game's own tiles, with a few trees, bushes and flowers
      for (let tx = 0; tx * T < W; tx++) for (let r = 0; r < 3; r++) drawGround(tx * T, gy + r * T, tx, r, (x, y) => y >= 0);
      if (Config.g.deco) {
        ctx.drawImage(DECO.pine, 28, gy - 25);
        ctx.drawImage(DECO.pine, 50, gy - 25);
        ctx.drawImage(DECO.bush, 96, gy - 6);
        ctx.drawImage(DECO.pine, W - 70, gy - 25);
        ctx.drawImage(DECO.bush, W - 118, gy - 6);
        ctx.drawImage(DECO.rock, W / 2 + 70, gy - 3);
        for (let x = 6; x < W; x += 13 + (decoRoll(x, 7) % 17)) {
          if (Math.abs(x - (W / 2 - 20)) < 22) continue; // not in the fire
          const pick = decoRoll(x, 8) % 4;
          if (pick === 0) ctx.drawImage(DECO.flowers[decoRoll(x, 9) % DECO.flowers.length], x, gy - 4);
          else ctx.drawImage(DECO.tuft, x, gy - 3);
        }
      }
      // campfire: logs, stepped glow, flickering flames
      const fx = W / 2 - 20;
      const glow = 14 + Math.round(Math.sin(frame / 9) * 2);
      for (const [r, al] of [[glow + 10, 0.08], [glow + 4, 0.14], [glow - 3, 0.22]]) {
        ctx.fillStyle = 'rgba(252,152,56,' + al + ')';
        for (let j = -r; j <= 0; j++) { const h = Math.floor(Math.sqrt(r * r - j * j)); ctx.fillRect(fx - h, gy + j, h * 2 + 1, 1); }
      }
      ctx.fillStyle = '#503000'; ctx.fillRect(fx - 7, gy - 3, 14, 3);
      ctx.fillStyle = '#7c5000'; ctx.fillRect(fx - 5, gy - 5, 10, 2);
      for (let i = 0; i < 18; i++) {
        const h = decoRoll(frame >> 2, i + 40) % 11;
        const spread = Math.max(1, 5 - (h >> 1));
        ctx.fillStyle = i % 3 === 0 ? PAL.w : i % 3 === 1 ? PAL.y : '#fc9838';
        ctx.fillRect(fx + (decoRoll(frame >> 2, i + 70) % (spread * 2 + 1)) - spread, gy - 6 - h, 1, 1);
      }
      // Ash walks in from the right, stops by the fire, turns to wave, then back to the fire
      const stopX = fx + 14, speed = 1.2;
      const x = Math.max(stopX, W + 10 - t * speed);
      const walking = x > stopX;
      const since = t - (W + 10 - stopX) / speed; // frames since Ash reached the fire
      const waving = !walking && since > 60 && since < 200;
      const spr = PLAYER_SPR.dash[walking ? ((t >> 3) % 2 ? 'walk1' : 'walk2') : 'idle'][waving ? 'right' : 'left'];
      const ax = Math.round(x), ay = gy - spr.height;
      ctx.drawImage(spr, ax, ay);
      if (waving) {
        const up = (since >> 3) % 2;
        ctx.fillStyle = '#fcbcb0'; ctx.fillRect(ax + 11, ay + 3 - up * 2, 2, 2);
        ctx.fillStyle = '#d82800'; ctx.fillRect(ax + 11, ay + 5 - up * 2, 2, 3);
      }
      if (!walking && since > 90) {
        ctx.globalAlpha = Math.min(1, (since - 90) / 40);
        drawTextOutlined(ctx, 'ASH MADE IT HOME, TOO.', W / 2, 110, PAL.V, 2, 'center');
      }
      ctx.globalAlpha = 1;
    },
  };

  // What's new, newest first (Credits > Changelog).
  const CHANGELOG = [
    { title: 'UPDATE 1.9', text: [
      'ONLY UP, NOTES & MESSAGES', '',
      '- ONLY UP (IN MORE): ONE HUGE TOWER, NO',
      '  CHECKPOINTS. HOW HIGH CAN YOU GET?',
      '- DEV NOTES (TOP LEFT): NEWS FROM ColdzeeYT',
      '- MESSAGE THE DEV: ACCOUNT > MESSAGE COLDZEEYT',
      '- CHECK FOR UPDATES IN SETTINGS (WINDOWS APP)',
      '- THE UPDATE POPUP IS IN THE GAME\'S OWN STYLE',
      '- THE VERSION NUMBER SHOWS ON THE TITLE SCREEN',
    ] },
    { title: 'UPDATE 1.8', text: [
      'STORIES & UPDATES', '',
      '- STORIES BUTTON AT THE TOP OF THE TITLE SCREEN:',
      '  MORE STORYLINES ARE COMING',
      '- THE WINDOWS APP NOW UPDATES ITSELF',
      '- NEW APP ICON: ASH IN THE RED CAP',
      '- LORE: THREE NEW PAGES ABOUT WREN (NO SPOILERS:',
      '  THEY UNLOCK AS YOU PLAY)',
      '- FIXED THE PUZZLES AND HAZARDS GUIDE PAGES',
      '- ??? (TRY WAITING ON THE TITLE SCREEN)',
      '- QUOTATION MARKS SHOW UP IN THE STORY TEXT',
    ] },
    { title: 'UPDATE 1.7', text: [
      'THE CREDITS ROLL', '',
      '- SCROLLING CREDITS AND THANKS AFTER',
      '  THE TRUE ENDING, WITH A NOTE FROM THE DEV',
      '- AN EPILOGUE, THEN A LITTLE SCENE WITH ASH',
      '- CREDITS SONG: THIS SHOULD BE IN A VIDEO GAME',
      '  BY PIANOMATIONS',
      '- ENDING THEME: I MADE THIS AND THEN CRIED',
      '  UNTIL 3 AM BY DISAPPIERCING',
      '- THE CHANGELOG MOVED INTO CREDITS',
      '- EVERY UPDATE IS IN THE CHANGELOG NOW',
    ] },
    { title: 'UPDATE 1.6', text: [
      'PLATFORMS & ACCOUNTS', '',
      '- ACCOUNTS: SIGN UP, LOG IN, AND SAVE OR LOAD',
      '  YOUR GAME ON ANY DEVICE (BOTTOM LEFT)',
      '- NEW: WOODEN PLATFORMS YOU CAN JUMP UP THROUGH',
      '- MULTIPLAYER MOVED INTO MORE (BOTTOM RIGHT)',
      '- GRAPHICS: BARE BONES UP TO FULL DETAIL',
      '- NICER LOCKED GATES AND PADLOCKS',
      '- TOUCH BUTTONS MOVED TO THE SIDES',
      '- PHONES AND TABLETS: THE GAME FILLS THE SCREEN,',
      '  AND YOU CAN TYPE ROOM CODES AND NAMES',
      '- THE WEB VERSION UPDATES STRAIGHT AWAY',
      '- THIS CHANGELOG!',
    ] },
    { title: 'UPDATE 1.5', text: [
      'TALLER CLIMBS', '',
      '- LADDERS AND SLIPPERY ICE',
      '- ARROW KEYS, AND A CONTROLS TAB TO CHANGE KEYS',
      '- ONLINE MULTIPLAYER: RACE FRIENDS IN ROOMS',
      '- NEW HAZARDS: SAW BLADES AND FIRE VENTS',
      '- PUZZLES: KEYS, LOCKED GATES AND SWITCH ORBS',
      '- LONGER, TALLER STAGES WITH CLIMBING TOWERS',
      '- ANIMATED TEXT BOXES',
      '- 8-BIT TOUCH BUTTONS',
      '- PLAYTESTERS IN THE CREDITS',
    ] },
    { title: 'UPDATE 1.4', text: [
      'THE LONG CLIMB', '',
      '- 10 CHAPTERS AND 100 STAGES (ABOUT 5 HOURS)',
      '- 3 SAVE SLOTS WITH CONTINUE AND LOAD GAME',
      '- BOSS FIGHT: THE WATCHER',
      '- ACT II: 50 MORE STAGES, THE HOLLOW,',
      '  AND THE TRUE ENDING',
      '- HARDCORE MODE: NO CHECKPOINTS',
      '- EASIER FIRST CHAPTER',
    ] },
    { title: 'UPDATE 1.3', text: [
      'THE MOUNTAIN OPENS UP', '',
      '- CHECKPOINTS',
      '- GUIDE AND LORE BOOKS',
      '- RESOLUTIONS AND GRAPHICS PRESETS',
      '- PLAY ON PHONES WITH ON-SCREEN BUTTONS',
      '- ANDROID APP AND A ONE-FILE WINDOWS EXE',
      '- MORE BUTTON ON THE TITLE SCREEN',
      '- EASIER TUTORIAL DASH SECTION',
    ] },
    { title: 'UPDATE 1.2', text: [
      'THE STORM', '',
      '- A STORMY TITLE SCREEN WITH RAIN AND LIGHTNING',
      '- NEW BLUE LOGO',
      '- THE BACKSTORY: ASH AND THE EVERFLAME',
      '- AN OBJECTIVE: REACH THE SUMMIT',
      '- NICER TREES, BUSHES AND FLOWERS',
      '- NEW ICON: THE MEMORY FRAGMENT',
      '- LOWER JUMP',
      '- DESKTOP APP FIX AND A LOADING SPINNER',
    ] },
    { title: 'UPDATE 1.1', text: [
      'SOMETHING IS WATCHING', '',
      '- DASH, WALL SLIDE, WALL JUMP AND CLIMBING',
      '- DASH CRYSTALS, SPRINGS, CRUMBLING BLOCKS',
      '  AND MOVING PLATFORMS',
      "- MEMORY FRAGMENTS: PAGES OF ASH'S DIARY",
      '- THE WATCHER, A SHADOW THAT FOLLOWS YOU',
      '- WIDESCREEN 1920 X 1080',
      '- CREDITS SCREEN',
    ] },
    { title: 'UPDATE 1.0', text: [
      'FIRST STEPS', '',
      '- PRECIPICE IS BORN: RUN AND JUMP',
      '- 8-BIT GRAPHICS AND A PIXEL FONT',
      '- TITLE SCREEN WITH NEW GAME AND SETTINGS',
      '- THE TUTORIAL',
      '- MUSIC: SILVER HAND MAN BY VIRAXOR',
    ] },
  ];
  const Changelog = makeBook(CHANGELOG, () => Credits);

  // Settings: resolution, fullscreen, graphics preset and volume (saved).
  function isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function toggleFullscreen() {
    try {
      if (isFullscreen()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else {
        const el = document.documentElement;
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        const r = req && req.call(el);
        if (r && r.catch) r.catch(() => {});
      }
    } catch (e) { /* not allowed here */ }
  }
  function applyVolumes() {
    Sound.musicVolume = 0.55 * (Config.music / 10);
    if (Sound.music && !Sound.music.paused) Sound.music.volume = Sound.musicVolume;
  }

  const Settings = {
    // "updates" only in the Windows app (the web version always loads the newest files)
    get rows() { return window.precipiceApp ? ['res', 'full', 'gfx', 'music', 'sfx', 'controls', 'updates', 'back'] : ['res', 'full', 'gfx', 'music', 'sfx', 'controls', 'back']; },
    enter() { this.index = 0; },
    change(row, dir) {
      if (row === 'res') Config.res = (Config.res + dir + RESOLUTIONS.length) % RESOLUTIONS.length;
      else if (row === 'gfx') Config.gfx = clamp(Config.gfx + dir, 0, GFX_LEVELS.length - 1);
      else if (row === 'music') { Config.music = clamp(Config.music + dir, 0, 10); applyVolumes(); }
      else if (row === 'sfx') Config.sfx = clamp(Config.sfx + dir, 0, 10);
      else if (row === 'full') toggleFullscreen();
      else return;
      Config.save();
      Sound.sfx('move');
    },
    rowY(i) { return 60 + i * (this.rows.length > 7 ? 21 : 24); },
    checkUpdates() {
      Sound.sfx('select');
      const st = UpdateBox.st;
      if (st && st.state === 'ready') { UpdateBox.done = false; UpdateBox.shown = false; return; } // show the box again
      window.precipiceApp.checkNow();
    },
    update() {
      titleUpdate();
      const n = this.rows.length;
      if (hit(...K.up)) { this.index = (this.index + n - 1) % n; Sound.sfx('move'); }
      if (hit(...K.down)) { this.index = (this.index + 1) % n; Sound.sfx('move'); }
      const row = this.rows[this.index];
      if (hit(...K.left)) this.change(row, -1);
      if (hit(...K.right)) this.change(row, 1);
      const m = Input.mouse;
      if (m.moved || m.click) {
        for (let i = 0; i < n; i++) {
          if (m.x < W / 2 - 170 || m.x > W / 2 + 170 || m.y < this.rowY(i) - 6 || m.y > this.rowY(i) + 16) continue;
          if (m.moved && this.index !== i) { this.index = i; Sound.sfx('move'); }
          if (m.click) {
            this.index = i;
            if (this.rows[i] === 'back') { Sound.sfx('select'); setScene(Title); return; }
            if (this.rows[i] === 'controls') { Sound.sfx('select'); setScene(Controls); return; }
            if (this.rows[i] === 'updates') { this.checkUpdates(); return; }
            this.change(this.rows[i], m.x < W / 2 + 40 ? -1 : 1);
          }
        }
      }
      if (hit(...K.ok)) {
        if (row === 'back') { Sound.sfx('select'); setScene(Title); return; }
        if (row === 'controls') { Sound.sfx('select'); setScene(Controls); return; }
        if (row === 'updates') { this.checkUpdates(); return; }
        this.change(row, 1);
      }
      if (hit(...K.back)) { Sound.sfx('select'); setScene(Title); }
    },
    draw() {
      drawTitleBackdrop();
      panel(W / 2 - 190, 20, 380, 232);
      drawTextOutlined(ctx, 'SETTINGS', W / 2, 32, PAL.C, 2, 'center');
      const values = {
        res: RESOLUTIONS[Config.res].name,
        full: isFullscreen() ? 'ON' : 'OFF',
        gfx: Config.g.name,
        music: Config.music,
        sfx: Config.sfx,
      };
      const labels = { res: 'RESOLUTION', full: 'FULLSCREEN', gfx: 'GRAPHICS', music: 'MUSIC', sfx: 'SOUND FX', controls: 'CONTROLS', back: 'BACK' };
      this.rows.forEach((row, i) => {
        const y = this.rowY(i);
        const sel = i === this.index;
        if (sel) {
          ctx.fillStyle = 'rgba(60,188,252,0.12)';
          ctx.fillRect(W / 2 - 176, y - 5, 352, 17);
        }
        if (row === 'back') {
          drawText(ctx, (sel ? '> ' : '') + 'BACK' + (sel ? ' <' : ''), W / 2, y, sel ? PAL.c : '#b8c4f0', 1, 'center');
          return;
        }
        if (row === 'controls' || row === 'updates') {
          drawText(ctx, row === 'controls' ? 'CONTROLS' : 'UPDATES', W / 2 - 166, y, sel ? PAL.c : '#b8c4f0');
          const busy = UpdateBox.st && ['checking', 'downloading', 'ready'].includes(UpdateBox.st.state);
          const what = row === 'controls' ? 'CHANGE KEYS' : sel && !busy ? 'CHECK FOR UPDATES' : UpdateBox.settingsText();
          drawText(ctx, (sel ? '> ' : '  ') + what + (sel ? ' <' : '  '), W / 2 + 80, y, PAL.w, 1, 'center');
          return;
        }
        drawText(ctx, labels[row], W / 2 - 166, y, sel ? PAL.c : '#b8c4f0');
        const v = values[row];
        if (row === 'music' || row === 'sfx') {
          // volume bar: 10 blocks
          for (let k = 0; k < 10; k++) {
            ctx.fillStyle = k < v ? PAL.c : '#342468';
            ctx.fillRect(W / 2 + 41 + k * 8, y, 6, 7);
          }
          if (sel) { drawText(ctx, '<', W / 2 + 29, y, PAL.w); drawText(ctx, '>', W / 2 + 126, y, PAL.w); }
        } else {
          drawText(ctx, (sel ? '< ' : '  ') + v + (sel ? ' >' : '  '), W / 2 + 80, y, PAL.w, 1, 'center');
        }
      });
      drawText(ctx, 'W/S: SELECT   A/D: CHANGE', W / 2, 236, PAL.n, 1, 'center');
    },
  };

  // ---------------------------------------------------------------- controls (key bindings)
  const ACTIONS = [
    ['left', 'MOVE LEFT'], ['right', 'MOVE RIGHT'], ['up', 'UP  (CLIMB / AIM)'], ['down', 'DOWN  (CLIMB / AIM)'],
    ['jump', 'JUMP'], ['dash', 'DASH'], ['pause', 'PAUSE'],
  ];
  function bindKey(action, slot, code) {
    // a key can only do one thing: take it away from any other action first
    for (const a in Config.keys) Config.keys[a] = Config.keys[a].map((c) => (c === code ? null : c));
    const list = Config.keys[action].slice(0, 2);
    while (list.length < 2) list.push(null);
    list[slot] = code;
    for (const a in Config.keys) Config.keys[a] = Config.keys[a].filter(Boolean);
    Config.keys[action] = list.filter(Boolean);
    if (!Config.keys[action].length) Config.keys[action] = DEFAULT_KEYS[action].slice(0, 1);
    Config.save();
  }

  const Controls = {
    enter() { this.index = 0; this.col = 0; this.listening = false; },
    rowY(i) { return 58 + i * 20; },
    update() {
      if (this.listening) {
        const code = [...Input.pressed][0];
        if (!code) return;
        this.listening = false;
        if (code === 'Escape') { Sound.sfx('pause'); return; }
        bindKey(ACTIONS[this.index][0], this.col, code);
        Sound.sfx('select');
        return;
      }
      titleUpdate();
      const n = ACTIONS.length + 2; // + reset + back
      if (hit('KeyW', 'ArrowUp')) { this.index = (this.index + n - 1) % n; Sound.sfx('move'); }
      if (hit('KeyS', 'ArrowDown')) { this.index = (this.index + 1) % n; Sound.sfx('move'); }
      if (hit('KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight') && this.index < ACTIONS.length) { this.col = 1 - this.col; Sound.sfx('move'); }
      const m = Input.mouse;
      let clicked = false;
      if (m.click || m.moved) {
        for (let i = 0; i < n; i++) {
          const y = this.rowY(i);
          if (m.y < y - 5 || m.y > y + 12 || m.x < W / 2 - 176 || m.x > W / 2 + 176) continue;
          if (m.moved) this.index = i;
          if (i < ACTIONS.length) this.col = m.x > W / 2 + 80 ? 1 : 0;
          if (m.click) { this.index = i; clicked = true; }
        }
      }
      if (hit('Escape', 'Backspace')) { Sound.sfx('select'); setScene(Settings); return; }
      if (hit('Enter', 'NumpadEnter', 'Space') || clicked) {
        Sound.sfx('select');
        if (this.index < ACTIONS.length) this.listening = true;
        else if (this.index === ACTIONS.length) { Config.keys = copyKeys(DEFAULT_KEYS); Config.save(); }
        else setScene(Settings);
      }
    },
    draw() {
      drawTitleBackdrop();
      panel(W / 2 - 190, 20, 380, 232);
      drawTextOutlined(ctx, 'CONTROLS', W / 2, 28, PAL.C, 2, 'center');
      drawText(ctx, 'KEY 1', W / 2 + 30, 46, PAL.m, 1, 'center');
      drawText(ctx, 'KEY 2', W / 2 + 130, 46, PAL.m, 1, 'center');
      ACTIONS.forEach(([a, label], i) => {
        const y = this.rowY(i);
        const sel = i === this.index;
        if (sel) { ctx.fillStyle = 'rgba(60,188,252,0.12)'; ctx.fillRect(W / 2 - 176, y - 5, 352, 17); }
        drawText(ctx, label, W / 2 - 166, y, sel ? PAL.c : '#b8c4f0');
        for (let c = 0; c < 2; c++) {
          const x = W / 2 + 30 + c * 100;
          const on = sel && this.col === c;
          let txt = keyName(Config.keys[a][c]);
          if (on && this.listening) txt = blink(10) ? 'PRESS A KEY' : '';
          if (on) { ctx.fillStyle = '#342468'; ctx.fillRect(x - 44, y - 3, 88, 13); }
          drawText(ctx, txt, x, y, on ? PAL.y : PAL.w, 1, 'center');
        }
      });
      const ry = this.rowY(ACTIONS.length), by = this.rowY(ACTIONS.length + 1);
      const rs = this.index === ACTIONS.length, bs = this.index === ACTIONS.length + 1;
      drawText(ctx, (rs ? '> ' : '') + 'RESET TO DEFAULTS' + (rs ? ' <' : ''), W / 2, ry, rs ? PAL.c : '#b8c4f0', 1, 'center');
      drawText(ctx, (bs ? '> ' : '') + 'BACK' + (bs ? ' <' : ''), W / 2, by, bs ? PAL.c : '#b8c4f0', 1, 'center');
      drawText(ctx, this.listening ? 'PRESS THE NEW KEY  (ESC: CANCEL)' : 'ENTER: CHANGE KEY   A/D: KEY 1 OR 2', W / 2, 238, PAL.n, 1, 'center');
    },
  };

  // Shared layout for simple title sub-screens (credits).
  function subScreen(title, h = 210, w = 300) {
    drawTitleBackdrop();
    panel(W / 2 - w / 2, (H - h) / 2, w, h);
    drawTextOutlined(ctx, title, W / 2, (H - h) / 2 + 12, PAL.C, 2, 'center');
    return (H - h) / 2 + 42; // first content line
  }
  function backOnly(menu) {
    const c = menu.update();
    if (c || hit(...K.back)) {
      if (!c) Sound.sfx('select');
      setScene(Title);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- slot picker
  const SlotSelect = {
    enter(mode) { this.mode = mode; this.index = 0; this.confirm = false; this.slots = [0, 1, 2].map((i) => Slots.load(i)); },
    choose(i) {
      if (this.mode === 'load') {
        if (!this.slots[i]) { Sound.sfx('pause'); return; }
        Sound.sfx('select');
        playSlot(i);
      } else if (this.slots[i] && !this.confirm) {
        this.confirm = true;
        Sound.sfx('move');
      } else {
        Sound.sfx('select');
        const data = Slots.fresh(false);
        Slots.write(i, data);
        setScene(Story, { slot: i, data });
      }
    },
    update() {
      titleUpdate();
      if (hit(...K.back)) {
        Sound.sfx('select');
        if (this.confirm) this.confirm = false; else setScene(Title);
        return;
      }
      if (this.confirm) {
        if (hit(...K.ok)) this.choose(this.index);
        return;
      }
      if (hit(...K.up)) { this.index = (this.index + 3) % 4; Sound.sfx('move'); }
      if (hit(...K.down)) { this.index = (this.index + 1) % 4; Sound.sfx('move'); }
      const m = Input.mouse;
      if (m.click || m.moved) {
        for (let i = 0; i < 4; i++) {
          const y = 58 + i * 42;
          if (m.x < W / 2 - 170 || m.x > W / 2 + 170 || m.y < y - 6 || m.y > y + (i < 3 ? 34 : 12)) continue;
          if (m.moved) this.index = i;
          if (m.click) { this.index = i; if (i === 3) { Sound.sfx('select'); setScene(Title); return; } this.choose(i); }
        }
      }
      if (hit(...K.ok)) {
        if (this.index === 3) { Sound.sfx('select'); setScene(Title); return; }
        this.choose(this.index);
      }
    },
    draw() {
      drawTitleBackdrop();
      panel(W / 2 - 190, 20, 380, 232);
      drawTextOutlined(ctx, this.mode === 'new' ? 'NEW GAME' : 'LOAD GAME', W / 2, 30, PAL.C, 2, 'center');
      for (let i = 0; i < 3; i++) {
        const y = 58 + i * 42;
        const d = this.slots[i];
        const sel = this.index === i;
        if (sel) { ctx.fillStyle = 'rgba(60,188,252,0.12)'; ctx.fillRect(W / 2 - 176, y - 6, 352, 38); }
        drawText(ctx, 'SLOT ' + (i + 1), W / 2 - 166, y, sel ? PAL.c : '#b8c4f0');
        if (!d) { drawText(ctx, 'EMPTY', W / 2 - 100, y, PAL.m); continue; }
        const st = slotStats(d);
        const def = CAMPAIGN[Math.min(d.stage, CAMPAIGN.length - 1)];
        drawText(ctx, d.done ? 'THE TRUE END - ALL COMPLETE' : (d.stage >= ACT2_START ? 'ACT II  ' : '') + def.name, W / 2 - 100, y, d.done ? PAL.y : PAL.w);
        drawText(ctx, 'CHAPTER ' + (def.chapter + 1) + ': ' + CHAPTERS[def.chapter].name, W / 2 - 100, y + 10, PAL.m);
        drawText(ctx, 'EMBERS ' + st.e + '/' + TOTALS.e + '  MEMORIES ' + st.f + '/' + TOTALS.f, W / 2 - 100, y + 20, '#fc9838');
        drawText(ctx, formatLong(st.time), W / 2 + 166, y, PAL.C, 1, 'right');
      }
      const sel = this.index === 3;
      drawText(ctx, (sel ? '> ' : '') + 'BACK' + (sel ? ' <' : ''), W / 2, 188, sel ? PAL.c : '#b8c4f0', 1, 'center');
      if (this.confirm) {
        panel(W / 2 - 120, 196, 240, 50, PAL.e);
        drawText(ctx, 'OVERWRITE SLOT ' + (this.index + 1) + '?', W / 2, 206, PAL.e, 1, 'center');
        drawText(ctx, 'ENTER: YES    ESC: NO', W / 2, 224, PAL.w, 1, 'center');
      } else {
        drawText(ctx, this.mode === 'new' ? 'PICK A SLOT FOR YOUR CLIMB' : 'PICK A SAVE TO CONTINUE', W / 2, 236, PAL.n, 1, 'center');
      }
    },
  };

  // ---------------------------------------------------------------- chapter card
  const ChapterIntro = {
    enter(chapter, run) { this.ch = chapter; this.run = run; this.t = 0; },
    update() {
      this.t++;
      const text = CHAPTERS[this.ch].intro;
      if (hit(...K.ok) || Input.mouse.click || hit('Escape')) {
        if (this.t * TYPE_SPEED < text.length && !hit('Escape')) { this.t = Math.ceil(text.length / TYPE_SPEED); return; }
        Sound.sfx('select');
        startLevel(CAMPAIGN[this.run.data.stage], this.run);
      }
    },
    draw() {
      const ch = CHAPTERS[this.ch];
      drawBackground(ctx, frame * 0.2, frame);
      if (ch.tint) { ctx.fillStyle = ch.tint; ctx.fillRect(0, 0, W, H); }
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 60, W, 150);
      if (ch.act === 2) drawTextOutlined(ctx, 'ACT II', W / 2, 46, PAL.y, 2, 'center');
      drawTextOutlined(ctx, 'CHAPTER ' + (this.ch + 1), W / 2, 76, PAL.C, 2, 'center');
      drawTextOutlined(ctx, ch.name, W / 2, 100, PAL.w, 3, 'center');
      let budget = Math.floor(this.t * TYPE_SPEED);
      ch.intro.split('\n').forEach((l, i) => {
        drawText(ctx, l.slice(0, Math.max(0, budget)), W / 2 - textWidth(l) / 2, 140 + i * 12, PAL.w);
        budget -= l.length;
      });
      if (this.run.data.hardcore) drawTextOutlined(ctx, 'HARDCORE', W / 2, 192, PAL.e, 1, 'center');
      if (budget >= 0 && blink(20)) drawText(ctx, 'PRESS ENTER', W / 2, 220, PAL.y, 1, 'center');
    },
  };

  // ---------------------------------------------------------------- ending
  const ENDINGS = {
    1: [
      'AT THE SUMMIT, THE EVERFLAME BURNS\nBRIGHTER THAN ANY STAR.',
      'BESIDE IT STANDS THE WATCHER.\nIT TAKES OFF ITS RED CAP.\nIT IS ASH.',
      '"EVERY CLIMBER WHO WISHED FOR THEMSELVES\nBECAME THE FLAME\'S SHADOW," ASH WHISPERS.\n"I HAVE WAITED SO LONG FOR SOMEONE."',
      'YOU STEP INTO THE FIRE AND MAKE\nYOUR WISH:\nLET THEM ALL GO HOME.',
      'THE STORM BREAKS. HUNDREDS OF SHADOWS\nTURN TO LIGHT AND DRIFT DOWN THE\nMOUNTAIN LIKE EMBERS.',
      'ASH SMILES, AND IS GONE.\nONE LAST EMBER OF THE EVERFLAME\nSTAYS IN YOUR HAND, STILL WARM.',
      'BUT ON THE FAR SIDE OF THE SUMMIT,\nSOMETHING BLACK IS BURNING.\nTHE STORY IS NOT OVER.',
    ],
    2: [
      'THE BLACK FLAME GUTTERS.\nTHE HOLLOW FALLS TO ITS KNEES.',
      'YOU HOLD OUT THE LAST EMBER OF THE\nEVERFLAME. NOT TAKEN. GIVEN.',
      'THE FIRST CLIMBER TAKES IT IN SHAKING\nHANDS, AND FOR THE FIRST TIME IN A\nTHOUSAND YEARS, FEELS WARM.',
      '"MY NAME WAS WREN," IT SAYS, SMILING.\n"THANK YOU FOR BRINGING ME HOME."',
      'THE BLACK FLAME GOES OUT. NO MORE\nSHADOWS WILL EVER FORM ON\nMOUNT PRECIPICE.',
      'YOU WALK DOWN THE MOUNTAIN AT DAWN,\nASH\'S RED CAP ON YOUR HEAD, AND THE\nWHOLE SLOPE GLOWING BEHIND YOU.',
    ],
  };
  const Ending = {
    enter(run, summary) {
      this.run = run;
      this.act = run.data.stage > ACT2_START || run.data.done ? 2 : 1;
      this.pages = ENDINGS[this.act];
      this.page = summary ? this.pages.length : 0; // back from the credits roll: straight to the summary
      this.t = summary ? 40 : 0;
      this.menu = makeMenu(this.act === 1
        ? [{ id: 'story', label: 'CONTINUE THE STORY (50 MORE STAGES)' }, { id: 'credits', label: 'CREDITS' }, { id: 'title', label: 'BACK TO TITLE' }]
        : [{ id: 'credits', label: 'CREDITS' }, { id: 'title', label: 'BACK TO TITLE' }], 222, 12);
      if (summary) Sound.playMusic(false); // back from the credits roll: the ending theme carries on
      else Sound.playSong(ENDING_TRACK);
    },
    update() {
      this.t++;
      if (this.page >= this.pages.length) {
        if (this.t < 40) return;
        const c = this.menu.update();
        if (!c) return;
        if (c.id === 'story') playSlot(this.run.slot);
        else if (c.id === 'credits' && this.act === 2) setScene(CreditsRoll, this.run);
        else if (c.id === 'credits') setScene(Credits);
        else setScene(Title);
        return;
      }
      if (!(hit(...K.ok) || Input.mouse.click || hit('Escape'))) return;
      const len = this.pages[this.page].length;
      if ((this.t - 8) * TYPE_SPEED < len && !hit('Escape')) { this.t = Math.ceil(len / TYPE_SPEED) + 8; return; }
      this.page = hit('Escape') ? this.pages.length : this.page + 1;
      this.t = 0;
      Sound.sfx('move');
      if (this.page >= this.pages.length && this.act === 2) setScene(CreditsRoll, this.run); // the true ending rolls the credits
    },
    draw() {
      drawBackground(ctx, frame * 0.1, frame);
      ctx.fillStyle = this.act === 1 ? 'rgba(210,120,40,0.12)' : 'rgba(252,200,120,0.18)';
      ctx.fillRect(0, 0, W, H);
      Play.drawEverflame({ x: (W / 2 - 8) / T, y: 110 / T });
      if (this.page < this.pages.length) {
        const lines = this.pages[this.page].split('\n');
        if (!animatedPanel(W / 2 - 180, 176, 360, 80, this.t)) return;
        let budget = Math.floor((this.t - 8) * TYPE_SPEED);
        lines.forEach((l, i) => {
          drawText(ctx, l.slice(0, Math.max(0, budget)), W / 2 - textWidth(l) / 2, 188 + i * 12, PAL.w);
          budget -= l.length;
        });
        if (budget >= 0 && blink(20)) drawText(ctx, 'ENTER >', W / 2 + 172, 244, PAL.y, 1, 'right');
        return;
      }
      const st = slotStats(this.run.data);
      const tot = this.act === 1 ? TOTALS1 : TOTALS;
      panel(W / 2 - 170, 128, 340, 136, PAL.y);
      drawTextOutlined(ctx, this.act === 1 ? 'THE END?' : 'THE TRUE END', W / 2, 136, PAL.y, 2, 'center');
      drawText(ctx, this.act === 1 ? 'ACT I COMPLETE' : 'THANK YOU FOR PLAYING PRECIPICE', W / 2, 156, PAL.w, 1, 'center');
      drawText(ctx, 'TIME ' + formatLong(st.time) + '   DEATHS ' + st.deaths, W / 2, 170, PAL.C, 1, 'center');
      drawText(ctx, 'EMBERS ' + st.e + '/' + tot.e + '   MEMORIES ' + st.f + '/' + tot.f, W / 2, 182, '#fc9838', 1, 'center');
      const all = st.f >= tot.f;
      const who = this.act === 1 ? "ASH'S" : "WREN'S";
      drawText(ctx, all ? 'YOU FOUND EVERY MEMORY. NONE WILL BE FORGOTTEN.' : 'SOME OF ' + who + ' MEMORIES ARE STILL OUT THERE...', W / 2, 196, all ? PAL.e : PAL.V, 1, 'center');
      if (this.run.data.hardcore) drawText(ctx, 'HARDCORE!', W / 2, 208, PAL.e, 1, 'center');
      if (this.t >= 40) this.menu.draw();
    },
  };

  // ---------------------------------------------------------------- multiplayer
  const netStages = () => [LEVELS.tutorial, ...CAMPAIGN];
  const netStageDef = (i) => (i < 0 ? LEVELS.tutorial : CAMPAIGN[i]);
  function startNetLevel(i) {
    Sound.fadeOutMusic();
    setScene(Play, netStageDef(i), null, true);
  }
  Net.onStart = (i) => startNetLevel(i);

  function loadName() {
    try { return localStorage.getItem('precipice.name'); } catch (e) { return null; }
  }
  // Phones and tablets have no keyboard for the canvas: ask with the system text box.
  const IS_TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  function touchPrompt(question, current, max) {
    if (!IS_TOUCH || typeof prompt !== 'function') return null;
    const v = prompt(question, current || '');
    Input.down.clear();
    return v == null ? null : v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, max);
  }
  function typeInto(text, max) {
    for (const code of Input.pressed) {
      if (/^Key[A-Z]$/.test(code) && text.length < max) text += code.slice(3);
      else if (/^Digit\d$/.test(code) && text.length < max) text += code.slice(5);
      else if (code === 'Backspace') text = text.slice(0, -1);
    }
    return text;
  }

  // Account: sign up / log in, then SAVE and LOAD your saves through the cloud.
  const AccountScene = {
    enter() {
      this.index = 0;
      this.editing = null;
      this.user = Account.user || '';
      this.pass = '';
      this.msg = '';
      this.msgColor = PAL.m;
      this.confirmLoad = false;
      this.t = 0;
    },
    rows() { return Account.loggedIn() ? ['save', 'load', 'messages', 'logout', 'back'] : ['user', 'pass', 'login', 'signup', 'back']; },
    say(msg, color) { this.msg = msg; this.msgColor = color || PAL.m; },
    run(promise, done) {
      this.say('PLEASE WAIT...', PAL.y);
      promise.then((out) => { done(out); }, (e) => { this.say(e.message, PAL.e); Sound.sfx('die'); });
    },
    // Phones have no keyboard for the canvas, so ask with the system text box.
    promptFor(field) {
      if (!IS_TOUCH) return false;
      const v = touchPrompt(field === 'user' ? 'ACCOUNT NAME (3-12 LETTERS OR NUMBERS)' : 'PASSWORD (4-32 LETTERS OR NUMBERS)', field === 'user' ? this.user : '', field === 'user' ? 12 : 32);
      if (v != null) this[field] = v;
      return true;
    },
    choose(row) {
      if (row === 'back') { setScene(Title); return; }
      if (Account.busy) return;
      if (row !== 'load') this.confirmLoad = false;
      if (row === 'user' || row === 'pass') {
        if (!this.promptFor(row)) { this.editing = row; this.say(row === 'user' ? 'TYPE YOUR ACCOUNT NAME, THEN ENTER' : 'TYPE YOUR PASSWORD, THEN ENTER'); }
      } else if (row === 'login' || row === 'signup') {
        if (this.user.length < 3) { this.say('NAME MUST BE 3-12 LETTERS OR NUMBERS', PAL.e); return; }
        if (this.pass.length < 4) { this.say('PASSWORD MUST BE AT LEAST 4 CHARACTERS', PAL.e); return; }
        this.run(Account[row](this.user, this.pass), (out) => {
          this.pass = '';
          this.index = 0;
          Sound.sfx('check');
          this.say(row === 'signup' ? 'ACCOUNT MADE! WELCOME, ' + out.user + '!' : out.savedAt ? 'WELCOME BACK! LOAD TO GET YOUR SAVES.' : 'WELCOME BACK, ' + out.user + '!', PAL.G);
        });
      } else if (row === 'messages') {
        // the dev gets an inbox of everyone; players talk to the dev
        if (Account.isDev()) setScene(Inbox); else setScene(Chat, Account.DEV, AccountScene);
      } else if (row === 'save') {
        this.run(Account.save(), () => { Sound.sfx('check'); this.say('SAVED TO THE CLOUD!', PAL.G); });
      } else if (row === 'load') {
        if (!this.confirmLoad) { this.confirmLoad = true; this.say('THIS REPLACES THE SAVES ON THIS DEVICE. PRESS AGAIN.', PAL.y); return; }
        this.confirmLoad = false;
        this.run(Account.pull(), (out) => {
          if (!out) { this.say('NOTHING SAVED IN THE CLOUD YET', PAL.y); return; }
          Config.load();
          lastSize = '';
          resize();
          Sound.sfx('check');
          this.say('SAVES LOADED ONTO THIS DEVICE!', PAL.G);
        });
      } else if (row === 'logout') {
        this.run(Account.logout(), () => { this.index = 0; this.user = Account.user; this.say('LOGGED OUT', PAL.m); });
      }
    },
    update() {
      titleUpdate();
      this.t++;
      if (this.editing) {
        this[this.editing] = typeInto(this[this.editing], this.editing === 'user' ? 12 : 32);
        if (hit('Enter', 'NumpadEnter', 'Escape', 'Tab')) {
          const next = this.editing === 'user' && hit('Enter', 'NumpadEnter', 'Tab');
          this.editing = null;
          this.say('');
          Sound.sfx('select');
          if (next) { this.index = 1; if (!this.pass) this.choose('pass'); }
          else if (this.index === 1 && hit('Enter', 'NumpadEnter')) this.index = 2; // ready to LOG IN
        }
        return;
      }
      const rows = this.rows(), n = rows.length;
      if (this.index >= n) this.index = 0;
      if (hit(...K.up)) { this.index = (this.index + n - 1) % n; Sound.sfx('move'); this.confirmLoad = false; }
      if (hit(...K.down)) { this.index = (this.index + 1) % n; Sound.sfx('move'); this.confirmLoad = false; }
      if (hit(...K.back)) { Sound.sfx('select'); setScene(Title); return; }
      const m = Input.mouse;
      let chosen = hit(...K.ok);
      if (m.click || m.moved) {
        for (let i = 0; i < n; i++) {
          const y = 104 + i * 22;
          if (m.y < y - 6 || m.y > y + 12 || Math.abs(m.x - W / 2) > 150) continue;
          if (this.index !== i) this.confirmLoad = false;
          this.index = i;
          if (m.click) chosen = true;
        }
      }
      if (!chosen) return;
      Sound.sfx('select');
      this.choose(rows[this.index]);
    },
    draw() {
      drawTitleBackdrop();
      if (!animatedPanel(W / 2 - 170, 20, 340, 230, this.t)) return;
      drawTextOutlined(ctx, 'ACCOUNT', W / 2, 30, PAL.C, 2, 'center');
      if (Account.loggedIn()) {
        drawText(ctx, 'LOGGED IN AS ' + Account.user, W / 2, 58, PAL.y, 1, 'center');
        drawText(ctx, 'SAVE: COPY THIS DEVICE\'S SAVES TO THE CLOUD', W / 2, 72, PAL.m, 1, 'center');
        drawText(ctx, 'LOAD: PUT YOUR CLOUD SAVES ON THIS DEVICE', W / 2, 82, PAL.m, 1, 'center');
      } else {
        drawText(ctx, 'LOG IN TO MOVE YOUR SAVES BETWEEN DEVICES.', W / 2, 60, PAL.m, 1, 'center');
        drawText(ctx, 'NEW HERE? TYPE A NAME AND PASSWORD, THEN SIGN UP.', W / 2, 72, PAL.m, 1, 'center');
      }
      const caret = blink(15) ? '_' : ' ';
      const labels = {
        user: 'NAME: ' + this.user + (this.editing === 'user' ? caret : this.user ? '' : '...'),
        pass: 'PASSWORD: ' + '*'.repeat(this.pass.length) + (this.editing === 'pass' ? caret : this.pass ? '' : '...'),
        login: 'LOG IN', signup: 'SIGN UP', save: 'SAVE',
        messages: (Account.isDev() ? 'MESSAGES' : 'MESSAGE ' + Account.DEV) + (Account.unread ? ' (' + Account.unread + ' NEW)' : ''), load: this.confirmLoad ? 'LOAD - SURE?' : 'LOAD', logout: 'LOG OUT', back: 'BACK',
      };
      this.rows().forEach((r, i) => {
        const y = 104 + i * 22, sel = i === this.index;
        if (sel) { ctx.fillStyle = 'rgba(60,188,252,0.12)'; ctx.fillRect(W / 2 - 150, y - 6, 300, 19); }
        drawText(ctx, (sel ? '> ' : '') + labels[r] + (sel ? ' <' : ''), W / 2, y, sel ? PAL.c : '#b8c4f0', 1, 'center');
      });
      if (this.msg) drawText(ctx, this.msg, W / 2, 222, this.msgColor, 1, 'center');
      drawText(ctx, 'ESC: BACK', W / 2, 233, PAL.n, 1, 'center');
      drawText(ctx, 'YOUR ACCOUNT STORES YOUR NAME AND SAVES. PASSWORDS ARE SCRAMBLED.', W / 2, 242, '#3c3c5c', 1, 'center');
    },
  };

  const Multi = {
    enter() {
      this.index = 0;
      this.editing = false;
      if (!this.name) this.name = loadName() || 'CLIMBER' + (10 + Math.floor(Math.random() * 90));
    },
    rows: ['name', 'create', 'join', 'back'],
    update() {
      titleUpdate();
      if (this.editing) {
        this.name = typeInto(this.name, 10);
        if (hit('Enter', 'NumpadEnter', 'Escape')) {
          this.editing = false;
          if (!this.name) this.name = 'CLIMBER';
          try { localStorage.setItem('precipice.name', this.name); } catch (e) { /* ignore */ }
          Sound.sfx('select');
        }
        return;
      }
      const n = this.rows.length;
      if (hit(...K.up)) { this.index = (this.index + n - 1) % n; Sound.sfx('move'); }
      if (hit(...K.down)) { this.index = (this.index + 1) % n; Sound.sfx('move'); }
      if (hit(...K.back)) { Sound.sfx('select'); setScene(More); return; }
      const m = Input.mouse;
      let chosen = hit(...K.ok);
      if (m.click || m.moved) {
        for (let i = 0; i < n; i++) {
          const y = 96 + i * 26;
          if (m.y < y - 6 || m.y > y + 14 || Math.abs(m.x - W / 2) > 150) continue;
          this.index = i;
          if (m.click) chosen = true;
        }
      }
      if (!chosen) return;
      Sound.sfx('select');
      const row = this.rows[this.index];
      if (row === 'name') {
        const v = touchPrompt('YOUR NAME (UP TO 10 LETTERS OR NUMBERS)', this.name, 10);
        if (v != null) { this.name = v || 'CLIMBER'; try { localStorage.setItem('precipice.name', this.name); } catch (e) { /* ignore */ } }
        else if (!IS_TOUCH) this.editing = true;
      }
      else if (row === 'create') { Net.host(this.name); setScene(Room); }
      else if (row === 'join') setScene(JoinCode);
      else setScene(More);
    },
    draw() {
      drawTitleBackdrop();
      panel(W / 2 - 170, 24, 340, 222);
      drawTextOutlined(ctx, 'MULTIPLAYER', W / 2, 34, PAL.C, 2, 'center');
      drawText(ctx, 'RACE YOUR FRIENDS THROUGH ANY STAGE.', W / 2, 60, PAL.m, 1, 'center');
      drawText(ctx, 'ONE PLAYER CREATES A ROOM, THE OTHERS JOIN WITH ITS CODE.', W / 2, 70, PAL.m, 1, 'center');
      const labels = { name: 'NAME: ' + this.name + (this.editing && blink(15) ? '_' : ''), create: 'CREATE ROOM', join: 'JOIN ROOM', back: 'BACK' };
      this.rows.forEach((r, i) => {
        const y = 96 + i * 26, sel = i === this.index;
        if (sel) { ctx.fillStyle = 'rgba(60,188,252,0.12)'; ctx.fillRect(W / 2 - 150, y - 6, 300, 20); }
        drawText(ctx, (sel ? '> ' : '') + labels[r] + (sel ? ' <' : ''), W / 2, y, sel ? PAL.c : '#b8c4f0', 1, 'center');
      });
      drawText(ctx, this.editing ? 'TYPE YOUR NAME, THEN PRESS ENTER' : 'NEEDS AN INTERNET CONNECTION', W / 2, 232, PAL.n, 1, 'center');
    },
  };

  const JoinCode = {
    enter() { this.code = ['A', 'A', 'A', 'A']; this.cursor = 0; },
    update() {
      titleUpdate();
      for (const code of Input.pressed) {
        if (/^Key[A-Z]$/.test(code) && ROOM_LETTERS.includes(code.slice(3))) {
          this.code[this.cursor] = code.slice(3);
          this.cursor = Math.min(3, this.cursor + 1);
          Sound.sfx('move');
        }
      }
      const cycle = (d) => {
        const i = ROOM_LETTERS.indexOf(this.code[this.cursor]);
        this.code[this.cursor] = ROOM_LETTERS[(i + d + ROOM_LETTERS.length) % ROOM_LETTERS.length];
        Sound.sfx('move');
      };
      if (hit('ArrowUp')) cycle(1);
      if (hit('ArrowDown')) cycle(-1);
      if (hit('ArrowLeft', 'Backspace')) this.cursor = Math.max(0, this.cursor - 1);
      if (hit('ArrowRight')) this.cursor = Math.min(3, this.cursor + 1);
      if (hit('Escape')) { Sound.sfx('select'); setScene(Multi); return; }
      const m = Input.mouse;
      if (m.click && IS_TOUCH && m.y >= 100 && m.y <= 150) {
        const v = touchPrompt('ROOM CODE (4 LETTERS)', '', 4);
        if (v) {
          const letters = v.split('').filter((c) => ROOM_LETTERS.includes(c));
          for (let i = 0; i < 4; i++) this.code[i] = letters[i] || 'A';
          this.cursor = 3;
          Sound.sfx('move');
        }
        return;
      }
      if (hit('Enter', 'NumpadEnter', 'Space') || m.click) {
        Sound.sfx('select');
        Net.join(this.code.join(''), Multi.name);
        setScene(Room);
      }
    },
    draw() {
      drawTitleBackdrop();
      panel(W / 2 - 150, 50, 300, 170);
      drawTextOutlined(ctx, 'JOIN ROOM', W / 2, 60, PAL.C, 2, 'center');
      drawText(ctx, 'ENTER THE 4-LETTER ROOM CODE', W / 2, 88, PAL.m, 1, 'center');
      for (let i = 0; i < 4; i++) {
        const x = W / 2 - 66 + i * 36, sel = i === this.cursor;
        ctx.fillStyle = sel ? '#342468' : '#1c1048';
        ctx.fillRect(x, 108, 28, 34);
        drawText(ctx, this.code[i], x + 14, 115, sel ? PAL.y : PAL.w, 3, 'center');
        if (sel && blink(15)) { ctx.fillStyle = PAL.y; ctx.fillRect(x + 4, 144, 20, 2); }
      }
      drawText(ctx, IS_TOUCH ? 'TAP THE LETTERS TO TYPE THE CODE' : 'TYPE IT, OR USE UP/DOWN AND LEFT/RIGHT', W / 2, 160, PAL.m, 1, 'center');
      drawText(ctx, IS_TOUCH ? 'JUMP (OR TAP HERE): JOIN     PAUSE: BACK' : 'ENTER: JOIN     ESC: BACK', W / 2, 196, PAL.n, 1, 'center');
    },
  };

  const Room = {
    enter() { this.index = 0; if (!Net.started) Sound.playMusic(false); },
    update() {
      titleUpdate();
      if (Net.error) {
        if (hit(...K.ok, ...K.back) || Input.mouse.click) { Sound.sfx('select'); Net.reset(); setScene(Multi); }
        return;
      }
      if (hit(...K.back)) { Sound.sfx('select'); Net.reset(); setScene(Multi); return; }
      if (Net.isHost && Net.myId) {
        const list = netStages();
        const cur = Net.stage + 1; // 0 = tutorial
        if (hit(...K.left)) { Net.setStage(((cur - 1 + list.length) % list.length) - 1); Sound.sfx('move'); }
        if (hit(...K.right)) { Net.setStage(((cur + 1) % list.length) - 1); Sound.sfx('move'); }
        if (hit(...K.up)) { Net.setStage(Math.max(-1, Net.stage - 10)); Sound.sfx('move'); }
        if (hit(...K.down)) { Net.setStage(Math.min(CAMPAIGN.length - 1, Net.stage + 10)); Sound.sfx('move'); }
        if (hit('Enter', 'NumpadEnter', 'Space') || Input.mouse.click) {
          Sound.sfx('select');
          Net.start();
          startNetLevel(Net.stage);
        }
      } else if (Net.started && Net.hostConn && hit(...K.ok)) {
        startNetLevel(Net.stage); // game already running: jump in
      }
    },
    draw() {
      drawTitleBackdrop();
      panel(W / 2 - 180, 16, 360, 238);
      if (Net.error) {
        drawTextOutlined(ctx, 'OH NO!', W / 2, 70, PAL.e, 2, 'center');
        drawText(ctx, Net.error, W / 2, 110, PAL.w, 1, 'center');
        drawText(ctx, 'PRESS ENTER', W / 2, 150, PAL.y, 1, 'center');
        return;
      }
      if (Net.status) {
        drawTextOutlined(ctx, 'MULTIPLAYER', W / 2, 26, PAL.C, 2, 'center');
        drawText(ctx, Net.status, W / 2, 110, PAL.w, 1, 'center');
        return;
      }
      drawText(ctx, 'ROOM CODE', W / 2, 26, PAL.m, 1, 'center');
      drawTextOutlined(ctx, Net.code, W / 2, 38, PAL.y, 3, 'center');
      drawText(ctx, 'PLAYERS (' + Net.order.length + '/8)', W / 2 - 160, 72, PAL.C);
      Net.order.forEach((id, i) => {
        const pl = Net.players[id];
        if (!pl) return;
        const y = 86 + i * 14;
        ctx.drawImage(playerSpritesFor(pl.color).idle.right, W / 2 - 160, y - 5);
        drawText(ctx, pl.name + (id === Net.myId ? ' (YOU)' : '') + (i === 0 ? ' - HOST' : ''), W / 2 - 142, y, pl.color === '#fcfcfc' ? PAL.l : pl.color);
      });
      const def = netStageDef(Net.stage);
      drawText(ctx, 'STAGE', W / 2 + 40, 72, PAL.C);
      drawText(ctx, def.name, W / 2 + 40, 86, PAL.w);
      if (Net.isHost) {
        drawText(ctx, 'LEFT/RIGHT: CHANGE', W / 2 + 40, 104, PAL.m);
        drawText(ctx, 'UP/DOWN: JUMP 10', W / 2 + 40, 116, PAL.m);
        if (blink(20)) drawText(ctx, 'ENTER: START THE RACE!', W / 2, 214, PAL.y, 1, 'center');
      } else {
        drawText(ctx, Net.started ? 'RACE IN PROGRESS - ENTER TO JOIN IN' : 'WAITING FOR THE HOST TO START...', W / 2, 214, PAL.y, 1, 'center');
      }
      drawText(ctx, 'SHARE THE CODE WITH FRIENDS.   ESC: LEAVE ROOM', W / 2, 236, PAL.n, 1, 'center');
    },
  };

  // ---------------------------------------------------------------- more / hardcore
  // ONLY UP progress: best height, best time to the top, and where you left off.
  const OnlyUp = {
    key: 'precipice.onlyup',
    resume: false,
    load() { try { return JSON.parse(localStorage.getItem(this.key)) || {}; } catch (e) { return {}; } },
    save(d) { try { localStorage.setItem(this.key, JSON.stringify(d)); } catch (e) { /* storage unavailable */ } },
    start(resume) {
      this.resume = resume;
      if (!resume) { const s = this.load(); this.save({ best: s.best || 0, bestTime: s.bestTime || 0, top: s.top }); }
      startLevel(LEVELS.onlyup);
    },
  };

  const More = {
    enter() {
      this.save = Slots.load(Slots.HARDCORE);
      const ou = OnlyUp.load();
      const items = [];
      if (this.save && !this.save.done) items.push({ id: 'cont', label: 'CONTINUE HARDCORE' });
      items.push({ id: 'new', label: 'NEW HARDCORE RUN' });
      if (ou.x !== undefined) items.push({ id: 'ou', label: 'ONLY UP: CONTINUE' }, { id: 'ounew', label: 'ONLY UP: START OVER' });
      else items.push({ id: 'ounew', label: 'ONLY UP' + (ou.best ? ' (BEST ' + ou.best + 'M)' : '') });
      items.push({ id: 'multi', label: 'MULTIPLAYER' }, { id: 'back', label: 'BACK' });
      this.menu = makeMenu(items, 140, 16);
      this.confirm = false;
    },
    update() {
      titleUpdate();
      if (hit(...K.back)) { Sound.sfx('select'); if (this.confirm) this.confirm = false; else setScene(Title); return; }
      if (this.confirm) {
        if (hit(...K.ok)) this.startNew();
        return;
      }
      const c = this.menu.update();
      if (!c) return;
      if (c.id === 'back') setScene(Title);
      else if (c.id === 'multi') setScene(Multi);
      else if (c.id === 'ou') OnlyUp.start(true);
      else if (c.id === 'ounew') OnlyUp.start(false);
      else if (c.id === 'cont') playSlot(Slots.HARDCORE);
      else if (this.save && !this.save.done) this.confirm = true;
      else this.startNew();
    },
    startNew() {
      Sound.sfx('select');
      const data = Slots.fresh(true);
      Slots.write(Slots.HARDCORE, data);
      setScene(ChapterIntro, 0, { slot: Slots.HARDCORE, data });
    },
    draw() {
      drawTitleBackdrop();
      this.menu.y = this.save ? 128 : 100;
      const bottom = this.menu.y + this.menu.items.length * this.menu.spacing; // box fits its contents
      panel(W / 2 - 150, 24, 300, bottom - 2);
      drawTextOutlined(ctx, 'MORE', W / 2, 34, PAL.C, 2, 'center');
      drawText(ctx, 'HARDCORE: NO CHECKPOINTS.', W / 2, 64, PAL.e, 1, 'center');
      drawText(ctx, 'SAVES ONLY AT THE START OF EACH CHAPTER.', W / 2, 76, PAL.w, 1, 'center');
      if (this.save) {
        const st = slotStats(this.save);
        const def = CAMPAIGN[Math.min(this.save.stage, CAMPAIGN.length - 1)];
        drawText(ctx, this.save.done ? 'HARDCORE COMPLETE!' : 'SAVED AT CHAPTER ' + (def.chapter + 1) + ': ' + CHAPTERS[def.chapter].name, W / 2, 96, PAL.C, 1, 'center');
        drawText(ctx, 'DEATHS ' + st.deaths + '   TIME ' + formatLong(st.time), W / 2, 106, PAL.m, 1, 'center');
      }
      this.menu.draw();
      drawText(ctx, 'MORE EXTRAS COMING SOON!', W / 2, bottom + 6, PAL.n, 1, 'center');
      if (this.confirm) {
        panel(W / 2 - 130, this.menu.y + 24, 260, 50, PAL.e);
        drawText(ctx, 'START OVER? YOUR RUN WILL BE LOST.', W / 2, this.menu.y + 34, PAL.e, 1, 'center');
        drawText(ctx, 'ENTER: YES    ESC: NO', W / 2, this.menu.y + 52, PAL.w, 1, 'center');
      }
    },
  };

  const CREDITS_ROWS = [
    ['GAME & DESIGN', 'ColdzeeYT'],
    ['MUSIC', 'SILVER HAND MAN - VIRAXOR', 'THIS SHOULD BE IN A VIDEO GAME - PIANOMATIONS', 'I MADE THIS AND THEN CRIED UNTIL 3 AM - DISAPPIERCING'],
    ['SOUND EFFECTS', '8-BIT SYNTH (WEB AUDIO)'],
    ['ART', 'ORIGINAL 8-BIT PIXEL ART'],
    ['SOURCE', 'GITHUB.COM/COLDZEEYT/PRECIPICE'],
    ['PLAYTESTERS', 'PUGSNPIGS', 'ColdzeeYT'],
  ];

  const Credits = {
    menu: makeMenu([{ id: 'changelog', label: 'CHANGELOG' }, { id: 'back', label: 'BACK' }], 222, 13),
    update() {
      titleUpdate();
      const c = this.menu.update();
      if (c && c.id === 'changelog') setScene(Changelog);
      else if (c || hit(...K.back)) { if (!c) Sound.sfx('select'); setScene(Title); }
    },
    draw() {
      let y = subScreen('CREDITS', 258, 360) - 4;
      for (const [head, ...lines] of CREDITS_ROWS) {
        drawText(ctx, head, W / 2, y, PAL.c, 1, 'center');
        lines.forEach((l, i) => drawText(ctx, l, W / 2, y + 10 + i * 9, PAL.w, 1, 'center'));
        y += 14 + lines.length * 9;
      }
      this.menu.draw();
    },
  };

  // ---------------------------------------------------------------- physics tuning
  const P = {
    maxRun: 1.8, accelGround: 0.3, accelAir: 0.2, frictionGround: 0.35, frictionAir: 0.1,
    gravity: 0.36, apexGravity: 0.18, jump: -5.6, jumpCut: -2.2, maxFall: 5.5,
    coyote: 6, buffer: 6,
    wallSlide: 1.3, wallJumpX: 2.4, wallLock: 10, climbX: 1.2, climbLock: 5,
    dashSpeed: 4.6, dashTime: 11, spring: -10,
  };

  function newPlayer(spawn) {
    return {
      x: spawn.x, y: spawn.y, w: 10, h: 15, vx: 0, vy: 0, face: 1,
      onGround: false, coyote: 0, buffer: 0, lock: 0, dashes: 1, dashing: 0,
      bounced: false, riding: null, sliding: false, anim: 0, dead: false, deadT: 0,
    };
  }

  // ---------------------------------------------------------------- play scene
  const Play = {
    enter(def, run, net) {
      this.def = def;
      this.run = run || null;
      this.netOn = !!net; // online race: no saving, other players drawn
      this.hardcore = !!(run && run.data.hardcore);
      this.level = buildLevel(def);
      if (this.hardcore) this.level.checkpoints = []; // no checkpoints in hardcore
      this.windT = 0;
      this.crumbles = new Map();
      const s = this.level.start;
      this.spawn = { x: s.x * T + 3, y: s.y * T + 1 };
      this.player = newPlayer(this.spawn);
      this.cam = 0;
      this.camY = clamp(this.spawn.y + 8 - H * 0.6, 0, this.level.h * T - H);
      this.sw = 0; // switch-block state: 0 = red solid, 1 = blue solid
      this.keysHeld = 0;
      this.deaths = 0;
      this.time = 0;
      this.state = 'play';
      this.clearT = 0;
      this.shake = 0;
      this.particles = [];
      this.trail = [];
      this.intro = 150;
      this.message = null; // mystery text shown at the bottom of the screen
      // Columns with gameplay objects get no tall decorations (keeps things readable).
      const L0 = this.level;
      this.decoBlock = new Set();
      for (const o of [...L0.signs, ...L0.checkpoints, ...L0.springs, ...L0.fragments, ...L0.watchers]) this.decoBlock.add(o.x);
      for (const goal of [L0.flag, L0.everflame]) if (goal) [-1, 0, 1].forEach((d) => this.decoBlock.add(goal.x + d));
      // Drifting dust / snow in front of the background.
      this.motes = Array.from({ length: 70 }, () => ({
        x: Math.random() * W, y: Math.random() * H, v: 0.15 + Math.random() * 0.3, p: Math.random() * 6.28,
      }));
      this.pauseMenu = makeMenu([{ id: 'resume', label: 'RESUME' }, { id: 'quit', label: net ? 'LEAVE RACE' : 'QUIT TO TITLE' }], 140);
      this.toast = 0;
      this.orbs = [];
      const info = def.bossInfo;
      this.boss = L0.boss && info ? {
        x: L0.boss.x * T + 8, y: L0.boss.y * T, hp: info.hp, maxHp: info.hp, bonus: info.bonus, info,
        state: 'intro', t: 0, tx: 0, ty: 0, vy: 0, volleys: 0,
        floorY: (L0.h - 2) * T - 15,
      } : null;
      if (run && (run.data.cp >= 0 || run.data.stageTime > 0) && !this.hardcore) this.loadSave(run.data);
      this.onlyUp = !!def.onlyUp;
      if (this.onlyUp) this.startOnlyUp();
    },

    // ---- ONLY UP: height meter, best height, a saved spot, and painful falls
    startOnlyUp() {
      const s = OnlyUp.load();
      this.ou = { best: s.best || 0, bestTime: s.bestTime || 0, falls: s.falls || 0, peak: 0, fell: 0, fellT: 0, saveT: 0 };
      if (OnlyUp.resume && s.x !== undefined) {
        this.player.x = s.x; this.player.y = s.y;
        this.time = s.time || 0;
        this.camY = clamp(s.y + 8 - H * 0.6, 0, this.level.h * T - H);
      } else if (!OnlyUp.resume) this.ou.falls = 0;
      this.intro = 200;
    },
    heightOf(p) { return Math.max(0, Math.round(((this.level.h - 3) * T - (p.y + p.h)) / T)); },
    updateOnlyUp() {
      const p = this.player, o = this.ou, h = this.heightOf(p);
      if (h > o.best) o.best = h;
      if (!p.onGround && !p.climbing) o.peak = Math.max(o.peak, h);
      else {
        if (o.peak - h >= 12) { o.fell = o.peak - h; o.fellT = 150; o.falls++; Sound.sfx('die'); this.shake = 6; } // a big fall
        o.peak = h;
      }
      if (o.fellT > 0) o.fellT--;
      if (++o.saveT >= 120 && p.onGround) { o.saveT = 0; this.saveOnlyUp(); }
    },
    saveOnlyUp(done) {
      const p = this.player, o = this.ou;
      const d = { best: o.best, bestTime: o.bestTime, falls: o.falls, time: this.time, x: Math.round(p.x), y: Math.round(p.y) };
      if (done) { delete d.x; delete d.y; d.time = 0; d.falls = 0; d.top = true; if (!d.bestTime || this.time < d.bestTime) d.bestTime = this.time; }
      OnlyUp.save(d);
    },

    // Continue from a saved checkpoint, keeping collectables and stats.
    loadSave(save) {
      const L = this.level;
      const cp = L.checkpoints[save.cp];
      if (cp) {
        cp.active = true;
        this.spawn = { x: cp.x * T + 3, y: cp.y * T + 1 };
        this.player = newPlayer(this.spawn);
        this.cam = clamp(this.spawn.x - W / 2, 0, L.w * T - W);
        this.camY = clamp(this.spawn.y + 8 - H * 0.6, 0, L.h * T - H);
      }
      (save.e || []).forEach((got, i) => { if (L.embers[i]) L.embers[i].got = got; });
      (save.f || []).forEach((got, i) => { if (L.fragments[i]) L.fragments[i].got = got; });
      this.deaths = save.stageDeaths || 0;
      this.time = save.stageTime || 0;
    },

    // Write mid-stage progress to the slot (normal saves only; hardcore saves per chapter).
    saveProgress(cpIndex) {
      if (!this.run || this.hardcore) return false;
      const d = this.run.data;
      const L = this.level;
      if (cpIndex !== undefined) d.cp = cpIndex;
      d.stageTime = this.time;
      d.stageDeaths = this.deaths;
      d.e = L.embers.map((e) => e.got);
      d.f = L.fragments.map((f) => f.got);
      return Slots.write(this.run.slot, d);
    },

    quit() {
      if (this.onlyUp) this.saveOnlyUp();
      this.saveProgress();
      toTitle();
    },

    // Stage finished: bank collectables and time, move the slot to the next stage.
    onStageClear() {
      if (!this.run) return;
      const d = this.run.data;
      const L = this.level;
      const was = d.found[L.id] || {};
      d.found[L.id] = { e: orBools(was.e, L.embers.map((e) => e.got)), f: orBools(was.f, L.fragments.map((f) => f.got)) };
      d.totalTime += this.time;
      d.totalDeaths += this.deaths;
      Object.assign(d, { stage: d.stage + 1, cp: -1, stageTime: 0, stageDeaths: 0, e: [], f: [] });
      if (d.stage >= CAMPAIGN.length) d.done = true;
      const newChapter = !d.done && CAMPAIGN[d.stage].stage === 0;
      if (!this.hardcore || d.done || newChapter) Slots.write(this.run.slot, d);
    },

    nextAfterClear() {
      if (this.netOn) { Net.backToRoom(); Sound.playMusic(true); setScene(Room); return; }
      if (!this.run) { toTitle(); return; }
      const d = this.run.data;
      if (d.done) { setScene(Ending, this.run); return; }
      const next = CAMPAIGN[d.stage];
      if (next.stage === 0) setScene(ChapterIntro, next.chapter, this.run);
      else startLevel(next, this.run);
    },

    // --- tile queries
    tileAt(tx, ty) {
      if (ty < 0 || ty >= this.level.h || tx < 0 || tx >= this.level.w) return '.';
      return this.level.tiles[ty][tx];
    },
    solidAt(tx, ty) {
      if (tx < 0 || tx >= this.level.w) return true; // level edges are walls
      const t = this.tileAt(tx, ty);
      if (t === '#' || t === '=' || t === 'i' || t === 'G') return true;
      if (t === 'B') return this.sw === 1;
      if (t === 'R') return this.sw === 0;
      if (t === 'c') {
        const c = this.crumbles.get(tx + ',' + ty);
        return !(c && c.gone > 0);
      }
      return false;
    },
    rectSolid(x, y, w, h) {
      const x0 = Math.floor(x / T), x1 = Math.floor((x + w - 0.001) / T);
      const y0 = Math.floor(y / T), y1 = Math.floor((y + h - 0.001) / T);
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (this.solidAt(tx, ty)) return true;
      return false;
    },
    touchingWall(p, side) {
      const x = side > 0 ? p.x + p.w + 1 : p.x - 1;
      if (!this.rectSolid(x, p.y + 2, 0.5, p.h - 4)) return false;
      // locked gates are too smooth to slide on or climb
      const tx = Math.floor(x / T);
      for (let ty = Math.floor((p.y + 2) / T); ty <= Math.floor((p.y + p.h - 3) / T); ty++) if (this.tileAt(tx, ty) === 'G') return false;
      return true;
    },

    // Unlock a gate: the whole column of gate tiles opens.
    openGate(tx, ty) {
      const L = this.level;
      let y0 = ty, y1 = ty;
      while (this.tileAt(tx, y0 - 1) === 'G') y0--;
      while (this.tileAt(tx, y1 + 1) === 'G') y1++;
      for (let y = y0; y <= y1; y++) {
        L.tiles[y][tx] = '.';
        if (y % 2 === 0) this.burst(tx * T + 8, y * T + 8, [PAL.y, PAL.l], 3, 1.2);
      }
      this.keysHeld--;
      Sound.sfx('check');
    },

    // Fire vent cycle: 0 = cool, 1 = about to fire (smoke), 2 = flames.
    ventState(v) {
      const t = ((this.hz || 0) + v.phase) % 200;
      return t < 100 ? 0 : t < 130 ? 1 : 2;
    },

    onLadder(p) {
      const cx = Math.floor((p.x + p.w / 2) / T);
      for (let ty = Math.floor(p.y / T); ty <= Math.floor((p.y + p.h - 1) / T); ty++) if (this.tileAt(cx, ty) === 'H') return true;
      return false;
    },
    onLadderTop(p) {
      return p.onGround && this.tileAt(Math.floor((p.x + p.w / 2) / T), Math.floor((p.y + p.h + 1) / T)) === 'H';
    },

    onThru(p) {
      if (!p.onGround) return false;
      const ty = Math.floor((p.y + p.h + 1) / T);
      for (let tx = Math.floor(p.x / T); tx <= Math.floor((p.x + p.w - 0.01) / T); tx++) if (this.tileAt(tx, ty) !== '-' && this.solidAt(tx, ty)) return false;
      return [Math.floor(p.x / T), Math.floor((p.x + p.w - 0.01) / T)].some((tx) => this.tileAt(tx, ty) === '-');
    },

    onIce(p) {
      const ty = Math.floor((p.y + p.h + 0.5) / T);
      return this.tileAt(Math.floor((p.x + p.w / 2) / T), ty) === 'i';
    },

    // Wind cycle for storm stages: 0 calm, 1 warning, 2 gust.
    gust() {
      if (!this.level.wind) return 0;
      const t = this.windT % 420;
      return t < 250 ? 0 : t < 290 ? 1 : 2;
    },

    moveX(p, dx) {
      p.x += dx;
      if (!this.rectSolid(p.x, p.y, p.w, p.h)) return false;
      if (dx > 0) p.x = Math.floor((p.x + p.w - 0.001) / T) * T - p.w;
      else p.x = (Math.floor(p.x / T) + 1) * T;
      return true;
    },
    moveY(p, dy) {
      const prevBottom = p.y + p.h;
      p.y += dy;
      p.onGround = false;
      p.riding = null;
      if (this.rectSolid(p.x, p.y, p.w, p.h)) {
        if (dy > 0) {
          p.y = Math.floor((p.y + p.h - 0.001) / T) * T - p.h;
          p.onGround = true;
        } else {
          p.y = (Math.floor(p.y / T) + 1) * T;
        }
        p.vy = 0;
      }
      // the top of a ladder can be stood on (unless you're climbing it)
      if (dy >= 0 && !p.climbing) {
        const r = Math.floor((p.y + p.h) / T);
        for (let tx = Math.floor(p.x / T); tx <= Math.floor((p.x + p.w - 0.01) / T); tx++) {
          if (this.tileAt(tx, r) === 'H' && this.tileAt(tx, r - 1) !== 'H' && prevBottom <= r * T + 0.01 && p.y + p.h >= r * T) {
            p.y = r * T - p.h;
            p.vy = 0;
            p.onGround = true;
          }
        }
      }
      // wooden platforms: solid only from above (and not while dropping through)
      if (dy >= 0 && !p.dropT) {
        const r = Math.floor((p.y + p.h) / T);
        for (let tx = Math.floor(p.x / T); tx <= Math.floor((p.x + p.w - 0.01) / T); tx++) {
          if (this.tileAt(tx, r) === '-' && prevBottom <= r * T + 0.01 && p.y + p.h >= r * T) {
            p.y = r * T - p.h;
            p.vy = 0;
            p.onGround = true;
          }
        }
      }
      // one-way moving platforms
      if (dy >= 0) {
        for (const m of this.level.movers) {
          if (p.x + p.w > m.x && p.x < m.x + m.w && prevBottom <= m.y + 0.01 && p.y + p.h >= m.y) {
            p.y = m.y - p.h;
            p.vy = 0;
            p.onGround = true;
            p.riding = m;
          }
        }
      }
    },

    burst(x, y, colors, n = 12, speed = 2) {
      if (!Config.g.particles) return;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
        const s = speed * (0.5 + Math.random() * 0.7);
        this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 20 + (Math.random() * 15) | 0, color: colors[i % colors.length] });
      }
    },

    die() {
      const p = this.player;
      if (p.dead) return;
      p.dead = true;
      p.deadT = 0;
      this.deaths++;
      this.shake = 8;
      this.burst(p.x + p.w / 2, Math.min(p.y + p.h / 2, this.level.h * T - 4), [PAL.r, PAL.w, PAL.y], 16, 2.5);
      Sound.sfx('die');
    },

    respawn() {
      this.player = newPlayer(this.spawn);
      this.orbs = [];
      if (this.boss && this.boss.hp > 0) this.bossTo('rise');
      this.crumbles.clear();
      for (const c of this.level.crystals) c.gone = 0;
      this.trail = [];
    },

    update() {
      if (this.state === 'paused') {
        const c = this.pauseMenu.update();
        if (hit('Escape') || tap('pause') || (c && c.id === 'resume')) this.state = 'play';
        else if (c && c.id === 'quit') { if (this.netOn) this.nextAfterClear(); else this.quit(); }
        return;
      }
      this.updateWorld();
      if (this.state === 'clear') {
        this.clearT++;
        if (this.clearT > 60 && (hit(...K.ok) || Input.mouse.click)) {
          Sound.sfx('select');
          this.nextAfterClear();
        }
        return;
      }
      if (this.state === 'ending') {
        if (++this.clearT > 100) setScene(Ending, this.run);
        return;
      }
      if (hit('Escape') || tap('pause')) {
        this.state = 'paused';
        this.pauseMenu.index = 0;
        Sound.sfx('pause');
        return;
      }
      this.time++;
      if (this.intro > 0) this.intro--;
      this.updatePlayer();
      if (this.onlyUp) this.updateOnlyUp();
      if (this.netOn && frame % 3 === 0) {
        const p = this.player;
        Net.send({ t: 'st', x: Math.round(p.x), y: Math.round(p.y), f: p.face, p: this.poseOf(p), d: p.dead ? 1 : 0, l: this.level.id });
      }
    },

    // Things that move regardless of the player (platforms, crumbles, fx).
    updateWorld() {
      for (const m of this.level.movers) {
        const px = m.x;
        // pause at each end so there's time to step on or off
        if (m.wait > 0) m.wait--;
        else {
          m.x += m.dir * m.speed;
          if (m.x >= m.x1) { m.x = m.x1; m.dir = -1; m.wait = 50; }
          if (m.x <= m.x0) { m.x = m.x0; m.dir = 1; m.wait = 50; }
        }
        m.dx = m.x - px;
      }
      for (const [key, c] of this.crumbles) {
        if (c.gone > 0) {
          c.gone--;
          if (c.gone === 0) {
            const [tx, ty] = key.split(',').map(Number);
            if (overlap(this.player, { x: tx * T, y: ty * T, w: T, h: T })) c.gone = 1;
            else this.crumbles.delete(key);
          }
        } else if (++c.t >= 28) {
          c.gone = 150;
          const [tx, ty] = key.split(',').map(Number);
          this.burst(tx * T + 8, ty * T + 8, ['#c84c0c', '#fc9838', '#502000'], 8, 1.5);
          Sound.sfx('crumble');
        }
      }
      for (const c of this.level.crystals) if (c.gone > 0) c.gone--;
      for (const s of this.level.springs) if (s.t > 0) s.t--;
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const q = this.particles[i];
        q.x += q.vx;
        q.y += q.vy;
        q.vy += 0.08;
        q.vx *= 0.95;
        if (--q.life <= 0) this.particles.splice(i, 1);
      }
      for (let i = this.trail.length - 1; i >= 0; i--) if (--this.trail[i].life <= 0) this.trail.splice(i, 1);
      if (this.shake > 0) this.shake--;
      if (this.toast > 0) this.toast--;
      this.hz = (this.hz || 0) + 1; // hazard clock (fire vents)
      for (const sw of this.level.saws) {
        sw.x += sw.dir * sw.speed;
        if (sw.x >= sw.x1 - 8) { sw.x = sw.x1 - 8; sw.dir = -1; }
        if (sw.x <= sw.x0 + 8) { sw.x = sw.x0 + 8; sw.dir = 1; }
      }
      if (this.level.wind && this.state === 'play') {
        this.windT++;
        if (this.windT % 420 === 290) Sound.sfx('gust');
      }
      for (const m of this.motes) {
        m.y += m.v;
        m.x += Math.sin(frame / 50 + m.p) * 0.2;
        if (m.y > H) { m.y = -2; m.x = Math.random() * W; }
      }
      for (const wt of this.level.watchers) {
        if (!wt.fade || wt.gone) continue;
        if (++wt.fade > 40) {
          wt.gone = true;
          this.burst(wt.x * T + 8, wt.y * T + 8, [PAL.x, '#342468', PAL.e], 14, 1.2);
        }
      }
      if (this.message && this.state === 'play' && --this.message.t <= 0) this.message = null;
    },

    updatePlayer() {
      const p = this.player;
      const L = this.level;
      if (p.dead) {
        if (++p.deadT > 36) this.respawn();
        return;
      }

      // ride moving platforms
      if (p.riding) this.moveX(p, p.riding.dx);

      const dir = (act('right') ? 1 : 0) - (act('left') ? 1 : 0);
      if (tap('jump')) p.buffer = P.buffer;
      else if (p.buffer > 0) p.buffer--;
      if (p.onGround) p.coyote = P.coyote;
      else if (p.coyote > 0) p.coyote--;
      if (p.lock > 0) p.lock--;
      if (p.onGround && !p.dashing) p.dashes = 1;

      // --- drop down through a wooden platform
      if (p.dropT > 0) p.dropT--;
      if (tap('down') && !p.dashing && !p.climbing && !this.onLadderTop(p) && this.onThru(p)) {
        p.dropT = 10;
        p.onGround = false;
        p.coyote = 0;
        p.y += 1;
      }

      // --- grab a ladder (up while on one, or down while on one / standing on its top)
      if (!p.dashing && !p.climbing && ((act('up') && this.onLadder(p)) || (act('down') && (this.onLadder(p) || this.onLadderTop(p))))) {
        p.climbing = true;
        p.vx = 0;
        p.vy = 0;
        p.x = Math.floor((p.x + p.w / 2) / T) * T + (T - p.w) / 2; // line up with the ladder
        if (this.onLadderTop(p) && !this.onLadder(p)) p.y += 2;
      }

      // --- dash
      if (tap('dash') && p.dashes > 0 && !p.dashing) {
        p.climbing = false;
        let dx = dir;
        let dy = (act('down') ? 1 : 0) - (act('up') ? 1 : 0);
        if (!dx && !dy) dx = p.face;
        const len = Math.hypot(dx, dy);
        p.vx = (dx / len) * P.dashSpeed;
        p.vy = (dy / len) * P.dashSpeed;
        p.dashing = P.dashTime;
        p.dashes = 0;
        p.bounced = false;
        if (dx) p.face = Math.sign(dx);
        this.shake = 3;
        Sound.sfx('dash');
      }

      if (p.dashing) {
        p.dashing--;
        if (frame % 2 === 0) this.trail.push({ x: p.x, y: p.y, face: p.face, life: 12 });
        if (!p.dashing) {
          p.vx = clamp(p.vx, -P.maxRun * 1.3, P.maxRun * 1.3);
          if (p.vy < 0) p.vy *= 0.5;
        }
      } else if (p.climbing) {
        // --- on a ladder: no gravity, climb with up/down, shuffle sideways, jump off
        p.vy = (act('down') ? 1.5 : 0) - (act('up') ? 1.5 : 0);
        p.vx = dir * 0.9;
        if (dir) p.face = dir;
        p.coyote = P.coyote;
        p.dashes = 1;
        if (p.buffer > 0) {
          p.climbing = false;
          p.vy = P.jump;
          p.buffer = 0;
          p.coyote = 0;
          Sound.sfx('jump');
        }
      } else {
        // --- run
        const onIce = p.onGround && this.onIce(p);
        if (p.lock <= 0) {
          const accel = onIce ? 0.06 : p.onGround ? P.accelGround : P.accelAir;
          if (dir) {
            if (Math.abs(p.vx) > P.maxRun && Math.sign(p.vx) === dir) p.vx -= Math.sign(p.vx) * 0.05; // keep dash momentum a bit
            else p.vx = clamp(p.vx + dir * accel, -P.maxRun, P.maxRun);
            p.face = dir;
          } else {
            const f = onIce ? 0.015 : p.onGround ? P.frictionGround : P.frictionAir;
            p.vx = Math.abs(p.vx) <= f ? 0 : p.vx - Math.sign(p.vx) * f;
          }
        }

        // --- wind gusts push you back toward the start
        if (this.gust() === 2) {
          p.vx = Math.max(p.vx - (p.onGround ? 0.1 : 0.17), -2.4);
        }

        // --- jump / wall jump
        if (p.buffer > 0) {
          if (p.coyote > 0) {
            p.vy = P.jump;
            p.buffer = 0;
            p.coyote = 0;
            p.bounced = false;
            Sound.sfx('jump');
            this.burst(p.x + p.w / 2, p.y + p.h, [PAL.l, PAL.w], 5, 0.8);
          } else {
            const side = this.touchingWall(p, 1) ? 1 : this.touchingWall(p, -1) ? -1 : 0;
            if (side) {
              // Holding toward the wall = climb jump (small hop, stays on the wall);
              // otherwise kick off the wall.
              const climb = dir === side;
              p.vy = P.jump;
              p.vx = -side * (climb ? P.climbX : P.wallJumpX);
              p.face = climb ? side : -side;
              p.lock = climb ? P.climbLock : P.wallLock;
              p.buffer = 0;
              p.bounced = false;
              Sound.sfx('walljump');
              this.burst(side > 0 ? p.x + p.w : p.x, p.y + p.h / 2, [PAL.l, PAL.w], 5, 0.8);
            }
          }
        }
        if (!act('jump') && !p.bounced && p.vy < P.jumpCut) p.vy = P.jumpCut;

        // --- gravity (floatier at the apex while holding jump)
        const g = act('jump') && Math.abs(p.vy) < 0.8 ? P.apexGravity : P.gravity;
        p.vy = Math.min(p.vy + g, P.maxFall);
        if (p.vy >= 0) p.bounced = false;

        // --- wall slide
        p.sliding = !p.onGround && p.vy > 0 && dir !== 0 && this.touchingWall(p, dir);
        if (p.sliding) {
          p.vy = Math.min(p.vy, P.wallSlide);
          if (frame % 5 === 0) this.particles.push({ x: dir > 0 ? p.x + p.w : p.x, y: p.y + 4, vx: -dir * 0.3, vy: 0, life: 10, color: PAL.l });
        }
      }

      if (this.moveX(p, p.vx)) {
        p.vx = 0;
        if (p.dashing) p.dashing = 0;
      }
      const wasGround = p.onGround;
      this.moveY(p, p.vy);
      if (p.onGround && !wasGround && !p.climbing) this.burst(p.x + p.w / 2, p.y + p.h, [PAL.l], 4, 0.6);
      if (p.climbing) {
        const cx = Math.floor((p.x + p.w / 2) / T);
        if (p.onGround && p.vy > 0) p.climbing = false; // climbed down to the floor
        else if (p.vy < 0 && this.tileAt(cx, Math.floor((p.y + p.h - 0.5) / T)) !== 'H') {
          // reached the top: step onto it
          p.y = Math.ceil((p.y + p.h) / T) * T - p.h;
          p.vy = 0;
          p.climbing = false;
          p.onGround = true;
        } else if (!this.onLadder(p)) p.climbing = false;
      }
      // sliding on ice: little sparkles
      if (p.onGround && Math.abs(p.vx) > 1 && this.onIce(p) && frame % 3 === 0 && Config.g.particles) {
        this.particles.push({ x: p.x + (p.vx > 0 ? 0 : p.w), y: p.y + p.h - 1, vx: -p.vx * 0.2, vy: -0.4, life: 14, color: frame % 6 ? PAL.w : PAL.C });
      }

      // --- crumbling blocks start to shake when stood on
      if (p.onGround && !p.riding) {
        const ty = Math.floor((p.y + p.h + 0.5) / T);
        for (let tx = Math.floor(p.x / T); tx <= Math.floor((p.x + p.w - 0.001) / T); tx++) {
          const key = tx + ',' + ty;
          if (this.tileAt(tx, ty) === 'c' && !this.crumbles.has(key)) this.crumbles.set(key, { t: 0, gone: 0 });
        }
      }

      p.anim += p.onGround ? Math.abs(p.vx) : 0;

      // --- hazards
      if (p.y > L.h * T) return this.die();
      const x0 = Math.floor(p.x / T), x1 = Math.floor((p.x + p.w - 0.001) / T);
      const y0 = Math.floor(p.y / T), y1 = Math.floor((p.y + p.h - 0.001) / T);
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          if (this.tileAt(tx, ty) === '^' && overlap(p, { x: tx * T + 2, y: ty * T + 9, w: 12, h: 7 })) return this.die();
        }
      }

      for (const sw of L.saws) {
        const nx = clamp(sw.x, p.x, p.x + p.w), ny = clamp(sw.y, p.y, p.y + p.h);
        if ((nx - sw.x) ** 2 + (ny - sw.y) ** 2 < 36) return this.die();
      }
      for (const v of L.vents) {
        if (this.ventState(v) === 2 && overlap(p, { x: v.x * T + 3, y: v.y * T - 46, w: 10, h: 46 })) return this.die();
      }
      if (this.boss) { this.updateBoss(); if (p.dead) return; }

      // --- objects
      for (const s of L.springs) {
        const r = { x: s.x * T + 1, y: s.y * T + 10, w: 14, h: 6 };
        if (p.vy >= 0 && overlap(p, r)) {
          p.y = r.y - p.h;
          p.vy = P.spring;
          p.dashing = 0;
          p.dashes = 1;
          p.bounced = true;
          s.t = 12;
          Sound.sfx('spring');
        }
      }
      for (const c of L.crystals) {
        if (c.gone || p.dashes > 0) continue;
        if (overlap(p, { x: c.x * T - 2, y: c.y * T - 2, w: 20, h: 20 })) {
          p.dashes = 1;
          c.gone = 150;
          this.burst(c.x * T + 8, c.y * T + 8, [PAL.c, PAL.C, PAL.w], 12, 1.8);
          Sound.sfx('crystal');
        }
      }
      for (const e of L.embers) {
        if (!e.got && overlap(p, { x: e.x * T + 3, y: e.y * T + 3, w: 10, h: 10 })) {
          e.got = true;
          this.burst(e.x * T + 8, e.y * T + 8, ['#fc9838', PAL.y, PAL.r], 14, 1.6);
          Sound.sfx('ember');
        }
      }
      for (const fr of L.fragments) {
        if (!fr.got && overlap(p, { x: fr.x * T + 2, y: fr.y * T + 2, w: 12, h: 14 })) {
          fr.got = true;
          this.message = { title: 'MEMORY FRAGMENT', text: fr.text, color: PAL.V, t: 300, t0: 300 };
          this.burst(fr.x * T + 8, fr.y * T + 6, [PAL.v, PAL.V, PAL.w], 16, 1.5);
          Sound.sfx('fragment');
        }
      }
      for (const wt of L.watchers) {
        if (wt.gone || wt.fade) continue;
        if (Math.abs(p.x + p.w / 2 - (wt.x * T + 8)) < 72) {
          wt.fade = 1;
          this.message = { title: '???', text: wt.text, color: PAL.e, t: 200, t0: 200 };
          Sound.sfx('whisper');
        }
      }
      for (const k of L.keys) {
        if (!k.got && overlap(p, { x: k.x * T + 2, y: k.y * T + 2, w: 12, h: 12 })) {
          k.got = true;
          this.keysHeld++;
          this.burst(k.x * T + 8, k.y * T + 8, [PAL.y, PAL.w], 12, 1.5);
          Sound.sfx('ember');
        }
      }
      for (const side of [1, -1]) {
        const tx = Math.floor((side > 0 ? p.x + p.w + 1 : p.x - 1) / T);
        for (let ty = Math.floor(p.y / T); ty <= Math.floor((p.y + p.h - 1) / T); ty++) {
          if (this.tileAt(tx, ty) !== 'G') continue;
          if (this.keysHeld > 0) this.openGate(tx, ty);
          else if (!this.message || this.message.t < 20) this.message = { title: 'LOCKED', text: 'YOU NEED A KEY.', color: PAL.y, t: 90, t0: 90 };
          break;
        }
      }
      for (const o of L.orbs) {
        const touching = overlap(p, { x: o.x * T + 2, y: o.y * T + 2, w: 12, h: 12 });
        if (touching && !o.touch) {
          this.sw = 1 - this.sw;
          this.burst(o.x * T + 8, o.y * T + 8, [PAL.c, PAL.w, PAL.e], 12, 1.6);
          Sound.sfx('crystal');
          this.shake = 3;
        }
        o.touch = touching;
      }
      for (const cp of L.checkpoints) {
        if (!cp.active && overlap(p, { x: cp.x * T, y: cp.y * T - 8, w: T, h: 24 })) {
          for (const o of L.checkpoints) o.active = false;
          cp.active = true;
          this.spawn = { x: cp.x * T + 3, y: cp.y * T + 1 };
          this.burst(cp.x * T + 12, cp.y * T - 2, [PAL.G, PAL.w], 10, 1.2);
          Sound.sfx('check');
          if (this.saveProgress(L.checkpoints.indexOf(cp))) this.toast = 120;
        }
      }
      const ef = L.everflame;
      if (ef && overlap(p, { x: ef.x * T - 8, y: (ef.y - 2) * T, w: 32, h: 3 * T })) {
        this.state = this.netOn ? 'clear' : 'ending';
        if (this.netOn) Net.send({ t: 'fin', time: this.time, deaths: this.deaths });
        this.clearT = 0;
        p.vx = 0;
        this.burst(ef.x * T + 8, ef.y * T - 8, [PAL.y, PAL.w, '#fc9838', PAL.r], 40, 3);
        Sound.sfx('clear');
        this.onStageClear();
      }
      const f = L.flag;
      if (f && overlap(p, { x: f.x * T + 4, y: (f.y - 3) * T, w: 8, h: 4 * T })) {
        if (this.onlyUp) { this.ou.best = Math.max(this.ou.best, this.heightOf(p)); this.saveOnlyUp(true); }
        this.state = 'clear';
        this.clearT = 0;
        this.onStageClear();
        if (this.netOn) Net.send({ t: 'fin', time: this.time, deaths: this.deaths });
        p.vx = 0;
        this.burst(f.x * T + 8, (f.y - 3) * T, [PAL.y, PAL.w, PAL.G, PAL.c], 24, 2.5);
        Sound.sfx('clear');
      }

      // --- camera
      const target = p.x + p.w / 2 - W / 2 + p.face * 20;
      this.cam += (target - this.cam) * 0.1;
      this.cam = clamp(this.cam, 0, L.w * T - W);
      const targetY = p.y + p.h / 2 - H * 0.55;
      this.camY += (targetY - this.camY) * 0.12;
      this.camY = clamp(this.camY, 0, L.h * T - H);
    },

    // ------------------------------------------------------------ drawing
    draw() {
      const L = this.level;
      const p = this.player;
      const sx = this.shake ? Math.round((Math.random() - 0.5) * this.shake) : 0;
      const sy = this.shake ? Math.round((Math.random() - 0.5) * this.shake) : 0;
      const cx = Math.round(this.cam);
      drawBackground(ctx, cx, frame);
      if (L.tint) {
        ctx.fillStyle = L.tint;
        ctx.fillRect(0, 0, W, H);
      }
      ctx.fillStyle = '#4c3c8c';
      for (const m of this.motes.slice(0, Config.g.dust)) {
        const mx = (((m.x - cx * 0.6) % W) + W) % W;
        ctx.fillRect(Math.round(mx), Math.round(m.y), 1, 1);
      }

      const cy = Math.round(this.camY);
      ctx.save();
      ctx.translate(-cx + sx, -cy + sy);
      const ty0 = Math.max(0, Math.floor(cy / T) - 1), ty1 = Math.min(L.h - 1, ty0 + Math.ceil(H / T) + 2);

      // tiles
      const isGround = (x, y) => y < 0 || y >= L.h || this.tileAt(x, y) === '#' || this.tileAt(x, y) === 'i';
      const tx0 = Math.floor(cx / T) - 1;
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx0 + Math.ceil(W / T) + 1; tx++) {
          const t = this.tileAt(tx, ty);
          if (t === '.') continue;
          const px = tx * T, py = ty * T;
          if (t === '#') drawGround(px, py, tx, ty, isGround); else if (t === '=') ctx.drawImage(TILES.brick, px, py);
          else if (t === 'i') ctx.drawImage(TILES.ice, px, py);
          else if (t === 'H') ctx.drawImage(TILES.ladder, px, py);
          else if (t === '-') this.drawThru(px, py, this.tileAt(tx - 1, ty) !== '-', this.tileAt(tx + 1, ty) !== '-');
          else if (t === 'G') this.drawGateTile(px, py, this.tileAt(tx, ty + 1) !== 'G', this.tileAt(tx, ty - 1) !== 'G');
          else if (t === 'B' || t === 'R') this.drawSwitchBlock(px, py, t, this.solidAt(tx, ty));
          else if (t === '^') ctx.drawImage(TILES.spike, px, py);
          else if (t === 'c') {
            const c = this.crumbles.get(tx + ',' + ty);
            if (c && c.gone > 0) {
              if (c.gone < 30 && c.gone % 4 < 2) ctx.drawImage(TILES.crumble, px, py);
              else {
                ctx.fillStyle = '#502000';
                for (let i = 0; i < 16; i += 4) { ctx.fillRect(px + i, py, 2, 1); ctx.fillRect(px + i, py + 15, 2, 1); }
              }
            } else {
              const jig = c ? ((frame >> 1) % 2 ? 1 : -1) : 0;
              ctx.drawImage(TILES.crumble, px + jig, py);
            }
          }
        }
      }

      // decorations on grass tops and roots under overhangs
      if (Config.g.deco) for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx0 + Math.ceil(W / T) + 1; tx++) {
          if (this.tileAt(tx, ty) !== '#') continue;
          if (ty > 0 && this.tileAt(tx, ty - 1) === '.') this.drawDeco(tx, ty);
          if (ty + 1 < L.h && this.tileAt(tx, ty + 1) === '.') this.drawRoots(tx, ty);
        }
      }

      for (const m of L.movers) this.drawMover(m);
      for (const k of L.keys) if (!k.got) this.drawKey(k.x * T + 8, k.y * T + 8 + Math.round(Math.sin((frame + k.x * 9) / 12) * 2));
      for (const o of L.orbs) this.drawOrb(o.x * T + 8, o.y * T + 8 + Math.round(Math.sin((frame + o.x * 5) / 14) * 1.5));
      for (const v of L.vents) this.drawVent(v);
      for (const sw of L.saws) this.drawSaw(sw.x, sw.y);
      for (const s of L.signs) ctx.drawImage(SIGN_SPR, s.x * T, s.y * T);
      for (const cp of L.checkpoints) ctx.drawImage(cp.active ? CHECKPOINT_SPR.on : CHECKPOINT_SPR.off, cp.x * T, cp.y * T - 8);
      for (const s of L.springs) this.drawSpring(s);
      for (const c of L.crystals) this.drawCrystal(c);
      for (const e of L.embers) if (!e.got) this.drawEmber(e);
      if (L.flag) this.drawFlag(L.flag);
      if (L.everflame) this.drawEverflame(L.everflame);
      if (this.boss) this.drawBoss();
      for (const fr of L.fragments) {
        if (fr.got) continue;
        ctx.drawImage(FRAGMENT_SPR, fr.x * T + 2, fr.y * T + 2);
        if (frame % 40 < 20) {
          ctx.fillStyle = PAL.V;
          ctx.fillRect(fr.x * T + 2 + ((frame / 3) % 12 | 0), fr.y * T + 1 - ((frame % 20) >> 2), 1, 1);
        }
      }
      for (const wt of L.watchers) {
        if (wt.gone) continue;
        const facing = p.x < wt.x * T ? 'left' : 'right';
        const glitch = wt.fade ? Math.round((Math.random() - 0.5) * wt.fade / 6) : 0;
        ctx.globalAlpha = wt.fade ? Math.max(0, 1 - wt.fade / 40) : 0.85 + Math.sin(frame / 20) * 0.15;
        ctx.drawImage(WATCHER_SPR[facing], wt.x * T + 2 + glitch, wt.y * T);
        ctx.globalAlpha = 1;
      }

      // dash afterimages
      for (const t of this.trail) {
        ctx.globalAlpha = t.life / 24;
        ctx.drawImage(PLAYER_SPR.nodash.jump[t.face > 0 ? 'right' : 'left'], Math.round(t.x) - 1, Math.round(t.y) - 1);
      }
      ctx.globalAlpha = 1;

      if (this.netOn) this.drawRemotePlayers();
      if (!p.dead) {
        const pose = this.poseOf(p);
        const set = p.dashes > 0 || p.dashing ? 'dash' : 'nodash';
        const spr = PLAYER_SPR[set][pose][p.face > 0 ? 'right' : 'left'];
        ctx.drawImage(spr, Math.round(p.x) - 1, Math.round(p.y) - 1);
      }

      for (const q of this.particles) {
        ctx.fillStyle = q.color;
        ctx.fillRect(Math.round(q.x), Math.round(q.y), 1, 1);
      }
      ctx.restore();

      if (L.rain && Config.g.rain) drawRain();
      const gust = this.gust();
      if (gust === 2 && Config.g.particles) {
        ctx.fillStyle = 'rgba(220,230,255,0.45)';
        for (let i = 0; i < 26; i++) {
          const yy = (decoRoll(i, 7) * 3) % (H - 20) + 14;
          const xx = W - ((frame * (9 + (i % 4)) + decoRoll(i, 8) * 5) % (W + 60));
          ctx.fillRect(xx, yy, 14 + (i % 3) * 6, 1);
        }
      }
      this.drawHud();
      if (gust) drawTextOutlined(ctx, gust === 2 ? '<< GUST! <<' : 'WIND RISING...', W / 2, 16, gust === 2 ? PAL.e : PAL.C, 1, 'center');
      if (this.toast > 0 && (this.toast > 30 || this.toast % 8 < 4)) {
        ctx.drawImage(CHECKPOINT_SPR.on, W - 104, H - 28);
        drawTextOutlined(ctx, 'PROGRESS SAVED', W - 6, H - 16, PAL.G, 1, 'right');
      }
      this.drawSignText();
      this.drawMessage();

      if (this.intro > 0 && this.state === 'play') {
        const y = this.intro > 130 ? 100 - (this.intro - 130) * 3 : 100;
        drawTextOutlined(ctx, this.level.name, W / 2, y, PAL.y, 2, 'center');
        if (this.level.objective) drawTextOutlined(ctx, 'OBJECTIVE: ' + this.level.objective, W / 2, y + 22, PAL.C, 1, 'center');
      }
      if (this.state === 'paused') this.drawPause();
      if (this.state === 'clear') this.drawClear();
    },

    drawDeco(tx, ty) {
      const px = tx * T, py = ty * T;
      const r = decoRoll(tx, ty);
      const tall = !this.decoBlock.has(tx) && this.tileAt(tx, ty - 2) === '.';
      if (r < 7 && tall) ctx.drawImage(DECO.pine, px + 1, py - 25);
      else if (r < 15 && tall) ctx.drawImage(DECO.bush, px + 2, py - 6);
      else if (r < 25) ctx.drawImage(DECO.rock, px + (r % 9), py - 3);
      else if (r < 40) ctx.drawImage(DECO.flowers[r % 4], px + (r % 13), py - 4);
      if (decoRoll(tx, ty + 7) < 45) ctx.drawImage(DECO.tuft, px + (decoRoll(tx, ty + 11) % 11), py - 3);
    },

    drawRoots(tx, ty) {
      const r = decoRoll(tx, ty + 3);
      if (r > 60) return;
      const px = tx * T, py = ty * T + 16;
      ctx.fillStyle = '#4c2c10';
      ctx.fillRect(px + 3 + (r % 5), py, 1, 3 + (r % 4));
      ctx.fillRect(px + 11, py, 1, 2 + (r % 3));
      ctx.fillStyle = PAL.q;
      ctx.fillRect(px + 3 + (r % 5), py + 3 + (r % 4), 1, 1);
    },

    // ------------------------------------------------------------ boss: the Watcher
    bossTo(state) {
      const B = this.boss;
      B.state = state;
      B.t = 0;
      if (state === 'float') {
        B.tx = 70 + Math.random() * 340;
        B.ty = 60 + Math.random() * 50;
      }
      if (state === 'dive') B.vy = 0;
    },

    fireVolley() {
      const B = this.boss, p = this.player;
      const phase = Math.min(5, B.maxHp - B.hp + B.bonus);
      const n = 3 + Math.min(phase, 4);
      const base = Math.atan2(p.y + p.h / 2 - B.y, p.x + p.w / 2 - B.x);
      const speed = 1.5 + phase * 0.22;
      for (let i = 0; i < n; i++) {
        const a = base + (i - (n - 1) / 2) * 0.2;
        this.orbs.push({ x: B.x, y: B.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 400 });
      }
      Sound.sfx('shoot');
    },

    updateBoss() {
      const B = this.boss, p = this.player, L = this.level;
      const phase = Math.min(5, B.maxHp - B.hp + B.bonus); // gets meaner with every hit
      B.t++;
      switch (B.state) {
        case 'intro':
          if (B.t === 20) this.message = { title: B.info.title, text: B.info.intro, color: PAL.e, t: 240, t0: 240 };
          if (B.t > 150) this.bossTo('float');
          break;
        case 'float':
          B.x += (B.tx - B.x) * 0.03;
          B.y += (B.ty - B.y) * 0.03 + Math.sin(B.t / 12) * 0.3;
          if (B.t > 110 - phase * 18) this.bossTo('windup');
          break;
        case 'windup':
          if (B.t > 40 - phase * 5) {
            this.fireVolley();
            B.volleys++;
            this.bossTo(B.volleys % (Math.floor(phase / 2) + 1) === 0 ? 'dive' : 'float');
          }
          break;
        case 'dive':
          B.vy = Math.min(B.vy + 0.35, 7);
          B.y += B.vy;
          if (B.y >= B.floorY) {
            B.y = B.floorY;
            this.shake = 6;
            this.burst(B.x, B.y + 14, [PAL.x, '#342468', PAL.e], 14, 1.5);
            Sound.sfx('crumble');
            this.bossTo('dazed');
          }
          break;
        case 'dazed':
          if (B.t > Math.max(80, 170 - phase * 20)) this.bossTo('rise'); // always a fair window to hit it
          break;
        case 'rise':
          B.y -= 1.6;
          if (B.y <= 90) this.bossTo('float');
          break;
        case 'hurt':
          B.y -= 1.2;
          if (B.t > 50) this.bossTo('float');
          break;
        case 'defeated':
          if (B.t === 150) {
            // the Everflame reappears
            const fx = B.info.spikes ? 24 : 14; // never over the spike pit
            L.everflame = { x: fx, y: L.h - 3 };
            this.burst(fx * T + 8, (L.h - 4) * T, [PAL.y, PAL.w, '#fc9838'], 30, 2.5);
            Sound.sfx('check');
          }
          break;
      }

      // shadow orbs
      for (let i = this.orbs.length - 1; i >= 0; i--) {
        const o = this.orbs[i];
        o.x += o.vx;
        o.y += o.vy;
        if (--o.life <= 0 || o.x < -8 || o.x > L.w * T + 8 || o.y < -8 || o.y > L.h * T || this.solidAt(Math.floor(o.x / T), Math.floor(o.y / T))) {
          this.orbs.splice(i, 1);
          continue;
        }
        if (overlap(p, { x: o.x - 3, y: o.y - 3, w: 6, h: 6 })) return this.die();
      }

      // touching the Watcher: a dash while it's dazed lands a hit, anything else hurts you
      const body = { x: B.x - 10, y: B.y - 15, w: 20, h: 30 };
      if (!overlap(p, body) || B.state === 'hurt' || B.state === 'defeated' || B.state === 'intro') return;
      if (B.state === 'dazed' && p.dashing) {
        B.hp--;
        p.dashes = 1;
        p.dashing = 0;
        p.vx = -p.vx * 0.6;
        p.vy = -3;
        this.shake = 10;
        this.burst(B.x, B.y, [PAL.w, PAL.e, '#342468'], 24, 2.5);
        Sound.sfx('bosshit');
        if (B.hp <= 0) {
          this.orbs = [];
          this.bossTo('defeated');
          B.y = B.floorY;
          this.message = { title: B.info.outro[0], text: B.info.outro[1], color: PAL.y, t: 300, t0: 300 };
        } else {
          this.bossTo('hurt');
        }
      } else if (B.state !== 'dazed') {
        this.die();
      }
    },

    drawBoss() {
      const B = this.boss, p = this.player;
      if (B.state === 'hurt' && B.t % 6 < 3) return;
      const face = p.x < B.x ? 'left' : 'right';
      ctx.save();
      if (B.state === 'intro') ctx.globalAlpha = Math.min(1, B.t / 90);
      if (B.state === 'defeated') ctx.globalAlpha = Math.max(0.15, 1 - B.t / 200);
      if (B.state === 'windup') {
        const r = 6 + (B.t % 10);
        ctx.fillStyle = 'rgba(252,60,60,0.25)';
        ctx.fillRect(Math.round(B.x - r), Math.round(B.y - r), r * 2, r * 2);
      }
      if (B.state === 'dazed' && B.t % 20 < 10) {
        // glowing outline: vulnerable!
        ctx.fillStyle = 'rgba(252,252,252,0.5)';
        ctx.fillRect(Math.round(B.x - 14), Math.round(B.y - 18), 28, 36);
      }
      ctx.drawImage(WATCHER_SPR[face], Math.round(B.x - 12), Math.round(B.y - 16), 24, 32);
      ctx.restore();
      if (B.state === 'dazed') {
        for (let i = 0; i < 3; i++) {
          const a = frame / 10 + (i * Math.PI * 2) / 3;
          ctx.fillStyle = PAL.y;
          ctx.fillRect(Math.round(B.x + Math.cos(a) * 12), Math.round(B.y - 22 + Math.sin(a) * 3), 2, 2);
        }
      }
      for (const o of this.orbs) {
        ctx.fillStyle = '#342468';
        ctx.fillRect(Math.round(o.x) - 3, Math.round(o.y) - 3, 6, 6);
        ctx.fillStyle = PAL.e;
        ctx.fillRect(Math.round(o.x) - 1, Math.round(o.y) - 1, 2, 2);
      }
    },

    poseOf(p) {
      if (p.climbing) return Math.floor(p.y / 6) % 2 ? 'walk1' : 'walk2';
      if (!p.onGround) return 'jump';
      if (Math.abs(p.vx) > 0.6 && this.onIce(p) && !act('left') && !act('right')) return 'jump'; // sliding
      if (Math.abs(p.vx) > 0.2) return Math.floor(p.anim / 10) % 2 ? 'walk1' : 'walk2';
      return 'idle';
    },

    // Other players in the same online race, with their names above them.
    drawRemotePlayers() {
      const now = Date.now();
      for (const id of Net.order) {
        if (id === Net.myId) continue;
        const pl = Net.players[id];
        if (!pl || pl.lvl !== this.level.id || pl.dead || now - (pl.seen || 0) > 3000 || pl.x === undefined) continue;
        const spr = playerSpritesFor(pl.color)[pl.pose] || playerSpritesFor(pl.color).idle;
        ctx.globalAlpha = 0.85;
        ctx.drawImage(spr[pl.face > 0 ? 'right' : 'left'], pl.x - 1, pl.y - 1);
        ctx.globalAlpha = 1;
        drawText(ctx, pl.name, pl.x + 5, pl.y - 10, pl.color === '#fcfcfc' ? PAL.l : pl.color, 1, 'center');
      }
    },

    drawGateTile(px, py, bottom, top) {
      // iron portcullis: a heavy frame, round bars and a riveted band every few tiles
      ctx.fillStyle = 'rgba(12,8,24,0.7)'; ctx.fillRect(px, py, 16, 16);
      for (const bx of [4, 8, 11]) {
        ctx.fillStyle = '#4c4c64'; ctx.fillRect(px + bx, py, 2, 16);
        ctx.fillStyle = '#9c9cb8'; ctx.fillRect(px + bx, py, 1, 16);
      }
      ctx.fillStyle = '#2c2c3c'; ctx.fillRect(px, py, 3, 16); ctx.fillRect(px + 13, py, 3, 16);
      ctx.fillStyle = '#6c6c88'; ctx.fillRect(px + 1, py, 1, 16); ctx.fillRect(px + 14, py, 1, 16);
      const band = (y) => {
        ctx.fillStyle = '#2c2c3c'; ctx.fillRect(px, y, 16, 3);
        ctx.fillStyle = '#6c6c88'; ctx.fillRect(px, y, 16, 1);
        ctx.fillStyle = '#bcbcd8'; ctx.fillRect(px + 1, y + 1, 1, 1); ctx.fillRect(px + 14, y + 1, 1, 1);
      };
      if (top) {
        band(py);
        ctx.fillStyle = '#9c9cb8'; for (const bx of [4, 8, 11]) { ctx.fillRect(px + bx, py - 3, 2, 3); ctx.fillRect(px + bx - 1, py - 1, 4, 1); } // spikes
      } else if (Math.round(py / 16) % 3 === 0) band(py + 6);
      if (bottom) { band(py + 13); this.drawPadlock(px + 1, py - 4); }
    },

    // wooden jump-through platform: a plank with nails, and little brackets at the ends
    drawThru(px, py, leftEnd, rightEnd) {
      ctx.fillStyle = '#503000'; ctx.fillRect(px, py, 16, 6);
      ctx.fillStyle = '#ac7c00'; ctx.fillRect(px, py, 16, 5);
      ctx.fillStyle = '#e4a444'; ctx.fillRect(px, py, 16, 1);
      ctx.fillStyle = '#7c5000'; ctx.fillRect(px + 7, py + 1, 1, 4); ctx.fillRect(px + 15, py + 1, 1, 4); // board seams
      ctx.fillStyle = '#3c2c2c'; ctx.fillRect(px + 3, py + 2, 1, 1); ctx.fillRect(px + 11, py + 2, 1, 1); // nails
      ctx.fillStyle = '#503000';
      if (leftEnd) { ctx.fillRect(px + 1, py + 6, 2, 4); ctx.fillRect(px + 1, py + 9, 1, 2); }
      if (rightEnd) { ctx.fillRect(px + 13, py + 6, 2, 4); ctx.fillRect(px + 14, py + 9, 1, 2); }
    },

    // golden padlock with a steel shackle and a keyhole
    drawPadlock(x, y) {
      const PADLOCK = [
        '....xxxxxx....',
        '...xsSSSSsx...',
        '..xsxxxxxxsx..',
        '..xSx....xSx..',
        '..xSx....xSx..',
        '..xsx....xsx..',
        'xxxxxxxxxxxxxx',
        'xhhhhhhhhhhhhx',
        'xyyyyxxxxyyyyx',
        'xyyyyxxxxyyyyx',
        'xyyyyyxxyyyyyx',
        'xyyyyyxxyyyyyx',
        'xyyyyyxxyyyyyx',
        'xddddddddddddx',
        'xxxxxxxxxxxxxx',
      ];
      const col = { x: '#0c0818', s: '#9c9cb8', S: '#fcfcfc', h: '#fce0a8', y: PAL.y, d: '#ac7c00' };
      const bob = Math.round(Math.sin(frame / 20) * 0.6);
      PADLOCK.forEach((row, j) => {
        for (let i = 0; i < row.length; i++) {
          if (row[i] === '.') continue;
          ctx.fillStyle = col[row[i]];
          ctx.fillRect(x + i, y + j + bob, 1, 1);
        }
      });
      if (frame % 90 < 6) { ctx.fillStyle = PAL.w; ctx.fillRect(x + 2, y + 8 + bob, 1, 2); } // glint
    },

    drawSwitchBlock(px, py, t, solid) {
      const main = t === 'B' ? '#0078f8' : PAL.r, light = t === 'B' ? PAL.C : '#fc9838', dark = t === 'B' ? '#0000bc' : PAL.R;
      if (solid) {
        ctx.fillStyle = dark; ctx.fillRect(px, py, 16, 16);
        ctx.fillStyle = main; ctx.fillRect(px + 1, py + 1, 14, 14);
        ctx.fillStyle = light; ctx.fillRect(px + 1, py + 1, 14, 1); ctx.fillRect(px + 1, py + 1, 1, 14);
        ctx.fillStyle = dark; ctx.fillRect(px + 5, py + 5, 6, 6);
      } else {
        ctx.fillStyle = main; // ghost: dotted outline
        for (let i = 0; i < 16; i += 3) { ctx.fillRect(px + i, py, 1, 1); ctx.fillRect(px + i, py + 15, 1, 1); ctx.fillRect(px, py + i, 1, 1); ctx.fillRect(px + 15, py + i, 1, 1); }
      }
    },

    drawKey(x, y) {
      ctx.fillStyle = PAL.D; ctx.fillRect(x - 5, y - 3, 6, 6);
      ctx.fillStyle = PAL.y; ctx.fillRect(x - 4, y - 2, 4, 4); ctx.fillRect(x, y - 1, 6, 2); ctx.fillRect(x + 3, y + 1, 1, 2); ctx.fillRect(x + 5, y + 1, 1, 2);
      ctx.fillStyle = PAL.D; ctx.fillRect(x - 3, y - 1, 2, 2);
      if (blink(10)) { ctx.fillStyle = PAL.w; ctx.fillRect(x - 4, y - 2, 1, 1); }
    },

    drawOrb(x, y) {
      const col = this.sw === 0 ? '#0078f8' : PAL.r; // shows what hitting it will switch on
      for (let j = -6; j <= 6; j++) {
        const h = Math.floor(Math.sqrt(36 - j * j));
        ctx.fillStyle = j < -2 ? PAL.w : col;
        ctx.fillRect(x - h, y + j, h * 2 + 1, 1);
      }
      ctx.fillStyle = PAL.w;
      const a = frame / 8;
      ctx.fillRect(Math.round(x + Math.cos(a) * 8), Math.round(y + Math.sin(a) * 8), 1, 1);
      ctx.fillRect(Math.round(x - Math.cos(a) * 8), Math.round(y - Math.sin(a) * 8), 1, 1);
    },

    drawSaw(x, y) {
      x = Math.round(x); y = Math.round(y);
      const a = frame / 3;
      ctx.fillStyle = PAL.n;
      for (let j = -6; j <= 6; j++) { const h = Math.floor(Math.sqrt(36 - j * j)); ctx.fillRect(x - h, y + j, h * 2 + 1, 1); }
      ctx.fillStyle = PAL.l;
      for (let j = -4; j <= 4; j++) { const h = Math.floor(Math.sqrt(16 - j * j)); ctx.fillRect(x - h, y + j, h * 2 + 1, 1); }
      ctx.fillStyle = PAL.w;
      for (let i = 0; i < 6; i++) { // teeth
        const t = a + (i * Math.PI) / 3;
        ctx.fillRect(Math.round(x + Math.cos(t) * 7) - 1, Math.round(y + Math.sin(t) * 7) - 1, 2, 2);
      }
      ctx.fillStyle = PAL.n; ctx.fillRect(x - 1, y - 1, 2, 2);
    },

    drawVent(v) {
      const x = v.x * T, y = v.y * T;
      ctx.fillStyle = PAL.n; ctx.fillRect(x + 2, y - 3, 12, 3);
      ctx.fillStyle = '#000000'; for (let i = 4; i < 13; i += 3) ctx.fillRect(x + i, y - 2, 1, 2);
      const st = this.ventState(v);
      if (st === 1) {
        // warning: puffs of smoke and sparks
        ctx.fillStyle = frame % 8 < 4 ? PAL.m : PAL.l;
        for (let i = 0; i < 4; i++) ctx.fillRect(x + 4 + ((frame + i * 5) % 8), y - 5 - ((frame + i * 7) % 10), 2, 2);
        if (frame % 6 < 3) { ctx.fillStyle = PAL.y; ctx.fillRect(x + 7, y - 4, 2, 1); }
      } else if (st === 2) {
        for (let i = 0; i < 26; i++) {
          const h = decoRoll((frame >> 1) + v.x, i) % 44;
          const spread = Math.max(1, 5 - (h >> 3));
          const fx = x + 8 + ((decoRoll(frame >> 1, i + v.x) % (spread * 2 + 1)) - spread);
          ctx.fillStyle = h > 32 ? PAL.y : h > 16 ? '#fc9838' : i % 2 ? PAL.r : PAL.y;
          ctx.fillRect(fx, y - 3 - h, 2, 3);
        }
      }
    },

    drawEverflame(ef) {
      const x = ef.x * T + 8, y = ef.y * T + 16;
      // stone brazier
      ctx.fillStyle = PAL.n; ctx.fillRect(x - 12, y - 6, 24, 6);
      ctx.fillStyle = PAL.m; ctx.fillRect(x - 10, y - 10, 20, 4);
      ctx.fillStyle = PAL.l; ctx.fillRect(x - 10, y - 10, 20, 1);
      // glow + flickering fire
      for (const [r, a] of [[28, 0.08], [20, 0.14], [12, 0.22]]) {
        ctx.fillStyle = 'rgba(252,152,56,' + a + ')';
        for (let j = -r; j <= r; j++) {
          const h = Math.floor(Math.sqrt(r * r - j * j));
          ctx.fillRect(x - h, y - 22 + j, h * 2 + 1, 1);
        }
      }
      for (let i = 0; i < 40; i++) {
        const h = decoRoll(frame >> 2, i + 50) % 26;
        const spread = Math.max(1, 8 - (h >> 2));
        const fx = x + ((decoRoll(frame >> 2, i) % (spread * 2 + 1)) - spread);
        ctx.fillStyle = h > 18 ? PAL.w : h > 9 ? PAL.y : i % 3 ? '#fc9838' : PAL.r;
        ctx.fillRect(fx, y - 11 - h, 2, 2);
      }
    },

    drawMover(m) {
      const x = Math.round(m.x), y = Math.round(m.y);
      ctx.fillStyle = PAL.D; ctx.fillRect(x, y, m.w, m.h);
      ctx.fillStyle = PAL.y; ctx.fillRect(x + 1, y + 1, m.w - 2, m.h - 3);
      ctx.fillStyle = '#fce0a8'; ctx.fillRect(x + 1, y + 1, m.w - 2, 1);
      ctx.fillStyle = PAL.D;
      for (let i = 4; i < m.w; i += 16) { ctx.fillRect(x + i, y + 3, 2, 2); ctx.fillRect(x + i + 8, y + 3, 2, 2); }
    },

    drawSpring(s) {
      const x = s.x * T, y = s.y * T;
      const up = s.t > 0 ? (s.t > 6 ? 0 : 3) : 5; // extended right after a bounce
      ctx.fillStyle = PAL.n; ctx.fillRect(x + 2, y + 14, 12, 2);
      ctx.fillStyle = PAL.l;
      for (let i = 0; i < 3; i++) ctx.fillRect(x + (i % 2 ? 4 : 5), y + 13 - i * 2 + (s.t ? 0 : 1) * i - (s.t > 6 ? i * 2 : 0), 7, 1);
      ctx.fillStyle = PAL.r; ctx.fillRect(x + 1, y + 7 + up - (s.t > 6 ? 4 : 0), 14, 3);
      ctx.fillStyle = PAL.w; ctx.fillRect(x + 2, y + 7 + up - (s.t > 6 ? 4 : 0), 12, 1);
    },

    drawCrystal(c) {
      const cx = c.x * T + 8, cy = c.y * T + 8 + Math.round(Math.sin((frame + c.x * 10) / 12) * 2);
      if (c.gone) {
        ctx.fillStyle = '#342468';
        [[0, -6], [-5, 0], [5, 0], [0, 6]].forEach(([dx, dy]) => ctx.fillRect(cx + dx, cy + dy, 1, 1));
        return;
      }
      for (let j = -6; j <= 6; j++) {
        const half = 5 - Math.abs(j) * (5 / 6);
        for (let i = -Math.round(half); i <= Math.round(half); i++) {
          ctx.fillStyle = i < 0 && j < 0 ? PAL.C : i >= 0 && j >= 0 ? '#0078f8' : PAL.c;
          ctx.fillRect(cx + i, cy + j, 1, 1);
        }
      }
      if (blink(8)) { ctx.fillStyle = PAL.w; ctx.fillRect(cx - 2, cy - 3, 1, 1); }
    },

    drawEmber(e) {
      const cx = e.x * T + 8, cy = e.y * T + 8 + Math.round(Math.sin((frame + e.x * 7) / 10) * 2);
      const rows = [
        '...y...', '..yy...', '..yry..', '.yrrry.', '.yrRry.', 'yrRRRry', '.yrrry.', '..yyy..',
      ];
      rows.forEach((row, j) => [...row].forEach((ch, i) => {
        if (ch === '.') return;
        ctx.fillStyle = ch === 'y' ? (blink(6) ? PAL.y : '#fc9838') : PAL[ch];
        ctx.fillRect(cx - 3 + i, cy - 4 + j, 1, 1);
      }));
    },

    drawFlag(f) {
      const x = f.x * T + 7, top = (f.y - 3) * T + 4, bottom = (f.y + 1) * T;
      ctx.fillStyle = PAL.n; ctx.fillRect(x - 3, bottom - 3, 8, 3);
      ctx.fillStyle = PAL.l; ctx.fillRect(x, top, 2, bottom - top);
      ctx.fillStyle = PAL.y; ctx.fillRect(x - 1, top - 3, 4, 4);
      const wave = Math.floor(frame / 10) % 2;
      for (let j = 0; j < 10; j++) {
        const len = 12 - Math.abs(j - 5) * 2 + (j % 3 === wave ? 1 : 0);
        ctx.fillStyle = j < 5 ? PAL.G : PAL.g;
        ctx.fillRect(x + 2, top + 1 + j, len, 1);
      }
    },

    drawHud() {
      const L = this.level;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, W, 11);
      if (this.onlyUp) {
        const o = this.ou;
        drawText(ctx, 'HEIGHT ' + this.heightOf(this.player) + 'M', 4, 2, PAL.w);
        drawText(ctx, 'BEST ' + o.best + 'M   FALLS ' + o.falls, W / 2, 2, PAL.C, 1, 'center');
        drawText(ctx, formatTime(this.time), W - 4, 2, PAL.w, 1, 'right');
        if (o.fellT > 0 && (o.fellT > 40 || blink(6))) drawTextOutlined(ctx, 'OUCH! -' + o.fell + 'M', W / 2, 40, PAL.e, 2, 'center');
        return;
      }
      const label = this.def.index !== undefined ? this.def.name.split(' ')[0] + '  ' : '';
      drawText(ctx, label + 'DEATHS ' + this.deaths, 4, 2, PAL.w);
      if (this.hardcore) drawText(ctx, 'HARDCORE', W - 40, 2, PAL.e, 1, 'right');
      if (this.keysHeld > 0) { this.drawKey(W - 58, 18); drawText(ctx, 'X' + this.keysHeld, W - 50, 15, PAL.y); }
      if (this.netOn) {
        const done = Net.order.filter((id) => Net.players[id] && Net.players[id].fin).length;
        drawText(ctx, 'ROOM ' + Net.code + '  FINISHED ' + done + '/' + Net.order.length, 4, 13, PAL.C);
      }
      if (this.boss) {
        const B = this.boss;
        const pipsW = B.maxHp * 9 - 2;
        const total = textWidth(B.info.title) + 8 + pipsW;
        const x0 = Math.round(W / 2 - total / 2);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(x0 - 6, 11, total + 12, 13);
        drawText(ctx, B.info.title, x0, 14, PAL.e);
        const px0 = x0 + textWidth(B.info.title) + 8;
        for (let i = 0; i < B.maxHp; i++) {
          ctx.fillStyle = i < B.hp ? PAL.e : '#342468';
          ctx.fillRect(px0 + i * 9, 14, 7, 7);
        }
      }
      if (L.embers.length) {
        const got = L.embers.filter((e) => e.got).length;
        drawText(ctx, 'EMBERS ' + got + '/' + L.embers.length, W / 2 - 36, 2, '#fc9838', 1, 'center');
      }
      if (L.fragments.length) {
        const got = L.fragments.filter((f) => f.got).length;
        drawText(ctx, '? ' + got + '/' + L.fragments.length, W / 2 + 36, 2, PAL.V, 1, 'center');
      }
      drawText(ctx, formatTime(this.time), W - 4, 2, PAL.w, 1, 'right');
    },

    drawSignText() {
      const p = this.player;
      const near = p.dead || this.state !== 'play' ? null
        : this.level.signs.find((s) => Math.abs(p.x + p.w / 2 - (s.x * T + 8)) < 22 && Math.abs(p.y + p.h / 2 - (s.y * T + 8)) < 28);
      // open / close animation state
      const box = this.signBox;
      if (near && (!box || box.sign !== near)) this.signBox = { sign: near, f0: frame, closing: -1 };
      else if (!near && box && box.closing < 0) box.closing = frame;
      const b = this.signBox;
      if (!b) return;
      const closeT = b.closing >= 0 ? 6 - (frame - b.closing) : undefined;
      if (closeT !== undefined && closeT <= 0) { this.signBox = null; return; }
      const lines = fillKeys(b.sign.text).split('\n');
      const w = Math.max(...lines.map((l) => textWidth(l))) + 16;
      const h = lines.length * 11 + 10;
      const x = Math.round(W / 2 - w / 2);
      const open = animatedPanel(x, 18, w, h, frame - b.f0, '#fcfcfc', closeT);
      if (!open) return;
      let budget = (frame - b.f0 - 8) * 2;
      lines.forEach((l, i) => {
        drawText(ctx, l.slice(0, Math.max(0, budget)), W / 2 - textWidth(l) / 2, 24 + i * 11, i === 0 ? PAL.y : PAL.w);
        budget -= l.length;
      });
      if (budget >= 0) doneArrow(x + w - 10, 18 + h - 7);
    },

    drawMessage() {
      const m = this.message;
      if (!m || this.state !== 'play') return;
      const lines = m.text.split('\n');
      const w = Math.max(textWidth(m.title), ...lines.map((l) => textWidth(l))) + 16;
      const h = lines.length * 11 + 22;
      const y = H - h - 6;
      const x = Math.round(W / 2 - w / 2);
      if (!animatedPanel(x, y, w, h, m.t0 - m.t, m.color, m.t)) return;
      drawText(ctx, m.title, W / 2, y + 5, m.color, 1, 'center');
      // typewriter reveal
      let budget = Math.floor((m.t0 - m.t - 8) * 1.5);
      lines.forEach((l, i) => {
        const shown = l.slice(0, Math.max(0, budget));
        budget -= l.length;
        drawText(ctx, shown, W / 2 - textWidth(l) / 2, y + 17 + i * 11, PAL.w);
      });
    },

    drawPause() {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, W, H);
      drawTextOutlined(ctx, 'PAUSED', W / 2, 90, PAL.y, 2, 'center');
      if (this.level.objective) drawTextOutlined(ctx, 'OBJECTIVE: ' + this.level.objective, W / 2, 114, PAL.C, 1, 'center');
      this.pauseMenu.draw();
    },

    drawNetResults() {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, W, H);
      panel(W / 2 - 130, 40, 260, 190, PAL.y);
      drawTextOutlined(ctx, 'RESULTS', W / 2, 50, PAL.y, 2, 'center');
      const rows = Net.order.map((id) => Net.players[id]).filter(Boolean)
        .sort((a, b) => (a.fin ? a.fin.time : 1e12) - (b.fin ? b.fin.time : 1e12));
      rows.forEach((pl, i) => {
        const y = 80 + i * 14;
        drawText(ctx, (i + 1) + '. ' + pl.name, W / 2 - 110, y, pl.color === '#fcfcfc' ? PAL.l : pl.color);
        drawText(ctx, pl.fin ? formatTime(pl.fin.time) + '  X' + pl.fin.deaths : 'STILL CLIMBING...', W / 2 + 110, y, PAL.w, 1, 'right');
      });
      if (this.clearT > 60 && blink(20)) drawText(ctx, 'ENTER: BACK TO THE ROOM', W / 2, 212, PAL.w, 1, 'center');
    },

    drawClear() {
      if (this.netOn) return this.drawNetResults();
      if (this.onlyUp) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, W, H);
        panel(W / 2 - 120, 70, 240, 120, PAL.y);
        drawTextOutlined(ctx, 'THE TOP!', W / 2, 84, PAL.y, 2, 'center');
        drawText(ctx, 'HEIGHT  ' + this.ou.best + 'M', W / 2, 114, PAL.w, 1, 'center');
        drawText(ctx, 'TIME    ' + formatTime(this.time), W / 2, 126, PAL.w, 1, 'center');
        drawText(ctx, 'FALLS   ' + this.ou.falls, W / 2, 138, PAL.e, 1, 'center');
        if (this.clearT > 60 && blink(20)) drawText(ctx, 'PRESS ENTER', W / 2, 170, PAL.C, 1, 'center');
        return;
      }
      const L = this.level;
      const tut = L.id === 'tutorial';
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, W, H);
      panel(W / 2 - 110, 59, 220, 152);
      drawTextOutlined(ctx, tut ? 'TUTORIAL DONE!' : 'STAGE CLEAR!', W / 2, 75, PAL.y, 2, 'center');
      drawText(ctx, 'TIME    ' + formatTime(this.time), W / 2, 111, PAL.w, 1, 'center');
      drawText(ctx, 'DEATHS  ' + this.deaths, W / 2, 123, PAL.w, 1, 'center');
      const got = L.embers.filter((e) => e.got).length;
      drawText(ctx, 'EMBERS  ' + got + '/' + L.embers.length, W / 2, 135, '#fc9838', 1, 'center');
      const frags = L.fragments.filter((f) => f.got).length;
      drawText(ctx, 'MEMORIES ' + frags + '/' + L.fragments.length, W / 2, 147, PAL.V, 1, 'center');
      let msg = 'NOW TRY A NEW GAME!';
      let col = PAL.C;
      if (!tut && this.run) {
        const next = CAMPAIGN[this.run.data.stage];
        msg = next ? (next.stage === 0 ? 'NEXT: CHAPTER ' + (next.chapter + 1) + '\n' + CHAPTERS[next.chapter].name : 'NEXT: ' + next.name) : '';
        if (this.hardcore && next && next.stage === 0) msg += '\n(HARDCORE RUN SAVED)';
      }
      if (!tut && L.fragments.length) {
        if (frags === L.fragments.length && L.secret) { msg = L.secret; col = PAL.e; }
        else if (frags < L.fragments.length) { msg += (msg ? '\n' : '') + 'SOME MEMORIES ARE STILL LOST...'; col = PAL.V; }
      }
      msg.split('\n').forEach((l, i) => drawText(ctx, l, W / 2, 163 + i * 10, col, 1, 'center'));
      if (this.clearT > 60 && blink(20)) drawText(ctx, 'PRESS ENTER', W / 2, 193, PAL.w, 1, 'center');
    },
  };

  function formatTime(frames) {
    const s = Math.floor(frames / 60);
    return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  }

  // Loading circle: only shown while something is genuinely still loading
  // (the title music) and it has been taking longer than ~0.3s.
  let loadingFrames = 0;
  function drawLoadingCircle() {
    const cx = W - 14, cy = H - 14;
    const head = Math.floor(frame / 4) % 8;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const behind = (head - i + 8) % 8;
      ctx.fillStyle = behind === 0 ? PAL.w : behind < 3 ? PAL.C : '#342468';
      ctx.fillRect(Math.round(cx + Math.cos(a) * 6) - 1, Math.round(cy + Math.sin(a) * 6) - 1, 2, 2);
    }
  }

  // ---------------------------------------------------------------- main loop
  const STEP = 1000 / 60;
  let last = performance.now();
  let acc = 0;
  function loop(now) {
    acc += Math.min(100, now - last);
    last = now;
    while (acc >= STEP) {
      if (UpdateBox.active()) UpdateBox.update(); else scene.update();
      if (laterT > 0) laterT--;
      if (mailT > 0) mailT--;
      frame++;
      loadingFrames = scene !== Play && Sound.isLoading() ? loadingFrames + 1 : 0;
      if (fade > 0) fade--;
      Input.pressed.clear();
      Input.typed.length = 0;
      Input.mouse.click = false;
      Input.mouse.moved = false;
      Input.any = false;
      acc -= STEP;
    }
    // Re-fit whenever the window size changes (covers wrappers that never fire 'resize').
    const size = viewSize().join('x') + ':' + Config.res;
    if (size !== lastSize) { lastSize = size; resize(); }
    scene.draw();
    if (UpdateBox.active()) UpdateBox.draw();
    else if (laterT > 0 && scene !== Play) drawTextOutlined(ctx, 'UPDATE WILL INSTALL WHEN YOU CLOSE THE GAME', W / 2, 6, PAL.y, 1, 'center');
    else if (mailT > 0 && scene !== Play && scene !== Chat) drawTextOutlined(ctx, 'NEW MESSAGE! (ACCOUNT > MESSAGES)', W / 2, 6, PAL.y, 1, 'center');
    else if (scene === Title && UpdateBox.uiShown()) drawTextOutlined(ctx, UpdateBox.statusText(), 6, H - 34, UpdateBox.st && UpdateBox.st.state === 'error' ? '#fc7460' : '#8c9cd8');
    if (fade > 0) {
      ctx.fillStyle = 'rgba(0,0,0,' + fade / FADE + ')';
      ctx.fillRect(0, 0, W, H);
    }
    if (Config.g.scanlines) {
      // retro CRT scanlines (full detail only)
      ctx.fillStyle = 'rgba(0,0,0,0.13)';
      for (let y = 0; y < H; y += 2) ctx.fillRect(0, y, W, 1);
    }
    if (loadingFrames > 18) drawLoadingCircle();
    if (boot) { boot.remove(); boot = null; }
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- update box (desktop app)
  // When the Windows app has downloaded a new version, show an 8-bit box over
  // the menus (never mid-level): RESTART NOW or LATER (installs on close).
  const UpdateBox = {
    build: 0, shown: false, done: false, index: 0, t: 0, st: null,
    ready(build) { this.build = build; },
    uiShown() { return Title.uiA > 0.99; }, // hidden while the Watcher easter egg is showing
    // What the UPDATES row in Settings says.
    settingsText() {
      const s = this.st;
      if (!s || s.state === 'idle' || s.state === 'dev') return 'CHECK NOW';
      if (s.state === 'checking') return 'CHECKING...';
      if (s.state === 'downloading') return 'DOWNLOADING ' + s.pct + '%';
      if (s.state === 'ready') return 'READY: INSTALL NOW';
      if (s.state === 'uptodate') return 'UP TO DATE (VERSION ' + GAME_VERSION + ')';
      if (s.state === 'error') return 'FAILED: TRY AGAIN';
      return 'CHECK NOW';
    },
    // Small status line for the title screen: this build, and what the updater is doing.
    statusText() {
      const s = this.st;
      const me = 'VERSION ' + GAME_VERSION;
      if (!s || s.state === 'dev' || s.state === 'idle') return me;
      const next = s.latestName ? 'VERSION ' + s.latestName : 'THE NEW VERSION';
      if (s.state === 'checking') return me + ' - CHECKING FOR UPDATES...';
      if (s.state === 'uptodate') return me + ' - UP TO DATE';
      if (s.state === 'downloading') return me + ' - DOWNLOADING ' + next + ': ' + s.pct + '%';
      if (s.state === 'ready') return me + ' - ' + next + ' IS READY';
      if (s.state === 'error') return me + ' - UPDATE CHECK FAILED: ' + (s.msg || '');
      return me;
    },
    active() { return this.build && !this.done && scene !== Play; },
    rects() { return [{ x: W / 2 - 96, y: 158, w: 88, h: 16 }, { x: W / 2 + 8, y: 158, w: 88, h: 16 }]; },
    update() {
      if (!this.shown) { this.shown = true; this.t = 0; Sound.sfx('fragment'); }
      this.t++;
      if (hit(...K.left)) { this.index = 0; Sound.sfx('move'); }
      if (hit(...K.right)) { this.index = 1; Sound.sfx('move'); }
      const m = Input.mouse;
      let chosen = hit(...K.ok);
      if (m.moved || m.click) this.rects().forEach((r, i) => {
        if (!overlap({ x: m.x, y: m.y, w: 1, h: 1 }, r)) return;
        if (m.moved && this.index !== i) { this.index = i; Sound.sfx('move'); }
        if (m.click) { this.index = i; chosen = true; }
      });
      if (hit(...K.back)) { chosen = true; this.index = 1; }
      if (!chosen) return;
      Sound.sfx('select');
      this.done = true;
      if (this.index === 0) window.precipiceApp.restartNow();
      else toastLater();
    },
    draw() {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, W, H);
      if (!animatedPanel(W / 2 - 150, 78, 300, 110, this.t, PAL.y)) return;
      drawTextOutlined(ctx, 'UPDATE READY!', W / 2, 88, PAL.y, 2, 'center');
      drawText(ctx, 'A NEW VERSION OF PRECIPICE IS HERE.', W / 2, 114, PAL.w, 1, 'center');
      drawText(ctx, 'RESTART TO PLAY IT, OR KEEP PLAYING AND', W / 2, 128, PAL.m, 1, 'center');
      drawText(ctx, "IT'LL BE INSTALLED WHEN YOU CLOSE THE GAME.", W / 2, 138, PAL.m, 1, 'center');
      ['RESTART NOW', 'LATER'].forEach((label, i) => {
        const r = this.rects()[i], sel = i === this.index;
        ctx.fillStyle = sel ? 'rgba(60,188,252,0.25)' : 'rgba(8,6,28,0.8)';
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = sel ? PAL.c : '#342468';
        ctx.fillRect(r.x, r.y, r.w, 1); ctx.fillRect(r.x, r.y + r.h - 1, r.w, 1); ctx.fillRect(r.x, r.y, 1, r.h); ctx.fillRect(r.x + r.w - 1, r.y, 1, r.h);
        drawText(ctx, label, r.x + r.w / 2, r.y + 5, sel ? PAL.c : '#b8c4f0', 1, 'center');
      });
    },
  };
  let laterT = 0; // "installs when you close the game" note after picking LATER
  let mailT = 0; // "NEW MESSAGE!" note
  Account.onNewMessage = () => { mailT = 240; Sound.sfx('fragment'); };
  function toastLater() { laterT = 180; }
  if (window.precipiceApp) window.precipiceApp.onUpdateState((st) => {
    if (!st) return;
    UpdateBox.st = st;
    if (st.state === 'ready') UpdateBox.ready(st.latest);
  });

  // Debug hooks for automated testing / screenshots.
  window.PRECIPICE = { UpdateBox, Input, Play, LEVELS, setScene, scenes: { AccountScene, Players, Chat, Inbox, DevNotes, Stories, Changelog, CreditsRoll, Multi, JoinCode, Room, Splash, Title, Settings, Controls, Guide, Lore, Credits, More, SlotSelect, ChapterIntro, Ending, Story, Play }, Slots, CAMPAIGN, playSlot, get scene() { return scene; }, get frame() { return frame; }, set frame(v) { frame = v; } };

  let boot = document.getElementById('boot'); // page-load spinner, removed after the first frame
  applyVolumes();
  Sound.preload();
  setScene(Splash);
  requestAnimationFrame(loop);
})();
