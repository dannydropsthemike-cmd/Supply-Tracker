/* ============================================================
   Filament Tracker — app.js
   Offline PWA · IndexedDB · QR · iOS Push Notifications
   ============================================================ */

'use strict';

// ── Service Worker ──────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(r => console.log('[SW] Registered:', r.scope))
      .catch(e => console.warn('[SW] Failed:', e));
  });
}

// ════════════════════════════════════════════════════════════
// DATABASE — IndexedDB
// ════════════════════════════════════════════════════════════

const DB_NAME    = 'FilamentTracker';
const DB_VERSION = 1;
const STORE      = 'filaments';
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE)) {
        d.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror   = (e) => reject(e.target.error);
  });
}

function getAllFilaments() {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function getFilament(id) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function saveFilament(f) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(f);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function deleteFilament(id) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

function generateId() {
  return 'fil_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

// ════════════════════════════════════════════════════════════
// iOS PUSH NOTIFICATIONS
// ════════════════════════════════════════════════════════════

/**
 * iOS Safari supports the Web Notifications API from iOS 16.4+
 * when the app is installed as a PWA (Add to Home Screen).
 * We request permission and then use it for low-stock alerts.
 */

let notifPermission = 'default'; // 'default' | 'granted' | 'denied'

function isNotificationSupported() {
  return 'Notification' in window;
}

/** Check current permission state and update the banner UI */
function syncNotifState() {
  if (!isNotificationSupported()) return;
  notifPermission = Notification.permission;
  const banner = document.getElementById('notif-banner');
  if (banner) {
    // Show banner only if not yet decided
    banner.style.display = notifPermission === 'default' ? 'flex' : 'none';
  }
}

/** Request notification permission (must be triggered by user gesture) */
async function requestNotifPermission() {
  if (!isNotificationSupported()) {
    showToast('Not Supported', 'Notifications require iOS 16.4+ with the app added to your Home Screen.', 'info');
    return;
  }
  try {
    const result = await Notification.requestPermission();
    notifPermission = result;
    syncNotifState();
    if (result === 'granted') {
      showToast('Notifications On', 'You\'ll be alerted when filament runs low.', 'success');
      // Send a confirmation notification
      sendNotification('Filament Tracker', 'Low-stock alerts are now enabled! 🧵', null);
    } else {
      showToast('Permission Denied', 'You can enable notifications in your iOS Settings anytime.', 'warn');
    }
  } catch (e) {
    console.warn('[Notif] Request failed:', e);
    showToast('Not Available', 'Add this app to your Home Screen first to enable notifications.', 'info');
  }
}

/**
 * Send a native notification.
 * Falls back to an in-app toast if notifications aren't available/granted.
 * @param {string} title
 * @param {string} body
 * @param {string|null} url  - URL to open on tap (buy link)
 */
function sendNotification(title, body, url = null) {
  if (notifPermission === 'granted' && isNotificationSupported()) {
    try {
      const n = new Notification(title, {
        body,
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        tag:   'filament-alert',    // replaces previous same-tag notif
        renotify: true,
        data: { url },
      });
      if (url) {
        n.onclick = () => { window.open(url, '_blank'); n.close(); };
      }
    } catch (e) {
      console.warn('[Notif] Send failed:', e);
    }
  }
}

// Wire up the notification banner button
document.getElementById('notif-banner').addEventListener('click', requestNotifPermission);

// ════════════════════════════════════════════════════════════
// TOAST SYSTEM (in-app)
// ════════════════════════════════════════════════════════════

const toastContainer = document.getElementById('toast-container');

function showToast(title, message, type = 'info', action = null, onAction = null) {
  const icons = { warn: '⚠️', error: '🚨', success: '✅', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || 'ℹ️'}</div>
    <div class="toast-body">
      <div class="toast-title">${escapeHtml(title)}</div>
      <div class="toast-msg">${escapeHtml(message)}</div>
      ${action ? `<div class="toast-action">${escapeHtml(action)} →</div>` : ''}
    </div>`;

  if (action && onAction) {
    toast.querySelector('.toast-action').addEventListener('click', () => {
      onAction(); removeToast(toast);
    });
  }
  toast.addEventListener('click', () => removeToast(toast));
  toastContainer.appendChild(toast);
  setTimeout(() => removeToast(toast), type === 'warn' || type === 'error' ? 6000 : 4000);
}

function removeToast(toast) {
  if (!toast.parentNode) return;
  toast.classList.add('removing');
  setTimeout(() => toast.parentNode && toast.parentNode.removeChild(toast), 300);
}

// ════════════════════════════════════════════════════════════
// APP STATE
// ════════════════════════════════════════════════════════════

let allFilaments   = [];
let activeFilter   = 'all';
let searchQuery    = '';
let editingId      = null;
let scanFilament   = null;
let scanQtyValue   = 0;
let qrScanner      = null;
let qrDisplayId    = null;
let scannerStarted = false;

// ════════════════════════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════════════════════════

document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => switchView(tab.dataset.view));
});

function switchView(viewId) {
  document.querySelectorAll('.nav-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.view === viewId));
  document.querySelectorAll('.view').forEach(v =>
    v.classList.toggle('active', v.id === `view-${viewId}`));

  if (viewId === 'scan') startScanner();
  else stopScanner();
}

// ════════════════════════════════════════════════════════════
// INVENTORY RENDERING
// ════════════════════════════════════════════════════════════

async function renderInventory() {
  allFilaments = await getAllFilaments();
  updateStats();
  updateFilterChips();

  const list = document.getElementById('filament-list');
  let filtered = allFilaments;

  if (activeFilter !== 'all') {
    filtered = filtered.filter(f => f.material === activeFilter);
  }
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(f =>
      f.name.toLowerCase().includes(q) ||
      (f.brand || '').toLowerCase().includes(q) ||
      f.material.toLowerCase().includes(q) ||
      (f.colorName || '').toLowerCase().includes(q)
    );
  }

  // Sort: out first, then low, then alpha
  filtered.sort((a, b) => {
    const sa = a.qty <= 0 ? 2 : a.qty <= a.minStock ? 1 : 0;
    const sb = b.qty <= 0 ? 2 : b.qty <= b.minStock ? 1 : 0;
    if (sa !== sb) return sb - sa;
    return a.name.localeCompare(b.name);
  });

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${searchQuery ? '🔍' : '🧵'}</div>
        <div class="empty-title">${searchQuery ? 'No Results' : 'No Filaments Yet'}</div>
        <div class="empty-sub">${searchQuery
          ? 'No filaments match your search.'
          : 'Tap <strong>＋</strong> to add your first filament.'}</div>
      </div>`;
    return;
  }

  list.innerHTML = filtered.map(renderCard).join('');
  attachCardListeners();
}

function renderCard(f) {
  const isLow  = f.qty > 0 && f.qty <= f.minStock;
  const isOut  = f.qty <= 0;
  const pct    = f.minStock > 0 ? Math.min(100, Math.round((f.qty / (f.minStock * 3)) * 100)) : 100;
  const barCls = isOut ? 'danger' : isLow ? 'warn' : '';
  const matCls = getMaterialClass(f.material);
  const badge  = isOut  ? `<div class="out-badge">Out</div>`
               : isLow  ? `<div class="low-badge">Low</div>` : '';

  return `
    <div class="filament-card ${isLow ? 'low-stock' : ''} ${isOut ? 'out-of-stock' : ''}" data-id="${f.id}">
      ${badge}
      <div class="card-header">
        <div class="color-swatch" style="background-color:${escapeHtml(f.colorHex || '#9B6B5A')}"></div>
        <div class="card-info">
          <div class="card-name">${escapeHtml(f.name)}</div>
          <div class="card-meta">
            ${escapeHtml(f.brand || '—')}
            <span class="material-badge ${matCls}">${escapeHtml(f.material)}</span>
          </div>
        </div>
        <div>
          <div class="card-qty">${f.qty}</div>
          <div class="card-qty-label">spools</div>
        </div>
      </div>
      <div class="stock-bar-wrap">
        <div class="stock-bar">
          <div class="stock-bar-fill ${barCls}" style="width:${pct}%"></div>
        </div>
        <div class="stock-pct">${pct}%</div>
      </div>
      <!-- inline quick-adjust row -->
      <div class="inline-qty-row" id="inline-${f.id}" style="display:none">
        <div class="inline-qty-btns">
          <button class="inline-btn" data-action="inline-minus" data-id="${f.id}">−</button>
          <div class="inline-qty-val" id="inline-val-${f.id}">${f.qty}</div>
          <button class="inline-btn" data-action="inline-plus" data-id="${f.id}">＋</button>
        </div>
        <button class="inline-save-btn" data-action="inline-save" data-id="${f.id}">✓ Save</button>
      </div>
      <div class="card-actions">
        <button class="card-action-btn" data-action="adjust" data-id="${f.id}">⚡ Adjust</button>
        <button class="card-action-btn" data-action="qr" data-id="${f.id}">▣ QR</button>
        <button class="card-action-btn" data-action="edit" data-id="${f.id}">✏️ Edit</button>
        <button class="card-action-btn danger" data-action="delete" data-id="${f.id}">🗑</button>
      </div>
    </div>`;
}

function attachCardListeners() {
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const { action, id } = btn.dataset;
      if      (action === 'adjust')       handleInlineAdjust(id);
      else if (action === 'qr')           showQRCode(id);
      else if (action === 'edit')         openEditModal(id);
      else if (action === 'delete')       handleDelete(id);
      else if (action === 'inline-minus') changeInlineQty(id, -1);
      else if (action === 'inline-plus')  changeInlineQty(id,  1);
      else if (action === 'inline-save')  saveInlineQty(id);
    });
  });
}

