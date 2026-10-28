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
  show('appTabs');
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

  fillChargeSelect('freightLedgerId', null);

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

/**
 * A suggestion list under a box that picks a supplier. This replaces the
 * browser's own <datalist>, which phones do not show dependably: some browsers
 * (Samsung Internet, in-app ones) ignore it, and iPhones show it only as a
 * strip above the keyboard. The box ends up holding "Name  [id]" as before, so
 * everything that reads it is unchanged.
 *
 * Every word typed must appear somewhere in the supplier's name, city, GSTIN
 * or code, in any order: "krishna van" finds "Krishna Vanijya Pvt Ltd".
 */
function attachSupplierSuggest(input) {
  var box = el('ul', 'suggest hidden');
  box.setAttribute('role', 'listbox');
  document.body.appendChild(box);
  var shown = [];
  var active = -1;

  function find(typed) {
    var words = String(typed || '').toLowerCase().replace(/\[\d+\]\s*$/, '').split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return (state.reference.suppliers || []).filter(function (r) {
      var hay = [r.LedgerName, r.City, r.GSTNo, r.LedgerCode].join(' ').toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) !== -1; });
    }).slice(0, 40);
  }

  function place() {
    var r = input.getBoundingClientRect();
    var vv = window.visualViewport;
    var top = vv ? vv.offsetTop : 0;
    var height = vv ? vv.height : window.innerHeight;
    var below = top + height - r.bottom - 8;
    var above = r.top - top - 8;
    box.style.left = (r.left + window.pageXOffset) + 'px';
    box.style.width = r.width + 'px';
    // With a phone keyboard open there may be little room below the box.
    if (below < 180 && above > below) {
      box.style.maxHeight = Math.max(120, Math.min(320, above)) + 'px';
      box.style.top = '';
      box.style.bottom = (document.documentElement.clientHeight - (r.top + window.pageYOffset) + 4) + 'px';
    } else {
      box.style.maxHeight = Math.max(120, Math.min(320, below)) + 'px';
      box.style.bottom = '';
      box.style.top = (r.bottom + window.pageYOffset + 4) + 'px';
    }
  }

  function close() { box.classList.add('hidden'); active = -1; }

  function pick(row) {
    input.value = row.LedgerName + '  [' + row.LedgerID + ']';
    close();
    // The same event typing makes, so whatever listens to the box carries on.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.blur();   // puts the phone keyboard away
  }

  function mark(i) {
    active = i;
    Array.prototype.forEach.call(box.children, function (li, k) { li.classList.toggle('on', k === i); });
    if (box.children[i] && box.children[i].scrollIntoView) box.children[i].scrollIntoView({ block: 'nearest' });
  }

  function open() {
    // A finished choice ("Name  [id]") needs no suggestions.
    if (/\[\d+\]\s*$/.test(input.value)) { close(); return; }
    shown = find(input.value);
    box.innerHTML = '';
    if (!input.value.trim()) { close(); return; }
    if (!shown.length) {
      box.appendChild(el('li', 'none', 'No supplier matches "' + input.value.trim() + '".'));
    }
    shown.forEach(function (row, i) {
      var li = el('li');
      li.setAttribute('role', 'option');
      li.appendChild(document.createTextNode(row.LedgerName));
      var meta = [row.City, row.GSTNo].filter(Boolean).join('  -  ');
      if (meta) li.appendChild(el('small', null, meta));
      // pointerdown, not click: the box must not lose focus (and close) first.
      li.addEventListener('pointerdown', function (e) { e.preventDefault(); });
      li.addEventListener('click', function () { pick(row); });
      li.addEventListener('mousemove', function () { if (active !== i) mark(i); });
      box.appendChild(li);
    });
    active = -1;
    box.classList.remove('hidden');
    place();
  }

  input.addEventListener('input', open);
  input.addEventListener('focus', open);
  input.addEventListener('keydown', function (e) {
    if (box.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); mark(Math.min(shown.length - 1, active + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); mark(Math.max(0, active - 1)); }
    else if (e.key === 'Enter' && active >= 0 && shown[active]) { e.preventDefault(); pick(shown[active]); }
    else if (e.key === 'Escape') { close(); }
  });
  // Tapping anywhere else closes it.
  document.addEventListener('pointerdown', function (e) {
    if (e.target !== input && !box.contains(e.target)) close();
  });
  var reposition = function () { if (!box.classList.contains('hidden')) place(); };
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', reposition);
}

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
    if (state.entryMode === 'manual') {
      // The server has taken every line off the old supplier's POs. Show that,
      // and the new supplier's PO lines to pick from.
      state.documentSet = await api('/receiving/document-sets/' + state.setId);
      state.checks = [];
      renderReceipt(); renderChecks({}); renderPiTotals();
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

// -- the invoice's pages: files chosen or photos taken, in order -------------

/** Longest side a photo is sent at; the reader works at 2,048 pixels anyway. */
var PHOTO_MAX_SIDE = 2400;

function addPages(files) {
  state.pages = state.pages || [];
  Array.prototype.forEach.call(files || [], function (f) { state.pages.push(f); });
  renderPageList();
}

function renderPageList() {
  var host = $('pageList');
  host.innerHTML = '';
  (state.pages || []).forEach(function (file, i) {
    var item = el('div', 'page-item');
    if (/^image\//.test(file.type || '')) {
      var img = el('img');
      img.alt = '';
      img.src = URL.createObjectURL(file);
      img.onload = function () { URL.revokeObjectURL(img.src); };
      item.appendChild(img);
    } else {
      item.appendChild(el('span', 'page-pdf', 'PDF'));
    }
    var meta = el('div', 'page-meta');
    meta.appendChild(el('b', null, 'Page ' + (i + 1)));
    meta.appendChild(el('span', null, file.name + ' - ' + Math.max(1, Math.round(file.size / 1024)) + ' KB'));
    item.appendChild(meta);
    var rm = el('button', 'link danger-link', 'Remove');
    rm.type = 'button';
    rm.addEventListener('click', function () { removePage(i); });
    item.appendChild(rm);
    host.appendChild(item);
  });
  $('pickFileBtn').querySelector('span').textContent = (state.pages || []).length ? 'Add a file' : 'Upload a file';
  $('takePhotoBtn').querySelector('span').textContent = (state.pages || []).length ? 'Add a photo' : 'Take a photo';
}

/**
 * Before the invoice is read, a page just comes off the list. Once it has been
 * read, everything below was worked out from these pages: taking one away
 * starts the whole page again, signed in still. The draft stays in History.
 */
function removePage(i) {
  if (!state.setId) { state.pages.splice(i, 1); renderPageList(); return; }
  var ok = window.confirm('This invoice has already been read. Removing a page starts again '
    + 'from the beginning - everything entered below is cleared.\n\n'
    + 'The draft so far stays in History. Start again?');
  if (ok) window.location.reload();
}

/**
 * A phone photo is 3-5 MB at 4,000 pixels; the reader uses 2,048. Shrink it
 * before upload - turned upright from its EXIF on the way - and leave PDFs and
 * small images alone.
 */
async function shrinkPhoto(file) {
  if (!/^image\/(jpeg|png|webp|heic|heif)/i.test(file.type || '') || typeof createImageBitmap !== 'function') return file;
  try {
    var bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    var scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
    var canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', 0.88); });
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch (e) {
    return file;
  }
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
async function uploadInvoice(file, pageNo) {
  pageNo = pageNo || 1;
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
    return { slot: { storageKey: presigned.key, pageNo: pageNo }, stored: true };
  } catch (err) {
    if (!/^image\//.test(file.type || '')) {
      throw new Error('Could not upload to storage (' + err.message + '), and only images can be '
        + 'read without it. Fix storage, or use the URL tab.');
    }
    if (file.size > MAX_INLINE_BYTES) {
      throw new Error('Could not upload to storage (' + err.message + '), and ' + file.name
        + ' is too large to read without it.');
    }
    return { slot: { url: await readAsDataUrl(file), pageNo: pageNo }, stored: false };
  }
}

async function extract() {
  $('extractBtn').disabled = true;
  try {
    var slots = [];
    var notStored = false;
    if (state.source === 'file') {
      var pages = state.pages || [];
      if (!pages.length) throw new Error('Upload a file or take a photo, or switch to the URL tab.');
      for (var i = 0; i < pages.length; i++) {
        setStatus('captureStatus', 'Sending page ' + (i + 1) + ' of ' + pages.length + '...');
        var uploaded = await uploadInvoice(await shrinkPhoto(pages[i]), i + 1);
        slots.push(uploaded.slot);
        if (!uploaded.stored) notStored = true;
      }
    } else {
      var url = $('invoiceUrl').value.trim();
      if (!url) throw new Error('Paste a URL, or switch to the file tab.');
      slots.push({ url: url, pageNo: 1 });
    }

    setStatus('captureStatus', 'Creating the document set...');
    var set = await api('/receiving/document-sets', {
      method: 'POST',
      // Usually empty: the server identifies the supplier from the invoice.
      // If someone chose one first, that choice stands.
      body: { supplierLedgerId: num($('supplierLedgerId').value), slots: { supplierInvoice: slots } },
    });
    state.setId = set._id;
    resetSaveButton();

    setStatus('captureStatus', 'Reading the invoice - this is the one slow step...');
    state.documentSet = await api('/receiving/document-sets/' + state.setId + '/extract', { method: 'POST' });

    paintSupplier();
    renderReview();
    fillGrnDetails(state.documentSet.extractedHeader || {});
    ['matchPanel', 'grnPanel', 'piPanel'].forEach(hide);
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
    resetSaveButton();
    state.documentSet = set;
    state.checks = [];
    state.reasons = {};
    state.flagEdited = {};
    ['reviewPanel'].forEach(hide);
    fillGrnDetails(set.extractedHeader || {});
    ['matchPanel', 'grnPanel', 'piPanel'].forEach(show);
    renderReceipt(); renderChecks({}); renderPiTotals();
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

/** ' - freight on 10 of its last 10 bills', for the freight ledger's hint. */
function freightShare(d) {
  var r = d && d.recentFreight;
  return r && r.bills ? ' - freight on ' + r.withFreight + ' of its last ' + r.bills + ' bills' : '';
}

async function loadDefaults() {
  try {
    var d = await api('/receiving/document-sets/' + state.setId + '/defaults');
    setDefault('receivedBy', 'receivedByHint', d.receivedBy);
    setDefault('defaultWarehouse', 'warehouseHint', d.warehouse);
    setDefault('purchaseLedgerId', 'purchaseLedgerHint', d.purchaseLedger);
    setDefault('freightLedgerId', 'freightLedgerHint', d.freightLedger);
    if ($('freightLedgerHint').textContent) $('freightLedgerHint').textContent += freightShare(d);
    (state.charges || []).forEach(function (c) { if (!num(c.ledgerId)) c.ledgerId = num($('freightLedgerId').value); });
    renderPiTotals();
    // Defaults that arrive after Match was pressed: INV018 must see the ledger.
    syncFreightLedger();
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
  ['supplierGstin', 'Supplier GSTIN'], ['buyerGstin', 'Buyer GSTIN'], ['shipToGstin', 'Ship-to GSTIN'],
  ['taxType', 'Tax type'], ['poNumbers', 'PO numbers (header)'],
  // Freight and round-off are edited in step 5, where they shape the purchase
  // invoice; these are the invoice's own printed figures, for the checks.
  ['subTotal', 'Sub total'], ['discount', 'Bill discount'], ['taxable', 'Taxable value'],
  ['cgst', 'CGST'], ['sgst', 'SGST'], ['igst', 'IGST'],
  ['grandTotal', 'Grand total'],
];

var LINE_FIELDS = [
  // GSM and size are what match a paper line to its PO line - shown so a
  // misreading can be corrected here.
  ['description', 'Description', false], ['gsm', 'GSM', true], ['size', 'Size', false], ['hsn', 'HSN', false],
  ['qty', 'Qty', true], ['uom', 'Unit', false],
  ['rate', 'Rate', true], ['amount', 'Amount', true],
  // A trade discount as printed: Sonafine's "Disc %" 20 takes 1,10,544 to
  // 88,435.20, and the purchase invoice posts the line net of it.
  ['discountPct', 'Disc %', true], ['discountAmount', 'Disc amt', true], ['taxableValue', 'After disc.', true],
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
  paintFlags();
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
        // The freight ledger filled in by default, so INV018 sees it.
        context: freightContext(),
        reason: 'Reviewed in GRN Creator before matching',
      },
    });
    await runMatch('reviewStatus');
    ['matchPanel', 'grnPanel', 'piPanel'].forEach(show);
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
  // Saving runs the checks again; a reason typed for a warning that still
  // fails must survive that, or it never reaches the post.
  var kept = {};
  state.checks.forEach(function (c) {
    if (!c.passed && c.severity === 'WARN' && state.reasons[c.code]) kept[c.code] = state.reasons[c.code];
  });
  state.reasons = kept;
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

/**
 * Kg per sheet for paper bought by the kg and stocked in sheets, as the server
 * works it out (receipt-units.js): WtPerPacking / UnitPerPacking. Else null.
 */
function kgPerSheetOf(line) {
  var pu = String(line.purchaseUnit || '').trim().toUpperCase();
  var su = String(line.stockUnit || '').trim().toUpperCase();
  if (pu !== 'KG' || !/^SHEETS?$/.test(su)) return null;
  var wt = num(line.wtPerPacking); var per = num(line.unitPerPacking);
  return wt > 0 && per > 0 ? wt / per : null;
}

/** The PO header a pending PO line sits on, so the server fetches that PO alone. */
function poTransactionIdFor(detailId) {
  var row = (state.poLines || []).filter(function (r) { return String(r.transactionDetailId) === String(detailId); })[0];
  return row ? row.transactionId : null;
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
    // Show the other unit at once, worked out as the server will; the save
    // and the checks follow without holding the screen up.
    var per = kgPerSheetOf(line);
    var other = field === 'stockQty' ? 'qty' : 'stockQty';
    var twin = lineInput('receiptTable', other, line.lineNo);
    if (twin && edit[field] !== null) {
      twin.value = text(!per ? edit[field]
        : field === 'stockQty' ? Math.round(edit[field] * per * 1000) / 1000 : Math.round(edit[field] / per));
    }
    setStatus('matchStatus', 'Saving line ' + line.lineNo + '...');
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

/** Up to the Pending POs grid, with the rows at this line's rate marked. */
function chooseFor(lineNo) {
  state.chooseLine = lineNo;
  renderPending();
  $('pendingView').scrollIntoView({ behavior: 'smooth', block: 'start' });
  setStatus('matchStatus', 'Tick line ' + lineNo + ' under Ref Supp inv item on the PO line it belongs to. '
    + 'Rows at its rate are marked green.', 'ok');
}

// -- the Pending POs tab ----------------------------------------------------

// The columns of the ERP's own GRN screen, in its order.
var PENDING_COLUMNS = [
  { key: 'poVoucherNo', label: 'P.O. No.' },
  { key: 'poDate', label: 'P.O. Date', value: function (r) { return displayDate(r.poDate); } },
  { key: 'itemCode', label: 'Item Code' },
  { key: 'subGroup', label: 'Sub Group' },
  { key: 'itemName', label: 'Item Name' },
  // The invoice items on this PO line - ticked by the matcher, changeable by anyone.
  { key: 'refInv', label: 'Ref Supp inv item', value: function (r) { return r.refInv || ''; } },
  { key: 'orderedQty', label: 'P.O. Qty (P.U.)', num: true, value: function (r) { return qtyText(r.orderedQty); } },
  { key: 'orderedStockQty', label: 'P.O. Qty (S.U.)', num: true, value: function (r) { return qtyText(r.orderedStockQty); } },
  { key: 'tolerancePct', label: 'Tol. (%)', num: true, value: function (r) { return qtyText(r.tolerancePct || 0); } },
  { key: 'pendingQty', label: 'Pending Qty (P.U.)', num: true, value: function (r) { return qtyText(r.pendingQty); } },
  { key: 'pendingStockQty', label: 'Pending Qty (S.U.)', num: true, value: function (r) { return qtyText(r.pendingStockQty); } },
  // The PO rate, per purchase unit - often the quickest way to tell two PO lines apart.
  { key: 'rate', label: 'Rate', num: true, value: function (r) { return money(r.rate); } },
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
  var byNo = {};
  lines.forEach(function (l) { byNo[l.lineNo] = l; });
  var rows = state.poLines.map(function (r) {
    var copy = Object.assign({}, r);
    var on = used[r.transactionDetailId] || [];
    copy.usedBy = on.length ? lineNoList(on) : '';
    copy.refInv = on.map(function (n) { return n + ' ' + text((byNo[n] || {}).description); }).join('; ');
    return copy;
  });

  var selected = state.chooseLine ? byNo[state.chooseLine] : null;
  var selectedRate = selected ? num(selected.rate) : null;
  var picking = state.entryMode !== 'manual';

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
    var note = (r.usedBy ? 'Invoice line ' + r.usedBy + ' is on it. ' : '') + (r.closed ? 'Closed PO. ' : '')
      + (picking ? 'Click to choose the invoice items on ' : 'Click to add ') + r.poVoucherNo + ' - ' + text(r.itemName);
    PENDING_COLUMNS.forEach(function (col) {
      var c = row.insertCell();
      if (col.num) c.className = 'num';
      if (col.key === 'refInv') {
        c.className = 'ref-cell';
        c.dataset.ref = r.transactionDetailId;
        var pick = el('button', 'ref-pick' + (r.refInv ? '' : ' empty'), r.refInv || (picking ? 'Choose...' : ''));
        pick.type = 'button';
        pick.title = r.refInv || 'Choose the invoice items on this PO line';
        pick.disabled = !picking;
        pick.addEventListener('click', function (e) { e.stopPropagation(); openRefPicker(r, pick); });
        c.appendChild(pick);
        return;
      }
      c.textContent = cellValue(col, r);
      // Rows stay one line high; the full text is a hover away.
      c.title = col.key === 'itemName' ? cellValue(col, r) + '\n' + note : note;
    });
    row.addEventListener('click', function () {
      if (!picking) { addLine(r.transactionDetailId); return; }
      var cell = row.querySelector('.ref-pick');
      if (cell) openRefPicker(r, cell);
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
  // A picker open on a row stays open while its ticks are saved.
  if (state.refPopRow) {
    var again = document.querySelector('#pendingTable td[data-ref="' + state.refPopRow + '"] .ref-pick');
    var poRow = state.poLines.filter(function (x) { return String(x.transactionDetailId) === String(state.refPopRow); })[0];
    if (again && poRow) openRefPicker(poRow, again); else closePop();
  }
}

// -- phones: rows become cards ----------------------------------------------

/** The width at which the stylesheet turns table rows into cards. */
var PHONE_QUERY = '(max-width: 720px)';
function isPhone() { return window.matchMedia(PHONE_QUERY).matches; }

/**
 * Tell every cell which column it belongs to. On a phone the stylesheet shows
 * each row as a card and prints this label above each value, so no render
 * function has to know about it: whatever a table's rows are built from, the
 * labels follow from its heading row.
 */
function labelCells(table) {
  var head = table.rows[0];
  if (!head) return;
  var labels = Array.prototype.map.call(head.cells, function (c) { return c.textContent.trim(); });
  Array.prototype.forEach.call(table.rows, function (row) {
    Array.prototype.forEach.call(row.cells, function (cell, i) {
      var label = cell.colSpan > 1 ? '' : (labels[i] || '');
      if (cell.dataset.label !== label) cell.dataset.label = label;
      if (cell.tagName === 'TD') {
        // The name of the thing: shown large and across the whole card.
        cell.classList.toggle('cell-title', /^(item name|description|supplier|tax ledger)$/i.test(label));
      }
    });
  });
}

/** Keep every table's labels current as its rows are rebuilt. */
function watchTables() {
  var tables = Array.prototype.slice.call(document.querySelectorAll('table.lines'));
  if (typeof MutationObserver !== 'undefined') {
    // The callback runs before the browser paints, so a rebuilt table never
    // shows a frame of unlabelled cards. Only the tables that changed are redone.
    var observer = new MutationObserver(function (records) {
      var changed = [];
      records.forEach(function (r) {
        var t = r.target.closest ? r.target.closest('table.lines') : null;
        if (t && changed.indexOf(t) === -1) changed.push(t);
      });
      changed.forEach(labelCells);
    });
    tables.forEach(function (t) { observer.observe(t, { childList: true, subtree: true }); });
  }
  tables.forEach(labelCells);
  // The search boxes are shut on a phone until asked for.
  Array.prototype.forEach.call(document.querySelectorAll('.filters-toggle'), function (btn) {
    btn.addEventListener('click', function () {
      var open = $(btn.dataset.target).classList.toggle('filters-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.textContent = open ? 'Hide filters' : 'Filters';
    });
  });
  // Turning the phone, or resizing: the scroll boxes size themselves again.
  var mq = window.matchMedia(PHONE_QUERY);
  var resize = function () {
    ['pendingWrap', 'regWrap'].forEach(function (id) { if ($(id)) $(id).style.maxHeight = ''; });
    sizePendingBox(); sizeRegisterBox();
  };
  if (mq.addEventListener) mq.addEventListener('change', resize); else if (mq.addListener) mq.addListener(resize);
}

// -- red flags ---------------------------------------------------------------

var FLAG_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">'
  + '<path d="M5 22V3h12.5l-2 4 2 4H7v11z" fill="currentColor"/></svg>';
/** Step 4's own inputs for header fields shown there. */
var FLAG_STEP4 = { invoiceNo: 'dnNo', invoiceDate: 'dnDate', eWayBillNo: 'eWayBillNo', gateEntryNo: 'gateEntryNo',
  gateEntryDate: 'gateEntryDate', vehicleNo: 'vehicleNo' };
/** Names for the fields step 2 does not show: they live on step 4's form. */
var FLAG_STEP4_LABELS = { eWayBillNo: 'E-way bill', gateEntryNo: 'Gate entry no.',
  gateEntryDate: 'Gate entry date', vehicleNo: 'Vehicle no.' };

/** What a flagged field is called, as the summary line names it. */
function flagLabel(field) {
  var m = /^lines\.(\d+)(?:\.(\w+))?$/.exec(field);
  if (!m) {
    var header = HEADER_FIELDS.filter(function (f) { return f[0] === field; })[0];
    return header ? header[1] : (FLAG_STEP4_LABELS[field] || field);
  }
  var line = m[2] && LINE_FIELDS.filter(function (f) { return f[0] === m[2]; })[0];
  return (line ? line[1] : 'Qty, rate and amount') + ' on line ' + m[1];
}

/** Open flags, less the ones a person has already changed on the page. */
function openFieldFlags() {
  var edited = state.flagEdited || {};
  return ((state.documentSet && state.documentSet.fieldFlags) || []).filter(function (f) {
    return !f.resolved && !edited[f.field];
  });
}

/** The one input a person can actually see, if any: hidden panels do not count. */
function visibleFlagTarget(field) {
  return flagTargets(field).filter(function (i) { return i.offsetParent !== null; })[0] || null;
}

/** Every input on the page that shows this field. */
function flagTargets(field) {
  var out = [];
  var push = function (node) { if (node) out.push(node); };
  var m = /^lines\.(\d+)(?:\.(\w+))?$/.exec(field);
  if (!m) {
    push($('hdr_' + field));
    if (FLAG_STEP4[field]) push($(FLAG_STEP4[field]));
    return out;
  }
  var lineNo = m[1];
  var f = m[2] || 'qty';
  var lines = (state.documentSet && state.documentSet.extractedLines) || [];
  var index = lines.findIndex(function (l) { return String(l.lineNo) === lineNo; });
  if (index >= 0) push($('line_' + index + '_' + f));
  if (f === 'qty') {
    push(lineInput('receiptTable', 'stockQty', lineNo));
    push(lineInput('receiptTable', 'qty', lineNo));
  }
  if (f === 'rate' || !m[2]) push(lineInput('piLinesTable', 'rate', lineNo));
  return out;
}

/** Put a red flag beside every flagged field on the page, and say how many there are. */
function paintFlags() {
  Array.prototype.forEach.call(document.querySelectorAll('.flag-btn'), function (b) { b.remove(); });
  Array.prototype.forEach.call(document.querySelectorAll('.flag-on'), function (i) { i.classList.remove('flag-on'); });
  var flags = openFieldFlags();
  flags.forEach(function (flag) {
    flagTargets(flag.field).forEach(function (input) {
      input.classList.add('flag-on');
      var host = input.parentElement;
      host.classList.add('flag-host');
      var btn = el('button', 'flag-btn');
      btn.type = 'button';
      btn.innerHTML = FLAG_SVG;
      btn.title = flag.reason;
      btn.setAttribute('aria-label', 'Red flag: ' + flag.reason);
      btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); openFlag(flag, btn); });
      host.appendChild(btn);
      // Changing the value is the other way to clear it; the server agrees on save.
      if (!input.dataset.flagWatch) {
        input.dataset.flagWatch = '1';
        input.addEventListener('input', function () {
          var still = openFieldFlags().filter(function (f) { return flagTargets(f.field).indexOf(input) !== -1; });
          if (!still.length) return;
          state.flagEdited = state.flagEdited || {};
          still.forEach(function (f) { state.flagEdited[f.field] = true; });
          paintFlags();
        });
      }
    });
  });
  // The count alone is a riddle when a flagged field sits on a step not yet on
  // screen; so name every one, and let the name itself open its flag.
  var n = flags.length;
  ['reviewFlags', 'postFlags'].forEach(function (id) {
    var box = $(id);
    box.innerHTML = '';
    box.classList.toggle('hidden', !n);
    if (!n) return;
    box.appendChild(document.createTextNode(n + ' field' + (n === 1 ? ' is' : 's are') + ' red-flagged: '));
    flags.forEach(function (flag, i) {
      var chip = el('button', 'flag-chip', flagLabel(flag.field));
      chip.type = 'button';
      chip.title = flag.reason;
      chip.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); gotoFlag(flag, chip); });
      box.appendChild(chip);
      if (i < n - 1) box.appendChild(document.createTextNode(', '));
    });
    box.appendChild(document.createTextNode('. Correct each one, or click its flag and mark it checked. '
      + 'The GRN cannot be posted until none is left.'));
  });
}

/** Go to a flagged field from the summary, and open its reason. */
function gotoFlag(flag, chip) {
  var input = visibleFlagTarget(flag.field);
  if (!input) { openFlag(flag, chip); return; }   // its step is not on screen yet
  input.scrollIntoView({ block: 'center' });
  try { input.focus({ preventScroll: true }); } catch (err) { input.focus(); }
  openFlag(flag, input.parentElement.querySelector('.flag-btn') || input);
}

function openFlag(flag, anchor) {
  var box = el('div');
  box.appendChild(el('div', 'pop-title flag-title', flag.source === 'MODEL' ? 'The reader was not sure of this' : 'A check found a problem'));
  box.appendChild(el('p', null, flag.reason));
  var ok = el('button', 'primary', 'Mark as checked');
  ok.type = 'button';
  ok.addEventListener('click', async function () {
    ok.disabled = true;
    try {
      var res = await api('/receiving/document-sets/' + state.setId + '/flags/confirm', { method: 'POST', body: { field: flag.field } });
      state.documentSet.fieldFlags = res.fieldFlags;
      closePop();
      paintFlags();
    } catch (err) {
      ok.disabled = false;
      box.appendChild(el('p', 'error', err.message));
    }
  });
  box.appendChild(ok);
  box.appendChild(el('p', 'hint', 'Or change the value: that clears it too.'));
  openPop(anchor, box);
}

// -- the floating panel -----------------------------------------------------

function closePop() {
  hide('pop');
  $('pop').innerHTML = '';
  state.refPopRow = null;
}

/** Show `content` in the floating panel, under `anchor`. */
function openPop(anchor, content) {
  var pop = $('pop');
  pop.innerHTML = '';
  pop.appendChild(content);
  show('pop');
  var r = anchor.getBoundingClientRect();
  var width = Math.min(420, window.innerWidth - 24);
  pop.style.width = width + 'px';
  pop.style.left = Math.max(12, Math.min(r.left + window.scrollX, window.scrollX + window.innerWidth - width - 12)) + 'px';
  pop.style.top = (r.bottom + window.scrollY + 6) + 'px';
}

/**
 * The invoice items on one PO line: every line the AI read, ticked where it
 * sits on this PO line. Ticking moves a line here; unticking leaves it on no
 * PO line, and "Match again" will not put it back.
 */
function openRefPicker(r, anchor) {
  state.refPopRow = r.transactionDetailId;
  var lines = (state.documentSet && state.documentSet.extractedLines) || [];
  var unit = text(r.purchaseUnit).trim();
  var box = el('div', 'picker');

  var head = el('div', 'picker-head');
  head.appendChild(el('div', 'picker-po', r.poVoucherNo));
  head.appendChild(el('div', 'picker-item', text(r.itemCode) + '  ' + text(r.itemName)));
  var chips = el('div', 'picker-chips');
  chips.appendChild(el('span', 'chip', 'Pending ' + qtyText(r.pendingQty) + (unit ? ' ' + unit : '')));
  chips.appendChild(el('span', 'chip', 'PO rate ' + money(r.rate)));
  head.appendChild(chips);
  box.appendChild(head);

  box.appendChild(el('div', 'picker-label', 'Invoice items on this PO line'));
  var list = el('div', 'ref-list');
  if (!lines.length) list.appendChild(el('p', 'hint', 'No invoice lines.'));
  var ticked = 0;
  lines.forEach(function (l) {
    var here = String(l.matchedPoTransactionDetailId) === String(r.transactionDetailId);
    if (here) ticked += 1;
    var item = el('label', 'ref-item' + (here ? ' on' : ''));
    var tick = el('input');
    tick.type = 'checkbox';
    tick.checked = here;
    tick.addEventListener('change', function () { placeFromGrid(l.lineNo, tick.checked ? r.transactionDetailId : null); });
    item.appendChild(tick);

    var body = el('span', 'ref-body');
    var top = el('span', 'ref-top');
    top.appendChild(el('span', 'ref-no', 'Line ' + l.lineNo));
    top.appendChild(el('span', 'ref-desc', text(l.description)));
    body.appendChild(top);
    var off = lineMoneyOf(l);
    var meta = el('span', 'ref-meta', qtyText(l.qty) + ' ' + text(l.uom) + '  @  ' + money(l.rate) + '  =  ' + money(l.amount)
      + (off.discount ? '  less ' + (off.pct ? pctText(off.pct) + '%' : money(off.discount)) + '  =  ' + money(off.net) : ''));
    if (num(l.rate) !== null && num(r.rate) !== null && Math.abs(num(l.rate) - num(r.rate)) <= 0.01) {
      meta.appendChild(el('span', 'chip chip-ok', 'PO rate'));
    }
    body.appendChild(meta);
    if (!here) {
      body.appendChild(el('span', 'ref-where' + (l.poVoucherNo ? ' moves' : ''),
        l.poVoucherNo ? 'Now on ' + l.poVoucherNo + ' - ticking moves it here' : 'On no PO line'));
    }
    item.appendChild(body);
    list.appendChild(item);
  });
  box.appendChild(list);

  var foot = el('div', 'picker-foot');
  foot.appendChild(el('span', 'hint', ticked ? ticked + ' ticked' : 'None ticked'));
  var done = el('button', 'primary picker-done', 'Done');
  done.type = 'button';
  done.addEventListener('click', closePop);
  foot.appendChild(done);
  box.appendChild(foot);
  openPop(anchor, box);
}

/** A tick or untick in the picker: put the line on this PO line, or on none. */
async function placeFromGrid(lineNo, detailId) {
  try {
    setStatus('matchStatus', detailId ? 'Placing line ' + lineNo + '...' : 'Taking line ' + lineNo + ' off...');
    var result = await api('/receiving/document-sets/' + state.setId + '/lines/' + lineNo + '/assign', {
      method: 'POST', body: detailId ? { poTransactionDetailId: detailId, poTransactionId: poTransactionIdFor(detailId) } : { unplace: true },
    });
    applyMatchResult(result);
    var line = (state.documentSet.extractedLines || []).filter(function (l) { return String(l.lineNo) === String(lineNo); })[0];
    setStatus('matchStatus', detailId
      ? 'Line ' + lineNo + ' is now on ' + (line && line.poVoucherNo) + '.'
      : 'Line ' + lineNo + ' is on no PO line now; "Match again" leaves it so.', 'ok');
  } catch (err) {
    setStatus('matchStatus', err.message, 'error');
  }
}

/**
 * Ten rows, then scroll - the head and its search boxes stay put. Measured,
 * not guessed, so it holds whatever the row height turns out to be.
 */
function sizePendingBox() {
  var wrap = $('pendingWrap');
  var table = $('pendingTable');
  if (!wrap || wrap.offsetParent === null) return;   // hidden: sized when shown
  if (isPhone()) { wrap.style.maxHeight = '65vh'; return; }   // cards: a screenful, then scroll
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
      method: 'POST', body: { poTransactionDetailId: detailId, poTransactionId: poTransactionIdFor(detailId) },
    });
    applyMatchResult(result);
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
      method: 'POST', body: { poTransactionDetailId: detailId, poTransactionId: poTransactionIdFor(detailId) },
    });
    applyMatchResult(result);
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
    setStatus('matchStatus', 'Line ' + lineNo + ' removed.', 'ok');
  } catch (err) {
    setStatus('matchStatus', err.message, 'error');
  }
}

