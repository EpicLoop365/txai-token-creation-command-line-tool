/* ===== TXAI - Keplr Wallet Integration ===== */

/* Global wallet state — shared across all tabs/modules */
window.txaiWallet = { address: '', signer: null, chainId: '', connected: false, provider: '' };

/* ---- Chain Configurations ---- */
const KEPLR_CHAINS = {
  'coreum-testnet-1': {
    chainId: 'coreum-testnet-1',
    chainName: 'TX Testnet',
    rpc: 'https://full-node.testnet-1.coreum.dev:26657',
    rest: 'https://full-node.testnet-1.coreum.dev:1317',
    bip44: { coinType: 990 },
    bech32Config: {
      bech32PrefixAccAddr: 'testcore',
      bech32PrefixAccPub: 'testcorepub',
      bech32PrefixValAddr: 'testcorevaloper',
      bech32PrefixValPub: 'testcorevaloperpub',
      bech32PrefixConsAddr: 'testcorevalcons',
      bech32PrefixConsPub: 'testcorevalconspub',
    },
    currencies: [{ coinDenom: 'TESTCORE', coinMinimalDenom: 'utestcore', coinDecimals: 6 }],
    feeCurrencies: [{
      coinDenom: 'TESTCORE', coinMinimalDenom: 'utestcore', coinDecimals: 6,
      gasPriceStep: { low: 0.1, average: 0.15, high: 0.25 }
    }],
    stakeCurrency: { coinDenom: 'TESTCORE', coinMinimalDenom: 'utestcore', coinDecimals: 6 },
    features: [],
  },
  'coreum-mainnet-1': {
    chainId: 'coreum-mainnet-1',
    chainName: 'TX Mainnet',
    rpc: 'https://full-node.mainnet-1.coreum.dev:26657',
    rest: 'https://full-node.mainnet-1.coreum.dev:1317',
    bip44: { coinType: 990 },
    bech32Config: {
      bech32PrefixAccAddr: 'core',
      bech32PrefixAccPub: 'corepub',
      bech32PrefixValAddr: 'corevaloper',
      bech32PrefixValPub: 'corevaloperpub',
      bech32PrefixConsAddr: 'corevalcons',
      bech32PrefixConsPub: 'corevalconspub',
    },
    currencies: [{ coinDenom: 'CORE', coinMinimalDenom: 'ucore', coinDecimals: 6 }],
    feeCurrencies: [{
      coinDenom: 'CORE', coinMinimalDenom: 'ucore', coinDecimals: 6,
      gasPriceStep: { low: 0.1, average: 0.15, high: 0.25 }
    }],
    stakeCurrency: { coinDenom: 'CORE', coinMinimalDenom: 'ucore', coinDecimals: 6 },
    features: [],
  }
};

const KEPLR_LS_KEY = 'txai_keplr_connected';

/* ---- Public API ---- */

/** Check if Keplr extension is available */
function keplrAvailable() {
  return !!window.keplr;
}

/** Suggest a Coreum chain config to Keplr */
async function keplrSuggestChain(chainId) {
  const config = KEPLR_CHAINS[chainId];
  if (!config) throw new Error('Unknown chain: ' + chainId);
  if (window.keplr.experimentalSuggestChain) {
    await window.keplr.experimentalSuggestChain(config);
  }
}

/** Connect to Keplr wallet for a given chainId */
async function keplrConnect(chainId) {
  if (!keplrAvailable()) {
    throw new Error('KEPLR_NOT_INSTALLED');
  }

  chainId = chainId || _keplrCurrentChainId();

  // Suggest the chain so Keplr knows about Coreum
  await keplrSuggestChain(chainId);

  // Enable the chain (prompts user approval if first time)
  await window.keplr.enable(chainId);

  // Get the offline signer
  let signer;
  try {
    signer = await window.keplr.getOfflineSignerAuto(chainId);
  } catch {
    signer = window.keplr.getOfflineSigner(chainId);
  }

  const accounts = await signer.getAccounts();
  if (!accounts || !accounts.length) {
    throw new Error('No accounts found in Keplr');
  }

  const address = accounts[0].address;

  // Update global state
  window.txaiWallet = { address, signer, chainId, connected: true, provider: 'keplr' };

  // Persist connection preference
  localStorage.setItem(KEPLR_LS_KEY, JSON.stringify({ chainId, address }));

  // Also sync with existing wallet.js globals for backward compat
  if (typeof connectedAddress !== 'undefined') connectedAddress = address;
  if (typeof connectedOfflineSigner !== 'undefined') connectedOfflineSigner = signer;
  if (typeof walletMode !== 'undefined') walletMode = 'keplr';

  // Listen for account changes
  window.addEventListener('keplr_keystorechange', _keplrOnAccountChange);

  console.log('[keplr] Connected:', address);

  // Auto-mint Scout Pass + init token gate (non-blocking)
  setTimeout(async () => {
    try {
      if (typeof tokenGateInit === 'function') await tokenGateInit();
    } catch (e) {
      console.warn('[keplr] Token gate init failed:', e.message);
    }
  }, 500);

  return { address, signer, chainId };
}