function updateStats() {
  document.getElementById('stat-total').textContent = allFilaments.length;
  document.getElementById('stat-low').textContent   = allFilaments.filter(f => f.qty <= f.minStock).length;
  document.getElementById('stat-types').textContent = new Set(allFilaments.map(f => f.material)).size;
}

function updateFilterChips() {
  const materials = [...new Set(allFilaments.map(f => f.material))].sort();
  const row = document.getElementById('filter-row');
  row.innerHTML = `<div class="chip ${activeFilter === 'all' ? 'active' : ''}" data-filter="all">All</div>`;
  materials.forEach(m => {
    const c = document.createElement('div');
    c.className = `chip ${activeFilter === m ? 'active' : ''}`;
    c.dataset.filter = m;
    c.textContent = m;
    row.appendChild(c);
  });
  row.querySelectorAll('.chip').forEach(c => {
    c.addEventListener('click', () => { activeFilter = c.dataset.filter; renderInventory(); });
  });
}

// ── Inline Adjust ───────────────────────────────────────────
const inlineState = {};

function handleInlineAdjust(id) {
  const row = document.getElementById(`inline-${id}`);
  if (!row) return;
  const fil = allFilaments.find(f => f.id === id);
  if (!fil) return;
  const open = row.style.display !== 'none';
  document.querySelectorAll('[id^="inline-"]').forEach(r => r.style.display = 'none');
  if (!open) {
    inlineState[id] = fil.qty;
    document.getElementById(`inline-val-${id}`).textContent = fil.qty;
    row.style.display = 'flex';
  }
}

