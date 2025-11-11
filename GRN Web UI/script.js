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
  
    // Barcode Status Lookup
    async function runBarcodeStatusLookup() {
      try {
        if (!session || !session.selectedDatabase || !session.userId) {
          if (statusError) statusError.textContent = 'Please login first.';
          return;
        }
  
        const barcodeVal = String(statusBarcodeInput?.value || '').trim();
        if (!barcodeVal) {
          if (statusError) statusError.textContent = 'Enter barcode number';
          if (statusBarcodeInput) statusBarcodeInput.focus();
          return;
        }
  
        const barcodeNum = Number(barcodeVal);
        if (!Number.isFinite(barcodeNum)) {
          if (statusError) statusError.textContent = 'Barcode must be a valid number';
          if (statusBarcodeInput) statusBarcodeInput.focus();
          return;
        }
  
        if (statusError) statusError.textContent = '';
        if (statusResults) statusResults.hidden = false;
        if (statusResultsTitle) statusResultsTitle.textContent = `Status Timeline for Barcode ${barcodeNum}`;
        if (statusResultsSummary) statusResultsSummary.textContent = 'Checking barcode status...';
        if (statusTableBody) {
          statusTableBody.innerHTML = `
            <tr class="empty-row">
              <td colspan="3" class="empty-message">Fetching status history...</td>
            </tr>
          `;
        }
        if (searchBarcodeStatusBtn) {
          searchBarcodeStatusBtn.disabled = true;
          searchBarcodeStatusBtn.dataset.originalText = searchBarcodeStatusBtn.textContent;
          searchBarcodeStatusBtn.textContent = 'Searching...';
        }
  
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
        if (searchBarcodeStatusBtn) {
          searchBarcodeStatusBtn.disabled = false;
          if (searchBarcodeStatusBtn.dataset.originalText) {
            searchBarcodeStatusBtn.textContent = searchBarcodeStatusBtn.dataset.originalText;
            delete searchBarcodeStatusBtn.dataset.originalText;
          } else {
            searchBarcodeStatusBtn.textContent = 'Search Barcode Status';
          }
        }
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
    const statusBarcodeInput = document.getElementById('status-barcode');
    const searchBarcodeStatusBtn = document.getElementById('btn-search-barcode-status');
    const statusError = document.getElementById('status-error');
    const statusTableBody = document.getElementById('status-table-body');
    const backToInitiateBtn = document.getElementById('btn-back-to-initiate');
    const backToFormBtn = document.getElementById('btn-back-to-form');
  
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
            <td colspan="3" class="empty-message">Enter a barcode to view status history.</td>
          </tr>
        `;
      }
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
            <td colspan="3" class="empty-message">No records found${barcodeText ? ` for barcode ${barcodeText}` : ''}.</td>
          </tr>
        `;
        if (statusResultsSummary) {
          statusResultsSummary.textContent = barcodeText
            ? `No history available for barcode ${barcodeText}.`
            : 'No history available for the provided barcode.';
        }
        return;
      }

      const jobBookingNumbers = new Set();
      statusTableBody.innerHTML = '';
      records.forEach(record => {
        const category = record.Category ?? record.category ?? '—';
        const eventDate = record.EventDate ?? record.eventDate ?? record.event_date ?? record.datetime ?? record.CreatedDate ?? '—';
        const jobBookingNo = record.JobBookingNo ?? record.jobBookingNo ?? record.jobbookingno ?? '—';
        if (jobBookingNo) jobBookingNumbers.add(jobBookingNo);

        const normalizedCategory = String(category || '').toLowerCase().trim();
        const badgeClass = STATUS_CATEGORY_CLASS_MAP[normalizedCategory] || 'status-badge-default';

        const row = document.createElement('tr');
        row.innerHTML = `
          <td><span class="status-badge ${badgeClass}">${category}</span></td>
          <td>${formatTimestamp(eventDate)}</td>
          <td>${jobBookingNo}</td>
        `;
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
  
      if (loginSection) loginSection.classList.add('hidden');
      if (landingSection) landingSection.classList.remove('hidden');
      if (logoutBtn) logoutBtn.classList.remove('hidden');
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
        
        // Force all screens to be hidden except login
        if (landingSection) landingSection.classList.add('hidden');
        if (postLoginSection) postLoginSection.classList.add('hidden');
        if (challanFormSection) challanFormSection.classList.add('hidden');
        if (deliveryNoteConfirmation) deliveryNoteConfirmation.classList.add('hidden');
        if (gpnSection) gpnSection.classList.add('hidden');
        if (gpnConfirmation) gpnConfirmation.classList.add('hidden');
        if (loginSection) loginSection.classList.remove('hidden');
        
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
          if (postLoginSection) postLoginSection.classList.add('hidden');
          if (challanFormSection) challanFormSection.classList.remove('hidden');
          await loadTransporters();
        } catch (e) {
          try {
            const parsed = JSON.parse(e.message);
            alertWithSiren(parsed.error || 'Failed to initiate challan');
          } catch(_) {
            alertWithSiren(String(e.message || e));
          }
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
        } catch (_) {}
  
        if (!transporterLedgerId) {
          alert('Could not resolve selected transporter. Please re-select transporter.');
          return;
        }
  
        // Validate required fields
        if (!clientName || !modeOfTransport || !containerNumber || !sealNumber || !transporterName || !vehicleNumber) {
          alert('All fields are mandatory. Please fill in all required information.');
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
  
          if (challanFormSection) challanFormSection.classList.add('hidden');
          if (deliveryNoteConfirmation) deliveryNoteConfirmation.classList.remove('hidden');
  
          // Add first row to table from SP output and form values
          if (deliveryTableBody) {
            const sp = data.sp || {};
            const row = document.createElement('tr');
            row.innerHTML = `
              <td>${data?.data?.barcode ?? session?.challanBarcode ?? ''}</td>
              <td>${sp.jobName ?? '—'}</td>
              <td>${sp.orderQty ?? '—'}</td>
              <td>${sp.gpnQty ?? '—'}</td>
              <td>${sp.deliveredThisVoucher ?? '—'}</td>
              <td>${sp.deliveredTotal ?? '—'}</td>
              <td>${sp.cartonCount ?? '—'}</td>
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
                <td>${sp.jobName ?? '—'}</td>
                <td>${sp.orderQty ?? '—'}</td>
                <td>${sp.gpnQty ?? '—'}</td>
              <td>${sp.deliveredThisVoucher ?? '—'}</td>
                <td>${sp.deliveredTotal ?? '—'}</td>
                <td>${sp.cartonCount ?? '—'}</td>
              `;
              deliveryTableBody.insertBefore(newRow, deliveryTableBody.firstChild);
            }
  
            if (confBarcode) confBarcode.value = '';
            if (confBarcode) confBarcode.focus();
      } catch (e) {
        alertWithSiren(String(e.message || e));
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
        if (landingSection) landingSection.classList.add('hidden');
        if (postLoginSection) postLoginSection.classList.remove('hidden');
        if (barcodeInput) barcodeInput.focus();
      });
    }
  
    if (portalGpn) {
      portalGpn.addEventListener('click', () => {
        if (landingSection) landingSection.classList.add('hidden');
        if (gpnSection) gpnSection.classList.remove('hidden');
        if (gpnBarcodeInput) gpnBarcodeInput.focus();
      });
    }
  
    if (portalBarcodeStatus) {
      portalBarcodeStatus.addEventListener('click', () => {
        if (landingSection) landingSection.classList.add('hidden');
        if (barcodeStatusSection) barcodeStatusSection.classList.remove('hidden');
        resetBarcodeStatusView();
        if (statusBarcodeInput) statusBarcodeInput.focus();
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
        submitGpnBtn.disabled = true;
        submitGpnBtn.textContent = 'Submitting...';
  
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
            const voucherNo = responseData.VoucherNo || responseData.voucherno || responseData.VoucherNumber || '—';
            const orderQty = responseData.OrderQty || responseData.orderqty || 0;
            const packedQtyThisVoucher = responseData.PackedQtyThisVoucher || responseData.packedqtythisvoucher || responseData.PackagedQtyThisVoucher || 0;
            const packedQtyTotal = responseData.PackedQtyTotal || responseData.packedqtytotal || responseData.PackagedQtyTotal || 0;
            const cartonQtyTotal = responseData.CartonQtyTotal || responseData.cartonqtytotal || responseData.CartonQty || 0;
            const jobName = responseData.JobName || responseData.jobname || '—';
            const jobBookingNo = responseData.JobBookingNo || responseData.jobbookingno || responseData.JobBookingNumber || '—';
            
            firstRow.innerHTML = `
              <td>${barcode}</td>
              <td>${voucherNo}</td>
              <td>${orderQty}</td>
              <td>${packedQtyThisVoucher}</td>
              <td>${packedQtyTotal}</td>
              <td>${cartonQtyTotal}</td>
              <td>${jobName}</td>
              <td>${jobBookingNo}</td>
            `;
            gpnTableBody.innerHTML = '';
            gpnTableBody.appendChild(firstRow);
          }
  
          // Navigate to confirmation screen
          if (gpnSection) gpnSection.classList.add('hidden');
          if (gpnConfirmation) gpnConfirmation.classList.remove('hidden');
          if (gpnConfBarcode) gpnConfBarcode.focus();
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
          submitGpnBtn.disabled = false;
          submitGpnBtn.textContent = 'Submit';
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
        const voucherNo = responseData.VoucherNo || responseData.voucherno || responseData.VoucherNumber || '—';
        const orderQty = responseData.OrderQty || responseData.orderqty || 0;
        const packedQtyThisVoucher = responseData.PackedQtyThisVoucher || responseData.packedqtythisvoucher || responseData.PackagedQtyThisVoucher || 0;
        const packedQtyTotal = responseData.PackedQtyTotal || responseData.packedqtytotal || responseData.PackagedQtyTotal || 0;
        const cartonQtyTotal = responseData.CartonQtyTotal || responseData.cartonqtytotal || responseData.CartonQty || 0;
        const jobName = responseData.JobName || responseData.jobname || '—';
        const jobBookingNo = responseData.JobBookingNo || responseData.jobbookingno || responseData.JobBookingNumber || '—';
  
        // Add new row to table (always at the top, newest first)
        if (gpnTableBody) {
          const newRow = document.createElement('tr');
          newRow.innerHTML = `
            <td>${barcodeVal}</td>
            <td>${voucherNo}</td>
            <td>${orderQty}</td>
            <td>${packedQtyThisVoucher}</td>
            <td>${packedQtyTotal}</td>
            <td>${cartonQtyTotal}</td>
            <td>${jobName}</td>
            <td>${jobBookingNo}</td>
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
        if (postLoginSection) postLoginSection.classList.add('hidden');
        if (challanFormSection) challanFormSection.classList.add('hidden');
        if (landingSection) landingSection.classList.remove('hidden');
      });
    }
  
    if (backToLandingGpnBtn) {
      backToLandingGpnBtn.addEventListener('click', () => {
        if (gpnSection) gpnSection.classList.add('hidden');
        if (landingSection) landingSection.classList.remove('hidden');
      });
    }
  
    if (backToLandingStatusBtn) {
      backToLandingStatusBtn.addEventListener('click', () => {
        if (barcodeStatusSection) barcodeStatusSection.classList.add('hidden');
        if (landingSection) landingSection.classList.remove('hidden');
      });
    }
  
    if (backToGpnFormBtn) {
      backToGpnFormBtn.addEventListener('click', () => {
        if (gpnConfirmation) gpnConfirmation.classList.add('hidden');
        if (gpnSection) gpnSection.classList.remove('hidden');
      });
    }
  
    if (backToInitiateBtn) {
      backToInitiateBtn.addEventListener('click', () => {
        if (challanFormSection) challanFormSection.classList.add('hidden');
        if (postLoginSection) postLoginSection.classList.remove('hidden');
      });
    }
  
    if (backToFormBtn) {
      backToFormBtn.addEventListener('click', () => {
        if (deliveryNoteConfirmation) deliveryNoteConfirmation.classList.add('hidden');
        if (challanFormSection) challanFormSection.classList.remove('hidden');
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
        if (loginSection) loginSection.classList.add('hidden');
        if (landingSection) landingSection.classList.remove('hidden');
        if (logoutBtn) logoutBtn.classList.remove('hidden');
        
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
            if (landingSection) landingSection.classList.add('hidden');
            if (postLoginSection) postLoginSection.classList.add('hidden');
            if (challanFormSection) challanFormSection.classList.add('hidden');
            if (deliveryNoteConfirmation) deliveryNoteConfirmation.classList.add('hidden');
            if (gpnSection) gpnSection.classList.add('hidden');
            if (gpnConfirmation) gpnConfirmation.classList.add('hidden');
            if (loginSection) loginSection.classList.remove('hidden');
            if (logoutBtn) logoutBtn.classList.add('hidden');
            
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
      
      // Reset UI to login screen
      if (landingSection) landingSection.classList.add('hidden');
      if (postLoginSection) postLoginSection.classList.add('hidden');
      if (challanFormSection) challanFormSection.classList.add('hidden');
      if (deliveryNoteConfirmation) deliveryNoteConfirmation.classList.add('hidden');
      if (gpnSection) gpnSection.classList.add('hidden');
      if (gpnConfirmation) gpnConfirmation.classList.add('hidden');
      if (barcodeStatusSection) barcodeStatusSection.classList.add('hidden');
      if (loginSection) loginSection.classList.remove('hidden');
      if (logoutBtn) logoutBtn.classList.add('hidden');
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
  
  