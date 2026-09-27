// Pixel-art sprites, tiles and backgrounds, all generated in code (placeholder art).
const PAL = {
  k: '#000000', w: '#fcfcfc', s: '#fcbcb0', r: '#d82800', R: '#881400',
  b: '#0058f8', B: '#0000bc', y: '#f8b800', g: '#00a800', G: '#58d854',
  d: '#ac7c00', D: '#503000', l: '#bcbcbc', m: '#7c7c7c', n: '#505050',
  c: '#3cbcfc', C: '#a4e4fc',
  x: '#0c0818', e: '#fc3c3c', v: '#9c5cfc', V: '#d8b8fc',
};

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function spriteFromRows(rows) {
  const c = makeCanvas(rows[0].length, rows.length);
  const x = c.getContext('2d');
  rows.forEach((row, j) => {
    [...row].forEach((ch, i) => {
      if (ch !== '.') {
        x.fillStyle = PAL[ch];
        x.fillRect(i, j, 1, 1);
      }
    });
  });
  return c;
}

function flipped(src) {
  const c = makeCanvas(src.width, src.height);
  const x = c.getContext('2d');
  x.translate(src.width, 0);
  x.scale(-1, 1);
  x.drawImage(src, 0, 0);
  return c;
}

function rng(seed) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

// ---------- Player (12x16 placeholder hero) ----------
const PLAYER_TOP = [
  '....kkkk....',
  '...krrrrk...',
  '..krrrrrrk..',
  '..kkkkkkkkk.',
  '..kssssssk..',
  '..ksssswkk..',
  '..kssssssk..',
  '...kssssk...',
  '..krrrrrrk..',
  '.ksrrrrrrsk.',
  '.ksbrrrrbsk.',
  '..kbbbbbbk..',
];
const PLAYER_LEGS = {
  idle: ['..kbbkkbbk..', '..kbk..kbk..', '..kbk..kbk..', '..kkkk.kkkk.'],
  walk1: ['..kbbkkbbk..', '.kbk....kbk.', 'kbk......kbk', 'kkk......kkk'],
  walk2: ['...kbbbbk...', '...kbbbk....', '....kbbk....', '....kkkk....'],
  jump: ['..kbbkkbbk..', '.kbbk..kbk..', 'kkk....kbk..', '.......kkk..'],
};
// The cap turns blue when the dash is spent (a nod to a certain mountain climber).
const PLAYER_TOP_NODASH = PLAYER_TOP.map((row, i) => (i < 4 ? row.replace(/r/g, 'c') : row));
const PLAYER_SPR = { dash: {}, nodash: {} };
for (const k in PLAYER_LEGS) {
  for (const [set, top] of [['dash', PLAYER_TOP], ['nodash', PLAYER_TOP_NODASH]]) {
    const right = spriteFromRows(top.concat(PLAYER_LEGS[k]));
    PLAYER_SPR[set][k] = { right, left: flipped(right) };
  }
}

// The Watcher: a shadow that wears the hero's shape, with red eyes.
const WATCHER_SPR = (() => {
  const rows = PLAYER_TOP.concat(PLAYER_LEGS.idle).map((row) =>
    row.replace(/w/g, 'e').replace(/[^.e]/g, 'x'));
  const right = spriteFromRows(rows);
  return { right, left: flipped(right) };
})();

// Memory fragment: a rune stone that glows violet.
const FRAGMENT_SPR = spriteFromRows([
  '...nnnnnn...',
  '..nmmmmmmn..',
  '.nmlllllmmn.',
  '.nmllVllmmn.',
  '.nmlvVvlmmn.',
  '.nmlllllmmn.',
  '.nmllvllmmn.',
  '.nmlvlvlmmn.',
  '.nmvlllvmmn.',
  '.nmvvvvvmmn.',
  '.nmmmmmmmmn.',
  'nnnnnnnnnnnn',
  'nmmmmmmmmmmn',
]);

// ---------- Decorations ----------
PAL.q = '#005800';
const DECO = (() => {
  const tuft = spriteFromRows(['..G..', 'G.g.G', 'gGgGg']);
  const flowerRows = ['.r.', 'ryr', '.g.', '.g.'];
  const flowers = [
    spriteFromRows(flowerRows),
    spriteFromRows(flowerRows.map((r) => r.replace(/r/g, 'y').replace('ryr', 'ywy').replace(/yyy/, 'ywy'))),
    spriteFromRows(flowerRows.map((r) => r.replace(/r/g, 'w'))),
    spriteFromRows(flowerRows.map((r) => r.replace(/r/g, 'v'))),
  ];
  const rock = spriteFromRows(['..nmm..', '.nmllm.', 'nmmmlmn', 'nnnnnnn']);
  const bush = spriteFromRows([
    '....qqqq....',
    '..qqggggqq..',
    '.qgGGgggggq.',
    'qgGggggGgggq',
    'qggggGggggGq',
    'qggggggggggq',
    '.qqqqqqqqqq.',
  ]);
  const pine = (() => {
    const c = makeCanvas(13, 26);
    const x = c.getContext('2d');
    x.fillStyle = '#503000';
    x.fillRect(5, 20, 3, 6);
    for (let k = 0; k < 3; k++) {
      for (let j = 0; j < 10; j++) {
        const half = Math.min(6, Math.floor(j * 0.55) + k);
        const y = k * 6 + j;
        x.fillStyle = '#0c4c28';
        x.fillRect(6 - half, y, half * 2 + 1, 1);
        x.fillStyle = '#1c7c38';
        x.fillRect(6 - half, y, Math.max(1, half - 1), 1);
      }
      x.fillStyle = '#04280c';
      x.fillRect(0, k * 6 + 9, 13, 1);
      x.clearRect(0, k * 6 + 9, 6 - Math.min(6, 4 + k), 1);
      x.clearRect(7 + Math.min(6, 4 + k), k * 6 + 9, 13, 1);
    }
    x.fillStyle = PAL.G;
    x.fillRect(6, 0, 1, 1);
    return c;
  })();
  return { tuft, flowers, rock, bush, pine };
})();

