/* ===== Solomente TXAI Preflight Compliance Engine — Frontend Client ===== */
/* Pure vanilla JS. No frameworks. Matches TXAI Studio dark theme.          */

// ── API base URL (local dev vs production) ──
const PREFLIGHT_API_BASE = window.TXAI_API_BASE
  || (window.location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : 'https://txai-api-production.up.railway.app');

// ── Severity palette ──
const _PF_COLORS = {
  error:   '#ef4444',
  warning: '#f59e0b',
  info:    '#3b82f6',
  success: '#06d6a0',
};

/* ========================================================================
   1. API CLIENT
   ======================================================================== */

/**
 * Call POST /api/preflight and return the PreflightResult JSON.
 *
 * @param {string}  txType   - e.g. 'token_send', 'token_mint', 'dex_order'
 * @param {string}  sender   - wallet address of the sender
 * @param {object}  params   - tx-specific parameters (amount, recipient, denom ...)
 * @param {string}  network  - 'mainnet' | 'testnet'  (default: auto-detect from UI)
 * @returns {Promise<object>} PreflightResult JSON
 */
async function preflightCheck(txType, sender, params = {}, network) {
  const net = network
    || (document.getElementById('navNetworkSelect')?.value)
    || 'mainnet';

  const url = `${PREFLIGHT_API_BASE}/api/preflight`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txType, sender, params, network: net }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Preflight API ${res.status}: ${errBody || res.statusText}`);
    }

    return await res.json();
  } catch (err) {
    // Network / parse errors — return a synthetic blocked result so the UI
    // still has something sensible to render.
    console.error('[preflight] API error:', err);
    return {
      canProceed: false,
      checks: [{
        category: 'network',
        severity: 'error',
        message: 'Preflight service unreachable',
        suggestion: err.message,
      }],
      summary: { errors: 1, warnings: 0, info: 0 },
      effectiveAmount: null,
      estimatedGas: null,
      estimatedFee: null,
    };
  }
}

// Keep legacy alias so existing callers still work
const txaiPreflight = preflightCheck;

/* ========================================================================
   2. INJECT STYLES (once)
   ======================================================================== */

let _pfStylesInjected = false;

function _pfInjectStyles() {
  if (_pfStylesInjected) return;
  _pfStylesInjected = true;

  const css = `
/* ── Preflight Modal Overlay ── */
.preflight-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.85);
  opacity: 0;
  transition: opacity .25s ease;
}
.preflight-modal-overlay.pf-visible {
  opacity: 1;
}

/* ── Modal Card ── */
.preflight-modal {
  background: #1a1a2e;
  border-radius: var(--radius-lg, 16px);
  border: 1px solid var(--green, #06d6a0);
  width: 92vw;
  max-width: 560px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 80px rgba(0,0,0,.6);
  transform: translateY(24px);
  transition: transform .3s cubic-bezier(.22,1,.36,1);
  font-family: var(--mono, 'Space Mono', monospace);
  color: #e4e4e7;
}
.preflight-modal-overlay.pf-visible .preflight-modal {
  transform: translateY(0);
}
.preflight-modal.pf-blocked {
  border-color: ${_PF_COLORS.error};
}

/* ── Header ── */
.pf-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 22px;
  border-bottom: 1px solid var(--border-light, #2a2d3e);
  font-size: .95rem;
  font-weight: 700;
  letter-spacing: .03em;
}
.pf-header-icon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  flex-shrink: 0;
}
.pf-header-icon.pf-ok  { background: rgba(6,214,160,.18); color: ${_PF_COLORS.success}; }
.pf-header-icon.pf-bad { background: rgba(239,68,68,.18);  color: ${_PF_COLORS.error}; }

