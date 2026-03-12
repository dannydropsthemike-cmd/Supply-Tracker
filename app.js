/* ============================================================
   Supply Tracker — app.js
   Business materials & supply inventory tracker
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
const DB_NAME = 'SupplyTracker', DB_VER = 1, STORE = 'supplies';
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
const getAllItems  = () => new Promise((res, rej) => { const r = tx('readonly').getAll();  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const getItem     = id => new Promise((res, rej) => { const r = tx('readonly').get(id);   r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const saveItem    = f  => new Promise((res, rej) => { const r = tx('readwrite').put(f);   r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const deleteItem  = id => new Promise((res, rej) => { const r = tx('readwrite').delete(id); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
const genId = () => 'sup_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,7);

// ════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ════════════════════════════════════════════════════════════
const NOTIF_KEY = 'supplyNotifLastSent';
const DAILY_WINDOWS = [9*60, 13*60, 18*60]; // 9am, 1pm, 6pm
const NOTIF_WINDOW_MINS = 120;

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
    showToast('Alerts Enabled', "You'll be notified when supplies are low.", 'success');
    sendNotif('Supply Tracker', 'Low-stock alerts are on! 📦', null);
  } else {
    showToast('Permission Denied', 'Enable notifications in iOS Settings anytime.', 'warn');
  }
}

function sendNotif(title, body, url) {
  if (Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, {
      body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
      tag: 'supply-low', renotify: true, data: { url },
    });
    if (url) n.onclick = () => { window.open(url, '_blank'); n.close(); };
  } catch(e) { console.warn('[Notif]', e); }
}

async function checkPeriodicNotifications() {
  if (Notification.permission !== 'granted') return;
  const now = new Date();
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
  const todayBase = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const activeWindow = DAILY_WINDOWS.find(w => Math.abs(minuteOfDay - w) <= NOTIF_WINDOW_MINS / 2);
  if (activeWindow === undefined) return;
  const windowKey = `${todayBase}_${activeWindow}`;
  let sent = [];
  try { sent = JSON.parse(localStorage.getItem(NOTIF_KEY) || '[]'); } catch(e) {}
  if (sent.includes(windowKey)) return;

  const items   = await getAllItems();
  const outItems = items.filter(f => f.qty <= 0);
  const lowItems = items.filter(f => f.qty > 0 && f.qty <= f.minStock);
  if (!outItems.length && !lowItems.length) return;

  const parts = [];
  if (outItems.length) parts.push(`${outItems.length} out of stock`);
  if (lowItems.length) parts.push(`${lowItems.length} running low`);
  sendNotif('📦 Supply Tracker', parts.join(' · '), null);

  sent.push(windowKey);
  if (sent.length > 20) sent = sent.slice(-20);
  localStorage.setItem(NOTIF_KEY, JSON.stringify(sent));
}

document.getElementById('notif-banner').addEventListener('click', requestNotifPermission);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkPeriodicNotifications(); });

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
let allItems = [], activeFilter = 'all', searchQuery = '', editingId = null;

// ════════════════════════════════════════════════════════════
// INVENTORY RENDER
// ════════════════════════════════════════════════════════════
async function renderInventory() {
  allItems = await getAllItems();
  updateStats();
  updateFilterChips();

  let filtered = allItems;
  if (activeFilter !== 'all') filtered = filtered.filter(f => f.category === activeFilter);
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(f =>
      f.name.toLowerCase().includes(q) ||
      (f.supplier||'').toLowerCase().includes(q) ||
      f.category.toLowerCase().includes(q) ||
      (f.variant||'').toLowerCase().includes(q)
    );
  }
  filtered.sort((a, b) => {
    const sa = a.qty<=0?2:a.qty<=a.minStock?1:0;
    const sb = b.qty<=0?2:b.qty<=b.minStock?1:0;
    return sb!==sa ? sb-sa : a.name.localeCompare(b.name);
  });

  const list = document.getElementById('filament-list');
  if (!filtered.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${searchQuery?'🔍':'📦'}</div>
        <div class="empty-title">${searchQuery?'No Results':'No Supplies Yet'}</div>
        <div class="empty-sub">${searchQuery?'No items match your search.':'Tap <strong>＋</strong> to add your first item.'}</div>
      </div>`;
    return;
  }
  list.innerHTML = filtered.map(renderCard).join('');
  attachCardListeners();
}

function renderCard(f) {
  const isLow  = f.qty > 0 && f.qty <= f.minStock;
  const isOut  = f.qty <= 0;
  const cls    = isOut ? 'out-of-stock' : isLow ? 'low-stock' : '';
  const unit   = f.unit || 'units';
  const buyBtn = (isLow || isOut) && f.buyLink
    ? `<a href="${esc(f.buyLink)}" target="_blank" class="buy-link-btn">${isOut ? '🛒 Order Now' : '🛒 Buy More'}</a>`
    : '';
  const strip = isOut
    ? `<div class="card-status-strip">🚨 Out of Stock${buyBtn ? ' · ' + buyBtn : ''}</div>`
    : isLow
    ? `<div class="card-status-strip">⚠️ Low — ${f.qty} of ${f.minStock} min${buyBtn ? ' · ' + buyBtn : ''}</div>`
    : '';
  const catCls = getCategoryClass(f.category);

  return `
    <div class="filament-card ${cls}" data-id="${f.id}">
      ${strip}
      <div class="card-header">
        <div class="color-swatch" style="background-color:${esc(f.colorHex||'#9B6B5A')}"></div>
        <div class="card-info">
          <div class="card-name">${esc(f.name)}</div>
          <div class="card-meta">
            ${esc(f.supplier||'—')}
            <span class="material-badge ${catCls}">${esc(f.category)}</span>
            ${f.variant ? `<span style="color:var(--text3);margin-left:4px;">${esc(f.variant)}</span>` : ''}
          </div>
        </div>
        <div class="card-qty-wrap">
          <div class="card-qty" id="card-qty-${f.id}">${f.qty}</div>
          <div class="card-qty-label">${esc(unit)}</div>
        </div>
      </div>

      <div class="inline-qty-row" id="inline-${f.id}">
        <div class="inline-qty-btns">
          <button class="inline-btn" data-action="inline-minus" data-id="${f.id}">−</button>
          <div class="inline-qty-val" id="inline-val-${f.id}">${f.qty}</div>
          <button class="inline-btn" data-action="inline-plus" data-id="${f.id}">＋</button>
        </div>
        <span style="font-size:11px;color:var(--text3);font-weight:700;letter-spacing:1px;text-transform:uppercase;">${esc(unit)}</span>
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

function toggleAdjust(id) {
  const row = document.getElementById(`inline-${id}`);
  if (!row) return;
  document.querySelectorAll('.inline-qty-row.open').forEach(r => {
    if (r.id !== `inline-${id}`) r.classList.remove('open');
  });
  row.classList.toggle('open');
}

async function adjustQty(id, delta) {
  const item = allItems.find(f => f.id === id);
  if (!item) return;
  item.qty = Math.max(0, item.qty + delta);
  await saveItem(item);

  const cardQty   = document.getElementById(`card-qty-${id}`);
  const inlineVal = document.getElementById(`inline-val-${id}`);
  if (cardQty)   cardQty.textContent   = item.qty;
  if (inlineVal) inlineVal.textContent = item.qty;

  const card = document.querySelector(`.filament-card[data-id="${id}"]`);
  if (card) {
    const isLow = item.qty > 0 && item.qty <= item.minStock;
    const isOut = item.qty <= 0;
    card.classList.toggle('low-stock',   isLow);
    card.classList.toggle('out-of-stock', isOut);

    const strip = card.querySelector('.card-status-strip');
    const unit  = item.unit || 'units';
    const buyBtn = (isLow || isOut) && item.buyLink
      ? ` · <a href="${esc(item.buyLink)}" target="_blank" class="buy-link-btn">${isOut ? '🛒 Order Now' : '🛒 Buy More'}</a>`
      : '';
    if (strip) {
      if (isOut)       { strip.style.display='flex'; strip.innerHTML=`🚨 Out of Stock${buyBtn}`; }
      else if (isLow)  { strip.style.display='flex'; strip.innerHTML=`⚠️ Low — ${item.qty} of ${item.minStock} min${buyBtn}`; }
      else             { strip.style.display='none'; }
    }
    if (cardQty) cardQty.style.color = isOut ? 'var(--red)' : isLow ? 'var(--yellow)' : '';
  }

  updateStats();
  alertIfLowStock(item);
}

function updateStats() {
  document.getElementById('stat-total').textContent = allItems.length;
  document.getElementById('stat-low').textContent   = allItems.filter(f => f.qty <= f.minStock).length;
  document.getElementById('stat-types').textContent = new Set(allItems.map(f => f.category)).size;
}

function updateFilterChips() {
  const categories = [...new Set(allItems.map(f => f.category))].sort();
  const row = document.getElementById('filter-row');
  row.innerHTML = `<div class="chip ${activeFilter==='all'?'active':''}" data-filter="all">All</div>`;
  categories.forEach(c => {
    const el = document.createElement('div');
    el.className = `chip ${activeFilter===c?'active':''}`;
    el.dataset.filter = c;
    el.textContent = c;
    row.appendChild(el);
  });
  row.querySelectorAll('.chip').forEach(c => {
    c.addEventListener('click', () => { activeFilter = c.dataset.filter; renderInventory(); });
  });
}

async function handleDelete(id) {
  const item = allItems.find(f => f.id === id);
  if (!item || !confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
  await deleteItem(id);
  await renderInventory();
  showToast('Deleted', `${item.name} removed.`, 'info');
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
  document.getElementById('modal-add-title').textContent = 'Add Item';
  document.getElementById('form-submit-btn').textContent = 'Add Item';
  clearForm();
  modalAdd.classList.add('visible');
}

async function openEditModal(id) {
  const f = await getItem(id);
  if (!f) return;
  editingId = id;
  document.getElementById('modal-add-title').textContent = 'Edit Item';
  document.getElementById('form-submit-btn').textContent = 'Save Changes';
  document.getElementById('f-name').value       = f.name       || '';
  document.getElementById('f-brand').value      = f.supplier   || '';
  document.getElementById('f-material').value   = f.category   || 'Packaging';
  document.getElementById('f-color-name').value = f.variant    || '';
  document.getElementById('f-color-hex').value  = f.colorHex   || '#9B6B5A';
  document.getElementById('color-preview-box').style.background = f.colorHex || '#9B6B5A';
  document.getElementById('f-qty').value        = f.qty        ?? '';
  document.getElementById('f-min').value        = f.minStock   ?? '';
  document.getElementById('f-unit').value       = f.unit       || 'units';
  document.getElementById('f-link').value       = f.buyLink    || '';
  document.getElementById('f-notes').value      = f.notes      || '';
  modalAdd.classList.add('visible');
}

function closeAddModal() { modalAdd.classList.remove('visible'); editingId = null; }

function clearForm() {
  ['f-name','f-brand','f-color-name','f-link','f-notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('f-material').value  = 'Packaging';
  document.getElementById('f-unit').value      = 'units';
  document.getElementById('f-qty').value       = '';
  document.getElementById('f-min').value       = '5';
  document.getElementById('f-color-hex').value = '#9B6B5A';
  document.getElementById('color-preview-box').style.background = '#9B6B5A';
}

document.getElementById('form-submit-btn').addEventListener('click', async () => {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { showToast('Required', 'Please enter an item name.', 'error'); return; }

  const item = {
    id:        editingId || genId(),
    name,
    supplier:  document.getElementById('f-brand').value.trim(),
    category:  document.getElementById('f-material').value,
    variant:   document.getElementById('f-color-name').value.trim(),
    colorHex:  document.getElementById('f-color-hex').value,
    qty:       parseInt(document.getElementById('f-qty').value) || 0,
    minStock:  parseInt(document.getElementById('f-min').value) || 5,
    unit:      document.getElementById('f-unit').value,
    buyLink:   document.getElementById('f-link').value.trim(),
    notes:     document.getElementById('f-notes').value.trim(),
    updatedAt: Date.now(),
  };

  if (editingId) {
    const ex = await getItem(editingId);
    item.createdAt = ex ? ex.createdAt : Date.now();
  } else {
    item.createdAt = Date.now();
  }

  await saveItem(item);
  closeAddModal();
  await renderInventory();
  alertIfLowStock(item);
  showToast(editingId ? 'Updated' : 'Added', `${item.name} ${editingId?'updated':'added'}.`, 'success');
});

// ════════════════════════════════════════════════════════════
// LOW STOCK ALERTS
// ════════════════════════════════════════════════════════════
function alertIfLowStock(f) {
  const unit = f.unit || 'units';
  if (f.qty <= 0) {
    showToast('🚨 Out of Stock', `${f.name} is out of stock!`, 'error',
      f.buyLink ? 'Order Now' : null,
      f.buyLink ? () => window.open(f.buyLink, '_blank') : null);
    sendNotif('🚨 Out of Stock', `${f.name} is out of stock!`, f.buyLink||null);
  } else if (f.qty <= f.minStock) {
    showToast('⚠️ Low Stock', `${f.name} — only ${f.qty} ${unit} left.`, 'warn',
      f.buyLink ? 'Buy More' : null,
      f.buyLink ? () => window.open(f.buyLink, '_blank') : null);
    sendNotif('⚠️ Low Stock', `${f.name} — only ${f.qty} ${unit} left.`, f.buyLink||null);
  }
}

function checkAllOnStartup() {
  const low = allItems.filter(f => f.qty > 0 && f.qty <= f.minStock);
  const out = allItems.filter(f => f.qty <= 0);
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
// UTILITY
// ════════════════════════════════════════════════════════════
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function getCategoryClass(c) {
  const map = {
    'Packaging':'mat-pla', 'Shipping':'mat-petg', 'Labels':'mat-tpu',
    'Tape':'mat-abs', 'Boxes':'mat-pla', 'Bags':'mat-petg',
    'Filament':'mat-abs', 'Tools':'mat-other', 'Printing':'mat-tpu', 'Office':'mat-other'
  };
  return map[c] || 'mat-other';
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
