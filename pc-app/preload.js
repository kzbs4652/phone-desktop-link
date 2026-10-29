const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('phoneLink', {
  minimize: () => ipcRenderer.send('window-min'),
  toggleMaximize: () => ipcRenderer.send('window-max'),
  close: () => ipcRenderer.send('window-close'),
  openExternal: url => ipcRenderer.send('open-external', url),
  startUpdateInstall: () => ipcRenderer.invoke('start-update-install'),
  openPairingWindow: () => ipcRenderer.invoke('open-pairing-window'),
  onUpdateInstallState: callback => ipcRenderer.on('update-install-state', (_event, state) => callback(state))
});
