window.AppConfig = window.AppConfig || {};

(function () {
  var loc = window.location || {};
  var protocol = loc.protocol || '';
  var host = String(loc.hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  var port = String(loc.port || '');
  var isPrivateIp = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host);
  var isLoopback = !host || host === 'localhost' || host === '127.0.0.1' || host === '::1';
  var isLocal = protocol === 'file:' || isLoopback || isPrivateIp;

  if (!window.AppConfig.apiBaseUrl) {
    if (protocol === 'file:') {
      window.AppConfig.apiBaseUrl = 'http://127.0.0.1:3001/api';
    } else if (isLocal && (port === '3001' || port === '')) {
      window.AppConfig.apiBaseUrl = loc.origin + '/api';
    } else if (isLocal) {
      var apiHost = host === '::1' ? '127.0.0.1' : host;
      window.AppConfig.apiBaseUrl = 'http://' + apiHost + ':3001/api';
    } else {
      window.AppConfig.apiBaseUrl = 'https://cdcapi.onrender.com/api';
    }
  }
})();

/** The old tool was Kolkata-only; Ahmedabad uses the same tables. */
window.AppConfig.defaultDatabase = window.AppConfig.defaultDatabase || 'KOL';
/** Ask for confirmation before creating more labels than this in one go. */
window.AppConfig.confirmAbove = window.AppConfig.confirmAbove || 20;
