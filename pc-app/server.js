const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const dgram = require('dgram');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT || 4955);
const UDP_PORT = 4956;
const CURRENT_VERSION = require('./package.json').version;
const UPDATE_MANIFEST_URL = process.env.PHONELINK_UPDATE_MANIFEST_URL ||
  'https://raw.githubusercontent.com/kzbs4652/phone-desktop-link/main/version.json';
const pairingDataDir = process.env.PHONELINK_DATA_DIR || path.join(os.homedir(), '.kzbs-phonelink');
fs.mkdirSync(pairingDataDir, { recursive: true });
const pairingStatePath = path.join(pairingDataDir, 'pairing.json');
const messagesStatePath = path.join(pairingDataDir, 'messages.json');
function loadPairingState() {
  try {
    const value = JSON.parse(fs.readFileSync(pairingStatePath, 'utf8'));
    if (value && typeof value.deviceId === 'string') return { deviceId: value.deviceId, phoneToken: typeof value.phoneToken === 'string' ? value.phoneToken : null, deviceName: typeof value.deviceName === 'string' ? value.deviceName : null };
  } catch (_) {}
  return { deviceId: crypto.randomUUID(), phoneToken: null, deviceName: null };
}
let pairingState = loadPairingState();
function savePairingState() {
  const temporaryPath = `${pairingStatePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(pairingState), { mode: 0o600 });
  fs.renameSync(temporaryPath, pairingStatePath);
}
savePairingState();
let pairingCode = pairingState.phoneToken ? null : crypto.randomInt(100000, 1000000).toString();
let pairingExpiresAt = pairingCode ? Date.now() + 15 * 60 * 1000 : 0;
const pairingAttempts = new Map();

const pcClients = new Set();
let connectedPhone = null;
let deviceState = { connected: false, deviceName: null, batteryLevel: null, isCharging: false, ipAddress: null };
let contacts = [];
let contactsSyncStatus = { state: 'idle', message: 'Telefon bağlanınca kişi listesi eşitlenir.', count: 0 };
function loadMessagesState() {
  try {
    const value = JSON.parse(fs.readFileSync(messagesStatePath, 'utf8'));
    if (Array.isArray(value)) return { messages: value, lastSyncedAt: null };
    if (value && Array.isArray(value.messages)) {
      return {
        messages: value.messages,
        lastSyncedAt: typeof value.lastSyncedAt === 'string' ? value.lastSyncedAt : null
      };
    }
  } catch (_) {}
  return { messages: [], lastSyncedAt: null };
}
const savedMessagesState = loadMessagesState();
let messages = savedMessagesState.messages;
let messageSyncStatus = {
  state: messages.length ? 'cached' : 'idle',
  message: messages.length ? 'Bu bilgisayarda kayıtlı mesajlar gösteriliyor.' : 'Telefon bağlandığında mesajlar eşitlenir.',
  count: messages.length,
  lastSyncedAt: savedMessagesState.lastSyncedAt
};

function saveMessagesState() {
  const temporaryPath = `${messagesStatePath}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify({
      version: 1,
      messages,
      lastSyncedAt: messageSyncStatus.lastSyncedAt
    }), { mode: 0o600 });
    fs.renameSync(temporaryPath, messagesStatePath);
    return true;
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch (_) {}
    console.error('[PhoneLink] Mesajlar bilgisayara kaydedilemedi:', error.message);
    return false;
  }
}

function isLoopbackAddress(address) {
  const normalized = String(address || '').replace(/^::ffff:/i, '').split('%')[0];
  return normalized === '127.0.0.1' || normalized === '::1';
}

function requireLocalRequest(req, res, next) {
  if (!isLoopbackAddress(req.socket.remoteAddress)) {
    res.status(403).json({ error: 'Bu bilgi yalnızca bu bilgisayardan görüntülenebilir.' });
    return;
  }
  next();
}

function getLocalAddresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (!entry.internal && (entry.family === 'IPv4' || entry.family === 4)) addresses.push(entry.address);
    }
  }
  const unique = [...new Set(addresses)];
  const priority = address => address.startsWith('192.168.') ? 0
    : address.startsWith('10.') ? 1
      : /^172\.(1[6-9]|2\d|3[01])\./.test(address) ? 2 : 3;
  return unique.sort((a, b) => priority(a) - priority(b));
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const wss = new WebSocket.Server({
  server,
  verifyClient: (info, done) => {
    let requestUrl;
    try {
      requestUrl = new URL(info.req.url || '/', 'http://localhost');
    } catch (_) {
      done(false, 400, 'Invalid request');
      return;
    }

    if (requestUrl.pathname === '/client') {
      if (isLoopbackAddress(info.req.socket.remoteAddress)) done(true);
      else done(false, 403, 'Local desktop connection only');
      return;
    }

    if (requestUrl.pathname === '/phone') {
      const host = String(info.req.socket.remoteAddress || '').replace(/^::ffff:/i, '');
      const now = Date.now();
      const recentAttempts = (pairingAttempts.get(host) || []).filter(time => now - time < 60_000);
      if (recentAttempts.length >= 10) {
        pairingAttempts.set(host, recentAttempts);
        done(false, 429, 'Too many pairing attempts');
      } else if (pairingState.phoneToken && safeStringEqual(requestUrl.searchParams.get('token'), pairingState.phoneToken)) {
        info.req.phoneLinkTokenAuth = true;
        done(true);
      } else if (pairingCode && Date.now() < pairingExpiresAt && requestUrl.searchParams.get('code') === pairingCode) {
        pairingState.phoneToken = crypto.randomBytes(32).toString('base64url');
        savePairingState();
        info.req.phoneLinkPairingToken = pairingState.phoneToken;
        pairingAttempts.delete(host);
        done(true);
      } else {
        recentAttempts.push(now);
        pairingAttempts.set(host, recentAttempts);
        done(false, 403, 'Invalid pairing code');
      }
      return;
    }

    done(false, 404, 'Unknown endpoint');
  }
});

function safeStringEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function broadcastToPc(action, payload) {
  const message = JSON.stringify({ action, payload, timestamp: Date.now() });
  for (const client of pcClients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

function sendToPhone(action, payload = {}) {
  if (!connectedPhone || connectedPhone.readyState !== WebSocket.OPEN) return false;
  connectedPhone.send(JSON.stringify({ action, payload }));
  return true;
}

wss.on('connection', (ws, req) => {
  const requestUrl = new URL(req.url || '/', 'http://localhost');

  if (requestUrl.pathname === '/phone') {
    if (connectedPhone && connectedPhone.readyState === WebSocket.OPEN) {
      connectedPhone.close(4001, 'Başka bir telefon bağlandı');
    }
    connectedPhone = ws;
    deviceState = {
      ...deviceState,
      connected: true,
      ipAddress: String(req.socket.remoteAddress || '').replace(/^::ffff:/i, '')
    };
    messageSyncStatus = {
      ...messageSyncStatus,
      state: 'syncing',
      message: 'Telefon bağlandı; mesajlar eşitleniyor.',
      count: messages.length
    };
    contactsSyncStatus = {
      ...contactsSyncStatus,
      state: 'syncing',
      message: 'Telefon rehberi eşitleniyor.'
    };
    console.log(`[PhoneLink] Telefon bağlantısı açıldı (${deviceState.ipAddress}).`);
    if (req.phoneLinkPairingToken) {
      ws.send(JSON.stringify({ action: 'PAIRING_COMPLETE', payload: { token: req.phoneLinkPairingToken, deviceId: pairingState.deviceId } }));
      pairingCode = null;
      pairingExpiresAt = 0;
    }
    broadcastToPc('PHONE_CONNECTION_CHANGED', deviceState);
    broadcastToPc('MESSAGES_SYNC_STATUS', messageSyncStatus);
    broadcastToPc('CONTACTS_SYNC_STATUS', contactsSyncStatus);

    ws.on('message', data => {
      try {
        handlePhoneMessage(JSON.parse(data.toString()));
      } catch (error) {
        console.error('[PhoneLink] Telefondan gelen veri okunamadı:', error.message);
      }
    });
    ws.on('close', () => {
      if (connectedPhone !== ws) return;
      connectedPhone = null;
      deviceState = { ...deviceState, connected: false, batteryLevel: null, isCharging: false };
      if (messageSyncStatus.state === 'syncing') {
        messageSyncStatus = {
          ...messageSyncStatus,
          state: messages.length ? 'interrupted' : 'idle',
          message: messages.length
            ? 'Eşitleme kesildi; bilgisayardaki kayıtlı mesajlar korundu.'
            : 'Telefon bağlantısı kesildi. Mesaj eşitlemesi tamamlanmadı.',
          count: messages.length
        };
        broadcastToPc('MESSAGES_SYNC_STATUS', messageSyncStatus);
      }
      console.log('[PhoneLink] Telefon bağlantısı kapandı.');
      broadcastToPc('PHONE_CONNECTION_CHANGED', deviceState);
    });
    return;
  }

  pcClients.add(ws);
  ws.send(JSON.stringify({
    action: 'INIT_STATE',
    payload: { deviceState, messages, messageSyncStatus, contacts, contactsSyncStatus }
  }));
  ws.on('message', data => {
    try {
      handlePcMessage(JSON.parse(data.toString()));
    } catch (error) {
      console.error('[PhoneLink] Bilgisayar isteği okunamadı:', error.message);
    }
  });
  ws.on('close', () => pcClients.delete(ws));
});

function handlePhoneMessage(message) {
  const { action, payload = {} } = message;
  switch (action) {
    case 'DEVICE_HELLO':
      deviceState = { ...deviceState, ...payload, connected: true };
      if (payload.deviceName) {
        pairingState.deviceName = String(payload.deviceName).slice(0, 120);
        savePairingState();
      }
      broadcastToPc('DEVICE_STATUS_UPDATED', deviceState);
      break;
    case 'CONTACTS_SYNCED': {
      if (!Array.isArray(payload)) break;
      const uniqueByNumber = new Map();
      payload.slice(0, 20000).forEach(contact => {
        const name = String(contact?.name || '').trim().slice(0, 160);
        const phone = String(contact?.phone || '').trim().slice(0, 64);
        if (!name || !phone) return;
        const key = phone.replace(/\D/g, '');
        if (!key || uniqueByNumber.has(key)) return;
        uniqueByNumber.set(key, {
          id: String(contact?.id || key).slice(0, 80),
          name,
          phone
        });
      });
      const collator = new Intl.Collator('tr', { sensitivity: 'base', numeric: true });
      contacts = [...uniqueByNumber.values()].sort((left, right) => collator.compare(left.name, right.name) || left.phone.localeCompare(right.phone));
      contactsSyncStatus = {
        state: 'synced',
        message: contacts.length ? `${contacts.length} kişi hazır.` : 'Telefon rehberinde numaralı kişi bulunamadı.',
        count: contacts.length
      };
      broadcastToPc('CONTACTS_UPDATED', contacts);
      broadcastToPc('CONTACTS_SYNC_STATUS', contactsSyncStatus);
      break;
    }
    case 'CONTACTS_SYNC_STATUS': {
      const state = ['syncing', 'error'].includes(payload.state) ? payload.state : null;
      if (!state) break;
      contactsSyncStatus = {
        state,
        message: String(payload.message || (state === 'syncing' ? 'Telefon rehberi eşitleniyor.' : 'Rehber iznini kontrol edip yeniden eşitle.')).slice(0, 240),
        count: contacts.length
      };
      broadcastToPc('CONTACTS_SYNC_STATUS', contactsSyncStatus);
      break;
    }
    case 'SMS_RECEIVED': {
      const text = String(payload.text || '');
      const code = text.match(/\b\d{4,8}\b/);
      const sms = {
        id: `received_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        sender: payload.sender || payload.phone || 'Bilinmeyen',
        phone: payload.phone || payload.sender || '',
        timestamp: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
        text,
        code: code ? code[0] : null,
        unread: true,
        isOutgoing: false
      };
      messages.unshift(sms);
      messageSyncStatus = { ...messageSyncStatus, count: messages.length };
      if (!saveMessagesState()) {
        messageSyncStatus = { ...messageSyncStatus, state: 'storage_error', message: 'Yeni SMS alındı ancak bu bilgisayara kaydedilemedi.' };
      }
      broadcastToPc('NEW_SMS', sms);
      broadcastToPc('MESSAGES_SYNC_STATUS', messageSyncStatus);
      break;
    }
    case 'SMS_SYNC_STATUS': {
      const state = ['syncing', 'error'].includes(payload.state) ? payload.state : null;
      if (!state) break;
      messageSyncStatus = {
        ...messageSyncStatus,
        state,
        message: String(payload.message || (state === 'syncing' ? 'SMS’ler telefondan okunuyor…' : 'SMS eşitlemesi başarısız oldu.')).slice(0, 240),
        errorCode: state === 'error' ? String(payload.errorCode || 'sync_failed').slice(0, 80) : null,
        count: messages.length
      };
      broadcastToPc('MESSAGES_SYNC_STATUS', messageSyncStatus);
      break;
    }
    case 'SMS_SYNCED':
      if (Array.isArray(payload)) {
        messages = payload;
        messageSyncStatus = {
          state: 'synced',
          message: messages.length ? `${messages.length} mesaj eşitlendi.` : 'Telefonda SMS bulunamadı.',
          count: messages.length,
          lastSyncedAt: new Date().toISOString()
        };
        if (!saveMessagesState()) {
          messageSyncStatus = {
            ...messageSyncStatus,
            state: 'storage_error',
            message: 'Mesajlar alındı ancak bu bilgisayara kaydedilemedi.'
          };
        }
        broadcastToPc('MESSAGES_UPDATED', messages);
        broadcastToPc('MESSAGES_SYNC_STATUS', messageSyncStatus);
      }
      break;
    case 'SMS_SEND_RESULT': {
      if (!payload.success) {
        broadcastToPc('APP_ERROR', { message: 'SMS gönderilemedi. Telefonda SMS iznini, şebekeyi ve bakiyeyi kontrol et.' });
        break;
      }
      const sms = {
        id: `sent_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        sender: 'Ben (PC)',
        phone: payload.phone || '',
        timestamp: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
        text: payload.text || '',
        code: null,
        unread: false,
        isOutgoing: true
      };
      messages.unshift(sms);
      messageSyncStatus = { ...messageSyncStatus, count: messages.length };
      if (!saveMessagesState()) {
        messageSyncStatus = { ...messageSyncStatus, state: 'storage_error', message: 'SMS gönderildi ancak bu bilgisayara kaydedilemedi.' };
      }
      broadcastToPc('NEW_SMS', sms);
      broadcastToPc('MESSAGES_SYNC_STATUS', messageSyncStatus);
      break;
    }
    default:
      console.log(`[PhoneLink] Bilinmeyen telefon olayı: ${action}`);
  }
}

function handlePcMessage(message) {
  const { action, payload = {} } = message;
  switch (action) {
    case 'SEND_SMS':
      sendSmsFromPc(payload.phone, payload.text);
      break;
    case 'REQ_SYNC_ALL':
      if (!sendToPhone('REQ_SYNC_ALL', {})) {
        broadcastToPc('APP_ERROR', { message: 'Mesajları eşitlemek için önce telefonunu PhoneLink’e bağla.' });
      }
      break;
    default:
      console.log(`[PhoneLink] Desteklenmeyen bilgisayar isteği: ${action}`);
  }
}

function sendSmsFromPc(phone, text) {
  if (!connectedPhone || connectedPhone.readyState !== WebSocket.OPEN) {
    broadcastToPc('APP_ERROR', { message: 'SMS göndermek için önce telefonunu PhoneLink’e bağla.' });
    return;
  }
  if (!phone || !text) {
    broadcastToPc('APP_ERROR', { message: 'Telefon numarası ve SMS metni gerekli.' });
    return;
  }
  if (!sendToPhone('SEND_SMS', { phone, text })) {
    broadcastToPc('APP_ERROR', { message: 'SMS telefona iletilemedi.' });
  }
}

app.get('/api/state', requireLocalRequest, (req, res) => {
  res.json({ deviceState, messages, messageSyncStatus, contacts, contactsSyncStatus });
});

app.get('/api/connection-info', requireLocalRequest, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    computerName: os.hostname(),
    addresses: getLocalAddresses(),
    port: PORT,
    pairingCode: pairingCode && Date.now() < pairingExpiresAt ? pairingCode : null,
    pairingOpen: Boolean(pairingCode && Date.now() < pairingExpiresAt),
    paired: Boolean(pairingState.phoneToken),
    deviceId: pairingState.deviceId,
    connected: deviceState.connected,
    deviceName: deviceState.deviceName
  });
});