function changeInlineQty(id, delta) {
  if (inlineState[id] === undefined) return;
  inlineState[id] = Math.max(0, inlineState[id] + delta);
  const el = document.getElementById(`inline-val-${id}`);
  if (el) el.textContent = inlineState[id];
}

async function saveInlineQty(id) {
  const newQty = inlineState[id];
  if (newQty === undefined) return;
  const fil = allFilaments.find(f => f.id === id);
  if (!fil) return;
  fil.qty = newQty;
  await saveFilament(fil);
  delete inlineState[id];
  await renderInventory();
  alertIfLowStock(fil);
  showToast('Updated', `${fil.name} → ${newQty} spool${newQty !== 1 ? 's' : ''}`, 'success');
}

// ── Delete ──────────────────────────────────────────────────
async function handleDelete(id) {
  const fil = allFilaments.find(f => f.id === id);
  if (!fil) return;
  if (confirm(`Delete "${fil.name}"? This cannot be undone.`)) {
    await deleteFilament(id);
    await renderInventory();
    showToast('Deleted', `${fil.name} removed.`, 'info');
  }
}

// ════════════════════════════════════════════════════════════
// ADD / EDIT MODAL
// ════════════════════════════════════════════════════════════

const modalAdd = document.getElementById('modal-add');
document.getElementById('btn-add').addEventListener('click', openAddModal);
document.getElementById('modal-add-close').addEventListener('click', closeAddModal);
modalAdd.addEventListener('click', e => { if (e.target === modalAdd) closeAddModal(); });

