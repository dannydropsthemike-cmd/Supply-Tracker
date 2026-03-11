/* ============================================================
   Filament Vault — app.js
   Full offline PWA for tracking 3D printing filament inventory
   ============================================================ */

'use strict';

// ── Service Worker Registration ─────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      console.log('[SW] Registered:', reg.scope);
    }).catch(err => {
      console.warn('[SW] Registration failed:', err);
    });
  });
}

// ════════════════════════════════════════════════════════════
// DATA LAYER — IndexedDB Storage
// ════════════════════════════════════════════════════════════

const DB_NAME    = 'FilamentVault';
const DB_VERSION = 1;
const STORE_NAME = 'filaments';

let db = null;

/** Open (or create) the IndexedDB database */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('material', 'material', { unique: false });
        store.createIndex('name',     'name',     { unique: false });
      }
    };

    req.onsuccess  = (e) => { db = e.target.result; resolve(db); };
    req.onerror    = (e) => reject(e.target.error);
  });
}

/** Get all filaments */
function getAllFilaments() {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/** Get a single filament by ID */
function getFilament(id) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/** Save (add or update) a filament */
function saveFilament(filament) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.put(filament);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/** Delete a filament by ID */
function deleteFilament(id) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

/** Generate a unique ID */
function generateId() {
  return 'fil_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

// ════════════════════════════════════════════════════════════
// TOAST NOTIFICATION SYSTEM
// ════════════════════════════════════════════════════════════

const toastContainer = document.getElementById('toast-container');

/**
 * Show a toast notification
 * @param {string} title     - Bold title
 * @param {string} message   - Body text
 * @param {string} type      - 'warn' | 'error' | 'success' | 'info'
 * @param {string} [action]  - Optional action label
 * @param {function} [onAction] - Callback for action tap
 */
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
    </div>
  `;

  if (action && onAction) {
    toast.querySelector('.toast-action').addEventListener('click', () => {
      onAction();
      removeToast(toast);
    });
  }

  // Tap to dismiss
  toast.addEventListener('click', () => removeToast(toast));

  toastContainer.appendChild(toast);

  // Auto-dismiss after 4s (longer for warnings)
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

let allFilaments   = [];    // In-memory cache of all filaments
let activeFilter   = 'all'; // Current material filter
let searchQuery    = '';    // Current search query
let editingId      = null;  // ID of filament being edited (null = new)
let scanFilament   = null;  // Filament found during QR scan
let scanQtyValue   = 0;     // Qty shown in scan panel
let qrScanner      = null;  // html5-qrcode instance
let qrDisplayId    = null;  // Filament ID shown in QR modal
let scannerStarted = false; // Whether scanner is running

// ════════════════════════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════════════════════════

const navTabs   = document.querySelectorAll('.nav-tab');
const viewSections = document.querySelectorAll('.view');

navTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const viewId = tab.dataset.view;
    switchView(viewId);
  });
});

function switchView(viewId) {
  navTabs.forEach(t => t.classList.toggle('active', t.dataset.view === viewId));
  viewSections.forEach(v => v.classList.toggle('active', v.id === `view-${viewId}`));

  if (viewId === 'scan') {
    startScanner();
  } else {
    stopScanner();
  }

  if (viewId === 'alerts') {
    renderAlerts();
  }
}

// ════════════════════════════════════════════════════════════
// INVENTORY RENDERING
// ════════════════════════════════════════════════════════════

/** Re-render the filament list based on current filter + search */
async function renderInventory() {
  allFilaments = await getAllFilaments();

  updateStats();
  updateFilterChips();

  const list = document.getElementById('filament-list');

  // Apply filter
  let filtered = allFilaments;
  if (activeFilter !== 'all') {
    filtered = filtered.filter(f => f.material === activeFilter);
  }

  // Apply search
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(f =>
      f.name.toLowerCase().includes(q) ||
      f.brand.toLowerCase().includes(q) ||
      f.material.toLowerCase().includes(q) ||
      (f.colorName || '').toLowerCase().includes(q)
    );
  }

  // Sort: out-of-stock first, then low, then alphabetical
  filtered.sort((a, b) => {
    const aLow = a.qty <= 0 ? 2 : a.qty <= a.minStock ? 1 : 0;
    const bLow = b.qty <= 0 ? 2 : b.qty <= b.minStock ? 1 : 0;
    if (aLow !== bLow) return bLow - aLow;
    return a.name.localeCompare(b.name);
  });

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${searchQuery ? '🔍' : '🧵'}</div>
        <div class="empty-title">${searchQuery ? 'No Results' : 'No Filaments Yet'}</div>
        <div class="empty-sub">${searchQuery ? 'No filaments match your search.' : 'Tap the ＋ button to add your first filament to the vault.'}</div>
      </div>`;
    return;
  }

  list.innerHTML = filtered.map(f => renderFilamentCard(f)).join('');
  attachCardListeners();
}

