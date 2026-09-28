// Accounts: sign up / log in with a name and password, then SAVE copies this
// device's saves to the cloud and LOAD pulls them onto any other device.
// The server is in server/ (see README). window.PRECIPICE_ACCOUNT_SERVER
// overrides the address (used for testing).
const ACCOUNT_SERVER = 'https://precipice-accounts-production.up.railway.app';

const Account = {
  key: 'precipice.account', // this device's login; never uploaded
  user: '',
  token: '',
  busy: false,

  server() { return window.PRECIPICE_ACCOUNT_SERVER || ACCOUNT_SERVER; },
  loggedIn() { return !!this.token; },

  load() {
    try {
      const d = JSON.parse(localStorage.getItem(this.key)) || {};
      this.user = typeof d.user === 'string' ? d.user : '';
      this.token = typeof d.token === 'string' ? d.token : '';
    } catch (e) { /* logged out */ }
  },
  remember() {
    try {
      if (this.token) localStorage.setItem(this.key, JSON.stringify({ user: this.user, token: this.token }));
      else localStorage.removeItem(this.key);
    } catch (e) { /* storage unavailable */ }
  },

  // Every saved thing on this device: save slots, hardcore run, settings, name.
  localData() {
    const data = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('precipice.') && k !== this.key) data[k] = localStorage.getItem(k);
      }
    } catch (e) { /* storage unavailable */ }
    return data;
  },

  async call(method, path, body) {
    this.busy = true;
    try {
      const res = await fetch(this.server() + path, {
        method,
        headers: Object.assign({ 'Content-Type': 'application/json' }, this.token ? { Authorization: 'Bearer ' + this.token } : {}),
        body: body ? JSON.stringify(body) : undefined,
      });
      let out = {};
      try { out = await res.json(); } catch (e) { /* not json */ }
      if (res.status === 401 && this.token && path !== '/api/login') { this.token = ''; this.remember(); }
      if (!res.ok) throw new Error(out.error || 'SERVER ERROR ' + res.status);
      return out;
    } catch (e) {
      throw new Error(e instanceof TypeError ? 'CANNOT REACH THE SERVER' : e.message);
    } finally {
      this.busy = false;
    }
  },

  async signup(user, pass) { return this.enter('/api/signup', user, pass); },
  async login(user, pass) { return this.enter('/api/login', user, pass); },
  async enter(path, user, pass) {
    this.token = '';
    const out = await this.call('POST', path, { user, pass });
    this.user = out.user;
    this.token = out.token;
    this.remember();
    return out;
  },
  async logout() {
    try { if (this.token) await this.call('POST', '/api/logout'); } catch (e) { /* log out here anyway */ }
    this.token = '';
    this.remember();
  },
  async save() { return this.call('PUT', '/api/save', { data: this.localData() }); },
  // Dev notes: everyone can read them; only the developer's account can write (the server checks too).
  isDev() { return this.loggedIn() && this.user === 'COLDZEEYT'; },
  async loadNotes() { return this.call('GET', '/api/devnotes'); },
  async players() { return (await this.call('GET', '/api/players')).players || []; },
  async saveNotes(text) { return this.call('PUT', '/api/devnotes', { text }); },
  // Replaces this device's saves with the cloud copy. Returns false if the cloud is empty.
  async pull() {
    const out = await this.call('GET', '/api/save');
    if (!out.data) return false;
    try {
      for (const k of Object.keys(this.localData())) localStorage.removeItem(k);
      for (const k in out.data) localStorage.setItem(k, out.data[k]);
    } catch (e) { throw new Error('COULD NOT WRITE SAVES ON THIS DEVICE'); }
    return out;
  },
};
Account.load();
