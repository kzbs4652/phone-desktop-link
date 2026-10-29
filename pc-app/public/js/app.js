// KZBS PhoneLink v1.0.0 Client Controller
document.addEventListener('DOMContentLoaded', () => {
  // --- State ---
  let currentTab = 'keypad';
  let deviceState = {};
  let activeCall = null;
  let contacts = [];
  let callLogs = [];
  let messages = [];
  let activeThreadPhone = null;
  let inCallMuted = false;
  let inCallSpeaker = false;

  // --- DOM Elements ---
  const dockPill = document.getElementById('dockPill');
  const dockItems = document.querySelectorAll('.dock-item');
  const viewSlides = document.querySelectorAll('.view-slide');
  const phoneDisplay = document.getElementById('phoneDisplay');
  const contactsList = document.getElementById('contactsList');
  const searchInput = document.getElementById('contactSearch');
  const recentsList = document.getElementById('recentsList');
  const threadsList = document.getElementById('threadsList');
  const chatStream = document.getElementById('chatStream');
  const activeChatTitle = document.getElementById('activeChatTitle');
  const smsInput = document.getElementById('smsInput');
  const incallOverlay = document.getElementById('incallOverlay');
  const incallName = document.getElementById('incallName');
  const incallStatus = document.getElementById('incallStatus');
  const incallTimer = document.getElementById('incallTimer');
  const toast = document.getElementById('toastNotice');
  const toastText = document.getElementById('toastText');

  // --- WebSocket Connection ---
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/client`;
  let socket = null;

  function connectSocket() {
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log('✅ Connected to KZBS PhoneLink Desktop Server');
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleServerEvent(data);
      } catch (e) {
        console.error('Socket message parse error:', e);
      }
    };

    socket.onclose = () => {
      console.warn('Socket closed. Reconnecting in 2s...');
      setTimeout(connectSocket, 2000);
    };
  }
  connectSocket();

  function sendToServer(action, payload = {}) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ action, payload }));
    }
  }

  // --- Handle Server Events ---
  function handleServerEvent(msg) {
    const { action, payload } = msg;

    switch (action) {
      case 'INIT_STATE':
        deviceState = payload.deviceState || {};
        activeCall = payload.activeCall;
        contacts = payload.contacts || [];
        callLogs = payload.callLogs || [];
        messages = payload.messages || [];
        updateDeviceStatusUI();
        renderContacts(contacts);
        renderCallLogs(callLogs);
        renderMessages();
        renderActiveCall();
        break;

      case 'ACTIVE_CALL_CHANGED':
        activeCall = payload;
        renderActiveCall();
        break;

      case 'CALL_DURATION_TICK':
        if (activeCall) {
          activeCall.duration = payload.duration;
          const mins = String(Math.floor(payload.duration / 60)).padStart(2, '0');
          const secs = String(payload.duration % 60).padStart(2, '0');
          incallTimer.textContent = `${mins}:${secs}`;
        }
        break;

      case 'NEW_SMS':
        messages.unshift(payload);
        renderMessages();
        showToast(`💬 SMS: ${payload.sender} - ${payload.text.substring(0, 36)}...`);
        if (payload.code) {
          showToast(`🔑 Doğrulama Kodu: ${payload.code}`);
        }
        break;

      case 'CALL_LOGS_UPDATED':
        callLogs = payload;
        renderCallLogs(callLogs);
        break;

      case 'CONTACTS_UPDATED':
        contacts = payload;
        renderContacts(contacts);
        break;

      case 'DEVICE_STATUS_UPDATED':
      case 'PHONE_CONNECTION_CHANGED':
        deviceState = { ...deviceState, ...payload };
        updateDeviceStatusUI();
        break;
    }
  }

  // --- UI Toast Notification ---
  function showToast(msg) {
    toastText.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 4500);
  }

  // --- Liquid Glass Tab Slider & Floating Dock Navigation ---
  const tabPositions = {
    'recents': { index: 0, offset: 10 },
    'contacts': { index: 1, offset: 108 },
    'keypad': { index: 2, offset: 206 },
    'messages': { index: 3, offset: 304 },
    'status': { index: 4, offset: 402 }
  };

  function switchTab(targetTab) {
    if (currentTab === targetTab) return;
    window.phoneAudio.playClick();

    const currentIdx = tabPositions[currentTab]?.index || 0;
    const targetIdx = tabPositions[targetTab]?.index || 0;

    dockItems.forEach(item => {
      if (item.dataset.tab === targetTab) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Move sliding pill indicator
    const pos = tabPositions[targetTab];
    if (pos && dockPill) {
      dockPill.style.left = `${pos.offset}px`;
    }

    // Slide Views with iOS transition direction
    viewSlides.forEach(slide => {
      if (slide.id === `view-${targetTab}`) {
        slide.classList.remove('slide-left');
        slide.classList.add('active');
      } else {
        slide.classList.remove('active');
        if (targetIdx > currentIdx) {
          slide.classList.add('slide-left');
        } else {
          slide.classList.remove('slide-left');
        }
      }
    });

    currentTab = targetTab;
  }

  dockItems.forEach(item => {
    item.addEventListener('click', () => {
      switchTab(item.dataset.tab);
    });
  });

  // Default initial pill position
  if (dockPill) {
    dockPill.style.left = '206px'; // Center on Keypad
  }

  // --- Keypad & Dialer Logic ---
  const keyBtns = document.querySelectorAll('.key-btn');
  keyBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const digit = btn.dataset.digit;
      window.phoneAudio.playTone(digit);
      phoneDisplay.value += digit;
    });
  });

  document.getElementById('backspaceBtn')?.addEventListener('click', () => {
    window.phoneAudio.playClick();
    phoneDisplay.value = phoneDisplay.value.slice(0, -1);
  });

  document.getElementById('startCallBtn')?.addEventListener('click', () => {
    const number = phoneDisplay.value.trim();
    if (!number) {
      showToast('⚠️ Lütfen bir telefon numarası tuşlayın.');
      return;
    }
    sendToServer('DIAL_CALL', { number });
  });

  // --- Contacts Management ---
  function renderContacts(data) {
    if (!contactsList) return;
    contactsList.innerHTML = '';

    if (data.length === 0) {
      contactsList.innerHTML = '<div style="text-align:center; padding: 40px; color: #8e8e93;">Kişi bulunamadı.</div>';
      return;
    }

    data.forEach(c => {
      const card = document.createElement('div');
      card.className = 'contact-card';
      card.innerHTML = `
        <div class="contact-info">
          <div class="contact-avatar">${c.avatar || '👤'}</div>
          <div>
            <div class="contact-name">${c.name}</div>
            <div class="contact-phone">${c.phone}</div>
          </div>
        </div>
        <div class="contact-actions">
          <button class="action-btn-sm call-action" title="Ara" data-phone="${c.phone}" data-name="${c.name}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#30d158"><path d="M20 15.5c-1.2 0-2.4-.2-3.6-.6-.3-.1-.7 0-1 .2l-2.2 2.2c-2.8-1.4-5.1-3.8-6.6-6.6l2.2-2.2c.3-.3.4-.7.2-1-.4-1.1-.6-2.3-.6-3.5 0-.6-.4-1-1-1H4c-.6 0-1 .4-1 1 0 9.4 7.6 17 17 17 .6 0 1-.4 1-1v-3.5c0-.6-.4-1-1-1z"/></svg>
          </button>
          <button class="action-btn-sm sms-action" title="SMS Gönder" data-phone="${c.phone}" data-name="${c.name}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#4facfe"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/></svg>
          </button>
        </div>
      `;

      card.querySelector('.call-action').addEventListener('click', (e) => {
        e.stopPropagation();
        sendToServer('DIAL_CALL', { number: c.phone, contactName: c.name });
      });

      card.querySelector('.sms-action').addEventListener('click', (e) => {
        e.stopPropagation();
        activeThreadPhone = c.phone;
        switchTab('messages');
        renderMessages();
      });

      contactsList.appendChild(card);
    });
  }

  searchInput?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = contacts.filter(c => c.name.toLowerCase().includes(q) || c.phone.includes(q));
    renderContacts(filtered);
  });

  // --- Recents / Call Logs ---
  function renderCallLogs(data) {
    if (!recentsList) return;
    recentsList.innerHTML = '';

    data.forEach(log => {
      const item = document.createElement('div');
      item.className = 'call-log-item';
      
      let typeIcon = '📞';
      let typeClass = 'type-incoming';
      let typeLabel = 'Gelen Arama';
      if (log.type === 'missed') {
        typeIcon = '✕';
        typeClass = 'type-missed';
        typeLabel = 'Cevapsız Arama';
      } else if (log.type === 'outgoing') {
        typeIcon = '↗';
        typeClass = 'type-outgoing';
        typeLabel = 'Giden Arama';
      }

      item.innerHTML = `
        <div class="log-left">
          <div class="log-type-icon ${typeClass}">${typeIcon}</div>
          <div>
            <div style="font-weight: 600; font-size: 15px; margin-bottom: 2px;">${log.name}</div>
            <div class="log-meta">${typeLabel} • ${log.phone}</div>
          </div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 13px; font-weight: 500;">${log.time}</div>
          <div class="log-meta">${log.duration || ''}</div>
        </div>
      `;

      item.addEventListener('click', () => {
        sendToServer('DIAL_CALL', { number: log.phone, contactName: log.name });
      });

      recentsList.appendChild(item);
    });
  }

  // --- Messages & 2FA Codes ---
  function renderMessages() {
    if (!threadsList || !chatStream) return;
    threadsList.innerHTML = '';

    // Group by sender / phone
    const threadsMap = new Map();
    messages.forEach(m => {
      const key = m.phone || m.sender;
      if (!threadsMap.has(key)) {
        threadsMap.set(key, []);
      }
      threadsMap.get(key).push(m);
    });

    if (!activeThreadPhone && threadsMap.size > 0) {
      activeThreadPhone = threadsMap.keys().next().value;
    }

    threadsMap.forEach((msgs, phone) => {
      const latest = msgs[0];
      const item = document.createElement('div');
      item.className = `thread-item ${phone === activeThreadPhone ? 'active' : ''}`;
      item.innerHTML = `
        <div class="thread-header">
          <span class="thread-sender">${latest.sender || phone}</span>
          <span class="thread-time">${latest.timestamp}</span>
        </div>
        <div class="thread-preview">${latest.text}</div>
      `;

      item.addEventListener('click', () => {
        activeThreadPhone = phone;
        renderMessages();
      });

      threadsList.appendChild(item);
    });

    // Render active chat stream
    chatStream.innerHTML = '';
    if (activeThreadPhone) {
      const activeMsgs = threadsMap.get(activeThreadPhone) || [];
      activeChatTitle.textContent = activeMsgs[0]?.sender || activeThreadPhone;

      // Reverse so oldest at top
      [...activeMsgs].reverse().forEach(sms => {
        const bubble = document.createElement('div');
        bubble.className = `sms-bubble ${sms.isOutgoing ? 'outgoing' : 'incoming'}`;
        
        let html = `<div>${sms.text}</div>`;
        if (sms.code) {
          html += `
            <div class="code-badge-box">
              <span class="code-value">${sms.code}</span>
              <button class="copy-code-btn" data-code="${sms.code}">Kodu Kopyala 📋</button>
            </div>
          `;
        }
        bubble.innerHTML = html;

        bubble.querySelector('.copy-code-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const code = e.target.dataset.code;
          navigator.clipboard.writeText(code);
          e.target.textContent = 'Kopyalandı! ✅';
          showToast(`📋 Doğrulama Kodu Kopyalandı: ${code}`);
          setTimeout(() => {
            e.target.textContent = 'Kodu Kopyala 📋';
          }, 2500);
        });

        chatStream.appendChild(bubble);
      });
      chatStream.scrollTop = chatStream.scrollHeight;
    }
  }

  // Send SMS button
  document.getElementById('sendSmsBtn')?.addEventListener('click', () => {
    const text = smsInput.value.trim();
    if (!text || !activeThreadPhone) return;
    sendToServer('SEND_SMS', { phone: activeThreadPhone, text });
    smsInput.value = '';
  });

  smsInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('sendSmsBtn')?.click();
    }
  });

  // --- In-Call Overlay HUD ---
  function renderActiveCall() {
    if (!incallOverlay) return;

    if (activeCall) {
      incallName.textContent = activeCall.contactName || activeCall.number;
      incallStatus.textContent = activeCall.status === 'ACTIVE' ? 'GÖRÜŞÜLÜYOR' : 'ARANIYOR...';
      incallOverlay.classList.add('active');
    } else {
      incallOverlay.classList.remove('active');
      incallTimer.textContent = '00:00';
    }
  }

  document.getElementById('endCallBtn')?.addEventListener('click', () => {
    window.phoneAudio.playClick();
    sendToServer('END_CALL');
  });

  document.getElementById('muteBtn')?.addEventListener('click', (e) => {
    inCallMuted = !inCallMuted;
    e.currentTarget.classList.toggle('active', inCallMuted);
    sendToServer('MUTE_TOGGLE', { muted: inCallMuted });
    showToast(inCallMuted ? '🎙️ Mikrofon Sessize Alındı' : '🎙️ Mikrofon Açıldı');
  });

  document.getElementById('speakerBtn')?.addEventListener('click', (e) => {
    inCallSpeaker = !inCallSpeaker;
    e.currentTarget.classList.toggle('active', inCallSpeaker);
    sendToServer('SPEAKER_TOGGLE', { speaker: inCallSpeaker });
    showToast(inCallSpeaker ? '🔊 Hoparlör Açık' : '🔈 Ahize/Kulaklık Aktif');
  });

  document.getElementById('addCallBtn')?.addEventListener('click', () => {
    showToast('➕ Arama Ekleme / Konferans Modu Açıldı');
  });

  // --- Device Status Header UI ---
  function updateDeviceStatusUI() {
    const statusText = document.getElementById('deviceStatusText');
    const batteryFill = document.getElementById('batteryFill');
    const batteryPercent = document.getElementById('batteryPercent');

    if (statusText) {
      statusText.textContent = deviceState.connected 
        ? `${deviceState.deviceName || 'Telefon'} Bağlı` 
        : 'Bağlantı Aranıyor...';
    }
    if (batteryPercent) {
      batteryPercent.textContent = `%${deviceState.batteryLevel || 84}`;
    }
    if (batteryFill) {
      batteryFill.style.width = `${deviceState.batteryLevel || 84}%`;
    }
  }

  // --- Quick Simulators (For Instant Testing) ---
  document.getElementById('testSmsBtn')?.addEventListener('click', () => {
    sendToServer('SIMULATE_INCOMING_SMS', {
      sender: 'Garanti BBVA',
      text: 'Sayın Müşterimiz, mobil onay kodunuz: ' + Math.floor(100000 + Math.random() * 900000) + '. İşlemi siz yapmadıysanız arayınız.'
    });
  });

  document.getElementById('testCallBtn')?.addEventListener('click', () => {
    sendToServer('SIMULATE_INCOMING_CALL', {
      number: '+90 532 999 88 77',
      name: 'Ahmet Yılmaz (Gelen Arama)'
    });
  });
});