// -- checks -----------------------------------------------------------------

/**
 * Blocks that cannot be ignored, and what to do instead. The server's list
 * (services/check-overrides.js) is the one that counts; this only keeps an
 * Ignore button off a check the server would refuse to ignore.
 */
var CHECK_NOT_IGNORABLE = {
  INV001: 'Cannot be ignored: posting again would receive the goods twice. Edit or delete the existing GRN from History.',
  INV013: 'Cannot be ignored: the invoice is not billed to CDC. If the buyer GSTIN was misread, correct it in the header.',
  INV002: 'Cannot be ignored: the GRN would be posted without this line. Put it on a PO line, or remove it.',
  INV018: 'Cannot be ignored: choose the freight ledger under Additional charges.',
};

/** A blocking check a person ignored, with a reason - stamped by the server. */
function isIgnored(c) {
  return !c.passed && c.severity === 'BLOCK' && Boolean(c.overrideReason);
}

/**
 * The checks, in a section that folds away. Only the failures are listed;
 * the count in its heading stays visible when it is folded, coloured by the
 * worst result, so a blocking failure cannot hide.
 */
function renderChecks(result) {
  var host = $('checksList');
  host.innerHTML = '';

  var failed = state.checks.filter(function (c) { return !c.passed; });
  var ignored = failed.filter(isIgnored);
  var blocking = failed.filter(function (c) { return c.severity === 'BLOCK' && !isIgnored(c); });
  var summary = $('checksSummary');
  var counts = [];
  if (blocking.length) counts.push(blocking.length + ' blocking');
  if (ignored.length) counts.push(ignored.length + ' ignored');
  summary.textContent = !state.checks.length ? 'none yet'
    : failed.length
      ? failed.length + ' of ' + state.checks.length + ' failed' + (counts.length ? ' - ' + counts.join(', ') : '')
      : 'all ' + state.checks.length + ' passed';
  summary.className = 'checks-count ' + (blocking.length ? 'bad' : failed.length ? 'warn' : state.checks.length ? 'ok' : '');

  // Folded while everything passes, open as soon as something fails. Only a
  // change of outcome moves it, so a box someone opened or closed stays so.
  var outcome = !state.checks.length ? 'none' : failed.length ? 'failed' : 'passed';
  if (outcome !== state.checksOutcome) {
    state.checksOutcome = outcome;
    $('checksBox').open = outcome === 'failed';
  }

  // Only what failed - a passing check needs nothing from anyone.
  if (state.checks.length && !failed.length) {
    host.appendChild(el('p', 'muted', 'All ' + state.checks.length + ' checks passed.'));
  }
  failed.forEach(function (c) {
    var kind = isIgnored(c) ? 'check-ignored'
      : (c.severity === 'BLOCK' ? 'check-block' : 'check-warn');
    var box = el('div', 'check ' + kind);

    var line = el('div');
    line.appendChild(el('code', null, c.code + (c.lineNo ? ' - line ' + c.lineNo : '')));
    line.appendChild(document.createTextNode(c.message));
    line.appendChild(el('span', 'check-sev', isIgnored(c) ? 'ignored'
      : c.severity === 'BLOCK' ? 'blocks posting' : 'needs a reason'));
    box.appendChild(line);

    // A warning posts only with a typed reason, stored on the voucher.
    if (c.severity === 'WARN') {
      var label = el('label', 'reason', 'Reason (required)');
      var input = el('input');
      input.placeholder = 'Why is this acceptable?';
      // Kept across a re-render, as after ignoring or un-ignoring a block.
      input.value = state.reasons[c.code] || '';
      input.addEventListener('input', function () { state.reasons[c.code] = input.value; });
      label.appendChild(input);
      box.appendChild(label);
    }
    // A block posts only once someone ignores it, with a reason the server
    // stores against their name. Undo puts it back.
    if (c.severity === 'BLOCK') renderIgnore(box, c);
    host.appendChild(box);
  });

  setStatus('matchStatus', result && result.isBlocked
    ? 'Blocking checks failed - Save to ERP is refused until they are resolved or ignored.'
    : '', result && result.isBlocked ? 'warn' : null);
}

