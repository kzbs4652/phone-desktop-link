document.addEventListener('DOMContentLoaded', () => {
  let currentTab = 'messages';
  let deviceState = { connected: false };
  let messages = [];
  let messageSyncStatus = { state: 'idle', message: 'Telefon bağlanınca mesajlar eşitlenir.', count: 0, lastSyncedAt: null };
  let activeThreadPhone = null;
  let socket = null;
  let latestPcVersion = null;
  let lastNotifiedUpdateVersion = null;
  let deferredUpdateVersion = null;

  const dockPill = document.getElementById('dockPill');
  const dockItems = [...document.querySelectorAll('.dock-item')];
  const viewSlides = [...document.querySelectorAll('.view-slide')];
  const threadsList = document.getElementById('threadsList');
  const chatStream = document.getElementById('chatStream');
  const activeChatTitle = document.getElementById('activeChatTitle');
  const smsInput = document.getElementById('smsInput');
  const messageStatus = document.getElementById('messageSyncStatus');
  const syncMessagesButton = document.getElementById('syncMessagesBtn');
  const sendSmsButton = document.getElementById('sendSmsBtn');
  const toast = document.getElementById('toastNotice');
  const toastText = document.getElementById('toastText');

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/client`;

  function connectSocket() {
    socket = new WebSocket(wsUrl);
    socket.onopen = refreshPairingInfo;
    socket.onmessage = event => {
      try {
        const { action, payload } = JSON.parse(event.data);
        handleServerEvent(action, payload);
      } catch (error) {
        console.error('PhoneLink mesajı okunamadı:', error);
      }
    };
    socket.onclose = () => setTimeout(connectSocket, 2000);
  }

  function sendToServer(action, payload = {}) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ action, payload }));
    else showToast('Bilgisayar hizmeti yeniden bağlanıyor. Birazdan tekrar dene.');
  }

  function handleServerEvent(action, payload) {
    switch (action) {
      case 'INIT_STATE':
        deviceState = payload?.deviceState || { connected: false };
        messages = Array.isArray(payload?.messages) ? payload.messages : [];
        messageSyncStatus = payload?.messageSyncStatus || messageSyncStatus;
        renderAll();
        break;
      case 'NEW_SMS':
        if (payload && !messages.some(message => message.id === payload.id)) messages.unshift(payload);
        messageSyncStatus = { ...messageSyncStatus, count: messages.length };
        renderAll();
        showToast(`Yeni SMS: ${payload?.sender || payload?.phone || 'Bilinmeyen numara'}`);
        if (payload?.code) showToast(`Doğrulama kodu: ${payload.code}`);
        break;
      case 'MESSAGES_UPDATED':
        messages = Array.isArray(payload) ? payload : [];
        if (activeThreadPhone && !messages.some(message => (message.phone || message.sender) === activeThreadPhone)) activeThreadPhone = null;
        messageSyncStatus = { ...messageSyncStatus, count: messages.length };
        renderAll();
        break;
      case 'MESSAGES_SYNC_STATUS':
        messageSyncStatus = payload || messageSyncStatus;
        renderAll();
        break;
      case 'APP_ERROR':
        showToast(payload?.message || 'İşlem tamamlanamadı.');
        break;
      case 'DEVICE_STATUS_UPDATED':
      case 'PHONE_CONNECTION_CHANGED':
        deviceState = { ...deviceState, ...payload };
        renderDeviceStatus();
        renderMessageSyncStatus();
        refreshPairingInfo();
        break;
    }
  }

  function renderAll() {
    renderDeviceStatus();
    renderMessageSyncStatus();
    renderMessages();
  }

  function showToast(message) {
    if (!toast || !toastText) return;
    toastText.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 4500);
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
        const pairingQr = document.getElementById('pairingQr');
        const pairingCodeLabel = document.getElementById('pairingCodeLabel');
        const pairingButton = document.getElementById('btnOpenPairing');

        if (pairingCode) pairingCode.textContent = info.pairingCode || (info.paired ? 'EŞLEŞTİ' : '------');
        if (pairingCodeLabel) pairingCodeLabel.textContent = info.pairingOpen ? 'Telefondaki uygulamayla tara' : 'Eşleştirme durumu';
        if (pairingButton) pairingButton.textContent = info.pairingOpen ? 'Eşleştirme açık' : (info.paired ? 'Başka telefon eşleştir' : 'Eşleştirme kodu göster');
        if (pairingQr) {
          pairingQr.style.display = info.pairingOpen ? 'block' : 'none';
          if (info.pairingOpen) {
            fetch('/api/pairing-qr', { cache: 'no-store' })
              .then(response => response.ok ? response.json() : null)
              .then(qr => { if (qr?.dataUrl) pairingQr.src = qr.dataUrl; })
              .catch(() => {});
          }
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
              ? 'Eşleştirme kayıtlı. Telefon aynı Wi-Fi ağına geldiğinde otomatik bağlanır.'
              : 'İlk kurulum için Android uygulamasıyla eşleştirme kodunu tara.';
        }
      })
      .catch(() => {});
  }

  const tabPositions = { messages: { index: 0, offset: 10 }, status: { index: 1, offset: 108 } };
  function switchTab(targetTab) {
    if (!tabPositions[targetTab] || currentTab === targetTab) return;
    const currentIndex = tabPositions[currentTab]?.index ?? 0;
    const nextIndex = tabPositions[targetTab].index;
    dockItems.forEach(item => item.classList.toggle('active', item.dataset.tab === targetTab));
    if (dockPill) dockPill.style.left = `${tabPositions[targetTab].offset}px`;
    viewSlides.forEach(slide => {
      const active = slide.id === `view-${targetTab}`;
      slide.classList.toggle('active', active);
      slide.classList.toggle('slide-left', !active && nextIndex > currentIndex);
    });
    currentTab = targetTab;
  }
  dockItems.forEach(item => item.addEventListener('click', () => switchTab(item.dataset.tab)));
  if (dockPill) dockPill.style.left = '10px';

  function getThreadPhone(message) {
    return String(message.phone || message.sender || '');
  }

  function renderMessages() {
    if (!threadsList || !chatStream || !activeChatTitle) return;
    threadsList.replaceChildren();
    const threads = new Map();
    messages.forEach(message => {
      const phone = getThreadPhone(message);
      if (!phone) return;
      if (!threads.has(phone)) threads.set(phone, []);
      threads.get(phone).push(message);
    });

    if (!activeThreadPhone || !threads.has(activeThreadPhone)) activeThreadPhone = threads.keys().next().value || null;
    if (threads.size === 0) {
      const text = messageSyncStatus.state === 'error'
        ? messageSyncStatus.message || 'SMS eşitlemesi tamamlanamadı.'
        : messageSyncStatus.state === 'syncing'
          ? 'SMS’ler telefondan eşitleniyor…'
          : deviceState.connected ? 'Telefonda mesaj bulunamadı.' : 'Mesajları görmek için telefonunu bağla.';
      threadsList.innerHTML = `<div class="messages-empty">${escapeHtml(text)}</div>`;
      chatStream.innerHTML = `<div class="messages-empty">${escapeHtml(text)}</div>`;
      activeChatTitle.textContent = 'Mesajlar';
      updateMessageActions();
      return;
    }

    threads.forEach((thread, phone) => {
      const latest = thread[0];
      const item = document.createElement('button');
      item.type = 'button';
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

    const activeMessages = threads.get(activeThreadPhone) || [];
    activeChatTitle.textContent = activeMessages.find(message => !message.isOutgoing)?.sender || activeThreadPhone;
    chatStream.replaceChildren();
    [...activeMessages].reverse().forEach(message => {
      const bubble = document.createElement('div');
      bubble.className = `sms-bubble ${message.isOutgoing ? 'outgoing' : 'incoming'}`;
      let content = `<div>${escapeHtml(message.text)}</div>`;
      if (message.code) {
        content += `<div class="code-badge-box"><span class="code-value">${escapeHtml(message.code)}</span><button class="copy-code-btn" data-code="${escapeHtml(message.code)}">Kodu Kopyala 📋</button></div>`;
      }
      bubble.innerHTML = content;
      bubble.querySelector('.copy-code-btn')?.addEventListener('click', event => {
        event.stopPropagation();
        navigator.clipboard.writeText(event.currentTarget.dataset.code)
          .then(() => showToast('Kod kopyalandı.'))
          .catch(() => showToast('Kod kopyalanamadı.'));
      });
      chatStream.appendChild(bubble);
    });
    updateMessageActions();
  }

  function renderMessageSyncStatus() {
    if (!messageStatus) return;
    const count = Number(messageSyncStatus.count ?? messages.length);
    const state = messageSyncStatus.state || 'idle';
    const labels = {
      idle: messageSyncStatus.message || 'Telefon bağlanınca mesajlar eşitlenir.',
      cached: `${count} mesaj bu bilgisayarda kayıtlı${deviceState.connected ? '' : ' · telefon bağlı değil'}`,
      syncing: messageSyncStatus.message || 'SMS’ler telefondan okunuyor…',
      synced: messageSyncStatus.lastSyncedAt
        ? `${count} mesaj eşitlendi · ${new Date(messageSyncStatus.lastSyncedAt).toLocaleString('tr-TR')}`
        : messageSyncStatus.message || `${count} mesaj eşitlendi.`,
      interrupted: messageSyncStatus.message || 'Eşitleme kesildi; kayıtlı mesajlar korundu.',
      error: messageSyncStatus.message || 'SMS eşitlemesi tamamlanamadı.',
      storage_error: messageSyncStatus.message || 'Mesajlar bu bilgisayara kaydedilemedi.'
    };
    messageStatus.textContent = labels[state] || messageSyncStatus.message || `${count} mesaj`;
    messageStatus.dataset.state = state;
    if (syncMessagesButton) syncMessagesButton.disabled = !deviceState.connected || state === 'syncing';
  }

  function updateMessageActions() {
    if (smsInput) smsInput.disabled = !deviceState.connected || !activeThreadPhone;
    if (sendSmsButton) sendSmsButton.disabled = !deviceState.connected || !activeThreadPhone;
  }

  function sendCurrentSms() {
    const text = smsInput?.value.trim();
    if (!text) return;
    if (!deviceState.connected) {
      showToast('Önce telefonu PhoneLink’e bağla.');
      return;
    }
    if (!activeThreadPhone) {
      showToast('Önce mesaj göndereceğin konuşmayı seç.');
      return;
    }
    sendToServer('SEND_SMS', { phone: activeThreadPhone, text });
    smsInput.value = '';
  }
  syncMessagesButton?.addEventListener('click', () => sendToServer('REQ_SYNC_ALL'));
  sendSmsButton?.addEventListener('click', sendCurrentSms);
  smsInput?.addEventListener('keydown', event => {
    if (event.key === 'Enter') sendCurrentSms();
  });

  function renderDeviceStatus() {
    const connected = Boolean(deviceState.connected);
    const statusText = document.getElementById('deviceStatusText');
    const batteryFill = document.getElementById('batteryFill');
    const batteryPercent = document.getElementById('batteryPercent');
    const statusDeviceName = document.getElementById('statusDeviceName');
    const statusConnectionState = document.getElementById('statusConnectionState');
    const statusBattery = document.getElementById('statusBattery');
    const statusPill = document.querySelector('.header-status-pill');

    if (statusText) statusText.textContent = connected ? `${deviceState.deviceName || 'Telefon'} bağlı` : 'Telefon bağlı değil';
    statusPill?.classList.toggle('connected', connected);
    const batteryLevel = Number(deviceState.batteryLevel);
    if (batteryPercent) batteryPercent.textContent = connected && batteryLevel >= 0 ? `%${batteryLevel}` : '—';
    if (batteryFill) batteryFill.style.width = connected && batteryLevel >= 0 ? `${batteryLevel}%` : '0%';
    if (statusDeviceName) statusDeviceName.textContent = connected ? (deviceState.deviceName || 'Telefon') : 'Henüz bağlanmadı';
    if (statusConnectionState) {
      statusConnectionState.textContent = connected ? '🟢 Bağlı' : 'Bağlantı bekleniyor';
      statusConnectionState.style.color = connected ? 'var(--ios-green)' : 'var(--ios-yellow)';
    }
    if (statusBattery) statusBattery.textContent = connected && batteryLevel >= 0
      ? `%${batteryLevel}${deviceState.isCharging ? ' (Şarj oluyor)' : ''}` : '—';
  }

  document.getElementById('btnOpenPairing')?.addEventListener('click', async () => {
    try {
      if (window.phoneLink?.openPairingWindow) await window.phoneLink.openPairingWindow();
      else {
        const response = await fetch('/api/open-pairing', { method: 'POST' });
        if (!response.ok) throw new Error('Eşleştirme açılamadı');
      }
      refreshPairingInfo();
      showToast('5 dakikalık eşleştirme açıldı.');
    } catch (_) {
      showToast('Eşleştirme açılamadı. Uygulamayı yeniden başlatıp dene.');
    }
  });

  const updateDialog = document.getElementById('updateDialog');
  const updateDialogVersion = document.getElementById('updateDialogVersion');
  const updateDialogNotes = document.getElementById('updateDialogNotes');
  const updateDownloadStatus = document.getElementById('updateDownloadStatus');
  const updateDownloadButton = document.getElementById('updateDownloadBtn');
  const updateProgressBar = document.getElementById('updateProgressBar');
  const updatePill = document.getElementById('pcUpdatePill');
  const updatePillVersion = document.getElementById('pcUpdateVer');
  const updateManualButton = document.getElementById('btnCheckUpdateManual');
  const updateStatus = document.getElementById('pcUpdateStatusMsg');

  function closeUpdateDialog(defer = false) {
    if (defer && updateDialogVersion?.dataset.version) deferredUpdateVersion = updateDialogVersion.dataset.version;
    if (updateDialog) updateDialog.style.display = 'none';
  }

  function showUpdateDialog(version, notes) {
    if (updateDialogVersion) {
      updateDialogVersion.textContent = `Yeni sürüm v${version}`;
      updateDialogVersion.dataset.version = version;
    }
    if (updateDialogNotes) updateDialogNotes.textContent = notes || 'İndirme tamamlanınca PhoneLink kapanıp kurulumu başlatacak ve yeniden açılacak.';
    if (updateDownloadStatus) updateDownloadStatus.textContent = 'İndirme tamamlandığında uygulama otomatik güncellenip yeniden açılır.';
    if (updateProgressBar) updateProgressBar.style.width = '0%';
    if (updateDownloadButton) {
      updateDownloadButton.disabled = false;
      updateDownloadButton.textContent = 'Şimdi indir';
    }
    if (updateDialog) updateDialog.style.display = 'flex';
  }

  function checkAppUpdate(manual = false) {
    if (updateStatus && manual) updateStatus.textContent = 'Güncellemeler denetleniyor…';
    fetch('/api/check-update', { cache: 'no-store' })
      .then(response => response.json())
      .then(data => {
        if (!data || data.error) throw new Error('Güncelleme denetlenemedi.');
        if (data.hasUpdate) {
          latestPcVersion = data.latestVersion;
          if (updatePill) updatePill.style.display = 'flex';
          if (updatePillVersion) updatePillVersion.textContent = `v${data.latestVersion}`;
          if (updateStatus) updateStatus.textContent = `Yeni sürüm mevcut: v${data.latestVersion}`;
          if (manual || (lastNotifiedUpdateVersion !== data.latestVersion && deferredUpdateVersion !== data.latestVersion)) {
            lastNotifiedUpdateVersion = data.latestVersion;
            showUpdateDialog(data.latestVersion, data.notes);
          }
        } else {
          if (updatePill) updatePill.style.display = 'none';
          if (updateStatus) updateStatus.textContent = `Yazılım güncel (v${data.currentVersion})`;
          if (manual) showToast('KZBS PhoneLink güncel.');
        }
      })
      .catch(() => {
        if (updateStatus && manual) updateStatus.textContent = 'Güncelleme denetlenemedi.';
      });
  }

  updateManualButton?.addEventListener('click', () => checkAppUpdate(true));
  updatePill?.addEventListener('click', () => {
    if (latestPcVersion) showUpdateDialog(latestPcVersion, updateDialogNotes?.textContent);
  });
  document.getElementById('updateLaterBtn')?.addEventListener('click', () => closeUpdateDialog(true));
  document.getElementById('updateDialogClose')?.addEventListener('click', () => closeUpdateDialog(true));

  updateDownloadButton?.addEventListener('click', async () => {
    if (!window.phoneLink?.startUpdateInstall) {
      showToast('Uygulama içi güncelleme yalnızca Windows uygulamasında kullanılabilir.');
      return;
    }
    updateDownloadButton.disabled = true;
    updateDownloadButton.textContent = 'İndiriliyor…';
    if (updateDownloadStatus) updateDownloadStatus.textContent = 'Güncelleme sunucudan alınıyor…';
    try {
      await window.phoneLink.startUpdateInstall();
    } catch (error) {
      updateDownloadButton.disabled = false;
      updateDownloadButton.textContent = 'Yeniden dene';
      if (updateDownloadStatus) updateDownloadStatus.textContent = error?.message || 'Güncelleme indirilemedi.';
    }
  });

  window.phoneLink?.onUpdateInstallState(update => {
    if (update.state === 'downloading') {
      const percent = Math.max(0, Math.min(100, Number(update.percent) || 0));
      if (updateProgressBar) updateProgressBar.style.width = `${percent}%`;
      if (updateDownloadStatus) updateDownloadStatus.textContent = `Güncelleme indiriliyor: %${percent}`;
      if (updateDownloadButton) {
        updateDownloadButton.disabled = true;
        updateDownloadButton.textContent = 'İndiriliyor…';
      }
    } else if (update.state === 'installing') {
      if (updateProgressBar) updateProgressBar.style.width = '100%';
      if (updateDownloadStatus) updateDownloadStatus.textContent = 'İndirme tamamlandı. Uygulama kapanıp güncellenecek ve yeniden açılacak…';
      if (updateDownloadButton) updateDownloadButton.textContent = 'Kuruluyor…';
    } else if (update.state === 'error') {
      if (updateDownloadButton) {
        updateDownloadButton.disabled = false;
        updateDownloadButton.textContent = 'Yeniden dene';
      }
      if (updateDownloadStatus) updateDownloadStatus.textContent = update.message || 'Güncelleme indirilemedi.';
    }
  });

  document.getElementById('winMinBtn')?.addEventListener('click', () => window.phoneLink?.minimize());
  document.getElementById('winMaxBtn')?.addEventListener('click', () => window.phoneLink?.toggleMaximize());
  document.getElementById('winCloseBtn')?.addEventListener('click', () => window.phoneLink?.close());

  connectSocket();
  renderAll();
  refreshPairingInfo();
  checkAppUpdate(false);
  setInterval(() => checkAppUpdate(false), 10 * 60 * 1000);
});