document.getElementById('f-color-hex').addEventListener('input', (e) => {
  document.getElementById('color-preview-box').style.background = e.target.value;
});

function openAddModal() {
  editingId = null;
  document.getElementById('modal-add-title').textContent = 'Add Filament';
  document.getElementById('form-submit-btn').textContent = 'Add to Vault';
  clearForm();
  modalAdd.classList.add('visible');
}

async function openEditModal(id) {
  const f = await getFilament(id);
  if (!f) return;
  editingId = id;
  document.getElementById('modal-add-title').textContent = 'Edit Filament';
  document.getElementById('form-submit-btn').textContent = 'Save Changes';
  document.getElementById('f-name').value       = f.name       || '';
  document.getElementById('f-brand').value      = f.brand      || '';
  document.getElementById('f-material').value   = f.material   || 'PLA';
  document.getElementById('f-color-name').value = f.colorName  || '';
  document.getElementById('f-color-hex').value  = f.colorHex   || '#9B6B5A';
  document.getElementById('color-preview-box').style.background = f.colorHex || '#9B6B5A';
  document.getElementById('f-qty').value        = f.qty        ?? '';
  document.getElementById('f-min').value        = f.minStock   ?? '';
  document.getElementById('f-link').value       = f.buyLink    || '';
  document.getElementById('f-notes').value      = f.notes      || '';
  modalAdd.classList.add('visible');
}

function closeAddModal() {
  modalAdd.classList.remove('visible');
  editingId = null;
}

function clearForm() {
  ['f-name','f-brand','f-color-name','f-link','f-notes'].forEach(id =>
    document.getElementById(id).value = '');
  document.getElementById('f-material').value  = 'PLA';
  document.getElementById('f-qty').value       = '';
  document.getElementById('f-min').value       = '2';
  document.getElementById('f-color-hex').value = '#9B6B5A';
  document.getElementById('color-preview-box').style.background = '#9B6B5A';
}

document.getElementById('form-submit-btn').addEventListener('click', async () => {
  const name = document.getElementById('f-name').value.trim();
  if (!name) {
    showToast('Required', 'Please enter a name for this filament.', 'error');
    return;
  }

  const filament = {
    id:        editingId || generateId(),
    name,
    brand:     document.getElementById('f-brand').value.trim(),
    material:  document.getElementById('f-material').value,
    colorName: document.getElementById('f-color-name').value.trim(),
    colorHex:  document.getElementById('f-color-hex').value,
    qty:       parseInt(document.getElementById('f-qty').value) || 0,
    minStock:  parseInt(document.getElementById('f-min').value) || 2,
    buyLink:   document.getElementById('f-link').value.trim(),
    notes:     document.getElementById('f-notes').value.trim(),
    updatedAt: Date.now(),
  };

  if (editingId) {
    const existing = await getFilament(editingId);
    filament.createdAt = existing ? existing.createdAt : Date.now();
  } else {
    filament.createdAt = Date.now();
  }

  await saveFilament(filament);
  closeAddModal();
  await renderInventory();
  alertIfLowStock(filament);
  showToast(editingId ? 'Updated' : 'Added',
    `${filament.name} ${editingId ? 'updated' : 'added to the vault'}.`, 'success');
});

// ════════════════════════════════════════════════════════════
// QR CODE GENERATION
// ════════════════════════════════════════════════════════════