/** Render a single filament card HTML string */
function renderFilamentCard(f) {
  const isLow   = f.qty > 0 && f.qty <= f.minStock;
  const isOut   = f.qty <= 0;
  const pct     = f.minStock > 0 ? Math.min(100, Math.round((f.qty / (f.minStock * 3)) * 100)) : 100;
  const barCls  = isOut ? 'danger' : isLow ? 'warn' : '';
  const matCls  = getMaterialClass(f.material);
  const badge   = isOut  ? `<div class="out-badge">OUT</div>`
                 : isLow ? `<div class="low-badge">LOW</div>` : '';

  return `
    <div class="filament-card ${isLow ? 'low-stock' : ''} ${isOut ? 'out-of-stock' : ''}" data-id="${f.id}">
      ${badge}
      <div class="card-header">
        <div class="color-swatch" style="background-color: ${escapeHtml(f.colorHex || '#888')}"></div>
        <div class="card-info">
          <div class="card-name">${escapeHtml(f.name)}</div>
          <div class="card-meta">
            ${escapeHtml(f.brand || '—')} &nbsp;
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
          <div class="stock-bar-fill ${barCls}" style="width: ${pct}%"></div>
        </div>
        <div class="stock-pct">${pct}%</div>
      </div>

      <!-- Inline quick-adjust row (hidden by default) -->
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
    </div>
  `;
}

/** Attach event listeners to all card action buttons */
function attachCardListeners() {
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const id     = btn.dataset.id;

      if (action === 'adjust')      handleInlineAdjust(id);
      else if (action === 'qr')     showQRCode(id);
      else if (action === 'edit')   openEditModal(id);
      else if (action === 'delete') handleDelete(id);
      else if (action === 'inline-minus') changeInlineQty(id, -1);
      else if (action === 'inline-plus')  changeInlineQty(id,  1);
      else if (action === 'inline-save')  saveInlineQty(id);
    });
  });
}

// ── Stats Bar ───────────────────────────────────────────────
function updateStats() {
  const total = allFilaments.length;
  const low   = allFilaments.filter(f => f.qty <= f.minStock).length;
  const types = new Set(allFilaments.map(f => f.material)).size;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-low').textContent   = low;
  document.getElementById('stat-types').textContent = types;
}

// ── Filter Chips ────────────────────────────────────────────
function updateFilterChips() {
  const materials = [...new Set(allFilaments.map(f => f.material))].sort();
  const row = document.getElementById('filter-row');

  row.innerHTML = `<div class="chip ${activeFilter === 'all' ? 'active' : ''}" data-filter="all">All</div>`;
  materials.forEach(m => {
    const chip = document.createElement('div');
    chip.className = `chip ${activeFilter === m ? 'active' : ''}`;
    chip.dataset.filter = m;
    chip.textContent = m;
    row.appendChild(chip);
  });

  row.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      activeFilter = chip.dataset.filter;
      renderInventory();
    });
  });
}

// ── Inline Qty Adjustment ───────────────────────────────────
const inlineQtyState = {}; // id → temp qty

function handleInlineAdjust(id) {
  const row = document.getElementById(`inline-${id}`);
  if (!row) return;

  const fil = allFilaments.find(f => f.id === id);
  if (!fil) return;

  const isVisible = row.style.display !== 'none';
  // Close all other open panels
  document.querySelectorAll('[id^="inline-"]').forEach(r => r.style.display = 'none');

  if (!isVisible) {
    inlineQtyState[id] = fil.qty;
    document.getElementById(`inline-val-${id}`).textContent = fil.qty;
    row.style.display = 'flex';
  }
}

function changeInlineQty(id, delta) {
  if (inlineQtyState[id] === undefined) return;
  inlineQtyState[id] = Math.max(0, inlineQtyState[id] + delta);
  const el = document.getElementById(`inline-val-${id}`);
  if (el) el.textContent = inlineQtyState[id];
}

async function saveInlineQty(id) {
  const newQty = inlineQtyState[id];
  if (newQty === undefined) return;
  const fil = allFilaments.find(f => f.id === id);
  if (!fil) return;

  fil.qty = newQty;
  await saveFilament(fil);

  delete inlineQtyState[id];
  await renderInventory();
  checkLowStock(fil);
  showToast('Updated', `${fil.name} → ${newQty} spool${newQty !== 1 ? 's' : ''}`, 'success');
}

