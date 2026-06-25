const { contextBridge, ipcRenderer } = require('electron');

console.log('[Preload] Script loaded, exposing electronAPI');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,

  resizeWindow: (width, height, skipTaskbar, center = true) =>
    ipcRenderer.send('resize-window', { width, height, skipTaskbar, center }),

  closeWindow: () => ipcRenderer.send('window-close'),

  toggleAlwaysOnTop: () => ipcRenderer.send('toggle-always-on-top'),

  setAlwaysOnTop: (top) => ipcRenderer.send('set-always-on-top', top),

  onAlwaysOnTopChanged: (callback) => {
    ipcRenderer.on('always-on-top-changed', (_event, top) => callback(top));
  },

  onServiceLog: (callback) => {
    ipcRenderer.on('service-log', (_event, entry) => callback(entry));
  },

  getLogs: () => ipcRenderer.invoke('get-logs'),
});