const modalQR  = document.getElementById('modal-qr');
const qrCanvas = document.getElementById('qr-display-canvas');

document.getElementById('modal-qr-close').addEventListener('click', closeQRModal);
document.getElementById('qr-done-btn').addEventListener('click', closeQRModal);
modalQR.addEventListener('click', e => { if (e.target === modalQR) closeQRModal(); });

async function showQRCode(id) {
  const f = await getFilament(id);
  if (!f) return;
  qrDisplayId = id;
  document.getElementById('qr-display-name').textContent = f.name;
  document.getElementById('qr-display-meta').textContent =
    `${f.brand ? f.brand + ' · ' : ''}${f.material}${f.colorName ? ' · ' + f.colorName : ''}`;

  qrCanvas.innerHTML = '';
  try {
    new QRCode(qrCanvas, {
      text:         `filavault:${id}`,
      width:        220, height: 220,
      colorDark:    '#3D2B1F',
      colorLight:   '#FDFAF3',
      correctLevel: QRCode.CorrectLevel.M,
    });
  } catch (e) {
    qrCanvas.textContent = 'QR library not cached yet — visit once while online.';
  }
  modalQR.classList.add('visible');
}

function closeQRModal() {
  modalQR.classList.remove('visible');
  qrDisplayId = null;
}

document.getElementById('qr-download-btn').addEventListener('click', () => {
  const img = qrCanvas.querySelector('img') || qrCanvas.querySelector('canvas');
  if (!img) return;
  const link = document.createElement('a');
  link.download = `filament-qr-${qrDisplayId}.png`;
  link.href = img.tagName === 'IMG' ? img.src : img.toDataURL('image/png');
  link.click();
  showToast('Downloaded', 'QR code saved to your Photos.', 'success');
});

// ════════════════════════════════════════════════════════════
// QR CODE SCANNING
// ════════════════════════════════════════════════════════════

const scanResultPanel = document.getElementById('scan-result-panel');

document.getElementById('scan-qty-minus').addEventListener('click', () => {
  scanQtyValue = Math.max(0, scanQtyValue - 1);
  document.getElementById('scan-qty-display').textContent = scanQtyValue;
});
document.getElementById('scan-qty-plus').addEventListener('click', () => {
  scanQtyValue++;
  document.getElementById('scan-qty-display').textContent = scanQtyValue;
});
document.getElementById('scan-cancel-btn').addEventListener('click', () => {
  hideScanResult(); resumeScanner();
});
document.getElementById('scan-save-btn').addEventListener('click', async () => {
  if (!scanFilament) return;
  scanFilament.qty = scanQtyValue;
  await saveFilament(scanFilament);
  await renderInventory();
  alertIfLowStock(scanFilament);
  showToast('Updated', `${scanFilament.name} → ${scanQtyValue} spool${scanQtyValue !== 1 ? 's' : ''}`, 'success');
  hideScanResult(); resumeScanner();
});

function hideScanResult() {
  scanResultPanel.classList.remove('visible');
  scanFilament = null;
  document.getElementById('scan-overlay').style.display = '';
}

async function startScanner() {
  if (scannerStarted) return;
  try {
    qrScanner = new Html5Qrcode('qr-reader');
    await qrScanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 220, height: 220 }, aspectRatio: 1.0 },
      onQRSuccess, () => {}
    );
    scannerStarted = true;
  } catch (e) {
    console.error('[QR] Start failed:', e);
    showToast('Camera Error', 'Allow camera access in your browser settings and try again.', 'error');
  }
}

async function stopScanner() {
  if (!scannerStarted || !qrScanner) return;
  try { await qrScanner.stop(); } catch (e) { console.warn('[QR] Stop:', e); }
  scannerStarted = false;
}

async function resumeScanner() {
  if (!scannerStarted) await startScanner();
}

