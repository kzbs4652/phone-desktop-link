// KZBS PhoneLink v1.0.5 Client Controller
document.addEventListener('DOMContentLoaded', () => {
  // --- State ---
  let currentTab = 'keypad';
  let deviceState = { connected: false };
  let activeCall = null;
  let contacts = [];
  let callLogs = [];
  let messages = [];
  let activeThreadPhone = null;

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
      refreshPairingInfo();
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
        showToast(`💬 SMS: ${payload.sender} - ${String(payload.text || '').substring(0, 36)}...`);
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

      case 'MESSAGES_UPDATED':
        messages = Array.isArray(payload) ? payload : [];
        activeThreadPhone = null;
        renderMessages();
        break;

      case 'APP_ERROR':
        showToast(payload?.message || 'Telefon işlemi tamamlanamadı.');
        break;

      case 'DEVICE_STATUS_UPDATED':
      case 'PHONE_CONNECTION_CHANGED':
        deviceState = { ...deviceState, ...payload };
        updateDeviceStatusUI();
        refreshPairingInfo();
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

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function refreshPairingInfo() {
    fetch('/api/connection-info', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Bağlantı bilgisi alınamadı')))
      .then(info => {
        const panel = document.getElementById('pairingPanel');
        const pairingStatus = document.getElementById('pairingStatus');
        const pairingAddresses = document.getElementById('pairingAddresses');
        const pairingCode = document.getElementById('pairingCode');
        if (pairingCode) pairingCode.textContent = info.pairingCode || (info.paired ? 'EŞLEŞTİ' : '------');
        const pairingQr = document.getElementById('pairingQr');
        const pairingCodeLabel = document.getElementById('pairingCodeLabel');
        const pairingButton = document.getElementById('btnOpenPairing');
        if (pairingCodeLabel) pairingCodeLabel.textContent = info.pairingOpen ? 'Telefondaki uygulamayla tara' : 'Eşleştirme durumu';
        if (pairingButton) pairingButton.textContent = info.pairingOpen ? 'Eşleştirme açık' : (info.paired ? 'Başka telefon eşleştir' : 'Eşleştirme kodu göster');
        if (pairingQr) {
          pairingQr.style.display = info.pairingOpen ? 'block' : 'none';
          if (info.pairingOpen) fetch('/api/pairing-qr', { cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(qr => { if (qr?.dataUrl) pairingQr.src = qr.dataUrl; }).catch(() => {});
        }
        if (pairingAddresses) {
          pairingAddresses.textContent = info.addresses?.length
            ? `Android uygulamasında bu bilgisayarı bul; bulunmazsa adres: ${info.addresses.join('  •  ')}`
            : 'Yerel ağ adresi bulunamadı. Bilgisayar ve telefonu aynı Wi-Fi ağına bağla.';
        }
        if (panel) panel.style.display = 'flex';
        if (pairingStatus) {
          pairingStatus.textContent = info.connected
            ? `${info.deviceName || 'Telefon'} bağlı. Eşleştirme kaydedildi.`
            : info.paired
              ? 'Telefon bir kez eşleştirildi. Aynı Wi-Fi ağına gelince kendiliğinden bağlanır.'
              : 'Telefon uygulamasında bu kodu gir veya QR kodunu tara.';
        }
      })
      .catch(() => {});
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
      contactsList.innerHTML = `<div style="text-align:center; padding: 40px; color: #8e8e93;">${deviceState.connected ? 'Telefonda kişi bulunamadı.' : 'Kişileri görmek için Android PhoneLink uygulamasından telefonunu bağla.'}</div>`;
      return;
    }

    data.forEach(c => {
      const card = document.createElement('div');
      card.className = 'contact-card';
      card.innerHTML = `
        <div class="contact-info">
          <div class="contact-avatar">${escapeHtml(c.avatar || '👤')}</div>
          <div>
            <div class="contact-name">${escapeHtml(c.name)}</div>
            <div class="contact-phone">${escapeHtml(c.phone)}</div>
          </div>
        </div>
        <div class="contact-actions">
          <button class="action-btn-sm call-action" title="Ara" data-phone="${escapeHtml(c.phone)}" data-name="${escapeHtml(c.name)}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#30d158"><path d="M20 15.5c-1.2 0-2.4-.2-3.6-.6-.3-.1-.7 0-1 .2l-2.2 2.2c-2.8-1.4-5.1-3.8-6.6-6.6l2.2-2.2c.3-.3.4-.7.2-1-.4-1.1-.6-2.3-.6-3.5 0-.6-.4-1-1-1H4c-.6 0-1 .4-1 1 0 9.4 7.6 17 17 17 .6 0 1-.4 1-1v-3.5c0-.6-.4-1-1-1z"/></svg>
          </button>
          <button class="action-btn-sm sms-action" title="SMS Gönder" data-phone="${escapeHtml(c.phone)}" data-name="${escapeHtml(c.name)}">
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

    if (data.length === 0) {
      recentsList.innerHTML = `<div style="text-align:center; padding: 40px; color: #8e8e93;">${deviceState.connected ? 'Telefonda arama geçmişi bulunamadı.' : 'Arama geçmişini görmek için telefonunu bağla.'}</div>`;
      return;
    }

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
            <div style="font-weight: 600; font-size: 15px; margin-bottom: 2px;">${escapeHtml(log.name)}</div>
            <div class="log-meta">${typeLabel} • ${escapeHtml(log.phone)}</div>
          </div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 13px; font-weight: 500;">${escapeHtml(log.time)}</div>
          <div class="log-meta">${escapeHtml(log.duration || '')}</div>
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

    if (threadsMap.size === 0) {
      threadsList.innerHTML = `<div style="text-align:center; padding: 24px 12px; color: #8e8e93;">${deviceState.connected ? 'Telefonda mesaj bulunamadı.' : 'Mesajları görmek için telefonunu bağla.'}</div>`;
      chatStream.innerHTML = '<div style="text-align:center; padding: 40px; color: #8e8e93;">Telefon bağlandığında SMS’ler burada görünür.</div>';
      activeChatTitle.textContent = 'Mesajlar';
      return;
    }

    threadsMap.forEach((msgs, phone) => {
      const latest = msgs[0];
      const item = document.createElement('div');
      item.className = `thread-item ${phone === activeThreadPhone ? 'active' : ''}`;
      item.innerHTML = `
        <div class="thread-header">
          <span class="thread-sender">${escapeHtml(latest.isOutgoing ? phone : (latest.sender || phone))}</span>
          <span class="thread-time">${escapeHtml(latest.timestamp)}</span>
        </div>
        <div class="thread-preview">${escapeHtml(latest.text)}</div>
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
      activeChatTitle.textContent = activeMsgs.find(message => !message.isOutgoing)?.sender || activeThreadPhone;

      // Reverse so oldest at top
      [...activeMsgs].reverse().forEach(sms => {
        const bubble = document.createElement('div');
        bubble.className = `sms-bubble ${sms.isOutgoing ? 'outgoing' : 'incoming'}`;
        
        let html = `<div>${escapeHtml(sms.text)}</div>`;
        if (sms.code) {
          html += `
            <div class="code-badge-box">
              <span class="code-value">${escapeHtml(sms.code)}</span>
              <button class="copy-code-btn" data-code="${escapeHtml(sms.code)}">Kodu Kopyala 📋</button>
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
      const stateLabels = { ACTIVE: 'GÖRÜŞMEDE', DIALING: 'ARANIYOR', RINGING: 'ÇALIYOR', HOLDING: 'BEKLEMEDE', CONNECTING: 'BAĞLANIYOR' };
      incallStatus.textContent = stateLabels[activeCall.status] || 'ARAMA DURUMU';
      const muteButton = document.getElementById('muteBtn');
      const routeButton = document.getElementById('speakerBtn');
      const holdButton = document.getElementById('holdCallBtn');
      muteButton?.classList.toggle('active', Boolean(activeCall.isMuted));
      routeButton?.classList.toggle('active', activeCall.audioRoute === 'BLUETOOTH');
      holdButton?.classList.toggle('active', activeCall.status === 'HOLDING');
      const audioNote = document.getElementById('incallAudioNote');
      if (audioNote) audioNote.textContent = activeCall.audioRoute === 'BLUETOOTH'
        ? 'Bluetooth arama sesi seçildi. Ses, telefon ile eşleşmiş bilgisayarın eller serbest ses bağlantısından geçer.'
        : 'PC sesi için telefon ve bilgisayarı Bluetooth arama cihazı olarak eşleştirip PC sesi (BT) düğmesine bas. Arama kontrolleri için telefonda PhoneLink arama denetimini etkinleştir.';
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

  document.getElementById('muteBtn')?.addEventListener('click', () => {
    sendToServer('CALL_MUTE', { muted: !Boolean(activeCall?.isMuted) });
  });
  document.getElementById('speakerBtn')?.addEventListener('click', () => {
    sendToServer('CALL_ROUTE', { route: activeCall?.audioRoute === 'BLUETOOTH' ? 'PHONE' : 'BLUETOOTH' });
  });
  document.getElementById('holdCallBtn')?.addEventListener('click', () => {
    sendToServer(activeCall?.status === 'HOLDING' ? 'CALL_UNHOLD' : 'CALL_HOLD');
  });
  document.getElementById('incallKeypadBtn')?.addEventListener('click', () => {
    const panel = document.getElementById('incallKeypad');
    if (panel) panel.hidden = !panel.hidden;
  });
  document.querySelectorAll('[data-incall-digit]').forEach(button => {
    button.addEventListener('click', () => {
      const digit = button.dataset.incallDigit;
      window.phoneAudio.playTone(digit, 0.12);
      sendToServer('DTMF_TONE', { digit });
    });
  });
  document.getElementById('addCallBtn')?.addEventListener('click', () => {
    const panel = document.getElementById('addCallPanel');
    if (panel) {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) document.getElementById('addCallNumber')?.focus();
    }
  });
  document.getElementById('confirmAddCallBtn')?.addEventListener('click', () => {
    const input = document.getElementById('addCallNumber');
    const number = input?.value.trim();
    if (!number) { showToast('Eklenecek telefon numarasını gir.'); return; }
    sendToServer('ADD_CALL', { number });
    input.value = '';
    const panel = document.getElementById('addCallPanel');
    if (panel) panel.hidden = true;
  });
  document.getElementById('addCallNumber')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') document.getElementById('confirmAddCallBtn')?.click();
  });

  // --- Device Status Header UI ---
  function updateDeviceStatusUI() {
    const statusText = document.getElementById('deviceStatusText');
    const batteryFill = document.getElementById('batteryFill');
    const batteryPercent = document.getElementById('batteryPercent');
    const statusDeviceName = document.getElementById('statusDeviceName');
    const statusConnectionState = document.getElementById('statusConnectionState');
    const statusBattery = document.getElementById('statusBattery');
    const statusPill = document.querySelector('.header-status-pill');
    const connected = Boolean(deviceState.connected);

    if (statusText) {
      statusText.textContent = connected ? `${deviceState.deviceName || 'Telefon'} bağlı` : 'Telefon bağlı değil';
    }
    statusPill?.classList.toggle('connected', connected);
    if (batteryPercent) {
      batteryPercent.textContent = connected && Number(deviceState.batteryLevel) >= 0 ? `%${deviceState.batteryLevel}` : '—';
    }
    if (batteryFill) {
      batteryFill.style.width = connected && Number(deviceState.batteryLevel) >= 0 ? `${deviceState.batteryLevel}%` : '0%';
    }
    if (statusDeviceName) statusDeviceName.textContent = connected ? (deviceState.deviceName || 'Telefon') : 'Henüz bağlanmadı';
    if (statusConnectionState) {
      statusConnectionState.textContent = connected ? '🟢 Bağlı' : 'Bağlantı bekleniyor';
      statusConnectionState.style.color = connected ? 'var(--ios-green)' : 'var(--ios-yellow)';
    }
    if (statusBattery) {
      statusBattery.textContent = connected && Number(deviceState.batteryLevel) >= 0
        ? `%${deviceState.batteryLevel}${deviceState.isCharging ? ' (Şarj oluyor)' : ''}` : '—';
    }
  }
  updateDeviceStatusUI();
  refreshPairingInfo();

  document.getElementById('btnOpenPairing')?.addEventListener('click', async () => {
    try {
      if (window.phoneLink?.openPairingWindow) await window.phoneLink.openPairingWindow();
      else {
        const response = await fetch('/api/open-pairing', { method: 'POST' });
        if (!response.ok) throw new Error('Eşleştirme açılamadı');
      }
      refreshPairingInfo();
      showToast('5 dakikalık eşleştirme açıldı.');
    } catch (_) { showToast('Eşleştirme açılamadı. Uygulamayı yeniden başlatıp dene.'); }
  });

  // --- Auto-Update Check ---
  let latestPcSetupUrl = null;
  let lastNotifiedUpdateVersion = null;
  let deferredUpdateVersion = null;
  let downloadedUpdatePath = null;
  let updateDownloadUrl = null;
  const updateDialog = document.getElementById('updateDialog');
  const updateDialogVersion = document.getElementById('updateDialogVersion');
  const updateDialogNotes = document.getElementById('updateDialogNotes');
  const updateDownloadStatus = document.getElementById('updateDownloadStatus');
  const updateDownloadBtn = document.getElementById('updateDownloadBtn');
  const updateRevealBtn = document.getElementById('updateRevealBtn');
  const pcUpdatePill = document.getElementById('pcUpdatePill');
  const pcUpdateVer = document.getElementById('pcUpdateVer');
  const pcBtnDownloadUpdate = document.getElementById('pcBtnDownloadUpdate');
  const btnCheckUpdateManual = document.getElementById('btnCheckUpdateManual');
  const pcUpdateStatusMsg = document.getElementById('pcUpdateStatusMsg');

  function closeUpdateDialog(defer = false) {
    if (defer && updateDialogVersion?.dataset.version) deferredUpdateVersion = updateDialogVersion.dataset.version;
    if (updateDialog) updateDialog.style.display = 'none';
  }

  function showUpdateDialog(version, notes, url) {
    updateDownloadUrl = url;
    if (updateDialogVersion) {
      updateDialogVersion.textContent = `Yeni sürüm v${version}`;
      updateDialogVersion.dataset.version = version;
    }
    if (updateDialogNotes) updateDialogNotes.textContent = notes || 'Güncellemeyi indirip kurulum dosyasını kendin çalıştırabilirsin.';
    if (updateDownloadStatus) updateDownloadStatus.textContent = 'İndirme İndirilenler klasörüne kaydedilir. Kurulumu sen başlatırsın.';
    if (updateDownloadBtn) { updateDownloadBtn.disabled = false; updateDownloadBtn.textContent = 'Şimdi indir'; }
    if (updateRevealBtn) updateRevealBtn.style.display = downloadedUpdatePath ? 'block' : 'none';
    if (updateDialog) updateDialog.style.display = 'flex';
  }

  function checkAppUpdate(manual = false) {
    if (pcUpdateStatusMsg && manual) pcUpdateStatusMsg.textContent = 'Güncellemeler denetleniyor...';
    fetch('/api/check-update')
      .then(res => res.json())
      .then(data => {
        if (!data || data.error) throw new Error('Update check failed');
        if (data.hasUpdate) {
          if (pcUpdatePill) {
            pcUpdatePill.style.display = 'flex';
            if (pcUpdateVer) pcUpdateVer.textContent = 'v' + data.latestVersion;
          }
          if (data.pcDownloadUrl) latestPcSetupUrl = data.pcDownloadUrl;
          if (pcUpdateStatusMsg) {
            pcUpdateStatusMsg.textContent = `🚀 Yeni sürüm mevcut: v${data.latestVersion}`;
          }
          if (manual || (lastNotifiedUpdateVersion !== data.latestVersion && deferredUpdateVersion !== data.latestVersion)) {
            showToast(`🚀 Yeni Güncelleme Yayında: v${data.latestVersion}`);
            lastNotifiedUpdateVersion = data.latestVersion;
            showUpdateDialog(data.latestVersion, data.notes, data.pcDownloadUrl);
          }
        } else {
          if (pcUpdatePill) pcUpdatePill.style.display = 'none';
          if (pcUpdateStatusMsg) {
            pcUpdateStatusMsg.textContent = `✅ Yazılımınız güncel (v${data.currentVersion})`;
          }
          if (manual) showToast('✅ KZBS PhoneLink en güncel sürümde!');
        }
      })
      .catch(err => {
        if (pcUpdateStatusMsg && manual) pcUpdateStatusMsg.textContent = 'Güncelleme denetlenemedi.';
      });
  }

  btnCheckUpdateManual?.addEventListener('click', () => checkAppUpdate(true));
  pcBtnDownloadUpdate?.addEventListener('click', () => {
    if (latestPcSetupUrl && updateDialogVersion?.dataset.version) showUpdateDialog(updateDialogVersion.dataset.version, updateDialogNotes?.textContent, latestPcSetupUrl);
  });
  document.getElementById('updateLaterBtn')?.addEventListener('click', () => closeUpdateDialog(true));
  document.getElementById('updateDialogClose')?.addEventListener('click', () => closeUpdateDialog(true));
  updateDownloadBtn?.addEventListener('click', async () => {
    if (!updateDownloadUrl) return;
    if (!window.phoneLink?.downloadUpdate) { showToast('Uygulama içi indirme yalnızca Windows uygulamasında kullanılabilir.'); return; }
    updateDownloadBtn.disabled = true;
    updateDownloadBtn.textContent = 'İndiriliyor…';
    if (updateDownloadStatus) updateDownloadStatus.textContent = 'GitHub üzerinden güvenli indirme başlatıldı…';
    try {
      const result = await window.phoneLink.downloadUpdate(updateDownloadUrl);
      downloadedUpdatePath = result.path;
      updateDownloadBtn.textContent = 'İndirildi';
      if (updateDownloadStatus) updateDownloadStatus.textContent = `${result.filename} İndirilenler klasörüne kaydedildi. Kurulumu sen başlatabilirsin.`;
      if (updateRevealBtn) updateRevealBtn.style.display = 'block';
    } catch (error) {
      updateDownloadBtn.disabled = false;
      updateDownloadBtn.textContent = 'Yeniden dene';
      if (updateDownloadStatus) updateDownloadStatus.textContent = error?.message || 'İndirme başarısız oldu. İnternet bağlantısını kontrol et.';
    }
  });
  updateRevealBtn?.addEventListener('click', () => { if (downloadedUpdatePath) window.phoneLink?.revealDownloadedFile(downloadedUpdatePath); });
  window.phoneLink?.onDownloadProgress(progress => {
    if (updateDownloadStatus && !downloadedUpdatePath) updateDownloadStatus.textContent = progress.percent == null
      ? `İndiriliyor: ${(progress.received / 1024 / 1024).toFixed(1)} MB`
      : `İndiriliyor: %${progress.percent}`;
  });

  checkAppUpdate(false);
  setInterval(() => checkAppUpdate(false), 10 * 60 * 1000);

  // --- Native Windows Window Controls (Electron) ---
  try {
    if (window.phoneLink) {
      document.getElementById('winMinBtn')?.addEventListener('click', () => window.phoneLink.minimize());
      document.getElementById('winMaxBtn')?.addEventListener('click', () => window.phoneLink.toggleMaximize());
      document.getElementById('winCloseBtn')?.addEventListener('click', () => window.phoneLink.close());
    }
  } catch(e) {}
});
