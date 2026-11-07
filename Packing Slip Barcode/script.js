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
  var SETTINGS_KEY = 'packingSlip.labelSettings.v2'; // v2: new TVS defaults, older saved settings are dropped
  var DB_KEY = 'packingSlip.database';
  var THEME_KEY = 'packingSlip.theme'; // also read by the inline script in index.html
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var BARCODE_DIGITS = 7;

  /* Starting points per label size; every value can be changed afterwards. */
  var PRESETS = {
    '100x75': { width: 100, height: 75, font: 12, barHeight: 12, module: 4, margin: 4 },
    '100x50': { width: 100, height: 50, font: 8, barHeight: 10, module: 3, margin: 3 },
    '100x100': { width: 100, height: 100, font: 11, barHeight: 22, module: 3, margin: 3 },
    '100x150': { width: 100, height: 150, font: 13, barHeight: 30, module: 4, margin: 4 },
    '75x50': { width: 75, height: 50, font: 7, barHeight: 10, module: 3, margin: 2.5 },
    '50x25': { width: 50, height: 25, font: 4, barHeight: 5, module: 2, margin: 1.5 }
  };
  var DEFAULTS = {
    preset: '100x75', width: 100, height: 75, font: 12, barHeight: 12,
    module: 4, margin: 4, offsetX: 4, offsetY: 0, dpi: 203,
    rotate: 0, // text runs across the roll, like the old exe; 1 turns the layout 90°
    // 1: don't tell Chrome the page size. A 100 x 75 page makes Chrome ask for
    // landscape, which the SNBC / Seagull driver prints turned 90° and cut off;
    // left out, Chrome uses the driver's own label size, upright.
    printerPaper: 0
  };

  /*
   * Small stickers: the exe's "Small Size - Only Barcode" print, the barcode and
   * its number on an A4 sticker sheet, printed on an office printer. Defaults
   * are the Novajet A4 48-up sheet CDC uses, as measured on the sheet: 5 mm
   * margins all round, 4 x 12 stickers, 4 mm gap between columns, none between
   * rows (5 + 4 x 47 + 3 x 4 + 5 = 210; 5 + 12 x 23.9 + 5 = 297). Every value
   * can be changed to match another sheet.
   *
   * Top and height are set for CDC's office printer, not the sheet: printed at
   * 5 / 23.9 it came out 2 mm higher and about 1.3% shorter down the page (top
   * margin 3 mm, bottom 11 mm). 6.5 / 24.1 lands within about 0.5-2 mm of the
   * stickers after that shrink and still fits on the page.
   */
  var SHEET_KEY = 'packingSlip.sheetSettings.v4'; // v4: corrected for the office printer; earlier saved values are dropped
  var A4 = { width: 210, height: 297 };
  var SHEET_DEFAULTS = {
    cols: 4, rows: 12, width: 47, height: 24.1,
    top: 6.5, left: 5, gapX: 4, gapY: 0,
    barHeight: 13, module: 6, dpi: 600, font: 9
  };
  /* Barcode 0 is never issued (numbers start at 100001), so a test sheet can't be mistaken for a carton. */
  var TEST_STICKER = { barcodeNo: 0 };

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
    mode: 'single', // 'mixed': several PWOs of one client under one barcode
    job: null,
    mixed: [], // { job, qty, netWt, grossWt, labelName, batchNo, batches }
    lastLabels: null,
    lastDryRun: false,
    reprintLabels: null,
    rangeRows: [],
    settings: loadSettings(),
    sheet: loadSheet()
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

  function loadSheet() {
    try {
      var saved = JSON.parse(localStorage.getItem(SHEET_KEY) || 'null');
      if (saved && typeof saved === 'object') return Object.assign({}, SHEET_DEFAULTS, saved);
    } catch (e) { /* storage blocked or corrupt: use defaults */ }
    return Object.assign({}, SHEET_DEFAULTS);
  }

  function saveSheet() {
    try { localStorage.setItem(SHEET_KEY, JSON.stringify(state.sheet)); } catch (e) { /* ignore */ }
  }

  var SHEET_INPUTS = {
    cols: 'sheet-cols', rows: 'sheet-rows', width: 'sheet-width', height: 'sheet-height',
    top: 'sheet-top', left: 'sheet-left', gapX: 'sheet-gap-x', gapY: 'sheet-gap-y',
    barHeight: 'sheet-bar-height', module: 'sheet-module', font: 'sheet-font'
  };

  function fillSheetForm() {
    Object.keys(SHEET_INPUTS).forEach(function (key) {
      $(SHEET_INPUTS[key]).value = state.sheet[key];
    });
  }

  function readSheetForm() {
    Object.keys(SHEET_INPUTS).forEach(function (key) {
      var n = Number($(SHEET_INPUTS[key]).value);
      if (Number.isFinite(n) && n >= 0) state.sheet[key] = n;
    });
    state.sheet.cols = Math.max(1, Math.round(state.sheet.cols));
    state.sheet.rows = Math.max(1, Math.round(state.sheet.rows));
    saveSheet();
    renderSheetPreview();
  }

  var SETTING_INPUTS = {
    preset: 'set-preset', width: 'set-width', height: 'set-height', font: 'set-font',
    barHeight: 'set-bar-height', module: 'set-module', margin: 'set-margin',
    offsetX: 'set-offset-x', offsetY: 'set-offset-y', dpi: 'set-dpi', rotate: 'set-rotate',
    printerPaper: 'set-printer-paper'
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
    $('page-style').textContent = s.printerPaper
      ? '@page { margin: 0; }'
      : '@page { size: ' + s.width + 'mm ' + s.height + 'mm; margin: 0; }';
  }

  /* ---------------- barcode + label ---------------- */

  function dotsToMm(dots, dpi) { return dots * 25.4 / (dpi || state.settings.dpi); }

  /* Bars are whole printer dots: `module` narrow dots at `dpi` (default: the label printer's). */
  function code39Svg(text, heightMm, module, dpi) {
    dpi = dpi || state.settings.dpi;
    var narrow = Math.max(1, Math.round(module == null ? state.settings.module : module));
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
      widthMm: dotsToMm(x, dpi),
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + x + ' 100" preserveAspectRatio="none"' +
        ' width="' + dotsToMm(x, dpi).toFixed(3) + 'mm" height="' + heightMm + 'mm" shape-rendering="crispEdges">' +
        '<g fill="#000">' + rects.join('') + '</g></svg>'
    };
  }

  /* Smallest text a mixed-box label is shrunk to before it stops fitting. */
  var MIN_FONT_PT = 4;

  function labelHtml(data, overlay) {
    var s = state.settings;
    var code = padBarcode(data.barcodeNo);
    var bar = code39Svg(code, s.barHeight);
    // A mixed box lists every PWO, comma separated, with every line wrapped in
    // full. fitMixedLabels then shrinks the text until it all fits, so the more
    // PWOs in the box, the smaller the text.
    var mixed = (data.jobCount || 1) > 1;
    var font = s.font;
    var line = function (label, value, wrap) {
      var cls = mixed ? ' wrap full' : (wrap ? ' wrap' : '');
      return '<div class="label-line' + cls + '">' + label + ' : ' + esc(value) + '</div>';
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
    return '<div class="label"' + (mixed ? ' data-mixed="1"' : '') +
      ' style="width:' + s.width + 'mm;height:' + s.height + 'mm;font-size:' + font.toFixed(2) + 'pt">' +
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
      '<div class="label-code"><div class="label-barcode">' + bar.svg + '</div>' +
      '<div class="label-number">' + code + '</div></div>' +
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

  /* Shrink each mixed-box label's text until the full barcode and its number fit. */
  function fitMixedLabels(root) {
    root.querySelectorAll('.label[data-mixed]').forEach(function (label) {
      var inner = label.querySelector('.label-inner');
      var barBox = label.querySelector('.label-barcode');
      var svg = barBox.querySelector('svg');
      var size = parseFloat(label.style.fontSize);
      var overflowing = function () {
        return inner.scrollHeight > inner.clientHeight + 1 ||
          barBox.getBoundingClientRect().height < svg.getBoundingClientRect().height - 0.5;
      };
      while (size > MIN_FONT_PT && overflowing()) {
        size = Math.max(MIN_FONT_PT, size - 0.25);
        label.style.fontSize = size + 'pt';
      }
    });
  }

  /* Mixed labels are fitted off-screen first: the print area is hidden on screen. */
  function fittedLabelsHtml(html) {
    if (html.indexOf('data-mixed') === -1) return html;
    var box = document.createElement('div');
    box.className = 'label-measure';
    box.innerHTML = html;
    document.body.appendChild(box);
    fitMixedLabels(box);
    var out = box.innerHTML;
    box.remove();
    return out;
  }

  /* One label object for a box holding several PWOs; values are comma separated. */
  function mixedLabel(lines, barcodeNo, packedDate) {
    var join = function (key) {
      return lines.map(function (l) { return l[key] == null || l[key] === '' ? '-' : l[key]; }).join(', ');
    };
    var anyBatch = lines.some(function (l) { return l.batchNo; });
    return {
      clientName: lines[0].clientName,
      jobBookingNo: join('jobBookingNo'),
      productCode: join('productCode'),
      jobName: join('jobName'),
      qtyPerBox: join('qtyPerBox'),
      batchNo: anyBatch ? join('batchNo') : '',
      packedDate: packedDate,
      barcodeNo: barcodeNo,
      jobCount: lines.length
    };
  }

  function renderPreview() {
    $('label-preview').innerHTML = labelHtml(SAMPLE);
    var w = fitWarnings();
    $('settings-warning').hidden = !w.length;
    $('settings-warning').textContent = w.join(' ');
  }

  function printLabels(labels, overlay) {
    if (!labels || !labels.length) return;
    applyPageSize();
    $('print-area').innerHTML = fittedLabelsHtml(labels.map(function (l) { return labelHtml(l, overlay); }).join(''));
    // Let the browser lay the labels out before the print dialog snapshots them.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { window.print(); });
    });
  }

  /* ---------------- small stickers (A4 sheet) ---------------- */

  function stickersPerSheet() { return state.sheet.cols * state.sheet.rows; }

  function stickerHtml(data, x, y, overlay) {
    var sh = state.sheet;
    var code = padBarcode(data.barcodeNo);
    var bar = code39Svg(code, sh.barHeight, sh.module, sh.dpi);
    return '<div class="sticker" style="left:' + x.toFixed(2) + 'mm;top:' + y.toFixed(2) + 'mm;' +
      'width:' + sh.width + 'mm;height:' + sh.height + 'mm;font-size:' + sh.font + 'pt">' +
      '<div class="sticker-bar">' + bar.svg + '</div>' +
      '<div class="sticker-number">' + code + '</div>' +
      (overlay ? '<div class="sticker-dry">' + esc(overlay) + '</div>' : '') +
      '</div>';
  }

  /*
   * A4 pages of stickers, left to right then down, like the exe's sheets. The
   * first `start - 1` stickers of the first page are left empty, so a partly
   * used sheet can go back in the printer.
   */
  /*
   * Test sheet only: a 100 mm line across and down (a ruler shows whether the
   * printer shrinks or stretches the page).
   */
  // The across line runs along the border between sticker rows 6 and 7; the down line in the left margin.
  var SHEET_GUIDES =
    '<div class="sheet-ruler" style="left:55mm;top:148.25mm;width:100mm;height:.3mm"></div>' +
    '<div class="sheet-ruler-text" style="left:56mm;top:149mm">100 mm across (measure this line)</div>' +
    '<div class="sheet-ruler" style="left:2.5mm;top:98.5mm;width:.3mm;height:100mm"></div>' +
    '<div class="sheet-ruler-text vertical" style="left:3.2mm;top:98.5mm">100 mm down</div>';

  function sheetsHtml(labels, start, overlay, guides) {
    var sh = state.sheet;
    var per = stickersPerSheet();
    var skip = Math.min(Math.max(1, Math.round(start || 1)), per) - 1;
    var pages = [];
    labels.forEach(function (l, i) {
      var slot = skip + i;
      var page = Math.floor(slot / per);
      var pos = slot % per;
      var col = pos % sh.cols;
      var row = Math.floor(pos / sh.cols);
      (pages[page] = pages[page] || []).push(stickerHtml(l,
        sh.left + col * (sh.width + sh.gapX), sh.top + row * (sh.height + sh.gapY), overlay));
    });
    // A hair under A4 so rounding never pushes a sheet onto a second, blank page.
    return pages.map(function (stickers) {
      return '<div class="sheet' + (guides ? ' guides' : '') + '" style="width:' + A4.width + 'mm;height:' + (A4.height - 1) + 'mm">' +
        (guides ? SHEET_GUIDES : '') + stickers.join('') + '</div>';
    }).join('');
  }

  function sheetWarnings() {
    var sh = state.sheet;
    var warnings = [];
    var right = sh.left + sh.cols * sh.width + (sh.cols - 1) * sh.gapX;
    var bottom = sh.top + sh.rows * sh.height + (sh.rows - 1) * sh.gapY;
    if (right > A4.width + 0.5) warnings.push('The stickers run ' + (right - A4.width).toFixed(1) + ' mm past the right edge of A4.');
    if (bottom > A4.height + 0.5) warnings.push('The stickers run ' + (bottom - A4.height).toFixed(1) + ' mm past the bottom of A4.');
    var bar = code39Svg(padBarcode(1234567), sh.barHeight, sh.module, sh.dpi);
    if (bar.widthMm > sh.width - 2) {
      warnings.push('The barcode (' + bar.widthMm.toFixed(1) + ' mm) is wider than the sticker. Use thinner bars.');
    }
    if (sh.barHeight + sh.font * 0.3528 * 1.3 > sh.height - 1) {
      warnings.push('The barcode and number are taller than the sticker. Lower the barcode height or number size.');
    }
    return warnings;
  }

  function renderSheetPreview() {
    var per = stickersPerSheet();
    var sample = [];
    for (var i = 0; i < per; i += 1) sample.push(TEST_STICKER);
    $('sheet-preview').innerHTML = sheetsHtml(sample, 1);
    $('sheet-count').textContent = state.sheet.cols + ' across x ' + state.sheet.rows + ' down = ' + per + ' stickers per sheet.';
    var w = sheetWarnings();
    $('sheet-warning').hidden = !w.length;
    $('sheet-warning').textContent = w.join(' ');
    document.querySelectorAll('.sticker-start').forEach(function (input) { input.max = per; });
  }

  /* The sticker to start from, read from the input next to the button. */
  function stickerStart(input) {
    var n = Math.round(Number(input && input.value));
    return n >= 1 && n <= stickersPerSheet() ? n : 1;
  }

  function stickerStartHtml(id) {
    return '<label class="inline-field sticker-start-field">Start at sticker <input type="number" class="sticker-start"' +
      (id ? ' id="' + id + '"' : '') + ' min="1" max="' + stickersPerSheet() + '" value="1" /></label>';
  }

  /* A Large or Small card: the size, what it is for, and its buttons. */
  function printChoiceHtml(small, actions) {
    return '<div class="print-choice"><div><div class="print-choice-title">' + (small ? 'Small sticker' : 'Large sticker') + '</div>' +
      '<div class="print-choice-note">' + (small
        ? 'Barcode and number only. Prints on an A4 sticker sheet.'
        : 'Full carton label. Prints on the label printer.') + '</div></div>' +
      '<div class="print-choice-actions">' + actions + '</div></div>';
  }

  /* The four ways to create labels. The size isn't saved: it only decides what prints. */
  function createChoicesHtml() {
    var buttons = function (size) {
      return '<button type="button" class="btn-secondary" data-create="' + size + '">Create only</button>' +
        '<button type="button" class="btn-primary" data-create="' + size + '" data-print="1">Create &amp; print</button>';
    };
    return '<div class="print-choices">' +
      printChoiceHtml(false, buttons('large')) +
      printChoiceHtml(true, stickerStartHtml() + buttons('small')) +
      '</div><p class="hint label-only-hint">Create only saves the barcodes without printing. They can be printed later in either size.</p>';
  }

  function printSheets(labels, start, overlay, guides) {
    if (!labels || !labels.length) return;
    // A4 for this print only; the next carton label print sets the label size again.
    $('page-style').textContent = '@page { size: A4 portrait; margin: 0; }';
    $('print-area').innerHTML = sheetsHtml(labels, start, overlay, guides);
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
    if (name === 'settings') { renderPreview(); renderSheetPreview(); }
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
      var sameJob = !!state.job && state.job.jobBookingId === data.job.jobBookingId;
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
      // A new PWO starts from its ERP name and a blank batch, like the exe; the same
      // PWO reloaded after printing keeps what was typed.
      if (!sameJob) {
        $('label-job-name').value = data.job.jobName || '';
        $('batch-no').value = '';
      }
      $('label-job-name').placeholder = data.job.jobName || '';
      fillBatchList($('batch-list'), data.batches);
      $('batch-hint').textContent = batchHint(data.batches);
      $('batch-hint').classList.toggle('warn-text', !data.batches);
      renderJobRanges(data.ranges);
      $('qty-per-box').focus();
    }).catch(function (err) { showStatus(err.message, 'error'); });
  }

  /* The ERP's batches for a job, offered as suggestions; any batch can still be typed. */
  function fillBatchList(list, batches) {
    list.innerHTML = (batches || []).map(function (b) {
      return '<option value="' + esc(b) + '"></option>';
    }).join('');
  }

  /* No `batches` at all means the backend predates the batch list. */
  function batchHint(batches) {
    if (!batches) return 'ERP batch list not available: the backend needs restarting with the new code.';
    if (!batches.length) return 'No batches entered in the ERP for this PWO. A typed batch is printed only.';
    return 'Click to pick one of ' + batches.length + ' ERP batch' + (batches.length === 1 ? '' : 'es') +
      ': it is saved with the labels. Other text is printed only.';
  }

  /* Open the batch suggestions on click, like a drop-down, instead of only while typing. */
  function openSuggestions(e) {
    var input = e.target;
    if (!input.matches || !input.matches('input[list]') || !input.list || !input.list.options.length) return;
    try { input.showPicker(); } catch (err) { /* not supported or not allowed: typing still filters */ }
  }

  /* What prints as Product Name: the edited name, or the ERP name if it was cleared. */
  function labelName(typed, job) {
    var name = String(typed == null ? '' : typed).trim();
    return name || job.jobName;
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
    $('job-sticker-start-wrap').hidden = !ranges.length;
    if (!ranges.length) { box.innerHTML = '<div class="empty">None yet.</div>'; return; }
    box.innerHTML = '<table><thead><tr><th>From</th><th>To</th><th class="num">Labels</th>' +
      '<th class="num">Qty</th><th>Printed</th><th>Reprint</th></tr></thead><tbody>' +
      ranges.map(function (r) {
        return '<tr><td>' + padBarcode(r.start) + '</td><td>' + padBarcode(r.end) + '</td>' +
          '<td class="num">' + fmtNum(r.labels) + '</td><td class="num">' + fmtNum(r.qty) + '</td>' +
          '<td>' + fmtDbDate(r.firstAt) + '</td>' +
          '<td class="reprint-cell">' + ['Large', 'Small'].map(function (size) {
            return '<button type="button" class="btn-secondary btn-mini" data-reprint-from="' + r.start + '" data-reprint-to="' + r.end +
              '" data-reprint-size="' + size.toLowerCase() + '">' + size + '</button>';
          }).join('') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  /* ---------------- generate ---------------- */

  /* Lock a form's create buttons while the server works; returns the call that unlocks them. */
  function lockCreateButtons(form, btn) {
    var label = btn.textContent;
    var buttons = form.querySelectorAll('[data-create]');
    buttons.forEach(function (b) { b.disabled = true; });
    btn.textContent = 'Creating…';
    return function () {
      buttons.forEach(function (b) { b.disabled = false; });
      btn.textContent = label;
    };
  }

  /* The labels just made, in either size. */
  function printLastRun(small, startInput) {
    if (small) printSheets(state.lastLabels, stickerStart(startInput), state.lastDryRun ? 'TEST' : null);
    else printLabels(state.lastLabels, state.lastDryRun ? 'TEST - NOT SAVED' : null);
  }

  /* Print what the clicked create button asked for, if it asked to print. */
  function printAfterCreate(btn, form) {
    if (btn.dataset.print) printLastRun(btn.dataset.create === 'small', form.querySelector('.sticker-start'));
  }

  function onGenerate(btn) {
    var form = $('generate-form');
    if (!state.job || !form.reportValidity()) return;
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

    var unlock = lockCreateButtons(form, btn);
    showStatus('');
    api('/generate', {
      method: 'POST',
      body: {
        jobBookingId: state.job.jobBookingId,
        qtyPerBox: qty,
        netWt: $('net-wt').value,
        grossWt: $('gross-wt').value,
        copies: copies,
        batchNo: $('batch-no').value.trim()
      }
    }).then(function (data) {
      var job = data.job;
      var name = labelName($('label-job-name').value, job);
      var typed = $('batch-no').value.trim();
      // A saved batch prints as the ERP has it, so a reprint shows the same text.
      var batchNo = data.savedBatchNo || typed;
      data.batchNote = batchNote([{ jobBookingNo: job.jobBookingNo, typed: typed, saved: data.savedBatchNo }],
        data.batchSaveDeployed, data.dryRun);
      state.lastDryRun = !!data.dryRun;
      state.lastLabels = data.barcodes.map(function (n) {
        return {
          clientName: job.clientName, jobBookingNo: job.jobBookingNo, productCode: job.productCode,
          jobName: name, qtyPerBox: qty, batchNo: batchNo, packedDate: fmtDate(data.packedAt), barcodeNo: n
        };
      });
      renderLastRun(data);
      if (data.partial) showStatus(data.error, 'error');
      printAfterCreate(btn, form);
      if (!data.dryRun) selectJob(job.jobBookingId);
    }).catch(function (err) {
      showStatus(err.message, 'error');
    }).then(unlock);
  }

  function renderLastRun(data, box) {
    box = box || $('last-run');
    var first = data.barcodes[0];
    var last = data.barcodes[data.barcodes.length - 1];
    var range = padBarcode(first) + (last !== first ? ' to ' + padBarcode(last) : '');
    box.className = 'last-run' + (data.dryRun ? ' dry' : '');
    box.innerHTML = '<span>' + (data.dryRun
      ? 'Test mode: ' + data.barcodes.length + ' labels (' + range + '). Nothing was saved.'
      : 'Created ' + data.barcodes.length + ' labels: ' + range + '.') +
      (data.batchNote ? ' ' + esc(data.batchNote) : '') + '</span>' +
      '<button type="button" class="btn-secondary" data-print-large="1">Print large stickers</button>' +
      '<span class="small-print">' + stickerStartHtml() +
      '<button type="button" class="btn-secondary" data-print-small="1">Print small stickers (A4)</button></span>';
    box.hidden = false;
  }

  /* The print buttons in a last-run box: small stickers go from the start sticker typed there. */
  function onLastRunClick(e) {
    if (e.target.dataset.printLarge) printLastRun(false);
    if (e.target.dataset.printSmall) printLastRun(true, e.currentTarget.querySelector('.sticker-start'));
  }

  /*
   * What happened to each typed batch. The save procs keep a batch only when it
   * is one of the PWO's ERP batches, as the ERP's packing slip does; the GPN and
   * delivery-note scans then show it. lines: [{ jobBookingNo, typed, saved }].
   */
  function batchNote(lines, deployed, dryRun) {
    var typed = lines.filter(function (l) { return l.typed; });
    if (!typed.length) return '';
    if (!deployed) return 'Batch No printed only: saving batches needs sql/packing-slip/006_save_batch_no.sql run in this plant.';
    var saved = typed.filter(function (l) { return l.saved; });
    var printed = typed.filter(function (l) { return !l.saved; });
    var many = lines.length > 1;
    var list = function (ls, field) {
      return ls.map(function (l) { return (many ? l.jobBookingNo + ' ' : '') + l[field]; }).join(', ');
    };
    return (saved.length ? 'Batch ' + list(saved, 'saved') + (dryRun ? ' would be saved' : ' saved') + ' with the labels.' : '') +
      (saved.length && printed.length ? ' ' : '') +
      (printed.length ? 'Batch ' + list(printed, 'typed') + ' printed only: not one of the ERP batches for ' +
        (many ? 'its PWO' : 'this PWO') + '.' : '');
  }

  /* ---------------- mixed box ---------------- */

  function setMode(mode) {
    state.mode = mode;
    var mixed = mode === 'mixed';
    $('job-search-label').textContent = mixed
      ? 'Add a PWO to the box (PWO no, job name or client)'
      : 'Find PWO (PWO no, job name or client)';
    $('job-panel').hidden = mixed || !state.job;
    $('mixed-panel').hidden = !mixed;
    $('job-results').hidden = true;
    $('job-search').value = '';
    showStatus('');
    if (mixed) renderMixed();
    $('job-search').focus();
  }

  function addMixedJob(jobBookingId) {
    showStatus('');
    return api('/jobs/' + jobBookingId).then(function (data) {
      var job = data.job;
      $('job-results').hidden = true;
      $('job-search').value = '';
      if (state.mixed.some(function (m) { return m.job.jobBookingId === job.jobBookingId; })) {
        showStatus(job.jobBookingNo + ' is already in the box.', 'error');
        return;
      }
      if (state.mixed.length && state.mixed[0].job.ledgerId !== job.ledgerId) {
        showStatus('A box can only hold PWOs of one client. ' + job.jobBookingNo + ' is for ' + job.clientName +
          ', the box is for ' + state.mixed[0].job.clientName + '.', 'error');
        return;
      }
      state.mixed.push({
        job: job, qty: '', netWt: '', grossWt: '',
        labelName: job.jobName || '', batchNo: '', batches: data.batches
      });
      renderMixed();
      var inputs = $('mixed-rows').querySelectorAll('input[data-field="qty"]');
      if (inputs.length) inputs[inputs.length - 1].focus();
    }).catch(function (err) { showStatus(err.message, 'error'); });
  }

  function renderMixed() {
    var rows = state.mixed;
    $('mixed-client').textContent = rows.length
      ? rows[0].job.clientName + ' · ' + rows.length + ' PWO' + (rows.length === 1 ? '' : 's') + ' in this box'
      : 'Search above and pick each PWO that goes in this box.';
    var input = function (i, field, value, step) {
      return '<input type="number" min="0" step="' + step + '" data-i="' + i + '" data-field="' + field +
        '" value="' + esc(value) + '" />';
    };
    var text = function (i, field, value, extra) {
      return '<input type="text" data-i="' + i + '" data-field="' + field + '" value="' + esc(value) + '"' +
        ' autocomplete="off"' + (extra || '') + ' />';
    };
    $('mixed-rows').innerHTML = rows.length
      ? rows.map(function (m, i) {
        var listId = 'mixed-batches-' + i;
        return '<tr><td>' + esc(m.job.jobBookingNo) + '</td>' +
          '<td class="wrap">' + text(i, 'labelName', m.labelName,
            ' class="wide" maxlength="500" placeholder="' + esc(m.job.jobName) + '"') + '</td>' +
          '<td>' + text(i, 'batchNo', m.batchNo, ' maxlength="100" list="' + listId + '"' +
            ' title="' + esc(batchHint(m.batches)) + '"') +
          '<datalist id="' + listId + '"></datalist></td>' +
          '<td class="num">' + fmtNum(m.job.orderQuantity) + '</td>' +
          '<td>' + input(i, 'qty', m.qty, 1) + '</td>' +
          '<td class="wt-job">' + input(i, 'netWt', m.netWt, 0.01) + '</td>' +
          '<td class="wt-job">' + input(i, 'grossWt', m.grossWt, 0.01) + '</td>' +
          '<td><button type="button" class="btn-link" data-remove="' + i + '">Remove</button></td></tr>';
      }).join('')
      : '<tr><td colspan="9" class="empty">No PWO in the box yet.</td></tr>';
    rows.forEach(function (m, i) { fillBatchList($('mixed-batches-' + i), m.batches); });
  }

  function onMixedGenerate(btn) {
    var form = $('mixed-form');
    if (!form.reportValidity()) return;
    var rows = state.mixed;
    var copies = Number($('mixed-copies').value);
    var weightMode = $('mixed-weight-mode').value;
    if (rows.length < 2) { showStatus('Add at least two PWOs to a mixed box.', 'error'); return; }
    var missing = rows.filter(function (m) { return !Number.isInteger(Number(m.qty)) || Number(m.qty) < 1; });
    if (missing.length) { showStatus('Enter the quantity in the box for ' + missing[0].job.jobBookingNo + '.', 'error'); return; }
    if (!Number.isInteger(copies) || copies < 1 || copies > state.maxCopies) {
      showStatus('Number of labels must be between 1 and ' + state.maxCopies + '.', 'error');
      return;
    }
    if (copies > window.AppConfig.confirmAbove &&
      !window.confirm('Create ' + copies + ' new mixed-box barcodes with ' + rows.length + ' PWOs each?')) {
      return;
    }

    var unlock = lockCreateButtons(form, btn);
    showStatus('');
    api('/generate-mixed', {
      method: 'POST',
      body: {
        items: rows.map(function (m) {
          return {
            jobBookingId: m.job.jobBookingId, qty: Number(m.qty), netWt: m.netWt, grossWt: m.grossWt,
            batchNo: String(m.batchNo || '').trim()
          };
        }),
        weightMode: weightMode,
        boxNetWt: $('mixed-net').value,
        boxGrossWt: $('mixed-gross').value,
        copies: copies
      }
    }).then(function (data) {
      // The server returns the PWOs sorted by job; match each back to its row for the typed name and batch.
      var byJob = {};
      rows.forEach(function (m) { byJob[m.job.jobBookingId] = m; });
      var lines = data.lines.map(function (j) {
        var m = byJob[j.jobBookingId] || {};
        return {
          clientName: j.clientName, jobBookingNo: j.jobBookingNo, productCode: j.productCode,
          jobName: labelName(m.labelName, j), qtyPerBox: j.qtyPerBox,
          batchNo: j.savedBatchNo || String(m.batchNo || '').trim()
        };
      });
      data.batchNote = batchNote(data.lines.map(function (j) {
        var m = byJob[j.jobBookingId] || {};
        return { jobBookingNo: j.jobBookingNo, typed: String(m.batchNo || '').trim(), saved: j.savedBatchNo };
      }), data.batchSaveDeployed, data.dryRun);
      var packed = fmtDate(data.packedAt);
      state.lastDryRun = !!data.dryRun;
      state.lastLabels = data.barcodes.map(function (n) { return mixedLabel(lines, n, packed); });
      renderLastRun(data, $('mixed-last-run'));
      printAfterCreate(btn, form);
      if (!data.dryRun) {
        state.mixed = [];
        renderMixed();
      }
    }).catch(function (err) {
      showStatus(err.message, 'error');
    }).then(unlock);
  }

  /* ---------------- reprint ---------------- */

  /* Rows come one per PWO; a mixed box has several rows under one barcode. */
  function groupByBarcode(rows) {
    var labels = [];
    var byNo = {};
    rows.forEach(function (r) {
      r.packedDate = fmtDbDate(r.packedAt);
      if (!byNo[r.barcodeNo]) { byNo[r.barcodeNo] = []; labels.push(byNo[r.barcodeNo]); }
      byNo[r.barcodeNo].push(r);
    });
    return labels.map(function (group) {
      return group.length === 1 ? group[0] : mixedLabel(group, group[0].barcodeNo, group[0].packedDate);
    });
  }

  function loadReprint(from, to) {
    showStatus('');
    var q = '/barcodes?from=' + encodeURIComponent(from) + (to ? '&to=' + encodeURIComponent(to) : '');
    return api(q).then(function (data) {
      var rows = data.labels;
      data.labels = groupByBarcode(rows);
      state.reprintLabels = data.labels;
      var box = $('reprint-result');
      if (!data.labels.length) {
        box.innerHTML = '<div class="empty">No saved barcode in that range.</div>';
        return data.labels;
      }
      var jobs = {};
      rows.forEach(function (l) { jobs[l.jobBookingNo] = (jobs[l.jobBookingNo] || 0) + 1; });
      // One PWO, no mixed boxes: the product name and batch can be changed for this print.
      var single = Object.keys(jobs).length === 1 && data.labels.length === rows.length;
      var count = data.labels.length + ' ' + (data.labels.length === 1 ? 'sticker' : 'stickers');
      var savedBatches = rows.map(function (r) { return r.batchNo; })
        .filter(function (b, i, all) { return all.indexOf(b) === i; });
      box.innerHTML = '<table><thead><tr><th>PWO</th><th class="num">Labels</th></tr></thead><tbody>' +
        Object.keys(jobs).map(function (k) {
          return '<tr><td>' + esc(k) + '</td><td class="num">' + jobs[k] + '</td></tr>';
        }).join('') + '</tbody></table>' +
        (single
          ? '<div class="form-row"><label class="field grow"><span>Product name on label</span>' +
            '<input id="reprint-job-name" type="text" maxlength="500" autocomplete="off" value="' + esc(rows[0].jobName) +
            '" placeholder="' + esc(rows[0].jobName) + '" /></label>' +
            '<label class="field"><span>Batch No</span><input id="reprint-batch" type="text" maxlength="100" autocomplete="off" value="' +
            esc(savedBatches.length === 1 ? savedBatches[0] : '') + '" /></label></div>' +
            '<p class="hint label-only-hint">Changes here are printed only. The saved labels, and their batch, stay as they are.</p>'
          : '') +
        '<div class="print-choices">' +
        printChoiceHtml(false, '<button type="button" class="btn-primary" id="btn-reprint-print">Print ' + count + '</button>' +
          '<button type="button" class="btn-secondary" id="btn-reprint-preview">Show actual size</button>') +
        printChoiceHtml(true, stickerStartHtml('reprint-sticker-start') +
          '<button type="button" class="btn-primary" id="btn-reprint-small">Print ' + count + '</button>') +
        '</div>' +
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
    box.hidden = false;
    renderReprintPreview();
    btn.textContent = 'Hide preview';
  }

  function renderReprintPreview() {
    var box = $('reprint-preview');
    var labels = reprintPrintable();
    box.innerHTML = labels.slice(0, PREVIEW_LIMIT).map(function (l) { return labelHtml(l); }).join('') +
      (labels.length > PREVIEW_LIMIT
        ? '<p class="hint">Showing the first ' + PREVIEW_LIMIT + ' of ' + labels.length + ' labels.</p>'
        : '');
    fitMixedLabels(box);
  }

  /* Saved labels with the product name and batch typed for this print, if any. */
  function withLabelEdits(labels, nameInput, batchInput) {
    if (!nameInput) return labels;
    return labels.map(function (l) {
      var copy = Object.assign({}, l);
      copy.jobName = labelName(nameInput.value, l);
      copy.batchNo = batchInput.value.trim();
      return copy;
    });
  }

  function reprintPrintable() {
    return withLabelEdits(state.reprintLabels || [], $('reprint-job-name'), $('reprint-batch'));
  }

  /* Reprint from the PWO panel: uses the product name and batch typed on that panel. */
  function reprintRange(from, to, size) {
    loadReprint(from, to).then(function (labels) {
      if (!labels || !labels.length) return;
      if (size === 'small') { printSheets(labels, stickerStart($('job-sticker-start'))); return; }
      var own = state.job && labels.every(function (l) { return l.jobBookingId === state.job.jobBookingId; });
      printLabels(own ? withLabelEdits(labels, $('label-job-name'), $('batch-no')) : labels);
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

  /* ---------------- theme ---------------- */

  var darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function isDark() {
    var t = document.documentElement.dataset.theme;
    if (t) return t === 'dark';
    return !!(darkQuery && darkQuery.matches);
  }

  function renderThemeToggle() {
    var dark = isDark();
    $('theme-toggle').textContent = dark ? 'Light mode' : 'Dark mode';
    $('theme-toggle').setAttribute('aria-pressed', String(dark));
  }

  function toggleTheme() {
    var next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
    renderThemeToggle();
  }

  /* ---------------- wiring ---------------- */

  function init() {
    try { state.db = localStorage.getItem(DB_KEY) || window.AppConfig.defaultDatabase; } catch (e) {
      state.db = window.AppConfig.defaultDatabase;
    }
    $('database').value = state.db;
    if (window.AppConfig.portalUrl) $('back-to-portal').href = window.AppConfig.portalUrl;
    $('ranges-from').value = todayIso(-7);
    $('ranges-to').value = todayIso(0);
    fillSettingsForm();
    fillSheetForm();
    applyPageSize();

    document.addEventListener('click', openSuggestions);

    renderThemeToggle();
    $('theme-toggle').addEventListener('click', toggleTheme);
    if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', renderThemeToggle);

    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () { switchView(t.dataset.view); });
    });

    $('database').addEventListener('change', function () {
      state.db = $('database').value;
      try { localStorage.setItem(DB_KEY, state.db); } catch (e) { /* ignore */ }
      clearJob();
      state.mixed = [];
      renderMixed();
      $('job-results').hidden = true;
    });

    $('job-search').addEventListener('input', onSearchInput);
    $('job-results').addEventListener('click', function (e) {
      var btn = e.target.closest('.result');
      if (!btn) return;
      if (state.mode === 'mixed') addMixedJob(btn.dataset.id);
      else selectJob(btn.dataset.id);
    });
    document.querySelectorAll('input[name="box-mode"]').forEach(function (r) {
      r.addEventListener('change', function () { if (r.checked) setMode(r.value); });
    });
    $('mixed-rows').addEventListener('input', function (e) {
      var i = e.target.dataset.i;
      if (i != null) state.mixed[Number(i)][e.target.dataset.field] = e.target.value;
    });
    $('mixed-rows').addEventListener('click', function (e) {
      var i = e.target.dataset.remove;
      if (i == null) return;
      state.mixed.splice(Number(i), 1);
      renderMixed();
    });
    $('mixed-clear').addEventListener('click', function () {
      state.mixed = [];
      $('mixed-last-run').hidden = true;
      renderMixed();
    });
    $('mixed-weight-mode').addEventListener('change', function () {
      $('mixed-panel').dataset.weight = $('mixed-weight-mode').value;
    });
    $('mixed-create').innerHTML = createChoicesHtml();
    $('mixed-form').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-create]');
      if (btn) onMixedGenerate(btn);
    });
    $('mixed-last-run').addEventListener('click', onLastRunClick);
    $('job-clear').addEventListener('click', clearJob);
    $('job-create').innerHTML = createChoicesHtml();
    $('generate-form').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-create]');
      if (btn) onGenerate(btn);
    });

    $('last-run').addEventListener('click', onLastRunClick);
    $('job-sticker-start-wrap').innerHTML = '<span>For small reprints:</span>' + stickerStartHtml('job-sticker-start');
    $('job-ranges').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-reprint-from]');
      if (btn) reprintRange(btn.dataset.reprintFrom, btn.dataset.reprintTo, btn.dataset.reprintSize);
    });

    $('reprint-form').addEventListener('submit', function (e) {
      e.preventDefault();
      loadReprint($('reprint-from').value, $('reprint-to').value);
    });
    $('reprint-result').addEventListener('click', function (e) {
      if (e.target.id === 'btn-reprint-print') printLabels(reprintPrintable());
      if (e.target.id === 'btn-reprint-preview') toggleReprintPreview(e.target);
      // Stickers carry only the barcode, so the product name / batch edits don't matter here.
      if (e.target.id === 'btn-reprint-small') printSheets(state.reprintLabels, stickerStart($('reprint-sticker-start')));
    });
    $('reprint-result').addEventListener('input', function (e) {
      var preview = $('reprint-preview');
      if (/^reprint-(job-name|batch)$/.test(e.target.id) && preview && !preview.hidden) renderReprintPreview();
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

    $('sheet-form').addEventListener('change', readSheetForm);
    $('sheet-form').addEventListener('input', function (e) {
      if (e.target.tagName === 'INPUT') readSheetForm();
    });
    $('btn-test-sheet').addEventListener('click', function () {
      var sample = [];
      for (var i = 0; i < stickersPerSheet(); i += 1) sample.push(TEST_STICKER);
      printSheets(sample, 1, 'TEST', true);
    });
    $('btn-reset-sheet').addEventListener('click', function () {
      state.sheet = Object.assign({}, SHEET_DEFAULTS);
      saveSheet();
      fillSheetForm();
      renderSheetPreview();
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
