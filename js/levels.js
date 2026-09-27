// Level definitions. Each level is built with a tiny builder API so the layouts
// stay readable. Coordinates are in 16px tiles. Layouts are authored on a
// 15-row grid and shifted down by OFF rows to fill the 16:9 screen (17 rows).
//
// Tiles: '#' ground, '=' brick, 'c' crumbling block, '^' spikes, '.' air.
// Objects: signs, checkpoints, springs, dash crystals, embers (collectibles),
// moving platforms, the goal flag, and the mysteries: memory fragments
// (cryptic diary pages) and the Watcher (a shadow that vanishes when approached).

const ROWS = 17;
const OFF = ROWS - 15;

function buildLevel(def) {
  const tiles = Array.from({ length: ROWS }, () => Array(def.width).fill('.'));
  const L = {
    name: def.name, id: def.id, w: def.width, h: ROWS, tiles,
    start: { x: 2, y: 12 }, signs: [], checkpoints: [], springs: [],
    crystals: [], embers: [], movers: [], flag: null,
    fragments: [], watchers: [], secret: def.secret || null,
  };
  const set = (x, y, ch) => { if (x >= 0 && x < def.width && y >= 0 && y < ROWS) tiles[y][x] = ch; };
  const fill = (x0, x1, y0, y1, ch) => {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) set(x, y, ch);
  };
  // Authored y -> real row. Anything hanging from row 0 still touches the ceiling.
  const Y = (y) => y + OFF;
  const fillY = (x0, x1, y0, y1, ch) => fill(x0, x1, y0 <= 0 ? 0 : Y(y0), Y(y1), ch);
  def.build({
    start: (x, y) => { L.start = { x, y: Y(y) }; },
    ground: (x0, x1, top = 13) => fill(x0, x1, Y(top), ROWS - 1, '#'),
    fill: fillY,
    plat: (x, y, w = 1) => fill(x, x + w - 1, Y(y), Y(y), '='),
    crumble: (x, y, w = 1) => fill(x, x + w - 1, Y(y), Y(y), 'c'),
    spikes: (x, y, w = 1) => fill(x, x + w - 1, Y(y), Y(y), '^'),
    sign: (x, y, text) => L.signs.push({ x, y: Y(y), text }),
    checkpoint: (x, y) => L.checkpoints.push({ x, y: Y(y), active: false }),
    spring: (x, y) => L.springs.push({ x, y: Y(y), t: 0 }),
    crystal: (x, y) => L.crystals.push({ x, y: Y(y), gone: 0 }),
    ember: (x, y) => L.embers.push({ x, y: Y(y), got: false }),
    // Moving platform (3 tiles wide) sliding between tile columns x0 and x1 at row y.
    mover: (x0, x1, y, speed = 0.7) => L.movers.push({
      x: x0 * 16, y: Y(y) * 16, w: 48, h: 8, x0: x0 * 16, x1: x1 * 16, dir: 1, speed, dx: 0,
    }),
    flag: (x, y) => { L.flag = { x, y: Y(y) }; },
    fragment: (x, y, text) => L.fragments.push({ x, y: Y(y), text, got: false }),
    watcher: (x, y, text) => L.watchers.push({ x, y: Y(y), text, fade: 0, gone: false }),
  });
  return L;
}

