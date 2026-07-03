'use strict';

// ── API helper (requires running backend — open via http://localhost:3000) ───
async function api(path, options = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...options });
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Session expired');
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body.error) msg = body.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res;
}

function showApiError(err) {
  console.error(err);
  const banner = document.getElementById('apiErrorBanner');
  if (banner) {
    banner.textContent = err.message || 'Could not reach the server. Run npm start and open http://localhost:3000';
    banner.style.display = 'block';
  }
}

function clearApiError() {
  const banner = document.getElementById('apiErrorBanner');
  if (banner) banner.style.display = 'none';
}

function parseRowId(id) {
  const numId = parseInt(String(id), 10);
  return Number.isFinite(numId) && numId > 0 ? numId : null;
}

async function exportCsv(path) {
  try {
    const res = await fetch(path, { credentials: 'same-origin' });
    if (res.status === 401) {
      window.location.href = '/login.html';
      return;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text.slice(0, 120) || `Export failed (${res.status})`);
    }
    const cd = res.headers.get('content-disposition') || '';
    const match = cd.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : 'export.csv';
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    clearApiError();
  } catch (err) {
    showApiError(err);
  }
}

const deleteLocks = {
  budget: false,
  task: false,
  lead: false,
  traveler: false,
};

// ── Identity (who is using the app) ──────────────────────────────────────────
let currentUser = localStorage.getItem('cphi_user') || '';
let currentSession = { role: 'user', isAdmin: false, username: '', canViewBudget: false };

function initIdentity() {
  const banner = document.getElementById('identityBanner');
  const chip = document.getElementById('userChip');

  function setUser(name) {
    currentUser = name.trim();
    localStorage.setItem('cphi_user', currentUser);
    chip.textContent = '👤 ' + currentUser;
    banner.style.display = 'none';
  }

  if (!currentUser) {
    banner.style.display = 'flex';
  } else {
    chip.textContent = '👤 ' + currentUser;
  }

  document.getElementById('identitySave').addEventListener('click', () => {
    const v = document.getElementById('identityInput').value.trim();
    if (v) setUser(v);
  });
  document.getElementById('identityInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('identitySave').click();
  });
  chip.addEventListener('click', () => openModal('changePassword'));
  chip.title = 'Account — change password';
}

// ── Tabs & URL routing ─────────────────────────────────────────────────────────
const VALID_TABS = ['overview', 'budget', 'tasks', 'leads', 'visa', 'files', 'admin', 'activity'];

function tabFromPath() {
  const seg = window.location.pathname.replace(/^\//, '').split('/')[0];
  if (VALID_TABS.includes(seg)) return seg;
  if (window.location.pathname === '/' || window.location.pathname === '/index.html') return 'overview';
  return 'overview';
}

function tabToPath(tab) {
  return tab === 'overview' ? '/overview' : `/${tab}`;
}

function switchTab(tab, { pushState = true } = {}) {
  if (tab === 'budget' && !currentSession.canViewBudget) tab = 'overview';
  const isAdmin = currentSession.isAdmin || localStorage.getItem('cphi_is_admin') === '1';
  if (tab === 'admin' && !isAdmin) tab = 'overview';
  if (!VALID_TABS.includes(tab)) tab = 'overview';

  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.panel').forEach((p) => {
    p.classList.toggle('active', p.id === tab);
  });

  if (tab === 'activity') loadActivity();
  if (tab === 'files') loadFiles();
  if (tab === 'admin') loadAdminUsers();

  if (pushState) {
    const path = tabToPath(tab);
    if (window.location.pathname !== path) {
      history.pushState({ tab }, '', path);
    }
  }
}

window.addEventListener('popstate', () => {
  switchTab(tabFromPath(), { pushState: false });
});

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.tab === 'budget' && !currentSession.canViewBudget) return;
    switchTab(btn.dataset.tab);
  });
});

// ── Countdown ─────────────────────────────────────────────────────────────────
(function() {
  const show = new Date('2026-10-06T09:00:00');
  const days = Math.max(0, Math.ceil((show - new Date()) / 86400000));
  document.getElementById('countdownNum').textContent = days;
})();

// ── Formatting helpers ────────────────────────────────────────────────────────
let convRate = 1;
let convSymbol = '$';
let convCode = 'USD';

function fmt(n) {
  const v = Number(n || 0) * convRate;
  return convSymbol + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, m =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  return d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

function isOverdue(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr + 'T23:59:59') < new Date();
}

// ── Settings & budget cap ─────────────────────────────────────────────────────
let settings = { budget_cap: 0, currency: 'USD' };

async function loadSettings() {
  settings = await api('/api/settings');
}

