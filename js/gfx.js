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
  '.nmlvvvlmmn.',
  '.nmllvllmmn.',
  '.nmlvlvlmmn.',
  '.nmlllllmmn.',
  '.nmlVvVlmmn.',
  '.nmllvllmmn.',
  '.nmlvllvmmn.',
  '.nmlllllmmn.',
  '.nmmmmmmmmn.',
  'nnnnnnnnnnnn',
  'nmmmmmmmmmmn',
]);

// ---------- Tiles (kept deliberately simple) ----------
function makeTile(kind) {
  const c = makeCanvas(16, 16);
  const x = c.getContext('2d');
  const rect = (col, i, j, w, h) => { x.fillStyle = col; x.fillRect(i, j, w, h); };

  if (kind === 'dirt' || kind === 'grass') {
    rect(PAL.d, 0, 0, 16, 16);
    // a few evenly spaced pebbles
    for (const [i, j] of [[3, 5], [11, 3], [7, 10], [13, 12], [2, 13]]) rect(PAL.D, i, j, 2, 1);
    if (kind === 'grass') {
      rect(PAL.g, 0, 0, 16, 4);
      rect(PAL.G, 0, 0, 16, 1);
      for (let i = 1; i < 16; i += 4) rect(PAL.g, i, 4, 2, 1);
    }
  } else if (kind === 'brick') {
    rect(PAL.m, 0, 0, 16, 16);
    rect(PAL.n, 0, 7, 16, 1);
    rect(PAL.n, 0, 15, 16, 1);
    rect(PAL.n, 7, 0, 1, 7);
    rect(PAL.n, 3, 8, 1, 7);
    rect(PAL.n, 11, 8, 1, 7);
  } else if (kind === 'crumble') {
    rect('#c84c0c', 0, 0, 16, 16);
    rect('#fc9838', 0, 0, 16, 1);
    rect('#7c2c00', 0, 15, 16, 1);
    rect('#7c2c00', 15, 0, 1, 16);
    for (const [i, j] of [[4, 3], [5, 4], [6, 5], [6, 6], [10, 8], [9, 9], [9, 10], [4, 11], [5, 12]]) rect('#502000', i, j, 1, 1);
  } else if (kind === 'spike') {
    for (let s = 0; s < 2; s++) {
      const x0 = s * 8;
      for (let j = 0; j < 8; j++) {
        const half = Math.floor(j / 2);
        rect(PAL.l, x0 + 3 - half, 8 + j, 2 + half * 2, 1);
      }
    }
  }
  return c;
}

const TILES = {
  grass: makeTile('grass'),
  dirt: makeTile('dirt'),
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

// ---------- Background (flat, simple parallax that wraps every 512px) ----------
const SCREEN_W = 480;
const SCREEN_H = 270;

const BG = (() => {
  const sky = makeCanvas(SCREEN_W, SCREEN_H);
  const s = sky.getContext('2d');
  s.fillStyle = '#0c0828';
  s.fillRect(0, 0, SCREEN_W, SCREEN_H);
  s.fillStyle = '#1c1048';
  s.fillRect(0, 110, SCREEN_W, SCREEN_H - 110);
  const r = rng(99);
  s.fillStyle = PAL.w;
  for (let i = 0; i < 40; i++) s.fillRect((r() * SCREEN_W) | 0, (r() * 120) | 0, 1, 1);
  // moon
  s.fillStyle = '#fce0a8';
  for (let j = -9; j <= 9; j++) for (let i = -9; i <= 9; i++) if (i * i + j * j <= 81) s.fillRect(430 + i, 30 + j, 1, 1);

  const layer = (base, amps, color) => {
    const c = makeCanvas(512, SCREEN_H);
    const x = c.getContext('2d');
    x.fillStyle = color;
    for (let i = 0; i < 512; i += 2) {
      let h = base;
      amps.forEach(([a, f, p]) => { h += a * Math.sin((2 * Math.PI * i * f) / 512 + p); });
      h = Math.round(h / 4) * 4; // chunky steps
      x.fillRect(i, h, 2, SCREEN_H - h);
    }
    return c;
  };
  return {
    sky,
    far: layer(140, [[30, 2, 0], [12, 5, 1]], '#2c1c5c'),
    near: layer(205, [[16, 3, 0.5], [8, 7, 0]], '#140c30'),
  };
})();

function drawBackground(ctx, camX) {
  ctx.drawImage(BG.sky, 0, 0);
  for (const [img, p] of [[BG.far, 0.15], [BG.near, 0.4]]) {
    const off = -Math.floor((camX * p) % 512);
    ctx.drawImage(img, off, 0);
    ctx.drawImage(img, off + 512, 0);
  }
}
