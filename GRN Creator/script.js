/**
 * GRN Creator — supplier invoice to a previewed GRN + purchase invoice.
 *
 * A thin client over `/api/supplier-portal/receiving`. Every rule that matters
 * lives on the server: the checks, the block/warning severities, the reason
 * requirement and the write gate. This page renders them and gets out of the
 * way, because the same endpoints will be driven from a tablet in a warehouse
 * and a rule enforced only here would not hold there.
 *
 * The flow mirrors the API exactly:
 *   sign in -> context -> document set -> extract -> correct -> match -> dry run
 */

'use strict';

var BASE = window.AppConfig.portalBase;

var state = {
  token: null,
  context: null,       // { site, erpUserId, employeeLedgerId, warehouseId }
  user: null,
  reference: {},       // dropdown sources, loaded once per sign-in
  setId: null,
  documentSet: null,
  checks: [],
  reasons: {},         // check code -> typed reason
  erpWritesEnabled: false,
  source: 'file',
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

function text(v) { return v === null || v === undefined ? '' : String(v); }

function el(tag, className, content) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
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
 * ERP sign-in: user name and database, no password.
 *
 * The server looks the name up in the ERP's UserMaster, so the UserID that
 * lands in CreatedBy on every row this tool writes is the ERP's own.
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
  show('contextPanel'); show('capturePanel'); show('historyPanel');
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

  fillSelect('employeeLedgerId', state.reference.employees, 'LedgerID',
    function (r) { return r.LedgerName + (r.Designation ? ' - ' + r.Designation : ''); },
    state.context.employeeLedgerId, 'Choose...');

  // WarehouseBinName / BinName live on the warehouse row - the plan's "bin" is
  // part of choosing a warehouse, not a separate column on the voucher line.
  fillSelect('warehouseId', state.reference.warehouses, 'WarehouseID',
    function (r) {
      var bin = r.WarehouseBinName || r.BinName;
      return r.WarehouseName + (bin ? ' / ' + bin : '') + (r.IsFloorWarehouse ? ' (floor)' : '');
    },
    state.context.warehouseId, 'Choose...');

  fillSelect('purchaseLedgerId', state.reference.purchaseLedgers, 'LedgerID',
    function (r) { return r.LedgerName; }, null, 'Choose...');

  // Only the inward-freight ledgers are a sensible choice here; the GST and
  // round-off ledgers are picked by the server from their own kinds.
  var freight = state.reference.chargeLedgers.filter(function (r) {
    return /freight/i.test(r.LedgerName || '');
  });
  fillSelect('freightLedgerId', freight, 'LedgerID',
    function (r) { return r.LedgerName; }, null, 'None');

  $('erpUserId').value = text(state.context.erpUserId);

  var supplierList = $('supplierList');
  supplierList.innerHTML = '';
  state.reference.suppliers.forEach(function (row) {
    var option = el('option');
    // The datalist shows the name; the id is recovered on input by name match.
    option.value = row.LedgerName + '  [' + row.LedgerID + ']';
    supplierList.appendChild(option);
  });

  checkContext();
}

/**
 * The post refuses without these, and the failure message arrives only after
 * extraction and matching have already been paid for. Saying so up front is
 * cheaper than discovering it at the end.
 */
function checkContext() {
  var missing = [];
  if (!$('employeeLedgerId').value) missing.push('received by');
  if (!$('warehouseId').value) missing.push('warehouse');
  if (!$('purchaseLedgerId').value) missing.push('purchase ledger');
  if (!$('erpUserId').value) missing.push('ERP user id (set --erp-user-id on the account)');

  if (missing.length) {
    $('contextWarn').textContent = 'Still needed before posting: ' + missing.join(', ') + '.';
    show('contextWarn');
  } else {
    hide('contextWarn');
  }
  return missing.length === 0;
}

