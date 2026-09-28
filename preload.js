// Bridge between the desktop app and the game page: lets the game show its own
// "update ready" box and ask the app to restart into the new version.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('precipiceApp', {
  onUpdateReady(cb) {
    ipcRenderer.on('update-ready', (_e, build) => cb(build));
    ipcRenderer.invoke('update-status').then((build) => { if (build) cb(build); });
  },
  restartNow() { ipcRenderer.send('update-restart'); },
});