/* ── Summary bar ── */
.pf-summary {
  display: flex;
  gap: 14px;
  padding: 10px 22px;
  font-size: .75rem;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--text-muted, #6b7280);
  border-bottom: 1px solid var(--border-light, #2a2d3e);
}
.pf-summary span { font-weight: 700; }
.pf-summary .pf-cnt-error   { color: ${_PF_COLORS.error}; }
.pf-summary .pf-cnt-warning { color: ${_PF_COLORS.warning}; }
.pf-summary .pf-cnt-info    { color: ${_PF_COLORS.info}; }

/* ── Checks list ── */
.pf-checks {
  flex: 1;
  overflow-y: auto;
  padding: 14px 22px;
}
.pf-category-label {
  text-transform: uppercase;
  font-size: .65rem;
  letter-spacing: .1em;
  color: #888;
  margin: 14px 0 6px;
  font-weight: 700;
}
.pf-category-label:first-child { margin-top: 0; }

.pf-check-item {
  padding: 8px 12px;
  margin-bottom: 6px;
  border-left: 3px solid var(--border-light, #2a2d3e);
  border-radius: 0 var(--radius-sm, 8px) var(--radius-sm, 8px) 0;
  background: rgba(255,255,255,.02);
}
.pf-check-item.pf-sev-error   { border-left-color: ${_PF_COLORS.error}; }
.pf-check-item.pf-sev-warning { border-left-color: ${_PF_COLORS.warning}; }
.pf-check-item.pf-sev-info    { border-left-color: ${_PF_COLORS.info}; }

.pf-check-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.pf-sev-icon {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: .65rem;
  margin-top: 1px;
}
.pf-sev-icon.pf-sev-error   { background: rgba(239,68,68,.18); color: ${_PF_COLORS.error}; }
.pf-sev-icon.pf-sev-warning { background: rgba(245,158,11,.18); color: ${_PF_COLORS.warning}; }
.pf-sev-icon.pf-sev-info    { background: rgba(59,130,246,.18); color: ${_PF_COLORS.info}; }

.pf-check-msg {
  font-size: .82rem;
  line-height: 1.4;
}
.pf-check-suggestion {
  font-size: .72rem;
  color: var(--text-dim, #9ca3af);
  margin-top: 3px;
  padding-left: 26px;
}

/* Expandable data */
.pf-check-data-toggle {
  font-size: .68rem;
  color: var(--purple, #7c6dfa);
  cursor: pointer;
  margin-top: 4px;
  padding-left: 26px;
  user-select: none;
}
.pf-check-data-toggle:hover { text-decoration: underline; }
.pf-check-data {
  display: none;
  margin-top: 6px;
  padding: 8px 10px 8px 26px;
  font-size: .68rem;
  background: rgba(0,0,0,.25);
  border-radius: var(--radius-sm, 8px);
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-dim, #9ca3af);
  max-height: 180px;
  overflow-y: auto;
}
.pf-check-data.pf-expanded { display: block; }

/* ── Effective Amount Breakdown ── */
.pf-breakdown {
  margin: 6px 22px 10px;
  padding: 12px 14px;
  background: rgba(6,214,160,.06);
  border: 1px solid rgba(6,214,160,.18);
  border-radius: var(--radius-sm, 8px);
  font-size: .75rem;
}
.pf-breakdown-title {
  font-size: .65rem;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: #888;
  margin-bottom: 8px;
  font-weight: 700;
}
.pf-breakdown-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  color: #e4e4e7;
}
.pf-breakdown-row .pf-label { color: var(--text-dim, #9ca3af); min-width: 90px; }
.pf-breakdown-arrow { color: var(--text-muted, #6b7280); }

/* ── Gas / Fee ── */
.pf-gas {
  padding: 8px 22px;
  font-size: .72rem;
  color: var(--text-muted, #6b7280);
  border-top: 1px solid var(--border-light, #2a2d3e);
  display: flex;
  gap: 20px;
}
.pf-gas span { color: var(--text-dim, #9ca3af); font-weight: 600; }

/* ── Footer buttons ── */
.pf-footer {
  display: flex;
  gap: 10px;
  padding: 16px 22px;
  border-top: 1px solid var(--border-light, #2a2d3e);
}
.pf-btn {
  flex: 1;
  padding: 11px 0;
  border: none;
  border-radius: var(--radius-sm, 8px);
  font-family: var(--mono, 'Space Mono', monospace);
  font-size: .82rem;
  font-weight: 700;
  cursor: pointer;
  transition: all .2s;
  letter-spacing: .02em;
}
.pf-btn-proceed {
  background: linear-gradient(135deg, #06d6a0, #05b588);
  color: #fff;
}
.pf-btn-proceed:hover:not(:disabled) {
  box-shadow: 0 4px 20px rgba(6,214,160,.35);
  transform: translateY(-1px);
}
.pf-btn-proceed:disabled {
  opacity: .35;
  cursor: not-allowed;
}
.pf-btn-cancel {
  background: var(--border-light, #2a2d3e);
  color: var(--text-dim, #9ca3af);
}
.pf-btn-cancel:hover {
  background: #353849;
  color: #e4e4e7;
}

/* ── Toast ── */
.preflight-toast {
  position: fixed;
  bottom: 28px;
  right: 28px;
  z-index: 10001;
  padding: 12px 20px;
  border-radius: var(--radius-sm, 8px);
  font-family: var(--mono, 'Space Mono', monospace);
  font-size: .78rem;
  font-weight: 600;
  color: #fff;
  box-shadow: 0 8px 30px rgba(0,0,0,.5);
  opacity: 0;
  transform: translateY(12px);
  transition: all .3s ease;
  pointer-events: none;
  max-width: 380px;
}
.preflight-toast.pf-toast-visible {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}
.preflight-toast.pf-toast-success { background: ${_PF_COLORS.success}; color: #08090c; }
.preflight-toast.pf-toast-error   { background: ${_PF_COLORS.error}; }
.preflight-toast.pf-toast-warning { background: ${_PF_COLORS.warning}; color: #08090c; }

/* ── Scrollbar inside modal ── */
.pf-checks::-webkit-scrollbar { width: 5px; }
.pf-checks::-webkit-scrollbar-track { background: transparent; }
.pf-checks::-webkit-scrollbar-thumb { background: #2a2d3e; border-radius: 4px; }
`;

  const tag = document.createElement('style');
  tag.id = 'preflight-styles';
  tag.textContent = css;
  document.head.appendChild(tag);
}

/* ========================================================================
   3. MODAL UI
   ======================================================================== */

/**
 * Build and display the preflight results modal.
 *
 * @param {object}   result      - PreflightResult from the API
 * @param {function} onProceed   - called when user clicks Proceed
 * @param {function} onCancel    - called when user clicks Cancel / closes
 */
function preflightShowModal(result, onProceed, onCancel) {
  _pfInjectStyles();

  // Remove any existing modal
  const existing = document.querySelector('.preflight-modal-overlay');
  if (existing) existing.remove();

  const canProceed = result.canProceed;
  const summary    = result.summary || { errors: 0, warnings: 0, info: 0 };
  const checks     = result.checks  || [];

  // ── Severity icon helpers ──
  const sevSymbol = { error: '\u2716', warning: '\u26A0', info: '\u2139' };

  // ── Build grouped checks by category ──
  const grouped = {};
  checks.forEach(c => {
    const cat = c.category || 'general';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(c);
  });

  let checksHTML = '';
  Object.keys(grouped).forEach(cat => {
    checksHTML += `<div class="pf-category-label">${_pfEsc(cat)}</div>`;
    grouped[cat].forEach((c, i) => {
      const sev = c.severity || 'info';
      const uid = `pf-data-${cat}-${i}`;
      let itemHTML = `
        <div class="pf-check-item pf-sev-${_pfEsc(sev)}">
          <div class="pf-check-row">
            <div class="pf-sev-icon pf-sev-${_pfEsc(sev)}">${sevSymbol[sev] || '\u2139'}</div>
            <div class="pf-check-msg">${_pfEsc(c.message)}</div>
          </div>`;
      if (c.suggestion) {
        itemHTML += `<div class="pf-check-suggestion">${_pfEsc(c.suggestion)}</div>`;
      }
      if (c.data) {
        itemHTML += `
          <div class="pf-check-data-toggle" data-target="${uid}">Show details</div>
          <div class="pf-check-data" id="${uid}">${_pfEsc(JSON.stringify(c.data, null, 2))}</div>`;
      }
      itemHTML += '</div>';
      checksHTML += itemHTML;
    });
  });

  // ── Effective amount breakdown ──
  let breakdownHTML = '';
  if (result.effectiveAmount) {
    const ea = result.effectiveAmount;
    breakdownHTML = `
      <div class="pf-breakdown">
        <div class="pf-breakdown-title">Amount Breakdown</div>
        ${_pfBreakdownRow('Send',       ea.send  || ea.sent)}
        ${_pfBreakdownRow('Burn',       ea.burn  || ea.burned)}
        ${_pfBreakdownRow('Commission', ea.commission)}
        ${_pfBreakdownRow('Received',   ea.received)}
      </div>`;
  }

  // ── Gas / fee ──
  let gasHTML = '';
  if (result.estimatedGas || result.estimatedFee) {
    gasHTML = '<div class="pf-gas">';
    if (result.estimatedGas) gasHTML += `Gas: <span>${_pfEsc(String(result.estimatedGas))}</span>`;
    if (result.estimatedFee) gasHTML += `Fee: <span>${_pfEsc(String(result.estimatedFee))}</span>`;
    gasHTML += '</div>';
  }

  // ── Assemble ──
  const overlay = document.createElement('div');
  overlay.className = 'preflight-modal-overlay';
  overlay.innerHTML = `
    <div class="preflight-modal${canProceed ? '' : ' pf-blocked'}">
      <div class="pf-header">
        <div class="pf-header-icon ${canProceed ? 'pf-ok' : 'pf-bad'}">
          ${canProceed ? '\u2714' : '\u2716'}
        </div>
        Preflight Check
      </div>
      <div class="pf-summary">
        <span class="pf-cnt-error">${summary.errors} error${summary.errors !== 1 ? 's' : ''}</span>
        <span class="pf-cnt-warning">${summary.warnings} warning${summary.warnings !== 1 ? 's' : ''}</span>
        <span class="pf-cnt-info">${summary.info} info</span>
      </div>
      <div class="pf-checks">${checksHTML}</div>
      ${breakdownHTML}
      ${gasHTML}
      <div class="pf-footer">
        <button class="pf-btn pf-btn-cancel" data-pf-action="cancel">Cancel</button>
        <button class="pf-btn pf-btn-proceed" data-pf-action="proceed" ${canProceed ? '' : 'disabled'}>
          ${canProceed ? 'Proceed' : 'Blocked'}
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  // Trigger entrance animation on next frame
  requestAnimationFrame(() => overlay.classList.add('pf-visible'));

  // ── Event handlers ──
  function close(proceedClicked) {
    overlay.classList.remove('pf-visible');
    setTimeout(() => overlay.remove(), 300);
    if (proceedClicked && typeof onProceed === 'function') onProceed();
    else if (typeof onCancel === 'function') onCancel();
  }

  // Click overlay background to close
  overlay.addEventListener('click', e => {
    if (e.target === overlay) close(false);
  });

  // Buttons
  overlay.querySelector('[data-pf-action="cancel"]').addEventListener('click', () => close(false));
  const proceedBtn = overlay.querySelector('[data-pf-action="proceed"]');
  if (canProceed) {
    proceedBtn.addEventListener('click', () => close(true));
  }

  // Expandable data toggles
  overlay.querySelectorAll('.pf-check-data-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const target = document.getElementById(toggle.getAttribute('data-target'));
      if (!target) return;
      const expanded = target.classList.toggle('pf-expanded');
      toggle.textContent = expanded ? 'Hide details' : 'Show details';
    });
  });

  // Escape key closes
  function onKey(e) {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', onKey);
      close(false);
    }
  }
  document.addEventListener('keydown', onKey);
}

// Legacy alias — old code may call showPreflightResult(result)
function showPreflightResult(result) {
  preflightShowModal(result, null, null);
}

/* ========================================================================
   4. INTEGRATION GATE
   ======================================================================== */

/**
 * One-call preflight gate: fetches the check, shows the modal, resolves
 * true when user clicks Proceed, false when Cancel.
 *
 * Usage:
 *   if (await preflightGate('token_send', myAddr, { amount, recipient, denom })) {
 *     // execute the real transaction
 *   }
 *
 * @param {string} txType
 * @param {string} sender
 * @param {object} params
 * @param {string} network
 * @returns {Promise<boolean>}
 */
async function preflightGate(txType, sender, params = {}, network) {
  const result = await preflightCheck(txType, sender, params, network);
  return new Promise(resolve => {
    preflightShowModal(
      result,
      () => resolve(true),   // Proceed
      () => resolve(false),  // Cancel
    );
  });
}

// Legacy alias
const preflightBeforeTx = preflightGate;

/* ========================================================================
   5. TOAST NOTIFICATION
   ======================================================================== */

let _pfToastTimeout = null;

/**
 * Show a small toast notification.
 *
 * @param {string} message
 * @param {'success'|'error'|'warning'} type
 * @param {number} duration  - ms (default 3500)
 */
function preflightToast(message, type = 'success', duration = 3500) {
  _pfInjectStyles();

  // Remove existing toast
  const old = document.querySelector('.preflight-toast');
  if (old) old.remove();
  if (_pfToastTimeout) clearTimeout(_pfToastTimeout);

  const el = document.createElement('div');
  el.className = `preflight-toast pf-toast-${type}`;
  el.textContent = message;
  document.body.appendChild(el);

  requestAnimationFrame(() => el.classList.add('pf-toast-visible'));

  _pfToastTimeout = setTimeout(() => {
    el.classList.remove('pf-toast-visible');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

/* ========================================================================
   HELPERS (private)
   ======================================================================== */

/** HTML-escape a string to prevent XSS */
function _pfEsc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// Legacy alias
const escapeHtml = _pfEsc;

/** Build one row of the amount breakdown */
function _pfBreakdownRow(label, value) {
  if (value === undefined || value === null) return '';
  return `
    <div class="pf-breakdown-row">
      <span class="pf-label">${_pfEsc(label)}</span>
      <span class="pf-breakdown-arrow">&rarr;</span>
      <span>${_pfEsc(String(value))}</span>
    </div>`;
}

/** Format a transaction type for display */
function formatTxType(txType) {
  const labels = {
    token_send: 'Token Send',
    token_issue: 'Token Issue',
    token_mint: 'Token Mint',
    token_burn: 'Token Burn',
    nft_mint: 'NFT Mint',
    nft_transfer: 'NFT Transfer',
    airdrop: 'Airdrop',
    dex_place_order: 'DEX Order',
    dex_order: 'DEX Order',
  };
  return labels[txType] || txType;
}
