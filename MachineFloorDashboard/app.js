(() => {
    const config = window.AppConfig || {};

    const selectors = {
        dashboard: document.getElementById('dashboard'),
        noMachineSelected: document.getElementById('noMachineSelected'),
        statusMessage: document.getElementById('statusMessage'),
        machineHeader: document.getElementById('machineHeader'),
        machineCard: document.getElementById('machineCard'),
        machineName: document.getElementById('machineName'),
        idleLayout: document.getElementById('idleLayout'),
        runningLayout: document.getElementById('runningLayout'),
        idleStatusText: document.getElementById('idleStatusText'),
        lastJobCompleted: document.getElementById('lastJobCompleted'),
        idleDuration: document.getElementById('idleDuration'),
        backlogMachine: document.getElementById('backlogMachine'),
        backlogProcess: document.getElementById('backlogProcess'),
        currentJob: document.getElementById('currentJob'),
        startTime: document.getElementById('startTime'),
        runningDuration: document.getElementById('runningDuration'),
        targetFinishIn: document.getElementById('targetFinishIn'),
        eta: document.getElementById('eta'),
        runningStatusText: document.getElementById('runningStatusText'),
        progressText: document.getElementById('progressText'),
        remainingText: document.getElementById('remainingText'),
        refreshButton: document.getElementById('refreshButton'),
        databaseSelect: document.getElementById('databaseSelect'),
        autoRefreshToggle: document.getElementById('autoRefreshToggle'),
        machineIdInput: document.getElementById('machineIdInput'),
        maximizeButton: document.getElementById('maximizeButton'),
        appShell: document.querySelector('.app-shell'),
        viewAllButton: document.getElementById('viewAllButton'),
        allMachinesDashboard: document.getElementById('allMachinesDashboard'),
        machinesGrid: document.getElementById('machinesGrid'),
        machineCardTemplate: document.getElementById('machineCardTemplate'),
    };

    let idleTimerInterval = null;
    let idleTimerMinutes = null;
    let autoRefreshInterval = null;
    let isMaximized = false;
    let allMachinesViewActive = false;
    let allMachinesIdleTimers = new Map();
    let allMachinesAutoRefreshInterval = null;

    const allowedDatabases = ['KOL', 'AHM'];
    const allMachineIds = [14, 47, 58, 61, 62, 63, 64, 65, 66, 33];

    const state = {
        machineId: null,
        machineIdFromUrl: false,
        database: allowedDatabases.includes((config.defaultDatabase || '').toUpperCase())
            ? (config.defaultDatabase || '').toUpperCase()
            : 'KOL',
    };

    function deriveStateFromUrl() {
        const params = new URLSearchParams(window.location.search);

        const pathSegments = window.location.pathname.split('/').filter(Boolean);
        let pathMachineId = null;

        if (pathSegments.length > 0) {
            const last = pathSegments[pathSegments.length - 1];
            if (/^\d+$/.test(last)) {
                pathMachineId = Number(last);
            } else if (last.includes('.') && pathSegments.length >= 2) {
                const maybeId = pathSegments[pathSegments.length - 2];
                if (/^\d+$/.test(maybeId)) {
                    pathMachineId = Number(maybeId);
                }
            }
        }

        if (Number.isInteger(pathMachineId) && pathMachineId > 0) {
            state.machineId = pathMachineId;
            state.machineIdFromUrl = true;
        }

        if (params.has('machineId')) {
            const fromQuery = Number(params.get('machineId'));
            if (Number.isInteger(fromQuery) && fromQuery > 0) {
                state.machineId = fromQuery;
                state.machineIdFromUrl = true;
            }
        }

        if (params.has('database')) {
            const candidate = (params.get('database') || '').toUpperCase();
            if (allowedDatabases.includes(candidate)) {
                state.database = candidate;
            }
        }
    }

    function setStatusMessage(message, variant = 'info') {
        selectors.statusMessage.textContent = message;
        selectors.statusMessage.className = `status-message ${variant}`;
        selectors.statusMessage.hidden = !message;
    }

    function updateVisibility({ showDashboard = false, showPlaceholder = false, showAllMachines = false } = {}) {
        selectors.dashboard.hidden = !showDashboard;
        selectors.dashboard.style.display = showDashboard ? '' : 'none';

        selectors.noMachineSelected.hidden = !showPlaceholder;
        selectors.noMachineSelected.style.display = showPlaceholder ? '' : 'none';

        selectors.allMachinesDashboard.hidden = !showAllMachines;
        selectors.allMachinesDashboard.style.display = showAllMachines ? '' : 'none';
    }

    function coerceNumber(value) {
        if (value === null || value === undefined) return NaN;
        if (typeof value === 'number') {
            return value;
        }
        if (typeof value === 'string') {
            const cleaned = value.replace(/[^0-9.-]/g, '');
            if (cleaned.length === 0 || cleaned === '-' || cleaned === '.') {
                return NaN;
            }
            const parsed = Number(cleaned);
            return Number.isFinite(parsed) ? parsed : NaN;
        }
        return NaN;
    }

    function minutesToHrsMinutes(value) {
        const minutes = coerceNumber(value);
        if (!Number.isFinite(minutes)) return '—';
        const isNegative = minutes < 0;
        const absMinutes = Math.abs(Math.round(minutes));
        const hrs = Math.floor(absMinutes / 60);
        const mins = absMinutes % 60;
        const formatted = `${hrs}h ${mins.toString().padStart(2, '0')}m`;
        return isNegative ? `-${formatted}` : formatted;
    }

    function formatDateTime(value) {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return value;
        }
        
        // Adjust for IST timezone offset (UTC+5:30)
        // Database returns times in IST, but JavaScript may be applying timezone conversion
        // Subtract 5 hours 30 minutes (330 minutes) to get the correct IST time
        const adjustedDate = new Date(date.getTime() - (5 * 60 + 30) * 60 * 1000);
        
        return new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short'
        }).format(adjustedDate);
    }

    function formatNumber(value) {
        if (value === null || value === undefined) return '—';
        const num = coerceNumber(value);
        if (!Number.isFinite(num)) return String(value);
        return new Intl.NumberFormat().format(num);
    }

    function setStatusDisplay(element, label, color) {
        if (!element) return;
        const normalizedColor = color === 'green' ? 'green' : 'red';
        element.innerHTML = `
            <span class="status-indicator ${normalizedColor}"></span>
            <span>${label}</span>
        `;
        // Color is now handled by CSS based on card background
        element.style.color = '';
    }

    function clearIdleTimer() {
        if (idleTimerInterval) {
            clearInterval(idleTimerInterval);
            idleTimerInterval = null;
        }
        idleTimerMinutes = null;
    }

    function startIdleTimer(initialMinutes) {
        clearIdleTimer();
        const parsedMinutes = coerceNumber(initialMinutes);
        if (!Number.isFinite(parsedMinutes)) {
            selectors.idleDuration.textContent = '—';
            return;
        }
        idleTimerMinutes = parsedMinutes;
        selectors.idleDuration.textContent = minutesToHrsMinutes(idleTimerMinutes);
        idleTimerInterval = setInterval(() => {
            idleTimerMinutes += 1;
            selectors.idleDuration.textContent = minutesToHrsMinutes(idleTimerMinutes);
        }, 60_000);
    }

    function flagIsTrue(value) {
        if (typeof value === 'boolean') {
            return value;
        }
        const num = Number(value);
        if (Number.isFinite(num)) {
            return num === 1;
        }
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (normalized === 'true') return true;
            if (normalized === 'false') return false;
        }
        return false;
    }

    function renderIdleState(data) {
        selectors.idleLayout.hidden = false;
        selectors.idleLayout.style.display = '';
        selectors.runningLayout.hidden = true;
        selectors.runningLayout.style.display = 'none';
        clearIdleTimer();

        if (selectors.machineHeader) {
            selectors.machineHeader.hidden = false;
        }
        if (selectors.machineCard) {
            selectors.machineCard.dataset.state = 'idle';
            selectors.machineCard.dataset.statusColor = 'red';
        }

        setStatusDisplay(selectors.idleStatusText, 'IDLE', 'red');
        selectors.lastJobCompleted.textContent = data.LastCompletedAt
            ? formatDateTime(data.LastCompletedAt)
            : '—';

        startIdleTimer(data.IdleSinceMinutes);

        selectors.backlogMachine.textContent = formatNumber(data.BacklogJobsOnMachine);
        selectors.backlogProcess.textContent = formatNumber(data.BacklogJobsForProcess);
    }

    function renderRunningState(data) {
        selectors.idleLayout.hidden = true;
        selectors.idleLayout.style.display = 'none';
        selectors.runningLayout.hidden = false;
        selectors.runningLayout.style.display = '';
        clearIdleTimer();

        const isBehind = flagIsTrue(data.IsBehindSchedule);
        if (selectors.machineHeader) {
            selectors.machineHeader.hidden = true;
        }
        if (selectors.machineCard) {
            selectors.machineCard.dataset.state = 'running';
            selectors.machineCard.dataset.statusColor = isBehind ? 'red' : 'green';
        }

        const jobNumber = data.CurrentJobNumber ?? 'Unknown';
        const jobName = data.CurrentJobName ?? 'Unnamed';
        selectors.currentJob.textContent = `${jobNumber} – ${jobName}`;
        selectors.startTime.textContent = formatDateTime(data.CurrentJobStartedAt);
        selectors.runningDuration.textContent = minutesToHrsMinutes(data.RunningSinceMinutes);
        selectors.targetFinishIn.textContent = minutesToHrsMinutes(data.TargetMinutesToFinish);
        selectors.eta.textContent = formatDateTime(data.TargetFinishAt);

        setStatusDisplay(
            selectors.runningStatusText,
            isBehind ? 'Running behind schedule' : 'On track',
            isBehind ? 'red' : 'green'
        );

        const producedDisplay = formatNumber(data.ProducedQty);
        const planDisplay = formatNumber(data.PlanQty);

        selectors.progressText.textContent = `Produced ${producedDisplay} / ${planDisplay}`;
    }

    function renderDashboard(data) {
        selectors.machineName.textContent = data.MachineName ?? 'Unknown Machine';
        state.machineId = data.MachineID ?? state.machineId;
        state.machineIdFromUrl = false;
        if (selectors.machineIdInput) {
            selectors.machineIdInput.value = state.machineId ?? '';
        }

        const isRunning = flagIsTrue(data.IsRunning);

        if (isRunning) {
            renderRunningState(data);
        } else {
            renderIdleState(data);
        }
    }

    async function fetchMachineData(machineId, database) {
        const baseUrl = config.apiBaseUrl?.replace(/\/$/, '') || '';
        const url = `${baseUrl}/machine-floor/${encodeURIComponent(machineId)}?database=${encodeURIComponent(database)}`;

        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
        }

        const payload = await response.json();
        if (!payload.status) {
            throw new Error(payload.error || 'API returned an error');
        }

        console.log('[MachineFloorDashboard] Full procedure payload:', payload.data);

        return payload.data;
    }

    async function loadData() {
        if (allMachinesViewActive) {
            return; // Don't load single machine data when in all machines view
        }

        const inputMachineId = selectors.machineIdInput ? selectors.machineIdInput.value.trim() : '';
        const parsedMachineId = Number(inputMachineId);

        if (!Number.isInteger(parsedMachineId) || parsedMachineId <= 0) {
            stopAutoRefresh();
            setStatusMessage('');
            selectors.machineIdInput.value = '';
            if (selectors.machineCard) {
                selectors.machineCard.removeAttribute('data-status-color');
            }
            updateVisibility({ showPlaceholder: true, showAllMachines: false });
            return;
        }

        state.machineId = parsedMachineId;

        setStatusMessage('Loading machine data…');
        updateVisibility({ showPlaceholder: false, showDashboard: false, showAllMachines: false });

        try {
            const data = await fetchMachineData(state.machineId, state.database);
            renderDashboard(data);
            setStatusMessage('');
            updateVisibility({ showDashboard: true, showPlaceholder: false, showAllMachines: false });
            if (selectors.autoRefreshToggle.checked) {
                startAutoRefresh();
            }
        } catch (error) {
            console.error('Failed to load machine data', error);
            setStatusMessage(error.message || 'Failed to load machine data.', 'error');
            updateVisibility({ showDashboard: false, showPlaceholder: false, showAllMachines: false });
        }
    }

    function toggleMaximize() {
        isMaximized = !isMaximized;
        
        if (isMaximized) {
            selectors.machineCard.classList.add('maximized');
            if (selectors.appShell) {
                selectors.appShell.classList.add('hide-header');
            }
            if (selectors.maximizeButton) {
                selectors.maximizeButton.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path>
                    </svg>
                `;
                selectors.maximizeButton.title = 'Minimize';
            }
        } else {
            selectors.machineCard.classList.remove('maximized');
            if (selectors.appShell) {
                selectors.appShell.classList.remove('hide-header');
            }
            if (selectors.maximizeButton) {
                selectors.maximizeButton.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
                    </svg>
                `;
                selectors.maximizeButton.title = 'Maximize';
            }
        }
    }

    function toggleCardMaximize(cardElement) {
        const isCurrentlyMaximized = cardElement.classList.contains('card-maximized');
        
        if (isCurrentlyMaximized) {
            cardElement.classList.remove('card-maximized');
            const btn = cardElement.querySelector('.card-maximize-btn');
            if (btn) {
                btn.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
                    </svg>
                `;
                btn.title = 'Maximize';
            }
        } else {
            // Minimize all other cards first
            document.querySelectorAll('.machine-card-grid.card-maximized').forEach(card => {
                if (card !== cardElement) {
                    card.classList.remove('card-maximized');
                    const btn = card.querySelector('.card-maximize-btn');
                    if (btn) {
                        btn.innerHTML = `
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
                            </svg>
                        `;
                        btn.title = 'Maximize';
                    }
                }
            });
            
            cardElement.classList.add('card-maximized');
            const btn = cardElement.querySelector('.card-maximize-btn');
            if (btn) {
                btn.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path>
                    </svg>
                `;
                btn.title = 'Minimize';
            }
        }
    }

    function renderMachineCardInGrid(data, cardElement) {
        const machineId = data.MachineID ?? data.machineid;
        cardElement.dataset.machineId = machineId;
        
        const machineNameEl = cardElement.querySelector('.machine-name-centered');
        if (machineNameEl) {
            machineNameEl.textContent = data.MachineName ?? `Machine ${machineId}`;
        }

        const isRunning = flagIsTrue(data.IsRunning);
        const idleLayout = cardElement.querySelector('.idle-layout-grid');
        const runningLayout = cardElement.querySelector('.running-layout-grid');

        if (isRunning) {
            if (idleLayout) idleLayout.hidden = true;
            if (runningLayout) runningLayout.hidden = false;

            const isBehind = flagIsTrue(data.IsBehindSchedule);
            cardElement.dataset.state = 'running';
            cardElement.dataset.statusColor = isBehind ? 'red' : 'green';

            const currentJobEl = cardElement.querySelector('.current-job');
            if (currentJobEl) {
                const jobNumber = data.CurrentJobNumber ?? 'Unknown';
                const jobName = data.CurrentJobName ?? 'Unnamed';
                currentJobEl.textContent = `${jobNumber} – ${jobName}`;
            }

            const startTimeEl = cardElement.querySelector('.start-time');
            if (startTimeEl) startTimeEl.textContent = formatDateTime(data.CurrentJobStartedAt);

            const runningDurationEl = cardElement.querySelector('.running-duration');
            if (runningDurationEl) runningDurationEl.textContent = minutesToHrsMinutes(data.RunningSinceMinutes);

            const targetFinishInEl = cardElement.querySelector('.target-finish-in');
            if (targetFinishInEl) targetFinishInEl.textContent = minutesToHrsMinutes(data.TargetMinutesToFinish);

            const etaEl = cardElement.querySelector('.eta');
            if (etaEl) etaEl.textContent = formatDateTime(data.TargetFinishAt);

            const statusTextEl = cardElement.querySelector('.running-layout-grid .status-text');
            if (statusTextEl) {
                setStatusDisplay(statusTextEl, isBehind ? 'Running behind schedule' : 'On track', isBehind ? 'red' : 'green');
            }

            const progressTextEl = cardElement.querySelector('.progress-text');
            if (progressTextEl) {
                const producedDisplay = formatNumber(data.ProducedQty);
                const planDisplay = formatNumber(data.PlanQty);
                progressTextEl.textContent = `Produced ${producedDisplay} / ${planDisplay}`;
            }
        } else {
            if (idleLayout) idleLayout.hidden = false;
            if (runningLayout) runningLayout.hidden = true;

            cardElement.dataset.state = 'idle';
            cardElement.dataset.statusColor = 'red';

            const statusTextEl = cardElement.querySelector('.idle-layout-grid .status-text');
            if (statusTextEl) {
                setStatusDisplay(statusTextEl, 'IDLE', 'red');
            }

            const lastJobCompletedEl = cardElement.querySelector('.last-job-completed');
            if (lastJobCompletedEl) {
                lastJobCompletedEl.textContent = data.LastCompletedAt
                    ? formatDateTime(data.LastCompletedAt)
                    : '—';
            }

            const idleDurationEl = cardElement.querySelector('.idle-duration');
            if (idleDurationEl) {
                startIdleTimerForCard(cardElement, data.IdleSinceMinutes);
            }

            const backlogMachineEl = cardElement.querySelector('.backlog-machine');
            if (backlogMachineEl) backlogMachineEl.textContent = formatNumber(data.BacklogJobsOnMachine);

            const backlogProcessEl = cardElement.querySelector('.backlog-process');
            if (backlogProcessEl) backlogProcessEl.textContent = formatNumber(data.BacklogJobsForProcess);
        }
    }

    function startIdleTimerForCard(cardElement, initialMinutes) {
        const machineId = cardElement.dataset.machineId;
        if (!machineId) return;

        // Clear existing timer for this card
        if (allMachinesIdleTimers.has(machineId)) {
            clearInterval(allMachinesIdleTimers.get(machineId));
        }

        const parsedMinutes = coerceNumber(initialMinutes);
        if (!Number.isFinite(parsedMinutes)) {
            const idleDurationEl = cardElement.querySelector('.idle-duration');
            if (idleDurationEl) idleDurationEl.textContent = '—';
            return;
        }

        let idleMinutes = parsedMinutes;
        const idleDurationEl = cardElement.querySelector('.idle-duration');
        if (idleDurationEl) {
            idleDurationEl.textContent = minutesToHrsMinutes(idleMinutes);
        }

        const interval = setInterval(() => {
            idleMinutes += 1;
            if (idleDurationEl) {
                idleDurationEl.textContent = minutesToHrsMinutes(idleMinutes);
            }
        }, 60_000);

        allMachinesIdleTimers.set(machineId, interval);
    }

    function clearAllIdleTimers() {
        allMachinesIdleTimers.forEach(interval => clearInterval(interval));
        allMachinesIdleTimers.clear();
    }

    async function loadAllMachines() {
        if (!selectors.machinesGrid || !selectors.machineCardTemplate) return;

        allMachinesViewActive = true;
        stopAutoRefresh();
        clearAllIdleTimers();

        setStatusMessage('Loading all machines...');
        updateVisibility({ showDashboard: false, showPlaceholder: false, showAllMachines: true });

        selectors.machinesGrid.innerHTML = '';

        const promises = allMachineIds.map(async (machineId) => {
            try {
                const data = await fetchMachineData(machineId, state.database);
                const cardElement = selectors.machineCardTemplate.content.cloneNode(true);
                const card = cardElement.querySelector('.machine-card-grid');
                
                renderMachineCardInGrid(data, card);
                
                const maximizeBtn = card.querySelector('.card-maximize-btn');
                if (maximizeBtn) {
                    maximizeBtn.addEventListener('click', () => toggleCardMaximize(card));
                }

                return card;
            } catch (error) {
                console.error(`Failed to load machine ${machineId}:`, error);
                const cardElement = selectors.machineCardTemplate.content.cloneNode(true);
                const card = cardElement.querySelector('.machine-card-grid');
                card.dataset.machineId = machineId;
                const machineNameEl = card.querySelector('.machine-name-centered');
                if (machineNameEl) {
                    machineNameEl.textContent = `Machine ${machineId} - Error`;
                }
                card.dataset.statusColor = 'red';
                return card;
            }
        });

        const cards = await Promise.all(promises);
        cards.forEach(card => {
            selectors.machinesGrid.appendChild(card);
        });

        setStatusMessage('');
        
        if (selectors.autoRefreshToggle.checked) {
            startAllMachinesAutoRefresh();
        }
    }

    function startAllMachinesAutoRefresh() {
        stopAllMachinesAutoRefresh();
        const seconds = Number(config.refreshIntervalSeconds) || 300;
        
        console.log(`[AllMachinesAutoRefresh] Starting auto refresh every ${seconds} seconds`);
        allMachinesAutoRefreshInterval = setInterval(() => {
            console.log('[AllMachinesAutoRefresh] Auto refreshing all machines...');
            loadAllMachines();
        }, seconds * 1000);
    }

    function stopAllMachinesAutoRefresh() {
        if (allMachinesAutoRefreshInterval) {
            clearInterval(allMachinesAutoRefreshInterval);
            allMachinesAutoRefreshInterval = null;
        }
    }

    function toggleViewAll() {
        if (allMachinesViewActive) {
            // Switch back to single machine view
            allMachinesViewActive = false;
            stopAllMachinesAutoRefresh();
            stopAutoRefresh();
            clearAllIdleTimers();
            updateVisibility({ showDashboard: false, showPlaceholder: true, showAllMachines: false });
            if (selectors.viewAllButton) {
                selectors.viewAllButton.textContent = 'View All';
            }
        } else {
            // Switch to all machines view
            stopAutoRefresh();
            loadAllMachines();
            if (selectors.viewAllButton) {
                selectors.viewAllButton.textContent = 'View Single';
            }
        }
    }

    function setupEventListeners() {
        selectors.refreshButton.addEventListener('click', () => {
            if (allMachinesViewActive) {
                loadAllMachines();
            } else {
                loadData();
            }
        });

        if (selectors.viewAllButton) {
            selectors.viewAllButton.addEventListener('click', toggleViewAll);
        }

        if (selectors.machineIdInput) {
            selectors.machineIdInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    if (!allMachinesViewActive) {
                        loadData();
                    }
                }
            });
        }

        selectors.databaseSelect.addEventListener('change', () => {
            state.database = selectors.databaseSelect.value;
            if (allMachinesViewActive) {
                loadAllMachines();
            } else {
                loadData();
            }
        });

        selectors.autoRefreshToggle.addEventListener('change', () => {
            if (allMachinesViewActive) {
                if (selectors.autoRefreshToggle.checked) {
                    startAllMachinesAutoRefresh();
                } else {
                    stopAllMachinesAutoRefresh();
                }
            } else {
                if (selectors.autoRefreshToggle.checked) {
                    startAutoRefresh();
                } else {
                    stopAutoRefresh();
                }
            }
        });

        if (selectors.maximizeButton) {
            selectors.maximizeButton.addEventListener('click', toggleMaximize);
        }
    }

    function startAutoRefresh() {
        stopAutoRefresh();
        const seconds = Number(config.refreshIntervalSeconds) || 300;
        
        // Check if we have a valid machine ID from input or state
        const inputMachineId = selectors.machineIdInput ? selectors.machineIdInput.value.trim() : '';
        const parsedMachineId = Number(inputMachineId);
        const currentMachineId = Number.isInteger(parsedMachineId) && parsedMachineId > 0 
            ? parsedMachineId 
            : (Number.isInteger(state.machineId) && state.machineId > 0 ? state.machineId : null);
        
        if (!currentMachineId) {
            console.log('[AutoRefresh] No valid machine ID, skipping auto refresh');
            return;
        }
        
        console.log(`[AutoRefresh] Starting auto refresh every ${seconds} seconds for machine ${currentMachineId}`);
        autoRefreshInterval = setInterval(() => {
            console.log('[AutoRefresh] Auto refreshing...');
            loadData();
        }, seconds * 1000);
    }

    function stopAutoRefresh() {
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
        }
    }

    function init() {
        deriveStateFromUrl();

        if (selectors.databaseSelect) {
            selectors.databaseSelect.value = state.database;
        }

        if (selectors.machineIdInput) {
            if (state.machineIdFromUrl) {
                selectors.machineIdInput.value = state.machineId;
            } else if (Number.isInteger(config.defaultMachineId) && config.defaultMachineId > 0) {
                selectors.machineIdInput.value = '';
                selectors.machineIdInput.placeholder = `e.g. ${config.defaultMachineId}`;
            } else {
                selectors.machineIdInput.value = '';
            }
        }

        setupEventListeners();

        if (state.machineIdFromUrl && Number.isInteger(state.machineId) && state.machineId > 0) {
            loadData();
        } else {
            updateVisibility({ showPlaceholder: true });
        }
    }

    document.addEventListener('DOMContentLoaded', init);
})();

