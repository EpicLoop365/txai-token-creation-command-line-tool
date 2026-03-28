/* ===== TXAI — Token Gate (NFT-gated access) ===== */
/*
 * Checks if the connected wallet holds a Creator Pass NFT.
 * If not, shows an inline "Get Access" prompt.
 * Gate is checked client-side (optimistic) and enforced server-side.
 *
 * Usage in any tool:
 *   if (await tokenGateCheck('nftAdExecuteBtn')) return;  // blocks if no pass
 */

const GATE_CACHE_KEY = 'txai_gate_status';
let gateStatusCache = null;
let gateCheckPending = false;

/* ── Check gate status ── */
async function tokenGateCheck(blockElementId) {
  // Get wallet
  const wallet = (window.txaiWallet && window.txaiWallet.address)
    || (typeof connectedAddress !== 'undefined' && connectedAddress)
    || null;

  // If no wallet connected, show connect prompt
  if (!wallet) {
    tokenGateShowPrompt(blockElementId, 'connect');
    return true; // blocked
  }

  // Check cache first (valid for 60s)
  if (gateStatusCache && (Date.now() - gateStatusCache.ts < 60000)) {
    if (gateStatusCache.hasPass) return false; // allowed
    tokenGateShowPrompt(blockElementId, 'nopass');
    return true; // blocked
  }

  // Query server
  try {
    const res = await fetch(API_URL + '/api/gate-status?wallet=' + encodeURIComponent(wallet));
    const data = await res.json();

    // If gate is disabled, allow everything
    if (!data.gated) {
      gateStatusCache = { hasPass: true, ts: Date.now() };
      return false;
    }

    gateStatusCache = { hasPass: data.hasPass, ts: Date.now(), passDenom: data.passDenom };

    if (!data.hasPass) {
      tokenGateShowPrompt(blockElementId, 'nopass');
      return true; // blocked
    }

    return false; // allowed
  } catch {
    // Fail open — if we can't check, allow (server will enforce)
    return false;
  }
}

/* ── Show gate prompt inline ── */
function tokenGateShowPrompt(nearElementId, reason) {
  // Remove existing prompt if any
  const existing = document.getElementById('tokenGatePrompt');
  if (existing) existing.remove();

  const el = document.getElementById(nearElementId);
  if (!el) return;

  const prompt = document.createElement('div');
  prompt.id = 'tokenGatePrompt';
  prompt.className = 'token-gate-prompt';

  if (reason === 'connect') {
    prompt.innerHTML = `
      <div class="token-gate-icon">🔐</div>
      <div class="token-gate-text">
        <strong>Connect your wallet</strong>
        <span>This tool requires a connected wallet.</span>
      </div>
      <button class="token-gate-btn" onclick="globalShowWalletOptions()">Connect Wallet</button>
    `;
  } else {
    prompt.innerHTML = `
      <div class="token-gate-icon">🎫</div>
      <div class="token-gate-text">
        <strong>Creator Pass required</strong>
        <span>Hold a Creator Pass NFT to unlock this tool. Free tools: Token creation, NFT minting, Exchange.</span>
      </div>
      <button class="token-gate-btn" onclick="tokenGateMintPass()">Get Creator Pass</button>
      <button class="token-gate-dismiss" onclick="this.parentElement.remove()">✕</button>
    `;
  }

  el.parentElement.insertBefore(prompt, el);

  // Auto-dismiss after 12s
  setTimeout(() => { if (prompt.parentElement) prompt.remove(); }, 12000);
}

/* ── Mint/buy a Creator Pass ── */
function tokenGateMintPass() {
  // Switch to subscriptions tab where passes can be purchased
  if (typeof switchTab === 'function') {
    switchTab('subs');
  }
  const prompt = document.getElementById('tokenGatePrompt');
  if (prompt) prompt.remove();
}

/* ── Clear cache (call on wallet change) ── */
function tokenGateClearCache() {
  gateStatusCache = null;
}

/* ── Handle gated API responses ── */
function tokenGateHandleResponse(data) {
  if (data && data.gated === true) {
    // Server blocked us — invalidate cache
    gateStatusCache = { hasPass: false, ts: Date.now(), passDenom: data.passDenom };
    return true; // was blocked
  }
  return false;
}