async function onQRSuccess(decodedText) {
  // Pause while processing
  try { if (qrScanner) await qrScanner.pause(true); } catch (e) {}

  if (!decodedText.startsWith('filavault:')) {
    showToast('Unknown QR', 'This QR was not created by Filament Tracker.', 'warn');
    setTimeout(() => { try { qrScanner && qrScanner.resume(); } catch(e){} }, 2000);
    return;
  }

  const id = decodedText.replace('filavault:', '');
  const f  = await getFilament(id);
  if (!f) {
    showToast('Not Found', 'This filament ID is not in your vault.', 'error');
    setTimeout(() => { try { qrScanner && qrScanner.resume(); } catch(e){} }, 2000);
    return;
  }

  scanFilament = f;
  scanQtyValue = f.qty;
  document.getElementById('scan-qty-display').textContent = scanQtyValue;
  document.getElementById('scan-result-name').textContent = f.name;
  document.getElementById('scan-result-meta').textContent =
    `${f.brand ? f.brand + ' · ' : ''}${f.material} · Currently ${f.qty} spool${f.qty !== 1 ? 's' : ''}`;
  document.getElementById('scan-overlay').style.display = 'none';
  scanResultPanel.classList.add('visible');

  if (navigator.vibrate) navigator.vibrate([40, 20, 40]);
}

// ════════════════════════════════════════════════════════════
// LOW-STOCK ALERTS  (in-app toast + iOS native notification)
// ════════════════════════════════════════════════════════════

/**
 * Check a single filament after saving and send alerts if needed.
 * Always sends an in-app toast. Also sends a native notification
 * if the user has granted permission.
 */
function alertIfLowStock(f) {
  if (f.qty <= 0) {
    const title = 'Out of Stock';
    const body  = `${f.name} is out of stock!`;

    // In-app toast with buy link action
    showToast('🚨 ' + title, body, 'error',
      f.buyLink ? 'Buy Now' : null,
      f.buyLink ? () => window.open(f.buyLink, '_blank') : null);

    // Native iOS notification
    sendNotification(`🚨 ${title}`, body, f.buyLink || null);

  } else if (f.qty <= f.minStock) {
    const title = 'Low Stock Alert';
    const body  = `${f.name} is running low — only ${f.qty} spool${f.qty !== 1 ? 's' : ''} left.`;

    showToast('⚠️ ' + title, body, 'warn',
      f.buyLink ? 'Buy Now' : null,
      f.buyLink ? () => window.open(f.buyLink, '_blank') : null);

    sendNotification(`⚠️ ${title}`, body, f.buyLink || null);
  }
}

/** On startup, check all filaments and summarise alerts */
function checkAllOnStartup() {
  const low = allFilaments.filter(f => f.qty > 0 && f.qty <= f.minStock);
  const out = allFilaments.filter(f => f.qty <= 0);

  if (out.length === 0 && low.length === 0) return;

  const parts = [];
  if (out.length) parts.push(`${out.length} out of stock`);
  if (low.length) parts.push(`${low.length} running low`);

  const summary = parts.join(', ');
  const type    = out.length > 0 ? 'error' : 'warn';

  showToast('Stock Alert', summary, type, 'View Inventory', () => switchView('inventory'));
  // Also fire a native notification summary
  sendNotification('Filament Tracker — Stock Alert', summary, null);
}

// ════════════════════════════════════════════════════════════
// SEARCH
// ════════════════════════════════════════════════════════════

document.getElementById('search-input').addEventListener('input', e => {
  searchQuery = e.target.value;
  renderInventory();
});

// ════════════════════════════════════════════════════════════
// UTILITY
// ════════════════════════════════════════════════════════════

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getMaterialClass(m) {
  return { PLA: 'mat-pla', ABS: 'mat-abs', PETG: 'mat-petg', TPU: 'mat-tpu' }[m] || 'mat-other';
}

// ════════════════════════════════════════════════════════════
// BOOTSTRAP
// ════════════════════════════════════════════════════════════

async function init() {
  try {
    await openDB();
    syncNotifState(); // show/hide notification banner
    await renderInventory();
    setTimeout(checkAllOnStartup, 1500);
  } catch (err) {
    console.error('[INIT] Failed:', err);
    showToast('Startup Error', 'Could not open local database. Please reload.', 'error');
  }
}

init();
