/**
 * GRN Creator — a supplier invoice to a GRN and purchase invoice.
 *
 * Laid out like the ERP's own Goods Receipt Note screen, but filled in for
 * you: the AI reads the invoice, the matcher puts each line on a PO line, and
 * the defaults come from the ERP's recent history. Anything it gets wrong can
 * be changed - a line can be put on any PO line by hand from the Pending POs
 * tab, and that choice survives "Match again".
 *
 * A thin client over `/api/supplier-portal/receiving`. Every rule that matters
 * lives on the server: the checks, their block/warning severities, the reason
 * requirement, which PO lines a line may sit on, and the write gate. The same
 * endpoints will be driven from a tablet in a warehouse, and a rule enforced
 * only here would not hold there.
 */

'use strict';

var BASE = window.AppConfig.portalBase;

var state = {
  token: null,
  context: null,          // { site, erpUserId, employeeLedgerId, warehouseId }
  user: null,
  reference: {},          // dropdown sources, loaded once per sign-in
  setId: null,
  documentSet: null,
  checks: [],
  reasons: {},            // check code -> typed reason
  erpWritesEnabled: false,
  source: 'file',
  includeClosed: false,   // the Open POs / Include closed toggle
  view: 'lines',          // Receipt lines | Pending POs
  poLines: [],            // the Pending POs tab
  filters: {},            // column key -> search text, Pending POs tab
  defaultWarehouseId: null,
  entryMode: 'ai',        // 'ai': read an invoice; 'manual': pick PO lines, as on the ERP
};

// -- plumbing ---------------------------------------------------------------

function $(id) { return document.getElementById(id); }
function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }

/**
 * The server speaks JSON on success and on failure alike; a non-2xx carries an
 * `error` and often the checks that caused it. Surfacing that payload rather
 * than the status code is what makes a 422 actionable.
 */
