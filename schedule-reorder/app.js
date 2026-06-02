/**
 * Schedule Reorder API consumer — all schedule datetimes are shown in India
 * Standard Time (Asia/Kolkata) in the UI, independent of the browser locale.
 */
const IST = 'Asia/Kolkata';

const DEFAULT_API_BASE = '';

function getApiBase() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('apiBase');
  if (fromQuery) {
    return fromQuery.replace(/\/$/, '');
  }
  const fromStorage = localStorage.getItem('scheduleApiBase');
  if (fromStorage) {
    return fromStorage.replace(/\/$/, '');
  }
  return DEFAULT_API_BASE;
}

function apiUrl(path) {
  const base = getApiBase();
  if (!base) {
    return path.startsWith('/') ? path : `/${path}`;
  }
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Render any value from the API as a human-readable IST string.
 * - ISO strings (Z or +05:30) are parsed as instants and formatted in Asia/Kolkata.
 * - Plain "YYYY-MM-DD HH:mm:ss" from SQL (Display fields) is shown as-is.
 */
function formatScheduleDateTime(value) {
  if (value == null || value === '') return '';
  const s = String(value).trim();
  if (!s) return '';

  // Backend *Display or SQL CONVERT: plain text, already wall-clock — do not re-parse
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,3})?$/.test(s)) {
    return s;
  }

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    return s;
  }

  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(d);
}

function isDateColumnKey(key) {
  const k = key.toLowerCase();
  if (k.endsWith('display')) return false;
  return k.includes('datetime') || (k.endsWith('date') && !k.includes('candidate'));
}

function cellForColumn(row, key) {
  const displayKey = `${key}Display`;
  if (Object.prototype.hasOwnProperty.call(row, displayKey) && row[displayKey] != null && row[displayKey] !== '') {
    return formatScheduleDateTime(row[displayKey]);
  }
  const v = row[key];
  if (v == null || v === '') return '';
  if (isDateColumnKey(key)) {
    return formatScheduleDateTime(v);
  }
  if (typeof v === 'object') {
    return JSON.stringify(v);
  }
  return String(v);
}

function columnKeysForRow(row) {
  const keys = Object.keys(row).filter((k) => !k.toLowerCase().endsWith('display'));
  return keys.sort();
}

async function fetchJson(url) {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

function setStatus(message, isError) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('error', !!isError);
}

async function loadMachines() {
  const database = document.getElementById('database').value;
  const base = apiUrl('/api');
  const url = `${base}/schedule/machines?database=${encodeURIComponent(database)}`;
  const list = await fetchJson(url);
  const sel = document.getElementById('machine');
  sel.innerHTML = '';
  for (const m of list) {
    const opt = document.createElement('option');
    opt.value = String(m.machineId);
    opt.textContent = `${m.machineName || m.machineId} (${m.machineType || ''})`.trim();
    sel.appendChild(opt);
  }
  setStatus(`Loaded ${list.length} machine(s).`, false);
}

async function loadSchedule() {
  const database = document.getElementById('database').value;
  const machineId = document.getElementById('machine').value;
  if (!machineId) {
    setStatus('Select a machine.', true);
    return;
  }
  const base = apiUrl('/api');
  const url = `${base}/schedule/machine/${encodeURIComponent(machineId)}?database=${encodeURIComponent(database)}`;
  setStatus('Loading…', false);
  const rows = await fetchJson(url);
  renderTable(rows);
  setStatus(`Loaded ${rows.length} row(s). Times shown in IST (${IST}).`, false);
}

function renderTable(rows) {
  const wrap = document.getElementById('table-wrap');
  if (!rows.length) {
    wrap.innerHTML = '<p class="muted">No rows.</p>';
    return;
  }
  const keys = columnKeysForRow(rows[0]);
  const thead = keys.map((k) => `<th>${escapeHtml(k)}</th>`).join('');
  const tbody = rows
    .map((row) => {
      const tds = keys.map((k) => `<td>${escapeHtml(cellForColumn(row, k))}</td>`).join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');
  wrap.innerHTML = `<table class="schedule-table"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function saveApiBase() {
  const input = document.getElementById('apiBase');
  const v = (input && input.value || '').trim().replace(/\/$/, '');
  if (v) {
    localStorage.setItem('scheduleApiBase', v);
  } else {
    localStorage.removeItem('scheduleApiBase');
  }
  setStatus('API base saved. Reload machines to use it.', false);
}

function init() {
  const btnMachines = document.getElementById('btn-machines');
  const btnLoad = document.getElementById('btn-load');
  const btnSaveApi = document.getElementById('btn-save-api');
  const apiInput = document.getElementById('apiBase');
  if (apiInput) {
    apiInput.value = getApiBase() || '';
  }
  apiInput?.addEventListener('change', saveApiBase);
  btnSaveApi?.addEventListener('click', saveApiBase);
  btnMachines?.addEventListener('click', () => loadMachines().catch((e) => setStatus(e.message, true)));
  btnLoad?.addEventListener('click', () => loadSchedule().catch((e) => setStatus(e.message, true)));
}

document.addEventListener('DOMContentLoaded', init);
