/* ============================================================
   Filament Tracker — app.js  (v6)
   - Realtime inline qty (saves on every tap, no save button)
   - QR modal: show code → toggle to scanner → adjust qty
   - Save to Photos via Web Share API
   - Periodic low-stock notifications (tracks times in localStorage)
   - Visual low/out card differentiation
   ============================================================ */
'use strict';

// ── Service Worker ──────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(r => console.log('[SW]', r.scope))
      .catch(e => console.warn('[SW] failed:', e));
  });
}

// ════════════════════════════════════════════════════════════
// DATABASE
// ════════════════════════════════════════════════════════════
const DB_NAME = 'FilamentTracker', DB_VER = 1, STORE = 'filaments';
let db = null;

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
    };
    r.onsuccess = e => { db = e.target.result; res(db); };
    r.onerror   = e => rej(e.target.error);
  });
}
const tx = (mode) => db.transaction(STORE, mode).objectStore(STORE);
const getAllFilaments = () => new Promise((res, rej) => { const r = tx('readonly').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const getFilament    = id => new Promise((res, rej) => { const r = tx('readonly').get(id);  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const saveFilament   = f  => new Promise((res, rej) => { const r = tx('readwrite').put(f);  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const deleteFilament = id => new Promise((res, rej) => { const r = tx('readwrite').delete(id); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
const genId = () => 'fil_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,7);

// ════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ════════════════════════════════════════════════════════════
const NOTIF_TIMES_KEY = 'notifLastSent'; // JSON array of timestamps
// We target 3 times a day: ~9am, ~1pm, ~6pm (in ms offsets from midnight)
const DAILY_WINDOWS = [9*60, 13*60, 18*60]; // minutes from midnight
const NOTIF_WINDOW_MINS = 120; // send once per 2hr window

function isNotifSupported() { return 'Notification' in window; }

function syncNotifBanner() {
  if (!isNotifSupported()) return;
  const banner = document.getElementById('notif-banner');
  if (banner) banner.style.display = Notification.permission === 'default' ? 'flex' : 'none';
}

async function requestNotifPermission() {
  if (!isNotifSupported()) {
    showToast('Not Available', 'Notifications require iOS 16.4+ with the app added to your Home Screen.', 'info');
    return;
  }
  const result = await Notification.requestPermission();
  syncNotifBanner();
  if (result === 'granted') {
    showToast('Alerts Enabled', "You'll be notified when filament is low.", 'success');
    sendNativeNotif('Filament-Tracker', 'Low-stock alerts are on! 🧵', null);
  } else {
    showToast('Permission Denied', 'Enable notifications in iOS Settings anytime.', 'warn');
  }
}

function sendNativeNotif(title, body, url) {
  if (Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, {
      body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
      tag: 'fila-low', renotify: true, data: { url },
    });
    if (url) n.onclick = () => { window.open(url, '_blank'); n.close(); };
  } catch(e) { console.warn('[Notif]', e); }
}

/**
 * Periodic check: sends notifications at ~3 windows per day.
 * Uses localStorage to avoid duplicate sends within the same window.
 */
async function checkPeriodicNotifications() {
  if (Notification.permission !== 'granted') return;

  const now = new Date();
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
  const todayBase = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  // Find which window we're currently in (if any)
  const activeWindow = DAILY_WINDOWS.find(w => Math.abs(minuteOfDay - w) <= NOTIF_WINDOW_MINS / 2);
  if (activeWindow === undefined) return;

  // Key for this specific window today
  const windowKey = `${todayBase}_${activeWindow}`;
  let sent = [];
  try { sent = JSON.parse(localStorage.getItem(NOTIF_TIMES_KEY) || '[]'); } catch(e) {}

  if (sent.includes(windowKey)) return; // already sent this window today

  // Check for low/out filaments
  const filaments = await getAllFilaments();
  const outItems  = filaments.filter(f => f.qty <= 0);
  const lowItems  = filaments.filter(f => f.qty > 0 && f.qty <= f.minStock);

  if (outItems.length === 0 && lowItems.length === 0) return;

  // Build notification
  const parts = [];
  if (outItems.length) parts.push(`${outItems.length} out of stock`);
  if (lowItems.length) parts.push(`${lowItems.length} running low`);
  const body = parts.join(' · ');

  sendNativeNotif('🧵 Filament-Tracker', body, null);

  // Mark this window as sent and trim old entries (keep last 20)
  sent.push(windowKey);
  if (sent.length > 20) sent = sent.slice(-20);
  localStorage.setItem(NOTIF_TIMES_KEY, JSON.stringify(sent));
}

document.getElementById('notif-banner').addEventListener('click', requestNotifPermission);

// ════════════════════════════════════════════════════════════
// TOASTS
// ════════════════════════════════════════════════════════════
const toastContainer = document.getElementById('toast-container');

function showToast(title, message, type = 'info', action = null, onAction = null) {
  const icons = { warn:'⚠️', error:'🚨', success:'✅', info:'ℹ️' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `
    <div class="toast-icon">${icons[type]||'ℹ️'}</div>
    <div class="toast-body">
      <div class="toast-title">${esc(title)}</div>
      <div class="toast-msg">${esc(message)}</div>
      ${action ? `<div class="toast-action">${esc(action)} →</div>` : ''}
    </div>`;
  if (action && onAction) t.querySelector('.toast-action').addEventListener('click', () => { onAction(); removeToast(t); });
  t.addEventListener('click', () => removeToast(t));
  toastContainer.appendChild(t);
  setTimeout(() => removeToast(t), (type==='warn'||type==='error') ? 6000 : 4000);
}

function removeToast(t) {
  if (!t.parentNode) return;
  t.classList.add('removing');
  setTimeout(() => t.parentNode && t.parentNode.removeChild(t), 300);
}

// ════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════
let allFilaments = [], activeFilter = 'all', searchQuery = '';
let editingId = null;
let modalScanner = null, modalScannerRunning = false;

// ════════════════════════════════════════════════════════════
// INVENTORY RENDER
// ════════════════════════════════════════════════════════════
async function renderInventory() {
  allFilaments = await getAllFilaments();
  updateStats();
  updateFilterChips();

  let filtered = allFilaments;
  if (activeFilter !== 'all') filtered = filtered.filter(f => f.material === activeFilter);
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(f =>
      f.name.toLowerCase().includes(q) ||
      (f.brand||'').toLowerCase().includes(q) ||
      f.material.toLowerCase().includes(q) ||
      (f.colorName||'').toLowerCase().includes(q)
    );
  }
  filtered.sort((a, b) => {
    const sa = a.qty<=0?2:a.qty<=a.minStock?1:0;
    const sb = b.qty<=0?2:b.qty<=b.minStock?1:0;
    return sb!==sa ? sb-sa : a.name.localeCompare(b.name);
  });

  const list = document.getElementById('filament-list');
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">${searchQuery?'🔍':'🧵'}</div><div class="empty-title">${searchQuery?'No Results':'No Filaments Yet'}</div><div class="empty-sub">${searchQuery?'No filaments match your search.':'Tap <strong>＋</strong> to add your first filament.'}</div></div>`;
    return;
  }
  list.innerHTML = filtered.map(renderCard).join('');
  attachCardListeners();
}

function renderCard(f) {
  const isLow  = f.qty > 0 && f.qty <= f.minStock;
  const isOut  = f.qty <= 0;
  const cls    = isOut ? 'out-of-stock' : isLow ? 'low-stock' : '';
  const buyBtn = (isLow || isOut) && f.buyLink
    ? `<a href="${esc(f.buyLink)}" target="_blank" class="buy-link-btn">${isOut ? '🛒 Order Now' : '🛒 Buy More'}</a>`
    : '';
  const strip  = isOut
    ? `<div class="card-status-strip">🚨 Out of Stock — order needed${buyBtn ? ' · ' + buyBtn : ''}</div>`
    : isLow
    ? `<div class="card-status-strip">⚠️ Low — ${f.qty} of ${f.minStock} min remaining${buyBtn ? ' · ' + buyBtn : ''}</div>`
    : '';
  const matCls = getMaterialClass(f.material);

  return `
    <div class="filament-card ${cls}" data-id="${f.id}">
      ${strip}
      <div class="card-header">
        <div class="color-swatch" style="background-color:${esc(f.colorHex||'#9B6B5A')}"></div>
        <div class="card-info">
          <div class="card-name">${esc(f.name)}</div>
          <div class="card-meta">${esc(f.brand||'—')}<span class="material-badge ${matCls}">${esc(f.material)}</span></div>
        </div>
        <div class="card-qty-wrap">
          <div class="card-qty" id="card-qty-${f.id}">${f.qty}</div>
          <div class="card-qty-label">spools</div>
        </div>
      </div>

      <!-- Inline realtime qty row (no save button — saves on every tap) -->
      <div class="inline-qty-row" id="inline-${f.id}">
        <div class="inline-qty-btns">
          <button class="inline-btn" data-action="inline-minus" data-id="${f.id}">−</button>
          <div class="inline-qty-val" id="inline-val-${f.id}">${f.qty}</div>
          <button class="inline-btn" data-action="inline-plus" data-id="${f.id}">＋</button>
        </div>
        <span style="font-size:11px;color:var(--text3);font-weight:700;letter-spacing:1px;text-transform:uppercase;">spools</span>
      </div>

      <div class="card-actions">
        <button class="card-action-btn" data-action="toggle-adjust" data-id="${f.id}">⚡ Adjust</button>
        <button class="card-action-btn" data-action="edit" data-id="${f.id}">✏️ Edit</button>
        <button class="card-action-btn danger" data-action="delete" data-id="${f.id}">🗑</button>
      </div>
    </div>`;
}

function attachCardListeners() {
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const { action, id } = btn.dataset;
      if      (action === 'toggle-adjust') toggleAdjust(id);
      else if (action === 'edit')          openEditModal(id);
      else if (action === 'delete')        handleDelete(id);
      else if (action === 'inline-minus')  adjustQty(id, -1);
      else if (action === 'inline-plus')   adjustQty(id,  1);
    });
  });
}

// ── Toggle adjust row open/closed ──────────────────────────
function toggleAdjust(id) {
  const row = document.getElementById(`inline-${id}`);
  if (!row) return;
  // Close all others first
  document.querySelectorAll('.inline-qty-row.open').forEach(r => {
    if (r.id !== `inline-${id}`) r.classList.remove('open');
  });
  row.classList.toggle('open');
}

// ── Realtime qty: saves immediately on every +/- tap ───────
async function adjustQty(id, delta) {
  const fil = allFilaments.find(f => f.id === id);
  if (!fil) return;

  fil.qty = Math.max(0, fil.qty + delta);
  await saveFilament(fil);

  // Update card qty display without full re-render
  const cardQty  = document.getElementById(`card-qty-${id}`);
  const inlineVal = document.getElementById(`inline-val-${id}`);
  if (cardQty)   cardQty.textContent   = fil.qty;
  if (inlineVal) inlineVal.textContent = fil.qty;

  // Update the card's visual status classes
  const card = document.querySelector(`.filament-card[data-id="${id}"]`);
  if (card) {
    const isLow = fil.qty > 0 && fil.qty <= fil.minStock;
    const isOut = fil.qty <= 0;
    card.classList.toggle('low-stock',   isLow);
    card.classList.toggle('out-of-stock', isOut);

    // Update status strip
    const strip = card.querySelector('.card-status-strip');
    if (strip) {
      if (isOut) {
        strip.style.display = 'flex';
        strip.textContent = '🚨 Out of Stock — order needed';
      } else if (isLow) {
        strip.style.display = 'flex';
        strip.textContent = `⚠️ Low — ${fil.qty} of ${fil.minStock} min remaining`;
      } else {
        strip.style.display = 'none';
      }
    }

    // Update qty color
    if (cardQty) {
      cardQty.style.color = isOut ? 'var(--red)' : isLow ? 'var(--yellow)' : '';
    }
  }

  // Update stats bar
  updateStats();
  alertIfLowStock(fil);
}

function updateStats() {
  document.getElementById('stat-total').textContent = allFilaments.length;
  document.getElementById('stat-low').textContent   = allFilaments.filter(f => f.qty <= f.minStock).length;
  document.getElementById('stat-types').textContent = new Set(allFilaments.map(f => f.material)).size;
}

function updateFilterChips() {
  const materials = [...new Set(allFilaments.map(f => f.material))].sort();
  const row = document.getElementById('filter-row');
  row.innerHTML = `<div class="chip ${activeFilter==='all'?'active':''}" data-filter="all">All</div>`;
  materials.forEach(m => {
    const c = document.createElement('div');
    c.className = `chip ${activeFilter===m?'active':''}`;
    c.dataset.filter = m;
    c.textContent = m;
    row.appendChild(c);
  });
  row.querySelectorAll('.chip').forEach(c => {
    c.addEventListener('click', () => { activeFilter = c.dataset.filter; renderInventory(); });
  });
}

// ── Delete ──────────────────────────────────────────────────
async function handleDelete(id) {
  const f = allFilaments.find(f => f.id === id);
  if (!f || !confirm(`Delete "${f.name}"? This cannot be undone.`)) return;
  await deleteFilament(id);
  await renderInventory();
  showToast('Deleted', `${f.name} removed.`, 'info');
}

// ════════════════════════════════════════════════════════════
// ADD / EDIT MODAL
// ════════════════════════════════════════════════════════════
const modalAdd = document.getElementById('modal-add');
document.getElementById('btn-add').addEventListener('click', openAddModal);
document.getElementById('modal-add-close').addEventListener('click', closeAddModal);
modalAdd.addEventListener('click', e => { if (e.target === modalAdd) closeAddModal(); });
document.getElementById('f-color-hex').addEventListener('input', e => {
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
  document.getElementById('f-name').value       = f.name      || '';
  document.getElementById('f-brand').value      = f.brand     || '';
  document.getElementById('f-material').value   = f.material  || 'PLA';
  document.getElementById('f-color-name').value = f.colorName || '';
  document.getElementById('f-color-hex').value  = f.colorHex  || '#9B6B5A';
  document.getElementById('color-preview-box').style.background = f.colorHex || '#9B6B5A';
  document.getElementById('f-qty').value        = f.qty       ?? '';
  document.getElementById('f-min').value        = f.minStock  ?? '';
  document.getElementById('f-link').value       = f.buyLink   || '';
  document.getElementById('f-notes').value      = f.notes     || '';
  modalAdd.classList.add('visible');
}

function closeAddModal() { modalAdd.classList.remove('visible'); editingId = null; }

function clearForm() {
  ['f-name','f-brand','f-color-name','f-link','f-notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('f-material').value  = 'PLA';
  document.getElementById('f-qty').value       = '';
  document.getElementById('f-min').value       = '2';
  document.getElementById('f-color-hex').value = '#9B6B5A';
  document.getElementById('color-preview-box').style.background = '#9B6B5A';
}

document.getElementById('form-submit-btn').addEventListener('click', async () => {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { showToast('Required', 'Please enter a name.', 'error'); return; }
  const f = {
    id:        editingId || genId(),
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
    const ex = await getFilament(editingId);
    f.createdAt = ex ? ex.createdAt : Date.now();
  } else {
    f.createdAt = Date.now();
  }
  await saveFilament(f);
  closeAddModal();
  await renderInventory();
  alertIfLowStock(f);
  showToast(editingId ? 'Updated' : 'Added', `${f.name} ${editingId?'updated':'added to the vault'}.`, 'success');
});

// ════════════════════════════════════════════════════════════
// LOW STOCK ALERTS
// ════════════════════════════════════════════════════════════
function alertIfLowStock(f) {
  if (f.qty <= 0) {
    showToast('🚨 Out of Stock', `${f.name} is out of stock!`, 'error',
      f.buyLink ? 'Buy Now' : null,
      f.buyLink ? () => window.open(f.buyLink, '_blank') : null);
    sendNativeNotif('🚨 Out of Stock', `${f.name} is out of stock!`, f.buyLink||null);
  } else if (f.qty <= f.minStock) {
    showToast('⚠️ Low Stock', `${f.name} is running low — ${f.qty} left.`, 'warn',
      f.buyLink ? 'Buy Now' : null,
      f.buyLink ? () => window.open(f.buyLink, '_blank') : null);
    sendNativeNotif('⚠️ Low Stock', `${f.name} — only ${f.qty} spool${f.qty!==1?'s':''} left.`, f.buyLink||null);
  }
}

function checkAllOnStartup() {
  const low = allFilaments.filter(f => f.qty > 0 && f.qty <= f.minStock);
  const out = allFilaments.filter(f => f.qty <= 0);
  if (!low.length && !out.length) return;
  const parts = [];
  if (out.length) parts.push(`${out.length} out of stock`);
  if (low.length) parts.push(`${low.length} running low`);
  showToast('Stock Alert', parts.join(', '), out.length ? 'error' : 'warn');
}

// ════════════════════════════════════════════════════════════
// SEARCH
// ════════════════════════════════════════════════════════════
document.getElementById('search-input').addEventListener('input', e => {
  searchQuery = e.target.value;
  renderInventory();
});

// ════════════════════════════════════════════════════════════
// PERIODIC NOTIFICATION CHECKS
// ════════════════════════════════════════════════════════════
// Check on visibility change (user returns to app)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkPeriodicNotifications();
});

// ════════════════════════════════════════════════════════════
// UTILITY
// ════════════════════════════════════════════════════════════
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function getMaterialClass(m) {
  return {PLA:'mat-pla',ABS:'mat-abs',PETG:'mat-petg',TPU:'mat-tpu'}[m]||'mat-other';
}

// ════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════
async function init() {
  try {
    await openDB();
    syncNotifBanner();
    await renderInventory();
    setTimeout(() => { checkAllOnStartup(); checkPeriodicNotifications(); }, 1500);
  } catch(e) {
    console.error('[INIT]', e);
    showToast('Startup Error', 'Could not open database. Please reload.', 'error');
  }
}

init();
