/**
 * Packing Slip Barcode — browser replacement for the VB6 label generator.
 *
 * Labels are drawn as HTML and printed through the printer's Windows driver,
 * the same route the old tool took (VB6 Printer object), so the printer's
 * command language does not matter. The barcode is Code 39, the symbology the
 * old exe encoded, with every bar a whole number of printer dots so a 203 DPI
 * head prints it without rounding.
 */
(function () {
  'use strict';

  var API = window.AppConfig.apiBaseUrl + '/packing-slip';
  var SETTINGS_KEY = 'packingSlip.labelSettings.v1';
  var DB_KEY = 'packingSlip.database';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var BARCODE_DIGITS = 7;

  /* Starting points per label size; every value can be changed afterwards. */
  var PRESETS = {
    '100x75': { width: 100, height: 75, font: 10, barHeight: 16, module: 3, margin: 3 },
    '100x50': { width: 100, height: 50, font: 8, barHeight: 10, module: 3, margin: 3 },
    '100x100': { width: 100, height: 100, font: 11, barHeight: 22, module: 3, margin: 3 },
    '100x150': { width: 100, height: 150, font: 13, barHeight: 30, module: 4, margin: 4 },
    '75x50': { width: 75, height: 50, font: 7, barHeight: 10, module: 3, margin: 2.5 },
    '50x25': { width: 50, height: 25, font: 4, barHeight: 5, module: 2, margin: 1.5 }
  };
  var DEFAULTS = {
    preset: '100x75', width: 100, height: 75, font: 10, barHeight: 16,
    module: 3, margin: 3, offsetX: 0, offsetY: 0, dpi: 203,
    rotate: 1 // the roll feeds the label tall, so the layout is printed turned 90° like the old exe
  };

  /* Code 39, digits and the start/stop '*'. 1 = wide element; bar, space, bar ... */
  var CODE39 = {
    '0': '000110100', '1': '100100001', '2': '001100001', '3': '101100000', '4': '000110001',
    '5': '100110000', '6': '001110000', '7': '000100101', '8': '100100100', '9': '001100100',
    '*': '010010100'
  };

  var state = {
    db: 'KOL',
    writesAllowed: false,
    maxCopies: 500,
    job: null,
    lastLabels: null,
    lastDryRun: false,
    reprintLabels: null,
    rangeRows: [],
    settings: loadSettings()
  };

  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- helpers ---------------- */

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtNum(n) { return Number(n || 0).toLocaleString('en-IN'); }

  function fmtDate(value) {
    if (!value) return '';
    var d = new Date(value);
    if (isNaN(d)) return '';
    return String(d.getDate()).padStart(2, '0') + '-' + MONTHS[d.getMonth()] + '-' + d.getFullYear();
  }

  /*
   * Dates read from the ERP. Indus stores local (IST) wall-clock time and the
   * API hands it over as if it were UTC, so the UTC fields ARE the IST date;
   * reading them as local time would push evening entries into the next day.
   */
  function fmtDbDate(value) {
    if (!value) return '';
    var d = new Date(value);
    if (isNaN(d)) return '';
    return String(d.getUTCDate()).padStart(2, '0') + '-' + MONTHS[d.getUTCMonth()] + '-' + d.getUTCFullYear();
  }

  function padBarcode(n) { return String(n).padStart(BARCODE_DIGITS, '0'); }

  function todayIso(offsetDays) {
    var d = new Date();
    d.setDate(d.getDate() + (offsetDays || 0));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function showStatus(message, kind) {
    var el = $('status');
    if (!message) { el.hidden = true; return; }
    el.textContent = message;
    el.className = 'status ' + (kind || 'info');
    el.hidden = false;
  }

  function api(path, options) {
    options = options || {};
    var sep = path.indexOf('?') === -1 ? '?' : '&';
    var url = API + path + (options.method === 'POST' ? '' : sep + 'database=' + encodeURIComponent(state.db));
    var init = { method: options.method || 'GET', headers: {} };
    if (options.body) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(Object.assign({ database: state.db }, options.body));
    }
    return fetch(url, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || data.ok === false) throw new Error(data.error || ('Request failed (' + res.status + ')'));
        return data;
      });
    });
  }

  /* ---------------- settings ---------------- */

  function loadSettings() {
    try {
      var saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (saved && typeof saved === 'object') return Object.assign({}, DEFAULTS, saved);
    } catch (e) { /* storage blocked or corrupt: use defaults */ }
    return Object.assign({}, DEFAULTS);
  }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch (e) { /* ignore */ }
  }

  var SETTING_INPUTS = {
    preset: 'set-preset', width: 'set-width', height: 'set-height', font: 'set-font',
    barHeight: 'set-bar-height', module: 'set-module', margin: 'set-margin',
    offsetX: 'set-offset-x', offsetY: 'set-offset-y', dpi: 'set-dpi', rotate: 'set-rotate'
  };

  function fillSettingsForm() {
    Object.keys(SETTING_INPUTS).forEach(function (key) {
      $(SETTING_INPUTS[key]).value = state.settings[key];
    });
  }

  function readSettingsForm(changedId) {
    var s = state.settings;
    if (changedId === 'set-preset') {
      s.preset = $('set-preset').value;
      if (PRESETS[s.preset]) Object.assign(s, PRESETS[s.preset]);
      fillSettingsForm();
    } else {
      Object.keys(SETTING_INPUTS).forEach(function (key) {
        if (key === 'preset') return;
        var n = Number($(SETTING_INPUTS[key]).value);
        if (Number.isFinite(n)) s[key] = n;
      });
      if (changedId === 'set-width' || changedId === 'set-height') {
        s.preset = 'custom';
        $('set-preset').value = 'custom';
      }
    }
    saveSettings();
    applyPageSize();
    renderPreview();
  }

  function applyPageSize() {
    var s = state.settings;
    $('page-style').textContent =
      '@page { size: ' + s.width + 'mm ' + s.height + 'mm; margin: 0; }';
  }

  /* ---------------- barcode + label ---------------- */

  function dotsToMm(dots) { return dots * 25.4 / state.settings.dpi; }

  function code39Svg(text, heightMm) {
    var narrow = Math.max(1, Math.round(state.settings.module));
    var wide = Math.round(narrow * 2.5);
    var chars = ('*' + text + '*').split('');
    var x = 0;
    var rects = [];
    chars.forEach(function (ch, ci) {
      var pattern = CODE39[ch];
      for (var i = 0; i < 9; i += 1) {
        var w = pattern[i] === '1' ? wide : narrow;
        if (i % 2 === 0) rects.push('<rect x="' + x + '" y="0" width="' + w + '" height="100"/>');
        x += w;
      }
      if (ci < chars.length - 1) x += narrow; // inter-character gap
    });
    return {
      widthMm: dotsToMm(x),
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + x + ' 100" preserveAspectRatio="none"' +
        ' width="' + dotsToMm(x).toFixed(3) + 'mm" height="' + heightMm + 'mm" shape-rendering="crispEdges">' +
        '<g fill="#000">' + rects.join('') + '</g></svg>'
    };
  }

  function labelHtml(data, overlay) {
    var s = state.settings;
    var code = padBarcode(data.barcodeNo);
    var bar = code39Svg(code, s.barHeight);
    var line = function (label, value, wrap) {
      return '<div class="label-line' + (wrap ? ' wrap' : '') + '">' + label + ' : ' + esc(value) + '</div>';
    };
    // Width x height is the physical label (across the roll x along the feed).
    // Sideways: the layout box is height x width, turned 90° clockwise, so the
    // text runs along the feed and the barcode sits on the left, as the old exe did.
    var bw = s.rotate ? s.height : s.width;
    var bh = s.rotate ? s.width : s.height;
    var turn = s.rotate
      ? 'position:absolute;left:0;top:0;width:' + bw + 'mm;height:' + bh + 'mm;' +
        'transform-origin:0 0;transform:translateX(' + s.width + 'mm) rotate(90deg)'
      : 'position:absolute;inset:0';
    return '<div class="label" style="width:' + s.width + 'mm;height:' + s.height + 'mm;font-size:' + s.font + 'pt">' +
      '<div style="' + turn + '">' +
      '<div class="label-inner" style="left:' + (s.margin + s.offsetX) + 'mm;top:' + (s.margin + s.offsetY) + 'mm;' +
      'width:' + (bw - 2 * s.margin) + 'mm;height:' + (bh - 2 * s.margin) + 'mm">' +
      line('Client Name', data.clientName, true) +
      line('PWO NO', data.jobBookingNo) +
      line('Product Code', data.productCode) +
      line('Product Name', data.jobName, true) +
      line('Quantity/Box', data.qtyPerBox) +
      line('Batch No', data.batchNo || '') +
      line('Packing Date', data.packedDate) +
      '<div class="label-barcode" style="align-self:center">' + bar.svg + '</div>' +
      '<div class="label-number" style="align-self:center">' + code + '</div>' +
      '</div></div>' +
      (overlay ? '<div class="label-dry">' + esc(overlay) + '</div>' : '') +
      '</div>';
  }

  function fitWarnings() {
    var s = state.settings;
    var warnings = [];
    var innerW = s.width - 2 * s.margin;
    var innerH = s.height - 2 * s.margin;
    var bar = code39Svg(padBarcode(1234567), s.barHeight);
    if (bar.widthMm > innerW) {
      warnings.push('The barcode (' + bar.widthMm.toFixed(1) + ' mm) is wider than the label. Use thinner bars or a wider label.');
    }
    var lineMm = s.font * 0.3528 * 1.2;
    var neededH = lineMm * 9 + s.barHeight; // 7 lines, a wrapped product name, the number
    if (neededH > innerH) {
      warnings.push('The text and barcode need about ' + neededH.toFixed(0) + ' mm of height; the label has ' +
        innerH.toFixed(0) + ' mm. Reduce the text size or barcode height.');
    }
    var narrowMm = dotsToMm(Math.round(s.module));
    if (narrowMm < 0.19) warnings.push('Bars this thin may not scan reliably. Use 3 dots or more.');
    return warnings;
  }

  var SAMPLE = {
    clientName: 'Shaili Arts', jobBookingNo: 'J00882_26_27', productCode: '1',
    jobName: 'SS MEDICARE and mohtahosp. r - Letterhead (20000 x 2 kinds)',
    qtyPerBox: 3000, batchNo: '', packedDate: fmtDate(new Date()), barcodeNo: 1234567
  };

  function renderPreview() {
    $('label-preview').innerHTML = labelHtml(SAMPLE);
    var w = fitWarnings();
    $('settings-warning').hidden = !w.length;
    $('settings-warning').textContent = w.join(' ');
  }

  function printLabels(labels, overlay) {
    if (!labels || !labels.length) return;
    applyPageSize();
    $('print-area').innerHTML = labels.map(function (l) { return labelHtml(l, overlay); }).join('');
    // Let the browser lay the labels out before the print dialog snapshots them.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { window.print(); });
    });
  }

  /* ---------------- views ---------------- */

  function switchView(name) {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('is-active', t.dataset.view === name);
    });
    document.querySelectorAll('.view').forEach(function (v) {
      v.hidden = v.dataset.view !== name;
    });
    showStatus('');
    if (name === 'settings') renderPreview();
  }

  function renderMode() {
    var badge = $('mode-badge');
    badge.hidden = false;
    if (state.writesAllowed) {
      badge.className = 'badge live';
      badge.textContent = 'Live';
    } else {
      badge.className = 'badge dry';
      badge.textContent = 'Test mode: barcodes are not saved';
    }
    $('copies').max = state.maxCopies;
  }

  /* ---------------- job search ---------------- */

  var searchTimer = null;
  var searchSeq = 0;

  function onSearchInput() {
    clearTimeout(searchTimer);
    var q = $('job-search').value.trim();
    if (q.length < 2) { $('job-results').hidden = true; return; }
    searchTimer = setTimeout(function () { runSearch(q); }, 300);
  }

  function runSearch(q) {
    var seq = ++searchSeq;
    api('/jobs?q=' + encodeURIComponent(q)).then(function (data) {
      if (seq !== searchSeq) return;
      var box = $('job-results');
      box.hidden = false;
      if (!data.jobs.length) {
        box.innerHTML = '<div class="empty">No released, open PWO matches "' + esc(q) + '".</div>';
        return;
      }
      box.innerHTML = data.jobs.map(function (j) {
        return '<button type="button" class="result" data-id="' + j.jobBookingId + '">' +
          '<strong>' + esc(j.jobBookingNo) + '</strong>' + esc(j.jobName) +
          '<div class="meta">' + esc(j.clientName) + ' · Order ' + fmtNum(j.orderQuantity) + '</div></button>';
      }).join('');
    }).catch(function (err) {
      if (seq === searchSeq) showStatus(err.message, 'error');
    });
  }

  function selectJob(jobBookingId) {
    showStatus('');
    return api('/jobs/' + jobBookingId).then(function (data) {
      state.job = data.job;
      $('job-results').hidden = true;
      $('job-search').value = data.job.jobBookingNo;
      $('job-panel').hidden = false;
      $('job-no').textContent = data.job.jobBookingNo;
      $('job-name').textContent = data.job.jobName;
      $('job-client').textContent = data.job.clientName;
      $('job-code').textContent = data.job.productCode || '—';
      $('job-order').textContent = fmtNum(data.job.orderQuantity);
      $('job-slips').textContent = fmtNum(data.job.slips);
      $('job-slipqty').textContent = fmtNum(data.job.slipQty);
      renderJobRanges(data.ranges);
      $('qty-per-box').focus();
    }).catch(function (err) { showStatus(err.message, 'error'); });
  }

  function clearJob() {
    state.job = null;
    state.lastLabels = null;
    $('job-panel').hidden = true;
    $('last-run').hidden = true;
    $('job-search').value = '';
    $('job-search').focus();
  }

  function renderJobRanges(ranges) {
    var box = $('job-ranges');
    if (!ranges.length) { box.innerHTML = '<div class="empty">None yet.</div>'; return; }
    box.innerHTML = '<table><thead><tr><th>From</th><th>To</th><th class="num">Labels</th>' +
      '<th class="num">Qty</th><th>Printed</th><th></th></tr></thead><tbody>' +
      ranges.map(function (r) {
        return '<tr><td>' + padBarcode(r.start) + '</td><td>' + padBarcode(r.end) + '</td>' +
          '<td class="num">' + fmtNum(r.labels) + '</td><td class="num">' + fmtNum(r.qty) + '</td>' +
          '<td>' + fmtDbDate(r.firstAt) + '</td>' +
          '<td><button type="button" class="btn-link" data-reprint-from="' + r.start + '" data-reprint-to="' + r.end +
          '">Reprint</button></td></tr>';
      }).join('') + '</tbody></table>';
  }

  /* ---------------- generate ---------------- */

  function onGenerate(event) {
    event.preventDefault();
    if (!state.job) return;
    var qty = Number($('qty-per-box').value);
    var copies = Number($('copies').value);
    if (!Number.isInteger(qty) || qty < 1) { showStatus('Enter the quantity per box.', 'error'); return; }
    if (!Number.isInteger(copies) || copies < 1 || copies > state.maxCopies) {
      showStatus('Number of labels must be between 1 and ' + state.maxCopies + '.', 'error');
      return;
    }
    if (copies > window.AppConfig.confirmAbove &&
      !window.confirm('Create ' + copies + ' new barcodes for ' + state.job.jobBookingNo + ' at ' + qty + ' per box?')) {
      return;
    }

    var btn = $('btn-generate');
    btn.disabled = true;
    btn.textContent = 'Creating…';
    showStatus('');
    api('/generate', {
      method: 'POST',
      body: {
        jobBookingId: state.job.jobBookingId,
        qtyPerBox: qty,
        netWt: $('net-wt').value,
        grossWt: $('gross-wt').value,
        copies: copies
      }
    }).then(function (data) {
      var job = data.job;
      state.lastDryRun = !!data.dryRun;
      state.lastLabels = data.barcodes.map(function (n) {
        return {
          clientName: job.clientName, jobBookingNo: job.jobBookingNo, productCode: job.productCode,
          jobName: job.jobName, qtyPerBox: qty, batchNo: '', packedDate: fmtDate(data.packedAt), barcodeNo: n
        };
      });
      renderLastRun(data);
      if (data.partial) showStatus(data.error, 'error');
      printLabels(state.lastLabels, state.lastDryRun ? 'TEST - NOT SAVED' : null);
      if (!data.dryRun) selectJob(job.jobBookingId);
    }).catch(function (err) {
      showStatus(err.message, 'error');
    }).then(function () {
      btn.disabled = false;
      btn.textContent = 'Create & print';
    });
  }

  function renderLastRun(data) {
    var box = $('last-run');
    var first = data.barcodes[0];
    var last = data.barcodes[data.barcodes.length - 1];
    var range = padBarcode(first) + (last !== first ? ' to ' + padBarcode(last) : '');
    box.className = 'last-run' + (data.dryRun ? ' dry' : '');
    box.innerHTML = '<span>' + (data.dryRun
      ? 'Test mode: ' + data.barcodes.length + ' labels previewed (' + range + '). Nothing was saved.'
      : 'Created ' + data.barcodes.length + ' labels: ' + range + '.') + '</span>' +
      '<button type="button" class="btn-secondary" id="btn-print-again">Print again</button>';
    box.hidden = false;
  }

  /* ---------------- reprint ---------------- */

  function loadReprint(from, to) {
    showStatus('');
    var q = '/barcodes?from=' + encodeURIComponent(from) + (to ? '&to=' + encodeURIComponent(to) : '');
    return api(q).then(function (data) {
      data.labels.forEach(function (l) { l.packedDate = fmtDbDate(l.packedAt); });
      state.reprintLabels = data.labels;
      var box = $('reprint-result');
      if (!data.labels.length) {
        box.innerHTML = '<div class="empty">No saved barcode in that range.</div>';
        return data.labels;
      }
      var jobs = {};
      data.labels.forEach(function (l) { jobs[l.jobBookingNo] = (jobs[l.jobBookingNo] || 0) + 1; });
      box.innerHTML = '<table><thead><tr><th>PWO</th><th class="num">Labels</th></tr></thead><tbody>' +
        Object.keys(jobs).map(function (k) {
          return '<tr><td>' + esc(k) + '</td><td class="num">' + jobs[k] + '</td></tr>';
        }).join('') + '</tbody></table>' +
        '<div class="form-row"><button type="button" class="btn-primary" id="btn-reprint-print">Print ' +
        data.labels.length + ' label' + (data.labels.length === 1 ? '' : 's') + '</button>' +
        '<button type="button" class="btn-secondary" id="btn-reprint-preview">Show actual size</button></div>' +
        '<div id="reprint-preview" class="preview reprint-preview" hidden></div>';
      return data.labels;
    }).catch(function (err) { showStatus(err.message, 'error'); return null; });
  }

  /* Labels drawn in mm with the current label-size settings, as they will print. */
  var PREVIEW_LIMIT = 20;

  function toggleReprintPreview(btn) {
    var box = $('reprint-preview');
    if (!box.hidden) {
      box.hidden = true;
      btn.textContent = 'Show actual size';
      return;
    }
    var labels = state.reprintLabels || [];
    box.innerHTML = labels.slice(0, PREVIEW_LIMIT).map(function (l) { return labelHtml(l); }).join('') +
      (labels.length > PREVIEW_LIMIT
        ? '<p class="hint">Showing the first ' + PREVIEW_LIMIT + ' of ' + labels.length + ' labels.</p>'
        : '');
    box.hidden = false;
    btn.textContent = 'Hide preview';
  }

  function reprintRange(from, to) {
    loadReprint(from, to).then(function (labels) {
      if (labels && labels.length) printLabels(labels);
    });
  }

  /* ---------------- ranges report ---------------- */

  function loadRanges(event) {
    event.preventDefault();
    showStatus('');
    var from = $('ranges-from').value;
    var to = $('ranges-to').value;
    $('ranges-result').innerHTML = '<div class="empty">Loading…</div>';
    api('/ranges?from=' + from + '&to=' + to).then(function (data) {
      state.rangeRows = data.rows;
      $('ranges-export').disabled = !data.rows.length;
      if (!data.rows.length) { $('ranges-result').innerHTML = '<div class="empty">No labels in these dates.</div>'; return; }
      $('ranges-result').innerHTML = '<table><thead><tr><th>Client</th><th>SO No</th><th>PWO</th><th>Job name</th>' +
        '<th>Product code</th><th class="num">Order qty</th><th>From</th><th>To</th><th class="num">Labels</th>' +
        '<th class="num">Qty</th><th>Printed</th></tr></thead><tbody>' +
        data.rows.map(function (r) {
          return '<tr><td>' + esc(r.clientName) + '</td><td>' + esc(r.salesOrderNo) + '</td><td>' + esc(r.jobBookingNo) +
            '</td><td class="wrap">' + esc(r.jobName) + '</td><td>' + esc(r.productCode) + '</td><td class="num">' +
            fmtNum(r.orderQuantity) + '</td><td>' + padBarcode(r.start) + '</td><td>' + padBarcode(r.end) +
            '</td><td class="num">' + fmtNum(r.labels) + '</td><td class="num">' + fmtNum(r.qty) + '</td><td>' +
            fmtDbDate(r.firstAt) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }).catch(function (err) {
      $('ranges-result').innerHTML = '';
      showStatus(err.message, 'error');
    });
  }

  function exportRanges() {
    var head = ['Client', 'SO No', 'PWO No', 'PWO Date', 'Job Name', 'Product Code', 'Order Qty',
      'Start Barcode', 'End Barcode', 'Labels', 'Qty', 'Printed'];
    var cell = function (v) {
      var s = String(v == null ? '' : v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    var lines = [head.join(',')].concat(state.rangeRows.map(function (r) {
      // A leading tab keeps Excel from dropping the barcode's leading zero.
      return [r.clientName, r.salesOrderNo, r.jobBookingNo, fmtDbDate(r.jobBookingDate), r.jobName, r.productCode,
        r.orderQuantity, '\t' + padBarcode(r.start), '\t' + padBarcode(r.end), r.labels, r.qty, fmtDbDate(r.firstAt)]
        .map(cell).join(',');
    }));
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'barcode-ranges_' + state.db + '_' + $('ranges-from').value + '_' + $('ranges-to').value + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ---------------- wiring ---------------- */

  function init() {
    try { state.db = localStorage.getItem(DB_KEY) || window.AppConfig.defaultDatabase; } catch (e) {
      state.db = window.AppConfig.defaultDatabase;
    }
    $('database').value = state.db;
    $('ranges-from').value = todayIso(-7);
    $('ranges-to').value = todayIso(0);
    fillSettingsForm();
    applyPageSize();

    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () { switchView(t.dataset.view); });
    });

    $('database').addEventListener('change', function () {
      state.db = $('database').value;
      try { localStorage.setItem(DB_KEY, state.db); } catch (e) { /* ignore */ }
      clearJob();
      $('job-results').hidden = true;
    });

    $('job-search').addEventListener('input', onSearchInput);
    $('job-results').addEventListener('click', function (e) {
      var btn = e.target.closest('.result');
      if (btn) selectJob(btn.dataset.id);
    });
    $('job-clear').addEventListener('click', clearJob);
    $('generate-form').addEventListener('submit', onGenerate);

    $('last-run').addEventListener('click', function (e) {
      if (e.target.id === 'btn-print-again') {
        printLabels(state.lastLabels, state.lastDryRun ? 'TEST - NOT SAVED' : null);
      }
    });
    $('job-ranges').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-reprint-from]');
      if (btn) reprintRange(btn.dataset.reprintFrom, btn.dataset.reprintTo);
    });

    $('reprint-form').addEventListener('submit', function (e) {
      e.preventDefault();
      loadReprint($('reprint-from').value, $('reprint-to').value);
    });
    $('reprint-result').addEventListener('click', function (e) {
      if (e.target.id === 'btn-reprint-print') printLabels(state.reprintLabels);
      if (e.target.id === 'btn-reprint-preview') toggleReprintPreview(e.target);
    });

    $('ranges-form').addEventListener('submit', loadRanges);
    $('ranges-export').addEventListener('click', exportRanges);

    $('settings-form').addEventListener('change', function (e) { readSettingsForm(e.target.id); });
    $('settings-form').addEventListener('input', function (e) {
      if (e.target.tagName === 'INPUT') readSettingsForm(e.target.id);
    });
    $('btn-test-print').addEventListener('click', function () { printLabels([SAMPLE], 'TEST LABEL'); });
    $('btn-reset-settings').addEventListener('click', function () {
      state.settings = Object.assign({}, DEFAULTS);
      saveSettings();
      fillSettingsForm();
      applyPageSize();
      renderPreview();
    });

    api('/config').then(function (cfg) {
      state.writesAllowed = !!cfg.writesAllowed;
      state.maxCopies = cfg.maxCopies || state.maxCopies;
      renderMode();
    }).catch(function (err) {
      showStatus('Cannot reach the server: ' + err.message, 'error');
    });
  }

  init();
})();
