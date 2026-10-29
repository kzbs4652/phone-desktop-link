const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

process.env.PHONELINK_DATA_DIR = app.getPath('userData');

// Start the local API before loading the renderer to avoid a startup race.
const server = require('./server.js');

let mainWindow;
let updateDownloadStarted = false;

function sendUpdateState(state, details = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-install-state', { state, ...details });
  }
}

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.on('download-progress', progress => {
  sendUpdateState('downloading', { percent: Math.floor(progress.percent), transferred: progress.transferred, total: progress.total });
});
autoUpdater.on('update-downloaded', info => {
  sendUpdateState('installing', { version: info.version });
  setTimeout(() => autoUpdater.quitAndInstall(true, true), 900);
});
autoUpdater.on('error', error => {
  updateDownloadStarted = false;
  sendUpdateState('error', { message: error?.message || 'Güncelleme indirilemedi.' });
});

async function downloadAndInstallUpdate() {
  if (!app.isPackaged) throw new Error('Uygulama içi güncelleme yalnızca kurulu Windows uygulamasında çalışır.');
  if (updateDownloadStarted) return { started: true };
  updateDownloadStarted = true;
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result?.isUpdateAvailable) {
      updateDownloadStarted = false;
      throw new Error('Yeni sürüm sunucuda henüz kurulum için hazır değil. Biraz sonra tekrar dene.');
    }
    sendUpdateState('downloading', { percent: 0 });
    await autoUpdater.downloadUpdate();
    return { started: true };
  } catch (error) {
    updateDownloadStarted = false;
    throw error;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1150,
    height: 870,
    minWidth: 920,
    minHeight: 680,
    frame: false, // Clean borderless modern desktop window
    title: "KZBS PhoneLink",
    backgroundColor: '#070b14',
    icon: path.join(__dirname, 'public/assets/logo.svg'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadURL('http://localhost:4955');

  ipcMain.on('window-min', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on('window-max', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.close();
  });

  ipcMain.on('open-external', (_event, url) => {
    if (typeof url === 'string' && /^https:\/\//i.test(url)) {
      shell.openExternal(url);
    }
  });

  ipcMain.handle('start-update-install', downloadAndInstallUpdate);

  ipcMain.handle('open-pairing-window', async () => {
    const response = await fetch('http://127.0.0.1:4955/api/open-pairing', { method: 'POST' });
    if (!response.ok) throw new Error('Eşleştirme penceresi açılamadı.');
    return response.json();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  if (server.listening) createWindow();
  else server.once('listening', createWindow);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
