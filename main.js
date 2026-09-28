// Electron entry point: opens a window and loads the game.
const { app, BrowserWindow, ipcMain, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

// Let the title music start without waiting for a click.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    useContentSize: true,
    backgroundColor: '#000000',
    title: 'Precipice',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setMenuBarVisibility(false);
  win.maximize();
  // F11 toggles fullscreen.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

// ---------------------------------------------------------------- auto-update
// Precipice.exe is a single portable file, so it updates itself: each GitHub
// Actions build is released as "build-N" and this app's version is 1.0.N. On
// start we look at the latest release; if it's newer, the new Precipice.exe is
// downloaded to the temp folder (never next to the game, so nothing appears on
// the desktop), and swapped in when the game closes (or right away if the
// player picks "Restart now").
const RELEASES = 'https://api.github.com/repos/coldzeeyt/precipice/releases/latest';
const EXE = process.env.PORTABLE_EXECUTABLE_FILE; // set by the portable launcher; unset when run from source
let pendingUpdate = null; // path of a downloaded new exe, waiting to be swapped in

const buildOf = (s) => {
  const m = /(\d+)\s*$/.exec(String(s || ''));
  return m ? Number(m[1]) : 0;
};

// What the updater is doing, shown small on the title screen and written to
// update-log.txt (in %APPDATA%\Precipice) so problems can be tracked down.
let state = { state: 'idle', build: 0 };
function setState(next) {
  state = Object.assign({ build: buildOf(app.getVersion()) }, next);
  if (win && !win.isDestroyed()) win.webContents.send('update-state', state);
  if (next.state !== 'downloading') log(JSON.stringify(state));
}
function log(line) {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'update-log.txt'), new Date().toISOString() + ' ' + line + '\r\n'); } catch (e) { /* ignore */ }
}
ipcMain.handle('update-state', () => state); // for a page that loaded after a change
ipcMain.on('update-restart', () => installUpdate(true));
// "Check for updates" in Settings: look again now (unless a check or download is already running).
ipcMain.on('update-check', () => {
  if (state.state === 'checking' || state.state === 'downloading') return;
  if (state.state === 'ready') return setState(state); // already downloaded: the game shows the box again
  checkForUpdate().catch((e) => setState({ state: 'error', msg: String((e && e.message) || e).toUpperCase().slice(0, 40) }));
});

async function checkForUpdate() {
  if (process.platform !== 'win32' || !EXE) return setState({ state: 'dev' });
  fs.rmSync(EXE + '.update', { force: true }); // leftover from older versions of this updater
  const current = buildOf(app.getVersion()); // 1.0.N -> N
  setState({ state: 'checking' });
  const res = await net.fetch(RELEASES, { headers: { 'User-Agent': 'Precipice', Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error('GITHUB SAID ' + res.status);
  const rel = await res.json();
  const latest = buildOf(rel.tag_name); // build-N -> N
  if (!(latest > current)) return setState({ state: 'uptodate' });
  const asset = (rel.assets || []).find((a) => a.name === 'Precipice.exe');
  if (!asset) throw new Error('NO EXE IN BUILD ' + latest);

  // Download to the temp folder (skipped if this build is already waiting there).
  const target = path.join(app.getPath('temp'), `Precipice-build-${latest}.exe`);
  const have = fs.existsSync(target) && (!asset.size || fs.statSync(target).size === asset.size);
  if (!have) {
    const part = target + '.part';
    setState({ state: 'downloading', latest, pct: 0 });
    const dl = await net.fetch(asset.browser_download_url, { headers: { 'User-Agent': 'Precipice' } });
    if (!dl.ok || !dl.body) throw new Error('DOWNLOAD FAILED ' + dl.status);
    let got = 0, shown = -1;
    const count = new Transform({
      transform(chunk, _enc, done) {
        got += chunk.length;
        const pct = asset.size ? Math.floor((got * 100) / asset.size) : 0;
        if (pct !== shown) { shown = pct; setState({ state: 'downloading', latest, pct }); }
        done(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(dl.body), count, fs.createWriteStream(part));
    if (asset.size && fs.statSync(part).size !== asset.size) { fs.rmSync(part, { force: true }); throw new Error('DOWNLOAD WAS INCOMPLETE'); }
    fs.renameSync(part, target);
  }
  pendingUpdate = target;
  // The game shows its own 8-bit "UPDATE READY" box (see preload.js / game.js).
  setState({ state: 'ready', latest });
}

// Swap the new exe in once this one has exited, using a tiny throwaway script.
function installUpdate(relaunch) {
  if (!pendingUpdate || !EXE) return;
  const script = path.join(os.tmpdir(), 'precipice-update.cmd');
  fs.writeFileSync(script, [
    '@echo off',
    'set tries=0',
    ':retry',
    'ping -n 2 127.0.0.1 >nul', // wait ~1 s (timeout.exe doesn't work in a hidden window)
    `move /y "${pendingUpdate}" "${EXE}" >nul 2>&1 && goto done`,
    'set /a tries+=1',
    'if %tries% lss 60 goto retry',
    'goto end',
    ':done',
    relaunch ? `start "" "${EXE}"` : 'rem',
    ':end',
    '(goto) 2>nul & del "%~f0"',
    '',
  ].join('\r\n'));
  log('installing ' + pendingUpdate + ' -> ' + EXE + (relaunch ? ' (restart)' : ' (on close)'));
  spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  pendingUpdate = null;
  if (relaunch) app.quit();
}

app.whenReady().then(() => {
  createWindow();
  // offline, or GitHub unreachable: say so, and try again next launch
  checkForUpdate().catch((e) => setState({ state: 'error', msg: String((e && e.message) || e).toUpperCase().slice(0, 40) }));
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => installUpdate(false));
