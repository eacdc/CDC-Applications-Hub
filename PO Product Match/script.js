(function () {
  'use strict';

  const isLocalHost = typeof window !== 'undefined' && /localhost|127\.0\.0\.1/i.test(window.location.hostname);
  const API_BASE = isLocalHost ? 'http://localhost:3001/api' : 'https://cdcapi.onrender.com/api';

  const els = {
    tabs: Array.from(document.querySelectorAll('.tab[data-side="po"]')),
    poFile: document.getElementById('poFile'),
    poText: document.getElementById('poText'),
    database: document.getElementById('database'),
    topN: document.getElementById('topN'),
    extractedPreview: document.getElementById('extractedPreview'),
    runBtn: document.getElementById('runBtn'),
    status: document.getElementById('status'),
    metaSection: document.getElementById('metaSection'),
    metaJson: document.getElementById('metaJson'),
    resultsSection: document.getElementById('resultsSection'),
    resultsList: document.getElementById('resultsList')
  };

  function setStatus(text, isError) {
    els.status.textContent = text || '';
    els.status.style.color = isError ? '#ff9292' : '#9ec1ff';
  }

  function setPoMode(mode) {
    document.querySelectorAll('.tab[data-side="po"]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    document.getElementById('poFileMode').classList.toggle('active', mode === 'file');
    document.getElementById('poTextMode').classList.toggle('active', mode === 'text');
  }

  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => setPoMode(tab.dataset.mode));
  });

  async function runMatch() {
    setStatus('Working…');
    els.metaSection.hidden = true;
    els.resultsSection.hidden = true;
    els.resultsList.innerHTML = '';

    const mode = document.querySelector('.tab[data-side="po"].active')?.dataset.mode || 'file';
    const form = new FormData();
    form.append('database', els.database.value);
    const topN = Math.min(150, Math.max(1, parseInt(els.topN.value, 10) || 80));
    form.append('topN', String(topN));

    if (mode === 'text') {
      const text = (els.poText.value || '').trim();
      if (!text) {
        setStatus('Paste PO text or switch to file mode.', true);
        return;
      }
      form.append('text', text);
    } else {
      const file = els.poFile.files?.[0];
      if (!file) {
        setStatus('Choose a file or switch to text mode.', true);
        return;
      }
      form.append('file', file);
    }

    try {
      const res = await fetch(`${API_BASE}/po-product-match/search`, {
        method: 'POST',
        body: form
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      els.extractedPreview.value = data.extractedPoText || '';

      const meta = {
        source: data.source,
        database: data.database,
        hints: data.hints,
        searchAttempt: data.searchAttempt,
        skippedReason: data.skippedReason,
        sql: data.sql
      };
      els.metaJson.textContent = JSON.stringify(meta, null, 2);
      els.metaSection.hidden = false;

      const results = data.results || [];
      if (!results.length) {
        setStatus(data.skippedReason ? `No search run: ${data.skippedReason}` : 'No matching products.');
        return;
      }

      results.forEach((item) => {
        const card = document.createElement('article');
        card.className = 'result-card';
        const r = item.row || {};
        card.innerHTML = `
          <header>
            <strong>ProductMasterID ${escapeHtml(String(item.productMasterId))}</strong>
            <span class="match-pct">${escapeHtml(String(item.matchPercent))}%</span>
          </header>
          <div class="reason">${escapeHtml(item.reason || '')}</div>
          <div class="row-grid">
            <div><span>JobName</span><br>${escapeHtml(r.JobName || '')}</div>
            <div><span>BookingNo</span><br>${escapeHtml(r.BookingNo || '')}</div>
            <div><span>ProductCode</span><br>${escapeHtml(r.ProductCode || '')}</div>
            <div><span>PM Code</span><br>${escapeHtml(r.ProductMasterCode || '')}</div>
            <div><span>Client</span><br>${escapeHtml(r.ClientLedgerName || r.ClientTradeName || '')}</div>
            <div><span>Sales</span><br>${escapeHtml(r.SalesLedgerName || '')}</div>
          </div>
        `;
        els.resultsList.appendChild(card);
      });

      els.resultsSection.hidden = false;
      setStatus(`Done — ${results.length} row(s).`);
    } catch (e) {
      setStatus(e.message || 'Failed', true);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  els.runBtn.addEventListener('click', runMatch);
})();
