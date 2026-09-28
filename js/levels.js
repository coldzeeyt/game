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
  const R = def.rows || ROWS; // tall stages climb above the first screen
  const tiles = Array.from({ length: R }, () => Array(def.width).fill('.'));
  const L = {
    name: def.name, id: def.id, objective: def.objective, w: def.width, h: R, tiles,
    start: { x: 2, y: 12 }, signs: [], checkpoints: [], springs: [],
    crystals: [], embers: [], movers: [], flag: null,
    fragments: [], watchers: [], secret: def.secret || null, everflame: null, boss: null,
    saws: [], vents: [], keys: [], orbs: [],
    chapter: def.chapter || 0, index: def.index, wind: !!def.wind, rain: !!def.rain, tint: def.tint || null,
  };
  const set = (x, y, ch) => { if (x >= 0 && x < def.width && y >= 0 && y < R) tiles[y][x] = ch; };
  const fill = (x0, x1, y0, y1, ch) => {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) set(x, y, ch);
  };
  // Authored y -> real row. Anything hanging from row 0 still touches the ceiling.
  const Y = (y) => y + OFF;
  const fillY = (x0, x1, y0, y1, ch) => fill(x0, x1, y0 <= 0 ? 0 : Y(y0), Y(y1), ch);
  def.build({
    start: (x, y) => { L.start = { x, y: Y(y) }; },
    ground: (x0, x1, top = 13) => fill(x0, x1, Y(top), R - 1, '#'),
    fill: fillY,
    plat: (x, y, w = 1) => fill(x, x + w - 1, Y(y), Y(y), '='),
    tile: (x, y, ch) => set(x, Y(y), ch), // any single tile (used by the level editor)
    // wooden platform you can jump up through and land on (DOWN drops through)
    thru: (x, y, w = 1) => fill(x, x + w - 1, Y(y), Y(y), '-'),
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
    everflame: (x, y) => { L.everflame = { x, y: Y(y) }; },
    boss: (x, y) => { L.boss = { x, y: Y(y) }; },
    ice: (x, y, w = 1) => fill(x, x + w - 1, Y(y), Y(y), 'i'),
    ladder: (x, y0, y1) => fill(x, x, Y(y0), Y(y1), 'H'),
    // puzzles
    key: (x, y) => L.keys.push({ x, y: Y(y), got: false }),
    gate: (x, y0, y1) => fill(x, x, Math.max(0, Y(y0)), Y(y1), 'G'),
    orb: (x, y) => L.orbs.push({ x, y: Y(y) }),
    blue: (x0, x1, y0, y1) => fill(x0, x1, Y(y0), Y(y1), 'B'),
    red: (x0, x1, y0, y1) => fill(x0, x1, Y(y0), Y(y1), 'R'),
    fragment: (x, y, text) => L.fragments.push({ x, y: Y(y), text, got: false }),
    watcher: (x, y, text) => L.watchers.push({ x, y: Y(y), text, fade: 0, gone: false }),
  });
  if (def.index !== undefined && def.chapter >= 1 && !def.bossInfo) placeHazards(L, def);
  return L;
}

// Extra hazards on long flat stretches of ground: saw blades (chapter 2+) and
// fire vents (chapter 3+). Placed after the layout is built, so the terrain is
// unchanged, and kept away from checkpoints, collectables and other objects.
function placeHazards(L, def) {
  const useVents = def.chapter >= 2;
  const blocked = new Set();
  const objs = [...L.signs, ...L.checkpoints, ...L.springs, ...L.fragments, ...L.watchers, ...L.embers, ...L.crystals, ...L.keys, ...L.orbs];
  for (const o of objs) for (let d = -2; d <= 2; d++) blocked.add(o.x + d);
  if (L.flag) for (let d = -5; d <= 5; d++) blocked.add(L.flag.x + d);
  const surface = (x) => {
    for (let y = 0; y < L.h; y++) {
      if ('HGBR'.includes(L.tiles[y][x])) return null; // ladders, gates, switch blocks
      if (L.tiles[y][x] !== '.') return { y, t: L.tiles[y][x] };
    }
    return null;
  };
  let runStart = -1, runY = -1, placed = def.stage % 2, sawDone = false, ventDone = false;
  const flush = (end) => {
    const len = end - runStart + 1;
    if (runStart < 0 || len < 8) return;
    const vent = useVents && placed++ % 2 === 1; // alternate saws and vents
    if (vent) {
      const mid = runStart + Math.floor(len / 2);
      L.vents.push({ x: mid, y: runY, phase: (mid * 37) % 200 });
      if (def.stage <= 2 && def.chapter === 2 && !ventDone) L.signs.push({ x: runStart, y: runY - 1, text: 'FIRE VENTS BURST ON A TIMER.\nWAIT UNTIL THEY COOL DOWN!' });
      ventDone = true;
    } else {
      L.saws.push({ x0: (runStart + 3) * 16, x1: (end - 3) * 16 + 16, y: runY * 16 - 7, x: (runStart + 3) * 16 + 8, dir: 1, speed: 0.6 + Math.min(1, def.chapter / 8) * 0.5 });
      if (def.stage <= 2 && def.chapter === 1 && !sawDone) L.signs.push({ x: runStart, y: runY - 1, text: 'SAW BLADES!\nJUMP OVER THEM.' });
      sawDone = true;
    }
  };
  for (let x = 12; x < L.w - 8; x++) {
    const sfc = surface(x);
    const ok = sfc && sfc.t === '#' && !blocked.has(x);
    if (ok && runStart >= 0 && sfc.y === runY) continue;
    flush(x - 1);
    runStart = ok ? x : -1;
    runY = ok ? sfc.y : -1;
  }
}