const LEVELS = {
  tutorial: {
    id: 'tutorial',
    name: 'TUTORIAL',
    width: 162,
    build(b) {
      // --- Moving & jumping ---
      b.start(2, 12);
      b.ground(0, 20);
      b.sign(4, 12, 'A / D TO MOVE\nESC TO PAUSE');
      b.sign(10, 12, 'SPACE TO JUMP\nHOLD IT TO JUMP HIGHER');
      b.ground(14, 16, 12);
      b.ground(17, 20, 10);
      b.sign(19, 9, "DON'T FALL OFF\nTHE PRECIPICE!");

      // --- High wall & spikes ---
      b.ground(24, 49);
      b.ground(29, 31, 10);
      b.spikes(34, 12, 2);
      b.sign(32, 12, 'SPIKES ARE DEADLY');
      b.sign(37, 12, 'CHECKPOINTS SAVE\nYOUR PROGRESS');
      b.checkpoint(39, 12);

      // --- Wall slide / wall jump chimney ---
      b.sign(43, 12, 'HOLD INTO A WALL TO SLIDE.\nJUMP OFF WALLS TO CLIMB!');
      b.fill(46, 46, 0, 9, '#');
      b.ground(50, 62, 4);

      // --- Dash ---
      b.sign(52, 3, 'SHIFT TO DASH!\nAIM IT WITH W A S D');
      b.checkpoint(55, 3);
      b.ground(68, 76, 4);
      b.ember(65, 1);
      b.fragment(58, 3, 'WHO CARVED THESE STEPS\nINTO THE MOUNTAIN?');
      b.watcher(74, 3, '...YOU ARE NOT\nTHE FIRST.');
      b.ground(77, 83, 11);
      b.sign(79, 10, 'HOLD W + SHIFT TO DASH UP.\nLANDING RECHARGES YOUR DASH');
      b.ground(84, 88, 6);

      // --- Dash crystals ---
      b.sign(86, 5, 'CRYSTALS REFILL\nYOUR DASH MID-AIR');
      b.crystal(93, 5);
      b.ground(99, 112, 9);
      b.checkpoint(101, 8);

      // --- Springs ---
      b.sign(103, 8, 'SPRINGS LAUNCH\nYOU SKY HIGH');
      b.spring(106, 8);
      b.ground(108, 112, 2);

      // --- Crumbling blocks ---
      b.sign(110, 1, "CRUMBLING BLOCKS\nWON'T HOLD FOR LONG!");
      b.crumble(113, 9, 12);
      b.ground(125, 132, 9);
      b.checkpoint(127, 8);

      // --- Moving platforms ---
      b.sign(129, 8, 'RIDE THE MOVING\nPLATFORM ACROSS');
      b.mover(133, 146, 9);
      b.ground(149, 161, 9);
      b.sign(151, 8, 'EMBERS ARE OPTIONAL.\nREACH THE FLAG!');
      b.flag(157, 8);
    },
  },

  stage1: {
    id: 'stage1',
    name: 'STAGE 1 - THE EDGE',
    width: 166,
    secret: 'THE SHADOW SMILES.\nTHE MOUNTAIN REMEMBERS YOU.',
    build(b) {
      b.start(2, 12);
      b.ground(0, 12);
      b.sign(5, 12, "DON'T LOOK DOWN.");
      b.ground(16, 22, 11);
      b.fragment(20, 10, 'DAY 1. THE SUMMIT CALLS.\nI MUST SEE WHAT IS ABOVE.');
      b.ground(23, 30);
      b.spikes(25, 12, 3);
      b.ember(26, 8);
      b.crumble(31, 11, 8);
      b.ground(39, 44, 9);
      b.checkpoint(42, 8);

      // dash gap, then a ledge you need to dash up to
      b.ground(51, 58, 10);
      b.ground(59, 64, 5);

      // crystal chain over the abyss
      b.crystal(68, 4);
      b.crystal(73, 4);
      b.crystal(78, 4);
      b.ember(73, 1);
      b.ground(83, 91, 6);
      b.checkpoint(86, 5);
      b.watcher(90, 5, 'TURN BACK.');

      // wall-jump chimney
      b.ground(92, 96, 13);
      b.fill(93, 93, 0, 9, '#');
      b.ground(97, 104, 4);
      b.spikes(101, 3, 1);
      b.fragment(103, 3, 'DAY ??. A SHADOW FOLLOWS ME.\nIT WEARS MY FACE.');

      // spring up to a high ledge
      b.ground(105, 110, 11);
      b.spring(108, 10);
      b.ground(111, 116, 3);
      b.checkpoint(114, 2);

      // moving platform over the void
      b.mover(117, 132, 5, 0.8);
      b.ground(135, 142, 5);
      b.ember(126, 1);
      b.watcher(140, 4, 'HIGHER... HIGHER...');

      // the final precipice: a crumbling bridge
      b.crumble(143, 5, 10);
      b.ground(153, 165, 5);
      b.fragment(155, 4, 'I NEVER REACHED THE TOP.\nWILL YOU?');
      b.spikes(157, 4, 1);
      b.flag(162, 4);
    },
  },
};