function currentContext() {
  return {
    userId: num($('erpUserId').value),
    employeeLedgerId: num($('employeeLedgerId').value),
    warehouseId: num($('warehouseId').value),
    purchaseLedgerId: num($('purchaseLedgerId').value),
    freightLedgerId: num($('freightLedgerId').value),
    supplierLedgerId: num($('supplierLedgerId').value),
  };
}

// -- supplier picker --------------------------------------------------------

function onSupplierInput() {
  var typed = $('supplierSearch').value;
  var match = /\[(\d+)\]\s*$/.exec(typed);
  if (match) { $('supplierLedgerId').value = match[1]; return; }

  var exact = (state.reference.suppliers || []).filter(function (r) {
    return String(r.LedgerName || '').toLowerCase() === typed.trim().toLowerCase();
  });
  $('supplierLedgerId').value = exact.length === 1 ? exact[0].LedgerID : '';
}

// -- capture and extraction -------------------------------------------------

function selectSource(source) {
  state.source = source;
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
    tab.classList.toggle('active', tab.dataset.source === source);
  });
  $('sourceFile').classList.toggle('hidden', source !== 'file');
  $('sourceUrl').classList.toggle('hidden', source !== 'url');
}

/** Presigned PUT straight to R2, the same path the tablet would take. */
async function uploadInvoice(file) {
  var presigned = await api('/receiving/upload-url', {
    method: 'POST',
    body: { contentType: file.type, contentLength: file.size },
  });
  var put = await fetch(presigned.url, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!put.ok) throw new Error('Upload to storage failed (HTTP ' + put.status + ').');
  return { storageKey: presigned.key, pageNo: 1 };
}

async function extract() {
  if (!$('supplierLedgerId').value) {
    setStatus('captureStatus', 'Choose a supplier first - matching needs its pending POs.', 'error');
    return;
  }
  $('extractBtn').disabled = true;
  try {
    var slot;
    if (state.source === 'file') {
      var file = $('invoiceFile').files[0];
      if (!file) throw new Error('Choose a file, or switch to the URL tab.');
      setStatus('captureStatus', 'Uploading ' + file.name + '...');
      slot = await uploadInvoice(file);
    } else {
      var url = $('invoiceUrl').value.trim();
      if (!url) throw new Error('Paste a URL, or switch to the file tab.');
      slot = { url: url, pageNo: 1 };
    }

    setStatus('captureStatus', 'Creating the document set...');
    var set = await api('/receiving/document-sets', {
      method: 'POST',
      body: {
        supplierLedgerId: num($('supplierLedgerId').value),
        slots: { supplierInvoice: [slot] },
      },
    });
    state.setId = set._id;

    setStatus('captureStatus', 'Reading the invoice - this is the one slow step...');
    state.documentSet = await api('/receiving/document-sets/' + state.setId + '/extract', { method: 'POST' });

    renderReview();
    show('reviewPanel');
    setStatus('captureStatus', 'Read ' + (state.documentSet.extractedLines || []).length + ' line(s).', 'ok');
  } catch (err) {
    setStatus('captureStatus', err.message, 'error');
  } finally {
    $('extractBtn').disabled = false;
  }
}

// -- review -----------------------------------------------------------------

var HEADER_FIELDS = [
  ['invoiceNo', 'Invoice no.'], ['invoiceDate', 'Invoice date'],
  ['supplierGstin', 'Supplier GSTIN'], ['buyerGstin', 'Buyer GSTIN'],
  ['taxType', 'Tax type'], ['eWayBillNo', 'E-way bill'],
  ['vehicleNo', 'Vehicle'], ['subTotal', 'Sub total'],
  ['freight', 'Freight'], ['cgst', 'CGST'], ['sgst', 'SGST'], ['igst', 'IGST'],
  ['roundOff', 'Round off'], ['grandTotal', 'Grand total'],
  ['gateEntryNo', 'Gate entry no.'], ['gateEntryDate', 'Gate entry date'],
];