// Deterministic 0..99 roll for a tile column (so decorations never flicker).
function decoRoll(tx, salt = 0) {
  return (Math.imul(tx * 31 + salt, 2654435761) >>> 0) % 100;
}

// ---------- Tiles ----------
// Earth gets darker the deeper it goes, so cliffs fade into the abyss.
const EARTH = [
  { base: '#ac7c00', spot: '#7c5000' },
  { base: '#8c5c00', spot: '#643c00' },
  { base: '#6c4000', spot: '#4c2800' },
  { base: '#4c2c10', spot: '#341c08' },
];

function makeTile(kind, shade = 0) {
  const c = makeCanvas(16, 16);
  const x = c.getContext('2d');
  const rect = (col, i, j, w, h) => { x.fillStyle = col; x.fillRect(i, j, w, h); };

  if (kind === 'dirt' || kind === 'grass') {
    const e = EARTH[shade];
    rect(e.base, 0, 0, 16, 16);
    // a few evenly spaced pebbles with a highlight
    for (const [i, j] of [[3, 6], [11, 3], [7, 11], [13, 12], [1, 14]]) {
      rect(e.spot, i, j, 2, 1);
      if (shade === 0) rect('#c89c30', i, j - 1, 1, 1);
    }
    if (kind === 'grass') {
      rect('#6c4400', 0, 5, 16, 1); // shadow under the grass lip
      rect(PAL.g, 0, 0, 16, 4);
      rect(PAL.G, 0, 0, 16, 1);
      for (let i = 0; i < 16; i += 4) { rect(PAL.g, i + 1, 4, 2, 1); rect('#b8f818', i + 2, 1, 1, 1); }
      rect('#005800', 0, 3, 16, 1);
      for (let i = 0; i < 16; i += 4) rect(PAL.g, i + 1, 3, 2, 1);
    }
  } else if (kind === 'brick') {
    rect(PAL.m, 0, 0, 16, 16);
    rect(PAL.l, 0, 0, 16, 1);
    rect(PAL.n, 0, 7, 16, 1);
    rect(PAL.n, 0, 15, 16, 1);
    rect(PAL.n, 7, 0, 1, 7);
    rect(PAL.n, 3, 8, 1, 7);
    rect(PAL.n, 11, 8, 1, 7);
  } else if (kind === 'crumble') {
    rect('#c84c0c', 0, 0, 16, 16);
    rect('#fc9838', 0, 0, 16, 1);
    rect('#fc9838', 0, 0, 1, 16);
    rect('#7c2c00', 0, 15, 16, 1);
    rect('#7c2c00', 15, 0, 1, 16);
    for (const [i, j] of [[4, 3], [5, 4], [6, 5], [6, 6], [10, 8], [9, 9], [9, 10], [4, 11], [5, 12]]) rect('#502000', i, j, 1, 1);
  } else if (kind === 'spike') {
    for (let s = 0; s < 2; s++) {
      const x0 = s * 8;
      for (let j = 0; j < 8; j++) {
        const half = Math.floor(j / 2);
        rect(PAL.w, x0 + 3 - half, 8 + j, 1 + half, 1); // lit side
        rect(PAL.m, x0 + 4, 8 + j, 1 + half, 1); // shaded side
      }
    }
    rect(PAL.n, 0, 15, 16, 1);
  }
  return c;
}

const TILES = {
  grass: makeTile('grass'),
  dirt: [0, 1, 2, 3].map((d) => makeTile('dirt', d)),
  brick: makeTile('brick'),
  crumble: makeTile('crumble'),
  spike: makeTile('spike'),
};

const SIGN_SPR = (() => {
  const c = makeCanvas(16, 16);
  const x = c.getContext('2d');
  x.fillStyle = PAL.D; x.fillRect(7, 9, 2, 7);
  x.fillStyle = PAL.D; x.fillRect(1, 1, 14, 9);
  x.fillStyle = PAL.d; x.fillRect(2, 2, 12, 7);
  x.fillStyle = PAL.D; x.fillRect(4, 4, 8, 1); x.fillRect(4, 6, 6, 1);
  return c;
})();

