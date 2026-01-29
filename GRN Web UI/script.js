(function() {
    'use strict';
  
    const YEAR_EL = document.getElementById('year');
    if (YEAR_EL) YEAR_EL.textContent = String(new Date().getFullYear());
  
    // Config
    const DEFAULT_API_BASE = 'https://cdcapi.onrender.com/api/';
    const LOCAL_API_BASE = 'http://localhost:3001/api/';
  
    function isValidAbsoluteUrl(value) {
      if (!value || typeof value !== 'string') return false;
      const v = value.trim();
      if (!(v.startsWith('http://') || v.startsWith('https://'))) return false;
      try { new URL(v); return true; } catch (_) { return false; }
    }
  
    function getApiBaseUrl() {
      try {
        const stored = localStorage.getItem('grn_api_base');
        const chosen = isValidAbsoluteUrl(stored) ? stored : DEFAULT_API_BASE;
        return chosen.endsWith('/') ? chosen : chosen + '/';
      } catch (_) {
        return DEFAULT_API_BASE;
      }
    }
  
    function setButtonLoading(button, isLoading, loadingText = 'Loading...') {
      if (!button) return;
      if (isLoading) {
        if (!button.dataset.originalText) {
          button.dataset.originalText = button.textContent ?? '';
        }
        button.disabled = true;
        button.textContent = loadingText;
        button.classList.add('btn-loading');
        button.setAttribute('aria-busy', 'true');
      } else {
        button.disabled = false;
        if (button.dataset.originalText != null) {
          button.textContent = button.dataset.originalText;
          delete button.dataset.originalText;
        }
        button.classList.remove('btn-loading');
        button.removeAttribute('aria-busy');
      }
    }

    // Barcode Status Lookup
    async function runBarcodeStatusLookup(barcodeOverride = null) {
      try {
        if (!session || !session.selectedDatabase || !session.userId) {
          if (statusError) statusError.textContent = 'Please login first.';
          return;
        }
  
        const barcodeInputValue = barcodeOverride != null
          ? String(barcodeOverride).trim()
          : String(statusBarcodeInput?.value || '').trim();

        if (!barcodeInputValue) {
          if (statusError) statusError.textContent = 'Enter barcode number';
          if (statusBarcodeInput) statusBarcodeInput.focus();
          return;
        }
  
        const barcodeNum = Number(barcodeInputValue);
        if (!Number.isFinite(barcodeNum)) {
          if (statusError) statusError.textContent = 'Barcode must be a valid number';
          if (statusBarcodeInput) statusBarcodeInput.focus();
          return;
        }

        if (barcodeOverride != null && statusBarcodeInput) {
          statusBarcodeInput.value = barcodeInputValue;
        }
  
        if (statusError) statusError.textContent = '';
        if (statusResults) statusResults.hidden = false;
        if (statusResultsTitle) statusResultsTitle.textContent = `Status Timeline for Barcode ${barcodeNum}`;
        if (statusResultsSummary) statusResultsSummary.textContent = 'Checking barcode status...';
        if (statusTableBody) {
          statusTableBody.innerHTML = `
            <tr class="empty-row">
              <td colspan="4" class="empty-message">Fetching status history...</td>
            </tr>
          `;
        }
        setButtonLoading(searchBarcodeStatusBtn, true, 'Searching...');
  
        const base = getApiBaseUrl();
        const url = new URL('grn/barcode-status', base);
        const res = await fetch(url.toString(), {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({
            barcode: barcodeNum,
            database: session.selectedDatabase
          })
        });
  
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          throw new Error(t || 'Failed to fetch barcode status');
        }
  
        lastStatusBarcode = barcodeNum;

        const data = await res.json();
        if (!data || data.status !== true) {
          const msg = data?.error || 'Failed to fetch barcode status';
          if (statusError) statusError.textContent = msg;
          renderBarcodeStatusRows([], barcodeNum);
          return;
        }
  
        renderBarcodeStatusRows(data.records || [], barcodeNum);
      } catch (e) {
        if (statusError) statusError.textContent = String(e.message || e);
        if (statusResults) statusResults.hidden = true;
      } finally {
        setButtonLoading(searchBarcodeStatusBtn, false);
      }
    }

    // Siren sound for error/fail notifications (works after any user interaction)
    function playSiren() {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        if (!window.__grnAudioCtx) {
          window.__grnAudioCtx = new AudioCtx();
        }
        const ctx = window.__grnAudioCtx;
        // Some mobile browsers require resume after gesture
        if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); }
  
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.05);
  
        // Sweep frequency up and down quickly to mimic a siren
        const start = ctx.currentTime;
        osc.frequency.setValueAtTime(600, start);
        osc.frequency.linearRampToValueAtTime(1200, start + 0.3);
        osc.frequency.linearRampToValueAtTime(700, start + 0.6);
        osc.frequency.linearRampToValueAtTime(1100, start + 0.9);
  
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        // Fade out and stop
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.1);
        osc.stop(start + 1.2);
      } catch (_) {
        // Ignore audio errors
      }
    }
  
    function alertWithSiren(message) {
      try { playSiren(); } catch (_) {}
      alert(message);
    }
  
    // Elements
    const loginSection = document.getElementById('login-section');
    const landingSection = document.getElementById('landing-section');
    const postLoginSection = document.getElementById('post-login-section');
    const challanFormSection = document.getElementById('challan-form-section');
    const deliveryNoteConfirmation = document.getElementById('delivery-note-confirmation');
    const gpnSection = document.getElementById('gpn-section');
    const gpnConfirmation = document.getElementById('gpn-confirmation');
    const barcodeStatusSection = document.getElementById('barcode-status-section');
    const statusResults = document.getElementById('status-results');
    const statusResultsSummary = document.getElementById('status-results-summary');
    const statusResultsTitle = document.getElementById('status-results-title');
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    const usernameInput = document.getElementById('username');
    const databaseSelect = document.getElementById('database');
    const infoUsername = document.getElementById('info-username');
    const infoDatabase = document.getElementById('info-database');
    const infoUsernameGrm = document.getElementById('info-username-grm');
    const infoDatabaseGrm = document.getElementById('info-database-grm');
    const infoUsernameGpn = document.getElementById('info-username-gpn');
    const infoDatabaseGpn = document.getElementById('info-database-gpn');
    const infoUsernameStatus = document.getElementById('info-username-status');
    const infoDatabaseStatus = document.getElementById('info-database-status');
    const barcodeInput = document.getElementById('barcode');
    const gpnBarcodeInput = document.getElementById('gpn-barcode');
    const gpnConfBarcode = document.getElementById('gpn-conf-barcode');
    const initiateBtn = document.getElementById('btn-initiate');
    const submitGpnBtn = document.getElementById('btn-submit-gpn');
    const updateGpnBtn = document.getElementById('btn-update-gpn');
    const logoutBtn = document.getElementById('btn-logout');
    const backToLandingBtn = document.getElementById('btn-back-to-landing');
    const backToLandingGpnBtn = document.getElementById('btn-back-to-landing-gpn');
    const backToGpnFormBtn = document.getElementById('btn-back-to-gpn-form');
    const backToLandingStatusBtn = document.getElementById('btn-back-to-landing-status');
    const portalGrm = document.getElementById('portal-grm');
    const portalGpn = document.getElementById('portal-gpn');
    const portalBarcodeStatus = document.getElementById('portal-barcode-status');
    const gpnError = document.getElementById('gpn-error');
    const gpnTableBody = document.getElementById('gpn-table-body');
    const clientNameInput = document.getElementById('clientName');
    const modeOfTransportSelect = document.getElementById('modeOfTransport');
    const containerNumberInput = document.getElementById('containerNumber');
    const sealNumberInput = document.getElementById('sealNumber');
    const transporterNameSelect = document.getElementById('transporterName');
    const vehicleNumberInput = document.getElementById('vehicleNumber');
    const saveChallanBtn = document.getElementById('btn-save-challan');
    const dnNumberSpan = document.getElementById('dn-number');
    const confClientName = document.getElementById('conf-client-name');
    const confModeTransport = document.getElementById('conf-mode-transport');
    const confTransporter = document.getElementById('conf-transporter');
    const confContainer = document.getElementById('conf-container');
    const confVehicle = document.getElementById('conf-vehicle');
    const confSeal = document.getElementById('conf-seal');
    const confBarcode = document.getElementById('conf-barcode');
    const updateDeliveryNoteBtn = document.getElementById('btn-update-delivery-note');
    const deliveryTableBody = document.getElementById('delivery-table-body');
    const deliveryDetailsPanel = document.getElementById('delivery-details-panel');
    const deliveryDetailsToggle = document.getElementById('delivery-details-toggle');
    const statusBarcodeInput = document.getElementById('status-barcode');
    const searchBarcodeStatusBtn = document.getElementById('btn-search-barcode-status');
    const statusError = document.getElementById('status-error');
    const statusTableBody = document.getElementById('status-table-body');
    const backToInitiateBtn = document.getElementById('btn-back-to-initiate');
    const backToFormBtn = document.getElementById('btn-back-to-form');
  
    const SECTION_MAP = {
      login: [loginSection],
      landing: [landingSection],
      'post-login': [postLoginSection],
      'challan-form': [challanFormSection],
      'delivery-confirmation': [deliveryNoteConfirmation],
      gpn: [gpnSection],
      'gpn-confirmation': [gpnConfirmation],
      'barcode-status': [barcodeStatusSection]
    };
  
    const ALL_SECTIONS = Array.from(
      new Set(
        Object.values(SECTION_MAP)
          .flat()
          .filter(Boolean)
      )
    );
  
    const VIEW_CONFIG = {
      login: {
        sections: SECTION_MAP['login'],
        onEnter: () => {
          if (usernameInput) {
            setTimeout(() => usernameInput.focus(), 0);
          }
        }
      },
      landing: {
        sections: SECTION_MAP['landing']
      },
      'post-login': {
        sections: SECTION_MAP['post-login'],
        onEnter: () => {
          if (barcodeInput) {
            setTimeout(() => barcodeInput.focus(), 0);
          }
        }
      },
      'challan-form': {
        sections: SECTION_MAP['challan-form']
      },
      'delivery-confirmation': {
        sections: SECTION_MAP['delivery-confirmation'],
        onEnter: () => {
          if (confBarcode) {
            setTimeout(() => confBarcode.focus(), 0);
          }
        }
      },
      gpn: {
        sections: SECTION_MAP['gpn'],
        onEnter: () => {
          if (gpnBarcodeInput) {
            setTimeout(() => gpnBarcodeInput.focus(), 0);
          }
        }
      },
      'gpn-confirmation': {
        sections: SECTION_MAP['gpn-confirmation'],
        onEnter: () => {
          if (gpnConfBarcode) {
            setTimeout(() => gpnConfBarcode.focus(), 0);
          }
        }
      },
      'barcode-status': {
        sections: SECTION_MAP['barcode-status'],
        onEnter: () => {
          if (statusBarcodeInput) {
            setTimeout(() => statusBarcodeInput.focus(), 0);
          }
        }
      }
    };
  
    let currentView = null;
    let historyDepth = 0;
  
    function applyView(view) {
      const config = VIEW_CONFIG[view];
      if (!config) return;
  
      ALL_SECTIONS.forEach(section => {
        if (section) section.classList.add('hidden');
      });
  
      (config.sections || []).forEach(section => {
        if (section) section.classList.remove('hidden');
      });
  
      if (logoutBtn) {
        if (view === 'login') {
          logoutBtn.classList.add('hidden');
        } else {
          logoutBtn.classList.remove('hidden');
        }
      }
  
      if (typeof config.onEnter === 'function') {
        config.onEnter();
      }
    }
  
    function navigateTo(view, options = {}) {
      const { replace = false, force = false, skipHistory = false } = options;
      if (!force && currentView === view) return;
      if (!VIEW_CONFIG[view]) return;
  
      applyView(view);
      currentView = view;
  
      if (skipHistory) return;
  
      try {
        if (replace) {
          history.replaceState({ view }, document.title, undefined);
        } else {
          history.pushState({ view }, document.title, undefined);
          historyDepth += 1;
        }
      } catch (err) {
        console.warn('Failed to update navigation history:', err);
      }
    }
  
    function detectInitialView() {
      const entries = Object.entries(SECTION_MAP);
      for (const [view, sections] of entries) {
        if (sections.some(section => section && !section.classList.contains('hidden'))) {
          return view;
        }
      }
      return 'login';
    }
  
    function initializeNavigation() {
      currentView = detectInitialView();
      if (!VIEW_CONFIG[currentView]) {
        currentView = 'login';
      }
      applyView(currentView);
      try {
        history.replaceState({ view: currentView }, document.title, undefined);
      } catch (err) {
        console.warn('Failed to initialize navigation history:', err);
      }
      historyDepth = 0;
    }
  
    function handleBackNavigation(fallbackView) {
      const target = (!session && fallbackView !== 'login') ? 'login' : fallbackView;
      if (historyDepth > 0) {
        history.back();
      } else {
        navigateTo(target, { replace: true, force: true });
      }
    }
  
    window.addEventListener('popstate', (event) => {
      const stateView = event.state && event.state.view;
      let targetView = VIEW_CONFIG[stateView] ? stateView : detectInitialView();
      if (!session && targetView !== 'login') {
        targetView = 'login';
      }
      if (targetView === 'login') {
        historyDepth = 0;
      } else if (historyDepth > 0) {
        historyDepth -= 1;
      }
      applyView(targetView);
      currentView = targetView;
    });
  
    initializeNavigation();
  
    let session = null; // { userId, ledgerId, machines, selectedDatabase, username }
    let lastStatusBarcode = null;
    const STATUS_CATEGORY_CLASS_MAP = {
      'packing slip': 'status-badge-packingslip',
      'packing-slip': 'status-badge-packingslip',
      'packingslip': 'status-badge-packingslip',
      'gpn': 'status-badge-gpn',
      'goods packing note': 'status-badge-gpn',
      'delivery note': 'status-badge-delivery',
      'dn': 'status-badge-delivery'
    };
    function normalizeStatusCategory(value) {
      return String(value || '').toLowerCase().trim();
    }
    function getCanonicalStatusCategory(value) {
      const normalized = normalizeStatusCategory(value);
      if (normalized === 'goods packing note') return 'gpn';
      if (normalized === 'dn') return 'delivery note';
      return normalized;
    }
    
    // Session storage keys
    const SESSION_KEY = 'grn_session';
    const SESSION_ID_KEY = 'grn_session_id';
    
    // Session Management Functions
    function saveSession(sessionData) {
      try {
        // Generate a unique session ID for this login
        const sessionId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
        localStorage.setItem(SESSION_ID_KEY, sessionId);
        console.log('GRN Session saved:', sessionId);
      } catch (error) {
        console.error('Error saving session:', error);
      }
    }
    
    function loadSession() {
      try {
        const sessionData = localStorage.getItem(SESSION_KEY);
        if (sessionData) {
          return JSON.parse(sessionData);
        }
      } catch (error) {
        console.error('Error loading session:', error);
        clearSession();
      }
      return null;
    }
    
    function clearSession() {
      try {
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(SESSION_ID_KEY);
        console.log('GRN Session cleared');
      } catch (error) {
        console.error('Error clearing session:', error);
      }
    }
    
    function getSessionId() {
      try {
        return localStorage.getItem(SESSION_ID_KEY);
      } catch (error) {
        return null;
      }
    }
  
    function showError(msg) {
      if (loginError) loginError.textContent = msg || '';
    }
    
    function resetBarcodeStatusView() {
      if (statusError) statusError.textContent = '';
      if (statusBarcodeInput) statusBarcodeInput.value = '';
      lastStatusBarcode = null;
      if (statusResults) statusResults.hidden = true;
      if (statusResultsSummary) statusResultsSummary.textContent = '';
      if (statusResultsTitle) statusResultsTitle.textContent = 'Status Timeline';
      if (statusTableBody) {
        statusTableBody.innerHTML = `
          <tr class="empty-row">
            <td colspan="4" class="empty-message">Enter a barcode to view status history.</td>
          </tr>
        `;
      }
    }
  
    function scrollBarcodeStatusIntoView() {
      if (!statusResults) return;
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const isMobileViewport = window.innerWidth <= 768;
      if (!isMobileViewport) return;
      requestAnimationFrame(() => {
        statusResults.scrollIntoView({
          behavior: prefersReducedMotion ? 'auto' : 'smooth',
          block: 'start'
        });
      });
    }

    function formatTimestamp(value) {
      if (!value) return '—';
      try {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) {
          return date.toLocaleString();
        }
      } catch (_) {
        // ignore
      }
      return String(value);
    }
  
    function renderBarcodeStatusRows(records = [], barcodeValue = null) {
      if (!statusTableBody) return;
      if (statusResults) statusResults.hidden = false;
      const barcodeText = barcodeValue != null ? String(barcodeValue) : null;

      if (statusResultsTitle) {
        statusResultsTitle.textContent = barcodeText
          ? `Status Timeline for Barcode ${barcodeText}`
          : 'Status Timeline';
      }

      if (!Array.isArray(records) || records.length === 0) {
        statusTableBody.innerHTML = `
          <tr class="empty-row">
            <td colspan="4" class="empty-message">No records found${barcodeText ? ` for barcode ${barcodeText}` : ''}.</td>
          </tr>
        `;
        if (statusResultsSummary) {
          statusResultsSummary.textContent = barcodeText
            ? `No history available for barcode ${barcodeText}.`
            : 'No history available for the provided barcode.';
        }
        scrollBarcodeStatusIntoView();
        return;
      }

      const jobBookingNumbers = new Set();
      statusTableBody.innerHTML = '';
      const hasDeliveryNote = records.some(record => {
        const categoryValue = record.Category ?? record.category ?? '—';
        return getCanonicalStatusCategory(categoryValue) === 'delivery note';
      });

      records.forEach(record => {
        const category = record.Category ?? record.category ?? '—';
        const eventDate = record.EventDate ?? record.eventDate ?? record.event_date ?? record.datetime ?? record.CreatedDate ?? '—';
        const jobBookingNo = record.JobBookingNo ?? record.jobBookingNo ?? record.jobbookingno ?? '—';
        if (jobBookingNo) jobBookingNumbers.add(jobBookingNo);

        const normalizedCategory = normalizeStatusCategory(category);
        const canonicalCategory = getCanonicalStatusCategory(category);
        const badgeClass = STATUS_CATEGORY_CLASS_MAP[normalizedCategory]
          || STATUS_CATEGORY_CLASS_MAP[canonicalCategory]
          || 'status-badge-default';

        const row = document.createElement('tr');
        const categoryCell = document.createElement('td');
        categoryCell.innerHTML = `<span class="status-badge ${badgeClass}">${category}</span>`;
        const dateCell = document.createElement('td');
        dateCell.textContent = formatTimestamp(eventDate);
        const jobCell = document.createElement('td');
        jobCell.textContent = jobBookingNo;
        const actionCell = document.createElement('td');
        actionCell.classList.add('status-action-cell');

        if (canonicalCategory === 'gpn' || canonicalCategory === 'delivery note') {
          const deleteBtn = document.createElement('button');
          deleteBtn.type = 'button';
          deleteBtn.textContent = 'Delete';
          deleteBtn.className = 'status-delete-btn';
          const shouldDisableForDependency = canonicalCategory === 'gpn' && hasDeliveryNote;
          if (shouldDisableForDependency) {
            deleteBtn.disabled = true;
            deleteBtn.title = 'Delete the Delivery Note entry first to enable this action.';
          }
          const resolvedBarcode = barcodeText ?? (lastStatusBarcode != null ? String(lastStatusBarcode) : '');
          deleteBtn.addEventListener('click', () => {
            handleBarcodeStatusDelete(canonicalCategory, resolvedBarcode, deleteBtn);
          });
          actionCell.appendChild(deleteBtn);
        } else {
          actionCell.textContent = '—';
          actionCell.classList.add('status-action-placeholder');
        }

        row.appendChild(categoryCell);
        row.appendChild(dateCell);
        row.appendChild(jobCell);
        row.appendChild(actionCell);
        statusTableBody.appendChild(row);
      });

      if (statusResultsSummary) {
        const formatter = new Intl.NumberFormat('en-IN');
        const countText = `${formatter.format(records.length)} record${records.length === 1 ? '' : 's'}`;
        const jobText = jobBookingNumbers.size > 0
          ? `Job Booking${jobBookingNumbers.size > 1 ? 's' : ''}: ${Array.from(jobBookingNumbers).join(', ')}`
          : 'Job Booking not available';
        statusResultsSummary.textContent = barcodeText
          ? `${countText} found for barcode ${barcodeText} • ${jobText}`
          : `${countText} found • ${jobText}`;
      }
      scrollBarcodeStatusIntoView();
    }
  
    async function handleBarcodeStatusDelete(category, barcodeValue, triggerButton) {
      const canonicalCategory = getCanonicalStatusCategory(category);
      if (canonicalCategory !== 'gpn' && canonicalCategory !== 'delivery note') return;

      if (!session || !session.selectedDatabase || !session.userId) {
        alertWithSiren('Please login again before performing delete.');
        return;
      }

      const resolvedBarcodeStr = String(barcodeValue || '').trim();
      const resolvedBarcodeNum = Number(resolvedBarcodeStr);

      if (!resolvedBarcodeStr || !Number.isFinite(resolvedBarcodeNum)) {
        alertWithSiren('Unable to determine barcode for deletion.');
        return;
      }

      const confirmationMessage = canonicalCategory === 'delivery note'
        ? `Delete Delivery Note entry for barcode ${resolvedBarcodeStr}?`
        : `Delete GPN entry for barcode ${resolvedBarcodeStr}?`;

      if (!window.confirm(confirmationMessage)) {
        return;
      }

      setButtonLoading(triggerButton, true, 'Deleting...');

      try {
        const base = getApiBaseUrl();
        const endpoint = canonicalCategory === 'delivery note'
          ? 'grn/delete-delivery-note'
          : 'gpn/delete-finish-goods';
        const url = new URL(endpoint, base);
        const res = await fetch(url.toString(), {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({
            barcode: resolvedBarcodeNum,
            database: session.selectedDatabase,
            userId: session.userId,
            companyId: 2,
            branchId: 0
          })
        });

        if (!res.ok) {
          const t = await res.text().catch(() => '');
          throw new Error(t || 'Failed to delete record');
        }

        const data = await res.json().catch(() => ({}));
        if (!data || data.status !== true) {
          throw new Error(data?.error || 'Failed to delete record');
        }

        const friendlyCategory = canonicalCategory === 'delivery note' ? 'Delivery Note' : 'GPN';
        alert(`${friendlyCategory} entry deleted successfully. Refreshing status data...`);
        await runBarcodeStatusLookup(resolvedBarcodeNum);
      } catch (e) {
        alertWithSiren(String(e.message || e));
      } finally {
        setButtonLoading(triggerButton, false);
      }
    }

    // Load transporter options from backend
    async function loadTransporters() {
      try {
        if (!session || !session.selectedDatabase) return;
        if (transporterNameSelect) {
          transporterNameSelect.innerHTML = '<option value="">Loading...</option>';
        }
        const base = getApiBaseUrl();
        const url = new URL('grn/transporters', base);
        url.searchParams.set('database', session.selectedDatabase);
        const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' }, cache: 'no-store' });
        if (!res.ok) {
          if (transporterNameSelect) transporterNameSelect.innerHTML = '<option value="">Select Transporter</option>';
          return;
        }
        const data = await res.json();
        if (!data || data.status !== true || !Array.isArray(data.transporters)) {
          if (transporterNameSelect) transporterNameSelect.innerHTML = '<option value="">Select Transporter</option>';
          return;
        }
        if (transporterNameSelect) {
          transporterNameSelect.innerHTML = '<option value="">Select Transporter</option>' + data.transporters.map(t => `<option value="${t.ledgerName}">${t.ledgerName}</option>`).join('');
        }
      } catch (_) {
        if (transporterNameSelect) transporterNameSelect.innerHTML = '<option value="">Select Transporter</option>';
      }
    }
  
    async function clearDbCache() {
      try {
        const base = getApiBaseUrl();
        const clearUrl = new URL('admin/clear-db-cache', base);
        await fetch(clearUrl.toString(), {
          method: 'POST',
          headers: { 'Accept': 'application/json' },
          credentials: 'include'
        });
      } catch (e) {
        console.warn('Failed to clear DB cache:', e);
      }
    }
  
    async function backendLogout() {
      try {
        const base = getApiBaseUrl();
        const logoutUrl = new URL('auth/logout', base);
        await fetch(logoutUrl.toString(), {
          method: 'POST',
          headers: { 'Accept': 'application/json' },
          credentials: 'include',
          cache: 'no-store'
        });
        console.log('Backend session cleared');
      } catch (e) {
        console.warn('Failed to clear backend session:', e);
      }
    }
  
    async function login(username, database) {
      // Note: No cache clearing on login
      // Backend now handles pool health checks and auto-cleanup
      // Clearing cache here causes race conditions and connection errors
      
      const base = getApiBaseUrl();
      // Build relative to base (which ends with '/'), yielding '<base>/auth/login'
      const url = new URL('auth/login', base);
      const safeUsername = String(username || '').trim();
      const safeDatabase = String(database || '').trim().toUpperCase();
      url.searchParams.set('username', safeUsername);
      url.searchParams.set('database', safeDatabase);
      // Add timestamp to bust any caching
      url.searchParams.set('_t', Date.now().toString());
  
      console.log('Making login request to:', url.toString());
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        },
        credentials: 'include',
        cache: 'no-store'
      });
      console.log('Login response status:', res.status);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Request failed (${res.status}) URL: ${url.toString()}`);
      }
      const data = await res.json();
      console.log('Login response data:', data);
      if (!data || data.status !== true) {
        console.log('Login failed - data.status:', data?.status, 'data.error:', data?.error);
        throw new Error((data && data.error ? data.error : 'Login failed') + ` | URL: ${url.toString()}`);
      }
      console.log('Login successful, switching to post-login screen');
      return data;
    }
  
    function swapToPostLogin(data, username) {
      session = {
        userId: data.userId,
        ledgerId: data.ledgerId,
        machines: data.machines || [],
        selectedDatabase: data.selectedDatabase,
        username: username
      };
  
      // Save session to localStorage for persistence across tabs
      saveSession(session);
  
      if (infoUsername) infoUsername.textContent = username;
      if (infoDatabase) infoDatabase.textContent = data.selectedDatabase;
      if (infoUsernameGrm) infoUsernameGrm.textContent = username;
      if (infoDatabaseGrm) infoDatabaseGrm.textContent = data.selectedDatabase;
      if (infoUsernameGpn) infoUsernameGpn.textContent = username;
      if (infoDatabaseGpn) infoDatabaseGpn.textContent = data.selectedDatabase;
      if (infoUsernameStatus) infoUsernameStatus.textContent = username;
      if (infoDatabaseStatus) infoDatabaseStatus.textContent = data.selectedDatabase;
  
      resetBarcodeStatusView();
  
      navigateTo('landing', { replace: true });
      historyDepth = 0;
    }
  
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        showError('');
        const username = String(usernameInput.value || '').trim();
        const database = String(databaseSelect.value || '').trim();
        if (!username || !database) {
          showError('Please enter username and select database.');
          return;
        }
        
        // IMMEDIATELY clear and hide everything before starting login
        session = null;
        
        // Clear backend session to prevent database conflicts
        await backendLogout();
        
        // Force navigation back to login before attempting authentication
        navigateTo('login', { replace: true, force: true });
        historyDepth = 0;
        
        // Clear all info displays immediately
        if (infoUsername) infoUsername.textContent = '';
        if (infoDatabase) infoDatabase.textContent = '';
        if (infoUsernameGrm) infoUsernameGrm.textContent = '';
        if (infoDatabaseGrm) infoDatabaseGrm.textContent = '';
        if (infoUsernameGpn) infoUsernameGpn.textContent = '';
        if (infoDatabaseGpn) infoDatabaseGpn.textContent = '';
        if (infoUsernameStatus) infoUsernameStatus.textContent = '';
        if (infoDatabaseStatus) infoDatabaseStatus.textContent = '';
        
        // Clear barcode fields
        if (barcodeInput) barcodeInput.value = '';
        if (gpnBarcodeInput) gpnBarcodeInput.value = '';
        if (gpnConfBarcode) gpnConfBarcode.value = '';
        if (statusBarcodeInput) statusBarcodeInput.value = '';
        resetBarcodeStatusView();
        if (gpnError) gpnError.textContent = '';
        if (gpnTableBody) gpnTableBody.innerHTML = '';
        
        try {
          const data = await login(username, database);
          swapToPostLogin(data, username);
        } catch (err) {
          showError(err.message || 'Login failed');
        }
      });
    }
  
    if (initiateBtn) {
      initiateBtn.addEventListener('click', async () => {
        const barcode = String(barcodeInput.value || '').trim();
        if (!barcode) {
          alert('Please enter a Barcode Number.');
          barcodeInput.focus();
          return;
        }
        if (!session || !session.selectedDatabase) {
          alert('Please login first.');
          return;
        }
        setButtonLoading(initiateBtn, true, 'Initiating...');
        try {
          // Call backend to initiate challan
          const base = getApiBaseUrl();
          const url = new URL('grn/initiate', base);
          const res = await fetch(url.toString(), {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
              barcode: Number(barcode),
              database: session.selectedDatabase,
              userId: session.userId
            })
          });
          if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error(t || 'Failed to initiate challan');
          }
          const data = await res.json();
          if (!data || data.status !== true) {
            alertWithSiren(data?.error || 'Failed to initiate challan');
            return;
          }
          // Fill challan form
          if (clientNameInput) clientNameInput.value = data.ledgerName || '';
          // Store barcode in session for later use
          session.challanBarcode = Number(barcode);
          
          // Navigate to challan form view
          navigateTo('challan-form');
          await loadTransporters();
        } catch (e) {
          try {
            const parsed = JSON.parse(e.message);
            alertWithSiren(parsed.error || 'Failed to initiate challan');
          } catch(_) {
            alertWithSiren(String(e.message || e));
          }
        } finally {
          setButtonLoading(initiateBtn, false);
        }
      });
    }
  
    // Save delivery note
    if (saveChallanBtn) {
      saveChallanBtn.addEventListener('click', async () => {
        if (!session || !session.selectedDatabase) {
          alert('Please login first.');
          return;
        }
  
        const clientName = String(clientNameInput?.value || '').trim();
        const modeOfTransport = String(modeOfTransportSelect?.value || '').trim();
        const containerNumber = String(containerNumberInput?.value || '').trim();
        const sealNumber = String(sealNumberInput?.value || '').trim();
        const transporterName = String(transporterNameSelect?.value || '').trim();
        const vehicleNumber = String(vehicleNumberInput?.value || '').trim();
        // Find ledgerId for selected transporter name from current dropdown options using dataset if available later
        let transporterLedgerId = null;

        setButtonLoading(saveChallanBtn, true, 'Saving...');
        try {
          // Attempt to fetch ledgerId list fresh to resolve selected name
          const base = getApiBaseUrl();
          const urlT = new URL('grn/transporters', base);
          urlT.searchParams.set('database', session.selectedDatabase);
          const resT = await fetch(urlT.toString(), { headers: { 'Accept': 'application/json' }, cache: 'no-store' });
          const dataT = await resT.json();
          if (dataT && dataT.status === true && Array.isArray(dataT.transporters)) {
            const match = dataT.transporters.find(t => String(t.ledgerName).trim() === transporterName);
            transporterLedgerId = match ? match.ledgerId : null;
          }
        } catch (_) {
          // ignore transporters fetch failure; button state will reset below
        }

        if (!transporterLedgerId) {
          alert('Could not resolve selected transporter. Please re-select transporter.');
          setButtonLoading(saveChallanBtn, false);
          return;
        }

        // Validate required fields
        if (!clientName || !modeOfTransport || !containerNumber || !sealNumber || !transporterName || !vehicleNumber) {
          alert('All fields are mandatory. Please fill in all required information.');
          setButtonLoading(saveChallanBtn, false);
          return;
        }

        try {
          const base = getApiBaseUrl();
          const url = new URL('grn/save-delivery-note', base);
          const res = await fetch(url.toString(), {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
              barcode: session.challanBarcode,
              database: session.selectedDatabase,
              userId: session.userId,
              clientName,
              modeOfTransport,
              containerNumber,
              sealNumber,
              transporterName,
              transporterLedgerId,
              vehicleNumber
            })
          });
  
          if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error(t || 'Failed to save delivery note');
          }
  
          const data = await res.json();
          if (!data || data.status !== true) {
            // Show specific message if provided by backend
            alertWithSiren(data?.error || 'Failed to save delivery note');
            return;
          }
  
          // Show confirmation page
          if (dnNumberSpan) dnNumberSpan.textContent = data.deliveryNoteNumber;
          if (confClientName) confClientName.value = data.data.clientName;
          if (confModeTransport) confModeTransport.value = data.data.modeOfTransport;
          if (confTransporter) confTransporter.value = data.data.transporterName;
          if (confContainer) confContainer.value = data.data.containerNumber;
          if (confVehicle) confVehicle.value = data.data.vehicleNumber;
          if (confSeal) confSeal.value = data.data.sealNumber;
          // Don't prefill barcode - leave it empty for user input
  
          if (deliveryDetailsPanel) deliveryDetailsPanel.classList.remove('collapsed');
          if (deliveryDetailsToggle) {
            deliveryDetailsToggle.textContent = '−';
            deliveryDetailsToggle.setAttribute('aria-expanded', 'true');
            deliveryDetailsToggle.setAttribute('aria-label', 'Collapse delivery details');
          }
  
          navigateTo('delivery-confirmation');
  
          // Add first row to table from SP output and form values
          if (deliveryTableBody) {
            const sp = data.sp || {};
            const row = document.createElement('tr');
            row.innerHTML = `
              <td>${data?.data?.barcode ?? session?.challanBarcode ?? ''}</td>
              <td>${sp.cartonCount ?? '—'}</td>
              <td>${sp.jobName ?? '—'}</td>
              <td>${sp.orderQty ?? '—'}</td>
              <td>${sp.gpnQty ?? '—'}</td>
              <td>${sp.deliveredThisVoucher ?? '—'}</td>
              <td>${sp.deliveredTotal ?? '—'}</td>
            `;
            deliveryTableBody.innerHTML = '';
            deliveryTableBody.appendChild(row);
            // Remember FGTransactionID for updates
            if (sp && sp.transactionId) {
              window.__lastFgTransactionId = sp.transactionId;
            }
          }
        } catch (e) {
          alertWithSiren(String(e.message || e));
        } finally {
          setButtonLoading(saveChallanBtn, false);
        }
      });
    }
  
    // Update delivery note
    async function runUpdateDeliveryNote() {
      try {
            if (!session || !session.selectedDatabase || !session.userId) {
              alert('Please login first.');
              return;
            }
            const barcodeVal = String(confBarcode?.value || '').trim();
            if (!barcodeVal) { alert('Enter barcode number'); if (confBarcode) confBarcode.focus(); return; }
  
            // Use last FGTransactionID if available from the previous save
            const fgId = window.__lastFgTransactionId;
            if (!fgId) { alert('Missing FGTransactionID from initial save. Please save the delivery note first.'); return; }
  
            setButtonLoading(updateDeliveryNoteBtn, true, 'Updating...');
            const base = getApiBaseUrl();
            const url = new URL('grn/update-delivery-note', base);
            const res = await fetch(url.toString(), {
              method: 'POST',
              headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
              },
              credentials: 'include',
              body: JSON.stringify({
                barcode: Number(barcodeVal),
                database: session.selectedDatabase,
                userId: session.userId,
                fgTransactionId: fgId
              })
            });
            if (!res.ok) {
              const t = await res.text().catch(() => '');
              throw new Error(t || 'Failed to update delivery note');
            }
            const data = await res.json();
            if (!data || data.status !== true) { alertWithSiren(data?.error || 'Failed to update delivery note'); return; }
            const sp = data.sp || {};
  
            if (deliveryTableBody) {
              const newRow = document.createElement('tr');
              newRow.innerHTML = `
                <td>${barcodeVal}</td>
                <td>${sp.cartonCount ?? '—'}</td>
                <td>${sp.jobName ?? '—'}</td>
                <td>${sp.orderQty ?? '—'}</td>
                <td>${sp.gpnQty ?? '—'}</td>
                <td>${sp.deliveredThisVoucher ?? '—'}</td>
                <td>${sp.deliveredTotal ?? '—'}</td>
              `;
              deliveryTableBody.insertBefore(newRow, deliveryTableBody.firstChild);
            }
  
            if (confBarcode) confBarcode.value = '';
            if (confBarcode) confBarcode.focus();
      } catch (e) {
        alertWithSiren(String(e.message || e));
      } finally {
        setButtonLoading(updateDeliveryNoteBtn, false);
      }
    }
  
    if (updateDeliveryNoteBtn) {
      updateDeliveryNoteBtn.addEventListener('click', () => { runUpdateDeliveryNote(); });
    }
  
    if (confBarcode) {
      confBarcode.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          runUpdateDeliveryNote();
        }
      });
    }
  
    // Initialize table with 10 empty rows
    function initializeTable() {
      if (deliveryTableBody) {
        deliveryTableBody.innerHTML = '';
        for (let i = 0; i < 10; i++) {
          const row = document.createElement('tr');
          row.innerHTML = `
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
          `;
          deliveryTableBody.appendChild(row);
        }
      }
    }
  
    // Initialize table on page load
    initializeTable();
  
    // Portal navigation handlers
    if (portalGrm) {
      portalGrm.addEventListener('click', () => {
        navigateTo('post-login');
      });
    }
  
    if (portalGpn) {
      portalGpn.addEventListener('click', () => {
        navigateTo('gpn');
      });
    }
  
    if (portalBarcodeStatus) {
      portalBarcodeStatus.addEventListener('click', () => {
        resetBarcodeStatusView();
        navigateTo('barcode-status');
      });
    }
  
    // GPN Submit handler
    if (submitGpnBtn) {
      submitGpnBtn.addEventListener('click', async () => {
        const barcode = String(gpnBarcodeInput?.value || '').trim();
        if (!barcode) {
          if (gpnError) gpnError.textContent = 'Please enter a Barcode Number.';
          if (gpnBarcodeInput) gpnBarcodeInput.focus();
          return;
        }
        if (!session || !session.selectedDatabase) {
          if (gpnError) gpnError.textContent = 'Please login first.';
          return;
        }
  
        if (gpnError) gpnError.textContent = '';
        setButtonLoading(submitGpnBtn, true, 'Submitting...');
  
        try {
          const base = getApiBaseUrl();
          const url = new URL('gpn/save-finish-goods', base);
          const res = await fetch(url.toString(), {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
              barcode: Number(barcode),
              database: session.selectedDatabase,
              userId: session.userId,
              companyId: 2,
              branchId: 0,
              status: 'new'
            })
          });
  
          if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error(t || 'Failed to submit barcode');
          }
  
          const data = await res.json();
          if (!data || data.status !== true) {
            alertWithSiren(data?.error || 'Failed to submit barcode');
            return;
          }
  
          // Extract FGTransactionID from response
          const responseData = data.data || {};
          const fgTransactionId = responseData.FGTransactionID || responseData.fgtransactionid || responseData.FGTransactionId || null;
  
          if (!fgTransactionId) {
            alertWithSiren('Success but no FGTransactionID returned. Cannot proceed to confirmation screen.');
            return;
          }
  
          // Store FGTransactionID for updates
          session.gpnFgTransactionId = fgTransactionId;
          window.__gpnFgTransactionId = fgTransactionId;
  
          // Populate first row in table
          if (gpnTableBody) {
            const firstRow = document.createElement('tr');
            const orderQty = responseData.OrderQty || responseData.orderqty || 0;
            const packedQtyThisVoucher = responseData.PackedQtyThisVoucher || responseData.packedqtythisvoucher || responseData.PackagedQtyThisVoucher || 0;
            const packedQtyTotal = responseData.PackedQtyTotal || responseData.packedqtytotal || responseData.PackagedQtyTotal || 0;
            const cartonQtyThisVoucher = responseData.CartonQtyThisVoucher || responseData.cartonqtythisvoucher || responseData.CartonQty || 0;
            const cartonQtyTotal = responseData.CartonQtyTotal || responseData.cartonqtytotal || responseData.CartonQtyTotal || 0;
            const jobName = responseData.JobName || responseData.jobname || '—';
            const jobBookingNo = responseData.JobBookingNo || responseData.jobbookingno || responseData.JobBookingNumber || '—';
            
            firstRow.innerHTML = `
              <td>${barcode}</td>
              <td>${cartonQtyThisVoucher}</td>
              <td>${packedQtyThisVoucher}</td>
              <td>${orderQty}</td>
              <td>${cartonQtyTotal}</td>
              <td>${packedQtyTotal}</td>
              <td>${jobBookingNo}</td>
              <td>${jobName}</td>
            `;
            gpnTableBody.innerHTML = '';
            gpnTableBody.appendChild(firstRow);
          }
  
        // Navigate to confirmation screen
        navigateTo('gpn-confirmation');
        } catch (e) {
          try {
            const parsed = JSON.parse(e.message);
            alertWithSiren(parsed.error || 'Failed to submit barcode');
            if (gpnError) gpnError.textContent = parsed.error || 'Failed to submit barcode';
          } catch(_) {
            const errorMsg = String(e.message || e);
            alertWithSiren(errorMsg);
            if (gpnError) gpnError.textContent = errorMsg;
          }
        } finally {
          setButtonLoading(submitGpnBtn, false);
        }
      });
    }
  
    // GPN Barcode Enter key handler
    if (gpnBarcodeInput) {
      gpnBarcodeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && submitGpnBtn) {
          e.preventDefault();
          submitGpnBtn.click();
        }
      });
    }
  
    // GPN Update Entry handler
    async function runUpdateGpn() {
      try {
        if (!session || !session.selectedDatabase || !session.userId) {
          alert('Please login first.');
          return;
        }
  
        const barcodeVal = String(gpnConfBarcode?.value || '').trim();
        if (!barcodeVal) {
          alert('Enter barcode number');
          if (gpnConfBarcode) gpnConfBarcode.focus();
          return;
        }
  
        // Use stored FGTransactionID from initial submission
        const fgId = session.gpnFgTransactionId || window.__gpnFgTransactionId;
        if (!fgId) {
          alert('Missing FGTransactionID from initial save. Please submit a new barcode first.');
          return;
        }
  
        setButtonLoading(updateGpnBtn, true, 'Updating...');
        const base = getApiBaseUrl();
        const url = new URL('gpn/save-finish-goods', base);
        const res = await fetch(url.toString(), {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({
            barcode: Number(barcodeVal),
            database: session.selectedDatabase,
            userId: session.userId,
            companyId: 2,
            branchId: 0,
            status: 'update',
            fgTransactionId: fgId
          })
        });
  
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          throw new Error(t || 'Failed to update entry');
        }
  
        const data = await res.json();
        if (!data || data.status !== true) {
          alertWithSiren(data?.error || 'Failed to update entry');
          return;
        }
  
        const responseData = data.data || {};
        const updatedFgTransactionId = responseData.FGTransactionID || responseData.fgtransactionid || responseData.FGTransactionId || null;
        if (updatedFgTransactionId) {
          session.gpnFgTransactionId = updatedFgTransactionId;
          window.__gpnFgTransactionId = updatedFgTransactionId;
        }
        const orderQty = responseData.OrderQty || responseData.orderqty || 0;
        const packedQtyThisVoucher = responseData.PackedQtyThisVoucher || responseData.packedqtythisvoucher || responseData.PackagedQtyThisVoucher || 0;
        const packedQtyTotal = responseData.PackedQtyTotal || responseData.packedqtytotal || responseData.PackagedQtyTotal || 0;
        const cartonQtyThisVoucher = responseData.CartonQtyThisVoucher || responseData.cartonqtythisvoucher || responseData.CartonQty || 0;
        const cartonQtyTotal = responseData.CartonQtyTotal || responseData.cartonqtytotal || responseData.CartonQtyTotal || 0;
        const jobName = responseData.JobName || responseData.jobname || '—';
        const jobBookingNo = responseData.JobBookingNo || responseData.jobbookingno || responseData.JobBookingNumber || '—';
  
        // Add new row to table (always at the top, newest first)
        if (gpnTableBody) {
          const newRow = document.createElement('tr');
          newRow.innerHTML = `
            <td>${barcodeVal}</td>
            <td>${cartonQtyThisVoucher}</td>
            <td>${packedQtyThisVoucher}</td>
            <td>${orderQty}</td>
            <td>${cartonQtyTotal}</td>
            <td>${packedQtyTotal}</td>
            <td>${jobBookingNo}</td>
            <td>${jobName}</td>
          `;
          // Insert at the top (prepend) - newest entries always at top
          gpnTableBody.insertBefore(newRow, gpnTableBody.firstChild);
        }
  
        if (gpnConfBarcode) {
          gpnConfBarcode.value = '';
          gpnConfBarcode.focus();
        }
      } catch (e) {
        alertWithSiren(String(e.message || e));
      } finally {
        setButtonLoading(updateGpnBtn, false);
      }
    }
  
    if (updateGpnBtn) {
      updateGpnBtn.addEventListener('click', () => { runUpdateGpn(); });
    }
  
    // GPN Confirmation Barcode Enter key handler
    if (gpnConfBarcode) {
      gpnConfBarcode.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && updateGpnBtn) {
          e.preventDefault();
          runUpdateGpn();
        }
      });
    }
  
    // Back button handlers
    if (backToLandingBtn) {
      backToLandingBtn.addEventListener('click', () => {
        handleBackNavigation('landing');
      });
    }
  
    if (backToLandingGpnBtn) {
      backToLandingGpnBtn.addEventListener('click', () => {
        handleBackNavigation('landing');
      });
    }
  
    if (backToLandingStatusBtn) {
      backToLandingStatusBtn.addEventListener('click', () => {
        handleBackNavigation('landing');
      });
    }
  
    if (backToGpnFormBtn) {
      backToGpnFormBtn.addEventListener('click', () => {
        handleBackNavigation('gpn');
      });
    }
  
    if (backToInitiateBtn) {
      backToInitiateBtn.addEventListener('click', () => {
        handleBackNavigation('post-login');
      });
    }
  
    if (backToFormBtn) {
      backToFormBtn.addEventListener('click', () => {
        handleBackNavigation('challan-form');
      });
    }

    if (deliveryDetailsToggle && deliveryDetailsPanel) {
      deliveryDetailsToggle.addEventListener('click', () => {
        const isCollapsed = deliveryDetailsPanel.classList.toggle('collapsed');
        deliveryDetailsToggle.textContent = isCollapsed ? '+' : '−';
        deliveryDetailsToggle.setAttribute('aria-expanded', (!isCollapsed).toString());
        deliveryDetailsToggle.setAttribute('aria-label', isCollapsed ? 'Expand delivery details' : 'Collapse delivery details');
      });
    }

    if (searchBarcodeStatusBtn) {
      searchBarcodeStatusBtn.addEventListener('click', () => { runBarcodeStatusLookup(); });
    }
  
    if (statusBarcodeInput) {
      statusBarcodeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          runBarcodeStatusLookup();
        }
      });
    }
  
    // Restore session on page load
    function restoreSession() {
      const savedSession = loadSession();
      if (savedSession && savedSession.username && savedSession.selectedDatabase) {
        console.log('Restoring session for user:', savedSession.username);
        session = savedSession;
        
        // Update UI to show logged in state
        if (infoUsername) infoUsername.textContent = savedSession.username;
        if (infoDatabase) infoDatabase.textContent = savedSession.selectedDatabase;
        if (infoUsernameGrm) infoUsernameGrm.textContent = savedSession.username;
        if (infoDatabaseGrm) infoDatabaseGrm.textContent = savedSession.selectedDatabase;
        if (infoUsernameGpn) infoUsernameGpn.textContent = savedSession.username;
        if (infoDatabaseGpn) infoDatabaseGpn.textContent = savedSession.selectedDatabase;
        if (infoUsernameStatus) infoUsernameStatus.textContent = savedSession.username;
        if (infoDatabaseStatus) infoDatabaseStatus.textContent = savedSession.selectedDatabase;
        
        // Show landing page
        navigateTo('landing', { replace: true, force: true });
        historyDepth = 0;
        
        return true;
      }
      resetBarcodeStatusView();
      return false;
    }
    
    // Cross-tab session synchronization
    window.addEventListener('storage', (event) => {
      // Listen for changes to session storage
      if (event.key === SESSION_KEY) {
        if (event.newValue === null) {
          // Session was cleared (logout in another tab)
          console.log('Session cleared in another tab, logging out...');
          performLogout(false); // Don't clear storage again, it's already cleared
        } else if (event.oldValue !== null) {
          // Session was updated (new login in another tab)
          const newSession = JSON.parse(event.newValue);
          const currentSessionId = getSessionId();
          const newSessionId = localStorage.getItem(SESSION_ID_KEY);
          
          // If session ID changed, it means user logged in from another tab
          if (currentSessionId && newSessionId && currentSessionId !== newSessionId) {
            console.log('New login detected in another tab, logging out current session...');
            // Clear local state and show login without triggering storage event
            session = null;
            
            // Clear all fields
            if (usernameInput) usernameInput.value = '';
            if (databaseSelect) databaseSelect.value = '';
            if (barcodeInput) barcodeInput.value = '';
            if (gpnBarcodeInput) gpnBarcodeInput.value = '';
            if (gpnConfBarcode) gpnConfBarcode.value = '';
            
            // Clear info displays
            if (infoUsername) infoUsername.textContent = '';
            if (infoDatabase) infoDatabase.textContent = '';
            if (infoUsernameGrm) infoUsernameGrm.textContent = '';
            if (infoDatabaseGrm) infoDatabaseGrm.textContent = '';
            if (infoUsernameGpn) infoUsernameGpn.textContent = '';
            if (infoDatabaseGpn) infoDatabaseGpn.textContent = '';
            
            // Reset UI to login screen
            navigateTo('login', { replace: true, force: true });
            historyDepth = 0;
            
            alert('You have been logged out because a new login was detected in another tab.');
          }
        }
      }
    });
    
    // Attempt to restore session on page load
    restoreSession();
  
    // Logout function that can be called with or without clearing storage
    async function performLogout(clearStorage = true) {
      // Clear backend session (cookies) FIRST - this is critical!
      await backendLogout();
      
      // Clear in-memory session
      session = null;
      
      // Clear localStorage if requested (don't clear if triggered by storage event)
      if (clearStorage) {
        clearSession();
      }
      
      // Reset form fields to prevent database selection issues
      if (usernameInput) usernameInput.value = '';
      if (databaseSelect) databaseSelect.value = '';
      if (barcodeInput) barcodeInput.value = '';
      if (gpnBarcodeInput) gpnBarcodeInput.value = '';
      if (gpnConfBarcode) gpnConfBarcode.value = '';
      
      // Clear info displays immediately
      if (infoUsername) infoUsername.textContent = '';
      if (infoDatabase) infoDatabase.textContent = '';
      if (infoUsernameGrm) infoUsernameGrm.textContent = '';
      if (infoDatabaseGrm) infoDatabaseGrm.textContent = '';
      if (infoUsernameGpn) infoUsernameGpn.textContent = '';
      if (infoDatabaseGpn) infoDatabaseGpn.textContent = '';
      if (infoUsernameStatus) infoUsernameStatus.textContent = '';
      if (infoDatabaseStatus) infoDatabaseStatus.textContent = '';
      
      if (deliveryDetailsPanel) deliveryDetailsPanel.classList.remove('collapsed');
      if (deliveryDetailsToggle) {
        deliveryDetailsToggle.textContent = '−';
        deliveryDetailsToggle.setAttribute('aria-expanded', 'true');
        deliveryDetailsToggle.setAttribute('aria-label', 'Collapse delivery details');
      }
      
      // Reset UI to login screen
      navigateTo('login', { replace: true, force: true });
      historyDepth = 0;
      if (usernameInput) usernameInput.focus();
      resetBarcodeStatusView();
    }
    
    // Logout - Clear in-memory session AND backend session
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        await performLogout(true);
      });
    }
  
    // Optional: expose a quick toggle to local API for dev via console
    window.GRN_API = {
      get base() { return getApiBaseUrl(); },
      setBase(url) { try { localStorage.setItem('grn_api_base', url); } catch(_) {} },
      useLocal() { try { localStorage.setItem('grn_api_base', LOCAL_API_BASE); } catch(_) {} },
      useProd() { try { localStorage.setItem('grn_api_base', DEFAULT_API_BASE); } catch(_) {} },
    };
  })();
  
  