/**
 * Under a failing block: who ignored it and why, with Undo - or an Ignore
 * button that opens a reason box. Nothing is ignored until the server has
 * stored the reason.
 */
function renderIgnore(box, c) {
  if (isIgnored(c)) {
    var by = el('div', 'ignored-by');
    by.appendChild(el('strong', null, 'Ignored by ' + (c.overriddenByName || c.overriddenBy || 'someone') + ': '));
    by.appendChild(document.createTextNode(c.overrideReason));
    var undo = el('button', 'link', 'Undo');
    undo.type = 'button';
    undo.addEventListener('click', function () { unignoreCheck(c, undo); });
    by.appendChild(undo);
    box.appendChild(by);
    return;
  }
  if (CHECK_NOT_IGNORABLE[c.code]) {
    box.appendChild(el('div', 'hint ignore-hint', CHECK_NOT_IGNORABLE[c.code]));
    return;
  }

  var open = el('button', 'link', 'Ignore');
  open.type = 'button';
  var form = el('div', 'ignore-form hidden');
  var label = el('label', 'reason', 'Reason (required)');
  var input = el('input');
  input.placeholder = 'Why can this be ignored?';
  label.appendChild(input);
  form.appendChild(label);
  var actions = el('div', 'ignore-actions');
  var ok = el('button', null, 'Ignore this check');
  ok.type = 'button';
  var cancel = el('button', 'link', 'Cancel');
  cancel.type = 'button';
  var note = el('span', 'status');
  actions.appendChild(ok);
  actions.appendChild(cancel);
  actions.appendChild(note);
  form.appendChild(actions);

  open.addEventListener('click', function () {
    form.classList.remove('hidden');
    open.classList.add('hidden');
    input.focus();
  });
  cancel.addEventListener('click', function () {
    form.classList.add('hidden');
    open.classList.remove('hidden');
    input.value = '';
    note.textContent = '';
  });
  var confirmIgnore = function () {
    if (!input.value.trim()) {
      note.textContent = 'Give the reason first.';
      note.className = 'status error';
      input.focus();
      return;
    }
    ignoreCheck(c, input.value.trim(), ok, note);
  };
  ok.addEventListener('click', confirmIgnore);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); confirmIgnore(); } });

  box.appendChild(open);
  box.appendChild(form);
}