app.get('/api/pairing-qr', requireLocalRequest, async (req, res) => {
  if (!pairingCode || Date.now() >= pairingExpiresAt) {
    res.status(409).json({ error: 'Eşleştirme kodu şu anda açık değil.' });
    return;
  }
  const host = getLocalAddresses()[0];
  if (!host) {
    res.status(503).json({ error: 'Bilgisayarın yerel ağ adresi bulunamadı.' });
    return;
  }
  const pairingUrl = new URL('phonelink://pair');
  pairingUrl.searchParams.set('host', host);
  pairingUrl.searchParams.set('port', String(PORT));
  pairingUrl.searchParams.set('code', pairingCode);
  pairingUrl.searchParams.set('deviceId', pairingState.deviceId);
  try {
    res.set('Cache-Control', 'no-store').json({ dataUrl: await QRCode.toDataURL(pairingUrl.toString(), { width: 176, margin: 1 }) });
  } catch (_) {
    res.status(500).json({ error: 'Eşleştirme QR kodu oluşturulamadı.' });
  }
});

app.post('/api/open-pairing', requireLocalRequest, (req, res) => {
  pairingCode = crypto.randomInt(100000, 1000000).toString();
  pairingExpiresAt = Date.now() + 5 * 60 * 1000;
  res.set('Cache-Control', 'no-store').json({ pairingCode, expiresInSeconds: 300 });
});