// ── Delete ──────────────────────────────────────────────────
async function handleDelete(id) {
  const fil = allFilaments.find(f => f.id === id);
  if (!fil) return;

  if (confirm(`Delete "${fil.name}"? This cannot be undone.`)) {
    await deleteFilament(id);
    await renderInventory();
    showToast('Deleted', `${fil.name} removed from vault.`, 'info');
  }
}

// ════════════════════════════════════════════════════════════
// ADD / EDIT MODAL
// ════════════════════════════════════════════════════════════

const modalAdd        = document.getElementById('modal-add');
const modalAddTitle   = document.getElementById('modal-add-title');
const formSubmitBtn   = document.getElementById('form-submit-btn');

document.getElementById('btn-add').addEventListener('click', openAddModal);
document.getElementById('modal-add-close').addEventListener('click', closeAddModal);
modalAdd.addEventListener('click', (e) => { if (e.target === modalAdd) closeAddModal(); });

// Color picker sync
const colorHexInput = document.getElementById('f-color-hex');
colorHexInput.addEventListener('input', () => {
  document.querySelector('.color-preview').style.background = colorHexInput.value;
});

function openAddModal() {
  editingId = null;
  modalAddTitle.textContent = 'Add Filament';
  formSubmitBtn.textContent = 'Add to Vault';
  clearForm();
  modalAdd.classList.add('visible');
}

async function openEditModal(id) {
  const fil = await getFilament(id);
  if (!fil) return;

  editingId = id;
  modalAddTitle.textContent = 'Edit Filament';
  formSubmitBtn.textContent = 'Save Changes';

  document.getElementById('f-name').value       = fil.name       || '';
  document.getElementById('f-brand').value      = fil.brand      || '';
  document.getElementById('f-material').value   = fil.material   || 'PLA';
  document.getElementById('f-color-name').value = fil.colorName  || '';
  document.getElementById('f-color-hex').value  = fil.colorHex   || '#ff6b35';
  document.querySelector('.color-preview').style.background = fil.colorHex || '#ff6b35';
  document.getElementById('f-qty').value        = fil.qty        ?? '';
  document.getElementById('f-min').value        = fil.minStock   ?? '';
  document.getElementById('f-link').value       = fil.buyLink    || '';
  document.getElementById('f-notes').value      = fil.notes      || '';

  modalAdd.classList.add('visible');
}

function closeAddModal() {
  modalAdd.classList.remove('visible');
  editingId = null;
}

