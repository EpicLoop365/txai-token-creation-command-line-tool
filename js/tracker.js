/* ===== TXAI — Visitor Tracker + NFT Pass Analytics ===== */
/*
 * Lightweight beacon that fires on page load.
 * Sends: page, wallet (if connected), pass tier, referrer
 * API adds: IP address, user agent, timestamp
 *
 * Privacy: IPs are masked in dashboard (last octet hidden).
 * No cookies, no fingerprinting, no third-party scripts.
 */

(function() {
  'use strict';

  const TRACK_ENDPOINT = (typeof API_URL !== 'undefined' ? API_URL : '') + '/api/track';
  const SESSION_KEY = 'txai_session_id';

  // Generate or reuse session ID (persists per browser tab session)
  function getSessionId() {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  }

  // Get current wallet if connected
  function getWallet() {
    return (window.txaiWallet && window.txaiWallet.address)
      || (typeof connectedAddress !== 'undefined' && connectedAddress)
      || null;
  }

  // Get current pass tier if cached
  function getPassTier() {
    if (typeof gateGetCurrentTier === 'function') {
      const t = gateGetCurrentTier();
      return t.name !== 'none' ? t.name : null;
    }
    return null;
  }

  // Send tracking beacon
  function track(page) {
    try {
      const payload = {
        page: page || window.location.pathname,
        wallet: getWallet(),
        passTier: getPassTier(),
        referrer: document.referrer || '',
        sessionId: getSessionId(),
      };

      // Use sendBeacon if available (survives page unload)
      if (navigator.sendBeacon) {
        navigator.sendBeacon(TRACK_ENDPOINT, JSON.stringify(payload));
      } else {
        fetch(TRACK_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true,
        }).catch(function() {}); // Silent fail
      }
    } catch (e) {
      // Never throw — tracking must be invisible
    }
  }

  // Track on page load
  if (document.readyState === 'complete') {
    track();
  } else {
    window.addEventListener('load', function() { track(); });
  }

  // Track on SPA navigation (tab switches)
  window.txaiTrack = track;

  // Re-track when wallet connects (to capture wallet + tier)
  let lastWallet = null;
  setInterval(function() {
    const w = getWallet();
    if (w && w !== lastWallet) {
      lastWallet = w;
      track(window.location.pathname + '#wallet-connected');
    }
  }, 5000);

})();