/** The checks as the server now has them, after an ignore or an undo. */
function applyCheckResult(result) {
  state.documentSet = result.documentSet;
  state.checks = result.checks || [];
  // Whatever preview was on screen was built under the old checks.
  renderChecks(result);
}

async function ignoreCheck(c, reason, button, note) {
  button.disabled = true;
  try {
    var result = await api('/receiving/document-sets/' + state.setId + '/checks/ignore', {
      method: 'POST', body: { code: c.code, lineNo: c.lineNo === undefined ? null : c.lineNo, reason: reason },
    });
    applyCheckResult(result);
  } catch (err) {
    button.disabled = false;
    note.textContent = err.message;
    note.className = 'status error';
  }
}

async function unignoreCheck(c, button) {
  button.disabled = true;
  try {
    var result = await api('/receiving/document-sets/' + state.setId + '/checks/unignore', {
      method: 'POST', body: { code: c.code, lineNo: c.lineNo === undefined ? null : c.lineNo },
    });
    applyCheckResult(result);
  } catch (err) {
    button.disabled = false;
    setStatus('matchStatus', err.message, 'error');
  }
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
  // The purchase invoice: Bill No. / Date default to the D.N.; the freight on
  // an invoice read by AI becomes a row under Additional charges.
  $('billNo').value = text(header.billNo || header.invoiceNo);
  $('billDate').value = localDateInput(header.billDate || header.invoiceDate);
  $('dnoteNo').value = text(header.invoiceNo);
  $('piRemark').value = text(header.remark);
  state.billNoDirty = Boolean(header.billNo && header.billNo !== header.invoiceNo);
  var saved = state.documentSet && state.documentSet.context && state.documentSet.context.freightCharges;
  state.charges = saved && saved.length
    ? saved.map(function (f) { return { ledgerId: f.ledgerId, amount: f.amount }; })
    : (num(header.freight) > 0 ? [{ ledgerId: num($('freightLedgerId').value), amount: num(header.freight) }] : []);
  state.roundOffDirty = header.roundOff !== null && header.roundOff !== undefined && header.roundOff !== '';
  $('roundOffAmount').value = state.roundOffDirty ? text(header.roundOff) : '';
  paintFlags();
}

function grnHeader() {
  var v = function (id) { var raw = $(id).value.trim(); return raw === '' ? null : raw; };
  var out = {
    eWayBillNo: v('eWayBillNo'),
    gateEntryNo: v('gateEntryNo'),
    gateEntryDate: v('gateEntryDate'),
    vehicleNo: v('vehicleNo'),
    freight: round2((state.charges || []).reduce(function (s, c) { return s + (num(c.amount) || 0); }, 0)),
    roundOff: num($('roundOffAmount').value),
    billNo: v('billNo'),
    billDate: v('billDate'),
    remark: $('piRemark').value.trim(),
  };
  if (state.entryMode === 'manual') {
    out.invoiceNo = v('dnNo');
    out.invoiceDate = v('dnDate');
  }
  return out;
}

/** What the post needs that the invoice does not say. Never CreatedBy. */
function postContext() {
  var out = freightContext();
  out.employeeLedgerId = num($('receivedBy').value);
  out.warehouseId = num($('defaultWarehouse').value);
  out.purchaseLedgerId = num($('purchaseLedgerId').value);
  return out;
}

/** The freight rows under Additional charges, as the draft stores them. */
function freightContext() {
  var rows = (state.charges || []).filter(function (c) { return num(c.amount) > 0; });
  return {
    // The first freight row's ledger is the one check INV018 looks at.
    freightLedgerId: num((rows[0] || {}).ledgerId) || null,
    freightCharges: rows.map(function (c) { return { ledgerId: num(c.ledgerId), amount: num(c.amount) }; }),
  };
}

/**
 * INV018 is worked out from the freight ledger stored with the draft, which
 * the page used to send only on Preview - so a ledger filled in by default,
 * or chosen in step 5, still showed as missing. When the freight ledger on
 * the page is not the stored one, store it and run the checks again.
 */
async function syncFreightLedger() {
  var stored = (state.documentSet && state.documentSet.context) || {};
  var now = freightContext();
  // Before the first match there are no checks to refresh; Match stores it.
  if (!state.setId || !(state.checks || []).length) return;
  if ((num(stored.freightLedgerId) || null) === now.freightLedgerId) return;
  try {
    await api('/receiving/document-sets/' + state.setId, {
      method: 'PATCH', body: { context: now, reason: 'Freight ledger' },
    });
    await runMatch('piStatus');
  } catch (err) {
    setStatus('piStatus', err.message, 'error');
  }
}

/**
 * The purchase invoice screen, laid out as the ERP's own: the lines grid, the
 * Additional charges table, and the totals. One renderer for both places it
 * appears - step 5 of a new GRN (ids as written), and History's "Make purchase
 * invoice" for a GRN posted without one (the same ids with a "gp" prefix).
 * The figures are worked out the way the writer does: freight shared over the
 * lines by value, GST on each line's share at its HSN rate, the round-off to
 * the nearest rupee unless someone types one.
 */

var GST_STATES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};

function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function pctText(v) { var n = num(v); return n === null ? '' : n.toFixed(2); }
// The grid's amounts as the ERP's grid shows them: plain, two places, no commas.
function amt(v) { var n = num(v); return n === null ? '' : n.toFixed(2); }

/** GST and round off: the screen adds these rows itself, from the lines. */
function isAutoCharge(r) {
  return /^(CGST|SGST|IGST|ROUND_OFF)$/.test(r.kind || '')
    || /^\s*(CGST|SGST|IGST)\s*$|round\s*off/i.test(r.LedgerName || '');
}

/** The charges a person may add: freight, packing & forwarding, commission, other charges. */
function freightLedgers() {
  return (state.reference.chargeLedgers || []).filter(function (r) { return !isAutoCharge(r); });
}

/**
 * The Additional Charges list as the ERP shows it: every charge ledger, in its
 * order. GST and round off are listed but cannot be chosen - their rows fill
 * themselves, and adding one by hand would count the tax twice.
 */
function fillChargeSelect(id, selected) {
  var select = $(id);
  select.innerHTML = '';
  var blank = el('option', null, 'Choose a charge...');
  blank.value = '';
  select.appendChild(blank);
  (state.reference.chargeLedgers || []).forEach(function (r) {
    var auto = isAutoCharge(r);
    var option = el('option', null, r.LedgerName + (auto ? ' (added automatically)' : ''));
    option.value = r.LedgerID;
    option.disabled = auto;
    if (!auto && selected !== null && selected !== undefined && String(selected) === String(r.LedgerID)) option.selected = true;
    select.appendChild(option);
  });
}

/**
 * A line's trade discount, as the server's lineMoney works it out: the
 * discount amount where one is given, else the percentage of qty x rate, else
 * the gap to a printed value after discount.
 */
function lineMoneyOf(l) {
  var q = piQtyOf(l); var r = num(l.rate);
  var gross = q !== null && r !== null ? round2(q * r) : (num(l.amount) || 0);
  var pct = num(l.discountPct) || null;
  var given = num(l.discountAmount) || null;
  var after = num(l.taxableValue);
  var discount = given !== null ? given
    : (pct !== null ? round2(gross * pct / 100) : (after !== null && after < gross ? round2(gross - after) : 0));
  return { gross: gross, pct: pct, discount: discount, net: round2(gross - discount) };
}

/**
 * Per-line and total figures, as the writer will write them. A discounted
 * line is posted as CDC always has: at the rate after discount, with Gross =
 * Basic = its value after discount and no discount on the ERP's line. The
 * printed rate and discount ride along for the note. `billDiscount` is a
 * discount on the whole bill, spread over the lines on their value after
 * their own discounts - the last line takes the remainder.
 */
function computePi(lines, charges, roundOff, billDiscount) {
  var money = lines.map(lineMoneyOf);
  var netTotal = money.reduce(function (s, m) { return s + m.net; }, 0);
  var bill = round2(num(billDiscount) || 0);
  var spread = 0;
  money.forEach(function (m, i) {
    if (!bill || !(netTotal > 0)) return;
    var share = i === money.length - 1 ? round2(bill - spread) : round2(bill * m.net / netTotal);
    spread = round2(spread + share);
    m.discount = round2(m.discount + share);
    m.net = round2(m.gross - m.discount);
    m.pct = null;
  });
  var basics = money.map(function (m) { return m.net; });
  var basic = round2(basics.reduce(function (s, b) { return s + b; }, 0));
  var freight = round2((charges || []).reduce(function (s, c) { return s + (num(c.amount) || 0); }, 0));
  var shared = 0;
  var rows = lines.map(function (l, i) {
    var share = i === lines.length - 1 ? round2(freight - shared) : round2(basic > 0 ? freight * basics[i] / basic : 0);
    shared = round2(shared + share);
    var taxable = round2(basics[i] + share);
    var c = round2(taxable * (num(l.cgstPercentage) || 0) / 100);
    var s = round2(taxable * (num(l.sgstPercentage) || 0) / 100);
    var g = round2(taxable * (num(l.igstPercentage) || 0) / 100);
    var q = piQtyOf(l);
    return { printedRate: num(l.rate), printedGross: money[i].gross, pct: money[i].pct, discount: money[i].discount,
      // The posted rate, and the landed rate with it: after discount.
      rate: money[i].discount && q > 0 ? round2(basics[i] / q) : num(l.rate),
      basic: basics[i], share: share, taxable: taxable, cgst: c, sgst: s, igst: g, total: round2(taxable + c + s + g) };
  });
  var sum = function (k) { return round2(rows.reduce(function (t, r) { return t + r[k]; }, 0)); };
  var cgst = sum('cgst'); var sgst = sum('sgst'); var igst = sum('igst');
  var net = round2(basic + freight + cgst + sgst + igst);
  var autoRoundOff = round2(Math.round(net) - net);
  var ro = roundOff === null || roundOff === undefined ? autoRoundOff : round2(roundOff);
  return { rows: rows, basic: basic, freight: freight, cgst: cgst, sgst: sgst, igst: igst,
    tax: round2(cgst + sgst + igst), net: net, autoRoundOff: autoRoundOff, roundOff: ro, gross: round2(net + ro) };
}

/**
 * Paper bought by the kg and stocked in sheets. Only these lines bill their
 * own quantity on the purchase invoice - the kg on the supplier's bill - while
 * the GRN keeps the kg its sheets work out to. Everywhere else the ERP's PI
 * quantity is the GRN's (3,270 of 3,270 lines, July to October 2026).
 */
function billsByKg(l) {
  var pu = String(l.purchaseUnit || '').trim().toUpperCase();
  var su = String(l.stockUnit || '').trim().toUpperCase();
  return pu === 'KG' && (su === 'SHEET' || su === 'SHEETS');
}

/** What the purchase invoice bills: the billed kg where there is one. */
function piQtyOf(l) {
  return billsByKg(l) && num(l.billedKg) !== null ? num(l.billedKg) : num(l.qty);
}

/** Billed kg further than this from the GRN's kg is red-flagged: sheets and kg agree within 1%. */
var BILLED_KG_PCT = 0.01;

function billedKgOff(l) {
  var billed = num(l.billedKg);
  var grn = num(l.qty);
  if (!billsByKg(l) || billed === null || !(grn > 0)) return null;
  var pct = Math.abs(billed - grn) / grn;
  if (pct <= BILLED_KG_PCT + 1e-9) return null;
  return 'Line ' + l.lineNo + ' bills ' + qtyText(billed) + ' kg; the GRN has ' + qtyText(grn) + ' kg'
    + (num(l.stockQty) !== null ? ' (' + qtyText(l.stockQty) + ' sheets)' : '')
    + ' - ' + Math.round(pct * 1000) / 10 + '% apart; the limit is 1%.';
}

/**
 * The GST percentages as the ERP's screen shows them and its table stores
 * them: all three from the HSN rate (18 -> 9 / 9 / 18), whichever tax applies.
 * The amounts beside them are worked out from the split that applies.
 */
function shownPct(l, kind) {
  var gst = num(l.gstPercentage);
  if (gst === null) return pctText(l[kind + 'Percentage']);
  return pctText(kind === 'igst' ? gst : gst / 2);
}

/** Over-receipt beyond this share of what is pending blocks a GRN (INV003). */
var RECEIPT_OVER_PCT = 0.10;

/**
 * Lines that receive more than 10% over what was pending on their PO line,
 * as {index: message}. Lines on the same PO line are judged together, as
 * INV003 judges them.
 */