/** Disconnect Keplr wallet and clear stored state */
function keplrDisconnect() {
  window.txaiWallet = { address: '', signer: null, chainId: '', connected: false, provider: '' };
  localStorage.removeItem(KEPLR_LS_KEY);
  window.removeEventListener('keplr_keystorechange', _keplrOnAccountChange);

  // Sync with existing wallet.js globals
  if (typeof connectedAddress !== 'undefined') connectedAddress = '';
  if (typeof connectedOfflineSigner !== 'undefined') connectedOfflineSigner = null;
  if (typeof walletMode !== 'undefined') walletMode = 'agent';

  console.log('[keplr] Disconnected');
}

/** Get the currently connected address (or empty string) */
function keplrGetAddress() {
  return window.txaiWallet.connected ? window.txaiWallet.address : '';
}

/** Get the offline signer for signing transactions */
function keplrGetSigner() {
  return window.txaiWallet.connected ? window.txaiWallet.signer : null;
}

/* ---- Auto-Reconnect on Page Load ---- */
async function _keplrAutoReconnect() {
  const stored = localStorage.getItem(KEPLR_LS_KEY);
  if (!stored) return;

  try {
    const { chainId } = JSON.parse(stored);
    if (!keplrAvailable()) return; // Extension not loaded yet

    await keplrConnect(chainId);

    // Update the nav UI silently
    _keplrUpdateNavUI(true);
    // updateGlobalWalletUI may not be loaded yet (defined in wallet.js),
    // so call it safely
    if (typeof updateGlobalWalletUI === 'function') {
      updateGlobalWalletUI(true, 'keplr');
    }
  } catch (err) {
    console.warn('[keplr] Auto-reconnect failed:', err.message);
    localStorage.removeItem(KEPLR_LS_KEY);
  }
}

/* ---- Internal Helpers ---- */

function _keplrCurrentChainId() {
  const net = window._txNetwork || 'testnet';
  return net === 'mainnet' ? 'coreum-mainnet-1' : 'coreum-testnet-1';
}

async function _keplrOnAccountChange() {
  if (!window.txaiWallet.connected || window.txaiWallet.provider !== 'keplr') return;
  try {
    const chainId = window.txaiWallet.chainId;
    let signer;
    try {
      signer = await window.keplr.getOfflineSignerAuto(chainId);
    } catch {
      signer = window.keplr.getOfflineSigner(chainId);
    }
    const accounts = await signer.getAccounts();
    if (accounts[0].address !== window.txaiWallet.address) {
      window.txaiWallet.address = accounts[0].address;
      window.txaiWallet.signer = signer;
      if (typeof connectedAddress !== 'undefined') connectedAddress = accounts[0].address;
      if (typeof connectedOfflineSigner !== 'undefined') connectedOfflineSigner = signer;
      _keplrUpdateNavUI(true);
      updateGlobalWalletUI(true, 'keplr');
    }
  } catch (err) {
    console.error('[keplr] Account change error:', err);
  }
}

/** Update the nav bar connect/badge display */
function _keplrUpdateNavUI(connected) {
  const btn = document.getElementById('navConnectBtn');
  const badge = document.getElementById('navConnectedBadge');
  const addrEl = document.getElementById('navConnectedAddr');
  if (!btn || !badge || !addrEl) return;

  if (connected && window.txaiWallet.address) {
    const addr = window.txaiWallet.address;
    const provider = window.txaiWallet.provider || 'keplr';
    const provLabel = provider.charAt(0).toUpperCase() + provider.slice(1);
    const truncated = addr.slice(0, 10) + '...' + addr.slice(-4);

    btn.style.display = 'none';
    badge.style.display = 'inline-flex';
    addrEl.innerHTML = '<span class="nav-wallet-provider-tag">' + provLabel + '</span> ' + truncated;
    addrEl.title = addr;
  } else {
    btn.style.display = '';
    badge.style.display = 'none';
    addrEl.textContent = '';
    addrEl.title = '';
  }
}

/* ---- Init: auto-reconnect when DOM is ready ---- */
// Keplr extension injects window.keplr after page load, so we wait a moment.
// wallet.js loads synchronously right after this file, so updateGlobalWalletUI
// will be available by the time the timeout fires.
window.addEventListener('load', function() {
  setTimeout(_keplrAutoReconnect, 600);
});
