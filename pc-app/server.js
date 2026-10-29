const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const dgram = require('dgram');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 4955;
const UDP_PORT = 4956;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- In-Memory State & Storage ---
let connectedPhone = null; // WebSocket connection to Android Phone
const pcClients = new Set(); // WebSocket connections to PC UI clients

let deviceState = {
  connected: false,
  deviceName: "Galaxy S23 (Demo)",
  batteryLevel: 84,
  isCharging: true,
  wifiSsid: "Ev-Wifi-5G",
  signalLevel: 4,
  ipAddress: "192.168.1.45",
  lastSeen: new Date().toISOString()
};

let activeCall = null; // { number, contactName, status: 'DIALING' | 'RINGING' | 'ACTIVE', startTime, duration: 0 }
let callTimer = null;

// Initial Default/Synced Contacts
let contacts = [
  { id: '1', name: 'Ahmet Yılmaz', phone: '+90 532 111 22 33', avatar: '👨‍💼', favorite: true, category: 'İş' },
  { id: '2', name: 'Ayşe Kaya', phone: '+90 542 222 33 44', avatar: '👩‍💻', favorite: true, category: 'Aile' },
  { id: '3', name: 'Caner Demir', phone: '+90 555 333 44 55', avatar: '🧑‍🔧', favorite: false, category: 'Arkadaş' },
  { id: '4', name: 'Zeynep Çelik', phone: '+90 505 444 55 66', avatar: '👩‍⚕️', favorite: false, category: 'İş' },
  { id: '5', name: 'Müşteri Hizmetleri', phone: '0850 222 00 00', avatar: '🎧', favorite: false, category: 'Destek' }
];

// Initial Default/Synced Call Logs
let callLogs = [
  { id: 'c1', name: 'Ahmet Yılmaz', phone: '+90 532 111 22 33', type: 'incoming', time: '13:12', duration: '03:45', date: 'Bugün' },
  { id: 'c2', name: 'Caner Demir', phone: '+90 555 333 44 55', type: 'missed', time: '11:40', duration: '00:00', date: 'Bugün' },
  { id: 'c3', name: 'Ayşe Kaya', phone: '+90 542 222 33 44', type: 'outgoing', time: 'Dün', duration: '12:18', date: 'Dün' }
];

// Initial Default/Synced SMS Messages
let messages = [
  {
    id: 'm1',
    sender: 'Garanti BBVA',
    phone: 'GARANTI',
    timestamp: '13:28',
    text: '482910 nolu sifre ile giris yapabilirsiniz. Guvenliginiz icin kimseyle paylasmayiniz.',
    code: '482910',
    unread: true
  },
  {
    id: 'm2',
    sender: 'Trendyol',
    phone: 'TRENDYOL',
    timestamp: '12:15',
    text: 'Siparisiniz kargoya verildi! Teslimat kodunuz: 8941. Kuryeye iletiniz.',
    code: '8941',
    unread: false
  },
  {
    id: 'm3',
    sender: 'Ahmet Yılmaz',
    phone: '+90 532 111 22 33',
    timestamp: '10:04',
    text: 'Toplantı linkini aldım, 14:00\'te görüşürüz!',
    code: null,
    unread: false
  }
];

// Helper: Broadcast to all PC web clients
function broadcastToPc(action, payload) {
  const message = JSON.stringify({ action, payload, timestamp: Date.now() });
  pcClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Helper: Send to Android Phone if connected
function sendToPhone(action, payload) {
  if (connectedPhone && connectedPhone.readyState === WebSocket.OPEN) {
    connectedPhone.send(JSON.stringify({ action, payload }));
    return true;
  }
  return false;
}

// --- WebSocket Connection Management ---
wss.on('connection', (ws, req) => {
  const url = req.url || '';

  if (url.includes('/phone')) {
    // Android Phone connected!
    console.log('[KZBS Bridge] 📱 Android Telefon bağlandı!');
    connectedPhone = ws;
    deviceState.connected = true;
    broadcastToPc('PHONE_CONNECTION_CHANGED', deviceState);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handlePhoneMessage(msg);
      } catch (err) {
        console.error('Phone message parse error:', err);
      }
    });

    ws.on('close', () => {
      console.log('[KZBS Bridge] 📱 Android Telefon bağlantısı koptu.');
      connectedPhone = null;
      deviceState.connected = false;
      broadcastToPc('PHONE_CONNECTION_CHANGED', deviceState);
    });

  } else {
    // PC Client connected
    pcClients.add(ws);
    // Send initial handshake state
    ws.send(JSON.stringify({
      action: 'INIT_STATE',
      payload: {
        deviceState,
        activeCall,
        contacts,
        callLogs,
        messages
      }
    }));

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handlePcMessage(msg, ws);
      } catch (err) {
        console.error('PC client message parse error:', err);
      }
    });

    ws.on('close', () => {
      pcClients.delete(ws);
    });
  }
});

