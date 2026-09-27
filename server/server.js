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
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
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
    persist();
    return send(res, 200, { user, token, savedAt: acc.savedAt });
  }

  const who = accountFor(req);
  if (!who) return send(res, 401, { error: 'PLEASE LOG IN AGAIN' });
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
  return send(res, 404, { error: 'NOT FOUND' });
}

http.createServer((req, res) => {
  handle(req, res).catch((e) => { if (!res.headersSent) send(res, 400, { error: 'BAD REQUEST' }); });
}).listen(PORT, () => console.log('Precipice accounts on port ' + PORT + ', data in ' + DATA_DIR));