function clearForm() {
  ['f-name','f-brand','f-color-name','f-link','f-notes'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('f-material').value  = 'PLA';
  document.getElementById('f-qty').value       = '';
  document.getElementById('f-min').value       = '2';
  document.getElementById('f-color-hex').value = '#ff6b35';
  document.querySelector('.color-preview').style.background = '#ff6b35';
}

// Form submission
document.getElementById('form-submit-btn').addEventListener('click', async () => {
  const name = document.getElementById('f-name').value.trim();
  if (!name) {
    showToast('Missing Name', 'Please enter a name for this filament.', 'error');
    document.getElementById('f-name').focus();
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
    createdAt: editingId ? undefined : Date.now(),
    updatedAt: Date.now(),
  };

  // Preserve createdAt on edit
  if (editingId) {
    const existing = await getFilament(editingId);
    if (existing) filament.createdAt = existing.createdAt;
  }

  await saveFilament(filament);
  closeAddModal();
  await renderInventory();
  checkLowStock(filament);

  showToast(
    editingId ? 'Updated' : 'Added',
    `${filament.name} has been ${editingId ? 'updated' : 'added to the vault'}.`,
    'success'
  );
});

// ════════════════════════════════════════════════════════════
// QR CODE GENERATION
// ════════════════════════════════════════════════════════════

const modalQR     = document.getElementById('modal-qr');
const qrCanvas    = document.getElementById('qr-display-canvas');

document.getElementById('modal-qr-close').addEventListener('click', closeQRModal);
document.getElementById('qr-done-btn').addEventListener('click', closeQRModal);
modalQR.addEventListener('click', (e) => { if (e.target === modalQR) closeQRModal(); });

async function showQRCode(id) {
  const fil = await getFilament(id);
  if (!fil) return;

  qrDisplayId = id;
  document.getElementById('qr-display-name').textContent = fil.name;
  document.getElementById('qr-display-meta').textContent =
    `${fil.brand || ''}${fil.brand ? ' · ' : ''}${fil.material} · ${fil.colorName || 'N/A'}`;

  // Clear previous QR
  qrCanvas.innerHTML = '';

  // Generate QR code — encode the filament ID as the data
  try {
    new QRCode(qrCanvas, {
      text:          `filavault:${id}`,
      width:         220,
      height:        220,
      colorDark:     '#0a0a0f',
      colorLight:    '#ffffff',
      correctLevel:  QRCode.CorrectLevel.M
    });
  } catch (e) {
    qrCanvas.textContent = 'QR library not loaded. Go online once to cache it.';
  }

  modalQR.classList.add('visible');
}

function closeQRModal() {
  modalQR.classList.remove('visible');
  qrDisplayId = null;
}

// Download QR code as PNG
document.getElementById('qr-download-btn').addEventListener('click', () => {
  const img = qrCanvas.querySelector('img') || qrCanvas.querySelector('canvas');
  if (!img) return;

  const link = document.createElement('a');
  link.download = `filament-qr-${qrDisplayId}.png`;

  if (img.tagName === 'IMG') {
    link.href = img.src;
  } else {
    link.href = img.toDataURL('image/png');
  }

  link.click();
  showToast('Downloaded', 'QR code image saved to your device.', 'success');
});

// ════════════════════════════════════════════════════════════
// QR CODE SCANNING
// ════════════════════════════════════════════════════════════

const scanResultPanel  = document.getElementById('scan-result-panel');
const scanResultName   = document.getElementById('scan-result-name');
const scanResultMeta   = document.getElementById('scan-result-meta');
const scanQtyDisplay   = document.getElementById('scan-qty-display');

document.getElementById('scan-qty-minus').addEventListener('click', () => {
  scanQtyValue = Math.max(0, scanQtyValue - 1);
  scanQtyDisplay.textContent = scanQtyValue;
});

document.getElementById('scan-qty-plus').addEventListener('click', () => {
  scanQtyValue++;
  scanQtyDisplay.textContent = scanQtyValue;
});

document.getElementById('scan-cancel-btn').addEventListener('click', () => {
  hideScanResult();
  resumeScanner();
});

document.getElementById('scan-save-btn').addEventListener('click', async () => {
  if (!scanFilament) return;
  scanFilament.qty = scanQtyValue;
  await saveFilament(scanFilament);
  await renderInventory();
  checkLowStock(scanFilament);

  showToast('Updated', `${scanFilament.name} → ${scanQtyValue} spool${scanQtyValue !== 1 ? 's' : ''}`, 'success');
  hideScanResult();
  resumeScanner();
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
      {
        fps: 10,
        qrbox: { width: 220, height: 220 },
        aspectRatio: 1.0,
        disableFlip: false,
      },
      onQRScanSuccess,
      onQRScanError
    );
    scannerStarted = true;
    console.log('[QR] Scanner started');
  } catch (err) {
    console.error('[QR] Scanner failed:', err);
    showToast('Camera Error', 'Could not access camera. Please allow camera access and try again.', 'error');
  }
}

async function stopScanner() {
  if (!scannerStarted || !qrScanner) return;
  try {
    await qrScanner.stop();
    scannerStarted = false;
    console.log('[QR] Scanner stopped');
  } catch (e) {
    console.warn('[QR] Stop error:', e);
  }
}

async function resumeScanner() {
  if (scannerStarted) return;
  await startScanner();
}

/** Called when QR code is successfully decoded */
async function onQRScanSuccess(decodedText) {
  // Pause scanning while processing
  if (qrScanner && scannerStarted) {
    try { await qrScanner.pause(true); } catch(e) {}
  }

  // Our QR format: "filavault:<id>"
  if (!decodedText.startsWith('filavault:')) {
    showToast('Unknown QR', 'This QR code was not created by FilaVault.', 'warn');
    setTimeout(() => {
      if (qrScanner && scannerStarted) { try { qrScanner.resume(); } catch(e) {} }
    }, 2000);
    return;
  }

  const id  = decodedText.replace('filavault:', '');
  const fil = await getFilament(id);

  if (!fil) {
    showToast('Not Found', 'This filament ID is not in your vault.', 'error');
    setTimeout(() => {
      if (qrScanner && scannerStarted) { try { qrScanner.resume(); } catch(e) {} }
    }, 2000);
    return;
  }

  // Show scan result panel
  scanFilament = fil;
  scanQtyValue = fil.qty;
  scanQtyDisplay.textContent = scanQtyValue;
  scanResultName.textContent = fil.name;
  scanResultMeta.textContent =
    `${fil.brand || ''}${fil.brand ? ' · ' : ''}${fil.material} · Current: ${fil.qty} spool${fil.qty !== 1 ? 's' : ''}`;

  document.getElementById('scan-overlay').style.display = 'none';
  scanResultPanel.classList.add('visible');

  // Haptic feedback if supported
  if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
}