// Process messages from Phone
function handlePhoneMessage(msg) {
  const { action, payload } = msg;
  console.log(`[Phone -> PC] Action: ${action}`);

  switch (action) {
    case 'DEVICE_HELLO':
      deviceState = { ...deviceState, ...payload, connected: true };
      broadcastToPc('DEVICE_STATUS_UPDATED', deviceState);
      break;

    case 'SMS_RECEIVED':
      // Extract 2FA code if exists (4-8 digits)
      const codeMatch = payload.text ? payload.text.match(/\b\d{4,8}\b/) : null;
      const newSms = {
        id: 'sms_' + Date.now(),
        sender: payload.sender || payload.phone,
        phone: payload.phone,
        timestamp: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
        text: payload.text,
        code: codeMatch ? codeMatch[0] : null,
        unread: true
      };
      messages.unshift(newSms);
      broadcastToPc('NEW_SMS', newSms);
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
      broadcastToPc(action, payload);
  }
}

// Process messages from PC UI
function handlePcMessage(msg, ws) {
  const { action, payload } = msg;
  console.log(`[PC -> Server] Action: ${action}`, payload);

  switch (action) {
    case 'DIAL_CALL':
      initiateCall(payload.number, payload.contactName);
      break;

    case 'END_CALL':
      terminateCall();
      break;

    case 'SEND_SMS':
      sendSmsFromPc(payload.phone, payload.text);
      break;

    case 'SEND_DTMF':
      sendToPhone('SEND_DTMF', payload);
      broadcastToPc('DTMF_PLAYED', payload);
      break;

    case 'MUTE_TOGGLE':
      sendToPhone('MUTE_TOGGLE', payload);
      broadcastToPc('MUTE_UPDATED', payload);
      break;

    case 'SPEAKER_TOGGLE':
      sendToPhone('SPEAKER_TOGGLE', payload);
      broadcastToPc('SPEAKER_UPDATED', payload);
      break;

    case 'SIMULATE_INCOMING_CALL':
      simulateIncomingCall(payload.number, payload.name);
      break;

    case 'SIMULATE_INCOMING_SMS':
      simulateIncomingSms(payload.sender, payload.text);
      break;
  }
}

function initiateCall(number, contactName) {
  const name = contactName || contacts.find(c => c.phone === number)?.name || number;
  activeCall = {
    number,
    contactName: name,
    status: 'DIALING',
    startTime: Date.now(),
    duration: 0
  };

  sendToPhone('DIAL_CALL', { number, name });
  broadcastToPc('ACTIVE_CALL_CHANGED', activeCall);

  // In demo mode or until phone signals ACTIVE, simulate connection in 3 seconds
  setTimeout(() => {
    if (activeCall && activeCall.status === 'DIALING') {
      activeCall.status = 'ACTIVE';
      activeCall.connectedTime = Date.now();
      startCallDurationTimer();
      broadcastToPc('ACTIVE_CALL_CHANGED', activeCall);
    }
  }, 2800);
}

function startCallDurationTimer() {
  if (callTimer) clearInterval(callTimer);
  callTimer = setInterval(() => {
    if (!activeCall) {
      clearInterval(callTimer);
      return;
    }
    activeCall.duration = Math.floor((Date.now() - (activeCall.connectedTime || activeCall.startTime)) / 1000);
    broadcastToPc('CALL_DURATION_TICK', { duration: activeCall.duration });
  }, 1000);
}