async function api(path, options) {
  var opts = options || {};
  var headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;

  var res = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  var payload = null;
  try { payload = await res.json(); } catch (e) { /* empty body */ }

  if (!res.ok) {
    var err = new Error((payload && payload.error) || ('HTTP ' + res.status));
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

function setStatus(id, message, kind) {
  var node = $(id);
  node.textContent = message || '';
  node.className = 'status' + (kind ? ' ' + kind : '');
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}

function money(v) {
  var n = num(v);
  return n === null ? '' : n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function qtyText(v) {
  var n = num(v);
  return n === null ? '' : n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

function text(v) { return v === null || v === undefined ? '' : String(v); }

/**
 * A stored date as the calendar day it is HERE, for a date input.
 *
 * Do not slice the ISO string. The server stores "9 October, midnight in
 * Kolkata" as 2026-10-08T18:30:00Z, so its first ten characters are the 8th.
 * Slicing showed the 8th, and saving the review then wrote the 8th back over
 * a date the AI had read correctly - every date, on every review, a day early.
 * Reading the day in the browser's own time zone gives the 9th.
 *
 * What goes back is a bare 'YYYY-MM-DD', which JavaScript always parses as UTC
 * midnight, so the server's own time zone cannot shift it again.
 */
function localDateInput(value) {
  if (!value) return '';
  var d = new Date(value);
  if (isNaN(d.getTime())) return '';
  var pad = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** A date the ERP's way: 13-Oct-2026, in the browser's own time zone. */
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function displayDate(value) {
  if (!value) return '';
  var d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return String(d.getDate()).padStart(2, '0') + '-' + MONTHS[d.getMonth()] + '-' + d.getFullYear();
}

function el(tag, className, content) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function lineNoList(nos) {
  var list = nos.map(String);
  return list.length > 1 ? list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1] : list.join('');
}

// -- theme ------------------------------------------------------------------

/**
 * Light or dark, with the system preference as the starting point.
 *
 * `data-theme` on <html> is only set once someone has chosen; without it the
 * stylesheet follows `prefers-color-scheme`. The choice is remembered in
 * localStorage and re-applied by a tiny inline script in the <head>, before
 * the stylesheet paints, so a dark-mode user never sees a white flash.
 */
var THEME_KEY = 'grnCreator.theme';

function systemPrefersDark() {
  return Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function resolvedTheme() {
  var chosen = document.documentElement.getAttribute('data-theme');
  if (chosen === 'dark' || chosen === 'light') return chosen;
  return systemPrefersDark() ? 'dark' : 'light';
}

/** The button shows where a click will take you: moon while light, sun while dark. */
function paintThemeIcon() {
  var dark = resolvedTheme() === 'dark';
  var moon = document.querySelector('.icon-moon');
  var sun = document.querySelector('.icon-sun');
  if (moon) moon.hidden = dark;
  if (sun) sun.hidden = !dark;
  var button = $('themeToggle');
  if (button) {
    var next = dark ? 'light' : 'dark';
    button.title = 'Switch to ' + next + ' mode';
    button.setAttribute('aria-label', 'Switch to ' + next + ' mode');
  }
}

function toggleTheme() {
  var next = resolvedTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { window.localStorage.setItem(THEME_KEY, next); } catch (e) { /* not important */ }
  paintThemeIcon();
}

/** Follow the system while the person has not chosen. */
function watchSystemTheme() {
  if (!window.matchMedia) return;
  var media = window.matchMedia('(prefers-color-scheme: dark)');
  var onChange = function () {
    if (!document.documentElement.getAttribute('data-theme')) paintThemeIcon();
  };
  if (media.addEventListener) media.addEventListener('change', onChange);
  else if (media.addListener) media.addListener(onChange);
}

// -- session ----------------------------------------------------------------

function saveSession() {
  try {
    sessionStorage.setItem('grnCreator', JSON.stringify({
      token: state.token, context: state.context, user: state.user,
    }));
  } catch (e) { /* private window; the page still works for this tab */ }
}

function restoreSession() {
  try {
    var raw = sessionStorage.getItem('grnCreator');
    if (!raw) return false;
    var saved = JSON.parse(raw);
    if (!saved || !saved.token) return false;
    state.token = saved.token;
    state.context = saved.context;
    state.user = saved.user;
    return true;
  } catch (e) { return false; }
}

/**
 * The last user name and database used on this machine, as the production
 * entry tool and the Stock Issue Tool both do. Its own key, because the two
 * tools are signed into separately even though the credential is the same.
 */
var LAST_LOGIN_KEY = 'cdc-grn-creator.last-login';

function rememberLogin(username, site) {
  try {
    window.localStorage.setItem(LAST_LOGIN_KEY, JSON.stringify({ username: username, site: site }));
  } catch (e) { /* not important */ }
}

function prefillLogin() {
  try {
    var saved = JSON.parse(window.localStorage.getItem(LAST_LOGIN_KEY) || '{}');
    if (saved.username) $('username').value = saved.username;
    if (saved.site === 'AHM' || saved.site === 'KOL') $('site').value = saved.site;
  } catch (e) { /* first run, or storage blocked */ }
}

/**
 * ERP sign-in: user name and database, no password. The server looks the name
 * up in the ERP's UserMaster, so the UserID that lands in CreatedBy on every
 * row this tool writes is the ERP's own - and it is taken from the session at
 * post time, never from anything this page sends.
 */
async function signIn(event) {
  event.preventDefault();
  hide('signInError');
  var username = $('username').value.trim();
  if (!username) return;

  $('signInBtn').disabled = true;
  $('signInBtn').textContent = 'Signing in...';
  try {
    var result = await api('/auth/erp-login', {
      method: 'POST',
      body: { username: username, site: $('site').value },
    });
    state.token = result.token;
    state.context = result.context;
    state.user = result.user;
    rememberLogin(username, $('site').value);
    saveSession();
    await onSignedIn();
  } catch (err) {
    $('signInError').textContent = err.message;
    show('signInError');
  } finally {
    $('signInBtn').disabled = false;
    $('signInBtn').textContent = 'Sign in';
  }
}

function signOut() {
  api('/auth/logout', { method: 'POST' }).catch(function () { /* token dies either way */ });
  try { sessionStorage.removeItem('grnCreator'); } catch (e) { /* ignore */ }
  window.location.reload();
}

async function onSignedIn() {
  hide('signInPanel');
  show('capturePanel'); show('historyPanel');
  $('siteBadge').textContent = state.context.site;
  show('siteBadge');
  $('whoami').textContent = state.user.erpUserName || state.user.displayName || state.user.email;
  show('signOutBtn');

  await loadReference();
  await loadHistory();
}

// -- reference data ---------------------------------------------------------

function fillSelect(id, rows, valueKey, labelFn, selected, placeholder) {
  var select = $(id);
  select.innerHTML = '';
  if (placeholder) {
    var blank = el('option', null, placeholder);
    blank.value = '';
    select.appendChild(blank);
  }
  rows.forEach(function (row) {
    var option = el('option', null, labelFn(row));
    option.value = row[valueKey];
    if (selected !== null && selected !== undefined && String(selected) === String(row[valueKey])) {
      option.selected = true;
    }
    select.appendChild(option);
  });
}

function warehouseLabel(w) {
  var bin = w.WarehouseBinName || w.BinName;
  return (bin && w.WarehouseBinName ? w.WarehouseBinName : w.WarehouseName + (bin ? ' - ' + bin : ''))
    + (w.IsFloorWarehouse ? ' (floor)' : '');
}

async function loadReference() {
  var results = await Promise.all([
    api('/erp/employee-ledgers'),
    api('/erp/warehouses'),
    api('/erp/purchase-ledgers'),
    api('/erp/charge-ledgers'),
    api('/erp/supplier-ledgers'),
  ]);
  state.reference = {
    employees: results[0], warehouses: results[1], purchaseLedgers: results[2],
    chargeLedgers: results[3], suppliers: results[4],
  };

  fillSelect('receivedBy', state.reference.employees, 'LedgerID',
    function (r) { return r.LedgerName + (r.Designation ? ' - ' + r.Designation : ''); },
    state.context.employeeLedgerId, 'Choose...');

  fillSelect('defaultWarehouse', state.reference.warehouses, 'WarehouseID',
    warehouseLabel, state.context.warehouseId, 'Choose...');

  fillSelect('purchaseLedgerId', state.reference.purchaseLedgers, 'LedgerID',
    function (r) { return r.LedgerName; }, null, 'Choose...');

  // Only inward-freight ledgers belong here; the GST and round-off ledgers
  // are picked by the server from their own kinds.
  var freight = state.reference.chargeLedgers.filter(function (r) {
    return /freight/i.test(r.LedgerName || '');
  });
  fillSelect('freightLedgerId', freight, 'LedgerID',
    function (r) { return r.LedgerName; }, null, 'None');

  var supplierList = $('supplierList');
  supplierList.innerHTML = '';
  state.reference.suppliers.forEach(function (row) {
    var option = el('option');
    // The datalist shows the name; the id is recovered on input.
    option.value = row.LedgerName + '  [' + row.LedgerID + ']';
    supplierList.appendChild(option);
  });

  state.defaultWarehouseId = num($('defaultWarehouse').value);
  paintDefaultWarehouse();
}

function warehouseName(id) {
  var w = (state.reference.warehouses || []).filter(function (r) { return String(r.WarehouseID) === String(id); })[0];
  return w ? warehouseLabel(w) : null;
}

function paintDefaultWarehouse() {
  $('defaultWarehouseName').textContent = warehouseName(state.defaultWarehouseId) || 'not chosen yet';
}

// -- supplier picker --------------------------------------------------------

function onSupplierInput() {
  var typed = $('supplierSearch').value;
  var match = /\[(\d+)\]\s*$/.exec(typed);
  var id = '';
  if (match) {
    id = match[1];
  } else {
    var exact = (state.reference.suppliers || []).filter(function (r) {
      return String(r.LedgerName || '').toLowerCase() === typed.trim().toLowerCase();
    });
    id = exact.length === 1 ? String(exact[0].LedgerID) : '';
  }
  $('supplierLedgerId').value = id;
  if (id && $('captureStatus').textContent === 'Choose the supplier first.') setStatus('captureStatus', '', null);

  // Once an invoice has been read, choosing a different supplier changes it.
  var current = state.documentSet && state.documentSet.context && state.documentSet.context.supplierLedgerId;
  if (state.setId && id && String(id) !== String(current || '')) changeSupplier(id);
}

function supplierById(id) {
  return (state.reference.suppliers || []).filter(function (r) { return String(r.LedgerID) === String(id); })[0];
}

/**
 * Show who the invoice is from and how that was decided. A person's choice
 * that the invoice disagrees with is kept, but flagged.
 */
function paintSupplier() {
  var set = state.documentSet || {};
  var id = set.context && set.context.supplierLedgerId;
  var found = set.supplierIdentification || {};
  var note = $('supplierNote');
  note.className = 'source';

  if (id) {
    var ledger = supplierById(id);
    $('supplierSearch').value = (ledger ? ledger.LedgerName : 'Ledger ' + id) + '  [' + id + ']';
    $('supplierLedgerId').value = id;
  }

  if (!id) {
    note.className = 'source bad';
    note.textContent = 'Could not identify the supplier from the invoice - choose it. '
      + (found.evidence || '');
  } else if (found.ledgerId && String(found.ledgerId) !== String(id)) {
    var other = supplierById(found.ledgerId);
    note.className = 'source warn';
    note.textContent = 'The invoice points to ' + (other ? other.LedgerName : 'ledger ' + found.ledgerId)
      + ' [' + found.ledgerId + '] - from ' + found.evidence + '. Check this is the right supplier.';
  } else if (found.ledgerId) {
    note.textContent = 'Identified from ' + found.evidence + '. Change it if it is wrong.';
  } else {
    note.textContent = '';
  }
}

/** Fields still showing a default, rather than a person's choice. */
var DEFAULTED = [
  ['receivedBy', 'receivedByHint'], ['defaultWarehouse', 'warehouseHint'],
  ['purchaseLedgerId', 'purchaseLedgerHint'], ['freightLedgerId', 'freightLedgerHint'],
];

/**
 * Point the draft at another supplier. The server clears every PO match -
 * they were all the old supplier's - and the defaults that came from the old
 * supplier's history are re-read; anything a person chose is left alone.
 */
async function changeSupplier(id) {
  try {
    await api('/receiving/document-sets/' + state.setId, {
      method: 'PATCH',
      body: { context: { supplierLedgerId: num(id) }, reason: 'Supplier changed in GRN Creator' },
    });
    state.documentSet.context = state.documentSet.context || {};
    state.documentSet.context.supplierLedgerId = num(id);
    hide('previewPanel');
    if (state.entryMode === 'manual') {
      // The server has taken every line off the old supplier's POs. Show that,
      // and the new supplier's PO lines to pick from.
      state.documentSet = await api('/receiving/document-sets/' + state.setId);
      state.checks = [];
      renderReceipt(); renderAssignOptions(); renderChecks({}); renderPiTotals();
      await loadPendingPos();
    } else {
      ['matchPanel', 'grnPanel', 'piPanel'].forEach(hide);
    }

    DEFAULTED.forEach(function (pair) {
      if ($(pair[1]).textContent) { $(pair[0]).value = ''; $(pair[1]).textContent = ''; }
    });
    await loadDefaults();

    paintSupplier();
    var ledger = supplierById(id);
    setStatus('captureStatus', 'Supplier is now ' + (ledger ? ledger.LedgerName : id)
      + '. Press Match to POs to match against its POs.', 'ok');
  } catch (err) {
    setStatus('captureStatus', err.message, 'error');
  }
}

// -- 1 · capture and extraction ---------------------------------------------

function selectSource(source) {
  state.source = source;
  Array.prototype.forEach.call(document.querySelectorAll('#sourceTabs .tab'), function (tab) {
    tab.classList.toggle('active', tab.dataset.source === source);
  });
  $('sourceFile').classList.toggle('hidden', source !== 'file');
  $('sourceUrl').classList.toggle('hidden', source !== 'url');
}

/** Biggest file we will inline rather than store. Base64 adds about a third. */
var MAX_INLINE_BYTES = 6 * 1024 * 1024;

function readAsDataUrl(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = function () { reject(new Error('Could not read ' + file.name + '.')); };
    reader.readAsDataURL(file);
  });
}

/**
 * Get the invoice somewhere the extractor can see it: a presigned PUT to
 * storage, which keeps the file with the document set. If storage fails, an
 * image is inlined as a data URL - the read still works, but NOTHING IS
 * STORED, and the status line says so rather than swallowing it.
 */
async function uploadInvoice(file) {
  try {
    var presigned = await api('/receiving/upload-url', {
      method: 'POST',
      body: { contentType: file.type, contentLength: file.size },
    });
    var put = await fetch(presigned.url, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    if (!put.ok) throw new Error('storage refused the upload (HTTP ' + put.status + ')');
    return { slot: { storageKey: presigned.key, pageNo: 1 }, stored: true };
  } catch (err) {
    if (!/^image\//.test(file.type || '')) {
      throw new Error('Could not upload to storage (' + err.message + '), and only images can be '
        + 'read without it. Fix storage, or use the URL tab.');
    }
    if (file.size > MAX_INLINE_BYTES) {
      throw new Error('Could not upload to storage (' + err.message + '), and ' + file.name
        + ' is too large to read without it.');
    }
    return { slot: { url: await readAsDataUrl(file), pageNo: 1 }, stored: false };
  }
}

async function extract() {
  $('extractBtn').disabled = true;
  try {
    var slot;
    var notStored = false;
    if (state.source === 'file') {
      var file = $('invoiceFile').files[0];
      if (!file) throw new Error('Choose a file, or switch to the URL tab.');
      setStatus('captureStatus', 'Uploading ' + file.name + '...');
      var uploaded = await uploadInvoice(file);
      slot = uploaded.slot;
      if (!uploaded.stored) notStored = true;
    } else {
      var url = $('invoiceUrl').value.trim();
      if (!url) throw new Error('Paste a URL, or switch to the file tab.');
      slot = { url: url, pageNo: 1 };
    }

    setStatus('captureStatus', 'Creating the document set...');
    var set = await api('/receiving/document-sets', {
      method: 'POST',
      // Usually empty: the server identifies the supplier from the invoice.
      // If someone chose one first, that choice stands.
      body: { supplierLedgerId: num($('supplierLedgerId').value), slots: { supplierInvoice: [slot] } },
    });
    state.setId = set._id;

    setStatus('captureStatus', 'Reading the invoice - this is the one slow step...');
    state.documentSet = await api('/receiving/document-sets/' + state.setId + '/extract', { method: 'POST' });

    paintSupplier();
    renderReview();
    fillGrnDetails(state.documentSet.extractedHeader || {});
    ['matchPanel', 'grnPanel', 'piPanel', 'previewPanel'].forEach(hide);
    show('reviewPanel');
    loadDefaults();   // in the background; it only pre-fills

    var lineCount = (state.documentSet.extractedLines || []).length;
    setStatus('captureStatus',
      notStored
        ? 'Read ' + lineCount + ' line(s) - but storage was unavailable, so the invoice was read '
          + 'directly and NO COPY HAS BEEN KEPT with this document set.'
        : 'Read ' + lineCount + ' line(s).',
      notStored ? 'warn' : 'ok');
  } catch (err) {
    setStatus('captureStatus', err.message, 'error');
  } finally {
    $('extractBtn').disabled = false;
  }
}

// -- or by hand, as on the ERP's own GRN screen ------------------------------

function setEntryMode(mode) {
  state.entryMode = mode;
  Array.prototype.forEach.call(document.querySelectorAll('#entryMode .tab'), function (tab) {
    tab.classList.toggle('active', tab.dataset.mode === mode);
  });
  $('aiPane').classList.toggle('hidden', mode !== 'ai');
  $('manualPane').classList.toggle('hidden', mode !== 'manual');
  setStatus('captureStatus', '', null);
}

/**
 * Start a GRN with no invoice to read: a supplier and the delivery note, then
 * PO lines picked one by one. The same checks, the same writer and the same
 * write gate as a GRN the AI filled in.
 */
async function startManual() {
  var supplier = num($('supplierLedgerId').value);
  if (!supplier) { setStatus('captureStatus', 'Choose the supplier first.', 'error'); return; }
  $('startManualBtn').disabled = true;
  try {
    var set = await api('/receiving/document-sets/manual', {
      method: 'POST',
      body: {
        supplierLedgerId: supplier,
        invoiceNo: $('manualInvoiceNo').value.trim() || null,
        invoiceDate: $('manualInvoiceDate').value || null,
      },
    });
    state.setId = set._id;
    state.documentSet = set;
    state.checks = [];
    state.reasons = {};
    ['reviewPanel', 'previewPanel'].forEach(hide);
    fillGrnDetails(set.extractedHeader || {});
    ['matchPanel', 'grnPanel', 'piPanel'].forEach(show);
    renderReceipt(); renderAssignOptions(); renderChecks({}); renderPiTotals();
    paintSupplier();
    await loadPendingPos();
    loadDefaults();
    setStatus('captureStatus', 'GRN started. Click PO lines under Pending POs to add them, '
      + 'then enter the quantity received on each.', 'ok');
    $('matchPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    setStatus('captureStatus', err.message, 'error');
  } finally {
    $('startManualBtn').disabled = false;
  }
}

// -- defaults from the ERP's own history ------------------------------------

function setDefault(selectId, hintId, value) {
  var select = $(selectId);
  if (!value) { $(hintId).textContent = ''; return; }
  // Only fill an empty choice: never overwrite one a person has made.
  if (!select.value) select.value = String(value.ledgerId ?? value.warehouseId);
  $(hintId).textContent = String(select.value) === String(value.ledgerId ?? value.warehouseId)
    ? 'From ' + value.source : '';
}

async function loadDefaults() {
  try {
    var d = await api('/receiving/document-sets/' + state.setId + '/defaults');
    setDefault('receivedBy', 'receivedByHint', d.receivedBy);
    setDefault('defaultWarehouse', 'warehouseHint', d.warehouse);
    setDefault('purchaseLedgerId', 'purchaseLedgerHint', d.purchaseLedger);
    setDefault('freightLedgerId', 'freightLedgerHint', d.freightLedger);
    state.defaultWarehouseId = num($('defaultWarehouse').value);
    paintDefaultWarehouse();
    if (state.documentSet && state.documentSet.extractedLines) renderReceipt();
  } catch (err) {
    /* Defaults are a convenience; every field can still be chosen by hand. */
  }
}

// -- 2 · review -------------------------------------------------------------

// What is printed on the invoice. Gate entry, vehicle and e-way bill are GRN
// details, and live in step 4 as they do on the ERP's own screen.
var HEADER_FIELDS = [
  ['invoiceNo', 'Invoice no.'], ['invoiceDate', 'Invoice date'],
  ['supplierGstin', 'Supplier GSTIN'], ['buyerGstin', 'Buyer GSTIN'],
  ['taxType', 'Tax type'], ['poNumbers', 'PO numbers (header)'],
  // Freight and round-off are edited in step 5, where they shape the purchase
  // invoice; these are the invoice's own printed figures, for the checks.
  ['subTotal', 'Sub total'],
  ['cgst', 'CGST'], ['sgst', 'SGST'], ['igst', 'IGST'],
  ['grandTotal', 'Grand total'],
];

var LINE_FIELDS = [
  ['description', 'Description', false], ['hsn', 'HSN', false],
  ['qty', 'Qty', true], ['uom', 'Unit', false],
  ['rate', 'Rate', true], ['amount', 'Amount', true],
  ['poRef', 'PO ref', false],
];

function renderReview() {
  var header = state.documentSet.extractedHeader || {};
  var host = $('headerFields');
  host.innerHTML = '';

  HEADER_FIELDS.forEach(function (field) {
    var key = field[0];
    var label = el('label', null, field[1]);
    var input = el('input');
    input.id = 'hdr_' + key;
    var value = header[key];
    if (Array.isArray(value)) value = value.join(', ');
    if (/date/i.test(key)) {
      input.type = 'date';
      value = localDateInput(value);
    }
    input.value = text(value);
    label.appendChild(input);
    host.appendChild(label);
  });

  var table = $('linesTable');
  table.innerHTML = '';
  var head = table.insertRow();
  LINE_FIELDS.forEach(function (f) { head.appendChild(el('th', f[2] ? 'num' : null, f[1])); });

  (state.documentSet.extractedLines || []).forEach(function (line, index) {
    var row = table.insertRow();
    LINE_FIELDS.forEach(function (f) {
      var cell = row.insertCell();
      if (f[2]) cell.className = 'num';
      var input = el('input');
      input.id = 'line_' + index + '_' + f[0];
      input.value = text(line[f[0]]);
      if (f[2]) input.type = 'number';
      cell.appendChild(input);
    });
  });
}

function collectCorrections() {
  var header = {};
  HEADER_FIELDS.forEach(function (field) {
    var raw = $('hdr_' + field[0]).value;
    if (field[0] === 'poNumbers') {
      header.poNumbers = raw.split(/[\s,;]+/).filter(Boolean);   // "2420, 3232" -> a list
      return;
    }
    header[field[0]] = raw === '' ? null : raw;
  });

  var lines = (state.documentSet.extractedLines || []).map(function (line, index) {
    var updated = { lineNo: line.lineNo };
    LINE_FIELDS.forEach(function (f) {
      var raw = $('line_' + index + '_' + f[0]).value;
      updated[f[0]] = f[2] ? num(raw) : (raw === '' ? null : raw);
    });
    return updated;
  });

  return { header: header, lines: lines };
}

async function match() {
  if (!state.documentSet || !state.documentSet.context || !state.documentSet.context.supplierLedgerId) {
    setStatus('reviewStatus', 'Choose the supplier in step 1 first - matching needs its POs.', 'error');
    return;
  }
  $('matchBtn').disabled = true;
  try {
    var edited = collectCorrections();
    setStatus('reviewStatus', 'Saving your corrections...');
    await api('/receiving/document-sets/' + state.setId, {
      method: 'PATCH',
      body: {
        extractedHeader: edited.header,
        extractedLines: edited.lines,
        reason: 'Reviewed in GRN Creator before matching',
      },
    });
    await runMatch('reviewStatus');
    ['matchPanel', 'grnPanel', 'piPanel'].forEach(show);
    hide('previewPanel');
    loadPendingPos();
    setStatus('reviewStatus', '', null);
  } catch (err) {
    setStatus('reviewStatus', err.message, 'error');
  } finally {
    $('matchBtn').disabled = false;
  }
}

// -- 3 · receive against POs ------------------------------------------------

var SCOPE_HINT = {
  open: 'What this invoice can be received against.',
  closed: 'Also shows PO lines already closed or fully received - to see where an invoice '
    + 'belonged. A line on a closed PO cannot be posted.',
};

function paintScope() {
  var scope = state.includeClosed ? 'closed' : 'open';
  Array.prototype.forEach.call(document.querySelectorAll('#poScope .tab'), function (tab) {
    var on = tab.dataset.scope === scope;
    tab.classList.toggle('active', on);
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  $('poScopeHint').textContent = SCOPE_HINT[scope];
}

/** Flip the toggle and match again in the new scope. */
async function setScope(scope) {
  var includeClosed = scope === 'closed';
  if (includeClosed === state.includeClosed) return;
  state.includeClosed = includeClosed;
  paintScope();
  if (!state.setId || $('matchPanel').classList.contains('hidden')) return;
  hide('previewPanel');   // a preview from the other scope would mislead
  try {
    await runMatch('matchStatus');
    await loadPendingPos();
  } catch (err) {
    setStatus('matchStatus', err.message, 'error');
  }
}

/** A GRN line's input, by field (stockQty, qty, rate) - or null. */
function lineInput(tableId, field, lineNo) {
  return document.querySelector('#' + tableId + ' input[data-field="' + field + '"][data-line="' + lineNo + '"]');
}

/** Run the match in the current scope and render what comes back. */
async function runMatch(statusId) {
  setStatus(statusId, state.includeClosed
    ? 'Matching against open and closed POs...'
    : 'Matching against open POs...');
  var result = await api('/receiving/document-sets/' + state.setId + '/match', {
    method: 'POST',
    body: { includeClosed: state.includeClosed },
  });
  applyMatchResult(result);
  setStatus(statusId, '', null);
  return result;
}

function applyMatchResult(result) {
  state.documentSet = result.documentSet;
  state.checks = result.checks || [];
  state.reasons = {};
  var h = state.documentSet.extractedHeader || {};
  // In AI mode these mirror the invoice; in manual mode they are the person's
  // own, possibly unsaved, typing - leave them be.
  if (state.entryMode === 'ai') {
    $('dnNo').value = text(h.invoiceNo);
    $('dnDate').value = localDateInput(h.invoiceDate);
    // Keep step 2 in step with edits made in step 3.
    if (!$('reviewPanel').classList.contains('hidden')) renderReview();
  }
  renderReceipt();
  renderAssignOptions();
  renderPending();
  renderChecks(result);
  renderPiTotals();
}

/**
 * The GRN lines - the ERP's Batch Stock Details grid, one row per PO line.
 * Receipt Qty comes in both units, as there: typing either fills in the other
 * (sheets <-> kg for paper bought by the kilo; the same number otherwise). A
 * manual line starts at quantity 0 and is marked until something is entered.
 * The rate is not here: it belongs to the purchase invoice, step 5.
 */
var RECEIPT_COLUMNS = [
  ['#', 'c-no'], ['P.O. No.', 'c-po'], ['Item Code', 'c-code'], ['Item Name', 'c-name'],
  ['Receipt Qty (S.U.)', 'c-qty num'], ['Receipt Qty (P.U.)', 'c-qty num'], ['Stock Unit', 'c-unit'],
  ['Wt/Packing', 'c-wt num'], ['Warehouse', 'c-wh'], ['', 'c-act'],
];

function packingText(v) {
  var n = num(v);
  return n === null ? '' : String(Math.round(n * 1e6) / 1e6);
}

function qtyInput(line, field, label, unit) {
  var input = el('input', 'cell-input' + (!(num(line.qty) > 0) ? ' needs' : ''));
  input.type = 'number';
  input.min = '0';
  input.step = 'any';
  var value = field === 'stockQty' && (line.stockQty === null || line.stockQty === undefined) ? line.qty : line[field];
  input.value = text(value);
  input.title = label + (unit ? ' in ' + unit : '');
  input.dataset.field = field;
  input.dataset.line = line.lineNo;
  input.setAttribute('aria-label', label + ', line ' + line.lineNo);
  input.addEventListener('change', function () {
    var edit = {};
    edit[field] = num(input.value);
    editLine(line.lineNo, edit, 'matchStatus');
  });
  return input;
}

function renderReceipt() {
  var table = $('receiptTable');
  table.innerHTML = '';
  var head = table.insertRow();
  RECEIPT_COLUMNS.forEach(function (c) { head.appendChild(el('th', c[1], c[0])); });

  var lines = (state.documentSet && state.documentSet.extractedLines) || [];
  $('linesCount').textContent = lines.length ? String(lines.length) : '';
  if (!lines.length) {
    var empty = table.insertRow().insertCell();
    empty.colSpan = RECEIPT_COLUMNS.length;
    empty.className = 'empty';
    empty.textContent = 'No lines yet. Click PO lines under Pending POs to add them.';
    return;
  }

  lines.forEach(function (line) {
    var row = table.insertRow();
    if (!line.matchedPoTransactionId) row.className = 'unmatched';
    else if (line.matchedPoClosed) row.className = 'closed';
    row.dataset.line = line.lineNo;

    row.insertCell().textContent = text(line.lineNo);

    var poCell = row.insertCell();
    poCell.appendChild(document.createTextNode(line.poVoucherNo || '- no PO -'));
    if (line.matchedPoClosed) poCell.appendChild(el('span', 'badge badge-closed', 'closed'));
    if (line.matchManual) poCell.appendChild(el('span', 'badge badge-manual', line.addedByHand ? 'added' : 'by hand'));

    row.insertCell().textContent = text(line.itemCode);

    // The ERP's item name. An invoice line also shows its own wording, and
    // why it went to this PO line, so a wrong match is easy to spot.
    var name = row.insertCell();
    name.className = 'wrap';
    name.appendChild(document.createTextNode(text(line.itemName || line.description)));
    if (!line.addedByHand && line.description && line.itemName && line.description !== line.itemName) {
      name.appendChild(el('small', 'from-invoice', 'Invoice: ' + line.description));
    }
    if (line.matchBasis) name.title = line.matchBasis;

    var su = row.insertCell(); su.className = 'num';
    su.appendChild(qtyInput(line, 'stockQty', 'Receipt qty (S.U.)', line.stockUnit));
    var pu = row.insertCell(); pu.className = 'num';
    pu.appendChild(qtyInput(line, 'qty', 'Receipt qty (P.U.)', line.purchaseUnit || line.uom));

    row.insertCell().textContent = text(line.stockUnit);
    var wt = row.insertCell(); wt.className = 'num'; wt.textContent = packingText(line.wtPerPacking);

    // The warehouse belongs to the GRN line, as on the ERP's own screen.
    var whCell = row.insertCell();
    var select = el('select', 'cell-select');
    var current = line.warehouseId || state.defaultWarehouseId;
    (state.reference.warehouses || []).forEach(function (w) {
      var o = el('option', null, warehouseLabel(w));
      o.value = w.WarehouseID;
      if (String(w.WarehouseID) === String(current)) o.selected = true;
      select.appendChild(o);
    });
    if (!current) {
      var blank = el('option', null, 'Choose...'); blank.value = ''; blank.selected = true;
      select.insertBefore(blank, select.firstChild);
    }
    select.addEventListener('change', function () { setLineWarehouse(line.lineNo, select.value); });
    whCell.appendChild(select);

    var actions = row.insertCell();
    actions.className = 'row-actions';
    var change = el('button', 'link', line.matchedPoTransactionId ? 'Change PO' : 'Choose PO');
    change.type = 'button';
    change.addEventListener('click', function () { chooseFor(line.lineNo); });
    actions.appendChild(change);
    if (line.matchManual && !line.addedByHand) {
      var undo = el('button', 'link', 'Undo');
      undo.type = 'button';
      undo.title = 'Remove your choice; the line is matched automatically again.';
      undo.addEventListener('click', function () { assign(line.lineNo, null); });
      actions.appendChild(undo);
    }
    var remove = el('button', 'link danger-link', 'Remove');
    remove.type = 'button';
    remove.title = 'Take this line off the GRN.';
    remove.addEventListener('click', function () { removeLine(line.lineNo); });
    actions.appendChild(remove);
  });
}

async function setLineWarehouse(lineNo, warehouseId) {
  if (!warehouseId) return;
  try {
    await api('/receiving/document-sets/' + state.setId + '/lines/' + lineNo, {
      method: 'PATCH', body: { warehouseId: num(warehouseId) },
    });
    (state.documentSet.extractedLines || []).forEach(function (l) {
      if (String(l.lineNo) === String(lineNo)) l.warehouseId = num(warehouseId);
    });
    setStatus('matchStatus', 'Line ' + lineNo + ' goes to ' + warehouseName(warehouseId) + '.', 'ok');
  } catch (err) {
    setStatus('matchStatus', err.message, 'error');
  }
}

/** Up to the Pending POs grid with a line ready to be placed. */
function chooseFor(lineNo) {
  $('assignLine').value = String(lineNo);
  renderPending();
  $('pendingView').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// -- the Pending POs tab ----------------------------------------------------

// The columns of the ERP's own GRN screen, in its order.
var PENDING_COLUMNS = [
  { key: 'poVoucherNo', label: 'P.O. No.' },
  { key: 'poDate', label: 'P.O. Date', value: function (r) { return displayDate(r.poDate); } },
  { key: 'itemCode', label: 'Item Code' },
  { key: 'subGroup', label: 'Sub Group' },
  { key: 'itemName', label: 'Item Name' },
  { key: 'orderedQty', label: 'P.O. Qty (P.U.)', num: true, value: function (r) { return qtyText(r.orderedQty); } },
  { key: 'orderedStockQty', label: 'P.O. Qty (S.U.)', num: true, value: function (r) { return qtyText(r.orderedStockQty); } },
  { key: 'tolerancePct', label: 'Tol. (%)', num: true, value: function (r) { return qtyText(r.tolerancePct || 0); } },
  { key: 'pendingQty', label: 'Pending Qty (P.U.)', num: true, value: function (r) { return qtyText(r.pendingQty); } },
  { key: 'pendingStockQty', label: 'Pending Qty (S.U.)', num: true, value: function (r) { return qtyText(r.pendingStockQty); } },
  { key: 'purchaseUnit', label: 'Purchase Unit', value: function (r) { return text(r.purchaseUnit).trim(); } },
  { key: 'stockUnit', label: 'Stock Unit' },
  { key: 'poRefRemark', label: 'P.O. Ref. Remark' },
  { key: 'jobCardNo', label: 'Job Card No.' },
  { key: 'refClient', label: 'Ref. Client' },
];

function cellValue(col, row) {
  return col.value ? col.value(row) : text(row[col.key]);
}

async function loadPendingPos() {
  try {
    var res = await api('/receiving/document-sets/' + state.setId + '/po-lines'
      + (state.includeClosed ? '?includeClosed=true' : ''));
    state.poLines = res.lines || [];
    renderPending();
  } catch (err) {
    setStatus('matchStatus', 'Could not load the PO lines: ' + err.message, 'error');
  }
}

function renderAssignOptions() {
  var select = $('assignLine');
  var keep = select.value;
  select.innerHTML = '';
  var addNew = el('option', null, 'adds it as a new line');
  addNew.value = 'new';
  select.appendChild(addNew);
  var lines = (state.documentSet && state.documentSet.extractedLines) || [];
  lines.forEach(function (l) {
    var o = el('option', null, 'puts line ' + l.lineNo + ' on it - ' + text(l.description).slice(0, 36)
      + ' - ' + qtyText(l.qty) + ' @ ' + money(l.rate)
      + (l.poVoucherNo ? ' (now ' + l.poVoucherNo + ')' : ' (no PO)'));
    o.value = l.lineNo;
    select.appendChild(o);
  });
  // Keep the choice if it still exists. Otherwise: manual entry adds lines;
  // an invoice starts on its first line with no PO.
  var firstUnmatched = lines.filter(function (l) { return !l.matchedPoTransactionId; })[0];
  var fallback = state.entryMode === 'manual' ? 'new' : String((firstUnmatched || {}).lineNo || 'new');
  var exists = Array.prototype.some.call(select.options, function (o) { return o.value === keep; });
  select.value = keep && exists ? keep : fallback;
}

/**
 * The supplier's PO lines, with a search box under every heading - the same
 * grid as the top of the ERP's GRN screen. Rows already carrying an invoice
 * line say which, and rows at the selected line's exact rate are marked, which
 * is usually all it takes to see the right one.
 */
function renderPending() {
  var table = $('pendingTable');
  var lines = (state.documentSet && state.documentSet.extractedLines) || [];
  var used = {};
  lines.forEach(function (l) {
    if (l.matchedPoTransactionDetailId) {
      (used[l.matchedPoTransactionDetailId] = used[l.matchedPoTransactionDetailId] || []).push(l.lineNo);
    }
  });
  var rows = state.poLines.map(function (r) {
    var copy = Object.assign({}, r);
    copy.usedBy = used[r.transactionDetailId] ? lineNoList(used[r.transactionDetailId]) : '';
    return copy;
  });

  var selected = lines.filter(function (l) { return String(l.lineNo) === $('assignLine').value; })[0];
  var selectedRate = selected ? num(selected.rate) : null;

  // Build the head once, so typing in a filter does not lose focus.
  if (!table.tHead) {
    var thead = table.createTHead();
    var labels = thead.insertRow();
    var filters = thead.insertRow();
    filters.className = 'filter-row';
    PENDING_COLUMNS.forEach(function (col) {
      labels.appendChild(el('th', col.num ? 'num' : null, col.label));
      var th = el('th');
      var input = el('input', 'filter');
      input.placeholder = 'Search';
      input.setAttribute('aria-label', 'Search ' + col.label);
      input.value = state.filters[col.key] || '';
      input.addEventListener('input', function () {
        state.filters[col.key] = input.value;
        renderPending();
      });
      th.appendChild(input);
      filters.appendChild(th);
    });
  }

  var body = table.tBodies[0] || table.createTBody();
  body.innerHTML = '';
  var shown = rows.filter(function (r) {
    return PENDING_COLUMNS.every(function (col) {
      var f = (state.filters[col.key] || '').trim().toLowerCase();
      return !f || cellValue(col, r).toLowerCase().indexOf(f) !== -1;
    });
  });

  shown.forEach(function (r) {
    var row = body.insertRow();
    row.dataset.detailId = r.transactionDetailId;
    var classes = ['pick'];
    if (r.closed) classes.push('closed');
    if (r.usedBy) classes.push('used');
    if (selectedRate !== null && Math.abs(num(r.rate) - selectedRate) <= 0.01) classes.push('rate-hit');
    row.className = classes.join(' ');
    var target = $('assignLine').value;
    var note = (r.usedBy ? 'Already on line ' + r.usedBy + '. ' : '') + (r.closed ? 'Closed PO. ' : '')
      + (target === 'new' ? 'Click to add ' : 'Click to put line ' + target + ' on ')
      + r.poVoucherNo + ' - ' + text(r.itemName);
    PENDING_COLUMNS.forEach(function (col) {
      var c = row.insertCell();
      if (col.num) c.className = 'num';
      c.textContent = cellValue(col, r);
      // Rows stay one line high; the full text is a hover away.
      c.title = col.key === 'itemName' ? cellValue(col, r) + '\n' + note : note;
    });
    row.addEventListener('click', function () {
      var target = $('assignLine').value;
      if (target === 'new') addLine(r.transactionDetailId);
      else assign(num(target), r.transactionDetailId);
    });
  });

  if (!shown.length) {
    var empty = body.insertRow();
    var c = empty.insertCell();
    c.colSpan = PENDING_COLUMNS.length;
    c.className = 'empty';
    c.textContent = rows.length ? 'No PO line matches the search.' : 'This supplier has no PO lines here.';
  }
  $('pendingCount').textContent = rows.length ? String(rows.length) : '';
  sizePendingBox();
}

/**
 * Ten rows, then scroll - the head and its search boxes stay put. Measured,
 * not guessed, so it holds whatever the row height turns out to be.
 */
function sizePendingBox() {
  var wrap = $('pendingWrap');
  var table = $('pendingTable');
  if (!wrap || wrap.offsetParent === null) return;   // hidden: sized when shown
  var height = table.tHead ? table.tHead.offsetHeight : 0;
  var rows = table.tBodies[0] ? table.tBodies[0].rows : [];
  for (var i = 0; i < Math.min(10, rows.length); i++) height += rows[i].offsetHeight;
  wrap.style.maxHeight = (height + 2) + 'px';
}

/** Put a line on a PO line, or take it off (detailId null). */
async function assign(lineNo, detailId) {
  if (!lineNo) return;
  try {
    setStatus('matchStatus', detailId ? 'Placing line ' + lineNo + '...' : 'Undoing your choice...');
    var result = await api('/receiving/document-sets/' + state.setId + '/lines/' + lineNo + '/assign', {
      method: 'POST', body: { poTransactionDetailId: detailId },
    });
    applyMatchResult(result);
    hide('previewPanel');
    flashLine(lineNo, 'stockQty');
    var placed = (state.documentSet.extractedLines || []).filter(function (l) {
      return String(l.lineNo) === String(lineNo);
    })[0];
    setStatus('matchStatus', detailId
      ? 'Line ' + lineNo + ' is now on ' + (placed && placed.poVoucherNo) + '.'
      : 'Line ' + lineNo + ' will be matched automatically again - press Match again.', 'ok');
  } catch (err) {
    setStatus('matchStatus', err.message, 'error');
  }
}

/** Add a PO line as a new line, starting at quantity 0. */
async function addLine(detailId) {
  try {
    setStatus('matchStatus', 'Adding the PO line...');
    var result = await api('/receiving/document-sets/' + state.setId + '/lines', {
      method: 'POST', body: { poTransactionDetailId: detailId },
    });
    applyMatchResult(result);
    hide('previewPanel');
    var added = (state.documentSet.extractedLines || []).filter(function (l) {
      return String(l.lineNo) === String(result.lineNo);
    })[0];
    // Straight to the new line's quantity box: adding a PO line is only half
    // the job until someone says how much arrived.
    flashLine(result.lineNo, 'stockQty');
    setStatus('matchStatus', 'Added ' + (added ? added.poVoucherNo + ' as line ' + added.lineNo : 'the line')
      + ' - type the quantity received. Click another PO line to add more.', 'ok');
  } catch (err) {
    setStatus('matchStatus', err.message, 'error');
  }
}

/** Bring a GRN line into view, mark it, and put the cursor in one of its boxes. */
function flashLine(lineNo, field) {
  var input = lineInput('receiptTable', field, lineNo);
  if (!input) return;
  input.closest('tr').classList.add('just-added');
  input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  input.focus({ preventScroll: true });
  input.select();
}

/** Change a line's quantity or rate; the server re-prices it and re-checks. */
async function editLine(lineNo, edit, statusId) {
  statusId = statusId || 'matchStatus';
  try {
    var result = await api('/receiving/document-sets/' + state.setId + '/lines/' + lineNo, {
      method: 'PATCH', body: edit,
    });
    applyMatchResult(result);
    hide('previewPanel');
    setStatus(statusId, 'Line ' + lineNo + ' updated.', 'ok');
  } catch (err) {
    setStatus(statusId, err.message, 'error');
  }
}

/** Take a line off this draft GRN. Nothing in the ERP is touched. */
async function removeLine(lineNo) {
  if (!window.confirm('Remove line ' + lineNo + ' from this GRN?')) return;
  try {
    var result = await api('/receiving/document-sets/' + state.setId + '/lines/' + lineNo, { method: 'DELETE' });
    applyMatchResult(result);
    hide('previewPanel');
    setStatus('matchStatus', 'Line ' + lineNo + ' removed.', 'ok');
  } catch (err) {
    setStatus('matchStatus', err.message, 'error');
  }
}

// -- checks -----------------------------------------------------------------

/**
 * The checks, in a section that folds away. The count in its heading stays
 * visible when it is folded, coloured by the worst result, so a blocking
 * failure cannot hide.
 */
/** What a check confirms when it passes; its message says what failed. */
var CHECK_PASSED = {
  INV001: 'Not posted before - no GRN in the ERP has this invoice no. from this supplier',
  INV002: 'Every line is on an open PO of this supplier',
  INV003: 'No line receives more than 10% over what is still pending on its PO',
  INV004: 'Sheets and kg agree within 1%',
  INV005: 'Every rate matches its PO rate',
  INV006: 'Every line amount equals quantity x rate',
  INV007: 'The lines add up to the invoice subtotal',
  INV008: 'Taxable value equals subtotal + freight',
  INV009: 'GST equals taxable value x rate',
  INV010: 'Grand total equals taxable + tax + round off',
  INV011: 'Round off is within ±₹1',
  INV012: 'Tax type (CGST + SGST, or IGST) fits the supplier and plant states',
  INV013: "Billed to CDC's GSTIN",
  INV014: 'E-way bill given where the amount needs one',
  INV015: 'Invoice date is not in the future',
  INV016: 'Invoice date is within the last 90 days',
  INV017: "HSN matches the item's HSN",
  INV018: 'Freight, if any, has a ledger',
  INV019: 'None of the POs is already fully received',
};

function renderChecks(result) {
  var host = $('checksList');
  host.innerHTML = '';

  var failed = state.checks.filter(function (c) { return !c.passed; });
  var blocking = failed.filter(function (c) { return c.severity === 'BLOCK'; });
  var summary = $('checksSummary');
  summary.textContent = !state.checks.length ? 'none yet'
    : failed.length
      ? failed.length + ' of ' + state.checks.length + ' failed' + (blocking.length ? ' - ' + blocking.length + ' blocking' : '')
      : 'all ' + state.checks.length + ' passed';
  summary.className = 'checks-count ' + (blocking.length ? 'bad' : failed.length ? 'warn' : state.checks.length ? 'ok' : '');

  // Failures first - a passing check is evidence, not news.
  state.checks.slice().sort(function (a, b) {
    return (a.passed ? 1 : 0) - (b.passed ? 1 : 0);
  }).forEach(function (c) {
    var kind = c.passed ? 'check-pass' : (c.severity === 'BLOCK' ? 'check-block' : 'check-warn');
    var box = el('div', 'check ' + kind);

    var line = el('div');
    line.appendChild(el('code', null, c.code + (c.lineNo ? ' - line ' + c.lineNo : '')));
    line.appendChild(document.createTextNode(c.passed ? (CHECK_PASSED[c.code] || c.message) : c.message));
    if (!c.passed) {
      line.appendChild(el('span', 'check-sev', c.severity === 'BLOCK' ? 'blocks posting' : 'needs a reason'));
    }
    box.appendChild(line);

    // A warning posts only with a typed reason, stored on the voucher. A
    // block has no reason field at all - it cannot be overridden.
    if (!c.passed && c.severity === 'WARN') {
      var label = el('label', 'reason', 'Reason (required)');
      var input = el('input');
      input.placeholder = 'Why is this acceptable?';
      input.addEventListener('input', function () { state.reasons[c.code] = input.value; });
      label.appendChild(input);
      box.appendChild(label);
    }
    host.appendChild(box);
  });

  setStatus('matchStatus', result && result.isBlocked
    ? 'Blocking checks failed - the preview and the post are both refused until they are resolved.'
    : '', result && result.isBlocked ? 'warn' : null);
}

// -- 4 · GRN details and 5 · purchase invoice -------------------------------

function fillGrnDetails(header) {
  // From the invoice in AI mode, so read-only there; the person's own in manual mode.
  var manual = state.entryMode === 'manual';
  $('dnNo').value = text(header.invoiceNo);
  $('dnDate').value = localDateInput(header.invoiceDate);
  $('dnNo').readOnly = !manual;
  $('dnDate').readOnly = !manual;
  $('eWayBillNo').value = text(header.eWayBillNo);
  $('gateEntryNo').value = text(header.gateEntryNo);
  $('gateEntryDate').value = localDateInput(header.gateEntryDate);
  $('vehicleNo').value = text(header.vehicleNo);
  $('freightAmount').value = text(header.freight);
  $('roundOffAmount').value = text(header.roundOff);
}

function grnHeader() {
  var v = function (id) { var raw = $(id).value.trim(); return raw === '' ? null : raw; };
  var out = {
    eWayBillNo: v('eWayBillNo'),
    gateEntryNo: v('gateEntryNo'),
    gateEntryDate: v('gateEntryDate'),
    vehicleNo: v('vehicleNo'),
    freight: num($('freightAmount').value),
    roundOff: num($('roundOffAmount').value),
  };
  if (state.entryMode === 'manual') {
    out.invoiceNo = v('dnNo');
    out.invoiceDate = v('dnDate');
  }
  return out;
}

/** What the post needs that the invoice does not say. Never CreatedBy. */
function postContext() {
  return {
    employeeLedgerId: num($('receivedBy').value),
    warehouseId: num($('defaultWarehouse').value),
    purchaseLedgerId: num($('purchaseLedgerId').value),
    freightLedgerId: num($('freightLedgerId').value),
  };
}

/**
 * What the purchase invoice will carry, worked out from the lines the way the
 * writer does it: freight shared over the lines by value, GST on each line's
 * share at its HSN rate. It is the same in both modes - an AI-read invoice's
 * printed total is shown beside it, so a difference is visible before posting.
 */
/**
 * The purchase invoice's lines: quantity in the purchase unit (what is
 * billed), the PO rate, and the rate actually charged - editable, starting at
 * the PO rate. A rate off the PO rate is marked; check INV005 says the same.
 */
var PI_COLUMNS = [
  ['#', 'c-no'], ['P.O. No.', 'c-po'], ['Item Name', 'c-name'], ['Qty (P.U.)', 'c-qty num'],
  ['Unit', 'c-unit'], ['PO rate', 'c-rate num'], ['Rate', 'c-rate num'], ['Amount', 'c-amt num'], ['GST %', 'c-gst num'],
];

function renderPiLines() {
  var table = $('piLinesTable');
  table.innerHTML = '';
  var head = table.insertRow();
  PI_COLUMNS.forEach(function (c) { head.appendChild(el('th', c[1], c[0])); });
  var lines = (state.documentSet && state.documentSet.extractedLines) || [];
  if (!lines.length) {
    var empty = table.insertRow().insertCell();
    empty.colSpan = PI_COLUMNS.length;
    empty.className = 'empty';
    empty.textContent = 'No lines yet.';
    return;
  }
  lines.forEach(function (line) {
    var row = table.insertRow();
    if (!line.matchedPoTransactionId) row.className = 'unmatched';
    else if (line.matchedPoClosed) row.className = 'closed';
    row.insertCell().textContent = text(line.lineNo);
    row.insertCell().textContent = line.poVoucherNo || '- no PO -';
    var name = row.insertCell(); name.className = 'wrap'; name.textContent = text(line.itemName || line.description);
    var q = row.insertCell(); q.className = 'num'; q.textContent = qtyText(line.qty);
    row.insertCell().textContent = text(line.purchaseUnit || line.uom);
    var po = row.insertCell(); po.className = 'num'; po.textContent = money(line.matchedPoRate);

    var off = num(line.matchedPoRate) !== null && num(line.rate) !== null
      && Math.abs(num(line.rate) - num(line.matchedPoRate)) > 0.01;
    var rateCell = row.insertCell(); rateCell.className = 'num';
    var input = el('input', 'cell-input' + (off ? ' needs' : ''));
    input.type = 'number';
    input.min = '0';
    input.step = '0.01';
    input.value = text(line.rate);
    input.title = off ? 'Not the PO rate of ' + money(line.matchedPoRate) : 'Rate';
    input.dataset.field = 'rate';
    input.dataset.line = line.lineNo;
    input.setAttribute('aria-label', 'Rate, line ' + line.lineNo);
    input.addEventListener('change', function () { editLine(line.lineNo, { rate: num(input.value) }, 'piStatus'); });
    rateCell.appendChild(input);

    var amt = row.insertCell(); amt.className = 'num'; amt.textContent = money(line.amount);
    var gst = row.insertCell(); gst.className = 'num'; gst.textContent = qtyText(line.gstPercentage);
  });
}

function renderPiTotals() {
  renderPiLines();
  var set = state.documentSet || {};
  var h = set.extractedHeader || {};
  var lines = (set.extractedLines || []).filter(function (l) { return l.matchedPoTransactionId && !l.matchedPoClosed; });
  var gross = lines.reduce(function (s, l) { return s + (num(l.amount) || 0); }, 0);
  var freight = num($('freightAmount').value) || 0;
  var roundOff = num($('roundOffAmount').value) || 0;
  var cgst = 0; var sgst = 0; var igst = 0; var noRate = [];
  lines.forEach(function (l) {
    var g = num(l.amount) || 0;
    var taxable = g + (gross > 0 ? freight * g / gross : 0);
    if (l.gstPercentage === null || l.gstPercentage === undefined) noRate.push(l.lineNo);
    cgst += taxable * (num(l.cgstPercentage) || 0) / 100;
    sgst += taxable * (num(l.sgstPercentage) || 0) / 100;
    igst += taxable * (num(l.igstPercentage) || 0) / 100;
  });
  var total = gross + freight + cgst + sgst + igst + roundOff;

  $('freightRow').classList.toggle('hidden', !(freight > 0));
  var host = $('piTotals');
  host.innerHTML = '';
  [['Sub total', gross], ['Freight', freight], ['CGST', cgst], ['SGST', sgst],
    ['IGST', igst], ['Round off', roundOff], ['Total', total]].forEach(function (pair) {
    if (pair[0] !== 'Total' && pair[0] !== 'Sub total' && !(Math.abs(pair[1]) > 0.0049)) return;
    var item = el('div', 'total' + (pair[0] === 'Total' ? ' grand' : ''));
    item.appendChild(el('span', null, pair[0]));
    item.appendChild(el('b', null, '₹' + money(pair[1])));
    host.appendChild(item);
  });

  var notes = [];
  if (noRate.length) {
    notes.push('No GST rate for line ' + lineNoList(noRate) + ': the supplier\'s state is not known, '
      + 'so the tax could not be split.');
  }
  var printed = num(h.grandTotal);
  if (state.entryMode === 'ai' && printed !== null && lines.length) {
    var diff = Math.round((total - printed) * 100) / 100;
    notes.push(Math.abs(diff) < 0.01
      ? 'Agrees with the invoice total of ₹' + money(printed) + '.'
      : 'The invoice total is ₹' + money(printed) + '; these lines come to ₹' + money(total)
        + ' (' + (diff > 0 ? '+' : '') + money(diff) + ').');
  }
  $('piNote').textContent = notes.join(' ');
}

// -- 6 · preview and post ---------------------------------------------------

function missingForPost() {
  var missing = [];
  var lines = (state.documentSet && state.documentSet.extractedLines) || [];
  if (!lines.length) missing.push('at least one line');
  var noQty = lines.filter(function (l) { return !(num(l.qty) > 0); }).map(function (l) { return l.lineNo; });
  if (noQty.length) missing.push('the quantity received on line ' + lineNoList(noQty));
  if (!$('receivedBy').value) missing.push('received by');
  if (!$('defaultWarehouse').value) missing.push('warehouse');
  if (!$('purchaseLedgerId').value) missing.push('purchase ledger');
  if ((num($('freightAmount').value) || 0) > 0 && !$('freightLedgerId').value) missing.push('freight ledger');
  return missing;
}

/** Save steps 4 and 5, refresh the checks against them, then dry-run. */
async function preview() {
  var missing = missingForPost();
  if (missing.length) {
    setStatus('piStatus', 'Still needed: ' + missing.join(', ') + '.', 'error');
    return;
  }
  $('previewBtn').disabled = true;
  try {
    setStatus('piStatus', 'Saving the GRN details...');
    await api('/receiving/document-sets/' + state.setId, {
      method: 'PATCH',
      body: { extractedHeader: grnHeader(), context: postContext(), reason: 'GRN details and ledgers' },
    });
    // Gate entry or e-way bill can change what the checks say.
    await runMatch('piStatus');

    setStatus('piStatus', 'Building the vouchers without writing them...');
    var result = await api('/receiving/document-sets/' + state.setId + '/post?dryRun=true', {
      method: 'POST', body: { context: postContext(), dryRun: true },
    });
    state.erpWritesEnabled = Boolean(result.erpWritesEnabled);
    renderPreview(result);
    show('previewPanel');
    $('previewPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setStatus('piStatus', '', null);
  } catch (err) {
    var detail = err.payload && err.payload.checks
      ? ' (' + err.payload.checks.map(function (c) { return c.code + (c.lineNo ? ' line ' + c.lineNo : ''); }).join(', ') + ')'
      : '';
    setStatus('piStatus', err.message + detail, 'error');
  } finally {
    $('previewBtn').disabled = false;
  }
}

/**
 * The voucher numbers are the headline. A number of 1 means the FYear filter
 * matched nothing - the allocator bug - so it is shown red, where it cannot
 * be missed, rather than left in the JSON.
 */
function renderPreview(result) {
  var host = $('voucherNos');
  host.innerHTML = '';

  [['GRN', result.grn], ['Purchase invoice', result.pi]].forEach(function (pair) {
    var voucherNo = pair[1] && pair[1].voucherNo ? pair[1].voucherNo : '-';
    var box = el('div', 'voucher-no' + (/00001_/.test(voucherNo) ? ' bad' : ''));
    box.appendChild(el('small', null, pair[0]));
    box.appendChild(document.createTextNode(voucherNo));
    host.appendChild(box);
  });

  var fy = el('div', 'voucher-no' + (/^\d{4}-\d{4}$/.test(result.fYear || '') ? '' : ' bad'));
  fy.appendChild(el('small', null, 'FYear column'));
  fy.appendChild(document.createTextNode(result.fYear || '-'));
  host.appendChild(fy);

  $('grnPreview').textContent = JSON.stringify(result.grn, null, 2);
  $('piPreview').textContent = JSON.stringify(result.pi, null, 2);
  $('closePreview').textContent = JSON.stringify(result.closedLines || [], null, 2);

  if (state.erpWritesEnabled) {
    $('postBtn').disabled = false;
    $('postNote').textContent = 'ERP writes are ENABLED on this server. This writes real vouchers.';
    hide('writeBadge');
  } else {
    $('postBtn').disabled = true;
    $('postNote').textContent =
      'Posting is off: SP_ENABLE_ERP_WRITES is not true, or no write login is configured.';
    show('writeBadge');
  }
}

async function post() {
  var ok = window.confirm('Write a real GRN and purchase invoice to ' + state.context.site
    + '? This cannot be undone from here.');
  if (!ok) return;

  $('postBtn').disabled = true;
  try {
    setStatus('previewStatus', 'Posting...');
    var overrides = Object.keys(state.reasons).map(function (code) {
      return { code: code, reason: state.reasons[code] };
    });
    var result = await api('/receiving/document-sets/' + state.setId + '/post', {
      method: 'POST', body: { context: postContext(), overrides: overrides },
    });
    setStatus('previewStatus',
      'Posted. GRN ' + result.grn.voucherNo + ', purchase invoice ' + result.pi.voucherNo + '.', 'ok');
    await loadHistory();
  } catch (err) {
    var detail = err.payload && err.payload.checks
      ? ' - ' + err.payload.checks.map(function (c) { return c.code; }).join(', ')
      : '';
    setStatus('previewStatus', err.message + detail, 'error');
    $('postBtn').disabled = false;
  }
}

// -- history ----------------------------------------------------------------

async function loadHistory() {
  try {
    var rows = await api('/receiving/document-sets');
    var list = Array.isArray(rows) ? rows : (rows.documentSets || rows.items || []);
    var table = $('historyTable');
    table.innerHTML = '';
    var head = table.insertRow();
    ['Created', 'Site', 'Invoice', 'Status', 'GRN', 'Purchase invoice'].forEach(function (label) {
      head.appendChild(el('th', null, label));
    });
    list.forEach(function (set) {
      var row = table.insertRow();
      row.insertCell().textContent = set.createdAt ? String(set.createdAt).slice(0, 16).replace('T', ' ') : '';
      row.insertCell().textContent = text(set.site);
      row.insertCell().textContent = set.extractedHeader ? text(set.extractedHeader.invoiceNo) : '';
      row.insertCell().textContent = text(set.status);
      row.insertCell().textContent = set.posted ? text(set.posted.grnVoucherNo) : '';
      row.insertCell().textContent = set.posted ? text(set.posted.piVoucherNo) : '';
    });
  } catch (err) {
    /* History is a convenience; a failure here must not block receiving. */
  }
  await refreshDraftButton();
}

// -- testing cleanup --------------------------------------------------------

/**
 * TESTING ONLY. The delete-drafts button shows only when the server allows it;
 * a 404 means SP_ALLOW_DRAFT_DELETE is off - production - and it stays hidden.
 */
async function refreshDraftButton() {
  var btn = $('deleteDraftsBtn');
  try {
    var info = await api('/receiving/drafts');
    if (!info || !info.enabled || !info.drafts) { btn.classList.add('hidden'); return; }
    btn.textContent = 'Delete ' + info.drafts + ' test draft' + (info.drafts === 1 ? '' : 's');
    btn.classList.remove('hidden');
  } catch (e) {
    btn.classList.add('hidden');
  }
}

async function deleteDrafts() {
  var btn = $('deleteDraftsBtn');
  btn.disabled = true;
  try {
    var preview = await api('/receiving/drafts?dryRun=true', { method: 'DELETE' });
    if (!preview.drafts) { setStatus('historyStatus', 'No drafts to delete.', null); return; }

    var ok = window.confirm(
      'Permanently delete ' + preview.drafts + ' unposted draft(s) for ' + preview.site
      + ' and ' + preview.files + ' stored invoice file(s)?\n\n'
      + 'Posted GRNs are never touched. This cannot be undone.');
    if (!ok) return;

    var result = await api('/receiving/drafts', { method: 'DELETE' });
    var msg = 'Deleted ' + result.deleted + ' draft(s) and ' + result.filesDeleted + ' file(s).';
    if (result.skippedAsPosted) msg += ' ' + result.skippedAsPosted + ' skipped - posted meanwhile.';
    var fileErrors = (result.fileErrors || []).length;
    if (fileErrors) msg += ' ' + fileErrors + ' file(s) could not be removed.';
    setStatus('historyStatus', msg, fileErrors ? 'warn' : 'ok');

    ['reviewPanel', 'matchPanel', 'grnPanel', 'piPanel', 'previewPanel'].forEach(hide);
    state.setId = null;
    state.documentSet = null;
  } catch (err) {
    setStatus('historyStatus', err.message, 'error');
  } finally {
    btn.disabled = false;
    await loadHistory();
  }
}

// -- wiring -----------------------------------------------------------------

$('themeToggle').addEventListener('click', toggleTheme);
$('signInForm').addEventListener('submit', signIn);
$('signOutBtn').addEventListener('click', signOut);
$('extractBtn').addEventListener('click', extract);
$('matchBtn').addEventListener('click', match);
$('rematchBtn').addEventListener('click', function () {
  hide('previewPanel');
  runMatch('matchStatus').catch(function (err) { setStatus('matchStatus', err.message, 'error'); });
});
$('previewBtn').addEventListener('click', preview);
$('startManualBtn').addEventListener('click', startManual);
['freightAmount', 'roundOffAmount'].forEach(function (id) { $(id).addEventListener('input', renderPiTotals); });
window.addEventListener('resize', sizePendingBox);
// Folded or open, the checks stay as the person left them.
try { if (window.localStorage.getItem('grnCreator.checksOpen') === '0') $('checksBox').open = false; } catch (e) { /* not important */ }
$('checksBox').addEventListener('toggle', function () {
  try { window.localStorage.setItem('grnCreator.checksOpen', $('checksBox').open ? '1' : '0'); } catch (e) { /* not important */ }
});
$('postBtn').addEventListener('click', post);
$('refreshHistory').addEventListener('click', loadHistory);
$('deleteDraftsBtn').addEventListener('click', deleteDrafts);
$('supplierSearch').addEventListener('input', onSupplierInput);
$('assignLine').addEventListener('change', renderPending);
$('defaultWarehouse').addEventListener('change', function () {
  state.defaultWarehouseId = num($('defaultWarehouse').value);
  $('warehouseHint').textContent = '';
  paintDefaultWarehouse();
  if (state.documentSet) renderReceipt();
});
// A person's choice replaces the "From ..." note: it is no longer a default.
[['receivedBy', 'receivedByHint'], ['purchaseLedgerId', 'purchaseLedgerHint'],
  ['freightLedgerId', 'freightLedgerHint']].forEach(function (pair) {
  $(pair[0]).addEventListener('change', function () { $(pair[1]).textContent = ''; });
});
Array.prototype.forEach.call(document.querySelectorAll('#sourceTabs .tab'), function (tab) {
  tab.addEventListener('click', function () { selectSource(tab.dataset.source); });
});
Array.prototype.forEach.call(document.querySelectorAll('#entryMode .tab'), function (tab) {
  tab.addEventListener('click', function () { setEntryMode(tab.dataset.mode); });
});
Array.prototype.forEach.call(document.querySelectorAll('#poScope .tab'), function (tab) {
  tab.addEventListener('click', function () { setScope(tab.dataset.scope); });
});

paintScope();
paintThemeIcon();
watchSystemTheme();
prefillLogin();

if (restoreSession()) {
  onSignedIn().catch(function () {
    // A stale token from a previous run: start clean rather than half-signed-in.
    try { sessionStorage.removeItem('grnCreator'); } catch (e) { /* ignore */ }
    window.location.reload();
  });
}
