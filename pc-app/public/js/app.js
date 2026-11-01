document.addEventListener('DOMContentLoaded', () => {
  let currentTab = 'messages';
  let deviceState = { connected: false };
  let messages = [];
  let contacts = [];
  let messageSyncStatus = { state: 'idle', message: 'Telefon bağlanınca mesajlar eşitlenir.', count: 0, lastSyncedAt: null };
  let contactsSyncStatus = { state: 'idle', message: 'Telefon bağlanınca kişi listesi eşitlenir.', count: 0 };
  let activeThreadPhone = null;
  let activeThreadLabel = null;
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
  const newMessageButton = document.getElementById('newMessageBtn');
  const newMessageScreen = document.getElementById('view-new-message');
  const recipientInput = document.getElementById('recipientInput');
  const recipientError = document.getElementById('recipientError');
  const contactsList = document.getElementById('newMessageContacts');
  const contactsSyncText = document.getElementById('contactsSyncText');
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
        contacts = Array.isArray(payload?.contacts) ? payload.contacts : [];
        messageSyncStatus = payload?.messageSyncStatus || messageSyncStatus;
        contactsSyncStatus = payload?.contactsSyncStatus || contactsSyncStatus;
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
        if (activeThreadPhone && !activeThreadLabel && !messages.some(message => getThreadPhone(message) === activeThreadPhone)) activeThreadPhone = null;
        messageSyncStatus = { ...messageSyncStatus, count: messages.length };
        renderAll();
        break;
      case 'CONTACTS_UPDATED':
        contacts = Array.isArray(payload) ? payload : [];
        contactsSyncStatus = { state: 'synced', count: contacts.length, message: `${contacts.length} kişi hazır.` };
        renderContactPicker();
        break;
      case 'CONTACTS_SYNC_STATUS':
        contactsSyncStatus = payload || contactsSyncStatus;
        renderContactPicker();
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
    renderContactPicker();
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
    const composerOpen = Boolean(newMessageScreen?.classList.contains('active'));
    if (!tabPositions[targetTab] || (currentTab === targetTab && !composerOpen)) return;
    const currentIndex = tabPositions[currentTab]?.index ?? 0;
    const nextIndex = tabPositions[targetTab].index;
    dockItems.forEach(item => item.classList.toggle('active', item.dataset.tab === targetTab));
    if (dockPill) dockPill.style.left = `${tabPositions[targetTab].offset}px`;
    viewSlides.forEach(slide => {
      const active = slide.id === `view-${targetTab}`;
      slide.classList.toggle('active', active);
      slide.classList.toggle('slide-left', !active && nextIndex > currentIndex);
      slide.setAttribute('aria-hidden', String(!active));
    });
    currentTab = targetTab;
  }
  dockItems.forEach(item => item.addEventListener('click', () => switchTab(item.dataset.tab)));
  if (dockPill) dockPill.style.left = '10px';

  function getThreadPhone(message) {
    const raw = String(message.phone || message.sender || '').trim();
    const contact = findContact(raw);
    return normalizePhoneNumber(contact?.phone) || normalizePhoneNumber(raw) || raw;
  }

  function normalizePhoneNumber(value) {
    const raw = String(value ?? '').trim();
    if (!raw || !/[0-9]/.test(raw) || !/^[\d+\s().-]+$/.test(raw)) return '';
    const digits = raw.replace(/\D/g, '');
    return raw.startsWith('+') ? `+${digits}` : digits;
  }

  function findContact(phone) {
    const normalized = normalizePhoneNumber(phone);
    if (!normalized) return null;
    const digits = normalized.replace(/\D/g, '');
    return contacts.find(contact => {
      const contactPhone = normalizePhoneNumber(contact.phone);
      if (!contactPhone) return false;
      if (contactPhone === normalized) return true;
      const contactDigits = contactPhone.replace(/\D/g, '');
      return digits.length >= 10 && contactDigits.length >= 10 && digits.slice(-10) === contactDigits.slice(-10);
    }) || null;
  }

  function openNewMessageScreen() {
    if (recipientInput) recipientInput.value = '';
    if (recipientError) recipientError.textContent = '';
    viewSlides.forEach(slide => {
      const active = slide === newMessageScreen;
      slide.classList.toggle('active', active);
      slide.setAttribute('aria-hidden', String(!active));
    });
    renderContactPicker();
    recipientInput?.focus();
  }

  function startConversation(phoneValue, contactName = '') {
    const phone = normalizePhoneNumber(phoneValue);
    const digitCount = phone.replace(/\D/g, '').length;
    if (digitCount < 5 || digitCount > 20) {
      if (recipientError) recipientError.textContent = 'Geçerli bir telefon numarası yaz.';
      return;
    }
    if (recipientError) recipientError.textContent = '';
    const contact = findContact(phone);
    activeThreadPhone = normalizePhoneNumber(contact?.phone) || phone;
    activeThreadLabel = contactName || contact?.name || phone;
    switchTab('messages');
    renderMessages();
    smsInput?.focus();
  }

  function renderContactPicker() {
    if (!contactsList) return;
    contactsList.replaceChildren();
    const query = recipientInput?.value.trim() || '';
    const normalizedQuery = normalizePhoneNumber(query);
    const queryName = query.toLocaleLowerCase('tr-TR');
    const collator = new Intl.Collator('tr', { sensitivity: 'base', numeric: true });
    const filtered = contacts
      .filter(contact => {
        if (!query) return true;
        const nameMatches = String(contact.name || '').toLocaleLowerCase('tr-TR').includes(queryName);
        const contactPhone = normalizePhoneNumber(contact.phone);
        const matchedContact = findContact(query);
        const phoneMatches = Boolean(normalizedQuery && (contactPhone.includes(normalizedQuery) ||
          (matchedContact && normalizePhoneNumber(matchedContact.phone) === contactPhone)));
        return nameMatches || phoneMatches;
      })
      .sort((left, right) => collator.compare(String(left.name || ''), String(right.name || '')) || String(left.phone || '').localeCompare(String(right.phone || '')));

    if (contactsSyncText) {
      if (contactsSyncStatus.state === 'error') contactsSyncText.textContent = contactsSyncStatus.message || 'Rehber iznini kontrol et.';
      else if (contactsSyncStatus.state === 'syncing') contactsSyncText.textContent = 'Telefon rehberi eşitleniyor…';
      else if (contacts.length) contactsSyncText.textContent = `${contacts.length} kişi · A–Z`;
      else if (!deviceState.connected) contactsSyncText.textContent = 'Telefon bağlanınca kişi listesi gelir.';
      else contactsSyncText.textContent = contactsSyncStatus.message || 'Numaralı kişi bulunamadı.';
    }

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'contacts-picker-empty';
      empty.textContent = query && contacts.length ? 'Aramana uygun kişi bulunamadı.'
        : contactsSyncStatus.state === 'error' ? (contactsSyncStatus.message || 'Kişiler okunamadı.')
          : 'Kişi listesi telefon bağlanınca burada görünür.';
      contactsList.appendChild(empty);
      return;
    }

    filtered.forEach(contact => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'contact-picker-item';
      button.setAttribute('role', 'listitem');
      const avatar = document.createElement('span');
      avatar.className = 'contact-picker-avatar';
      avatar.textContent = String(contact.name || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toLocaleUpperCase('tr-TR');
      const copy = document.createElement('span');
      copy.className = 'contact-picker-copy';
      const name = document.createElement('strong');
      name.textContent = contact.name || 'İsimsiz kişi';
      const phone = document.createElement('small');
      phone.textContent = contact.phone || '';
      copy.append(name, phone);
      const arrow = document.createElement('span');
      arrow.className = 'contact-picker-arrow';
      arrow.textContent = '›';
      button.append(avatar, copy, arrow);
      button.addEventListener('click', () => startConversation(contact.phone, contact.name));
      contactsList.appendChild(button);
    });
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

    if (!activeThreadPhone || (!threads.has(activeThreadPhone) && !activeThreadLabel)) activeThreadPhone = threads.keys().next().value || null;
    if (activeThreadPhone && !threads.has(activeThreadPhone)) threads.set(activeThreadPhone, []);
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
      const latest = thread[0] || null;
      const contact = findContact(phone);
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `thread-item ${phone === activeThreadPhone ? 'active' : ''}`;
      item.innerHTML = `
        <div class="thread-header">
          <span class="thread-sender">${escapeHtml(contact?.name || (latest && !latest.isOutgoing ? latest.sender : null) || phone)}</span>
          <span class="thread-time">${escapeHtml(latest?.timestamp || '')}</span>
        </div>
        <div class="thread-preview">${escapeHtml(latest?.text || 'Henüz mesaj yok')}</div>
      `;
      item.addEventListener('click', () => {
        activeThreadPhone = phone;
        activeThreadLabel = null;
        renderMessages();
      });
      threadsList.appendChild(item);
    });

    const activeMessages = threads.get(activeThreadPhone) || [];
    activeChatTitle.textContent = findContact(activeThreadPhone)?.name || activeMessages.find(message => !message.isOutgoing)?.sender || activeThreadLabel || activeThreadPhone;
    chatStream.replaceChildren();
    if (!activeMessages.length) {
      const empty = document.createElement('div');
      empty.className = 'messages-empty';
      empty.textContent = 'Bu sohbette henüz mesaj yok. İlk mesajını aşağıdan yaz.';
      chatStream.appendChild(empty);
    }
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
  newMessageButton?.addEventListener('click', openNewMessageScreen);
  document.getElementById('backToMessagesBtn')?.addEventListener('click', () => switchTab('messages'));
  document.getElementById('openRecipientChatBtn')?.addEventListener('click', () => startConversation(recipientInput?.value));
  recipientInput?.addEventListener('input', renderContactPicker);
  recipientInput?.addEventListener('keydown', event => {
    if (event.key === 'Enter') startConversation(recipientInput.value);
  });
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