function terminateCall() {
  if (callTimer) {
    clearInterval(callTimer);
    callTimer = null;
  }
  if (activeCall) {
    const mins = String(Math.floor(activeCall.duration / 60)).padStart(2, '0');
    const secs = String(activeCall.duration % 60).padStart(2, '0');
    // Add to call logs
    callLogs.unshift({
      id: 'c_' + Date.now(),
      name: activeCall.contactName,
      phone: activeCall.number,
      type: 'outgoing',
      time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      duration: `${mins}:${secs}`,
      date: 'Bugün'
    });
    sendToPhone('END_CALL', {});
    activeCall = null;
    broadcastToPc('ACTIVE_CALL_CHANGED', null);
    broadcastToPc('CALL_LOGS_UPDATED', callLogs);
  }
}

function updateCallState(payload) {
  if (payload.status === 'ENDED') {
    terminateCall();
  } else {
    activeCall = { ...activeCall, ...payload };
    if (payload.status === 'ACTIVE' && !callTimer) {
      startCallDurationTimer();
    }
    broadcastToPc('ACTIVE_CALL_CHANGED', activeCall);
  }
}

function sendSmsFromPc(phone, text) {
  sendToPhone('SEND_SMS', { phone, text });
  const sentSms = {
    id: 'sms_' + Date.now(),
    sender: 'Ben (PC)',
    phone: phone,
    timestamp: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
    text: text,
    isOutgoing: true,
    code: null,
    unread: false
  };
  messages.unshift(sentSms);
  broadcastToPc('NEW_SMS', sentSms);
}

// Simulation helpers for immediate testing
function simulateIncomingCall(number = '+90 532 999 88 77', name = 'Banka Müşteri Temsilcisi') {
  activeCall = {
    number,
    contactName: name,
    status: 'RINGING',
    startTime: Date.now(),
    duration: 0
  };
  broadcastToPc('ACTIVE_CALL_CHANGED', activeCall);
}

function simulateIncomingSms(sender = 'Garanti BBVA', text = 'Giriş doğrulama kodunuz: 593812. Lütfen kimseyle paylaşmayınız.') {
  const codeMatch = text.match(/\b\d{4,8}\b/);
  const simSms = {
    id: 'sms_' + Date.now(),
    sender,
    phone: sender,
    timestamp: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
    text,
    code: codeMatch ? codeMatch[0] : null,
    unread: true
  };
  messages.unshift(simSms);
  broadcastToPc('NEW_SMS', simSms);
}

// --- REST Endpoints ---
app.get('/api/state', (req, res) => {
  res.json({ deviceState, activeCall, contacts, callLogs, messages });
});

app.post('/api/simulate/sms', (req, res) => {
  simulateIncomingSms(req.body.sender, req.body.text);
  res.json({ success: true });
});

app.post('/api/simulate/call', (req, res) => {
  simulateIncomingCall(req.body.number, req.body.name);
  res.json({ success: true });
});

// --- Zero-Touch Auto-Connect: UDP Broadcast Discovery ---
const udpSocket = dgram.createSocket('udp4');
udpSocket.on('error', (err) => console.log('[UDP Discovery] err:', err.message));

udpSocket.on('message', (msg, rinfo) => {
  const str = msg.toString();
  if (str.includes('KZBS_DISCOVERY_PING')) {
    const response = JSON.stringify({
      app: 'KZBS PhoneLink',
      version: '1.0.0',
      wsPort: PORT,
      timestamp: Date.now()
    });
    udpSocket.send(response, rinfo.port, rinfo.address, () => {
      console.log(`[Auto-Connect] 📡 Phone discovered PC at ${rinfo.address}! Handshake sent.`);
    });
  }
});

udpSocket.bind(UDP_PORT, () => {
  udpSocket.setBroadcast(true);
  console.log(`[Auto-Connect] Zero-Touch UDP Discovery listening on port ${UDP_PORT}`);
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  🌟 KZBS PhoneLink v1.0.0 Desktop Server Çalışıyor!`);
  console.log(`  🔗 Web Arayüzü: http://localhost:${PORT}`);
  console.log(`  📱 Android WebSocket: ws://localhost:${PORT}/phone`);
  console.log(`=======================================================`);
});
