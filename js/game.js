// PRECIPICE - main game: input, scenes, player physics and rendering.
(() => {
  // Internal pixel resolution: 16:9, scaled 4x to 1920x1080.
  const W = SCREEN_W; // 480
  const H = SCREEN_H; // 270
  const T = 16;

  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  function resize() {
    // Largest whole-number scale that fits (4x = 1920x1080); fall back to a
    // fractional scale on very small windows.
    const fit = Math.min(innerWidth / W, innerHeight / H);
    if (!(fit > 0)) return; // window not laid out yet (can happen in desktop wrappers)
    let s = fit >= 1 ? Math.floor(fit) : fit;
    const res = RESOLUTIONS[Config.res];
    if (res.w) s = Math.min(res.w / W, fit); // chosen size, shrunk to fit the window
    canvas.style.width = W * s + 'px';
    canvas.style.height = H * s + 'px';
  }
  addEventListener('resize', resize);
  resize();
  let lastSize = '';

  // ---------------------------------------------------------------- input
  const Input = { down: new Set(), pressed: new Set(), any: false, mouse: { x: -1, y: -1, click: false, moved: false } };
  const NO_SCROLL = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  addEventListener('keydown', (e) => {
    if (NO_SCROLL.has(e.code)) e.preventDefault();
    Sound.init();
    if (!e.repeat) Input.pressed.add(e.code);
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
  const K = {
    up: ['KeyW', 'ArrowUp'],
    down: ['KeyS', 'ArrowDown'],
    ok: ['Enter', 'NumpadEnter', 'Space'],
    back: ['Escape', 'Backspace'],
    dash: ['ShiftLeft', 'ShiftRight', 'KeyK'],
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

  function startLevel(def, save) {
    Sound.fadeOutMusic();
    setScene(Play, def, save);
  }

  // Save game: written whenever you touch a checkpoint on the climb, so you can
  // CONTINUE from the title screen later (even after closing the game).
  const SaveGame = {
    key: 'precipice.save',
    load() {
      try {
        const data = JSON.parse(localStorage.getItem(this.key));
        return data && LEVELS[data.level] ? data : null;
      } catch (e) { return null; }
    },
    write(data) {
      try { localStorage.setItem(this.key, JSON.stringify(data)); return true; } catch (e) { return false; }
    },
    clear() {
      try { localStorage.removeItem(this.key); } catch (e) { /* storage unavailable */ }
    },
  };

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

  const DOWNLOAD_URL = 'https://github.com/coldzeeyt/precipice/releases/latest/download/Precipice-Windows.zip';

  const Title = {
    enter() {
      this.save = SaveGame.load();
      const items = [];
      if (this.save) items.push({ id: 'continue', label: 'CONTINUE' });
      items.push(
        { id: 'new', label: 'NEW GAME' },
        { id: 'tutorial', label: 'TUTORIAL' },
        { id: 'guide', label: 'GUIDE' },
        { id: 'lore', label: 'LORE' },
        { id: 'settings', label: 'SETTINGS' },
        { id: 'credits', label: 'CREDITS' },
      );
      // In a desktop web browser, offer the Windows app (built by GitHub Actions).
      const isApp = /Electron/i.test(navigator.userAgent);
      const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      if (!isApp && !isTouch) items.splice(items.length - 2, 0, { id: 'download', label: 'DOWNLOAD FOR PC' });
      this.menu = makeMenu(items, 102, 15);
    },
    update() {
      titleUpdate();
      const c = this.menu.update();
      if (!c) return;
      if (c.id === 'continue') startLevel(LEVELS[this.save.level], this.save);
      else if (c.id === 'guide') setScene(Guide);
      else if (c.id === 'lore') setScene(Lore);
      else if (c.id === 'download') window.open(DOWNLOAD_URL, '_blank', 'noopener');
      else if (c.id === 'new') setScene(Story);
      else if (c.id === 'tutorial') startLevel(LEVELS.tutorial);
      else if (c.id === 'settings') setScene(Settings);
      else if (c.id === 'credits') setScene(Credits);
    },
    draw() {
      drawTitleBackdrop();
      drawLogo();
      const top = this.menu.y - 8, h = this.menu.items.length * 15 + 10;
      ctx.fillStyle = 'rgba(8,6,28,0.6)';
      ctx.fillRect(W / 2 - 64, top, 128, h);
      ctx.fillStyle = '#342468';
      ctx.fillRect(W / 2 - 64, top, 128, 1);
      ctx.fillRect(W / 2 - 64, top + h - 1, 128, 1);
      this.menu.draw();
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
    enter() { this.page = 0; this.t = 0; },
    update() {
      this.t++;
      if (hit('Escape')) { Sound.sfx('select'); SaveGame.clear(); startLevel(LEVELS.stage1); return; }
      if (hit(...K.ok) || Input.mouse.click) {
        const len = STORY[this.page].text.length;
        if (this.t * TYPE_SPEED < len) { this.t = Math.ceil(len / TYPE_SPEED); return; }
        this.page++;
        this.t = 0;
        if (this.page >= STORY.length) { Sound.sfx('select'); SaveGame.clear(); startLevel(LEVELS.stage1); } else Sound.sfx('move');
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
      panel(W / 2 - 170, 176, 340, 80, page.title ? PAL.y : '#fcfcfc');
      let ty = 186;
      if (page.title) { drawText(ctx, page.title, W / 2, ty, PAL.y, 1, 'center'); ty += 14; }
      let budget = Math.floor(this.t * TYPE_SPEED);
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
  };
  const GUIDE = [
    { title: 'YOUR GOAL', text: [
      'REACH THE FLAG AT THE END OF EACH STAGE.',
      'EVERY STAGE TAKES YOU HIGHER UP THE MOUNTAIN,',
      'AND THE EVERFLAME WAITS AT THE SUMMIT.',
      '',
      'FALLING OFF A PRECIPICE OR TOUCHING SPIKES',
      'SENDS YOU BACK TO YOUR LAST CHECKPOINT.',
      '',
      'CHECKPOINTS ALSO SAVE YOUR GAME. PICK CONTINUE',
      'ON THE TITLE SCREEN TO CARRY ON LATER.',
    ] },
    { title: 'COLLECTABLES', items: [
      ['ember', 'EMBERS', 'SPARKS OF THE EVERFLAME. OPTIONAL, AND OFTEN', 'TUCKED AWAY IN HARD-TO-REACH SPOTS.'],
      ['fragment', 'MEMORY FRAGMENTS', "GLOWING RUNE STONES HOLDING PAGES OF ASH'S", 'DIARY. FIND THEM ALL TO LEARN THE TRUTH.'],
    ] },
    { title: 'THE MOUNTAIN', items: [
      ['checkpoint', 'CHECKPOINTS', 'RESPAWN HERE AND SAVE YOUR PROGRESS.'],
      ['crystal', 'DASH CRYSTALS', 'REFILL YOUR DASH IN MID-AIR.'],
      ['spring', 'SPRINGS', 'LAUNCH YOU SKY HIGH AND REFILL YOUR DASH.'],
      ['crumble', 'CRUMBLING BLOCKS', 'FALL AWAY SOON AFTER YOU LAND ON THEM.'],
      ['mover', 'MOVING PLATFORMS', 'RIDE THEM ACROSS WIDE GAPS.'],
      ['spikes', 'SPIKES', 'DEADLY TO THE TOUCH. JUMP OVER THEM.'],
    ] },
    { title: 'CONTROLS', text: [
      'A / D ........... MOVE',
      'SPACE ........... JUMP (HOLD TO JUMP HIGHER)',
      'SHIFT ........... DASH (AIM WITH W A S D)',
      'INTO A WALL ..... SLIDE DOWN IT',
      'SPACE ON A WALL . WALL JUMP',
      'ESC ............. PAUSE',
      'F11 ............. FULLSCREEN (DESKTOP APP)',
    ] },
  ];

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
  ];

  // A flip-through book of pages (used by GUIDE and LORE).
  function makeBook(pages) {
    return {
      enter() { this.page = 0; },
      update() {
        titleUpdate();
        const n = pages.length;
        const next = hit('KeyD', 'ArrowRight');
        if (next || hit(...K.ok) || Input.mouse.click) {
          if (this.page === n - 1 && !next) { Sound.sfx('select'); setScene(Title); return; }
          if (this.page < n - 1) { this.page++; Sound.sfx('move'); }
        }
        if (hit('KeyA', 'ArrowLeft') && this.page > 0) { this.page--; Sound.sfx('move'); }
        if (hit(...K.back)) { Sound.sfx('select'); setScene(Title); }
      },
      draw() {
        drawTitleBackdrop();
        const page = pages[this.page];
        panel(W / 2 - 190, 20, 380, 232);
        drawTextOutlined(ctx, page.title, W / 2, 32, PAL.C, 2, 'center');
        if (page.text) {
          page.text.forEach((l, i) => drawText(ctx, l, W / 2 - 170, 62 + i * 13, PAL.w));
        } else {
          let y = 62;
          const gap = page.items.length > 3 ? 27 : 44;
          for (const [icon, head, ...lines] of page.items) {
            ICONS[icon](W / 2 - 156, y + 6 + (lines.length > 2 ? 8 : 0));
            drawText(ctx, head, W / 2 - 132, y, PAL.c);
            lines.forEach((l, i) => drawText(ctx, l, W / 2 - 132, y + 11 + i * 10, PAL.w));
            y += gap + Math.max(0, lines.length - 2) * 10;
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
    rows: ['res', 'full', 'gfx', 'music', 'sfx', 'back'],
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
    rowY(i) { return 64 + i * 26; },
    update() {
      titleUpdate();
      const n = this.rows.length;
      if (hit(...K.up)) { this.index = (this.index + n - 1) % n; Sound.sfx('move'); }
      if (hit(...K.down)) { this.index = (this.index + 1) % n; Sound.sfx('move'); }
      const row = this.rows[this.index];
      if (hit('KeyA', 'ArrowLeft')) this.change(row, -1);
      if (hit('KeyD', 'ArrowRight')) this.change(row, 1);
      const m = Input.mouse;
      if (m.moved || m.click) {
        for (let i = 0; i < n; i++) {
          if (m.x < W / 2 - 170 || m.x > W / 2 + 170 || m.y < this.rowY(i) - 6 || m.y > this.rowY(i) + 16) continue;
          if (m.moved && this.index !== i) { this.index = i; Sound.sfx('move'); }
          if (m.click) { this.index = i; if (this.rows[i] === 'back') { Sound.sfx('select'); setScene(Title); return; } this.change(this.rows[i], m.x < W / 2 + 40 ? -1 : 1); }
        }
      }
      if (hit(...K.ok)) {
        if (row === 'back') { Sound.sfx('select'); setScene(Title); return; }
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
      const labels = { res: 'RESOLUTION', full: 'FULLSCREEN', gfx: 'GRAPHICS', music: 'MUSIC', sfx: 'SOUND FX', back: 'BACK' };
      this.rows.forEach((row, i) => {
        const y = this.rowY(i);
        const sel = i === this.index;
        if (sel) {
          ctx.fillStyle = 'rgba(60,188,252,0.12)';
          ctx.fillRect(W / 2 - 176, y - 5, 352, row === 'gfx' ? 28 : 17);
        }
        if (row === 'back') {
          drawText(ctx, (sel ? '> ' : '') + 'BACK' + (sel ? ' <' : ''), W / 2, y, sel ? PAL.c : '#b8c4f0', 1, 'center');
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
        if (row === 'gfx') drawText(ctx, '"' + Config.g.desc + '"', W / 2 + 80, y + 12, PAL.m, 1, 'center');
      });
      drawText(ctx, 'W/S: SELECT   A/D: CHANGE', W / 2, 236, PAL.n, 1, 'center');
    },
  };

  // Shared layout for simple title sub-screens (credits).
  function subScreen(title, h = 210) {
    drawTitleBackdrop();
    panel(W / 2 - 150, (H - h) / 2, 300, h);
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

  const Credits = {
    menu: makeMenu([{ id: 'back', label: 'BACK' }], 212),
    update() { titleUpdate(); backOnly(this.menu); },
    draw() {
      let y = subScreen('CREDITS');
      const rows = [
        ['GAME & DESIGN', 'ColdzeeYT'],
        ['MUSIC', 'SILVER HAND MAN - VIRAXOR', 'DREAM GIRL - SHARK-POOL'],
        ['SOUND EFFECTS', '8-BIT SYNTH (WEB AUDIO)'],
        ['ART', 'PLACEHOLDER PIXEL ART'],
        ['SOURCE', 'GITHUB.COM/COLDZEEYT/PRECIPICE'],
      ];
      for (const [head, ...lines] of rows) {
        drawText(ctx, head, W / 2, y, PAL.c, 1, 'center');
        lines.forEach((l, i) => drawText(ctx, l, W / 2, y + 10 + i * 10, PAL.w, 1, 'center'));
        y += 13 + lines.length * 10;
      }
      this.menu.draw();
    },
  };

  // ---------------------------------------------------------------- physics tuning
  const P = {
    maxRun: 1.8, accelGround: 0.3, accelAir: 0.2, frictionGround: 0.35, frictionAir: 0.1,
    gravity: 0.36, apexGravity: 0.18, jump: -5.6, jumpCut: -2.2, maxFall: 5.5,
    coyote: 6, buffer: 6,
    wallSlide: 1.3, wallJumpX: 2.4, wallLock: 10,
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
    enter(def, save) {
      this.def = def;
      this.level = buildLevel(def);
      this.crumbles = new Map();
      const s = this.level.start;
      this.spawn = { x: s.x * T + 3, y: s.y * T + 1 };
      this.player = newPlayer(this.spawn);
      this.cam = 0;
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
      if (L0.flag) [-1, 0, 1].forEach((d) => this.decoBlock.add(L0.flag.x + d));
      // Drifting dust / snow in front of the background.
      this.motes = Array.from({ length: 70 }, () => ({
        x: Math.random() * W, y: Math.random() * H, v: 0.15 + Math.random() * 0.3, p: Math.random() * 6.28,
      }));
      this.pauseMenu = makeMenu([{ id: 'resume', label: 'RESUME' }, { id: 'quit', label: 'QUIT TO TITLE' }], 140);
      this.toast = 0;
      if (save) this.loadSave(save);
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
      }
      (save.embers || []).forEach((got, i) => { if (L.embers[i]) L.embers[i].got = got; });
      (save.fragments || []).forEach((got, i) => { if (L.fragments[i]) L.fragments[i].got = got; });
      this.deaths = save.deaths || 0;
      this.time = save.time || 0;
    },

    saveProgress(cpIndex) {
      const L = this.level;
      if (L.id === 'tutorial') return; // only the real climb is saved
      const ok = SaveGame.write({
        level: L.id, cp: cpIndex, deaths: this.deaths, time: this.time,
        embers: L.embers.map((e) => e.got), fragments: L.fragments.map((f) => f.got),
      });
      if (ok) this.toast = 120;
    },

    // --- tile queries
    tileAt(tx, ty) {
      if (ty < 0 || ty >= this.level.h || tx < 0 || tx >= this.level.w) return '.';
      return this.level.tiles[ty][tx];
    },
    solidAt(tx, ty) {
      if (tx < 0 || tx >= this.level.w) return true; // level edges are walls
      const t = this.tileAt(tx, ty);
      if (t === '#' || t === '=') return true;
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
      return this.rectSolid(x, p.y + 2, 0.5, p.h - 4);
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
      this.burst(p.x + p.w / 2, Math.min(p.y + p.h / 2, H - 4), [PAL.r, PAL.w, PAL.y], 16, 2.5);
      Sound.sfx('die');
    },

    respawn() {
      this.player = newPlayer(this.spawn);
      this.crumbles.clear();
      for (const c of this.level.crystals) c.gone = 0;
      this.trail = [];
    },

    update() {
      if (this.state === 'paused') {
        const c = this.pauseMenu.update();
        if (hit('Escape') || (c && c.id === 'resume')) this.state = 'play';
        else if (c && c.id === 'quit') toTitle();
        return;
      }
      this.updateWorld();
      if (this.state === 'clear') {
        this.clearT++;
        if (this.clearT > 60 && (hit(...K.ok) || Input.mouse.click)) {
          Sound.sfx('select');
          toTitle();
        }
        return;
      }
      if (hit('Escape')) {
        this.state = 'paused';
        this.pauseMenu.index = 0;
        Sound.sfx('pause');
        return;
      }
      this.time++;
      if (this.intro > 0) this.intro--;
      this.updatePlayer();
    },

    // Things that move regardless of the player (platforms, crumbles, fx).
    updateWorld() {
      for (const m of this.level.movers) {
        const px = m.x;
        m.x += m.dir * m.speed;
        if (m.x >= m.x1) { m.x = m.x1; m.dir = -1; }
        if (m.x <= m.x0) { m.x = m.x0; m.dir = 1; }
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

      const dir = (held('KeyD') ? 1 : 0) - (held('KeyA') ? 1 : 0);
      if (hit('Space')) p.buffer = P.buffer;
      else if (p.buffer > 0) p.buffer--;
      if (p.onGround) p.coyote = P.coyote;
      else if (p.coyote > 0) p.coyote--;
      if (p.lock > 0) p.lock--;
      if (p.onGround && !p.dashing) p.dashes = 1;

      // --- dash
      if (hit(...K.dash) && p.dashes > 0 && !p.dashing) {
        let dx = dir;
        let dy = (held('KeyS') ? 1 : 0) - (held('KeyW') ? 1 : 0);
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
      } else {
        // --- run
        if (p.lock <= 0) {
          const accel = p.onGround ? P.accelGround : P.accelAir;
          if (dir) {
            if (Math.abs(p.vx) > P.maxRun && Math.sign(p.vx) === dir) p.vx -= Math.sign(p.vx) * 0.05; // keep dash momentum a bit
            else p.vx = clamp(p.vx + dir * accel, -P.maxRun, P.maxRun);
            p.face = dir;
          } else {
            const f = p.onGround ? P.frictionGround : P.frictionAir;
            p.vx = Math.abs(p.vx) <= f ? 0 : p.vx - Math.sign(p.vx) * f;
          }
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
              p.vy = P.jump;
              p.vx = -side * P.wallJumpX;
              p.face = -side;
              p.lock = P.wallLock;
              p.buffer = 0;
              p.bounced = false;
              Sound.sfx('walljump');
              this.burst(side > 0 ? p.x + p.w : p.x, p.y + p.h / 2, [PAL.l, PAL.w], 5, 0.8);
            }
          }
        }
        if (!held('Space') && !p.bounced && p.vy < P.jumpCut) p.vy = P.jumpCut;

        // --- gravity (floatier at the apex while holding jump)
        const g = held('Space') && Math.abs(p.vy) < 0.8 ? P.apexGravity : P.gravity;
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
      if (p.onGround && !wasGround) this.burst(p.x + p.w / 2, p.y + p.h, [PAL.l], 4, 0.6);

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
      for (const cp of L.checkpoints) {
        if (!cp.active && overlap(p, { x: cp.x * T, y: cp.y * T - 8, w: T, h: 24 })) {
          for (const o of L.checkpoints) o.active = false;
          cp.active = true;
          this.spawn = { x: cp.x * T + 3, y: cp.y * T + 1 };
          this.burst(cp.x * T + 12, cp.y * T - 2, [PAL.G, PAL.w], 10, 1.2);
          Sound.sfx('check');
          this.saveProgress(L.checkpoints.indexOf(cp));
        }
      }
      const f = L.flag;
      if (f && overlap(p, { x: f.x * T + 4, y: (f.y - 3) * T, w: 8, h: 4 * T })) {
        this.state = 'clear';
        this.clearT = 0;
        const saved = SaveGame.load();
        if (saved && saved.level === L.id) SaveGame.clear(); // stage finished
        p.vx = 0;
        this.burst(f.x * T + 8, (f.y - 3) * T, [PAL.y, PAL.w, PAL.G, PAL.c], 24, 2.5);
        Sound.sfx('clear');
      }

      // --- camera
      const target = p.x + p.w / 2 - W / 2 + p.face * 20;
      this.cam += (target - this.cam) * 0.1;
      this.cam = clamp(this.cam, 0, L.w * T - W);
    },

    // ------------------------------------------------------------ drawing
    draw() {
      const L = this.level;
      const p = this.player;
      const sx = this.shake ? Math.round((Math.random() - 0.5) * this.shake) : 0;
      const sy = this.shake ? Math.round((Math.random() - 0.5) * this.shake) : 0;
      const cx = Math.round(this.cam);
      drawBackground(ctx, cx, frame);
      ctx.fillStyle = '#4c3c8c';
      for (const m of this.motes.slice(0, Config.g.dust)) {
        const mx = (((m.x - cx * 0.6) % W) + W) % W;
        ctx.fillRect(Math.round(mx), Math.round(m.y), 1, 1);
      }

      ctx.save();
      ctx.translate(-cx + sx, sy);

      // tiles
      const isGround = (x, y) => y < 0 || y >= L.h || this.tileAt(x, y) === '#';
      const tx0 = Math.floor(cx / T) - 1;
      for (let ty = 0; ty < L.h; ty++) {
        for (let tx = tx0; tx <= tx0 + Math.ceil(W / T) + 1; tx++) {
          const t = this.tileAt(tx, ty);
          if (t === '.') continue;
          const px = tx * T, py = ty * T;
          if (t === '#') drawGround(px, py, tx, ty, isGround); else if (t === '=') ctx.drawImage(TILES.brick, px, py);
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
      if (Config.g.deco) for (let ty = 0; ty < L.h; ty++) {
        for (let tx = tx0; tx <= tx0 + Math.ceil(W / T) + 1; tx++) {
          if (this.tileAt(tx, ty) !== '#') continue;
          if (ty > 0 && this.tileAt(tx, ty - 1) === '.') this.drawDeco(tx, ty);
          if (ty + 1 < L.h && this.tileAt(tx, ty + 1) === '.') this.drawRoots(tx, ty);
        }
      }

      for (const m of L.movers) this.drawMover(m);
      for (const s of L.signs) ctx.drawImage(SIGN_SPR, s.x * T, s.y * T);
      for (const cp of L.checkpoints) ctx.drawImage(cp.active ? CHECKPOINT_SPR.on : CHECKPOINT_SPR.off, cp.x * T, cp.y * T - 8);
      for (const s of L.springs) this.drawSpring(s);
      for (const c of L.crystals) this.drawCrystal(c);
      for (const e of L.embers) if (!e.got) this.drawEmber(e);
      if (L.flag) this.drawFlag(L.flag);
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

      if (!p.dead) {
        let pose = 'idle';
        if (!p.onGround) pose = 'jump';
        else if (Math.abs(p.vx) > 0.2) pose = Math.floor(p.anim / 10) % 2 ? 'walk1' : 'walk2';
        const set = p.dashes > 0 || p.dashing ? 'dash' : 'nodash';
        const spr = PLAYER_SPR[set][pose][p.face > 0 ? 'right' : 'left'];
        ctx.drawImage(spr, Math.round(p.x) - 1, Math.round(p.y) - 1);
      }

      for (const q of this.particles) {
        ctx.fillStyle = q.color;
        ctx.fillRect(Math.round(q.x), Math.round(q.y), 1, 1);
      }
      ctx.restore();

      this.drawHud();
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
      drawText(ctx, 'DEATHS ' + this.deaths, 4, 2, PAL.w);
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
      if (p.dead || this.state !== 'play') return;
      const sign = this.level.signs.find((s) => Math.abs(p.x + p.w / 2 - (s.x * T + 8)) < 22 && Math.abs(p.y + p.h / 2 - (s.y * T + 8)) < 28);
      if (!sign) return;
      const lines = sign.text.split('\n');
      const w = Math.max(...lines.map((l) => textWidth(l))) + 16;
      const h = lines.length * 11 + 10;
      panel(Math.round(W / 2 - w / 2), 18, w, h);
      lines.forEach((l, i) => drawText(ctx, l, W / 2, 24 + i * 11, i === 0 ? PAL.y : PAL.w, 1, 'center'));
    },

    drawMessage() {
      const m = this.message;
      if (!m || this.state !== 'play') return;
      const lines = m.text.split('\n');
      const w = Math.max(textWidth(m.title), ...lines.map((l) => textWidth(l))) + 16;
      const h = lines.length * 11 + 22;
      const y = H - h - 6;
      const x = Math.round(W / 2 - w / 2);
      ctx.fillStyle = '#0c0818';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = m.color;
      ctx.fillRect(x + 1, y + 1, w - 2, 1);
      ctx.fillRect(x + 1, y + h - 2, w - 2, 1);
      ctx.fillRect(x + 1, y + 1, 1, h - 2);
      ctx.fillRect(x + w - 2, y + 1, 1, h - 2);
      drawText(ctx, m.title, W / 2, y + 5, m.color, 1, 'center');
      // typewriter reveal
      let budget = Math.floor((m.t0 - m.t) * 1.5);
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

    drawClear() {
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
      let msg = tut ? 'NOW TRY A NEW GAME!' : 'MORE STAGES COMING SOON';
      let col = PAL.C;
      if (!tut && L.fragments.length) {
        if (frags === L.fragments.length && L.secret) { msg = L.secret; col = PAL.e; }
        else { msg = 'SOME MEMORIES ARE\nSTILL LOST ON THE CLIFF...'; col = PAL.V; }
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
      scene.update();
      frame++;
      loadingFrames = scene !== Play && Sound.isLoading() ? loadingFrames + 1 : 0;
      if (fade > 0) fade--;
      Input.pressed.clear();
      Input.mouse.click = false;
      Input.mouse.moved = false;
      Input.any = false;
      acc -= STEP;
    }
    // Re-fit whenever the window size changes (covers wrappers that never fire 'resize').
    const size = innerWidth + 'x' + innerHeight + ':' + Config.res;
    if (size !== lastSize) { lastSize = size; resize(); }
    scene.draw();
    if (fade > 0) {
      ctx.fillStyle = 'rgba(0,0,0,' + fade / FADE + ')';
      ctx.fillRect(0, 0, W, H);
    }
    if (Config.g.scanlines) {
      // NASA-grade retro CRT scanlines
      ctx.fillStyle = 'rgba(0,0,0,0.13)';
      for (let y = 0; y < H; y += 2) ctx.fillRect(0, y, W, 1);
    }
    if (loadingFrames > 18) drawLoadingCircle();
    if (boot) { boot.remove(); boot = null; }
    requestAnimationFrame(loop);
  }

  // Debug hooks for automated testing / screenshots.
  window.PRECIPICE = { Input, Play, LEVELS, setScene, scenes: { Splash, Title, Settings, Guide, Lore, Credits, Play }, get scene() { return scene; }, get frame() { return frame; }, set frame(v) { frame = v; } };

  let boot = document.getElementById('boot'); // page-load spinner, removed after the first frame
  applyVolumes();
  Sound.preload();
  setScene(Splash);
  requestAnimationFrame(loop);
})();