var LINE_FIELDS = [
  ['description', 'Description', false], ['hsn', 'HSN', false],
  ['qty', 'Qty', true], ['uom', 'Unit', false],
  ['rate', 'Rate', true], ['amount', 'Amount', true],
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
    // Mongo hands dates back as ISO strings; the input wants just the date.
    if (/date/i.test(key) && value) value = String(value).slice(0, 10);
    input.value = text(value);
    label.appendChild(input);
    host.appendChild(label);
  });

  var table = $('linesTable');
  table.innerHTML = '';
  var head = table.insertRow();
  LINE_FIELDS.forEach(function (f) {
    head.appendChild(el('th', f[2] ? 'num' : null, f[1]));
  });

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

/** Read the edited values back out of the form. */
function collectCorrections() {
  var header = {};
  HEADER_FIELDS.forEach(function (field) {
    var raw = $('hdr_' + field[0]).value;
    header[field[0]] = raw === '' ? null : raw;
  });

  var lines = (state.documentSet.extractedLines || []).map(function (line, index) {
    var updated = Object.assign({}, line);
    LINE_FIELDS.forEach(function (f) {
      var raw = $('line_' + index + '_' + f[0]).value;
      updated[f[0]] = f[2] ? num(raw) : (raw === '' ? null : raw);
    });
    return updated;
  });

  return { header: header, lines: lines };
}

async function match() {
  $('matchBtn').disabled = true;
  try {
    var edited = collectCorrections();
    setStatus('reviewStatus', 'Saving your corrections...');
    await api('/receiving/document-sets/' + state.setId, {
      method: 'PATCH',
      body: {
        extractedHeader: edited.header,
        extractedLines: edited.lines,
        context: currentContext(),
        reason: 'Reviewed in GRN Creator before matching',
      },
    });

    setStatus('reviewStatus', 'Matching against pending POs...');
    var result = await api('/receiving/document-sets/' + state.setId + '/match', { method: 'POST' });

    state.documentSet = result.documentSet;
    state.checks = result.checks || [];
    state.reasons = {};

    renderMatch();
    renderChecks(result);
    show('matchPanel');
    setStatus('reviewStatus', '', null);
  } catch (err) {
    setStatus('reviewStatus', err.message, 'error');
  } finally {
    $('matchBtn').disabled = false;
  }
}

// -- match + checks ---------------------------------------------------------

function renderMatch() {
  var table = $('matchTable');
  table.innerHTML = '';
  var head = table.insertRow();
  ['Invoice line', 'Matched PO', 'Item', 'PO rate', 'Invoice rate', 'Pending', 'Qty']
    .forEach(function (label, i) {
      head.appendChild(el('th', i >= 3 ? 'num' : null, label));
    });

  (state.documentSet.extractedLines || []).forEach(function (line) {
    var row = table.insertRow();
    if (!line.matchedPoTransactionId) row.className = 'unmatched';
    row.insertCell().textContent = text(line.description);
    row.insertCell().textContent = line.poVoucherNo || '- no pending PO -';
    row.insertCell().textContent = text(line.matchedItemId);

    [money(line.matchedPoRate), money(line.rate), text(line.poPendingQty), text(line.qty)]
      .forEach(function (value) {
        var cell = row.insertCell();
        cell.className = 'num';
        cell.textContent = value;
      });
  });
}

