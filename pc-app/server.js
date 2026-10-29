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
let activeCall = null;
let callTimer = null;
let contacts = [];
let callLogs = [];
let messages = [];

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
    console.log(`[PhoneLink] Telefon bağlantısı açıldı (${deviceState.ipAddress}).`);
    if (req.phoneLinkPairingToken) {
      ws.send(JSON.stringify({ action: 'PAIRING_COMPLETE', payload: { token: req.phoneLinkPairingToken, deviceId: pairingState.deviceId } }));
      pairingCode = null;
      pairingExpiresAt = 0;
    }
    broadcastToPc('PHONE_CONNECTION_CHANGED', deviceState);

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
      if (callTimer) clearInterval(callTimer);
      callTimer = null;
      activeCall = null;
      console.log('[PhoneLink] Telefon bağlantısı kapandı.');
      broadcastToPc('PHONE_CONNECTION_CHANGED', deviceState);
      broadcastToPc('ACTIVE_CALL_CHANGED', null);
    });
    return;
  }

  pcClients.add(ws);
  ws.send(JSON.stringify({
    action: 'INIT_STATE',
    payload: { deviceState, activeCall, contacts, callLogs, messages }
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
      broadcastToPc('NEW_SMS', sms);
      break;
    }
    case 'SMS_SYNCED':
      if (Array.isArray(payload)) {
        messages = payload;
        broadcastToPc('MESSAGES_UPDATED', messages);
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
      broadcastToPc('NEW_SMS', sms);
      break;
    }
    case 'PHONE_ACTION_RESULT':
      if (!payload.success) {
        if (payload.command === 'DIAL_CALL') {
          activeCall = null;
          broadcastToPc('ACTIVE_CALL_CHANGED', null);
        }
        broadcastToPc('APP_ERROR', { message: payload.error || 'Telefon işlemi tamamlanamadı.' });
      }
      break;
    case 'CALL_STATE_CHANGED':
      updateCallState(payload);
      break;
    case 'CONTACTS_SYNCED':
      if (Array.isArray(payload)) {
        contacts = payload;
        broadcastToPc('CONTACTS_UPDATED', contacts);
      }
      break;
    case 'CALL_LOGS_SYNCED':
      if (Array.isArray(payload)) {
        callLogs = payload;
        broadcastToPc('CALL_LOGS_UPDATED', callLogs);
      }
      break;
    default:
      console.log(`[PhoneLink] Bilinmeyen telefon olayı: ${action}`);
  }
}

function handlePcMessage(message) {
  const { action, payload = {} } = message;
  switch (action) {
    case 'DIAL_CALL':
      initiateCall(payload.number, payload.contactName);
      break;
    case 'END_CALL':
      if (!sendToPhone('END_CALL', {})) broadcastToPc('APP_ERROR', { message: 'Önce telefonunu PhoneLink’e bağla.' });
      break;
    case 'ADD_CALL':
      if (!connectedPhone || connectedPhone.readyState !== WebSocket.OPEN) {
        broadcastToPc('APP_ERROR', { message: 'Arama eklemek için önce telefonunu PhoneLink’e bağla.' });
      } else if (!payload.number) {
        broadcastToPc('APP_ERROR', { message: 'Eklenecek telefon numarasını gir.' });
      } else {
        sendToPhone('ADD_CALL', { number: String(payload.number), contactName: payload.contactName || '' });
      }
      break;
    case 'DTMF_TONE':
    case 'CALL_MUTE':
    case 'CALL_ROUTE':
    case 'CALL_HOLD':
    case 'CALL_UNHOLD':
      if (!sendToPhone(action, payload)) broadcastToPc('APP_ERROR', { message: 'Arama denetimi için önce telefonunu PhoneLink’e bağla.' });
      break;
    case 'SEND_SMS':
      sendSmsFromPc(payload.phone, payload.text);
      break;
    case 'REQ_SYNC_ALL':
      sendToPhone('REQ_SYNC_ALL', {});
      break;
    default:
      console.log(`[PhoneLink] Desteklenmeyen bilgisayar isteği: ${action}`);
  }
}

function initiateCall(number, contactName) {
  if (!connectedPhone || connectedPhone.readyState !== WebSocket.OPEN) {
    broadcastToPc('APP_ERROR', { message: 'Arama yapmak için önce telefonunu PhoneLink’e bağla.' });
    return;
  }
  if (!number) {
    broadcastToPc('APP_ERROR', { message: 'Aranacak telefon numarası boş.' });
    return;
  }
  activeCall = {
    number,
    contactName: contactName || contacts.find(contact => contact.phone === number)?.name || number,
    status: 'DIALING',
    startTime: Date.now(),
    duration: 0
  };
  sendToPhone('DIAL_CALL', { number, contactName: contactName || '' });
  broadcastToPc('ACTIVE_CALL_CHANGED', activeCall);
}

function startCallDurationTimer() {
  if (callTimer) clearInterval(callTimer);
  callTimer = setInterval(() => {
    if (!activeCall) {
      clearInterval(callTimer);
      callTimer = null;
      return;
    }
    activeCall.duration = Math.floor((Date.now() - (activeCall.connectedTime || activeCall.startTime)) / 1000);
    broadcastToPc('CALL_DURATION_TICK', { duration: activeCall.duration });
  }, 1000);
}

function updateCallState(payload) {
  if (payload.status === 'ENDED' || payload.status === 'IDLE') {
    if (callTimer) clearInterval(callTimer);
    callTimer = null;
    activeCall = null;
    broadcastToPc('ACTIVE_CALL_CHANGED', null);
    setTimeout(() => sendToPhone('REQ_SYNC_ALL', {}), 700);
    return;
  }
  activeCall = {
    ...(activeCall || {}),
    ...payload,
    number: payload.number || activeCall?.number || 'Bilinmeyen numara',
    contactName: activeCall?.contactName || contacts.find(contact => contact.phone === payload.number)?.name || payload.number
  };
  if (payload.status === 'ACTIVE') {
    activeCall.connectedTime = Date.now();
    startCallDurationTimer();
  }
  broadcastToPc('ACTIVE_CALL_CHANGED', activeCall);
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
  res.json({ deviceState, activeCall, contacts, callLogs, messages });
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
    const request = https.get(UPDATE_MANIFEST_URL, {
      timeout: 8000,
      headers: { 'Cache-Control': 'no-cache' }
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
