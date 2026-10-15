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

/** Everything this page calls lives under one prefix. */
window.AppConfig.portalBase = window.AppConfig.portalBase
  || window.AppConfig.apiBaseUrl + '/supplier-portal';

/**
 * Posting for real is refused by the server unless SP_ENABLE_ERP_WRITES=true
 * AND a write login is configured. The page reads that state from the dry-run
 * response rather than assuming it, so the button cannot promise something the
 * backend will reject.
 */
window.AppConfig.sites = window.AppConfig.sites || ['KOL', 'AHM'];