function overReceipts(lines) {
  var byPo = {};
  lines.forEach(function (l, i) {
    var key = l.matchedPoTransactionDetailId || l.poTransactionDetailId;
    if (!key || num(l.poPendingQty) === null || l.matchedPoClosed) return;
    var g = byPo[key] = byPo[key] || { qty: 0, pending: num(l.poPendingQty), po: l.poVoucherNo, idx: [] };
    g.qty += num(l.qty) || 0;
    g.idx.push(i);
  });
  var out = {};
  Object.keys(byPo).forEach(function (k) {
    var g = byPo[k];
    var qty = Math.round(g.qty * 1000) / 1000;
    if (!(qty > g.pending * (1 + RECEIPT_OVER_PCT) + 0.0005)) return;
    var nos = g.idx.map(function (i) { return lines[i].lineNo; });
    var how = g.pending > 0 ? Math.round((qty - g.pending) / g.pending * 1000) / 10 + '% over; the limit is 10%' : 'nothing was pending';
    var msg = (nos.length > 1 ? 'Lines ' + lineNoList(nos) + ' together receive ' : 'Line ' + nos[0] + ' receives ')
      + qtyText(qty) + ' against ' + qtyText(g.pending) + ' pending on ' + text(g.po) + ' - ' + how + '.';
    g.idx.forEach(function (i) { out[i] = msg; });
  });
  return out;
}

var PI_GRID = [
  ['P.O. No.', function (l) { return text(l.poVoucherNo); }],
  ['P.O. Date', function (l) { return displayDate(l.poDate); }],
  ['Item Code', function (l) { return text(l.itemCode); }],
  ['Item Name', function (l) { return text(l.itemName || l.description); }],
  ['Purchase Qty', function (l) { return qtyText(l.poQty); }, 'num'],
  ['Stock Unit', function (l) { return text(l.stockUnit); }],
  ['Receipt Qty', function (l) { return qtyText(piQtyOf(l)); }, 'num'],
  ['Rate', null, 'num'],
  ['Purchase Unit', function (l) { return text(l.purchaseUnit || l.uom); }],
  ['Basic Amt', function (l, c) { return amt(c.basic); }, 'num'],
  ['Width', function (l) { return qtyText(l.widthMm); }, 'num'],
  ['GST %', function (l) { return pctText(l.gstPercentage); }, 'num'],
  ['CGST %', function (l) { return shownPct(l, 'cgst'); }, 'num'],
  ['SGST %', function (l) { return shownPct(l, 'sgst'); }, 'num'],
  ['IGST %', function (l) { return shownPct(l, 'igst'); }, 'num'],
  ['CGST Amt', function (l, c) { return amt(c.cgst); }, 'num'],
  ['SGST Amt', function (l, c) { return amt(c.sgst); }, 'num'],
  ['IGST Amt', function (l, c) { return amt(c.igst); }, 'num'],
  ['Total Amt', function (l, c) { return amt(c.total); }, 'num'],
  ['Narration', function (l) { return text(l.itemName || l.description); }],
  ['F-Year', function (l) { return text(l.poFYear); }],
  ['Group Name', function (l) { return text(l.itemGroupName); }],
  ['HSN Code', function (l) { return text(l.expectedHsn || l.hsn); }],
  ['Landed Price', function (l, c) { return amt(c.rate); }, 'num'],
];

/**
 * Draw the screen. `m` is the model: {lines, charges, roundOffDirty,
 * supplierName, supplierGstin, onRate(line, value), onChange(), printedTotal,
 * billDiscount}, and optionally onBilled(line, kg) and onQty(line, qty) - the
 * Receipt Qty is typed into only where they are given.
 * Returns the figures.
 */
