const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

process.env.PHONELINK_DATA_DIR = app.getPath('userData');

// Start the local API before loading the renderer to avoid a startup race.
const server = require('./server.js');

let mainWindow;

const DOWNLOAD_HOSTS = new Set([
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com'
]);

function downloadGithubAsset(rawUrl, sender, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(rawUrl); } catch (_) { reject(new Error('İndirme adresi geçersiz.')); return; }
    if (url.protocol !== 'https:' || !DOWNLOAD_HOSTS.has(url.hostname) || redirectCount > 5) {
      reject(new Error('Güvenli GitHub indirme adresi kabul edilmedi.'));
      return;
    }

    const request = https.get(url, { headers: { 'User-Agent': 'KZBS-PhoneLink-Updater' } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        downloadGithubAsset(new URL(response.headers.location, url).toString(), sender, redirectCount + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`İndirme sunucusu HTTP ${response.statusCode} döndürdü.`));
        return;
      }

      const requestedName = path.basename(decodeURIComponent(url.pathname));
      const filename = requestedName.replace(/[^\w.() -]/g, '_') || 'PhoneLink-Update.exe';
      const destination = path.join(app.getPath('downloads'), filename);
      const temporary = `${destination}.download`;
      const output = fs.createWriteStream(temporary);
      const total = Number(response.headers['content-length']) || 0;
      let received = 0;
      response.on('data', chunk => {
        received += chunk.length;
        if (!sender.isDestroyed()) sender.send('download-update-progress', { received, total, percent: total ? Math.floor(received * 100 / total) : null });
      });
      response.pipe(output);
      output.on('finish', () => output.close(() => {
        try {
          if (fs.existsSync(destination)) fs.unlinkSync(destination);
          fs.renameSync(temporary, destination);
          resolve({ path: destination, filename });
        } catch (error) { reject(error); }
      }));
      output.on('error', error => {
        response.destroy();
        try { fs.unlinkSync(temporary); } catch (_) {}
        reject(error);
      });
    });
    request.setTimeout(120000, () => request.destroy(new Error('İndirme zaman aşımına uğradı.')));
    request.on('error', reject);
  });
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

  ipcMain.handle('download-update', (event, url) => downloadGithubAsset(url, event.sender));
  ipcMain.on('reveal-downloaded-file', (_event, filePath) => {
    if (typeof filePath === 'string' && path.dirname(filePath) === app.getPath('downloads') && fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
    }
  });

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
