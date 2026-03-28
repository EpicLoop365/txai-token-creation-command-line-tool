/* ===== TXAI - Multi-Wallet Integration (Keplr + Leap) ===== */
/* Part of the Solomente TXAI Compliance SDK */

window.txaiWallet = { address: '', signer: null, chainId: '', connected: false, provider: '' };

/* ---- Chain Configurations ---- */
const TXAI_CHAINS = {
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

const WALLET_LS_KEY = 'txai_wallet_connected';

/* ---- Wallet Detection ---- */

/** Detect which wallets are available */
function walletDetect() {
  return {
    keplr: !!window.keplr,
    leap: !!window.leap,
    cosmostation: !!window.cosmostation,
    any: !!window.keplr || !!window.leap || !!window.cosmostation,
  };
}

/** Get the provider object for a given wallet name */
function _walletGetProvider(name) {
  switch (name) {
    case 'keplr': return window.keplr;
    case 'leap': return window.leap;
    case 'cosmostation': return window.cosmostation?.providers?.keplr; // Cosmostation exposes keplr-compatible API
    default: return null;
  }
}

/** Auto-detect the best available wallet */
function walletAutoDetect() {
  if (window.leap) return 'leap';       // Prefer Leap (user's primary)
  if (window.keplr) return 'keplr';     // Fallback to Keplr
  if (window.cosmostation) return 'cosmostation';
  return null;
}

/* ---- Public API ---- */

/** Check if any supported wallet is available */
function keplrAvailable() {
  return walletDetect().any;
}

/** Connect to a specific wallet (or auto-detect) */
async function keplrConnect(chainId, preferredWallet) {
  const walletName = preferredWallet || walletAutoDetect();

  if (!walletName) {
    throw new Error('NO_WALLET_INSTALLED');
  }

  const provider = _walletGetProvider(walletName);
  if (!provider) {
    throw new Error(walletName.toUpperCase() + '_NOT_AVAILABLE');
  }

  chainId = chainId || _walletCurrentChainId();
  const config = TXAI_CHAINS[chainId];
  if (!config) throw new Error('Unknown chain: ' + chainId);

  // Suggest the chain so wallet knows about TX/Coreum
  if (provider.experimentalSuggestChain) {
    await provider.experimentalSuggestChain(config);
  }

  // Enable the chain (prompts user approval if first time)
  await provider.enable(chainId);

  // Get the offline signer
  let signer;
  try {
    signer = await provider.getOfflineSignerAuto(chainId);
  } catch {
    signer = provider.getOfflineSigner(chainId);
  }

  const accounts = await signer.getAccounts();
  if (!accounts || !accounts.length) {
    throw new Error('No accounts found in ' + walletName);
  }

  const address = accounts[0].address;

  // Update global state
  window.txaiWallet = { address, signer, chainId, connected: true, provider: walletName };

  // Persist connection preference
  localStorage.setItem(WALLET_LS_KEY, JSON.stringify({ chainId, address, wallet: walletName }));

  // Sync with existing wallet.js globals for backward compat
  if (typeof connectedAddress !== 'undefined') connectedAddress = address;
  if (typeof connectedOfflineSigner !== 'undefined') connectedOfflineSigner = signer;
  if (typeof walletMode !== 'undefined') walletMode = walletName;

  // Listen for account changes
  const changeEvent = walletName === 'leap' ? 'leap_keystorechange' : 'keplr_keystorechange';
  window.addEventListener(changeEvent, _walletOnAccountChange);

  console.log('[wallet] Connected via ' + walletName + ':', address);

  // Auto-mint Scout Pass + init token gate (non-blocking)
  setTimeout(async () => {
    try {
      if (typeof tokenGateInit === 'function') await tokenGateInit();
    } catch (e) {
      console.warn('[wallet] Token gate init failed:', e.message);
    }
  }, 500);

  return { address, signer, chainId, wallet: walletName };
}

/** Disconnect wallet and clear stored state */
function keplrDisconnect() {
  const prevProvider = window.txaiWallet.provider;
  window.txaiWallet = { address: '', signer: null, chainId: '', connected: false, provider: '' };
  localStorage.removeItem(WALLET_LS_KEY);

  const changeEvent = prevProvider === 'leap' ? 'leap_keystorechange' : 'keplr_keystorechange';
  window.removeEventListener(changeEvent, _walletOnAccountChange);

  // Sync with existing wallet.js globals
  if (typeof connectedAddress !== 'undefined') connectedAddress = '';
  if (typeof connectedOfflineSigner !== 'undefined') connectedOfflineSigner = null;
  if (typeof walletMode !== 'undefined') walletMode = 'agent';

  console.log('[wallet] Disconnected');
}

/** Get the currently connected address (or empty string) */
function keplrGetAddress() {
  return window.txaiWallet.connected ? window.txaiWallet.address : '';
}

/** Get the offline signer for signing transactions */
function keplrGetSigner() {
  return window.txaiWallet.connected ? window.txaiWallet.signer : null;
}

/* ---- Wallet Onboarding / Compliance Guide ---- */

/** Show wallet setup guidance for new users */
function walletShowGuide() {
  const detected = walletDetect();
  const modal = document.getElementById('walletConnectModal');
  if (!modal) return;

  // Build guide content based on what's detected
  let guideHTML = '';

  if (!detected.any) {
    guideHTML = `
      <div class="wallet-guide">
        <h3>Get Started with TX</h3>
        <p>To use TXAI, you need a Cosmos-compatible wallet. We recommend:</p>
        <div class="wallet-guide-options">
          <a href="https://www.leapwallet.io/download" target="_blank" class="wallet-guide-card recommended">
            <div class="wallet-guide-icon">🐸</div>
            <div class="wallet-guide-name">Leap Wallet</div>
            <div class="wallet-guide-desc">Best for TX/Coreum. Browser extension + mobile.</div>
            <span class="wallet-guide-badge">Recommended</span>
          </a>
          <a href="https://www.keplr.app/download" target="_blank" class="wallet-guide-card">
            <div class="wallet-guide-icon">🔑</div>
            <div class="wallet-guide-name">Keplr Wallet</div>
            <div class="wallet-guide-desc">Popular Cosmos wallet. Wide chain support.</div>
          </a>
        </div>
        <div class="wallet-guide-steps">
          <h4>Quick Setup (2 minutes):</h4>
          <ol>
            <li>Install the browser extension from the link above</li>
            <li>Create a new wallet (save your seed phrase securely!)</li>
            <li>Come back here and click "Connect Wallet"</li>
            <li>Your wallet will auto-detect TX/Coreum network</li>
            <li>You'll receive a free Scout Pass identity NFT</li>
          </ol>
        </div>
        <div class="wallet-guide-info">
          <strong>What is TX (Coreum)?</strong><br>
          TX is a Layer 1 blockchain built for enterprise. It features Smart Tokens
          with protocol-level rules (freezing, whitelisting, burning) and Smart NFTs
          that can carry executable scripts. Your wallet is your identity on the network.
        </div>
      </div>`;
  }

  // Inject guide into modal if no wallet detected
  if (guideHTML) {
    const guideContainer = modal.querySelector('.wallet-guide') || document.createElement('div');
    guideContainer.innerHTML = guideHTML;
    if (!modal.querySelector('.wallet-guide')) {
      modal.querySelector('.modal-content')?.appendChild(guideContainer);
    }
  }
}

/* ---- Wallet Connect Modal ---- */

/** Build the wallet selection modal dynamically based on detected wallets */
function walletBuildModal() {
  const detected = walletDetect();
  const container = document.getElementById('walletModalOptions');
  if (!container) return;

  let html = '';

  if (detected.leap) {
    html += `
      <div class="wallet-option ${!detected.keplr ? 'recommended' : ''}" onclick="walletConnectWith('leap')">
        <div class="wallet-option-icon">🐸</div>
        <div class="wallet-option-name">Leap Wallet</div>
        <div class="wallet-option-desc">Connect your Leap browser extension</div>
        ${!detected.keplr ? '<span class="wallet-option-badge">Detected</span>' : '<span class="wallet-option-badge">Detected</span>'}
      </div>`;
  }

  if (detected.keplr) {
    html += `
      <div class="wallet-option ${!detected.leap ? 'recommended' : ''}" onclick="walletConnectWith('keplr')">
        <div class="wallet-option-icon">🔑</div>
        <div class="wallet-option-name">Keplr Wallet</div>
        <div class="wallet-option-desc">Connect your Keplr browser extension</div>
        <span class="wallet-option-badge">Detected</span>
      </div>`;
  }

  // Always show Demo Wallet option
  html += `
    <div class="wallet-option demo" onclick="walletConnectDemo()">
      <div class="wallet-option-icon">🤖</div>
      <div class="wallet-option-name">Demo Wallet</div>
      <div class="wallet-option-desc">Try TXAI without a wallet. AI agent creates tokens for you on testnet.</div>
      <span class="wallet-option-badge secondary">No extension needed</span>
    </div>`;

  // If no wallet detected, add install links
  if (!detected.any) {
    html = `
      <div class="wallet-option install" onclick="window.open('https://www.leapwallet.io/download','_blank')">
        <div class="wallet-option-icon">🐸</div>
        <div class="wallet-option-name">Install Leap Wallet</div>
        <div class="wallet-option-desc">Recommended for TX/Coreum</div>
        <span class="wallet-option-badge">Recommended</span>
      </div>
      <div class="wallet-option install" onclick="window.open('https://www.keplr.app/download','_blank')">
        <div class="wallet-option-icon">🔑</div>
        <div class="wallet-option-name">Install Keplr Wallet</div>
        <div class="wallet-option-desc">Popular Cosmos ecosystem wallet</div>
      </div>` + html;
  }

  container.innerHTML = html;
}

/** Connect with a specific wallet from the modal */
async function walletConnectWith(walletName) {
  try {
    const result = await keplrConnect(null, walletName);
    // Close modal
    const modal = document.getElementById('walletConnectModal');
    if (modal) modal.style.display = 'none';
    // Update UI
    _walletUpdateNavUI(true);
    if (typeof updateGlobalWalletUI === 'function') {
      updateGlobalWalletUI(true, walletName);
    }
  } catch (err) {
    console.error('[wallet] Connect failed:', err);
    alert('Failed to connect ' + walletName + ': ' + err.message);
  }
}

/** Connect with demo wallet (agent mode) */
function walletConnectDemo() {
  const modal = document.getElementById('walletConnectModal');
  if (modal) modal.style.display = 'none';
  if (typeof connectAgentWallet === 'function') {
    connectAgentWallet();
  }
}

/* ---- Auto-Reconnect on Page Load ---- */
async function _walletAutoReconnect() {
  const stored = localStorage.getItem(WALLET_LS_KEY);
  if (!stored) return;

  try {
    const { chainId, wallet } = JSON.parse(stored);
    const walletName = wallet || 'keplr'; // backward compat with old key format

    const provider = _walletGetProvider(walletName);
    if (!provider) return; // Extension not loaded yet

    await keplrConnect(chainId, walletName);

    _walletUpdateNavUI(true);
    if (typeof updateGlobalWalletUI === 'function') {
      updateGlobalWalletUI(true, walletName);
    }
  } catch (err) {
    console.warn('[wallet] Auto-reconnect failed:', err.message);
    localStorage.removeItem(WALLET_LS_KEY);
  }
}

/* ---- Internal Helpers ---- */

function _walletCurrentChainId() {
  const net = window._txNetwork || 'testnet';
  return net === 'mainnet' ? 'coreum-mainnet-1' : 'coreum-testnet-1';
}

// Keep backward compat alias
function _keplrCurrentChainId() { return _walletCurrentChainId(); }

async function _walletOnAccountChange() {
  if (!window.txaiWallet.connected) return;
  try {
    const { chainId, provider: walletName } = window.txaiWallet;
    const walletProvider = _walletGetProvider(walletName);
    if (!walletProvider) return;

    let signer;
    try {
      signer = await walletProvider.getOfflineSignerAuto(chainId);
    } catch {
      signer = walletProvider.getOfflineSigner(chainId);
    }
    const accounts = await signer.getAccounts();
    if (accounts[0].address !== window.txaiWallet.address) {
      window.txaiWallet.address = accounts[0].address;
      window.txaiWallet.signer = signer;
      if (typeof connectedAddress !== 'undefined') connectedAddress = accounts[0].address;
      if (typeof connectedOfflineSigner !== 'undefined') connectedOfflineSigner = signer;
      _walletUpdateNavUI(true);
      if (typeof updateGlobalWalletUI === 'function') updateGlobalWalletUI(true, walletName);
    }
  } catch (err) {
    console.error('[wallet] Account change error:', err);
  }
}

/** Update the nav bar connect/badge display */
function _walletUpdateNavUI(connected) {
  const btn = document.getElementById('navConnectBtn');
  const badge = document.getElementById('navConnectedBadge');
  const addrEl = document.getElementById('navConnectedAddr');
  if (!btn || !badge || !addrEl) return;

  if (connected && window.txaiWallet.address) {
    const addr = window.txaiWallet.address;
    const provider = window.txaiWallet.provider || 'wallet';
    const provLabels = { keplr: 'Keplr', leap: 'Leap', cosmostation: 'Cosmostation', agent: 'Demo' };
    const provLabel = provLabels[provider] || provider.charAt(0).toUpperCase() + provider.slice(1);
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

// Backward compat alias
function _keplrUpdateNavUI(connected) { _walletUpdateNavUI(connected); }

/* ---- Init: auto-reconnect when DOM is ready ---- */
window.addEventListener('load', function() {
  setTimeout(_walletAutoReconnect, 600);
  // Build dynamic wallet modal after a short delay
  setTimeout(walletBuildModal, 100);
});