function renderPiScreen(p, m) {
  var id = function (name) { return $(p + name); };
  id('piVoucherDate').value = displayDate(new Date());
  id('piSupplier').value = text(m.supplierName);
  var code = String(m.supplierGstin || '').trim().slice(0, 2);
  id('piState').textContent = GST_STATES[code] ? 'State : ' + GST_STATES[code] : '';

  var typed = m.roundOffDirty ? num(id('roundOffAmount').value) : null;
  var c = computePi(m.lines, m.charges, typed, m.billDiscount);
  if (!m.roundOffDirty) id('roundOffAmount').value = c.roundOff.toFixed(2);

  var over = overReceipts(m.lines);

  // the lines
  var table = id('piLinesTable');
  table.innerHTML = '';
  var head = table.insertRow();
  PI_GRID.forEach(function (col) { head.appendChild(el('th', col[2] || null, col[0])); });
  if (!m.lines.length) {
    var empty = table.insertRow().insertCell();
    empty.colSpan = PI_GRID.length;
    empty.className = 'empty';
    empty.textContent = 'No lines on a PO yet.';
  }
  m.lines.forEach(function (line, i) {
    var row = table.insertRow();
    PI_GRID.forEach(function (col) {
      var cell = row.insertCell();
      if (col[2]) cell.className = col[2];
      if (col[0] === 'Rate') {
        // As INV005 judges it: the rate after any discount against the PO's.
        var figs = c.rows[i];
        var paid = figs.rate;
        var off = num(line.matchedPoRate) !== null && paid !== null
          && Math.abs(paid - num(line.matchedPoRate)) > 0.01;
        if (figs.discount) {
          // Posted at the rate after discount; the printed rate and discount
          // are a note. They are corrected in step 2, where they were read.
          cell.textContent = amt(paid);
          var printed = figs.printedRate + (figs.pct ? ' less ' + pctText(figs.pct) + '%' : ' less ' + money(figs.discount));
          cell.appendChild(el('small', 'cell-note', printed));
          cell.title = 'Printed ' + money(figs.printedRate) + ' x qty = ' + money(figs.printedGross) + ', less discount '
            + money(figs.discount) + ': posted at ' + money(paid) + '. PO rate ' + money(line.matchedPoRate) + '.';
          if (off) cell.classList.add('needs');
          return;
        }
        var input = el('input', 'cell-input' + (off ? ' needs' : ''));
        // 'any': a supplier's 17.925 a sheet must go in as billed.
        input.type = 'number'; input.min = '0'; input.step = 'any';
        input.value = text(line.rate);
        input.title = off ? 'Not the PO rate of ' + money(line.matchedPoRate) : 'PO rate ' + money(line.matchedPoRate);
        input.dataset.field = 'rate';
        input.dataset.line = line.lineNo;
        input.setAttribute('aria-label', 'Rate, line ' + line.lineNo);
        input.addEventListener('change', function () { m.onRate(line, num(input.value)); });
        cell.appendChild(input);
        return;
      }
      if (col[0] === 'Receipt Qty') {
        var why = [over[i], billedKgOff(line)].filter(Boolean);
        if (billsByKg(line) && m.onBilled) {
          // The kg on the supplier's bill. The GRN keeps its own kg and sheets.
          var kg = el('input', 'cell-input');
          kg.type = 'number'; kg.min = '0'; kg.step = 'any';
          kg.value = text(piQtyOf(line));
          kg.dataset.field = 'billedKg';
          kg.dataset.line = line.lineNo;
          kg.setAttribute('aria-label', 'Billed kg, line ' + line.lineNo);
          kg.title = why.length ? why.join('\n') : 'The kg on the bill. The GRN keeps ' + qtyText(line.qty) + ' kg'
            + (num(line.stockQty) !== null ? ' and ' + qtyText(line.stockQty) + ' sheets.' : '.');
          if (why.length) kg.classList.add('flag-on');
          kg.addEventListener('change', function () {
            var v = num(kg.value);
            // Blank, or the GRN's own kg: nothing separate to bill.
            m.onBilled(line, v === null || Math.abs(v - (num(line.qty) || 0)) < 0.0005 ? null : v);
          });
          cell.appendChild(kg);
        } else if (m.onQty) {
          // Any other line bills what the GRN receives, so this is the GRN's
          // quantity too: step 4 follows, in both its units.
          var q = el('input', 'cell-input' + (!(num(line.qty) > 0) ? ' needs' : ''));
          q.type = 'number'; q.min = '0'; q.step = 'any';
          q.value = text(line.qty);
          q.dataset.field = 'qty';
          q.dataset.line = line.lineNo;
          q.setAttribute('aria-label', 'Receipt qty, line ' + line.lineNo);
          q.title = why.length ? why.join('\n') : 'Receipt qty in ' + text(line.purchaseUnit || line.uom) + ' - the GRN receives the same.';
          if (why.length) q.classList.add('flag-on');
          q.addEventListener('change', function () { m.onQty(line, num(q.value)); });
          cell.appendChild(q);
        } else {
          var shown = col[1](line, c.rows[i]);
          cell.textContent = shown;
          cell.title = shown;
        }
        if (why.length) {
          cell.classList.add('over-receipt', 'flag-host');
          cell.title = why.join('\n');
          var flag = el('span', 'over-flag');
          flag.innerHTML = FLAG_SVG;
          flag.title = why.join('\n');
          flag.setAttribute('role', 'img');
          flag.setAttribute('aria-label', 'Red flag: ' + why.join(' '));
          cell.appendChild(flag);
        }
        return;
      }
      var v = col[1](line, c.rows[i]);
      cell.textContent = v;
      cell.title = v;
    });
  });

  // Additional charges: the GST rows fill themselves; freight rows are added.
  var ct = id('chargesTable');
  ct.innerHTML = '';
  var ch = ct.insertRow();
  ['Tax Ledger', 'Tax %', 'Calcu. ON', 'GST Applic.', 'In Amount', 'Amount', ''].forEach(function (h, k) {
    ch.appendChild(el('th', k === 1 || k === 5 ? 'num' : null, h));
  });
  var tick = function (on) { var b = el('input'); b.type = 'checkbox'; b.checked = on; b.disabled = true; return b; };
  [['CGST', c.cgst], ['SGST', c.sgst], ['IGST', c.igst]].forEach(function (t) {
    if (!(t[1] > 0)) return;
    var r = ct.insertRow();
    r.insertCell().textContent = t[0];
    var pc = r.insertCell(); pc.className = 'num'; pc.textContent = '0';
    r.insertCell().textContent = 'Value';
    r.insertCell().appendChild(tick(true));
    r.insertCell().appendChild(tick(false));
    var a = r.insertCell(); a.className = 'num'; a.textContent = money(t[1]);
    r.insertCell();
  });
  (m.charges || []).forEach(function (f, k) {
    var r = ct.insertRow();
    var lc = r.insertCell();
    var sel = el('select', 'cell-select');
    var none = el('option', null, 'Choose...'); none.value = ''; sel.appendChild(none);
    freightLedgers().forEach(function (L) {
      var o = el('option', null, L.LedgerName); o.value = L.LedgerID;
      if (String(L.LedgerID) === String(f.ledgerId)) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { f.ledgerId = num(sel.value); m.onChange(); });
    lc.appendChild(sel);
    var ledger = freightLedgers().filter(function (L) { return String(L.LedgerID) === String(f.ledgerId); })[0];
    var pc = r.insertCell(); pc.className = 'num';
    // The ledger's own Tax %, as the ERP writes it: 18 on Inward Freight, 0 on the rest.
    pc.textContent = ledger ? String(num(ledger.TaxPercentage) || 0) : '';
    r.insertCell().textContent = 'Value';
    r.insertCell().appendChild(tick(true));
    r.insertCell().appendChild(tick(true));
    var ac = r.insertCell(); ac.className = 'num';
    var amt = el('input', 'cell-input' + (num(f.amount) > 0 ? '' : ' needs'));
    amt.type = 'number'; amt.min = '0'; amt.step = '0.01';
    amt.value = text(f.amount);
    amt.dataset.charge = k;
    amt.setAttribute('aria-label', 'Freight amount');
    amt.addEventListener('change', function () { f.amount = num(amt.value); m.onChange(); });
    ac.appendChild(amt);
    var dc = r.insertCell();
    var del = el('button', 'link danger-link', 'Delete'); del.type = 'button';
    del.addEventListener('click', function () { m.charges.splice(k, 1); m.onChange(); });
    dc.appendChild(del);
  });
  if (ct.rows.length === 1) {
    var e2 = ct.insertRow().insertCell();
    e2.colSpan = 7; e2.className = 'empty'; e2.textContent = 'No tax or charges yet.';
  }

  id('piBasic').value = money(c.basic);
  id('piTotalTax').value = money(c.tax);
  id('piGross').value = money(c.gross);

  var notes = [];
  var overMsgs = Object.keys(over).map(function (k) { return over[k]; })
    .filter(function (msg, k, all) { return all.indexOf(msg) === k; });
  var noRate = m.lines.filter(function (l) { return l.gstPercentage === null || l.gstPercentage === undefined; })
    .map(function (l) { return l.lineNo; });
  if (noRate.length) notes.push('No GST rate for line ' + lineNoList(noRate) + ": the supplier's state is not known, so the tax could not be split.");
  if (m.printedTotal !== null && m.printedTotal !== undefined && m.lines.length) {
    var diff = round2(c.gross - m.printedTotal);
    notes.push(Math.abs(diff) < 0.01
      ? 'Agrees with the invoice total of ₹' + money(m.printedTotal) + '.'
      : 'The invoice total is ₹' + money(m.printedTotal) + '; this comes to ₹' + money(c.gross)
        + ' (' + (diff > 0 ? '+' : '') + money(diff) + ').');
  }
  var noteBox = id('piNote');
  noteBox.textContent = '';
  overMsgs.forEach(function (msg) { noteBox.appendChild(el('div', 'over-note', 'Over-receipt: ' + msg)); });
  m.lines.forEach(function (l) {
    var off = billedKgOff(l);
    if (off) noteBox.appendChild(el('div', 'over-note', 'Billed kg: ' + off));
  });
  if (notes.length) noteBox.appendChild(document.createTextNode(notes.join(' ')));
  return c;
}

/** Add the charge chosen in the Additional Charges list as a freight row. */
function addCharge(p, charges, onChange) {
  var ledgerId = num($(p + 'freightLedgerId').value);
  if (!ledgerId) return;
  charges.push({ ledgerId: ledgerId, amount: null });
  onChange();
  var inputs = $(p + 'chargesTable').querySelectorAll('input[data-charge]');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

// Step 5 of a new GRN.

function supplierGstinFor(ledgerId) {
  var s = supplierById(ledgerId);
  return s ? (s.GSTNo || s.GSTIN || '') : '';
}

function newGrnPiModel() {
  var set = state.documentSet || {};
  var h = set.extractedHeader || {};
  var supplierId = set.context && set.context.supplierLedgerId;
  var sup = supplierById(supplierId);
  return {
    lines: (set.extractedLines || []).filter(function (l) { return l.matchedPoTransactionId && !l.matchedPoClosed; }),
    charges: state.charges,
    roundOffDirty: state.roundOffDirty,
    supplierName: sup ? sup.LedgerName : '',
    supplierGstin: h.supplierGstin || supplierGstinFor(supplierId),
    printedTotal: state.entryMode === 'ai' ? num(h.grandTotal) : null,
    billDiscount: num(h.discount),
    onRate: function (line, v) { editLine(line.lineNo, { rate: v }, 'piStatus'); },
    onBilled: function (line, v) { editLine(line.lineNo, { billedKg: v }, 'piStatus'); },
    onQty: function (line, v) {
      if (v === null) { renderPiTotals(); return; }
      setStatus('piStatus', 'Saving line ' + line.lineNo + '...');
      editLine(line.lineNo, { qty: v }, 'piStatus');
    },
    onChange: function () { renderPiTotals(); syncFreightLedger(); },
  };
}

function renderPiTotals() {
  state.charges = state.charges || [];
  var figures = renderPiScreen('', newGrnPiModel());
  paintFlags();
  return figures;
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
  if ((state.charges || []).some(function (c) { return num(c.amount) > 0 && !num(c.ledgerId); })) missing.push('a ledger on every freight row');
  if ((state.charges || []).some(function (c) { return num(c.ledgerId) && !(num(c.amount) > 0); })) missing.push('the amount on every freight row');
  if (!$('billNo').value.trim()) missing.push('bill no.');
  return missing;
}

/** A new invoice gets the button back, whatever the last one did. */
function resetSaveButton() {
  $('saveErpBtn').disabled = false;
  $('saveErpBtn').textContent = 'Save to ERP';
}

/**
 * Save steps 4 and 5, refresh the checks against them, build the vouchers
 * without writing them - so anything the server would refuse is refused
 * before anyone is asked - then, on one confirmation, write them to the ERP.
 */
async function saveToErp() {
  var missing = missingForPost();
  if (missing.length) {
    setStatus('piStatus', 'Still needed: ' + missing.join(', ') + '.', 'error');
    return;
  }
  var flagged = openFieldFlags().length;
  if (flagged) {
    setStatus('piStatus', flagged + ' field' + (flagged === 1 ? ' is' : 's are') + ' still red-flagged. Correct each one, '
      + 'or click its flag and mark it checked, then save.', 'error');
    return;
  }
  $('saveErpBtn').disabled = true;
  var posted = false;
  try {
    setStatus('piStatus', 'Saving the GRN details...');
    await api('/receiving/document-sets/' + state.setId, {
      method: 'PATCH',
      body: { extractedHeader: grnHeader(), context: postContext(), reason: 'GRN details and ledgers' },
    });
    // Gate entry or e-way bill can change what the checks say.
    await runMatch('piStatus');
    var unexplained = state.checks.filter(function (c) {
      return !c.passed && c.severity === 'WARN' && !String(state.reasons[c.code] || '').trim();
    });
    if (unexplained.length) {
      $('checksBox').open = true;
      setStatus('piStatus', 'Type a reason under ' + unexplained.map(function (c) { return c.code; }).join(', ')
        + ' in Checks, then save. Nothing has been written.', 'error');
      return;
    }

    setStatus('piStatus', 'Checking the vouchers before writing them...');
    var dry = await api('/receiving/document-sets/' + state.setId + '/post?dryRun=true', {
      method: 'POST', body: { context: postContext(), dryRun: true },
    });
    state.erpWritesEnabled = Boolean(dry.erpWritesEnabled);
    if (!state.erpWritesEnabled) {
      show('writeBadge');
      setStatus('piStatus', 'Saving to the ERP is off on this server (SP_ENABLE_ERP_WRITES is not true, or no write '
        + 'login is configured). Nothing has been written.', 'error');
      return;
    }
    hide('writeBadge');
    // An FYear that is not "2026-2027" would number the vouchers from 1.
    if (!/^\d{4}-\d{4}$/.test(dry.fYear || '')) {
      setStatus('piStatus', 'The financial year came out as "' + (dry.fYear || '') + '", so the voucher numbers would be '
        + 'wrong. Nothing has been written.', 'error');
      return;
    }

    var pi = dry.pi || {};
    var totals = pi.totals || {};
    var closing = (dry.closedLines || []).length;
    var ok = window.confirm('Save to ' + state.context.site + ' ERP?\n\n'
      + 'Supplier invoice ' + text(pi.invoiceNo) + '\n'
      + 'GRN: ' + ((dry.grn && dry.grn.lines) || []).length + ' line(s)\n'
      + 'Purchase invoice: basic ' + money(totals.totalBasicAmount) + ', tax ' + money(totals.totalTaxAmount)
      + (num(totals.freight) ? ', freight ' + money(totals.freight) : '') + ', net ' + money(totals.netAmount) + '\n'
      + (closing ? closing + ' PO line(s) will close.\n' : '')
      + '\nThis writes a real GRN and purchase invoice and cannot be undone from here.');
    if (!ok) { setStatus('piStatus', 'Not saved.', null); return; }

    setStatus('piStatus', 'Saving to the ERP...');
    var overrides = Object.keys(state.reasons).map(function (code) {
      return { code: code, reason: state.reasons[code] };
    });
    var result = await api('/receiving/document-sets/' + state.setId + '/post', {
      method: 'POST', body: { context: postContext(), overrides: overrides },
    });
    posted = true;
    $('saveErpBtn').textContent = 'Saved to ERP';
    setStatus('piStatus',
      'Saved. GRN ' + result.grn.voucherNo + ', purchase invoice ' + result.pi.voucherNo + '.', 'ok');
    await loadHistory();
  } catch (err) {
    var detail = err.payload && err.payload.checks
      ? ' (' + err.payload.checks.map(function (c) { return c.code + (c.lineNo ? ' line ' + c.lineNo : ''); }).join(', ') + ')'
      : '';
    setStatus('piStatus', err.message + detail, 'error');
  } finally {
    // Once written, the button stays off: a second click would only be refused as already posted.
    $('saveErpBtn').disabled = posted;
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
    $('draftsCount').textContent = list.length ? String(list.length) : '';
  } catch (err) {
    /* History is a convenience; a failure here must not block receiving. */
  }
  await refreshDraftButton();
}

// -- History: the GRN register ---------------------------------------------

/** New GRN or History, the two tabs at the top. */
function setApp(view) {
  Array.prototype.forEach.call(document.querySelectorAll('#appTabs .tab'), function (tab) {
    tab.classList.toggle('active', tab.dataset.app === view);
  });
  $('newView').classList.toggle('hidden', view !== 'new');
  $('historyView').classList.toggle('hidden', view !== 'history');
  if (view === 'history' && !state.register) {
    var to = new Date();
    var from = new Date(to.getTime() - 7 * 86400000);
    $('regTo').value = localDateInput(to);
    $('regFrom').value = localDateInput(from);
    loadRegister();
  }
}

function supplierIdFrom(value) {
  var m = /\[(\d+)\]\s*$/.exec(value || '');
  return m ? m[1] : '';
}

// Each column says what it shows as text: the same text its search box matches.
var REGISTER_COLUMNS = [
  { key: 'voucherNo', label: 'GRN No.', cls: 'c-grn' },
  { key: 'voucherDate', label: 'Date', cls: 'c-date', value: function (g) { return displayDate(g.voucherDate); } },
  { key: 'supplierName', label: 'Supplier', cls: 'c-sup' },
  { key: 'deliveryNoteNo', label: 'D.N. No.', cls: 'c-dn' },
  { key: 'deliveryNoteDate', label: 'D.N. Date', cls: 'c-date', value: function (g) { return displayDate(g.deliveryNoteDate); } },
  { key: 'lines', label: 'Lines', cls: 'c-n num' },
  { key: 'stockQty', label: 'Qty (S.U.)', cls: 'c-q num', value: function (g) { return qtyText(g.stockQty) + (g.stockUnit ? ' ' + g.stockUnit : ''); } },
  { key: 'issued', label: 'Issued', cls: 'c-iss', options: ['None', 'Part', 'Full'], value: function (g) { return g.issued === 'none' ? 'None' : g.issued === 'full' ? 'Full' : 'Part'; } },
  { key: 'piVoucherNo', label: 'Purchase invoice', cls: 'c-pi', value: function (g) {
    return g.piVoucherNo ? g.piVoucherNo + (g.purchaseInvoices > 1 ? ' +' + (g.purchaseInvoices - 1) : '') : 'Not made';
  } },
  { key: 'madeIn', label: 'Made in', cls: 'c-made', options: ['ERP', 'GRN Creator'] },
  { key: 'createdByName', label: 'Created by', cls: 'c-by' },
  { key: 'actions', label: '', cls: 'c-act', noFilter: true },
];

function registerValue(col, g) {
  return col.value ? col.value(g) : text(g[col.key]);
}

async function loadRegister() {
  var params = ['from=' + encodeURIComponent($('regFrom').value), 'to=' + encodeURIComponent($('regTo').value)];
  var supplier = supplierIdFrom($('regSupplier').value);
  if ($('regSupplier').value.trim() && !supplier) {
    setStatus('registerStatus', 'Choose a supplier from the list, or clear the box for all.', 'error');
    return;
  }
  if (supplier) params.push('supplierLedgerId=' + supplier);
  if ($('regSearch').value.trim()) params.push('q=' + encodeURIComponent($('regSearch').value.trim()));
  setStatus('registerStatus', 'Loading...');
  $('regLoad').disabled = true;
  try {
    state.register = await api('/receiving/grns?' + params.join('&'));
    renderRegister();
    setStatus('registerStatus', '', null);
  } catch (err) {
    setStatus('registerStatus', err.message, 'error');
  } finally {
    $('regLoad').disabled = false;
  }
}

function renderRegister() {
  var reg = state.register || { grns: [] };
  var table = $('registerTable');
  state.regFilters = state.regFilters || {};

  // The head, with a search box under every heading, is built once, so
  // typing in one does not lose the cursor.
  if (!table.tHead) {
    var thead = table.createTHead();
    var labels = thead.insertRow();
    var filters = thead.insertRow();
    filters.className = 'filter-row';
    REGISTER_COLUMNS.forEach(function (col) {
      labels.appendChild(el('th', col.cls, col.label));
      var th = el('th');
      if (col.options) {
        // A few fixed values: a list to pick from, not a box to type in.
        var pick = el('select', 'filter');
        pick.setAttribute('aria-label', 'Filter ' + col.label);
        var any = el('option', null, 'All'); any.value = ''; pick.appendChild(any);
        col.options.forEach(function (v) { var o = el('option', null, v); o.value = v; pick.appendChild(o); });
        pick.value = state.regFilters[col.key] || '';
        pick.addEventListener('change', function () {
          state.regFilters[col.key] = pick.value;
          renderRegister();
        });
        th.appendChild(pick);
      } else if (!col.noFilter) {
        var input = el('input', 'filter');
        input.placeholder = 'Search';
        input.setAttribute('aria-label', 'Search ' + col.label);
        input.value = state.regFilters[col.key] || '';
        input.addEventListener('input', function () {
          state.regFilters[col.key] = input.value;
          renderRegister();
        });
        th.appendChild(input);
      }
      filters.appendChild(th);
    });
  }

  var body = table.tBodies[0] || table.createTBody();
  body.innerHTML = '';

  var grns = reg.grns || [];
  var shown = grns.filter(function (g) {
    return REGISTER_COLUMNS.every(function (col) {
      var f = (state.regFilters[col.key] || '').trim().toLowerCase();
      if (!f) return true;
      var v = registerValue(col, g).toLowerCase();
      return col.options ? v === f : v.indexOf(f) !== -1;
    });
  });
  var issued = shown.filter(function (g) { return g.issued !== 'none'; }).length;
  var noPi = shown.filter(function (g) { return !g.piVoucherNo; }).length;
  $('regSummary').textContent = grns.length
    ? (shown.length === grns.length ? '' : shown.length + ' of ')
      + grns.length + ' GRN' + (grns.length === 1 ? '' : 's') + (reg.truncated ? ' (the newest 500 - narrow the dates for the rest)' : '')
      + ' - ' + issued + ' issued from, ' + noPi + ' without a purchase invoice.'
    : '';

  if (!shown.length) {
    var c = body.insertRow().insertCell();
    c.colSpan = REGISTER_COLUMNS.length;
    c.className = 'empty';
    c.textContent = grns.length ? 'No GRN matches the search.' : 'No GRNs in this range.';
    sizeRegisterBox();
    return;
  }

  shown.forEach(function (g) {
    var row = body.insertRow();
    REGISTER_COLUMNS.forEach(function (col) {
      var cell = row.insertCell();
      if (/\bnum\b/.test(col.cls)) cell.className = 'num';
      var shownText = col.noFilter ? '' : registerValue(col, g);
      if (col.key === 'issued') {
        var tag = el('span', 'badge state-' + g.issued, shownText);
        if (g.issued !== 'none') tag.title = qtyText(g.issuedQty) + ' issued from ' + g.linesIssued + ' line(s), on ' + g.issues + ' issue(s)';
        cell.appendChild(tag);
      } else if (col.key === 'piVoucherNo' && !g.piVoucherNo) {
        var make = el('button', 'badge state-nopi badge-btn', shownText);
        make.type = 'button';
        make.title = 'Make the purchase invoice for ' + g.voucherNo;
        make.addEventListener('click', function () { openGrnPi(g.transactionId); });
        cell.appendChild(make);
      } else if (col.key === 'actions') {
        cell.className = 'row-actions';
        var open = el('button', 'link', reg.canEdit ? 'Edit' : 'View');
        open.type = 'button';
        open.addEventListener('click', function () { openGrn(g.transactionId); });
        cell.appendChild(open);
        if (reg.canEdit) {
          var del = el('button', 'link danger-link', 'Delete');
          del.type = 'button';
          var why = g.piVoucherNo ? 'Purchase invoice ' + g.piVoucherNo + ' is made from it. Delete that in the ERP first.'
            : g.issued !== 'none' ? 'Stock has been issued from it. Delete those issue lines first.' : '';
          if (why) { del.disabled = true; del.title = why; }
          del.addEventListener('click', function () { removeGrn(g.transactionId, g.voucherNo); });
          cell.appendChild(del);
        }
      } else {
        cell.textContent = shownText;
        cell.title = shownText;
      }
    });
  });
  sizeRegisterBox();
}

/** Fifteen rows, then the register scrolls inside its box. */
function sizeRegisterBox() {
  var wrap = $('regWrap');
  var table = $('registerTable');
  if (!wrap || wrap.offsetParent === null) return;
  if (isPhone()) { wrap.style.maxHeight = '70vh'; return; }
  var height = table.tHead ? table.tHead.offsetHeight : 0;
  var rows = table.tBodies[0] ? table.tBodies[0].rows : [];
  for (var i = 0; i < Math.min(15, rows.length); i++) height += rows[i].offsetHeight;
  wrap.style.maxHeight = (height + 2) + 'px';
}

// -- History: one GRN, edited or deleted ------------------------------------

/** kg per sheet for paper bought by the kilo; null otherwise. Mirrors the server. */
function kgPerSheet(line) {
  var pu = String(line.purchaseUnit || '').trim().toUpperCase();
  var su = String(line.stockUnit || '').trim().toUpperCase();
  if (pu !== 'KG' || (su !== 'SHEET' && su !== 'SHEETS')) return null;
  var wt = num(line.wtPerPacking); var per = num(line.unitPerPacking);
  return wt > 0 && per > 0 ? wt / per : null;
}

async function openGrn(transactionId) {
  setStatus('grnEditStatus', 'Opening...');
  show('grnEditPanel');
  hide('grnEditPlan');
  $('geSaveBtn').disabled = true;
  try {
    state.grn = await api('/receiving/grns/' + transactionId);
    renderGrnEdit();
    setStatus('grnEditStatus', '', null);
    $('grnEditPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    setStatus('grnEditStatus', err.message, 'error');
  }
}

function renderGrnEdit() {
  var g = state.grn;
  var editable = g.canEdit;
  $('grnEditTitle').textContent = g.voucherNo + ' - ' + text(g.supplierName);

  var notes = [];
  notes.push('Made in ' + g.madeIn + ', ' + displayDate(g.voucherDate) + '.');
  if (g.purchaseInvoices.length) {
    notes.push('Purchase invoice ' + g.purchaseInvoices.map(function (p) { return p.voucherNo; }).join(', ')
      + ' is made from it, so its quantities stay as they are until that is deleted in the ERP. The header can still change.');
  }
  if (!g.writesEnabled) notes.push('ERP writes are off: Check changes shows exactly what would change, and nothing is saved.');
  $('grnEditNote').textContent = notes.join(' ');

  var h = g.header;
  $('geDnNo').value = text(h.deliveryNoteNo);
  $('geDnDate').value = localDateInput(h.deliveryNoteDate);
  $('geGateNo').value = text(h.gateEntryNo);
  $('geGateDate').value = localDateInput(h.gateEntryDate);
  $('geVehicle').value = text(h.vehicleNo);
  $('geEway').value = text(h.eWayBillNo);
  fillSelect('geReceivedBy', state.reference.employees, 'LedgerID',
    function (r) { return r.LedgerName + (r.Designation ? ' - ' + r.Designation : ''); }, h.receivedBy, 'Choose...');
  // Whoever received it may have left since: keep them on the list for this GRN.
  if (h.receivedBy && String($('geReceivedBy').value) !== String(h.receivedBy)) {
    var gone = el('option', null, (h.receivedByName || 'Ledger ' + h.receivedBy) + ' (not on the employee list)');
    gone.value = h.receivedBy;
    gone.selected = true;
    $('geReceivedBy').appendChild(gone);
  }
  ['geDnNo', 'geDnDate', 'geGateNo', 'geGateDate', 'geVehicle', 'geEway', 'geReceivedBy'].forEach(function (id) {
    $(id).disabled = !editable;
  });

  var table = $('grnEditLines');
  table.innerHTML = '';
  var head = table.insertRow();
  ['#', 'P.O. No.', 'Item Code', 'Item Name', 'Receipt Qty (S.U.)', 'Receipt Qty (P.U.)', 'Stock Unit', 'Issued', 'Warehouse', 'Remove']
    .forEach(function (label, i) { head.appendChild(el('th', i === 4 || i === 5 || i === 7 ? 'num' : null, label)); });

  g.lines.forEach(function (l) {
    var row = table.insertRow();
    row.dataset.id = l.transactionDetailId;
    row.insertCell().textContent = text(l.lineNo);
    row.insertCell().textContent = text(l.poVoucherNo);
    row.insertCell().textContent = text(l.itemCode);
    var name = row.insertCell(); name.className = 'wrap'; name.textContent = text(l.itemName);

    var su = row.insertCell(); su.className = 'num';
    var input = el('input', 'cell-input');
    input.type = 'number'; input.min = String(l.minStockQty || 0); input.step = 'any';
    input.value = text(l.stockQty);
    input.dataset.field = 'stockQty';
    input.disabled = !editable || Boolean(l.qtyLocked);
    input.title = l.qtyLocked || (l.minStockQty > 0 ? 'At least ' + qtyText(l.minStockQty) + ' - that much has been issued.' : 'Receipt qty in ' + text(l.stockUnit));
    su.appendChild(input);

    var pu = row.insertCell(); pu.className = 'num'; pu.textContent = qtyText(l.qty) + (l.purchaseUnit ? ' ' + l.purchaseUnit : '');
    input.addEventListener('input', function () {
      var per = kgPerSheet(l);
      var s = num(input.value);
      pu.textContent = s === null ? '' : qtyText(per ? Math.round(s * per * 1000) / 1000 : s) + (l.purchaseUnit ? ' ' + l.purchaseUnit : '');
      hide('grnEditPlan'); $('geSaveBtn').disabled = true;
    });

    row.insertCell().textContent = text(l.stockUnit);
    var iss = row.insertCell(); iss.className = 'num';
    iss.textContent = l.issuedQty ? qtyText(l.issuedQty) : '-';
    if (l.issues.length) iss.title = l.issues.map(function (i) { return i.issueNo + ' (' + qtyText(i.qty) + ')'; }).join(', ');

    var wh = row.insertCell();
    var select = el('select', 'cell-select');
    select.dataset.field = 'warehouseId';
    (state.reference.warehouses || []).forEach(function (w) {
      var o = el('option', null, warehouseLabel(w));
      o.value = w.WarehouseID;
      if (String(w.WarehouseID) === String(l.warehouseId)) o.selected = true;
      select.appendChild(o);
    });
    select.disabled = !editable || Boolean(l.warehouseLocked);
    if (l.warehouseLocked) select.title = l.warehouseLocked;
    wh.appendChild(select);

    var rm = row.insertCell();
    var box = el('input');
    box.type = 'checkbox';
    box.dataset.field = 'remove';
    box.disabled = !editable || Boolean(l.removeLocked);
    box.title = l.removeLocked || 'Take this line off the GRN';
    box.setAttribute('aria-label', 'Remove line ' + l.lineNo);
    rm.appendChild(box);
    [select, box].forEach(function (c) { c.addEventListener('change', function () { hide('grnEditPlan'); $('geSaveBtn').disabled = true; }); });
  });

  $('geCheckBtn').classList.toggle('hidden', !editable);
  $('geSaveBtn').classList.toggle('hidden', !editable);
  $('geDeleteBtn').classList.toggle('hidden', !editable);
  // Anyone who may post a GRN may make its purchase invoice.
  $('geMakePiBtn').classList.toggle('hidden', g.purchaseInvoices.length > 0);
  $('geDeleteBtn').disabled = Boolean(g.deleteLocked);
  $('geDeleteBtn').title = g.deleteLocked || '';
}

/** What the person changed, against the GRN as it was opened. */
function collectGrnEdit() {
  var g = state.grn;
  var header = {
    deliveryNoteNo: $('geDnNo').value, deliveryNoteDate: $('geDnDate').value || null,
    gateEntryNo: $('geGateNo').value, gateEntryDate: $('geGateDate').value || null,
    vehicleNo: $('geVehicle').value, eWayBillNo: $('geEway').value,
  };
  // Only a change of who received it is sent: an unchanged one may be a
  // person no longer on the active list.
  var receivedBy = num($('geReceivedBy').value);
  if (receivedBy && receivedBy !== num(g.header.receivedBy)) header.receivedBy = receivedBy;
  var lines = [];
  Array.prototype.forEach.call($('grnEditLines').rows, function (row) {
    if (!row.dataset.id) return;
    var l = g.lines.filter(function (x) { return String(x.transactionDetailId) === row.dataset.id; })[0];
    var change = { transactionDetailId: l.transactionDetailId };
    var remove = row.querySelector('[data-field="remove"]');
    if (remove.checked) { change.remove = true; lines.push(change); return; }
    var q = num(row.querySelector('[data-field="stockQty"]').value);
    if (q !== null && Math.abs(q - (num(l.stockQty) || 0)) > 1e-9) change.stockQty = q;
    var w = num(row.querySelector('[data-field="warehouseId"]').value);
    if (w !== null && w !== num(l.warehouseId)) change.warehouseId = w;
    if (Object.keys(change).length > 1) lines.push(change);
  });
  return { header: header, lines: lines, expectedModifiedDate: g.modifiedDate };
}

var FIELD_LABEL = {
  deliveryNoteNo: 'D.N. no.', deliveryNoteDate: 'D.N. date', gateEntryNo: 'Gate entry no.', gateEntryDate: 'Gate entry date',
  eWayBillNo: 'E-way bill', eWayBillDate: 'E-way bill date', vehicleNo: 'Vehicle no.', receivedBy: 'Received by',
  stockQty: 'Receipt qty (S.U.)', qty: 'Receipt qty (P.U.)', warehouseId: 'Warehouse',
};

function shownValue(field, v) {
  if (v === null || v === undefined || v === '') return '(blank)';
  if (field === 'warehouseId') return warehouseName(v) || String(v);
  if (field === 'receivedBy') {
    var e = (state.reference.employees || []).filter(function (r) { return String(r.LedgerID) === String(v); })[0];
    return e ? e.LedgerName : String(v);
  }
  if (/Date$/.test(field)) return displayDate(v);
  if (field === 'stockQty' || field === 'qty') return qtyText(v);
  return String(v);
}

function renderPlan(result) {
  var host = $('grnEditPlan');
  host.innerHTML = '';
  var plan = result.plan;
  var list = el('ul');
  plan.header.forEach(function (h) {
    list.appendChild(el('li', null, FIELD_LABEL[h.field] + ': ' + shownValue(h.field, h.before) + ' -> ' + shownValue(h.field, h.after)));
  });
  plan.lines.forEach(function (l) {
    l.changes.forEach(function (c) {
      list.appendChild(el('li', null, 'Line ' + l.lineNo + ', ' + FIELD_LABEL[c.field] + ': '
        + shownValue(c.field, c.before) + ' -> ' + shownValue(c.field, c.after)));
    });
  });
  plan.removals.forEach(function (r) { list.appendChild(el('li', null, 'Line ' + r.lineNo + ' comes off the GRN.')); });
  host.appendChild(el('b', null, result.dryRun ? 'This would change on ' + result.voucherNo + ':' : 'Changed on ' + result.voucherNo + ':'));
  host.appendChild(list);
  (result.notes || []).forEach(function (n) { host.appendChild(el('p', 'warn-note', n)); });
  show('grnEditPlan');
}

async function checkGrnEdit() {
  var edit = collectGrnEdit();
  $('geSaveBtn').disabled = true;
  setStatus('grnEditStatus', 'Checking...');
  try {
    var result = await api('/receiving/grns/' + state.grn.transactionId + '/edit?dryRun=true', { method: 'POST', body: edit });
    renderPlan(result);
    state.pendingEdit = edit;
    $('geSaveBtn').disabled = !result.writesEnabled;
    setStatus('grnEditStatus', result.writesEnabled
      ? 'Check the list, then Save to ERP.'
      : 'ERP writes are off, so this is as far as it goes: nothing has been saved.', result.writesEnabled ? 'ok' : 'warn');
  } catch (err) {
    hide('grnEditPlan');
    setStatus('grnEditStatus', err.message, 'error');
  }
}

async function saveGrnEdit() {
  if (!state.pendingEdit) return;
  if (!window.confirm('Save these changes to ' + state.grn.voucherNo + ' in the ERP?')) return;
  $('geSaveBtn').disabled = true;
  setStatus('grnEditStatus', 'Saving...');
  try {
    var result = await api('/receiving/grns/' + state.grn.transactionId + '/edit', { method: 'POST', body: state.pendingEdit });
    state.pendingEdit = null;
    await openGrn(state.grn.transactionId);
    renderPlan(result);
    setStatus('grnEditStatus', result.voucherNo + ' saved.', 'ok');
    loadRegister();
  } catch (err) {
    setStatus('grnEditStatus', err.message, 'error');
  }
}

/** Delete a GRN: the server checks first (dry run), then asks, then deletes. */
async function removeGrn(transactionId, voucherNo) {
  var status = state.grn && state.grn.transactionId === transactionId ? 'grnEditStatus' : 'registerStatus';
  setStatus(status, 'Checking whether ' + voucherNo + ' can be deleted...');
  try {
    var dry = await api('/receiving/grns/' + transactionId + '/delete?dryRun=true', { method: 'POST', body: {} });
    var warn = (dry.notes || []).length ? '\n\n' + dry.notes.join('\n') : '';
    if (!dry.writesEnabled) {
      setStatus(status, voucherNo + ' could be deleted (' + dry.lines + ' line' + (dry.lines === 1 ? '' : 's')
        + '), but ERP writes are off, so nothing has been deleted.' + (warn ? ' ' + dry.notes.join(' ') : ''), 'warn');
      return;
    }
    if (!window.confirm('Delete ' + voucherNo + ' and its ' + dry.lines + ' line(s) in the ERP?' + warn)) {
      setStatus(status, '', null);
      return;
    }
    var expected = state.grn && state.grn.transactionId === transactionId ? state.grn.modifiedDate : undefined;
    await api('/receiving/grns/' + transactionId + '/delete', { method: 'POST', body: { expectedModifiedDate: expected } });
    if (state.grn && state.grn.transactionId === transactionId) { hide('grnEditPanel'); state.grn = null; }
    setStatus('registerStatus', voucherNo + ' deleted.', 'ok');
    loadRegister();
  } catch (err) {
    setStatus(status, err.message, 'error');
  }
}

// -- History: a purchase invoice for a GRN posted without one --------------

function gpModel() {
  var d = state.gp.draft;
  return {
    lines: d.lines.map(function (l) {
      var r = state.gp.rates[l.transactionDetailId];
      var kg = state.gp.billed[l.transactionDetailId];
      return Object.assign({}, l, { rate: r !== undefined ? r : l.rate, billedKg: kg !== undefined ? kg : null });
    }),
    charges: state.gp.charges,
    roundOffDirty: state.gp.roundOffDirty,
    supplierName: d.supplierName,
    supplierGstin: supplierGstinFor(d.supplierLedgerId),
    printedTotal: null,
    onRate: function (line, v) { state.gp.rates[line.transactionDetailId] = v; gpChanged(); },
    onBilled: function (line, v) { state.gp.billed[line.transactionDetailId] = v; gpChanged(); },
    onChange: gpChanged,
  };
}

function gpChanged() {
  $('gpSaveBtn').disabled = true;
  $('gppiVoucherNo').value = '';
  renderPiScreen('gp', gpModel());
}

async function openGrnPi(transactionId) {
  show('grnPiPanel');
  setStatus('gpStatus', 'Opening...');
  $('gpSaveBtn').disabled = true;
  try {
    var d = await api('/receiving/grns/' + transactionId + '/purchase-invoice');
    // Freight rows are the person's to add: the ledger is pre-chosen, the row is not.
    state.gp = { draft: d, rates: {}, billed: {}, charges: [], roundOffDirty: false };
    $('grnPiTitle').textContent = 'Purchase invoice for ' + d.voucherNo;
    $('grnPiNote').textContent = 'The lines are ' + d.voucherNo + "'s own, at their PO rates; change a rate if the bill differs."
      + (d.writesEnabled ? '' : ' ERP writes are off: Check shows what would be written, and nothing is saved.');
    var pl = d.defaults && d.defaults.purchaseLedger;
    var fl = d.defaults && d.defaults.freightLedger;
    fillSelect('gppurchaseLedgerId', state.reference.purchaseLedgers, 'LedgerID', function (r) { return r.LedgerName; },
      pl ? pl.ledgerId : null, 'Choose...');
    $('gppurchaseLedgerHint').textContent = pl ? 'From ' + pl.source : '';
    fillChargeSelect('gpfreightLedgerId', fl ? fl.ledgerId : null);
    $('gpfreightLedgerHint').textContent = fl ? 'From ' + fl.source + freightShare(d.defaults) : '';
    $('gpbillNo').value = text(d.deliveryNoteNo);
    $('gpbillDate').value = localDateInput(d.deliveryNoteDate);
    $('gpdnoteNo').value = text(d.deliveryNoteNo);
    $('gppiRemark').value = '';
    $('gproundOffAmount').value = '';
    gpChanged();
    setStatus('gpStatus', '', null);
    $('grnPiPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    setStatus('gpStatus', err.message, 'error');
  }
}

function gpBody() {
  var charges = state.gp.charges.filter(function (c) { return num(c.amount) > 0; });
  return {
    purchaseLedgerId: num($('gppurchaseLedgerId').value),
    billNo: $('gpbillNo').value.trim(),
    billDate: $('gpbillDate').value || null,
    remark: $('gppiRemark').value.trim(),
    roundOff: num($('gproundOffAmount').value),
    freightCharges: charges.map(function (c) { return { ledgerId: num(c.ledgerId), amount: num(c.amount) }; }),
    rates: state.gp.rates,
    billedKg: state.gp.billed,
  };
}

function gpMissing() {
  var missing = [];
  if (!$('gppurchaseLedgerId').value) missing.push('purchase ledger');
  if (!$('gpbillNo').value.trim()) missing.push('bill no.');
  if (state.gp.charges.some(function (c) { return num(c.amount) > 0 && !num(c.ledgerId); })) missing.push('a ledger on every freight row');
  if (state.gp.charges.some(function (c) { return num(c.ledgerId) && !(num(c.amount) > 0); })) missing.push('the amount on every freight row');
  return missing;
}

async function checkGrnPi() {
  var missing = gpMissing();
  if (missing.length) { setStatus('gpStatus', 'Still needed: ' + missing.join(', ') + '.', 'error'); return; }
  setStatus('gpStatus', 'Checking...');
  try {
    var r = await api('/receiving/grns/' + state.gp.draft.transactionId + '/purchase-invoice?dryRun=true', { method: 'POST', body: gpBody() });
    $('gppiVoucherNo').value = r.pi.voucherNo;
    var shown = computePi(gpModel().lines, state.gp.charges, num($('gproundOffAmount').value));
    var agree = Math.abs(r.totals.netAmount - shown.gross) < 0.01;
    $('gpSaveBtn').disabled = !r.writesEnabled;
    setStatus('gpStatus', (agree ? 'The server agrees: ₹' + money(r.totals.netAmount) + '. '
      : 'The server makes it ₹' + money(r.totals.netAmount) + ', not ₹' + money(shown.gross) + '. ')
      + (r.writesEnabled ? 'Save to ERP to make it.' : 'ERP writes are off, so nothing has been saved.'),
      agree && r.writesEnabled ? 'ok' : 'warn');
  } catch (err) {
    setStatus('gpStatus', err.message, 'error');
  }
}

async function saveGrnPi() {
  if (!window.confirm('Make the purchase invoice for ' + state.gp.draft.voucherNo + ' in the ERP?')) return;
  $('gpSaveBtn').disabled = true;
  setStatus('gpStatus', 'Saving...');
  try {
    var r = await api('/receiving/grns/' + state.gp.draft.transactionId + '/purchase-invoice', { method: 'POST', body: gpBody() });
    setStatus('registerStatus', 'Purchase invoice ' + r.pi.voucherNo + ' made for ' + state.gp.draft.voucherNo + '.', 'ok');
    hide('grnPiPanel');
    if (state.grn && state.grn.transactionId === state.gp.draft.transactionId) openGrn(state.grn.transactionId);
    state.gp = null;
    loadRegister();
  } catch (err) {
    setStatus('gpStatus', err.message, 'error');
  }
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

    ['reviewPanel', 'matchPanel', 'grnPanel', 'piPanel'].forEach(hide);
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
  runMatch('matchStatus').catch(function (err) { setStatus('matchStatus', err.message, 'error'); });
});
$('saveErpBtn').addEventListener('click', saveToErp);
$('startManualBtn').addEventListener('click', startManual);
// History's purchase invoice screen is a copy of step 5's, ids prefixed "gp".
$('gpScreenHost').innerHTML = $('piScreen').outerHTML.replace(/\bid="/g, 'id="gp');
watchTables();
$('roundOffAmount').addEventListener('input', function () { state.roundOffDirty = $('roundOffAmount').value !== ''; renderPiTotals(); });
$('addChargeBtn').addEventListener('click', function () {
  state.charges = state.charges || [];
  addCharge('', state.charges, function () { renderPiTotals(); });
});
$('billNo').addEventListener('input', function () { state.billNoDirty = true; });
// A D.N. no. typed by hand is the bill no. too, until the bill no. is changed.
$('dnNo').addEventListener('input', function () {
  $('dnoteNo').value = $('dnNo').value;
  if (!state.billNoDirty) $('billNo').value = $('dnNo').value;
});
$('dnDate').addEventListener('input', function () { if (!state.billNoDirty) $('billDate').value = $('dnDate').value; });
$('gproundOffAmount').addEventListener('input', function () { if (state.gp) { state.gp.roundOffDirty = $('gproundOffAmount').value !== ''; gpChanged(); } });
$('gpaddChargeBtn').addEventListener('click', function () { if (state.gp) addCharge('gp', state.gp.charges, gpChanged); });
['gppurchaseLedgerId', 'gpbillNo', 'gpbillDate', 'gppiRemark'].forEach(function (id) {
  $(id).addEventListener('input', function () { $('gpSaveBtn').disabled = true; });
});
$('gpCheckBtn').addEventListener('click', checkGrnPi);
$('gpSaveBtn').addEventListener('click', saveGrnPi);
$('gpCloseBtn').addEventListener('click', function () { hide('grnPiPanel'); state.gp = null; });
$('geMakePiBtn').addEventListener('click', function () { openGrnPi(state.grn.transactionId); });
window.addEventListener('resize', sizePendingBox);
$('refreshHistory').addEventListener('click', loadHistory);
$('deleteDraftsBtn').addEventListener('click', deleteDrafts);
$('supplierSearch').addEventListener('input', onSupplierInput);
attachSupplierSuggest($('supplierSearch'));
attachSupplierSuggest($('regSupplier'));
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
$('pickFileBtn').addEventListener('click', function () { $('invoiceFile').click(); });
$('takePhotoBtn').addEventListener('click', function () { $('invoiceCamera').click(); });
['invoiceFile', 'invoiceCamera'].forEach(function (id) {
  $(id).addEventListener('change', function () { addPages($(id).files); $(id).value = ''; });
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
Array.prototype.forEach.call(document.querySelectorAll('#appTabs .tab'), function (tab) {
  tab.addEventListener('click', function () { setApp(tab.dataset.app); });
});
$('regLoad').addEventListener('click', loadRegister);
document.addEventListener('click', function (e) {
  if ($('pop').classList.contains('hidden')) return;
  if ($('pop').contains(e.target) || (e.target.closest && e.target.closest('.flag-btn, .flag-chip, .ref-pick, #pendingTable tbody tr'))) return;
  closePop();
});
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePop(); });
// A mouse wheel over a focused number box steps its value: scrolling the page
// would quietly change a quantity. Let go of the box instead, so the page scrolls.
document.addEventListener('wheel', function (e) {
  var t = e.target;
  if (t && t.type === 'number' && t === document.activeElement) t.blur();
}, { passive: true });
$('regSearch').addEventListener('keydown', function (e) { if (e.key === 'Enter') loadRegister(); });
$('geCheckBtn').addEventListener('click', checkGrnEdit);
$('geSaveBtn').addEventListener('click', saveGrnEdit);
$('geDeleteBtn').addEventListener('click', function () { removeGrn(state.grn.transactionId, state.grn.voucherNo); });
$('geCloseBtn').addEventListener('click', function () { hide('grnEditPanel'); state.grn = null; });
['geDnNo', 'geDnDate', 'geGateNo', 'geGateDate', 'geVehicle', 'geEway', 'geReceivedBy'].forEach(function (id) {
  $(id).addEventListener('input', function () { hide('grnEditPlan'); $('geSaveBtn').disabled = true; });
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
