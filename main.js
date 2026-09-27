// Electron entry point: opens a window and loads the game.
const { app, BrowserWindow } = require('electron');
const path = require('path');

// Let the title music start without waiting for a click.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    useContentSize: true,
    backgroundColor: '#000000',
    title: 'Precipice',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
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

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