function renderChecks(result) {
  var host = $('checksList');
  host.innerHTML = '';

  var failed = state.checks.filter(function (c) { return !c.passed; });
  host.appendChild(el('p', 'checks-summary', failed.length
    ? failed.length + ' of ' + state.checks.length + ' checks failed.'
    : 'All ' + state.checks.length + ' checks passed.'));

  // Failures first - a passing check is evidence, not news.
  state.checks.slice().sort(function (a, b) {
    return (a.passed ? 1 : 0) - (b.passed ? 1 : 0);
  }).forEach(function (c) {
    var kind = c.passed ? 'check-pass' : (c.severity === 'BLOCK' ? 'check-block' : 'check-warn');
    var box = el('div', 'check ' + kind);

    var line = el('div');
    line.appendChild(el('code', null, c.code + (c.lineNo ? ' - line ' + c.lineNo : '')));
    line.appendChild(document.createTextNode(c.message));
    box.appendChild(line);

    // A warning posts only with a typed reason, and the reason is stored on the
    // voucher. A block has no reason field at all - it cannot be overridden.
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

  var blocked = result && result.isBlocked;
  setStatus('matchStatus', blocked
    ? 'Blocking checks failed. The preview still runs; posting would be refused.'
    : '', blocked ? 'warn' : null);
}

// -- preview (dry run) ------------------------------------------------------

async function preview() {
  $('previewBtn').disabled = true;
  try {
    setStatus('matchStatus', 'Building the vouchers without writing them...');
    var result = await api('/receiving/document-sets/' + state.setId + '/post?dryRun=true', {
      method: 'POST',
      body: { context: currentContext(), dryRun: true },
    });

    state.erpWritesEnabled = Boolean(result.erpWritesEnabled);
    renderPreview(result);
    show('previewPanel');
    $('previewPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setStatus('matchStatus', '', null);
  } catch (err) {
    setStatus('matchStatus', err.message, 'error');
  } finally {
    $('previewBtn').disabled = false;
  }
}

/**
 * The voucher numbers are the headline.
 *
 * A number of 1 means the FYear filter matched nothing - the bug where the
 * allocator compared the column against the voucher-number suffix. Showing the
 * number this prominently is what makes that visible without reading the JSON.
 */
function renderPreview(result) {
  var host = $('voucherNos');
  host.innerHTML = '';

  [['GRN', result.grn], ['Purchase invoice', result.pi]].forEach(function (pair) {
    var voucherNo = pair[1] && pair[1].voucherNo ? pair[1].voucherNo : '-';
    var looksWrong = /00001_/.test(voucherNo);
    var box = el('div', 'voucher-no' + (looksWrong ? ' bad' : ''));
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
      method: 'POST',
      body: { context: currentContext(), overrides: overrides },
    });
    setStatus('previewStatus',
      'Posted. GRN ' + result.grn.voucherNo + ', purchase invoice ' + result.pi.voucherNo + '.', 'ok');
    await loadHistory();
  } catch (err) {
    // A 422 carries the checks that stopped it; those are the useful part.
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
      row.insertCell().textContent = set.createdAt
        ? String(set.createdAt).slice(0, 16).replace('T', ' ') : '';
      row.insertCell().textContent = text(set.site);
      row.insertCell().textContent = set.extractedHeader ? text(set.extractedHeader.invoiceNo) : '';
      row.insertCell().textContent = text(set.status);
      row.insertCell().textContent = set.posted ? text(set.posted.grnVoucherNo) : '';
      row.insertCell().textContent = set.posted ? text(set.posted.piVoucherNo) : '';
    });
  } catch (err) {
    /* History is a convenience; a failure here must not block receiving. */
  }
}

// -- wiring -----------------------------------------------------------------

$('signInForm').addEventListener('submit', signIn);
$('signOutBtn').addEventListener('click', signOut);
$('extractBtn').addEventListener('click', extract);
$('matchBtn').addEventListener('click', match);
$('previewBtn').addEventListener('click', preview);
$('postBtn').addEventListener('click', post);
$('refreshHistory').addEventListener('click', loadHistory);
$('supplierSearch').addEventListener('input', onSupplierInput);
['employeeLedgerId', 'warehouseId', 'purchaseLedgerId'].forEach(function (id) {
  $(id).addEventListener('change', checkContext);
});
Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
  tab.addEventListener('click', function () { selectSource(tab.dataset.source); });
});

prefillLogin();

if (restoreSession()) {
  onSignedIn().catch(function () {
    // A stale token from a previous run: start clean rather than half-signed-in.
    try { sessionStorage.removeItem('grnCreator'); } catch (e) { /* ignore */ }
    window.location.reload();
  });
}
