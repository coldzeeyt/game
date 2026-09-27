// Online multiplayer rooms, peer to peer (WebRTC via PeerJS).
// The host's game *is* the room: a room code is just a short name for the
// host's connection. Guests connect to the host, and the host passes every
// player's position on to everyone else. PeerJS's free public server only
// introduces players to each other; no game data goes through it.
const ROOM_PREFIX = 'precipice-room-';
const ROOM_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const NET_COLORS = ['#d82800', '#0078f8', '#00a800', '#f8b800', '#9c5cfc', '#fc9838', '#fcfcfc', '#fc74b4'];

const Net = {
  peer: null,
  isHost: false,
  code: '',
  myId: '',
  name: '',
  conns: [], // host: connections to guests
  hostConn: null, // guest: connection to the host
  players: {}, // id -> { name, color, x, y, face, pose, dead, lvl, fin }
  order: [], // join order (host first)
  stage: 0, // campaign index, or -1 for the tutorial
  started: false,
  status: '',
  error: '',
  onChange: null,

  available() { return typeof Peer === 'function'; },
  // Which PeerJS server introduces players (the free public one unless overridden, e.g. for testing).
  peerOptions() { return window.PRECIPICE_PEER_SERVER || {}; },
  active() { return !!this.peer && (this.isHost || !!this.hostConn); },

  randomCode() {
    let c = '';
    for (let i = 0; i < 4; i++) c += ROOM_LETTERS[Math.floor(Math.random() * ROOM_LETTERS.length)];
    return c;
  },

  reset() {
    try { if (this.peer) this.peer.destroy(); } catch (e) { /* already gone */ }
    Object.assign(this, { peer: null, isHost: false, code: '', myId: '', conns: [], hostConn: null, players: {}, order: [], started: false, status: '', error: '' });
  },

  changed() { if (this.onChange) this.onChange(); },

  fail(msg) {
    this.error = msg;
    this.status = '';
    try { if (this.peer) this.peer.destroy(); } catch (e) { /* ignore */ }
    this.peer = null;
    this.changed();
  },

  // ---- host
  host(name) {
    if (!this.available()) return this.fail('MULTIPLAYER NEEDS AN INTERNET CONNECTION');
    this.reset();
    this.name = name;
    this.isHost = true;
    this.code = this.randomCode();
    this.status = 'CREATING ROOM...';
    const peer = new Peer(ROOM_PREFIX + this.code, this.peerOptions());
    this.peer = peer;
    peer.on('open', (id) => {
      this.myId = id;
      this.addPlayer(id, name);
      this.status = '';
      this.changed();
    });
    peer.on('connection', (conn) => {
      conn.on('data', (m) => this.hostReceive(conn, m));
      conn.on('close', () => this.dropGuest(conn));
      conn.on('error', () => this.dropGuest(conn));
      this.conns.push(conn);
    });
    peer.on('error', (e) => {
      if (e && e.type === 'unavailable-id') { this.reset(); this.host(name); } // code taken: pick another
      else if (!this.myId) this.fail('COULD NOT CREATE A ROOM');
    });
  },

  addPlayer(id, name) {
    if (this.players[id]) return;
    if (this.order.length >= NET_COLORS.length) return;
    this.players[id] = { name, color: NET_COLORS[this.order.length % NET_COLORS.length] };
    this.order.push(id);
  },

  lobbyMsg() {
    return { t: 'lobby', order: this.order, players: this.order.map((id) => ({ id, name: this.players[id].name, color: this.players[id].color })), stage: this.stage, started: this.started };
  },

  hostReceive(conn, m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      if (this.order.length >= NET_COLORS.length) { conn.send({ t: 'full' }); return; }
      conn.playerId = conn.peer;
      this.addPlayer(conn.peer, String(m.name || 'CLIMBER').slice(0, 10));
      this.broadcast(this.lobbyMsg());
      this.changed();
    } else if (m.t === 'st' || m.t === 'fin') {
      m.id = conn.peer;
      this.apply(m);
      this.broadcast(m, conn);
    }
  },

  dropGuest(conn) {
    this.conns = this.conns.filter((c) => c !== conn);
    if (conn.peer && this.players[conn.peer]) {
      delete this.players[conn.peer];
      this.order = this.order.filter((id) => id !== conn.peer);
      this.broadcast(this.lobbyMsg());
      this.changed();
    }
  },

  broadcast(m, except) {
    for (const c of this.conns) if (c !== except && c.open) { try { c.send(m); } catch (e) { /* dropped */ } }
  },

  setStage(i) {
    this.stage = i;
    if (this.isHost) this.broadcast(this.lobbyMsg());
    this.changed();
  },

  start() {
    if (!this.isHost) return;
    this.started = true;
    for (const id of this.order) delete this.players[id].fin;
    this.broadcast({ t: 'start', stage: this.stage });
    this.changed();
  },

  backToRoom() {
    this.started = false;
    if (this.isHost) this.broadcast(this.lobbyMsg());
  },

  // ---- guest
  join(code, name) {
    if (!this.available()) return this.fail('MULTIPLAYER NEEDS AN INTERNET CONNECTION');
    this.reset();
    this.name = name;
    this.code = code;
    this.status = 'JOINING ROOM ' + code + '...';
    const peer = new Peer(this.peerOptions());
    this.peer = peer;
    let opened = false;
    peer.on('open', (id) => {
      this.myId = id;
      const conn = peer.connect(ROOM_PREFIX + code, { reliable: true });
      conn.on('open', () => {
        opened = true;
        this.hostConn = conn;
        this.status = '';
        conn.send({ t: 'hello', name });
        this.changed();
      });
      conn.on('data', (m) => this.guestReceive(m));
      conn.on('close', () => this.fail('THE HOST LEFT THE ROOM'));
    });
    peer.on('error', (e) => {
      if (e && e.type === 'peer-unavailable') this.fail('ROOM ' + code + ' NOT FOUND');
      else if (!opened) this.fail('COULD NOT CONNECT');
    });
    setTimeout(() => { if (!opened && this.peer === peer && !this.error) this.fail('ROOM ' + code + ' NOT FOUND'); }, 12000);
  },

  guestReceive(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'lobby') {
      const old = this.players;
      this.players = {};
      for (const pl of m.players) this.players[pl.id] = Object.assign(old[pl.id] || {}, { name: pl.name, color: pl.color });
      this.order = m.order;
      this.stage = m.stage;
      this.started = m.started;
      this.changed();
    } else if (m.t === 'start') {
      this.stage = m.stage;
      this.started = true;
      for (const id of this.order) if (this.players[id]) delete this.players[id].fin;
      this.changed();
      if (this.onStart) this.onStart(m.stage);
    } else if (m.t === 'full') {
      this.fail('THAT ROOM IS FULL');
    } else if (m.t === 'st' || m.t === 'fin') {
      this.apply(m);
    }
  },

  // ---- in game
  apply(m) {
    const pl = this.players[m.id];
    if (!pl) return;
    if (m.t === 'st') Object.assign(pl, { x: m.x, y: m.y, face: m.f, pose: m.p, dead: m.d, lvl: m.l, seen: Date.now() });
    else if (m.t === 'fin') { pl.fin = { time: m.time, deaths: m.deaths }; this.changed(); }
  },

  send(m) {
    m.id = this.myId;
    this.apply(m); // keep our own entry up to date too
    if (this.isHost) this.broadcast(m);
    else if (this.hostConn && this.hostConn.open) { try { this.hostConn.send(m); } catch (e) { /* dropped */ } }
  },

  me() { return this.players[this.myId]; },
};