function makeCheckpoint(active) {
  const c = makeCanvas(16, 24);
  const x = c.getContext('2d');
  x.fillStyle = PAL.n; x.fillRect(4, 22, 8, 2);
  x.fillStyle = PAL.l; x.fillRect(7, 2, 2, 20);
  x.fillStyle = PAL.w; x.fillRect(7, 1, 2, 1);
  x.fillStyle = active ? PAL.G : PAL.r;
  x.fillRect(9, 3, 6, 5);
  x.fillStyle = active ? PAL.g : PAL.R;
  x.fillRect(9, 7, 6, 1);
  return c;
}
const CHECKPOINT_SPR = { off: makeCheckpoint(false), on: makeCheckpoint(true) };

// ---------- Background (layered parallax that wraps every 512px) ----------
const SCREEN_W = 480;
const SCREEN_H = 270;
const MOON = { x: 420, y: 44 };

const BG = (() => {
  const sky = makeCanvas(SCREEN_W, SCREEN_H);
  const s = sky.getContext('2d');
  // flat 8-bit sky bands
  [[0, '#08061c'], [50, '#0c0828'], [95, '#140c3c'], [140, '#1e1250'], [185, '#2a1a64']].forEach(([y, col]) => {
    s.fillStyle = col;
    s.fillRect(0, y, SCREEN_W, SCREEN_H - y);
  });
  // moon with a stepped glow
  const disc = (r, col) => {
    s.fillStyle = col;
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (i * i + j * j <= r * r) s.fillRect(MOON.x + i, MOON.y + j, 1, 1);
  };
  disc(26, '#161040');
  disc(18, '#221a58');
  disc(11, '#fce0a8');
  s.fillStyle = '#e8c890';
  [[-4, -3], [-5, -2], [3, 4], [4, 4], [3, 5], [5, -5], [-2, 6]].forEach(([i, j]) => s.fillRect(MOON.x + i, MOON.y + j, 1, 1));
  const r = rng(99);
  s.fillStyle = PAL.w;
  for (let i = 0; i < 50; i++) s.fillRect((r() * SCREEN_W) | 0, (r() * 150) | 0, 1, 1);

  const layer = (base, amps, color, snow) => {
    const c = makeCanvas(512, SCREEN_H);
    const x = c.getContext('2d');
    for (let i = 0; i < 512; i += 2) {
      let h = base;
      amps.forEach(([a, f, p]) => { h += a * Math.sin((2 * Math.PI * i * f) / 512 + p); });
      h = Math.round(h / 3) * 3; // chunky steps
      x.fillStyle = color;
      x.fillRect(i, h, 2, SCREEN_H - h);
      if (snow && h < base - 8) {
        x.fillStyle = snow;
        x.fillRect(i, h, 2, Math.min(6, base - 8 - h));
      }
    }
    return c;
  };
  // twinkling stars (drawn live)
  const tw = [];
  for (let i = 0; i < 40; i++) tw.push({ x: (r() * SCREEN_W) | 0, y: (r() * 130) | 0, p: (r() * 120) | 0 });
  return {
    sky,
    twinkle: tw,
    far: layer(150, [[34, 2, 0], [14, 5, 1], [5, 13, 2]], '#2c1c5c', '#6c5cac'),
    mid: layer(185, [[20, 3, 2], [9, 7, 0.4]], '#211448'),
    near: layer(215, [[14, 3, 0.5], [7, 9, 0]], '#140c30'),
  };
})();

function drawBackground(ctx, camX, t = 0) {
  const g = Config.g;
  ctx.drawImage(BG.sky, 0, 0);
  for (const s of BG.twinkle.slice(0, g.stars)) {
    const k = (t + s.p) % 120;
    if (k < 40) {
      ctx.fillStyle = k < 20 ? PAL.w : PAL.C;
      ctx.fillRect(s.x, s.y, 1, 1);
      if (k > 8 && k < 14) { ctx.fillRect(s.x - 1, s.y, 3, 1); ctx.fillRect(s.x, s.y - 1, 1, 3); }
    }
  }
  const layers = [[BG.far, 0.1], [BG.mid, 0.25], [BG.near, 0.45]].slice(0, g.layers);
  layers.forEach(([img, p], i) => {
    const off = -Math.floor((camX * p) % 512);
    ctx.drawImage(img, off, 0);
    ctx.drawImage(img, off + 512, 0);
    if (i === 0 && g.mist) {
      // drifting mist between the far and middle ranges
      ctx.fillStyle = 'rgba(160,140,230,0.07)';
      const m = Math.floor(t / 4 + camX * 0.18) % 64;
      for (let k = 0, x = -m; x < SCREEN_W; k++, x += 64) ctx.fillRect(x, 176 + (k % 2) * 3, 48, 9);
      ctx.fillRect(0, 186, SCREEN_W, 6);
    }
  });
}