const LEVELS = {
  tutorial: {
    id: 'tutorial',
    name: 'TUTORIAL',
    objective: 'LEARN THE ROPES, THEN REACH THE FLAG',
    width: 162,
    build(b) {
      // --- Moving & jumping ---
      b.start(2, 12);
      b.ground(0, 20);
      b.sign(4, 12, '{left} / {right} TO MOVE  ({left2} / {right2})\n{pause} TO PAUSE');
      b.sign(10, 12, '{jump} TO JUMP\nHOLD IT TO JUMP HIGHER');
      b.ground(14, 16, 12);
      b.ground(17, 20, 10);
      b.sign(19, 9, "DON'T FALL OFF\nTHE PRECIPICE!");

      // --- High wall & spikes ---
      b.ground(24, 49);
      b.ground(29, 31, 11);
      b.spikes(34, 12, 2);
      b.sign(32, 12, 'SPIKES ARE DEADLY');
      b.sign(37, 12, 'CHECKPOINTS SAVE\nYOUR PROGRESS');
      b.checkpoint(39, 12);

      // --- Wall slide / wall jump chimney ---
      b.sign(43, 12, 'HOLD INTO A WALL TO SLIDE.\nJUMP OFF WALLS TO CLIMB!');
      b.fill(46, 46, 0, 9, '#');
      b.ground(50, 62, 4);

      // --- Dash ---
      b.sign(52, 3, 'JUMP, THEN PRESS {dash} TO DASH!\nAIM IT WITH THE DIRECTION KEYS');
      b.checkpoint(55, 3);
      b.ground(67, 76, 4);
      b.ember(65, 1);
      b.fragment(58, 3, 'WHO CARVED THESE STEPS\nINTO THE MOUNTAIN?');
      b.watcher(74, 3, '...YOU ARE NOT\nTHE FIRST.');
      b.ground(77, 83, 11);
      b.sign(79, 10, 'JUMP, THEN HOLD {up} + {dash} TO GO UP.\nLANDING RECHARGES YOUR DASH');
      b.ground(84, 88, 8);

      // --- Dash crystals ---
      b.sign(86, 7, 'CRYSTALS REFILL\nYOUR DASH MID-AIR');
      b.crystal(93, 6);
      b.ground(97, 112, 9);
      b.checkpoint(101, 8);

      // --- Springs ---
      b.sign(103, 8, 'SPRINGS LAUNCH YOU SKY HIGH.\nOR CLIMB THE LADDER WITH {up} / {down}');
      b.spring(106, 8);
      b.ground(108, 112, 2);
      b.ladder(107, 2, 8);

      // --- Crumbling blocks ---
      b.sign(110, 1, "CRUMBLING BLOCKS\nWON'T HOLD FOR LONG!");
      b.crumble(113, 9, 12);
      b.ground(125, 132, 9);
      b.checkpoint(127, 8);

      // --- Moving platforms ---
      b.sign(129, 8, 'RIDE THE MOVING\nPLATFORM ACROSS');
      b.mover(133, 146, 9);
      b.ground(149, 161, 9);
      b.ice(149, 9, 7);
      b.sign(151, 8, 'ICE! RUN, THEN LET GO TO SLIDE.\nEMBERS ARE OPTIONAL. REACH THE FLAG!');
      b.flag(157, 8);
    },
  },

  stage1: {
    id: 'stage1',
    name: '1-1 THE EDGE',
    objective: 'CLIMB TO THE FLAG ON THE CLIFF TOP',
    width: 166,
    secret: 'THE SHADOW SMILES.\nTHE MOUNTAIN REMEMBERS YOU.',
    build(b) {
      b.start(2, 12);
      b.ground(0, 12);
      b.sign(5, 12, "DON'T LOOK DOWN.");
      b.ground(16, 22, 12);
      b.fragment(20, 11, 'DAY 1. THE SUMMIT CALLS.\nI MUST SEE WHAT IS ABOVE.');
      b.ground(23, 30);
      b.spikes(25, 12, 3);
      b.ember(26, 8);
      b.crumble(31, 11, 8);
      b.ground(39, 44, 9);
      b.checkpoint(42, 8);

      // dash gap, then a ledge you need to dash up to
      b.ground(51, 58, 10);
      b.ground(59, 64, 7);

      // a dash crystal over the abyss
      b.crystal(69, 5);
      b.ember(69, 2);
      b.ground(73, 91, 8);
      b.checkpoint(78, 7);
      b.watcher(90, 7, 'TURN BACK.');

      // wall-jump chimney
      b.ground(92, 96, 13);
      b.fill(93, 93, 0, 9, '#');
      b.ground(97, 104, 4);
      b.spikes(101, 3, 1);
      b.fragment(103, 3, 'DAY 1, NIGHT. A SHADOW FOLLOWS ME.\nIT WEARS MY FACE.');

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

// ---------------------------------------------------------------------------
// The campaign: 5 chapters x 10 stages. Stage 1-1 is hand-made; the rest are
// assembled from small, individually tested sections ("chunks") by a seeded
// generator, so every stage is the same on every playthrough.
//
// Safe limits the chunks respect (measured with the real physics):
//   plain jump: up to 3-tile gaps (rise 1) or 2-tile gaps (rise 2), rise <= 2
//   jump + dash: gaps up to 5 tiles; jump + up-dash: rises up to 3 tiles
//   springs: rises up to 6 tiles; wall climbing: any height

const CHAPTERS = [
  { name: 'THE FOOTHILLS', tint: null,
    intro: "THE CLIMB BEGINS WHERE ASH'S CAP\nWAS FOUND. THE PATH IS GENTLE HERE...\nFOR NOW.",
    stages: ['THE EDGE', 'MOSSY STEPS', 'OLD TRAIL', "SHEPHERD'S PASS", 'FALLEN PINES', 'BROKEN BRIDGE', 'THE LOOKOUT', 'CRUMBLING PATH', 'LANTERN ROCK', 'LAST MEADOW'] },
  { name: 'THE CLIFFS', tint: 'rgba(140,40,70,0.16)',
    intro: 'THE GRASS GIVES WAY TO SHEER ROCK.\nFROM HERE ON YOU WILL NEED TO DASH,\nCLIMB AND RIDE THE CRYSTALS.',
    stages: ['SHEER FACE', 'CRYSTAL SEAM', 'THE CHIMNEY', "EAGLE'S REST", 'RED ROCK', 'NARROW LEDGE', 'THE CRACK', 'HOLLOW WALL', 'BLUE HOLLOW', "CLIFF'S END"] },
  { name: 'THE STORM', tint: 'rgba(10,20,50,0.35)', wind: true, rain: true,
    intro: 'THE SKY TURNS BLACK. GUSTS OF WIND\nTRY TO THROW YOU OFF THE MOUNTAIN.\nJUMP WHEN THE WIND DIES DOWN.',
    stages: ['FIRST GUST', 'THUNDER STEP', 'HOWLING GAP', 'RAIN WALL', 'LIGHTNING RIDGE', 'THE SQUALL', 'BLACK CLOUDS', 'WINDBREAK', "STORM'S EYE", 'CALM BEFORE'] },
  { name: 'THE FROZEN PASS', tint: 'rgba(90,170,230,0.18)', ice: true,
    intro: 'SNOW AND ICE COVER EVERYTHING.\nTHE GROUND IS SLIPPERY, SO WATCH\nYOUR FOOTING AND YOUR SPEED.',
    stages: ['FROST LINE', 'THE GLACIER', 'ICICLE HALL', 'SNOWBLIND', 'FROZEN FALLS', 'WHITE SILENCE', 'CAP GRAVEYARD', 'COLD STARS', 'THIN ICE', 'THE THAW'] },
  { name: 'THE SUMMIT', tint: 'rgba(210,120,40,0.14)', wind: true, ice: true,
    intro: 'THE AIR IS THIN AND THE EVERFLAME\nLIGHTS UP THE CLOUDS. THE WATCHER\nIS WAITING FOR YOU AT THE TOP.',
    stages: ['THIN AIR', 'CLOUD WALK', 'EMBER FIELDS', 'THE LAST CLIMB', 'SKY STAIRS', "ASH'S PATH", 'THE BURNING WIND', "SHADOW'S REACH", 'ALMOST THERE', 'THE FINAL ASCENT'] },
  // ---- ACT II: unlocked after beating the Watcher
  { name: 'THE FAR SIDE', act: 2, tint: 'rgba(80,60,160,0.2)',
    intro: 'BEYOND THE SUMMIT LIES A SIDE OF THE\nMOUNTAIN NO MAP HAS EVER SHOWN. THE LAST\nEMBER OF THE EVERFLAME GLOWS IN YOUR HAND.',
    stages: ['FIRST LIGHT', 'THE OTHER SLOPE', 'NO MAN\'S LEDGE', 'EMBER TRAIL', 'COLD WIND', 'LONG SHADOWS', 'THE STEEP', 'SILENT PINES', 'LOST MARKERS', 'THE THRESHOLD'] },
  { name: 'THE SUNKEN CAVES', act: 2, tint: 'rgba(0,0,20,0.4)',
    intro: 'THE PATH DIVES INTO CAVES WHERE THE FREED\nLIGHTS WENT TO REST. SOMETHING DOWN HERE\nIS PUTTING THEM OUT, ONE BY ONE.',
    stages: ['THE MOUTH', 'DRIP HOLLOW', 'CRYSTAL VEINS', 'THE DEEP', 'ECHO HALL', 'BLIND DROP', 'LANTERN WELL', 'THE UNDERFALL', 'GLOWWORM PASS', 'THE LAST LIGHT'] },
  { name: 'THE ASHEN WASTES', act: 2, tint: 'rgba(160,60,20,0.2)', wind: true,
    intro: 'BURNT GROUND AND HOT WIND. THE SHADOWS OF\nOLD CLIMBERS WANDER HERE, LOST, STILL\nLOOKING FOR THE WAY HOME.',
    stages: ['CINDER ROAD', 'HOT WIND', 'THE SCORCH', 'SMOKE STACKS', 'EMBERFALL', 'CHARRED BRIDGE', 'DUST DEVILS', 'THE KILN', 'BLACK SAND', 'ASHEN GATE'] },
  { name: 'THE GLASS PEAKS', act: 2, tint: 'rgba(160,220,255,0.18)', wind: true, ice: true,
    intro: 'SPIRES OF CRYSTAL RISE LIKE TEETH. IN\nEVERY ONE, YOUR REFLECTION MOVES A\nMOMENT TOO LATE.',
    stages: ['MIRROR FIELD', 'THE SPIRES', 'SHARD STEPS', 'PRISM LEDGE', 'THIN GLASS', 'REFLECTIONS', 'THE SHATTER', 'COLD FIRE', 'GLASS STORM', 'THE LAST MIRROR'] },
  { name: 'THE HOLLOW CROWN', act: 2, tint: 'rgba(40,0,40,0.35)', wind: true, ice: true, rain: true,
    intro: 'AT THE HEART OF THE MOUNTAIN A SECOND\nFLAME BURNS BLACK. THIS IS WHERE THE\nSHADOWS COME FROM. THIS IS THE END.',
    stages: ['BLACK FIRE', 'THE CROWN', 'HOLLOW STAIRS', 'VOID STEPS', 'THE UNMAKING', 'LAST EMBERS', 'THE THRONE ROAD', 'NAMELESS', 'THE CORE', 'THE HOLLOW GATE'] },
];

// Ash's diary, 5 pages per chapter (found on every other stage).
const DIARY = [
  ['DAY 2. MY LEGS ACHE, BUT THE FLAME\nFEELS CLOSER EVERY NIGHT.',
    'DAY 3. I SAW SOMEONE ON THE RIDGE.\nWHEN I WAVED, THEY WERE GONE.',
    'DAY 4. THE PATH I CAME UP IS NOT\nTHE PATH I SEE BEHIND ME.',
    'DAY 5. I LEFT MY LANTERN ON A ROCK.\nIN THE MORNING IT WAS LIT.',
    'DAY 6. THE FOOTHILLS ARE BEHIND ME.\nTHE CLIFFS START TOMORROW.'],
  ['DAY 8. THE ROCK HERE IS WARM, LIKE\nSOMETHING BREATHES INSIDE IT.',
    'DAY 9. BLUE CRYSTALS GROW FROM THE\nCLIFF. THEY HUM WHEN I TOUCH THEM.',
    'DAY 11. IT FOLLOWS ME NOW. ALWAYS\nONE LEDGE AHEAD. ALWAYS WATCHING.',
    'DAY 12. IT WEARS A CAP LIKE MINE.\nI NEVER TOLD ANYONE ABOUT MY CAP.',
    'DAY 13. I CARVE THESE STONES SO\nSOMEONE WILL KNOW I WAS HERE.'],
  ['DAY 15. THE STORM TALKS. IT SAYS\nMY NAME, OVER AND OVER.',
    'DAY 16. THE WIND PUSHES ME DOWN.\nTHE MOUNTAIN DOES NOT WANT GUESTS.',
    'DAY 17. LIGHTNING SHOWED ME THE\nSHADOW. IT WAS CRYING.',
    'DAY 18. I THINK THE SHADOW WAS A\nCLIMBER ONCE. LIKE ME.',
    'DAY 19. THE FLAME ASKED ME WHAT I\nWANT. I DID NOT ANSWER. NOT YET.'],
  ['DAY 21. EVERYTHING IS ICE. MY\nFINGERS NO LONGER FEEL LIKE MINE.',
    'DAY 22. I FOUND OLD CAPS FROZEN IN\nTHE WALL. RED. ALL OF THEM.',
    'DAY 23. EACH CLIMBER WHO WISHED\nBECAME THE NEXT SHADOW.',
    'DAY 24. THE EVERFLAME NEEDS SOMEONE\nTO KEEP IT BURNING. ALWAYS.',
    'DAY 25. IF YOU READ THIS: DO NOT\nWISH FOR YOURSELF.'],
  ['DAY ??. I CAN SEE THE SUMMIT. THE\nSHADOW WAITS BESIDE THE FLAME.',
    'DAY ??. IT SPOKE. IT SAID: YOU CAME\nBACK. I SAID: I NEVER LEFT.',
    'DAY ??. I KNOW WHAT I WILL WISH FOR.\nI HOPE SOMEONE FINDS THESE.',
    'DAY ??. MY HANDS ARE SHADOW NOW.\nWRITING IS HARD.',
    '...THANK YOU FOR CLIMBING.\n- ASH'],
  // Act II: carvings left by the very first climber
  ['I WAS THE FIRST TO CLIMB. THERE WAS\nNO PATH THEN. I MADE ONE.',
    'THE FLAME WAS SMALL WHEN I FOUND IT.\nIT ASKED ME WHAT I WANTED.',
    'I WISHED TO NEVER DIE.\nIT SAID: THEN YOU WILL NEVER LEAVE.',
    'I THOUGHT I HAD WON.\nI HAD ONLY STOPPED.',
    'YEARS PASS LIKE SNOW HERE. I AM\nTHINNER EVERY WINTER.'],
  ['THE LIGHTS THAT FALL DOWN HERE ARE\nWARM. I HOLD THEM UNTIL THEY GO OUT.',
    'I DO NOT MEAN TO PUT THEM OUT.\nI ONLY WANT TO FEEL SOMETHING.',
    'EVERY CLIMBER WHO WISHED FED MY FIRE.\nIT BURNS BLACK NOW.',
    'THE SHADOWS ARE WHAT IS LEFT OF THEM.\nTHEY ARE WHAT IS LEFT OF ME.',
    'I CARVE MY NAME SO I DO NOT FORGET\nIT. I ALREADY HAVE.'],
  ['THE WIND HERE IS MY BREATH. I CANNOT\nSTOP IT. I HAVE TRIED.',
    'I SAW ASH ONCE. KIND EYES.\nI MADE ASH A SHADOW ANYWAY.',
    'SOMEONE IS CARRYING A LIGHT OVER\nTHE SUMMIT. I CAN FEEL IT.',
    'IT IS SMALL. IT IS WARM.\nIT IS COMING HERE.',
    'IF THEY BRING IT TO ME,\nWILL I PUT IT OUT TOO?'],
  ['THE GLASS SHOWS ME WHO I WAS. I DO\nNOT RECOGNISE THEM.',
    'YOU WEAR HER CAP. YOU HAVE HER\nSTUBBORN WALK.',
    'I AM AFRAID OF YOU, LITTLE LIGHT.\nNO ONE HAS COME THIS FAR.',
    'PERHAPS AN EMBER GIVEN IS NOT\nTHE SAME AS AN EMBER TAKEN.',
    'COME, THEN. I WILL BE WAITING\nAT THE CROWN.'],
  ['THE BLACK FLAME IS ALL I HAVE LEFT.\nDO NOT TAKE IT FROM ME.',
    'I REMEMBER A VALLEY. A DOOR.\nSOMEONE CALLING ME IN FOR SUPPER.',
    'MY NAME WAS... NO. IT IS GONE.',
    'IF YOU GIVE ME YOUR EMBER, I WILL\nHAVE NOTHING LEFT TO HOLD ON TO.',
    'MAYBE THAT IS WHAT I NEED.\n- THE FIRST CLIMBER'],
];

const WHISPERS = [
  ['...YOU ARE NOT\nTHE FIRST.', 'KEEP CLIMBING.', 'I KNOW THAT CAP.', 'NOT MUCH FURTHER...'],
  ['HIGHER...', 'DO YOU SEE ME?', 'WE LOOK ALIKE,\nDON\'T WE?', 'THE FLAME IS WAITING.'],
  ['THE WIND KNOWS\nYOUR NAME.', 'DON\'T LET GO.', 'I WAS HERE ONCE.', 'LISTEN TO THE STORM.'],
  ['SO COLD...', 'FIND THE CAPS.', 'I WISHED. DON\'T.', 'ALMOST...'],
  ['YOU CAME BACK.', 'I HAVE WAITED\nSO LONG.', 'COME TO THE FLAME.', 'SET US FREE.'],
  ['WHO CARRIES\nTHAT LIGHT?', 'TURN BACK,\nEMBER-BEARER.', 'THIS SIDE IS MINE.', 'YOU SHOULD NOT\nBE HERE.'],
  ['IT IS SO DARK...', 'GIVE ME THE\nWARM THING.', 'THEY ALL GO OUT.', 'DEEPER...'],
  ['WE ARE LOST.', 'WHICH WAY IS\nHOME?', 'THE WIND\nREMEMBERS US.', 'HELP US...'],
  ['LOOK AT YOURSELF.', 'TOO LATE,\nTOO LATE.', 'THE GLASS LIES.', 'I SEE YOU.'],
  ['COME TO THE CROWN.', 'I AM SO TIRED.', 'END IT.', 'PLEASE.'],
];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOP_ROW = 5; // highest ground a chunk may build (authored rows)
const LOW_ROW = 13; // lowest ground

// Each chunk starts with the player standing on ground at row g.y that ends at
// column g.x - 1, and must leave the same situation behind (floor of 3+ tiles).
const CHUNKS = {
  gap(g) {
    const w = g.d > 0.35 && g.r() < 0.6 ? 3 : 2;
    const dy = g.pick(w === 3 ? [-1, 0, 0, 1, 2] : [-2, -1, 0, 1, 2]);
    g.hop(w, dy, true);
    g.floor(g.int(4, 6)); // room to land and stop
  },
  steps(g) {
    const n = g.int(2, 3);
    const up = g.y - 2 * n >= TOP_ROW + 1 || g.r() < 0.2 ? -1 : 1;
    for (let i = 0; i < n; i++) {
      g.setY(g.y + up * g.int(1, 2));
      g.floor(g.int(2, 4));
    }
    g.floor(2);
  },
  spikes(g) {
    const len = g.int(9, 12);
    const x0 = g.x;
    g.floor(len);
    const k = g.d > 0.4 ? 2 : 1;
    g.b.spikes(x0 + 3, g.y - 1, k);
    if (g.r() < g.emberChance) g.b.ember(x0 + 3, g.y - 3);
    // a second spike run only if there are 3 tiles to land before it and after it
    if (len >= k + 10 && g.d > 0.3) g.b.spikes(x0 + 3 + k + 3, g.y - 1, 1);
  },
  plats(g) {
    const n = g.int(2, 3);
    for (let i = 0; i < n; i++) {
      g.hop(g.int(2, 3), g.pick([-1, 0, 1]), i === 1);
      g.b.plat(g.x, g.y, 2);
      g.x += 2;
    }
    g.hop(g.int(2, 3), g.pick([-1, 0, 1]));
    g.floor(4);
  },
  crumble(g) {
    const w = g.int(5, 7 + Math.round(g.d * 4));
    g.b.crumble(g.x, g.y, w);
    if (g.r() < g.emberChance) g.b.ember(g.x + Math.floor(w / 2), g.y - 2);
    g.x += w;
    g.floor(4);
  },
  spring(g) {
    const rise = Math.min(g.int(4, 6), g.y - TOP_ROW);
    if (rise < 3) return CHUNKS.drop(g);
    const x0 = g.x;
    g.floor(4);
    g.b.spring(x0 + 1, g.y - 1);
    if (g.chunkNo % 2 === 0) g.b.ladder(x0 + 3, g.y - rise, g.y - 1); // an easier way up
    g.setY(g.y - rise);
    g.floor(5);
    if (g.r() < g.emberChance) g.b.ember(x0 + 1, g.y - 2);
  },
  drop(g) {
    const down = Math.min(g.int(2, 4), LOW_ROW - g.y);
    if (down < 1) return CHUNKS.steps(g);
    g.floor(2);
    g.setY(g.y + down);
    g.floor(g.int(4, 6));
  },
  mover(g) {
    const w = g.int(10, 14 + Math.round(g.d * 4));
    g.b.mover(g.x, g.x + w - 3, g.y, 0.6 + g.d * 0.4);
    if (g.r() < g.emberChance) g.b.ember(g.x + Math.floor(w / 2), g.y - 3);
    g.x += w;
    g.floor(5);
  },
  // --- chapter 2 onwards
  dashgap(g) {
    const w = g.d > 0.5 && g.r() < 0.5 ? 5 : 4;
    g.hop(w, g.pick([0, 0, 1]));
    if (g.r() < g.emberChance) g.b.ember(g.x - Math.ceil(w / 2), g.y - 3);
    g.floor(g.int(4, 6)); // dash landings need room to stop
  },
  updash(g) {
    if (g.y - 3 < TOP_ROW) return CHUNKS.drop(g);
    g.floor(3);
    g.setY(g.y - 3);
    g.floor(g.int(4, 6));
  },
  crystal(g) {
    // same geometry as the tutorial's crystal gap
    const e = g.x - 1;
    const ny = Math.min(g.y + 1, LOW_ROW);
    g.b.crystal(e + 5, g.y - 2);
    if (g.r() < g.emberChance) g.b.ember(e + 5, g.y - 5);
    g.x = e + 9;
    g.setY(ny);
    g.floor(g.int(4, 6));
  },
  climb(g) {
    const rise = Math.min(g.int(4, 7), g.y - TOP_ROW);
    if (rise < 3) return CHUNKS.drop(g);
    g.floor(3);
    if (g.chunkNo % 2 === 0) g.b.ladder(g.x - 1, g.y - rise, g.y - 1); // ladder on the wall face
    g.setY(g.y - rise);
    g.floor(g.int(4, 6));
  },
  // --- going up: a vertical shaft to climb, then carry on higher up
  tower(g) {
    const rise = 2 * Math.floor(g.int(8, 11 + Math.round(g.d * 5)) / 2); // even: ledges every 2 rows
    const styles = g.chapter === 0 ? ['ladder', 'thru', 'zig'] : ['ladder', 'zig', 'thru', 'crumble'];
    const style = styles[g.chunkNo % styles.length];
    g.floor(3);
    const sx = g.x, top = g.y - rise;
    g.b.ground(sx, sx + 6, g.y); // shaft floor
    g.b.ground(sx + 7, sx + 10, top); // the cliff you're climbing
    if (style === 'ladder') g.b.ladder(sx + 6, top, g.y - 1);
    else if (style === 'thru') {
      // a stack of wooden platforms across the shaft: jump up through each one
      for (let yy = top + 2; yy <= g.y - 2; yy += 2) g.b.thru(sx + 1, yy, 6);
      if (!g.thruSign) { g.b.sign(sx - 2, g.y - 1, 'WOODEN PLATFORMS: JUMP UP THROUGH\nTHEM. PRESS DOWN TO DROP BACK.'); g.thruSign = true; }
    } else {
      // zig-zag ledges two rows apart, the top one next to the cliff
      let right = true;
      for (let yy = top + 2; yy <= g.y - 2; yy += 2) {
        const px = right ? sx + 4 : sx;
        if (style === 'crumble' && !right) g.b.crumble(px, yy, 3); else g.b.plat(px, yy, 3);
        right = !right;
      }
    }
    g.x = sx + 11;
    g.y = top;
    g.rebase();
    g.floor(g.int(3, 5));
  },
  // --- thinking: a locked gate; the key waits on a ledge up a ladder
  keygate(g) {
    g.floor(3);
    const x0 = g.x, y = g.y;
    g.b.ground(x0, x0 + 12, y);
    g.b.ladder(x0, y - 5, y - 1);
    g.b.plat(x0 + 1, y - 5, 6);
    g.b.key(x0 + 5, y - 6);
    g.b.gate(x0 + 10, y - 12, y - 1);
    if (!g.keySign) { g.b.sign(x0 - 2, y - 1, 'THE GATE IS LOCKED.\nFIND THE KEY FIRST!'); g.keySign = true; }
    g.x = x0 + 13;
    g.floor(3);
  },
  // --- thinking: orbs flip blue/red blocks. Cross the blue bridge, then flip back to drop the blue wall.
  switches(g) {
    g.floor(4);
    const x0 = g.x, y = g.y;
    g.b.orb(x0 - 2, y - 3); // orb A before the gap
    g.b.blue(x0, x0 + 7, y, y); // bridge (ghost until flipped); 8 wide, too far to dash
    g.b.ground(x0 + 8, x0 + 13, y);
    g.b.orb(x0 + 9, y - 3); // orb B on the far side
    g.b.blue(x0 + 12, x0 + 12, y - 7, y - 1); // blue wall: appears with the bridge
    if (!g.orbSign) { g.b.sign(x0 - 4, y - 1, 'JUMP INTO AN ORB TO FLIP THE BLUE\nBLOCKS ON AND OFF. THINK AHEAD!'); g.orbSign = true; }
    g.x = x0 + 14;
    g.floor(3);
  },

  // --- chapter 4 onwards
  ice(g) {
    const len = g.int(6, 10);
    g.b.ground(g.x, g.x + len - 1, g.y);
    g.b.ice(g.x, g.y, len);
    g.x += len;
    g.hop(2, g.pick([0, 1]));
    g.floor(g.int(4, 6));
  },
};

const CHUNK_SETS = [
  { gap: 4, steps: 3, spikes: 2, plats: 2, crumble: 1, spring: 2, drop: 2, mover: 1, tower: 1, keygate: 1, switches: 1 },
  { gap: 2, steps: 1, spikes: 2, plats: 1, crumble: 2, spring: 1, drop: 1, mover: 1, dashgap: 3, updash: 2, crystal: 2, climb: 2, tower: 2, keygate: 1, switches: 1 },
  { gap: 3, steps: 1, spikes: 2, plats: 2, crumble: 2, spring: 1, drop: 1, mover: 2, dashgap: 2, updash: 1, crystal: 2, climb: 2, tower: 2, keygate: 1, switches: 1 },
  { gap: 2, steps: 1, spikes: 2, plats: 1, crumble: 2, spring: 1, drop: 1, mover: 1, dashgap: 2, updash: 1, crystal: 2, climb: 1, ice: 4, tower: 2, keygate: 1, switches: 1 },
  { gap: 2, steps: 1, spikes: 3, plats: 2, crumble: 3, spring: 1, drop: 1, mover: 2, dashgap: 3, updash: 2, crystal: 3, climb: 2, ice: 3, tower: 2, keygate: 1, switches: 1 },
  // Act II
  { gap: 3, steps: 1, spikes: 3, plats: 2, crumble: 2, spring: 1, drop: 1, mover: 2, dashgap: 3, updash: 2, crystal: 3, climb: 2, tower: 2, keygate: 1, switches: 1 },
  { gap: 2, steps: 1, spikes: 2, plats: 2, crumble: 4, spring: 2, drop: 2, mover: 1, dashgap: 2, updash: 2, crystal: 4, climb: 3, tower: 2, keygate: 1, switches: 1 },
  { gap: 3, steps: 1, spikes: 3, plats: 3, crumble: 2, spring: 1, drop: 1, mover: 3, dashgap: 3, updash: 1, crystal: 2, climb: 1, tower: 2, keygate: 1, switches: 1 },
  { gap: 2, steps: 1, spikes: 2, plats: 2, crumble: 2, spring: 1, drop: 1, mover: 2, dashgap: 3, updash: 2, crystal: 3, climb: 2, ice: 5, tower: 2, keygate: 1, switches: 1 },
  { gap: 2, steps: 1, spikes: 3, plats: 2, crumble: 3, spring: 1, drop: 1, mover: 2, dashgap: 4, updash: 2, crystal: 4, climb: 2, ice: 3, tower: 2, keygate: 1, switches: 1 },
];

function generateStage(chapter, stage, index) {
  const ch = CHAPTERS[chapter];
  const seed = 1000 + chapter * 97 + stage * 13;
  // Overall difficulty 0..1. Chapter 1 is kept gentle: small gaps, single
  // spikes, short crumbling bridges and shorter stages.
  const act2 = chapter >= 5;
  const d = chapter === 0 ? stage / 60 : act2 ? Math.min(1, 0.8 + (chapter - 5) * 0.05 + stage * 0.005) : Math.min(1, (chapter * 10 + stage) / 45);
  const count = chapter === 0 ? 10 + Math.round(stage * 1.3) : act2 ? 22 + stage * 2 + (chapter - 5) * 3 : 16 + stage * 2 + chapter * 3;
  const final = false; // the Everflame now waits in the boss arena
  const def = {
    id: 'c' + (chapter + 1) + 's' + (stage + 1),
    index, chapter, stage,
    name: (chapter + 1) + '-' + (stage + 1) + ' ' + ch.stages[stage],
    objective: final ? 'REACH THE EVERFLAME' : 'REACH THE FLAG',
    wind: !!ch.wind, rain: !!ch.rain, tint: ch.tint,
    width: 0,
    build(rawB) {
      const r = mulberry32(seed); // fresh every build so the layout never changes
      def.chunkLog = [];
      // Chunks work in a 15-row "band"; g.base shifts the band up as the stage climbs.
      const g = {
        r, d, x: 0, y: 13, base: def.base0 || 0, minRow: 0, chapter, chunkNo: 0, emberChance: 0.22 + d * 0.1,
        rebase() {
          if (this.y < TOP_ROW + 2) { const s = 10 - this.y; this.base -= s; this.y += s; }
        },
        int: (a, z) => a + Math.floor(r() * (z - a + 1)),
        pick: (arr) => arr[Math.floor(r() * arr.length)],
        setY(y) { this.y = Math.max(TOP_ROW, Math.min(LOW_ROW, y)); },
        floor(len) { this.b.ground(this.x, this.x + len - 1, this.y); this.x += len; },
        // jump a gap; rises are capped so the jump stays possible
        hop(w, dy, ember) {
          const maxRise = w >= 3 ? 1 : 2;
          const oldY = this.y;
          this.x += w;
          this.setY(this.y + Math.max(-maxRise, dy));
          if (ember && r() < this.emberChance) this.b.ember(this.x - Math.ceil(w / 2), Math.min(oldY, this.y) - 2);
        },
      };
      g.b = offsetBuilder(rawB, () => g.base, (row) => { g.minRow = Math.min(g.minRow, row); });
      const b = g.b;
      b.start(2, 12);
      g.floor(8);
      if (stage === 0 && ch.wind) b.sign(5, 12, 'GUSTS PUSH YOU BACK.\nJUMP WHEN THE WIND DIES DOWN!');
      else if (stage === 0 && ch.ice && !ch.wind) b.sign(5, 12, 'ICE IS SLIPPERY.\nGIVE YOURSELF ROOM TO STOP!');
      else if (stage === 0 && chapter === 1) b.sign(5, 12, 'FROM HERE ON, EXPECT TO DASH\nAND CLIMB. GOOD LUCK.');
      const weights = CHUNK_SETS[chapter];
      const names = Object.keys(weights);
      const total = names.reduce((t, n) => t + weights[n], 0);
      let last = '';
      const fragAt = stage % 2 === 1 ? Math.floor(count / 2) : -1;
      const watcherAt = stage % 2 === 0 && stage > 0 ? Math.floor(count * 0.6) : -1;
      for (let i = 0; i < count; i++) {
        let name;
        do {
          let roll = r() * total;
          name = names.find((n) => (roll -= weights[n]) < 0) || names[0];
        } while (name === last && names.length > 1);
        last = name;
        g.chunkNo = i;
        if ((name === 'keygate' || name === 'switches') && chapter === 0 && stage < 3) name = 'gap'; // puzzles from 1-4
        const cx0 = g.x;
        CHUNKS[name](g);
        def.chunkLog.push([name, cx0, g.x]); // which section is where (used by the test tools)
        if (g.x > 2 && i % 3 === 2) b.checkpoint(g.x - 2, g.y - 1);
        if (i === fragAt) b.fragment(g.x - 3, g.y - 1, DIARY[chapter][Math.floor(stage / 2)]);
        if (i === watcherAt) b.watcher(g.x - 1, g.y - 1, WHISPERS[chapter][(stage / 2 - 1) % 4 | 0]);
      }
      const x0 = g.x;
      g.floor(14);
      if (final) b.everflame(x0 + 8, g.y - 1);
      else b.flag(x0 + 8, g.y - 1);
      def.width = g.x;
      def.minRow = g.minRow;
    },
  };
  // Dry build: works out the width and how high the stage climbs, then size it.
  buildLevelDry(def);
  def.base0 = Math.max(0, 4 - def.minRow); // keep a few rows of sky above the highest point
  def.rows = ROWS + def.base0;
  buildLevelDry(def);
  return def;
}

// Rows passed to the builder are band rows; add the band offset.
const ROW_ARGS = {
  start: [1], ground: [2], plat: [1], thru: [1], crumble: [1], spikes: [1], sign: [1], checkpoint: [1], spring: [1],
  crystal: [1], ember: [1], mover: [2], flag: [1], everflame: [1], ice: [1], ladder: [1, 2], fragment: [1],
  watcher: [1], key: [1], gate: [1, 2], orb: [1], blue: [2, 3], red: [2, 3],
};
function offsetBuilder(b, getBase, onRow) {
  const o = {};
  for (const k in ROW_ARGS) {
    o[k] = (...a) => {
      const base = getBase();
      for (const i of ROW_ARGS[k]) { a[i] += base; onRow(a[i]); }
      return b[k](...a);
    };
  }
  return o;
}

function buildLevelDry(def) {
  const noop = () => {};
  const stub = new Proxy({}, { get: () => noop });
  def.width = 4096; // plenty of room for the dry run
  def.build(stub);
}

const CAMPAIGN = [];
function addChapter(c) {
  for (let st = 0; st < 10; st++) {
    let def;
    if (c === 0 && st === 0) {
      def = LEVELS.stage1;
      Object.assign(def, { index: 0, chapter: 0, stage: 0 });
    } else {
      def = generateStage(c, st, CAMPAIGN.length);
    }
    CAMPAIGN.push(def);
    LEVELS[def.id] = def;
  }
}

// Boss arenas: one screen, you against a shadow. The Everflame appears once it's beaten.
function bossArena(id, chapter, name, opts) {
  return {
    id, chapter, stage: 10, name,
    objective: opts.objective,
    tint: opts.tint,
    width: 30,
    bossInfo: opts,
    build(b) {
      b.start(2, 12);
      b.ground(0, 29, 13);
      if (opts.spikes) b.spikes(14, 12, 2); // narrow enough to jump without a dash
      b.plat(5, 10, 3);
      b.plat(22, 10, 3);
      b.plat(13, 7, 4);
      b.crystal(3, 6);
      b.crystal(26, 6);
      b.sign(4, 12, 'WHEN THE SHADOW IS DAZED,\nDASH INTO IT!');
      b.boss(20, 5);
    },
  };
}

for (let c = 0; c < 5; c++) addChapter(c);
LEVELS.boss = bossArena('boss', 4, '5-B THE WATCHER', {
  objective: 'DEFEAT YOUR SHADOW', tint: 'rgba(120,20,40,0.2)', hp: 5, bonus: 0, title: 'THE WATCHER',
  intro: 'SO YOU FINALLY CAME.\nSHOW ME YOU ARE STRONGER THAN I WAS.',
  outro: ['ASH', '...THANK YOU. I REMEMBER NOW.\nGO ON. THE FLAME IS YOURS.'],
});
LEVELS.boss.index = CAMPAIGN.length;
CAMPAIGN.push(LEVELS.boss);
const ACT2_START = CAMPAIGN.length;

for (let c = 5; c < 10; c++) addChapter(c);
LEVELS.boss2 = bossArena('boss2', 9, '10-B THE HOLLOW', {
  objective: 'FACE THE FIRST CLIMBER', tint: 'rgba(60,0,60,0.3)', hp: 7, bonus: 1, spikes: true, title: 'THE HOLLOW',
  intro: 'YOU BROUGHT THE LAST EMBER.\nGIVE IT TO ME... OR TAKE MY FLAME.',
  outro: ['THE FIRST CLIMBER', 'IT IS... WARM. I REMEMBER MY NAME.\nTAKE THE LIGHT HOME, LITTLE ONE.'],
});
LEVELS.boss2.index = CAMPAIGN.length;
CAMPAIGN.push(LEVELS.boss2);

// ---------------------------------------------------------------- ONLY UP
// One enormous tower (the same for everyone): no checkpoints, no spikes, no
// deaths. The only enemy is gravity: slip, and you fall back down.
const ONLY_UP_ROWS = 720;
const ONLY_UP_SIGNS = [
  "DON'T LOOK DOWN.",
  'STILL GOING? GOOD.',
  'THE CLOUDS ARE BELOW YOU NOW.',
  'ASH NEVER GOT THIS HIGH.',
  'THE WIND HAS NOTHING UP HERE TO PUSH.',
  'ALMOST THERE. PROBABLY.',
  'IS THAT THE MOON? KEEP CLIMBING.',
];
LEVELS.onlyup = {
  id: 'onlyup', name: 'ONLY UP', objective: "CLIMB. DON'T FALL.", onlyUp: true,
  width: 34, rows: ONLY_UP_ROWS,
  build(b) {
    const R = ONLY_UP_ROWS, Wd = 34;
    const r = mulberry32(90210); // fixed seed: everyone climbs the same tower
    const int = (a, c) => a + Math.floor(r() * (c - a + 1));
    const at = (row) => row - OFF; // the builder adds OFF to every row
    b.ground(0, Wd - 1, at(R - 3));
    b.start(3, at(R - 4));
    b.sign(6, at(R - 4), "ONLY UP.\nNO CHECKPOINTS. SLIP, AND YOU FALL.\nYOUR PROGRESS SAVES WHEN YOU QUIT.");
    let x = 8, y = R - 3, w = 5, dir = 1, n = 0, signNo = 0, lastRest = R, dashSign = false;
    const clampX = (v, lw) => Math.max(1, Math.min(Wd - 1 - lw, v));
    const ledge = (lx, ly, lw, kind) => {
      if (kind === 'ice') b.ice(lx, at(ly), lw);
      else if (kind === 'crumble') b.crumble(lx, at(ly), lw);
      else b.plat(lx, at(ly), lw);
    };
    while (y > 14) {
      n++;
      const d = 1 - y / R; // 0 at the bottom, 1 at the top
      // a rest stop every so often: a wide ledge and a sign
      if (lastRest - y > 70) {
        // (a wooden platform, so it never blocks a jump from underneath)
        const rx = clampX(dir > 0 ? x + w + 1 : x - 9, 8);
        const ry = y - 2;
        b.thru(rx, at(ry), 8);
        b.sign(rx + 3, at(ry - 1), ONLY_UP_SIGNS[signNo++ % ONLY_UP_SIGNS.length]);
        x = rx; y = ry; w = 8; lastRest = y;
        continue;
      }
      const roll = r();
      const kinds = d < 0.25 ? ['plat'] : d < 0.55 ? ['plat', 'plat', 'crumble'] : ['plat', 'crumble', 'ice', 'plat'];
      if (roll < 0.12 && y > 30) {
        // ladder up the side of the ledge
        // ladder over the end of this ledge (so you can stand at its foot); step off at the top
        const h = int(5, 8);
        const lx = dir > 0 ? x + w - 1 : x;
        const nx = dir > 0 ? lx + 1 : lx - 3;
        if (nx < 1 || nx + 3 > Wd - 1) { dir = -dir; continue; }
        b.ladder(lx, at(y - h), at(y - 1));
        b.plat(nx, at(y - h), 3);
        x = nx; y -= h; w = 3;
      } else if (roll < 0.22 && y > 30) {
        // a stack of wooden platforms to jump up through
        const count = int(3, 5);
        for (let i = 1; i <= count; i++) b.thru(x, at(y - i * 2), Math.max(3, w));
        y -= count * 2; w = Math.max(3, w);
      } else if (roll < 0.30 && y > 30 && d > 0.15) {
        // a spring to a high ledge
        // the landing is a wide wooden platform beside the spring: you fly up through it and land on top
        const sx = dir > 0 ? x + w - 1 : x;
        const nx = dir > 0 ? sx + 1 : sx - 5;
        if (nx < 1 || nx + 5 > Wd - 1) { dir = -dir; continue; }
        b.spring(sx, at(y - 1));
        y -= 7; x = nx; w = 5;
        b.thru(x, at(y), w);
      } else if (roll < 0.36 && y > 30 && d > 0.3) {
        // dash up: a crystal in the air on the way to a ledge far above
        // (the target is a wooden platform, so you can dash up through it)
        const nx = clampX(x + dir * 2, 3);
        if (!dashSign) { b.sign(x + Math.floor(w / 2), at(y - 1), 'SEE THAT CRYSTAL?\nJUMP, THEN DASH UP THROUGH IT.'); dashSign = true; }
        b.crystal(nx + 1, at(y - 4));
        y -= 5; x = nx; w = 3;
        b.thru(x, at(y), w);
      } else {
        // an ordinary jump: higher jumps get shorter gaps
        const dy = int(1, 2), gap = dy === 2 ? int(1, 2) : int(2, 3);
        const nw = Math.max(2, Math.round(4 - d * 2 - r()));
        let nx = dir > 0 ? x + w + gap : x - gap - nw;
        if (nx < 1 || nx + nw > Wd - 1) { dir = -dir; nx = dir > 0 ? x + w + gap : x - gap - nw; }
        let above = false;
        if (nx < 1 || nx + nw > Wd - 1) { nx = clampX(x, nw); above = true; }
        y -= dy + (above ? 1 : 0); x = nx; w = nw;
        if (above) b.thru(x, at(y), w); // straight above us: make it jump-through
        else ledge(x, y, w, kinds[Math.floor(r() * kinds.length)]);
      }
      if (r() < 0.2) dir = -dir; // wander left and right
    }
    // the top
    const tx = clampX(x - 3, 10);
    b.thru(tx, at(y - 2), 10);
    b.flag(tx + 7, at(y - 3));
    b.sign(tx + 2, at(y - 3), 'YOU MADE IT.\nTHERE IS NOTHING HIGHER THAN THIS.');
  },
};
