// Precipice account server: sign up, log in, log out, and a cloud copy of
// each player's saves so they can move between devices.
// No dependencies; accounts live in one JSON file (put DATA_DIR on a volume).
// Passwords are stored only as salted scrypt hashes, and login tokens only as
// SHA-256 hashes.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'accounts.json');
const MAX_BODY = 256 * 1024; // saves are small; this is plenty
const MAX_TOKENS = 10; // devices logged in at once, per account
const USER_RE = /^[A-Z0-9]{3,12}$/;
// Dev notes: everyone can read them, only this account can write them.
const DEV_USER = String(process.env.DEV_USER || 'COLDZEEYT').toUpperCase();
const MAX_NOTES = 20000; // characters
const ONLINE_MS = 2 * 60 * 1000; // seen in the last 2 minutes = online
const MAX_MSG = 300; // characters per message
// Direct messages are only between the dev and a player (never player to player).
const canTalk = (a, b) => a !== b && (a === DEV_USER || b === DEV_USER);
const sent = new Map(); // name -> recent send times (flood control)

// ---- published levels (the level editor's online browser)
const LEVEL_TILES = new Set('.#=-c^iHGBR');
const LEVEL_OBJS = new Set(['checkpoint', 'spring', 'crystal', 'ember', 'key', 'orb', 'mover']);
const clampInt = (v, a, b) => Math.max(a, Math.min(b, Math.floor(Number(v)) || 0));
// Checks a level from the editor and returns a clean copy (or null if it's broken).
function cleanLevel(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.rows)) return null;
  const w = clampInt(d.w, 20, 400), h = clampInt(d.h, 17, 80);
  if (d.rows.length !== h) return null;
  const rows = d.rows.map((r) => [...String(r).padEnd(w, '.').slice(0, w)].map((c) => (LEVEL_TILES.has(c) ? c : '.')).join(''));
  const pt = (p) => (Array.isArray(p) ? [clampInt(p[0], 0, w - 1), clampInt(p[1], 0, h - 1)] : null);
  const obj = (Array.isArray(d.obj) ? d.obj : []).filter((o) => Array.isArray(o) && LEVEL_OBJS.has(o[0])).slice(0, 300)
    .map((o) => [o[0], clampInt(o[1], 0, w - 1), clampInt(o[2], 0, h - 1)].concat(o[0] === 'mover' ? [clampInt(o[3], 0, w - 3)] : []));
  const start = pt(d.start), flag = pt(d.flag);
  if (!start || !flag) return null;
  const name = String(d.name || 'UNTITLED').toUpperCase().replace(/[^A-Z0-9 !?.,'&:()\-]/g, '').trim().slice(0, 20) || 'UNTITLED';
  return { name, w, h, rows, obj, start, flag };
}
const levelInfo = (l) => ({ id: l.id, name: l.name, author: l.author, at: l.at, plays: l.plays || 0, featured: !!l.featured, w: l.data.w, h: l.data.h });
const newLevelId = () => { let id; do id = crypto.randomBytes(3).toString('hex').toUpperCase(); while ((db.levels || []).some((l) => l.id === id)); return id; };

fs.mkdirSync(DATA_DIR, { recursive: true });
let db = { accounts: {} };
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { /* new server */ }

// Write to a temp file and rename, so a crash never leaves a half-written file.
let writing = false, dirty = false;
function persist() {
  if (writing) { dirty = true; return; }
  writing = true;
  const tmp = FILE + '.tmp';
  fs.writeFile(tmp, JSON.stringify(db), (err) => {
    if (!err) fs.renameSync(tmp, FILE);
    else console.error('save failed', err);
    writing = false;
    if (dirty) { dirty = false; persist(); }
  });
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
function hashPass(pass, salt) {
  return new Promise((ok, bad) => crypto.scrypt(pass, salt, 32, (e, k) => (e ? bad(e) : ok(k.toString('hex')))));
}
function newToken(acc) {
  const token = crypto.randomBytes(24).toString('hex');
  acc.tokens.push(sha(token));
  acc.tokens = acc.tokens.slice(-MAX_TOKENS);
  return token;
}
function accountFor(req) {
  const m = /^Bearer ([0-9a-f]{48})$/.exec(req.headers.authorization || '');
  if (!m) return null;
  const h = sha(m[1]);
  for (const name in db.accounts) {
    const acc = db.accounts[name];
    if (acc.tokens.includes(h)) return { name, acc, h };
  }
  return null;
}

// Slow down password guessing: 20 sign up / log in tries per IP per 10 minutes.
const tries = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (tries.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  list.push(now);
  tries.set(ip, list);
  return list.length > 20;
}
setInterval(() => { const now = Date.now(); for (const [ip, l] of tries) if (l.every((t) => now - t > 600000)) tries.delete(ip); }, 60000).unref();

function send(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((ok, bad) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { bad(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { ok(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch (e) { bad(e); } });
    req.on('error', bad);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const route = req.method + ' ' + url.pathname;
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (route === 'GET /' || route === 'GET /health') return send(res, 200, { ok: true, game: 'precipice' });

  if (route === 'POST /api/signup' || route === 'POST /api/login') {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (limited(ip)) return send(res, 429, { error: 'TOO MANY TRIES. WAIT A BIT' });
    const b = await readBody(req);
    const user = String(b.user || '').toUpperCase();
    const pass = String(b.pass || '');
    if (!USER_RE.test(user)) return send(res, 400, { error: 'NAME MUST BE 3-12 LETTERS OR NUMBERS' });
    if (pass.length < 4 || pass.length > 32) return send(res, 400, { error: 'PASSWORD MUST BE 4-32 CHARACTERS' });
    let acc = db.accounts[user];
    if (route === 'POST /api/signup') {
      if (acc) return send(res, 409, { error: 'THAT NAME IS TAKEN' });
      const salt = crypto.randomBytes(16).toString('hex');
      acc = db.accounts[user] = { salt, hash: await hashPass(pass, salt), tokens: [], save: null, savedAt: 0, created: Date.now() };
    } else {
      // same work (and same answer) whether or not the name exists
      const hash = await hashPass(pass, acc ? acc.salt : 'nobody');
      if (!acc || !crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(acc.hash, 'hex'))) {
        return send(res, 401, { error: 'WRONG NAME OR PASSWORD' });
      }
    }
    const token = newToken(acc);
    acc.lastLogin = Date.now();
    persist();
    return send(res, 200, { user, token, savedAt: acc.savedAt });
  }

  // Title screen announcements from the dev: a one-time popup and a scrolling banner.
  if (route === 'GET /api/announce') { // public
    const a = db.announce || {};
    return send(res, 200, { popup: a.popup || null, banner: a.banner || '' });
  }
  // Browse published levels: ?list=recent|featured and/or ?q=search (public)
  if (route === 'GET /api/levels') {
    const q = String(url.searchParams.get('q') || '').toUpperCase().trim();
    const list = url.searchParams.get('list') || 'recent';
    let ls = (db.levels || []).slice();
    if (q) ls = ls.filter((l) => l.name.includes(q) || l.author.includes(q) || l.id === q);
    if (list === 'featured') ls = ls.filter((l) => l.featured);
    ls.sort((a, b) => b.at - a.at);
    return send(res, 200, { levels: ls.slice(0, 40).map(levelInfo) });
  }
  const lm = /^\/api\/levels\/([0-9A-F]{6})(\/star)?$/.exec(url.pathname);
  if (lm && req.method === 'GET' && !lm[2]) { // one level, to play it (public)
    const l = (db.levels || []).find((x) => x.id === lm[1]);
    if (!l) return send(res, 404, { error: 'THAT LEVEL IS GONE' });
    l.plays = (l.plays || 0) + 1;
    persist();
    return send(res, 200, Object.assign(levelInfo(l), { data: l.data }));
  }
  if (route === 'GET /api/devnotes') { // public: anyone can read the dev's notes
    const n = db.devnotes || { text: '', at: 0 };
    return send(res, 200, { text: n.text, savedAt: n.at, dev: DEV_USER });
  }

  const who = accountFor(req);
  if (!who) return send(res, 401, { error: 'PLEASE LOG IN AGAIN' });
  // The game pings once a minute while it's open: that's how "online" works.
  if (route === 'POST /api/ping') {
    who.acc.lastSeen = Date.now();
    const unread = (db.messages || []).filter((m) => m.to === who.name && !m.read).length;
    return send(res, 200, { ok: true, unread });
  }
  // ---- direct messages (dev <-> players)
  if (route === 'GET /api/inbox') {
    const convos = {};
    for (const m of db.messages || []) {
      if (m.from !== who.name && m.to !== who.name) continue;
      const other = m.from === who.name ? m.to : m.from;
      const c = convos[other] || (convos[other] = { with: other, last: null, unread: 0 });
      c.last = { from: m.from, text: m.text, at: m.at };
      if (m.to === who.name && !m.read) c.unread++;
    }
    const list = Object.values(convos).sort((x, y) => y.last.at - x.last.at);
    return send(res, 200, { convos: list, dev: DEV_USER });
  }
  if (route === 'GET /api/messages') {
    const other = String(url.searchParams.get('with') || '').toUpperCase();
    if (!canTalk(who.name, other)) return send(res, 403, { error: 'YOU CAN ONLY MESSAGE ' + DEV_USER });
    const msgs = (db.messages || []).filter((m) => (m.from === who.name && m.to === other) || (m.from === other && m.to === who.name));
    let changed = false;
    for (const m of msgs) if (m.to === who.name && !m.read) { m.read = true; changed = true; }
    if (changed) persist();
    const acc = db.accounts[other];
    return send(res, 200, { with: other, online: !!(acc && Date.now() - (acc.lastSeen || 0) < ONLINE_MS), messages: msgs.slice(-100).map(({ from, text, at }) => ({ from, text, at })) });
  }
  if (route === 'POST /api/messages') {
    const b = await readBody(req);
    const to = String(b.to || '').toUpperCase();
    const text = String(b.text || '').trim().slice(0, MAX_MSG);
    if (!text) return send(res, 400, { error: 'TYPE A MESSAGE FIRST' });
    if (!db.accounts[to]) return send(res, 404, { error: 'NO PLAYER CALLED ' + to });
    if (!canTalk(who.name, to)) return send(res, 403, { error: 'YOU CAN ONLY MESSAGE ' + DEV_USER });
    const now = Date.now();
    const recent = (sent.get(who.name) || []).filter((t) => now - t < 60000);
    if (recent.length >= 10) return send(res, 429, { error: 'SLOW DOWN! TRY AGAIN IN A MINUTE' });
    recent.push(now); sent.set(who.name, recent);
    db.messages = db.messages || [];
    db.messages.push({ from: who.name, to, text, at: now, read: false });
    if (db.messages.length > 5000) db.messages = db.messages.slice(-5000);
    who.acc.lastSeen = now;
    persist();
    return send(res, 200, { ok: true });
  }
  if (route === 'POST /api/logout') {
    who.acc.tokens = who.acc.tokens.filter((t) => t !== who.h);
    persist();
    return send(res, 200, { ok: true });
  }
  if (route === 'GET /api/save') return send(res, 200, { user: who.name, data: who.acc.save, savedAt: who.acc.savedAt });
  if (route === 'PUT /api/save') {
    const b = await readBody(req);
    if (!b.data || typeof b.data !== 'object' || Array.isArray(b.data)) return send(res, 400, { error: 'NOTHING TO SAVE' });
    const data = {};
    for (const k in b.data) if (/^precipice\.[a-z0-9.]{1,40}$/.test(k) && typeof b.data[k] === 'string') data[k] = b.data[k];
    who.acc.save = data;
    who.acc.savedAt = Date.now();
    persist();
    return send(res, 200, { ok: true, savedAt: who.acc.savedAt });
  }
  // Players list for the dev: names, dates and how far each save has got. Never passwords.
  if (route === 'GET /api/players') {
    if (who.name !== DEV_USER) return send(res, 403, { error: 'DEV ONLY' });
    const players = Object.keys(db.accounts).map((name) => {
      const a = db.accounts[name];
      let stage = -1, done = false, onlyUp = 0;
      for (const [k, v] of Object.entries(a.save || {})) {
        try {
          const d = JSON.parse(v);
          if (/^precipice\.(slot\d|hardcore)$/.test(k) && d && typeof d.stage === 'number') { stage = Math.max(stage, d.stage); done = done || !!d.done; }
          if (k === 'precipice.onlyup' && d) onlyUp = Math.max(onlyUp, d.best || 0);
        } catch (e) { /* not JSON */ }
      }
      const lastSeen = Math.max(a.lastSeen || 0, a.lastLogin || 0);
      return { name, created: a.created || 0, lastLogin: a.lastLogin || 0, lastSeen, online: Date.now() - lastSeen < ONLINE_MS, savedAt: a.savedAt || 0, stage, done, onlyUp };
    });
    players.sort((x, y) => (y.online - x.online) || (y.lastSeen - x.lastSeen)); // online first
    return send(res, 200, { players });
  }
  // publish a level (log in first); republishing a level with the same name updates it
  if (route === 'POST /api/levels') {
    const b = await readBody(req);
    const data = cleanLevel(b.level);
    if (!data) return send(res, 400, { error: 'THE LEVEL NEEDS A START AND A FLAG' });
    const now = Date.now();
    const recent = (sent.get('lv:' + who.name) || []).filter((t) => now - t < 60000);
    if (recent.length >= 5) return send(res, 429, { error: 'SLOW DOWN! TRY AGAIN IN A MINUTE' });
    recent.push(now); sent.set('lv:' + who.name, recent);
    db.levels = db.levels || [];
    let l = db.levels.find((x) => x.author === who.name && x.name === data.name);
    if (!l) {
      if (db.levels.filter((x) => x.author === who.name).length >= 20) return send(res, 400, { error: 'YOU HAVE 20 LEVELS ONLINE. DELETE ONE FIRST' });
      if (db.levels.length >= 5000) return send(res, 400, { error: 'THE LEVEL SERVER IS FULL' });
      l = { id: newLevelId(), author: who.name, plays: 0, featured: false };
      db.levels.push(l);
    }
    Object.assign(l, { name: data.name, data, at: now });
    persist();
    return send(res, 200, levelInfo(l));
  }
  if (lm && req.method === 'POST' && lm[2]) { // the dev stars (features) a level
    if (who.name !== DEV_USER) return send(res, 403, { error: 'ONLY THE DEV CAN FEATURE LEVELS' });
    const l = (db.levels || []).find((x) => x.id === lm[1]);
    if (!l) return send(res, 404, { error: 'THAT LEVEL IS GONE' });
    l.featured = !l.featured;
    persist();
    return send(res, 200, levelInfo(l));
  }
  if (lm && req.method === 'DELETE' && !lm[2]) { // its author (or the dev) takes a level down
    const i = (db.levels || []).findIndex((x) => x.id === lm[1]);
    if (i < 0) return send(res, 404, { error: 'THAT LEVEL IS GONE' });
    if (db.levels[i].author !== who.name && who.name !== DEV_USER) return send(res, 403, { error: 'NOT YOUR LEVEL' });
    db.levels.splice(i, 1);
    persist();
    return send(res, 200, { ok: true });
  }
  if (route === 'PUT /api/announce') {
    if (who.name !== DEV_USER) return send(res, 403, { error: 'ONLY THE DEV CAN ANNOUNCE' });
    const b = await readBody(req);
    const a = db.announce || (db.announce = {});
    if (typeof b.banner === 'string') a.banner = b.banner.slice(0, 200);
    if (typeof b.popup === 'string') {
      const text = b.popup.slice(0, 400);
      // a new id each time it changes, so every player sees the new popup once
      a.popup = text ? (a.popup && a.popup.text === text ? a.popup : { text, id: Date.now() }) : null;
    }
    persist();
    return send(res, 200, { popup: a.popup || null, banner: a.banner || '' });
  }
  if (route === 'PUT /api/devnotes') {
    if (who.name !== DEV_USER) return send(res, 403, { error: 'ONLY THE DEV CAN WRITE NOTES' });
    const b = await readBody(req);
    if (typeof b.text !== 'string') return send(res, 400, { error: 'NOTHING TO SAVE' });
    db.devnotes = { text: b.text.slice(0, MAX_NOTES), at: Date.now() };
    persist();
    return send(res, 200, { ok: true, savedAt: db.devnotes.at });
  }
  return send(res, 404, { error: 'NOT FOUND' });
}

http.createServer((req, res) => {
  handle(req, res).catch((e) => { if (!res.headersSent) send(res, 400, { error: 'BAD REQUEST' }); });
}).listen(PORT, () => console.log('Precipice accounts on port ' + PORT + ', data in ' + DATA_DIR));
