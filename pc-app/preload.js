const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('phoneLink', {
  minimize: () => ipcRenderer.send('window-min'),
  toggleMaximize: () => ipcRenderer.send('window-max'),
  close: () => ipcRenderer.send('window-close'),
  openExternal: url => ipcRenderer.send('open-external', url),
  downloadUpdate: url => ipcRenderer.invoke('download-update', url),
  revealDownloadedFile: filePath => ipcRenderer.send('reveal-downloaded-file', filePath),
  openPairingWindow: () => ipcRenderer.invoke('open-pairing-window'),
  onDownloadProgress: callback => ipcRenderer.on('download-update-progress', (_event, progress) => callback(progress))
});
