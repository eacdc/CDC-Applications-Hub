(() => {
    const config = window.AppConfig || {};

    const selectors = {
        dashboard: document.getElementById('dashboard'),
        statusMessage: document.getElementById('statusMessage'),
        machineName: document.getElementById('machineName'),
        machineIdLabel: document.getElementById('machineIdLabel'),
        machineStatusBadge: document.getElementById('machineStatusBadge'),
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
        progressFill: document.getElementById('progressFill'),
        progressText: document.getElementById('progressText'),
        remainingText: document.getElementById('remainingText'),
        machineSpeed: document.getElementById('machineSpeed'),
        changeOver: document.getElementById('changeOver'),
        planQty: document.getElementById('planQty'),
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
        }

        if (params.has('machineId')) {
            const fromQuery = Number(params.get('machineId'));
            if (Number.isInteger(fromQuery) && fromQuery > 0) {
                state.machineId = fromQuery;
            }
        }

        if (state.machineId === null && Number.isInteger(config.defaultMachineId) && config.defaultMachineId > 0) {
            state.machineId = Number(config.defaultMachineId);
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
    }

    function minutesToHrsMinutes(value) {
        if (value === null || value === undefined) return '—';
        const minutes = Number(value);
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
        const num = Number(value);
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
        if (initialMinutes === null || initialMinutes === undefined) {
            selectors.idleDuration.textContent = '—';
            return;
        }
        idleTimerMinutes = Number(initialMinutes);
        if (!Number.isFinite(idleTimerMinutes)) {
            selectors.idleDuration.textContent = '—';
            return;
        }
        selectors.idleDuration.textContent = minutesToHrsMinutes(idleTimerMinutes);
        idleTimerInterval = setInterval(() => {
            idleTimerMinutes += 1;
            selectors.idleDuration.textContent = minutesToHrsMinutes(idleTimerMinutes);
        }, 60_000);
    }

    function setBadgeColor(statusColor, fallbackColor) {
        const color = (statusColor || '').toString().toLowerCase();
        selectors.machineStatusBadge.classList.remove('green', 'red');

        if (color === 'green') {
            selectors.machineStatusBadge.classList.add('green');
        } else if (color === 'red') {
            selectors.machineStatusBadge.classList.add('red');
        } else if (fallbackColor) {
            selectors.machineStatusBadge.classList.add(fallbackColor);
        }
    }

    function renderIdleState(data) {
        selectors.idleLayout.hidden = false;
        selectors.runningLayout.hidden = true;
        clearIdleTimer();

        selectors.machineStatusBadge.textContent = 'Idle';
        setBadgeColor(data.StatusColor, 'red');

        selectors.idleStatusText.textContent = 'IDLE (Red)';
        selectors.idleStatusText.style.color = '#b91c1c';
        selectors.lastJobCompleted.textContent = data.LastCompletedAt
            ? `${formatDateTime(data.LastCompletedAt)} (${data.LastCompletedJobNumber ?? 'Unknown Job'})`
            : 'No data';

        startIdleTimer(data.IdleSinceMinutes);

        selectors.backlogMachine.textContent = formatNumber(data.BacklogJobsOnMachine);
        selectors.backlogProcess.textContent = formatNumber(data.BacklogJobsForProcess);
    }

    function renderRunningState(data) {
        selectors.idleLayout.hidden = true;
        selectors.runningLayout.hidden = false;
        clearIdleTimer();

        const isBehind = Boolean(data.IsBehindSchedule);
        selectors.machineStatusBadge.textContent = 'Running';
        setBadgeColor(data.StatusColor, isBehind ? 'red' : 'green');

        const jobNumber = data.CurrentJobNumber ?? 'Unknown Job';
        const jobName = data.CurrentJobName ?? 'Unnamed';
        selectors.currentJob.textContent = `${jobNumber} – ${jobName}`;
        selectors.startTime.textContent = formatDateTime(data.CurrentJobStartedAt);
        selectors.runningDuration.textContent = minutesToHrsMinutes(data.RunningSinceMinutes);
        selectors.targetFinishIn.textContent = minutesToHrsMinutes(data.TargetMinutesToFinish);
        selectors.eta.textContent = formatDateTime(data.TargetFinishAt);

        selectors.runningStatusText.textContent = isBehind ? 'Running behind schedule' : 'On track';
        selectors.runningStatusText.style.color = isBehind ? '#b91c1c' : '#047857';

        const produced = Number(data.ProducedQty) || 0;
        const plan = Number(data.PlanQty) || 0;
        const remaining = Number(data.RemainingQty) || 0;
        const progress = plan > 0 ? Math.min(100, Math.max(0, (produced / plan) * 100)) : 0;
        selectors.progressFill.style.width = `${progress.toFixed(1)}%`;
        selectors.progressText.textContent = `Produced ${formatNumber(produced)} / ${formatNumber(plan)}`;
        selectors.remainingText.textContent = `Remaining ${formatNumber(remaining)}`;
    }

    function renderMeta(data) {
        selectors.machineSpeed.textContent = data.MachineSpeedUPM ? `${formatNumber(data.MachineSpeedUPM)} UPM` : '—';
        selectors.changeOver.textContent = data.ChangeOverMinutes ? `${minutesToHrsMinutes(data.ChangeOverMinutes)}` : '—';
        selectors.planQty.textContent = formatNumber(data.PlanQty);
    }

    function renderDashboard(data) {
        selectors.machineName.textContent = data.MachineName ?? 'Unknown Machine';
        selectors.machineIdLabel.textContent = `Machine ID: ${data.MachineID}`;
        state.machineId = data.MachineID ?? state.machineId;
        if (selectors.machineIdInput) {
            selectors.machineIdInput.value = state.machineId ?? '';
        }

        if (data.IsRunning) {
            renderRunningState(data);
        } else {
            renderIdleState(data);
        }

        renderMeta(data);
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

        return payload.data;
    }

    async function loadData() {
        const inputMachineId = selectors.machineIdInput ? selectors.machineIdInput.value.trim() : '';
        const parsedMachineId = Number(inputMachineId);

        if (!Number.isInteger(parsedMachineId) || parsedMachineId <= 0) {
            setStatusMessage('Enter a valid machine ID to load data.', 'error');
            showDashboard(false);
            return;
        }

        state.machineId = parsedMachineId;

        setStatusMessage('Loading machine data…');
        showDashboard(false);

        try {
            const data = await fetchMachineData(state.machineId, state.database);
            renderDashboard(data);
            setStatusMessage('');
            showDashboard(true);
        } catch (error) {
            console.error('Failed to load machine data', error);
            setStatusMessage(error.message || 'Failed to load machine data.', 'error');
            showDashboard(false);
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
            selectors.machineIdInput.value = state.machineId ?? '';
        }

        setupEventListeners();
        loadData();

        if (selectors.autoRefreshToggle.checked) {
            startAutoRefresh();
        }
    }

    document.addEventListener('DOMContentLoaded', init);
})();

