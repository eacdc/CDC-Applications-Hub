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
    };

    let idleTimerInterval = null;
    let idleTimerMinutes = null;
    let autoRefreshInterval = null;

    const allowedDatabases = ['KOL', 'AHM'];

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

    function showDashboard(show) {
        selectors.dashboard.hidden = !show;
        selectors.noMachineSelected.hidden = show;
    }

    function showNoMachineMessage(show) {
        selectors.noMachineSelected.hidden = !show;
        selectors.dashboard.hidden = show;
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
        return new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short'
        }).format(date);
    }

    function formatNumber(value) {
        if (value === null || value === undefined) return '—';
        const num = coerceNumber(value);
        if (!Number.isFinite(num)) return String(value);
        return new Intl.NumberFormat().format(num);
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
        }

        selectors.idleStatusText.textContent = 'IDLE';
        selectors.idleStatusText.style.color = '#b91c1c';
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
        }

        const jobNumber = data.CurrentJobNumber ?? 'Unknown';
        const jobName = data.CurrentJobName ?? 'Unnamed';
        selectors.currentJob.textContent = `${jobNumber} – ${jobName}`;
        selectors.startTime.textContent = formatDateTime(data.CurrentJobStartedAt);
        selectors.runningDuration.textContent = minutesToHrsMinutes(data.RunningSinceMinutes);
        selectors.targetFinishIn.textContent = minutesToHrsMinutes(data.TargetMinutesToFinish);
        selectors.eta.textContent = formatDateTime(data.TargetFinishAt);

        selectors.runningStatusText.textContent = isBehind ? 'Running behind schedule' : 'On track';
        selectors.runningStatusText.style.color = isBehind ? '#b91c1c' : '#047857';

        const producedDisplay = formatNumber(data.ProducedQty);
        const planDisplay = formatNumber(data.PlanQty);
        const remainingDisplay = formatNumber(data.RemainingQty);

        selectors.progressText.textContent = `Produced ${producedDisplay} / ${planDisplay}`;
        selectors.remainingText.textContent = `Remaining ${remainingDisplay}`;
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
        const inputMachineId = selectors.machineIdInput ? selectors.machineIdInput.value.trim() : '';
        const parsedMachineId = Number(inputMachineId);

        if (!Number.isInteger(parsedMachineId) || parsedMachineId <= 0) {
            stopAutoRefresh();
            setStatusMessage('');
            showNoMachineMessage(true);
            return;
        }

        state.machineId = parsedMachineId;

        setStatusMessage('Loading machine data…');
        showNoMachineMessage(false);
        showDashboard(false);

        try {
            const data = await fetchMachineData(state.machineId, state.database);
            renderDashboard(data);
            setStatusMessage('');
            showDashboard(true);
            if (selectors.autoRefreshToggle.checked) {
                startAutoRefresh();
            }
        } catch (error) {
            console.error('Failed to load machine data', error);
            setStatusMessage(error.message || 'Failed to load machine data.', 'error');
            showDashboard(false);
            showNoMachineMessage(false);
        }
    }

    function setupEventListeners() {
        selectors.refreshButton.addEventListener('click', () => loadData());

        if (selectors.machineIdInput) {
            selectors.machineIdInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    loadData();
                }
            });
        }

        selectors.databaseSelect.addEventListener('change', () => {
            state.database = selectors.databaseSelect.value;
            loadData();
        });

        selectors.autoRefreshToggle.addEventListener('change', () => {
            if (selectors.autoRefreshToggle.checked) {
                startAutoRefresh();
            } else {
                stopAutoRefresh();
            }
        });
    }

    function startAutoRefresh() {
        stopAutoRefresh();
        const seconds = Number(config.refreshIntervalSeconds) || 300;
        if (!Number.isInteger(state.machineId) || state.machineId <= 0) {
            return;
        }
        autoRefreshInterval = setInterval(loadData, seconds * 1000);
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
            showNoMachineMessage(true);
        }
    }

    document.addEventListener('DOMContentLoaded', init);
})();