function onQRScanError() {
  // Silent — errors during scanning are normal (no QR in frame)
}

// ════════════════════════════════════════════════════════════
// LOW STOCK ALERTS
// ════════════════════════════════════════════════════════════

/** Check if a filament is low and show a toast if so */
function checkLowStock(fil) {
  if (fil.qty <= 0) {
    showToast(
      '🚨 Out of Stock',
      `${fil.name} is out of stock!`,
      'error',
      fil.buyLink ? 'Buy Now' : null,
      fil.buyLink ? () => window.open(fil.buyLink, '_blank') : null
    );
  } else if (fil.qty <= fil.minStock) {
    showToast(
      '⚠️ Low Stock',
      `${fil.name} is running low (${fil.qty} left, min: ${fil.minStock}).`,
      'warn',
      fil.buyLink ? 'Buy Now' : null,
      fil.buyLink ? () => window.open(fil.buyLink, '_blank') : null
    );
  }
}

/** Check all filaments for low stock on app load */
function checkAllLowStock() {
  const lowItems = allFilaments.filter(f => f.qty <= f.minStock);
  if (lowItems.length === 0) return;

  // Show one summary toast
  const outCount = lowItems.filter(f => f.qty <= 0).length;
  const lowCount = lowItems.filter(f => f.qty > 0).length;
  let msg = '';
  if (outCount > 0) msg += `${outCount} out of stock. `;
  if (lowCount > 0) msg += `${lowCount} running low.`;

  showToast('Stock Alert', msg.trim(), outCount > 0 ? 'error' : 'warn',
    'View Alerts', () => switchView('alerts'));
}

/** Render the Alerts view */
async function renderAlerts() {
  allFilaments = await getAllFilaments();
  const list = document.getElementById('alerts-list');
  const lowItems = allFilaments.filter(f => f.qty <= f.minStock);

  if (lowItems.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✅</div>
        <div class="empty-title">All Stocked Up!</div>
        <div class="empty-sub">No filaments are below their minimum stock level.</div>
      </div>`;
    return;
  }

  list.innerHTML = lowItems.map(f => {
    const isOut = f.qty <= 0;
    return `
      <div class="filament-card ${isOut ? 'out-of-stock' : 'low-stock'}">
        ${isOut ? '<div class="out-badge">OUT</div>' : '<div class="low-badge">LOW</div>'}
        <div class="card-header">
          <div class="color-swatch" style="background-color: ${escapeHtml(f.colorHex || '#888')}"></div>
          <div class="card-info">
            <div class="card-name">${escapeHtml(f.name)}</div>
            <div class="card-meta">${escapeHtml(f.brand || '—')} · ${f.qty} / ${f.minStock} min</div>
          </div>
        </div>
        ${f.buyLink ? `
        <div class="card-actions">
          <button class="card-action-btn" onclick="window.open('${escapeHtml(f.buyLink)}', '_blank')">
            🛒 Buy More
          </button>
        </div>` : ''}
      </div>`;
  }).join('');
}

// Alerts button in header
document.getElementById('btn-alerts').addEventListener('click', () => switchView('alerts'));

// ════════════════════════════════════════════════════════════
// SEARCH
// ════════════════════════════════════════════════════════════

document.getElementById('search-input').addEventListener('input', (e) => {
  searchQuery = e.target.value;
  renderInventory();
});

// ════════════════════════════════════════════════════════════
// UTILITY
// ════════════════════════════════════════════════════════════

/** Escape HTML special chars to prevent XSS */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Get CSS class for material badge */
function getMaterialClass(material) {
  const map = { PLA: 'mat-pla', ABS: 'mat-abs', PETG: 'mat-petg', TPU: 'mat-tpu' };
  return map[material] || 'mat-other';
}

// ════════════════════════════════════════════════════════════
// BOOTSTRAP
// ════════════════════════════════════════════════════════════

async function init() {
  try {
    await openDB();
    console.log('[DB] IndexedDB opened');
    await renderInventory();

    // Check for low stock after a short delay
    setTimeout(checkAllLowStock, 1500);
  } catch (err) {
    console.error('[INIT] Failed:', err);
    showToast('Startup Error', 'Could not open local database. Please reload.', 'error');
  }
}

init();