function compareVersions(left, right) {
  const a = String(left || '0').split('.').map(part => Number.parseInt(part, 10) || 0);
  const b = String(right || '0').split('.').map(part => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const difference = (a[i] || 0) - (b[i] || 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function loadUpdateManifest() {
  return new Promise((resolve, reject) => {
    const manifestUrl = new URL(UPDATE_MANIFEST_URL);
    manifestUrl.searchParams.set('_', String(Date.now()));
    const request = https.get(manifestUrl, {
      timeout: 8000,
      headers: { 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache' }
    }, response => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`Update server returned HTTP ${response.statusCode}`));
        return;
      }
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (error) { reject(error); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Update check timed out')));
    request.on('error', reject);
  });
}

app.get('/api/check-update', requireLocalRequest, async (req, res) => {
  try {
    const manifest = await loadUpdateManifest();
    const latestVersion = manifest.pc?.version || manifest.version || CURRENT_VERSION;
    res.set('Cache-Control', 'no-store');
    res.json({
      hasUpdate: compareVersions(latestVersion, CURRENT_VERSION) > 0,
      currentVersion: CURRENT_VERSION,
      latestVersion,
      title: manifest.title || 'KZBS PhoneLink',
      notes: manifest.notes || '',
      pcDownloadUrl: manifest.pc?.url || null,
      apkDownloadUrl: manifest.android?.url || null
    });
  } catch (_) {
    res.status(502).json({ error: 'Güncelleme bilgisi alınamadı.' });
  }
});

const udpSocket = dgram.createSocket('udp4');
udpSocket.on('error', error => console.error('[PhoneLink] Yerel ağ keşfi başlatılamadı:', error.message));
udpSocket.on('message', (message, remote) => {
  if (message.toString().trim() !== 'KZBS_DISCOVERY_PING') return;
  const response = JSON.stringify({
    app: 'KZBS PhoneLink',
    computerName: os.hostname(),
    deviceId: pairingState.deviceId,
    version: CURRENT_VERSION,
    wsPort: PORT
  });
  udpSocket.send(response, remote.port, remote.address);
});
udpSocket.bind(UDP_PORT, '0.0.0.0', () => {
  udpSocket.setBroadcast(true);
  console.log(`[PhoneLink] Telefon keşfi ${UDP_PORT} portunda hazır.`);
});

server.on('error', error => console.error('[PhoneLink] Yerel bağlantı sunucusu hatası:', error.message));
server.listen(PORT, () => {
  console.log(`KZBS PhoneLink v${CURRENT_VERSION} hazır: http://localhost:${PORT}`);
});

module.exports = server;
