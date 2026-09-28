// Electron entry point: opens a window and loads the game.
const { app, BrowserWindow, ipcMain, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { Readable } = require('stream');
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

async function checkForUpdate() {
  if (process.platform !== 'win32' || !EXE) return;
  fs.rmSync(EXE + '.update', { force: true }); // leftover from older versions of this updater
  const current = buildOf(app.getVersion()); // 1.0.N -> N
  const res = await net.fetch(RELEASES, { headers: { 'User-Agent': 'Precipice', Accept: 'application/vnd.github+json' } });
  if (!res.ok) return;
  const rel = await res.json();
  const latest = buildOf(rel.tag_name); // build-N -> N
  if (!(latest > current)) return;
  const asset = (rel.assets || []).find((a) => a.name === 'Precipice.exe');
  if (!asset) return;

  // Download to the temp folder (skipped if this build is already waiting there).
  const target = path.join(app.getPath('temp'), `Precipice-build-${latest}.exe`);
  const have = fs.existsSync(target) && (!asset.size || fs.statSync(target).size === asset.size);
  if (!have) {
    const part = target + '.part';
    const dl = await net.fetch(asset.browser_download_url, { headers: { 'User-Agent': 'Precipice' } });
    if (!dl.ok || !dl.body) return;
    await pipeline(Readable.fromWeb(dl.body), fs.createWriteStream(part));
    if (asset.size && fs.statSync(part).size !== asset.size) { fs.rmSync(part, { force: true }); return; }
    fs.renameSync(part, target);
  }
  pendingUpdate = target;
  updateBuild = latest;
  // The game shows its own 8-bit "UPDATE READY" box (see preload.js / game.js).
  if (win && !win.isDestroyed()) win.webContents.send('update-ready', latest);
}
let updateBuild = 0;
ipcMain.handle('update-status', () => (pendingUpdate ? updateBuild : 0)); // for a page that loaded after the download
ipcMain.on('update-restart', () => installUpdate(true));

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
  spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  pendingUpdate = null;
  if (relaunch) app.quit();
}

app.whenReady().then(() => {
  createWindow();
  checkForUpdate().catch(() => { /* offline, or GitHub unreachable: try again next launch */ });
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => installUpdate(false));
