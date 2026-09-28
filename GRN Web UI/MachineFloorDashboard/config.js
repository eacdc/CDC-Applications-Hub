window.AppConfig = window.AppConfig || {};

(function () {
  var protocol = (window.location && window.location.protocol) || '';
  var host = String((window.location && window.location.hostname) || '').toLowerCase();
  var isLocal = protocol === 'file:' || !host || host === 'localhost' || host === '127.0.0.1' || host === '::1';
  window.AppConfig.apiBaseUrl = window.AppConfig.apiBaseUrl || (isLocal
    ? 'http://localhost:3001/api'
    : 'https://cdcapi.onrender.com/api');
})();
window.AppConfig.defaultMachineId = window.AppConfig.defaultMachineId || 58;
window.AppConfig.defaultDatabase = window.AppConfig.defaultDatabase || 'KOL';
window.AppConfig.refreshIntervalSeconds = window.AppConfig.refreshIntervalSeconds || 60;