async function saveSettings(obj) {
  settings = await api('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  });
}

function updateCapBar(totalEst) {
  const bar = document.getElementById('budgetCapBar');
  if (!settings.budget_cap || settings.budget_cap <= 0) { bar.style.display = 'none'; return; }
  bar.style.display = 'block';
  const pct = Math.min((totalEst / settings.budget_cap) * 100, 100);
  const fill = document.getElementById('capFill');
  fill.style.width = pct + '%';
  fill.className = 'cap-fill' + (totalEst > settings.budget_cap ? ' over' : '');
  document.getElementById('capAmounts').textContent =
    `${fmt(totalEst)} of ${fmt(settings.budget_cap)} cap · ${pct.toFixed(0)}%`;
}

document.getElementById('capBtn').addEventListener('click', () => {
  openModal('cap');
});

// ── Currency conversion ───────────────────────────────────────────────────────
const SYMBOLS = { USD:'$', EUR:'€', GBP:'£', INR:'₹', AED:'د.إ', SGD:'S$', CHF:'Fr', JPY:'¥' };

document.getElementById('currencyDate').value = new Date().toISOString().slice(0, 10);

document.getElementById('convertBtn').addEventListener('click', async () => {
  const to   = document.getElementById('currencySelect').value;
  const date = document.getElementById('currencyDate').value || new Date().toISOString().slice(0, 10);
  const badge = document.getElementById('rateBadge');

  if (to === 'USD') {
    convRate = 1; convSymbol = '$'; convCode = 'USD';
    badge.style.display = 'none';
    renderBudget(); return;
  }

  badge.textContent = 'Loading…';
  badge.style.display = 'inline';

  try {
    const r = await fetch(`https://api.frankfurter.app/${date}?from=USD&to=${to}`);
    const data = await r.json();
    convRate   = data.rates[to];
    convSymbol = SYMBOLS[to] || to + ' ';
    convCode   = to;
    badge.textContent = `1 USD = ${convRate.toFixed(4)} ${to}`;
    renderBudget();
  } catch {
    badge.textContent = 'Rate fetch failed';
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUDGET
// ═══════════════════════════════════════════════════════════════════════════════
const BUDGET_CATEGORIES = ['Booth', 'Hospitality', 'Marketing', 'Logistics', 'Travel', 'Other'];

let budgetData = [];

function vendorSummary(row) {
  const bits = [];
  if (row.vendor) bits.push(row.vendor);
  if (row.poc_name) bits.push(row.poc_name);
  if (row.poc_email) bits.push(`✉ ${row.poc_email}`);
  if (row.poc_phone) bits.push(`☎ ${row.poc_phone}`);
  return bits.join(' · ');
}

function cellOrEmpty(value, label = '—') {
  const v = String(value || '').trim();
  return v ? esc(v) : `<span class="cell-empty">${label}</span>`;
}

function refreshCategoryDatalist() {
  const dl = document.getElementById('budgetCategoryList');
  if (!dl) return;
  const cats = [...new Set([
    ...BUDGET_CATEGORIES,
    ...budgetData.map((r) => r.category),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  dl.innerHTML = cats.map((c) => `<option value="${esc(c)}"></option>`).join('');
}

async function loadBudget() {
  budgetData = await api('/api/budget');
  renderBudget();
}

function refreshBudgetTotals() {
  let totLast = 0, totEst = 0, totActual = 0;
  budgetData.forEach(row => {
    totLast   += Number(row.last_year)     || 0;
    totEst    += Number(row.this_year_est) || 0;
    totActual += Number(row.actual)        || 0;
  });
  document.getElementById('totalLastYear').textContent = fmt(totLast);
  document.getElementById('totalEst').textContent      = fmt(totEst);
  document.getElementById('totalActual').textContent   = fmt(totActual);
  document.getElementById('statBudgetEst').textContent    = fmt(totEst);
  document.getElementById('statBudgetActual').textContent = fmt(totActual) + ' actual so far';
  updateCapBar(totEst);
}

function renderBudget() {
  const body = document.getElementById('budgetBody');
  body.innerHTML = '';
  refreshCategoryDatalist();

  budgetData.forEach((row) => {
    const tr = document.createElement('tr');
    tr.dataset.id = row.id;
    const summary = vendorSummary(row);
    tr.innerHTML = `
      <td class="budget-cat-cell">
        <input class="budget-cat-input" list="budgetCategoryList" value="${esc(row.category || '')}" data-field="category" placeholder="Pick or type" title="Choose from list or type a custom category" />
      </td>
      <td class="budget-item-cell"><textarea class="budget-item-input" rows="1" data-field="item"></textarea></td>
      <td class="budget-vendor-cell">
        <div class="vendor-summary">${summary || '<span class="cell-empty">Add vendor / POC</span>'}</div>
        <button type="button" class="btn-ghost btn-sm vendor-edit-btn" data-row-id="${row.id}">Edit vendor</button>
      </td>
      <td class="budget-num-cell"><input class="num-input" type="number" min="0" step="1" value="${row.last_year || 0}" data-field="last_year" /></td>
      <td class="budget-num-cell"><input class="num-input" type="number" min="0" step="1" value="${row.this_year_est || 0}" data-field="this_year_est" /></td>
      <td class="budget-num-cell"><input class="num-input" type="number" min="0" step="1" value="${row.actual || 0}" data-field="actual" /></td>
      <td class="budget-notes-cell"><input class="budget-notes-input" value="${esc(row.notes || '')}" data-field="notes" placeholder="Notes" /></td>
      <td class="budget-actions-cell"><button type="button" class="row-delete" data-row-id="${row.id}" title="Delete this line only">✕</button></td>
    `;

    const itemEl = tr.querySelector('.budget-item-input');
    if (itemEl) {
      itemEl.value = row.item || '';
      autoExpandTextarea(itemEl, 32);
    }

    tr.querySelectorAll('input, select, textarea').forEach((inp) => {
      inp.addEventListener('change', () => saveBudgetRow(row.id, inp.dataset.field, inp.value));
      if (inp.dataset.field === 'category') {
        inp.addEventListener('focusout', () => saveBudgetRow(row.id, 'category', inp.value.trim()));
      }
      if (inp.classList.contains('budget-item-input')) {
        inp.addEventListener('input', () => autoExpandTextarea(inp, 32));
        inp.addEventListener('focusout', () => saveBudgetRow(row.id, 'item', inp.value));
      }
    });

    body.appendChild(tr);
  });

  refreshBudgetTotals();
}

async function saveBudgetRow(id, field, value) {
  const numId = parseRowId(id);
  if (!numId) return;
  const row = budgetData.find(r => parseRowId(r.id) === numId);
  if (!row) return;
  row[field] = value;
  if (field === 'category') refreshCategoryDatalist();
  refreshBudgetTotals();
  try {
    await api(`/api/budget/${numId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(row)
    });
  } catch (err) {
    showApiError(err);
    loadBudget();
  }
}

async function deleteBudgetRow(id) {
  if (deleteLocks.budget) return;
  const numId = parseRowId(id);
  if (!numId) {
    showApiError(new Error('Could not delete this row — refresh the page and try again.'));
    return;
  }

  const row = budgetData.find(r => parseRowId(r.id) === numId);
  const label = row ? `"${row.item}"` : `line #${numId}`;
  if (!confirm(`Delete only ${label}? Other rows will stay.`)) return;

  deleteLocks.budget = true;
  try {
    await api(`/api/budget/${numId}?who=${encodeURIComponent(currentUser)}`, { method: 'DELETE' });
    await loadBudget();
  } catch (err) {
    showApiError(err);
    await loadBudget();
  } finally {
    deleteLocks.budget = false;
  }
}

document.getElementById('budgetBody').addEventListener('click', (e) => {
  const vendorBtn = e.target.closest('.vendor-edit-btn[data-row-id]');
  if (vendorBtn) {
    e.preventDefault();
    const row = budgetData.find((r) => String(r.id) === String(vendorBtn.dataset.rowId));
    if (row) openModal('budgetVendor', { id: row.id });
    return;
  }
  const btn = e.target.closest('button.row-delete[data-row-id]');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  deleteBudgetRow(btn.dataset.rowId);
});

document.getElementById('addBudgetBtn').addEventListener('click', async () => {
  try {
    await api('/api/budget', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'Other', item: 'New item', last_year: 0, this_year_est: 0, actual: 0, notes: '', who: currentUser })
    });
    await loadBudget();
  } catch (err) {
    showApiError(err);
  }
});

document.getElementById('exportBudgetBtn').addEventListener('click', () => exportCsv('/api/budget/export.csv'));

// ═══════════════════════════════════════════════════════════════════════════════
// TASKS
// ═══════════════════════════════════════════════════════════════════════════════
const TASK_STATUSES = ['initiated', 'pending', 'done'];
const TASK_STATUS_LABELS = { initiated: 'Initiated', pending: 'Pending', done: 'Done' };

function taskStatusOf(row) {
  if (row?.status && TASK_STATUSES.includes(row.status)) return row.status;
  return row?.done ? 'done' : 'pending';
}

function taskIsDone(row) {
  return taskStatusOf(row) === 'done';
}

function taskStatusOptions(selected) {
  return TASK_STATUSES.map((s) =>
    `<option value="${s}" ${s === selected ? 'selected' : ''}>${TASK_STATUS_LABELS[s]}</option>`
  ).join('');
}

let taskData = [];
let taskPhaseMeta = [];

function normalizePhaseList(phases) {
  if (!Array.isArray(phases) || !phases.length) return [];
  const list = typeof phases[0] === 'string'
    ? phases.map((name) => ({ id: null, name, taskCount: 0, inDb: false, sort_order: 9999 }))
    : [...phases];
  return list.sort((a, b) => (a.sort_order ?? 9999) - (b.sort_order ?? 9999));
}

const COLLAPSED_PHASES_KEY = 'cphi_collapsed_phases';

function getCollapsedPhases() {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_PHASES_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function isPhaseCollapsed(name) {
  return getCollapsedPhases().has(String(name || '').trim());
}

function togglePhaseCollapsed(name) {
  const key = String(name || '').trim();
  if (!key) return;
  const set = getCollapsedPhases();
  if (set.has(key)) set.delete(key);
  else set.add(key);
  localStorage.setItem(COLLAPSED_PHASES_KEY, JSON.stringify([...set]));
}

function tasksForPhase(phaseName) {
  const key = String(phaseName || '').trim().toLowerCase();
  return taskData
    .filter((t) => String(t.phase || '').trim().toLowerCase() === key)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || parseRowId(a.id) - parseRowId(b.id));
}

function phaseNamesList() {
  return taskPhaseMeta.map((p) => p.name);
}
let taskListenersBound = false;
const taskSaveTimers = new Map();

function taskPutBody(row) {
  const status = taskStatusOf(row);
  return {
    phase: row.phase ?? '',
    task: row.task ?? '',
    status,
    done: status === 'done',
    owner: row.owner ?? '',
    due_date: row.due_date ?? '',
    notes: row.notes ?? '',
    who: currentUser,
  };
}

function scheduleTaskFieldSave(rowId, field, value, delayMs = 400) {
  const key = `${rowId}:${field}`;
  const existing = taskSaveTimers.get(key);
  if (existing) clearTimeout(existing);
  if (delayMs <= 0) {
    taskSaveTimers.delete(key);
    saveTaskRow(rowId, field, value);
    return;
  }
  taskSaveTimers.set(key, setTimeout(() => {
    taskSaveTimers.delete(key);
    saveTaskRow(rowId, field, value);
  }, delayMs));
}

function bindTaskListeners() {
  if (taskListenersBound) return;
  taskListenersBound = true;
  const container = document.getElementById('taskPhases');
  if (!container) return;

  container.addEventListener('change', (e) => {
    const el = e.target;
    if (el.classList.contains('notes-input') || el.classList.contains('task-text-input')) return;
    const rowEl = el.closest('.task-row');
    const rowId = rowEl?.dataset?.rowId;
    if (!rowId) return;

    if (el.classList.contains('task-status-select')) saveTaskRow(rowId, 'status', el.value);
    else if (el instanceof HTMLInputElement && el.classList.contains('owner-input')) saveTaskRow(rowId, 'owner', el.value);
    else if (el instanceof HTMLInputElement && el.classList.contains('due-input')) saveTaskRow(rowId, 'due_date', el.value);
  });

  container.addEventListener('input', (e) => {
    const inp = e.target;
    if (!(inp instanceof HTMLTextAreaElement)) return;
    const rowId = inp.closest('.task-row')?.dataset?.rowId;
    if (inp.classList.contains('notes-input')) {
      autoExpandTextarea(inp, 52);
      if (rowId) scheduleTaskFieldSave(rowId, 'notes', inp.value);
      return;
    }
    if (inp.classList.contains('task-text-input')) {
      autoExpandTextarea(inp, 36);
      if (rowId) scheduleTaskFieldSave(rowId, 'task', inp.value);
    }
  });

  container.addEventListener('focusout', (e) => {
    const inp = e.target;
    if (!(inp instanceof HTMLTextAreaElement)) return;
    const rowId = inp.closest('.task-row')?.dataset?.rowId;
    if (!rowId) return;
    if (inp.classList.contains('notes-input')) scheduleTaskFieldSave(rowId, 'notes', inp.value, 0);
    else if (inp.classList.contains('task-text-input')) scheduleTaskFieldSave(rowId, 'task', inp.value, 0);
  });
}

function autoExpandTextarea(el, minPx = 36) {
  el.style.height = 'auto';
  el.style.height = `${Math.max(el.scrollHeight, minPx)}px`;
}

function autoResizeNotes(el) {
  autoExpandTextarea(el, 52);
}

async function loadTasks() {
  const tasks = await api('/api/tasks');
  taskData = tasks;
  let phases = [];
  try {
    phases = await api('/api/task-phases');
  } catch (err) {
    console.warn('task-phases API unavailable, using phases from tasks', err.message);
    phases = [...new Set(tasks.map((t) => t.phase).filter(Boolean))];
  }
  taskPhaseMeta = normalizePhaseList(phases).map((p) => ({
    ...p,
    taskCount: tasks.filter(
      (t) => String(t.phase || '').trim().toLowerCase() === String(p.name || '').trim().toLowerCase()
    ).length,
  }));
  renderTasks();
}

function showAdminTabIfAllowed(isAdmin) {
  const adminTab = document.getElementById('adminTabBtn');
  if (!adminTab) return;
  const allowed = isAdmin || localStorage.getItem('cphi_is_admin') === '1';
  adminTab.style.display = allowed ? '' : 'none';
}

function applyBudgetVisibility(canView) {
  currentSession.canViewBudget = !!canView;
  const budgetTab = document.getElementById('budgetTabBtn');
  const budgetStat = document.getElementById('overviewBudgetStat');
  const capBar = document.getElementById('budgetCapBar');
  if (budgetTab) budgetTab.style.display = canView ? '' : 'none';
  if (budgetStat) budgetStat.style.display = canView ? '' : 'none';
  if (capBar && !canView) capBar.style.display = 'none';
  if (!canView && document.getElementById('budget')?.classList.contains('active')) {
    switchTab('overview', { pushState: true });
  }
}

function refreshTaskStats() {
  const doneCount = taskData.filter((t) => taskIsDone(t)).length;
  document.getElementById('statTasks').textContent = `${doneCount}/${taskData.length}`;
}

function applyTaskRowStatus(rowEl, status) {
  if (!rowEl) return;
  rowEl.classList.toggle('task-done', status === 'done');
  const sel = rowEl.querySelector('.task-status-select');
  if (sel) {
    sel.value = status;
    sel.className = `task-status-select status-${status}`;
  }
}

/** Same pattern as saveBudgetRow — update local row, PUT full row to API */
async function saveTaskRow(id, field, value) {
  const numId = parseRowId(id);
  if (!numId) return;
  const row = taskData.find((t) => parseRowId(t.id) === numId);
  if (!row) return;
  if (field !== 'status' && String(row[field] ?? '') === String(value)) return;
  if (field === 'status') {
    row.status = value;
    row.done = value === 'done';
  } else {
    row[field] = value;
  }
  if (field === 'status') {
    const el = document.querySelector(`.task-row[data-row-id="${row.id}"]`);
    applyTaskRowStatus(el, value);
  }
  refreshTaskStats();
  try {
    const payload = taskPutBody(row);
    if (field !== 'status') payload[field] = value;
    const updated = await api(`/api/tasks/${numId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    Object.assign(row, updated);
    clearApiError();
    if (field === 'status') renderTasks();
  } catch (err) {
    showApiError(err);
    await loadTasks();
  }
}

function renderTasks() {
  const container = document.getElementById('taskPhases');
  container.innerHTML = '';
  const phases = taskPhaseMeta.length
    ? [...taskPhaseMeta]
    : [...new Set(taskData.map((t) => t.phase))].map((name) => ({ id: null, name, taskCount: 0, inDb: false }));
  let doneCount = 0;

  if (!phases.length && !taskData.length) {
    container.innerHTML = '<div class="empty-state">No tasks yet — add a phase or task to get started.</div>';
    document.getElementById('statTasks').textContent = '0/0';
    return;
  }

  phases.forEach((meta) => {
    const phase = typeof meta === 'string' ? meta : meta.name;
    const phaseId = typeof meta === 'object' ? meta.id : null;
    const items = tasksForPhase(phase);
    const phaseDone = items.filter((t) => taskIsDone(t)).length;
    doneCount += phaseDone;
    const collapsed = isPhaseCollapsed(phase);

    const group = document.createElement('div');
    group.className = 'phase-group' + (collapsed ? ' collapsed' : '');
    group.dataset.phaseName = phase;
    if (phaseId) group.dataset.phaseId = phaseId;

    group.innerHTML = `
      <div class="phase-header">
        <div class="phase-header-left">
          <button type="button" class="phase-collapse-btn" title="${collapsed ? 'Expand phase' : 'Collapse phase'}" aria-expanded="${!collapsed}">${collapsed ? '▶' : '▼'}</button>
          <button type="button" class="phase-drag-handle" draggable="true" title="Drag to reorder phase" aria-label="Drag to reorder phase">⋮⋮</button>
          <span class="phase-title">${esc(phase)}</span>
        </div>
        <div class="phase-header-actions">
          <button type="button" class="btn-ghost phase-add-btn" data-phase="${esc(phase)}">+ Add task</button>
          <button type="button" class="phase-delete-btn" data-phase-id="${phaseId || ''}" data-phase-name="${esc(phase)}" title="Delete this phase">✕</button>
          <span class="phase-done-count">${phaseDone}/${items.length} done</span>
        </div>
      </div>
      <div class="phase-body">
        <div class="task-col-headers">
          <span></span><span>Status</span><span>Task</span><span>Owner</span><span>Due date</span><span>Notes</span><span>Actions</span><span></span>
        </div>
      </div>
    `;

    const body = group.querySelector('.phase-body');

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'phase-empty';
      empty.textContent = 'No tasks in this phase yet — click + Add task above.';
      body.appendChild(empty);
    }

    items.forEach((t) => {
      const status = taskStatusOf(t);
      const row = document.createElement('div');
      row.className = 'task-row' + (status === 'done' ? ' task-done' : '');
      row.dataset.rowId = t.id;
      const overdue = status !== 'done' && isOverdue(t.due_date);

      row.innerHTML = `
        <button type="button" class="task-drag-handle" draggable="true" title="Drag to reorder task" aria-label="Drag to reorder task">⋮⋮</button>
        <select class="task-status-select status-${status}" aria-label="Task status">${taskStatusOptions(status)}</select>
        <textarea class="task-text-input" rows="1" placeholder="Task"></textarea>
        <input class="owner-input" placeholder="Owner" value="${esc(t.owner || '')}" />
        <input class="due-input ${overdue ? 'overdue' : ''}" type="date" value="${esc(t.due_date || '')}" title="${overdue ? 'Overdue!' : 'Due date'}" />
        <div class="notes-cell">
          <textarea class="notes-input" rows="2" placeholder="Notes"></textarea>
          <button type="button" class="notes-expand-btn" data-row-id="${t.id}" title="Expand notes">⤢</button>
        </div>
        <div class="task-actions">
          ${t.owner && t.owner.includes('@')
            ? `<button type="button" class="email-btn" title="Send follow-up email to ${esc(t.owner)}">📧</button>`
            : `<button type="button" class="email-btn" title="WhatsApp follow-up">💬</button>`
          }
        </div>
        <button type="button" class="row-delete" data-row-id="${t.id}" title="Delete this task only">✕</button>
      `;

      const taskEl = row.querySelector('.task-text-input');
      taskEl.value = t.task || '';
      autoExpandTextarea(taskEl, 36);

      const notesEl = row.querySelector('.notes-input');
      notesEl.value = t.notes || '';
      autoResizeNotes(notesEl);

      row.querySelector('.email-btn').addEventListener('click', () => {
        const owner = t.owner || '';
        if (owner.includes('@')) openEmailFollowUp(t);
        else openWhatsAppFollowUp(t);
      });

      row.querySelector('.task-status-select').addEventListener('change', (e) => {
        e.target.className = `task-status-select status-${e.target.value}`;
      });

      body.appendChild(row);
    });
    container.appendChild(group);
  });

  document.getElementById('statTasks').textContent = `${doneCount}/${taskData.length}`;
}

async function deleteTask(id) {
  if (deleteLocks.task) return;
  const numId = parseRowId(id);
  if (!numId) {
    showApiError(new Error('Could not delete this task — refresh and try again.'));
    return;
  }
  const row = taskData.find(t => parseRowId(t.id) === numId);
  const label = row ? `"${row.task}"` : `task #${numId}`;
  if (!confirm(`Delete only ${label}? Other tasks will stay.`)) return;

  deleteLocks.task = true;
  try {
    await api(`/api/tasks/${numId}?who=${encodeURIComponent(currentUser)}`, { method: 'DELETE' });
    await loadTasks();
  } catch (err) {
    showApiError(err);
    await loadTasks();
  } finally {
    deleteLocks.task = false;
  }
}

document.getElementById('taskPhases').addEventListener('click', (e) => {
  const collapseBtn = e.target.closest('.phase-collapse-btn');
  if (collapseBtn) {
    e.preventDefault();
    const group = collapseBtn.closest('.phase-group');
    const name = group?.dataset?.phaseName;
    if (!name) return;
    togglePhaseCollapsed(name);
    group.classList.toggle('collapsed');
    const collapsed = group.classList.contains('collapsed');
    collapseBtn.textContent = collapsed ? '▶' : '▼';
    collapseBtn.title = collapsed ? 'Expand phase' : 'Collapse phase';
    collapseBtn.setAttribute('aria-expanded', String(!collapsed));
    return;
  }
  const delPhaseBtn = e.target.closest('.phase-delete-btn[data-phase-name]');
  if (delPhaseBtn) {
    e.preventDefault();
    deletePhase(delPhaseBtn.dataset.phaseId, delPhaseBtn.dataset.phaseName);
    return;
  }
  const phaseBtn = e.target.closest('.phase-add-btn[data-phase]');
  if (phaseBtn) {
    e.preventDefault();
    openModal('task', { phase: phaseBtn.dataset.phase });
    return;
  }
  const expandBtn = e.target.closest('.notes-expand-btn[data-row-id]');
  if (expandBtn) {
    e.preventDefault();
    const row = taskData.find((t) => String(t.id) === String(expandBtn.dataset.rowId));
    if (row) openModal('taskNotes', { id: row.id, notes: row.notes || '' });
    return;
  }
  const btn = e.target.closest('button.row-delete[data-row-id]');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  deleteTask(btn.dataset.rowId);
});

document.getElementById('addTaskBtn').addEventListener('click', () => openModal('task'));
document.getElementById('addPhaseBtn').addEventListener('click', () => openModal('addPhase'));
document.getElementById('exportTasksBtn').addEventListener('click', () => exportCsv('/api/tasks/export.csv'));

async function deletePhase(phaseId, phaseName) {
  const items = taskData.filter(
    (t) => String(t.phase || '').trim().toLowerCase() === String(phaseName || '').trim().toLowerCase()
  );
  const msg = items.length
    ? `Delete phase "${phaseName}" and all ${items.length} task(s) inside it?`
    : `Delete empty phase "${phaseName}"?`;
  if (!confirm(msg)) return;

  try {
    const q = items.length ? '?deleteTasks=1' : '';
    if (phaseId) {
      await api(`/api/task-phases/${phaseId}${q}`, { method: 'DELETE' });
    } else {
      await api(`/api/task-phases?phase=${encodeURIComponent(phaseName)}${items.length ? '&deleteTasks=1' : ''}`, { method: 'DELETE' });
    }
    await loadTasks();
    clearApiError();
  } catch (err) {
    showApiError(err);
  }
}

// WhatsApp tasks summary
document.getElementById('whatsappTasksBtn').addEventListener('click', () => {
  const pending = taskData.filter(t => !taskIsDone(t));
  const overdue = pending.filter(t => isOverdue(t.due_date));
  let msg = `🦜 *HRV CPHI Milan 2026 — Task Update*\n\n`;
  msg += `✅ Done: ${taskData.filter(t => taskIsDone(t)).length}/${taskData.length}\n`;
  msg += `🟡 Pending: ${taskData.filter(t => taskStatusOf(t) === 'pending').length}\n`;
  msg += `🔵 Initiated: ${taskData.filter(t => taskStatusOf(t) === 'initiated').length}\n`;
  if (overdue.length) msg += `🚨 Overdue: ${overdue.length}\n`;
  msg += `\n*Pending tasks:*\n`;
  pending.slice(0, 10).forEach(t => {
    msg += `• ${t.task}${t.owner ? ' (' + t.owner + ')' : ''}${t.due_date ? ' · due ' + fmtDate(t.due_date) : ''}\n`;
  });
  openModal('whatsapp', { message: msg });
});

// ═══════════════════════════════════════════════════════════════════════════════
// LEADS
// ═══════════════════════════════════════════════════════════════════════════════
let leadData = [];

async function loadLeads() {
  leadData = await api('/api/leads');
  renderLeads(leadData);
  document.getElementById('statLeads').textContent = leadData.length;
}

function renderLeads(leads) {
  const empty = document.getElementById('leadEmpty');
  const wrap = document.getElementById('leadTableWrap');
  const body = document.getElementById('leadTableBody');
  if (!leads.length) {
    empty.style.display = 'block';
    wrap.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  wrap.style.display = '';
  body.innerHTML = '';

  leads.forEach((l) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="priority-badge priority-${esc(l.priority || 'Medium')}">${esc(l.priority || 'Medium')}</span></td>
      <td class="lead-contact-cell"><strong>${esc(l.name)}</strong></td>
      <td>${cellOrEmpty([l.company, l.role].filter(Boolean).join(' · '))}</td>
      <td class="lead-email-cell">${l.email ? `<a href="mailto:${esc(l.email)}" class="link-quiet">${esc(l.email)}</a>` : cellOrEmpty('')}</td>
      <td>${cellOrEmpty(l.phone)}</td>
      <td>${cellOrEmpty(l.country)}</td>
      <td class="lead-interest-cell">${cellOrEmpty(l.interest)}</td>
      <td>${l.follow_up_date ? esc(fmtDate(l.follow_up_date)) : cellOrEmpty('')}</td>
      <td class="lead-notes-cell" title="${esc(l.notes || '')}">${cellOrEmpty(l.notes)}</td>
      <td class="lead-meta-cell"><span>${esc(l.captured_by || '—')}</span><span class="lead-time">${timeAgo(l.created_at)}</span></td>
      <td class="lead-actions-cell">
        ${l.email ? `<button type="button" class="btn-ghost btn-sm lead-email-btn" data-id="${l.id}" title="Follow-up email">📧</button>` : ''}
        <button type="button" class="row-delete" data-row-id="${l.id}" title="Delete lead">✕</button>
      </td>
    `;
    body.appendChild(tr);
  });
}

async function deleteLead(id) {
  if (deleteLocks.lead) return;
  const numId = parseRowId(id);
  if (!numId) {
    showApiError(new Error('Could not delete this lead — refresh and try again.'));
    return;
  }
  const row = leadData.find(l => parseRowId(l.id) === numId);
  const label = row ? row.name : `lead #${numId}`;
  if (!confirm(`Delete only ${label}? Other leads will stay.`)) return;

  deleteLocks.lead = true;
  try {
    await api(`/api/leads/${numId}?who=${encodeURIComponent(currentUser)}`, { method: 'DELETE' });
    await loadLeads();
  } catch (err) {
    showApiError(err);
    await loadLeads();
  } finally {
    deleteLocks.lead = false;
  }
}

document.getElementById('leadTableBody').addEventListener('click', (e) => {
  const emailBtn = e.target.closest('.lead-email-btn[data-id]');
  if (emailBtn) {
    e.preventDefault();
    const l = leadData.find((x) => String(x.id) === String(emailBtn.dataset.id));
    if (!l?.email) return;
    const subject = encodeURIComponent('Following up from CPHI Milan 2026 — HRV Pharma');
    const body = encodeURIComponent(
      `Dear ${l.name},\n\nIt was great meeting you at our booth at CPHI Worldwide Milan 2026.\n\n` +
      `${l.interest ? `We discussed your interest in ${l.interest}. ` : ''}` +
      `I'd love to continue the conversation and explore how HRV Pharma can support your requirements.\n\n` +
      `Please feel free to reach out at your convenience.\n\nBest regards,\n${currentUser || 'HRV Pharma Team'}`
    );
    window.open(`mailto:${l.email}?subject=${subject}&body=${body}`);
    return;
  }
  const btn = e.target.closest('button.row-delete[data-row-id]');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  deleteLead(btn.dataset.rowId);
});

document.getElementById('newLeadBtn').addEventListener('click', () => openModal('lead'));
document.getElementById('exportLeadsBtn').addEventListener('click', () => exportCsv('/api/leads/export.csv'));

// ═══════════════════════════════════════════════════════════════════════════════
// VISA / TRAVELERS
// ═══════════════════════════════════════════════════════════════════════════════
let travelerData = [];

const CHECKS = [
  { key: 'visa_applied',   label: 'Schengen visa applied',    dueKey: 'visa_apply_due' },
  { key: 'visa_received',  label: 'Schengen visa received',   dueKey: '' },
  { key: 'flight_booked',  label: 'Flight booked',             dueKey: 'flight_due' },
  { key: 'hotel_booked',   label: 'Hotel booked',              dueKey: 'hotel_due' },
  { key: 'insurance',      label: 'Travel insurance sorted',   dueKey: '' },
  { key: 'forex',          label: 'Currency / forex ready',    dueKey: '' },
];

async function loadTravelers() {
  travelerData = await api('/api/travelers');
  renderTravelers();
}

function renderTravelers() {
  const container = document.getElementById('travelerList');
  container.innerHTML = '';

  let readyCount = 0;
  travelerData.forEach(t => {
    const done = CHECKS.filter(c => t[c.key]).length;
    if (done === CHECKS.length) readyCount++;

    const card = document.createElement('div');
    card.className = 'traveler-card';

    const checksHtml = CHECKS.map(c => `
      <div class="check-item ${t[c.key] ? 'done-item' : ''}">
        <input type="checkbox" id="chk_${t.id}_${c.key}" ${t[c.key] ? 'checked' : ''} data-key="${c.key}" />
        <label for="chk_${t.id}_${c.key}">
          ${c.label}
          ${c.dueKey ? `<span class="check-due">${t[c.dueKey] ? 'Due: ' + fmtDate(t[c.dueKey]) : ''}</span>` : ''}
        </label>
      </div>
    `).join('');

    card.innerHTML = `
      <div class="traveler-header">
        <div>
          <div class="traveler-name">${esc(t.name)}</div>
          <div class="traveler-passport">
            ${t.passport ? 'Passport: ' + esc(t.passport) : ''}
            ${t.passport_expiry ? ' · Expires: ' + fmtDate(t.passport_expiry) : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <span class="traveler-progress">${done}/${CHECKS.length} steps done</span>
          <button type="button" class="row-delete" data-row-id="${t.id}" title="Remove this traveler only">✕</button>
        </div>
      </div>
      <div class="traveler-body">
        <div class="checklist-grid">${checksHtml}</div>
        <div class="traveler-notes">
          <input placeholder="Notes (e.g. passport renewal needed, visa appointment date…)" value="${esc(t.notes||'')}" />
        </div>
        <div class="traveler-actions">
          <button type="button" class="btn-ghost edit-traveler-btn">✏ Edit passport / due dates</button>
        </div>
      </div>
    `;

    const rowId = t.id;
    card.querySelectorAll('input[data-key]').forEach(inp => {
      inp.addEventListener('change', () => {
        const updated = { ...t, [inp.dataset.key]: inp.checked };
        saveTraveler(rowId, updated);
      });
    });

    card.querySelector('.traveler-notes input').addEventListener('change', e => {
      saveTraveler(rowId, { ...t, notes: e.target.value });
    });

    card.querySelector('.edit-traveler-btn').addEventListener('click', () => openModal('traveler', t));

    container.appendChild(card);
  });

  if (!travelerData.length) {
    container.innerHTML = '<div class="empty-state">🛂 No travelers added yet. Click "+ Add traveler" to start tracking visas.</div>';
  }

  document.getElementById('statVisas').textContent = `${readyCount}/${travelerData.length}`;
}

async function saveTraveler(id, body) {
  const numId = parseRowId(id);
  if (!numId) return;
  try {
    const updated = await api(`/api/travelers/${numId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const idx = travelerData.findIndex(t => parseRowId(t.id) === numId);
    if (idx >= 0) travelerData[idx] = updated;
    renderTravelers();
  } catch (err) {
    showApiError(err);
    await loadTravelers();
  }
}

async function deleteTraveler(id) {
  if (deleteLocks.traveler) return;
  const numId = parseRowId(id);
  if (!numId) {
    showApiError(new Error('Could not remove this traveler — refresh and try again.'));
    return;
  }
  const row = travelerData.find(t => parseRowId(t.id) === numId);
  const label = row ? row.name : `traveler #${numId}`;
  if (!confirm(`Remove only ${label}? Other travelers will stay.`)) return;

  deleteLocks.traveler = true;
  try {
    await api(`/api/travelers/${numId}?who=${encodeURIComponent(currentUser)}`, { method: 'DELETE' });
    await loadTravelers();
  } catch (err) {
    showApiError(err);
    await loadTravelers();
  } finally {
    deleteLocks.traveler = false;
  }
}

document.getElementById('travelerList').addEventListener('click', (e) => {
  const btn = e.target.closest('button.row-delete[data-row-id]');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  deleteTraveler(btn.dataset.rowId);
});

document.getElementById('addTravelerBtn').addEventListener('click', () => openModal('addTraveler'));
document.getElementById('exportTravelersBtn').addEventListener('click', () => exportCsv('/api/travelers/export.csv'));

// ═══════════════════════════════════════════════════════════════════════════════
// FILES
// ═══════════════════════════════════════════════════════════════════════════════
let fileData = [];
let fileSearchQuery = '';
let previewFileId = null;
const fileCommentTimers = new Map();
let fileListenersBound = false;

function isImageFile(file) {
  return String(file?.mime_type || '').startsWith('image/');
}

function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

async function loadFiles() {
  fileData = await api('/api/files');
  renderFileGrid();
}

function renderFileGrid() {
  const grid = document.getElementById('fileGrid');
  const q = fileSearchQuery.trim().toLowerCase();
  const items = q
    ? fileData.filter((f) =>
      (f.original_name || '').toLowerCase().includes(q)
      || (f.comment || '').toLowerCase().includes(q))
    : fileData;

  if (!items.length) {
    grid.innerHTML = q
      ? '<div class="empty-state">No files match your search.</div>'
      : '<div class="empty-state">No files yet — upload images or PDFs for booth photos, brochures, and plans.</div>';
    return;
  }

  grid.innerHTML = '';
  items.forEach((f) => {
    const card = document.createElement('article');
    card.className = 'file-card';
    const thumbHtml = isImageFile(f)
      ? `<img class="file-thumb" src="/api/files/${f.id}/content" alt="${esc(f.original_name)}" loading="lazy" />`
      : '<div class="file-pdf-thumb" aria-hidden="true"><span class="file-pdf-label">PDF</span></div>';

    card.innerHTML = `
      <button type="button" class="file-thumb-btn" data-file-id="${f.id}" aria-label="Preview ${esc(f.original_name)}">
        ${thumbHtml}
      </button>
      <div class="file-card-body">
        <div class="file-name" title="${esc(f.original_name)}">${esc(f.original_name)}</div>
        <input type="text" class="file-comment-input" data-file-id="${f.id}" placeholder="Add comment…" value="${esc(f.comment || '')}" />
        <div class="file-meta">
          <span title="${esc(fmtDateTime(f.updated_at))}">Updated ${timeAgo(f.updated_at)}</span>
          <span class="file-size">${formatFileSize(f.size_bytes)}</span>
        </div>
      </div>
      <button type="button" class="row-delete file-delete" data-file-id="${f.id}" title="Delete file">✕</button>
    `;
    grid.appendChild(card);
  });
}

async function saveFileComment(id, comment) {
  const numId = parseRowId(id);
  if (!numId) return;
  const row = fileData.find((f) => parseRowId(f.id) === numId);
  if (!row || String(row.comment ?? '') === String(comment)) return;

  try {
    const updated = await api(`/api/files/${numId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment }),
    });
    Object.assign(row, updated);
    if (previewFileId === numId) {
      document.getElementById('previewComment').value = updated.comment || '';
      document.getElementById('previewMeta').textContent = buildPreviewMeta(updated);
    }
    const metaSpan = document.querySelector(
      `.file-comment-input[data-file-id="${row.id}"]`
    )?.closest('.file-card')?.querySelector('.file-meta span');
    if (metaSpan) {
      metaSpan.textContent = `Updated ${timeAgo(updated.updated_at)}`;
      metaSpan.title = fmtDateTime(updated.updated_at);
    }
    clearApiError();
  } catch (err) {
    showApiError(err);
  }
}

function buildPreviewMeta(file) {
  return `${file.original_name} · ${formatFileSize(file.size_bytes)} · Updated ${fmtDateTime(file.updated_at)}`;
}

function openFilePreview(id) {
  const numId = parseRowId(id);
  const file = fileData.find((f) => parseRowId(f.id) === numId);
  if (!file) return;

  previewFileId = numId;
  const content = document.getElementById('previewContent');
  if (isImageFile(file)) {
    content.innerHTML = `<img class="preview-image" src="/api/files/${file.id}/content" alt="${esc(file.original_name)}" />`;
  } else {
    content.innerHTML = `<iframe class="preview-pdf" src="/api/files/${file.id}/content" title="${esc(file.original_name)}"></iframe>`;
  }

  document.getElementById('previewComment').value = file.comment || '';
  document.getElementById('previewMeta').textContent = buildPreviewMeta(file);
  const backdrop = document.getElementById('previewBackdrop');
  backdrop.classList.add('open');
  backdrop.setAttribute('aria-hidden', 'false');
}

function closeFilePreview() {
  const backdrop = document.getElementById('previewBackdrop');
  backdrop.classList.remove('open');
  backdrop.setAttribute('aria-hidden', 'true');
  document.getElementById('previewContent').innerHTML = '';
  previewFileId = null;
}

async function deleteFile(id) {
  const numId = parseRowId(id);
  if (!numId) return;
  const row = fileData.find((f) => parseRowId(f.id) === numId);
  const label = row ? `"${row.original_name}"` : `file #${numId}`;
  if (!confirm(`Delete ${label}? This cannot be undone.`)) return;

  try {
    await api(`/api/files/${numId}?who=${encodeURIComponent(currentUser)}`, { method: 'DELETE' });
    if (previewFileId === numId) closeFilePreview();
    await loadFiles();
    clearApiError();
  } catch (err) {
    showApiError(err);
  }
}

async function uploadFile(file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/files', { method: 'POST', credentials: 'same-origin', body: form });
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Session expired');
  }
  if (!res.ok) {
    let msg = `Upload failed (${res.status})`;
    try {
      const body = await res.json();
      if (body.error) msg = body.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

function bindFileListeners() {
  if (fileListenersBound) return;
  fileListenersBound = true;

  const wrap = document.querySelector('.file-grid-wrap');
  wrap.addEventListener('click', (e) => {
    const thumbBtn = e.target.closest('.file-thumb-btn[data-file-id]');
    if (thumbBtn) {
      e.preventDefault();
      openFilePreview(thumbBtn.dataset.fileId);
      return;
    }
    const delBtn = e.target.closest('.file-delete[data-file-id]');
    if (delBtn) {
      e.preventDefault();
      e.stopPropagation();
      deleteFile(delBtn.dataset.fileId);
    }
  });

  wrap.addEventListener('input', (e) => {
    const inp = e.target;
    if (!(inp instanceof HTMLInputElement) || !inp.classList.contains('file-comment-input')) return;
    const fid = inp.dataset.fileId;
    if (fileCommentTimers.has(fid)) clearTimeout(fileCommentTimers.get(fid));
    fileCommentTimers.set(fid, setTimeout(() => {
      fileCommentTimers.delete(fid);
      saveFileComment(fid, inp.value);
    }, 400));
  });

  wrap.addEventListener('focusout', (e) => {
    const inp = e.target;
    if (!(inp instanceof HTMLInputElement) || !inp.classList.contains('file-comment-input')) return;
    const fid = inp.dataset.fileId;
    if (fileCommentTimers.has(fid)) clearTimeout(fileCommentTimers.get(fid));
    saveFileComment(fid, inp.value);
  });

  document.getElementById('fileSearchInput').addEventListener('input', (e) => {
    fileSearchQuery = e.target.value;
    renderFileGrid();
  });

  document.getElementById('uploadFileBtn').addEventListener('click', () => {
    document.getElementById('fileInput').click();
  });

  document.getElementById('fileInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const row = await uploadFile(file);
      fileData.unshift(row);
      renderFileGrid();
      clearApiError();
    } catch (err) {
      showApiError(err);
    }
  });

  document.getElementById('exportFilesBtn').addEventListener('click', () => exportCsv('/api/files/export.csv'));

  document.getElementById('previewClose').addEventListener('click', closeFilePreview);
  document.getElementById('previewBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'previewBackdrop') closeFilePreview();
  });

  const previewComment = document.getElementById('previewComment');
  let previewCommentTimer;
  previewComment.addEventListener('input', () => {
    if (!previewFileId) return;
    clearTimeout(previewCommentTimer);
    previewCommentTimer = setTimeout(() => saveFileComment(previewFileId, previewComment.value), 400);
  });
  previewComment.addEventListener('focusout', () => {
    if (!previewFileId) return;
    clearTimeout(previewCommentTimer);
    saveFileComment(previewFileId, previewComment.value);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('previewBackdrop').classList.contains('open')) {
      closeFilePreview();
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN
// ═══════════════════════════════════════════════════════════════════════════════
let adminUsers = [];

async function loadAdminUsers() {
  adminUsers = await api('/api/admin/users');
  renderAdminUsers();
}

function renderAdminUsers() {
  const body = document.getElementById('adminUsersBody');
  if (!body) return;
  if (!adminUsers.length) {
    body.innerHTML = '<tr><td colspan="6" class="admin-empty">No users yet — create one above.</td></tr>';
    return;
  }
  body.innerHTML = '';
  adminUsers.forEach((u) => {
    const tr = document.createElement('tr');
    if (!u.enabled) tr.classList.add('user-disabled');
    const isSelf = currentSession.username && u.username === currentSession.username;
    const isAdminUser = u.role === 'admin';
    const budgetOn = isAdminUser || u.can_view_budget;
    tr.innerHTML = `
      <td><code class="user-code">${esc(u.username)}</code></td>
      <td>${esc(u.display_name)}</td>
      <td><span class="role-badge role-${esc(u.role)}">${esc(u.role)}</span></td>
      <td><span class="status-pill ${u.enabled ? 'status-on' : 'status-off'}">${u.enabled ? 'Active' : 'Disabled'}</span></td>
      <td class="admin-budget-cell">
        <label class="toggle-switch" title="${isAdminUser ? 'Admins always have budget access' : 'Allow Budget tab & data'}">
          <input type="checkbox" data-action="budget-access" data-id="${u.id}" ${budgetOn ? 'checked' : ''} ${isAdminUser ? 'disabled' : ''} />
          <span class="toggle-slider"></span>
        </label>
      </td>
      <td class="admin-actions-cell">
        <button type="button" class="btn-ghost btn-sm" data-action="reset" data-id="${u.id}">Reset pwd</button>
        <button type="button" class="btn-ghost btn-sm" data-action="toggle" data-id="${u.id}">${u.enabled ? 'Disable' : 'Enable'}</button>
        <button type="button" class="btn-ghost btn-sm btn-danger-text" data-action="delete" data-id="${u.id}" ${isSelf ? 'disabled title="Cannot delete yourself"' : ''}>Delete</button>
      </td>
    `;
    body.appendChild(tr);
  });
}

document.getElementById('createUserBtn')?.addEventListener('click', () => openModal('createUser'));

document.getElementById('adminUsersBody')?.addEventListener('change', async (e) => {
  const input = e.target.closest('input[data-action="budget-access"]');
  if (!input || input.disabled) return;
  const id = input.dataset.id;
  const user = adminUsers.find((u) => String(u.id) === String(id));
  if (!user) return;
  const next = input.checked;
  try {
    await api(`/api/admin/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canViewBudget: next }),
    });
    await loadAdminUsers();
    if (String(currentSession.username) === String(user.username)) {
      applyBudgetVisibility(next);
    }
    clearApiError();
  } catch (err) {
    input.checked = !next;
    showApiError(err);
  }
});

document.getElementById('adminUsersBody')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const user = adminUsers.find((u) => String(u.id) === String(id));
  if (!user) return;

  if (btn.dataset.action === 'reset') {
    openModal('resetPassword', { id: user.id, username: user.username });
  } else if (btn.dataset.action === 'toggle') {
    try {
      await api(`/api/admin/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !user.enabled }),
      });
      await loadAdminUsers();
      clearApiError();
    } catch (err) {
      showApiError(err);
    }
  } else if (btn.dataset.action === 'delete') {
    if (!confirm(`Delete user "${user.username}"? This cannot be undone.`)) return;
    try {
      await api(`/api/admin/users/${id}`, { method: 'DELETE' });
      await loadAdminUsers();
      clearApiError();
    } catch (err) {
      showApiError(err);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ACTIVITY LOG
// ═══════════════════════════════════════════════════════════════════════════════
const ACTION_ICONS = {
  'Added task': '✅', 'Deleted task': '🗑️', 'Completed task': '🎉',
  'Added budget item': '💰', 'Deleted budget item': '🗑️',
  'Captured lead': '🤝', 'Deleted lead': '🗑️',
  'Added traveler': '🛂', 'Removed traveler': '🗑️',
  'Uploaded file': '📁', 'Deleted file': '🗑️',
  'Created user': '👤', 'Updated user': '✏️', 'Disabled user': '🚫', 'Enabled user': '✅',
  'Reset user password': '🔑', 'Deleted user': '🗑️', 'Changed own password': '🔒',
  'Granted budget access': '💰', 'Revoked budget access': '🚫',
  'Added task phase': '📂', 'Deleted task phase': '🗑️',
  'Updated task status': '🔄', 'Reopened task': '↩️',
};

async function loadActivity() {
  const logs = await api('/api/activity');
  const container = document.getElementById('activityList');
  if (!logs.length) {
    container.innerHTML = '<div class="empty-state">No activity recorded yet — changes you make will appear here.</div>';
    return;
  }
  container.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'activity-list';
  logs.forEach(l => {
    const item = document.createElement('div');
    item.className = 'activity-item';
    const icon = ACTION_ICONS[l.action] || '📝';
    item.innerHTML = `
      <span class="act-icon">${icon}</span>
      <div class="act-body">
        <span class="act-who">${esc(l.who || 'Someone')}</span>
        <span class="act-action"> ${esc(l.action).toLowerCase()}: </span>
        <span class="act-detail">${esc(l.detail)}</span>
      </div>
      <span class="act-ts">${timeAgo(l.ts)}</span>
    `;
    list.appendChild(item);
  });
  container.appendChild(list);
}

document.getElementById('exportActivityBtn').addEventListener('click', () => exportCsv('/api/activity/export.csv'));

// ═══════════════════════════════════════════════════════════════════════════════
// MODAL
// ═══════════════════════════════════════════════════════════════════════════════
const backdrop = document.getElementById('modalBackdrop');
const modal    = document.getElementById('modal');

function closeModal() {
  backdrop.classList.remove('open');
  modal.classList.remove('modal-wide');
}
backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });

function openEmailFollowUp(task) {
  const subject = encodeURIComponent(`Action needed: "${task.task}" — CPHI Milan 2026`);
  const due = task.due_date ? ` This is due on ${fmtDate(task.due_date)}.` : '';
  const body = encodeURIComponent(
    `Hi ${task.owner},\n\nJust following up on the task assigned to you for our CPHI Milan 2026 preparation:\n\n` +
    `📌 ${task.task}${due}\n\nCould you please update the status at your earliest convenience?\n\n` +
    `Thanks,\n${currentUser || 'HRV Pharma Team'}`
  );
  window.open(`mailto:${task.owner}?subject=${subject}&body=${body}`);
}

function openWhatsAppFollowUp(task) {
  const due = task.due_date ? ` (due ${fmtDate(task.due_date)})` : '';
  const msg = `Hi${task.owner ? ' ' + task.owner : ''}! 👋 Following up on: *${task.task}*${due} — could you share a quick status update? Thanks! — HRV CPHI Team 🦜`;
  openModal('whatsapp', { message: msg });
}

function openModal(type, data) {
  modal.innerHTML = '';

  if (type === 'lead') {
    modal.innerHTML = `
      <h3>New lead</h3>
      <div class="field-row">
        <div class="field-group"><label>Name *</label><input id="f_name" /></div>
        <div class="field-group"><label>Company</label><input id="f_company" /></div>
      </div>
      <div class="field-row">
        <div class="field-group"><label>Role / Title</label><input id="f_role" /></div>
        <div class="field-group"><label>Country</label><input id="f_country" /></div>
      </div>
      <div class="field-row">
        <div class="field-group"><label>Email</label><input id="f_email" type="email" /></div>
        <div class="field-group"><label>Phone / WhatsApp</label><input id="f_phone" /></div>
      </div>
      <div class="field-group"><label>Interest / Products</label><input id="f_interest" /></div>
      <div class="field-row">
        <div class="field-group"><label>Priority</label>
          <select id="f_priority"><option>High</option><option selected>Medium</option><option>Low</option></select>
        </div>
        <div class="field-group"><label>Follow-up date</label><input id="f_followup" type="date" /></div>
      </div>
      <div class="field-group"><label>Notes</label><textarea id="f_notes"></textarea></div>
      <div class="field-group"><label>Captured by</label><input id="f_captured_by" value="${esc(currentUser)}" placeholder="Your name" /></div>
      <div class="modal-actions">
        <button class="btn-secondary" id="cancelBtn">Cancel</button>
        <button class="btn-primary" id="saveBtn">Save lead</button>
      </div>
    `;
    modal.querySelector('#saveBtn').addEventListener('click', async () => {
      const name = modal.querySelector('#f_name').value.trim();
      if (!name) { alert('Name is required'); return; }
      await api('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          company: modal.querySelector('#f_company').value,
          role: modal.querySelector('#f_role').value,
          email: modal.querySelector('#f_email').value,
          phone: modal.querySelector('#f_phone').value,
          country: modal.querySelector('#f_country').value,
          interest: modal.querySelector('#f_interest').value,
          priority: modal.querySelector('#f_priority').value,
          notes: modal.querySelector('#f_notes').value,
          follow_up_date: modal.querySelector('#f_followup').value,
          captured_by: modal.querySelector('#f_captured_by').value,
        })
      });
      closeModal(); loadLeads();
    });

  } else if (type === 'task') {
    const presetPhase = data?.phase || '';
    const phaseOptions = [...new Set([...phaseNamesList(), ...taskData.map((t) => t.phase)].filter(Boolean))]
      .map((p) => `<option value="${esc(p)}"></option>`).join('');
    modal.innerHTML = `
      <h3>Add task</h3>
      <div class="field-group">
        <label>Phase / Group</label>
        <input id="f_phase" list="phaseList" placeholder="e.g. Stall & Venue" value="${esc(presetPhase)}" ${presetPhase ? 'readonly' : ''} />
        <datalist id="phaseList">${phaseOptions}</datalist>
      </div>
      <div class="field-group"><label>Task *</label><input id="f_task" /></div>
      <div class="field-row">
        <div class="field-group"><label>Owner (name or email)</label><input id="f_owner" /></div>
        <div class="field-group"><label>Due date</label><input id="f_due" type="date" /></div>
      </div>
      <div class="field-group"><label>Status</label>
        <select id="f_status">${taskStatusOptions('initiated')}</select>
      </div>
      <div class="field-group"><label>Notes</label><textarea id="f_notes" class="modal-textarea" rows="4" placeholder="Optional notes — supports multiple lines"></textarea></div>
      <div class="modal-actions">
        <button class="btn-secondary" id="cancelBtn">Cancel</button>
        <button class="btn-primary" id="saveBtn">Add task</button>
      </div>
    `;
    modal.querySelector('#saveBtn').addEventListener('click', async () => {
      const phase = modal.querySelector('#f_phase').value.trim() || 'Other';
      const task = modal.querySelector('#f_task').value.trim();
      if (!task) { alert('Task is required'); return; }
      await api('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phase, task,
          owner: modal.querySelector('#f_owner').value,
          due_date: modal.querySelector('#f_due').value,
          notes: modal.querySelector('#f_notes').value,
          status: modal.querySelector('#f_status').value,
          who: currentUser,
        }),
      });
      closeModal();
      await loadTasks();
    });

  } else if (type === 'addPhase') {
    modal.innerHTML = `
      <h3>Add phase / group</h3>
      <div class="field-group"><label>Phase name *</label><input id="f_phase_name" placeholder="e.g. Commercial Prep" /></div>
      <p class="modal-hint">Creates a new section in the task list. Add tasks to it with the + Add task button on that phase.</p>
      <div class="modal-actions">
        <button class="btn-secondary" id="cancelBtn">Cancel</button>
        <button class="btn-primary" id="saveBtn">Create phase</button>
      </div>
    `;
    modal.querySelector('#saveBtn').addEventListener('click', async () => {
      const name = modal.querySelector('#f_phase_name').value.trim();
      if (!name) { alert('Phase name is required'); return; }
      await api('/api/task-phases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      closeModal();
      await loadTasks();
    });

  } else if (type === 'taskNotes') {
    modal.innerHTML = `
      <h3>Edit notes</h3>
      <div class="field-group"><textarea id="f_notes_large" class="modal-textarea modal-textarea-lg" rows="10" placeholder="Notes — multiple lines supported"></textarea></div>
      <div class="modal-actions">
        <button class="btn-secondary" id="cancelBtn">Cancel</button>
        <button class="btn-primary" id="saveBtn">Save notes</button>
      </div>
    `;
    modal.querySelector('#f_notes_large').value = data?.notes || '';
    modal.querySelector('#saveBtn').addEventListener('click', async () => {
      const notes = modal.querySelector('#f_notes_large').value;
      await saveTaskRow(data.id, 'notes', notes);
      const inline = document.querySelector(`.task-row[data-row-id="${data.id}"] .notes-input`);
      if (inline) {
        inline.value = notes;
        autoResizeNotes(inline);
      }
      closeModal();
    });

  } else if (type === 'changePassword') {
    modal.innerHTML = `
      <h3>Change password</h3>
      <p class="modal-hint">Signed in as <strong>${esc(currentSession.username || currentUser)}</strong></p>
      <div class="field-group"><label>Current password</label><input id="f_current" type="password" autocomplete="current-password" /></div>
      <div class="field-group"><label>New password</label><input id="f_new" type="password" autocomplete="new-password" placeholder="Min. 8 characters" /></div>
      <div class="field-group"><label>Confirm new password</label><input id="f_confirm" type="password" autocomplete="new-password" /></div>
      <div class="modal-actions">
        <button class="btn-secondary" id="cancelBtn">Cancel</button>
        <button class="btn-primary" id="saveBtn">Update password</button>
      </div>
    `;
    modal.querySelector('#saveBtn').addEventListener('click', async () => {
      const currentPassword = modal.querySelector('#f_current').value;
      const newPassword = modal.querySelector('#f_new').value;
      const confirm = modal.querySelector('#f_confirm').value;
      if (newPassword !== confirm) { alert('New passwords do not match'); return; }
      try {
        await api('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword, newPassword }),
        });
        closeModal();
        clearApiError();
        alert('Password updated successfully.');
      } catch (err) {
        showApiError(err);
      }
    });

  } else if (type === 'createUser') {
    modal.innerHTML = `
      <h3>Create user</h3>
      <div class="field-row">
        <div class="field-group"><label>Username *</label><input id="f_username" placeholder="e.g. boothlead" /></div>
        <div class="field-group"><label>Display name</label><input id="f_display" placeholder="Booth Lead" /></div>
      </div>
      <div class="field-row">
        <div class="field-group"><label>Temporary password *</label><input id="f_password" type="password" placeholder="Min. 8 characters" /></div>
        <div class="field-group"><label>Role</label>
          <select id="f_role"><option value="user">User</option><option value="admin">Admin</option></select>
        </div>
      </div>
      <div class="field-group field-check">
        <label class="check-label">
          <input type="checkbox" id="f_budget_access" />
          Allow access to Budget tab &amp; figures
        </label>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" id="cancelBtn">Cancel</button>
        <button class="btn-primary" id="saveBtn">Create user</button>
      </div>
    `;
    modal.querySelector('#saveBtn').addEventListener('click', async () => {
      try {
        await api('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: modal.querySelector('#f_username').value.trim(),
            displayName: modal.querySelector('#f_display').value.trim(),
            password: modal.querySelector('#f_password').value,
            role: modal.querySelector('#f_role').value,
            canViewBudget: modal.querySelector('#f_budget_access').checked,
          }),
        });
        closeModal();
        await loadAdminUsers();
        clearApiError();
      } catch (err) {
        showApiError(err);
      }
    });

  } else if (type === 'resetPassword') {
    modal.innerHTML = `
      <h3>Reset password</h3>
      <p class="modal-hint">Set a new password for <strong>${esc(data.username)}</strong></p>
      <div class="field-group"><label>New password</label><input id="f_password" type="password" placeholder="Min. 8 characters" /></div>
      <div class="modal-actions">
        <button class="btn-secondary" id="cancelBtn">Cancel</button>
        <button class="btn-primary" id="saveBtn">Reset password</button>
      </div>
    `;
    modal.querySelector('#saveBtn').addEventListener('click', async () => {
      try {
        await api(`/api/admin/users/${data.id}/password`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: modal.querySelector('#f_password').value }),
        });
        closeModal();
        clearApiError();
        alert(`Password reset for ${data.username}`);
      } catch (err) {
        showApiError(err);
      }
    });

  } else if (type === 'budgetVendor') {
    const row = budgetData.find((r) => parseRowId(r.id) === parseRowId(data.id));
    if (!row) return;
    modal.classList.add('modal-wide');
    modal.innerHTML = `
      <h3>Vendor &amp; POC</h3>
      <p class="modal-hint">For <strong>${esc(row.item)}</strong> (${esc(row.category)})</p>
      <div class="field-group"><label>Vendor name</label><input id="f_vendor" value="${esc(row.vendor || '')}" /></div>
      <div class="field-row">
        <div class="field-group"><label>POC name</label><input id="f_poc_name" value="${esc(row.poc_name || '')}" /></div>
        <div class="field-group"><label>POC phone</label><input id="f_poc_phone" value="${esc(row.poc_phone || '')}" /></div>
      </div>
      <div class="field-group"><label>POC email</label><input id="f_poc_email" type="email" value="${esc(row.poc_email || '')}" /></div>
      <div class="field-group"><label>Merchandise / item notes</label><textarea id="f_merch" class="modal-textarea" rows="3">${esc(row.merchandise_notes || '')}</textarea></div>
      <div class="modal-actions">
        <button class="btn-secondary" id="cancelBtn">Cancel</button>
        <button class="btn-primary" id="saveBtn">Save vendor</button>
      </div>
    `;
    modal.querySelector('#saveBtn').addEventListener('click', async () => {
      const fields = {
        vendor: modal.querySelector('#f_vendor').value,
        poc_name: modal.querySelector('#f_poc_name').value,
        poc_phone: modal.querySelector('#f_poc_phone').value,
        poc_email: modal.querySelector('#f_poc_email').value,
        merchandise_notes: modal.querySelector('#f_merch').value,
      };
      Object.assign(row, fields);
      try {
        await api(`/api/budget/${parseRowId(row.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(row),
        });
        closeModal();
        renderBudget();
        clearApiError();
      } catch (err) {
        showApiError(err);
      }
    });

  } else if (type === 'cap') {
    modal.innerHTML = `
      <h3>⚙ Budget settings</h3>
      <div class="field-group"><label>Overall budget cap (USD)</label><input id="f_cap" type="number" value="${settings.budget_cap || 0}" /></div>
      <p style="font-size:12px;color:var(--muted);margin:0 0 12px">Set to 0 to hide the cap progress bar.</p>
      <div class="modal-actions">
        <button class="btn-secondary" id="cancelBtn">Cancel</button>
        <button class="btn-primary" id="saveBtn">Save</button>
      </div>
    `;
    modal.querySelector('#saveBtn').addEventListener('click', async () => {
      await saveSettings({ budget_cap: Number(modal.querySelector('#f_cap').value), currency: settings.currency });
      closeModal(); renderBudget();
    });

  } else if (type === 'addTraveler') {
    modal.innerHTML = `
      <h3>Add traveler</h3>
      <div class="field-group"><label>Full name *</label><input id="f_name" /></div>
      <div class="field-row">
        <div class="field-group"><label>Passport number</label><input id="f_passport" /></div>
        <div class="field-group"><label>Passport expiry</label><input id="f_expiry" type="date" /></div>
      </div>
      <div class="field-group"><label>Notes</label><input id="f_notes" placeholder="e.g. needs Schengen visa, appointment booked" /></div>
      <div class="modal-actions">
        <button class="btn-secondary" id="cancelBtn">Cancel</button>
        <button class="btn-primary" id="saveBtn">Add traveler</button>
      </div>
    `;
    modal.querySelector('#saveBtn').addEventListener('click', async () => {
      const name = modal.querySelector('#f_name').value.trim();
      if (!name) { alert('Name is required'); return; }
      await api('/api/travelers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, passport: modal.querySelector('#f_passport').value, passport_expiry: modal.querySelector('#f_expiry').value, notes: modal.querySelector('#f_notes').value, who: currentUser })
      });
      closeModal(); loadTravelers();
    });

  } else if (type === 'traveler') {
    const t = data;
    modal.innerHTML = `
      <h3>Edit: ${esc(t.name)}</h3>
      <div class="field-group"><label>Full name</label><input id="f_name" value="${esc(t.name)}" /></div>
      <div class="field-row">
        <div class="field-group"><label>Passport number</label><input id="f_passport" value="${esc(t.passport||'')}" /></div>
        <div class="field-group"><label>Passport expiry</label><input id="f_expiry" type="date" value="${esc(t.passport_expiry||'')}" /></div>
      </div>
      <div class="field-row">
        <div class="field-group"><label>Visa apply by</label><input id="f_visa_due" type="date" value="${esc(t.visa_apply_due||'')}" /></div>
        <div class="field-group"><label>Flight book by</label><input id="f_flight_due" type="date" value="${esc(t.flight_due||'')}" /></div>
      </div>
      <div class="field-group"><label>Hotel book by</label><input id="f_hotel_due" type="date" value="${esc(t.hotel_due||'')}" /></div>
      <div class="field-group"><label>Notes</label><input id="f_notes" value="${esc(t.notes||'')}" /></div>
      <div class="modal-actions">
        <button class="btn-secondary" id="cancelBtn">Cancel</button>
        <button class="btn-primary" id="saveBtn">Save</button>
      </div>
    `;
    modal.querySelector('#saveBtn').addEventListener('click', async () => {
      await saveTraveler(t.id, {
        ...t,
        name: modal.querySelector('#f_name').value,
        passport: modal.querySelector('#f_passport').value,
        passport_expiry: modal.querySelector('#f_expiry').value,
        visa_apply_due: modal.querySelector('#f_visa_due').value,
        flight_due: modal.querySelector('#f_flight_due').value,
        hotel_due: modal.querySelector('#f_hotel_due').value,
        notes: modal.querySelector('#f_notes').value,
      });
      closeModal();
    });

  } else if (type === 'whatsapp') {
    const msg = (data && data.message) || '';
    modal.innerHTML = `
      <h3>💬 WhatsApp message</h3>
      <p style="font-size:12px;color:var(--muted);margin:0 0 10px">Edit the message below, then send to an individual or copy to paste into your group.</p>
      <div class="whatsapp-box">
        <textarea id="waMsg">${esc(msg)}</textarea>
        <div class="wa-actions">
          <input id="waPhone" placeholder="+91 9876543210 (individual)" style="border:1px solid #A8D5B5;border-radius:6px;padding:7px 10px;font-family:inherit;font-size:13px;flex:1;min-width:180px" />
          <button class="wa-send" id="waSendBtn">Send to number</button>
          <button class="wa-copy" id="waCopyBtn">📋 Copy for group</button>
        </div>
      </div>
      <div class="modal-actions" style="margin-top:16px">
        <button class="btn-secondary" id="cancelBtn">Close</button>
      </div>
    `;
    modal.querySelector('#waSendBtn').addEventListener('click', () => {
      const phone = modal.querySelector('#waPhone').value.replace(/\D/g, '');
      const text  = modal.querySelector('#waMsg').value;
      if (!phone) { alert('Enter a phone number'); return; }
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
    });
    modal.querySelector('#waCopyBtn').addEventListener('click', () => {
      const text = modal.querySelector('#waMsg').value;
      navigator.clipboard.writeText(text).then(() => {
        modal.querySelector('#waCopyBtn').textContent = '✅ Copied!';
        setTimeout(() => modal.querySelector('#waCopyBtn').textContent = '📋 Copy for group', 2000);
      });
    });
  }

  modal.querySelector('#cancelBtn').addEventListener('click', closeModal);
  backdrop.classList.add('open');
  modal.querySelector('input,textarea')?.focus();
}

// ═══════════════════════════════════════════════════════════════════════════════
// TASK DRAG & DROP
// ═══════════════════════════════════════════════════════════════════════════════
let taskDnDBound = false;
const taskDragState = { type: null, element: null, phase: null };

function clearTaskDragState() {
  document.querySelectorAll('.dragging, .drag-over').forEach((el) => {
    el.classList.remove('dragging', 'drag-over');
  });
  taskDragState.type = null;
  taskDragState.element = null;
  taskDragState.phase = null;
}

async function persistTaskOrder(phase, orderedIds) {
  await api('/api/tasks/reorder', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phase, orderedIds: orderedIds.map((id) => parseRowId(id)).filter(Boolean) }),
  });
  orderedIds.forEach((id, index) => {
    const row = taskData.find((t) => String(t.id) === String(id));
    if (row) row.sort_order = index;
  });
  clearApiError();
}

async function persistPhaseOrder(orderedNames) {
  const result = await api('/api/task-phases/reorder', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderedNames }),
  });
  if (Array.isArray(result.phases)) {
    taskPhaseMeta = result.phases.map((p) => ({
      ...p,
      taskCount: taskData.filter(
        (t) => String(t.phase || '').trim().toLowerCase() === String(p.name || '').trim().toLowerCase()
      ).length,
    }));
  }
  clearApiError();
}

function bindTaskDnD() {
  if (taskDnDBound) return;
  taskDnDBound = true;
  const container = document.getElementById('taskPhases');
  if (!container) return;

  container.addEventListener('dragstart', (e) => {
    const phaseHandle = e.target.closest('.phase-drag-handle');
    const taskHandle = e.target.closest('.task-drag-handle');
    if (!phaseHandle && !taskHandle) return;

    if (phaseHandle) {
      const group = phaseHandle.closest('.phase-group');
      if (!group) return;
      taskDragState.type = 'phase';
      taskDragState.element = group;
      taskDragState.phase = null;
      group.classList.add('dragging');
    } else {
      const row = taskHandle.closest('.task-row');
      const group = row?.closest('.phase-group');
      if (!row || !group) return;
      taskDragState.type = 'task';
      taskDragState.element = row;
      taskDragState.phase = group.dataset.phaseName;
      row.classList.add('dragging');
    }

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', taskDragState.type);
    if (e.dataTransfer.setDragImage) {
      e.dataTransfer.setDragImage(taskDragState.element, 20, 20);
    }
  });

  container.addEventListener('dragover', (e) => {
    if (!taskDragState.type) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (taskDragState.type === 'phase') {
      const group = e.target.closest('.phase-group');
      if (!group || group === taskDragState.element) return;
      document.querySelectorAll('.phase-group.drag-over').forEach((el) => {
        if (el !== group) el.classList.remove('drag-over');
      });
      group.classList.add('drag-over');
      return;
    }

    const row = e.target.closest('.task-row');
    const group = row?.closest('.phase-group');
    if (!row || !group || group.dataset.phaseName !== taskDragState.phase) return;
    if (row === taskDragState.element) return;
    document.querySelectorAll('.task-row.drag-over').forEach((el) => {
      if (el !== row) el.classList.remove('drag-over');
    });
    row.classList.add('drag-over');
  });

  container.addEventListener('dragleave', (e) => {
    const related = e.relatedTarget;
    if (related && container.contains(related)) return;
    document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
  });

  container.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const saved = { ...taskDragState, element: taskDragState.element };

    if (saved.type === 'phase') {
      const target = e.target.closest('.phase-group');
      if (!target || !saved.element || target === saved.element) {
        clearTaskDragState();
        return;
      }
      const fromIdx = [...container.querySelectorAll('.phase-group')].indexOf(saved.element);
      const toIdx = [...container.querySelectorAll('.phase-group')].indexOf(target);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) {
        clearTaskDragState();
        return;
      }
      if (fromIdx < toIdx) target.after(saved.element);
      else target.before(saved.element);
      const orderedNames = [...container.querySelectorAll('.phase-group')].map((g) => g.dataset.phaseName);
      clearTaskDragState();
      persistPhaseOrder(orderedNames).catch((err) => {
        showApiError(err);
        loadTasks();
      });
      return;
    }

    if (saved.type === 'task') {
      let target = e.target.closest('.task-row');
      const group = (target || e.target).closest('.phase-group');
      if (!saved.element || !group || group.dataset.phaseName !== saved.phase) {
        clearTaskDragState();
        return;
      }
      if (!target) {
        const rows = group.querySelectorAll('.task-row');
        target = rows[rows.length - 1] || null;
      }
      if (!target) {
        clearTaskDragState();
        return;
      }
      const rows = [...group.querySelectorAll('.task-row')];
      const fromIdx = rows.indexOf(saved.element);
      const toIdx = rows.indexOf(target);
      if (fromIdx === -1 || toIdx === -1) {
        clearTaskDragState();
        return;
      }
      if (fromIdx !== toIdx) {
        if (fromIdx < toIdx) target.after(saved.element);
        else target.before(saved.element);
      }
      const orderedIds = [...group.querySelectorAll('.task-row')].map((r) => r.dataset.rowId);
      const phaseName = group.dataset.phaseName;
      clearTaskDragState();
      persistTaskOrder(phaseName, orderedIds).catch((err) => {
        showApiError(err);
        loadTasks();
      });
    }
  });

  container.addEventListener('dragend', () => {
    setTimeout(clearTaskDragState, 0);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════════
initIdentity();
bindTaskListeners();
bindTaskDnD();
bindFileListeners();

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  localStorage.removeItem('cphi_is_admin');
  localStorage.removeItem('cphi_role');
  localStorage.removeItem('cphi_can_budget');
  window.location.href = '/login.html';
});

async function bootstrapApp() {
  showAdminTabIfAllowed(false);
  let me = { authenticated: false };
  try {
    me = await api('/api/auth/me');
  } catch (err) {
    showApiError(err);
    return;
  }
  if (me.authenticated) {
    currentSession = me;
    if (me.displayName) {
      currentUser = me.displayName;
      localStorage.setItem('cphi_user', me.displayName);
      const chip = document.getElementById('userChip');
      if (chip) chip.textContent = '👤 ' + me.displayName;
    }
    if (me.isAdmin) localStorage.setItem('cphi_is_admin', '1');
    else localStorage.removeItem('cphi_is_admin');
    document.getElementById('identityBanner').style.display = 'none';
    showAdminTabIfAllowed(me.isAdmin);
    applyBudgetVisibility(me.canViewBudget);
  }
  try {
    const loads = [loadTasks(), loadLeads(), loadTravelers()];
    if (me.authenticated && me.canViewBudget) {
      loads.push(loadSettings(), loadBudget());
    }
    await Promise.all(loads);
    clearApiError();
    switchTab(tabFromPath(), { pushState: false });
  } catch (err) {
    showApiError(err);
  }
}

bootstrapApp().catch(showApiError);
