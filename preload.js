// Bridge between the desktop app and the game page: lets the game show the
// updater's progress, its own "update ready" box, and restart into the new version.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('precipiceApp', {
  onUpdateState(cb) {
    ipcRenderer.on('update-state', (_e, st) => cb(st));
    ipcRenderer.invoke('update-state').then(cb);
  },
  restartNow() { ipcRenderer.send('update-restart'); },
});
