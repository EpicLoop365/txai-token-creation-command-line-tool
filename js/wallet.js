/* ===== TXAI - Global Wallet Connection (Multi-Wallet) ===== */
/* Part of the Solomente TXAI Compliance SDK */

function globalShowWalletOptions(){
  const overlay = document.getElementById('walletChoiceOverlay');
  if(!overlay) return;
  const modal = overlay.querySelector('.wallet-choice-modal');
  const detected = walletDetect();

  // Build wallet cards dynamically
  let cardsHTML = '';

  if (detected.leap) {
    cardsHTML += `
      <div class="wallet-choice-card wallet-choice-card--primary recommended" onclick="navConnectWallet('leap')">
        <div class="wc-icon" style="font-size:1.5rem">🐸</div>
        <div class="wc-label">Leap Wallet</div>
        <div class="wc-desc">Connect your Leap browser extension to sign transactions and own your tokens.</div>
        <span class="wc-badge own">Recommended</span>
      </div>`;
  }

  if (detected.keplr) {
    cardsHTML += `
      <div class="wallet-choice-card wallet-choice-card--primary ${!detected.leap ? 'recommended' : ''}" onclick="navConnectWallet('keplr')">
        <div class="wc-icon"><svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" rx="8" fill="#7B6FE8"/><path d="M11 29V11H15.5V18.2L22.1 11H28L20.5 19.1L28.5 29H22.3L16.8 21.5L15.5 22.9V29H11Z" fill="white"/></svg></div>
        <div class="wc-label">Keplr Wallet</div>
        <div class="wc-desc">Connect your Keplr browser extension to sign transactions and own your tokens.</div>
        <span class="wc-badge own">Full control</span>
      </div>`;
  }

  // Always show Demo option
  cardsHTML += `
    <div class="wallet-choice-card wallet-choice-card--secondary" onclick="navConnectDemo()">
      <div class="wc-icon" style="font-size:1.5rem">&#129302;</div>
      <div class="wc-label">Demo Wallet</div>
      <div class="wc-desc">Try TXAI without a wallet. AI agent creates tokens for you on testnet.</div>
      <span class="wc-badge free">No extension needed</span>
    </div>`;

  // Install hints if no wallet detected
  let installHTML = '';
  if (!detected.any) {
    installHTML = `
      <div class="wallet-choice-install-hint">
        <span>No wallet detected.</span>
        <a href="https://www.leapwallet.io/download" target="_blank" rel="noopener">Install Leap</a> or
        <a href="https://www.keplr.app/download" target="_blank" rel="noopener">Install Keplr</a>
      </div>`;
  }

  modal.innerHTML = `
    <div class="wallet-choice-title">Connect Your Wallet</div>
    <div class="wallet-choice-subtitle">Choose a wallet to connect to TXAI</div>
    <div class="wallet-choice-cards wallet-choice-cards--nav">
      ${cardsHTML}
    </div>
    ${installHTML}
    <button class="wallet-choice-dismiss" onclick="closeWalletChoice()">Cancel</button>
  `;

  overlay.style.display = 'flex';
  overlay.classList.add('show');
}

/** Connect any detected wallet */
async function navConnectWallet(walletName){
  closeWalletChoice();
  try {
    const result = await keplrConnect(null, walletName);
    _walletUpdateNavUI(true);
    updateGlobalWalletUI(true, walletName);
  } catch(err){
    console.error('[wallet] Connect error:', err);
    const name = walletName.charAt(0).toUpperCase() + walletName.slice(1);
    alert('Failed to connect ' + name + ': ' + (err.message || err));
  }
}

/** Backward compat */
async function navConnectKeplr(){ return navConnectWallet('keplr'); }

/** Called when user picks Demo wallet */
function navConnectDemo(){
  closeWalletChoice();
  walletMode = 'agent';
  connectedAddress = '';
  connectedOfflineSigner = null;
  const btn = document.getElementById('navConnectBtn');
  const badge = document.getElementById('navConnectedBadge');
  const addrEl = document.getElementById('navConnectedAddr');
  if(btn && badge && addrEl){
    btn.style.display = 'none';
    badge.style.display = 'inline-flex';
    addrEl.innerHTML = '<span class="nav-wallet-provider-tag demo">Demo</span> Agent Wallet';
    addrEl.title = 'Demo mode - AI agent wallet';
  }
  updateGlobalWalletUI(false);
}

function _oldGlobalShowWalletDropdown(){
  const dd = document.getElementById('gwDropdown');
  if(!dd) return;
  dd.classList.toggle('show');
  const handler = (e) => {
    if(!document.getElementById('globalWalletBar').contains(e.target)){
      dd.classList.remove('show');
      document.removeEventListener('click', handler);
    }
  };
  setTimeout(() => document.addEventListener('click', handler), 10);
}

function isMobileDevice(){
  return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && window.innerWidth < 1024);
}

async function globalConnectWallet(provider){
  document.getElementById('gwDropdown').classList.remove('show');

  const walletObj = _walletGetProvider(provider);
  if(!walletObj){
    if(isMobileDevice()){
      const siteUrl = encodeURIComponent(window.location.href);
      showMobileWalletModal(provider, siteUrl);
    } else {
      const name = provider === 'keplr' ? 'Keplr' : 'Leap';
      const url = provider === 'keplr' ? 'https://www.keplr.app/download' : 'https://www.leapwallet.io/download';
      alert(name + ' wallet extension not found.\n\nPlease install it from:\n' + url);
    }
    return;
  }

  try {
    const result = await keplrConnect(null, provider);
    updateGlobalWalletUI(true, provider);
    console.log('Connected ' + provider + ' wallet: ' + result.address);
  } catch(err){
    console.error('Wallet connect error:', err);
    alert('Failed to connect wallet: ' + (err.message || err));
  }
}

function globalDisconnectWallet(){
  keplrDisconnect();
  walletMode = 'agent';
  connectedAddress = '';
  connectedOfflineSigner = null;
  updateGlobalWalletUI(false);
  _walletUpdateNavUI(false);
  window.removeEventListener('keplr_keystorechange', globalOnAccountChange);
  window.removeEventListener('leap_keystorechange', globalOnAccountChange);
}

async function fundWallet(){
  const addr = connectedAddress || dexAgentWallet;
  if(!addr){ alert('No wallet address to fund.'); return; }
  const btns = document.querySelectorAll('.gw-fund-btn');
  btns.forEach(b => { b.dataset.origText = b.textContent; b.textContent = 'Requesting...'; b.disabled = true; });
  try {
    const res = await fetch(API_URL + '/api/faucet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: addr })
    });
    const data = await res.json();
    if(data.success){
      btns.forEach(b => { b.textContent = 'Funded!'; b.style.borderColor = 'var(--green)'; });
      setTimeout(() => {
        dexFetchBalances(addr);
        btns.forEach(b => { b.textContent = b.dataset.origText; b.disabled = false; b.style.borderColor = ''; });
      }, 3000);
    } else {
      btns.forEach(b => {
        b.textContent = 'Failed';
        setTimeout(() => { b.textContent = b.dataset.origText; b.disabled = false; }, 3000);
      });
    }
  } catch(err){
    btns.forEach(b => { b.textContent = b.dataset.origText; b.disabled = false; });
    alert('Faucet request failed: ' + (err.message || 'Unknown error'));
  }
}

function updateGlobalWalletUI(connected, provider){
  document.getElementById('gwAgent').style.display = connected ? 'none' : '';
  document.getElementById('gwConnected').style.display = connected ? 'flex' : 'none';
  document.getElementById('gwActions').style.display = connected ? 'none' : '';
  document.getElementById('gwDisconnectWrap').style.display = connected ? '' : 'none';

  if(connected){
    const provLabels = { keplr: 'Keplr', leap: 'Leap', cosmostation: 'Cosmostation' };
    const provName = provLabels[provider] || 'Wallet';
    document.getElementById('gwProviderBadge').textContent = provName;
    document.getElementById('gwAddr').textContent = connectedAddress.slice(0, 12) + '...' + connectedAddress.slice(-4);
    document.getElementById('gwAddr').title = connectedAddress;
  }

  _walletUpdateNavUI(connected);

  const modeBadge = document.getElementById('dexModeBadge');
  const walletAddr = document.getElementById('dexWalletAddr');
  if(modeBadge){
    if(connected){
      modeBadge.className = 'dex-wallet-mode-badge connected';
      const provLabels = { keplr: 'Keplr', leap: 'Leap' };
      modeBadge.textContent = provLabels[provider] || 'Wallet';
    } else {
      modeBadge.className = 'dex-wallet-mode-badge agent';
      modeBadge.textContent = 'Agent';
    }
  }
  if(walletAddr){
    walletAddr.textContent = connected ? connectedAddress : (dexAgentWallet || 'Loading...');
  }

  const demoBtn = document.getElementById('demoBtn');
  if(demoBtn) demoBtn.textContent = 'Deploy Token (Testnet)';

  const activeAddr = connected ? connectedAddress : dexAgentWallet;
  if(activeAddr) dexFetchBalances(activeAddr);
  if(dexBaseDenom) dexFetchMyOrders();
  if(typeof dexFetchPairs === 'function') dexFetchPairs();
  if(typeof dexUpdateAddWalletBtn === 'function') dexUpdateAddWalletBtn();
}

async function globalOnAccountChange(){
  if(walletMode === 'agent') return;
  try {
    const walletProvider = _walletGetProvider(walletMode);
    if (!walletProvider) return;
    let signer;
    try {
      signer = await walletProvider.getOfflineSignerAuto(COREUM_CHAIN_ID);
    } catch {
      signer = walletProvider.getOfflineSigner(COREUM_CHAIN_ID);
    }
    const accounts = await signer.getAccounts();
    if(accounts[0].address !== connectedAddress){
      connectedAddress = accounts[0].address;
      connectedOfflineSigner = signer;
      updateGlobalWalletUI(true, walletMode);
    }
  } catch(err){ console.error('Account change error:', err); }
}

function dexGetActiveAddress(){
  return walletMode !== 'agent' ? connectedAddress : dexAgentWallet;
}

/* ---- Register a custom token with Leap/Keplr so it shows in wallet ---- */
async function registerTokenWithWallet(denom, symbol, decimals) {
  if (walletMode === 'agent' || !connectedAddress) return;
  const walletObj = _walletGetProvider(walletMode);
  if (!walletObj || !walletObj.experimentalSuggestChain) return;

  try {
    const updatedChainInfo = JSON.parse(JSON.stringify(COREUM_CHAIN_INFO));
    const alreadyExists = updatedChainInfo.currencies.some(c => c.coinMinimalDenom === denom);
    if (!alreadyExists) {
      updatedChainInfo.currencies.push({
        coinDenom: symbol.toUpperCase(),
        coinMinimalDenom: denom,
        coinDecimals: decimals || 6,
      });
    }
    await walletObj.experimentalSuggestChain(updatedChainInfo);
    console.log('Registered token ' + symbol + ' (' + denom + ') with ' + walletMode + ' wallet');
  } catch (err) {
    console.warn('Could not register token with wallet:', err.message);
  }
}

/* ---- Client-Side Transaction (Keplr/Leap) ---- */

async function dexBuildAndSignTx(messages, gasLimit){
  const accounts = await connectedOfflineSigner.getAccounts();
  const pubkeyBytes = accounts[0].pubkey;
  const pubkeyHex = Array.from(pubkeyBytes).map(b => b.toString(16).padStart(2, '0')).join('');

  const buildRes = await fetch(API_URL + '/api/build-tx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signerAddress: connectedAddress,
      messages: messages,
      gasLimit: gasLimit || 300000,
      pubkeyHex: pubkeyHex,
    })
  });

  if(!buildRes.ok){
    const err = await buildRes.json();
    throw new Error(err.error || 'Failed to build transaction');
  }

  const txData = await buildRes.json();
  const bodyBytes = new Uint8Array(txData.bodyBytes.match(/.{1,2}/g).map(b => parseInt(b, 16)));
  const authInfoBytes = new Uint8Array(txData.authInfoBytes.match(/.{1,2}/g).map(b => parseInt(b, 16)));

  const walletObj = _walletGetProvider(walletMode);

  const signDoc = {
    bodyBytes: bodyBytes,
    authInfoBytes: authInfoBytes,
    chainId: txData.chainId,
    accountNumber: '' + txData.accountNumber,
  };

  const signResponse = await walletObj.signDirect(
    txData.chainId,
    connectedAddress,
    signDoc,
    { preferNoSetFee: true, preferNoSetMemo: true }
  );

  const signed = signResponse.signed;
  const signature = signResponse.signature.signature;

  function encodeLenDelim(fieldNum, bytes){
    const fieldTag = (fieldNum << 3) | 2;
    const len = bytes.length;
    const lenBytes = [];
    let v = len;
    while(v > 0x7f){ lenBytes.push((v & 0x7f) | 0x80); v >>>= 7; }
    lenBytes.push(v & 0x7f);
    return new Uint8Array([fieldTag, ...lenBytes, ...bytes]);
  }

  const signedBodyBytes = signed.bodyBytes instanceof Uint8Array
    ? signed.bodyBytes
    : new Uint8Array(Object.values(signed.bodyBytes));
  const signedAuthInfoBytes = signed.authInfoBytes instanceof Uint8Array
    ? signed.authInfoBytes
    : new Uint8Array(Object.values(signed.authInfoBytes));

  const sigBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));

  const parts = [
    encodeLenDelim(1, signedBodyBytes),
    encodeLenDelim(2, signedAuthInfoBytes),
    encodeLenDelim(3, sigBytes),
  ];
  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const txRaw = new Uint8Array(totalLen);
  let offset = 0;
  for(const p of parts){ txRaw.set(p, offset); offset += p.length; }

  const txRawB64 = btoa(String.fromCharCode(...txRaw));

  const broadcastRes = await fetch(COREUM_REST + '/cosmos/tx/v1beta1/txs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tx_bytes: txRawB64,
      mode: 'BROADCAST_MODE_SYNC',
    })
  });

  const broadcastData = await broadcastRes.json();

  if(broadcastData.tx_response && broadcastData.tx_response.code !== 0){
    throw new Error(broadcastData.tx_response.raw_log || 'TX failed with code ' + broadcastData.tx_response.code);
  }

  return broadcastData.tx_response || broadcastData;
}

/* ---- Mobile Wallet Modal ---- */
function showMobileWalletModal(provider, encodedUrl){
  const existing = document.getElementById('mobileWalletModal');
  if(existing) existing.remove();

  const name = provider === 'keplr' ? 'Keplr' : 'Leap';
  const icon = provider === 'keplr'
    ? 'https://raw.githubusercontent.com/nicolaracco/kepler-ui/main/packages/icons/src/icons/keplr-logo.svg'
    : 'https://assets.leapwallet.io/logos/leap-cosmos-logo.svg';
  const appStoreUrl = provider === 'keplr'
    ? 'https://www.keplr.app/download'
    : 'https://www.leapwallet.io/download';

  const modal = document.createElement('div');
  modal.id = 'mobileWalletModal';
  modal.className = 'dex-deposit-overlay';
  modal.onclick = (e) => { if(e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="dex-deposit-panel" style="max-width:400px">
      <div class="dex-deposit-header">
        <h3 style="display:flex;align-items:center;gap:8px">
          <img src="${icon}" alt="${name}" style="width:24px;height:24px" onerror="this.style.display='none'">
          ${name} on Mobile
        </h3>
        <button class="dex-demo-close" onclick="document.getElementById('mobileWalletModal').remove()">&#10005;</button>
      </div>
      <div class="dex-deposit-body" style="text-align:center">
        <p style="margin-bottom:16px;color:var(--text-dim);font-size:.9rem">
          On mobile, open this site inside the <strong>${name}</strong> wallet app's built-in browser.
        </p>
        <div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;margin-bottom:16px;text-align:left">
          <p style="font-weight:700;margin-bottom:10px;font-size:.9rem">How to connect:</p>
          <ol style="padding-left:20px;color:var(--text-dim);font-size:.84rem;line-height:1.8">
            <li>Open the <strong>${name}</strong> app on your phone</li>
            <li>Go to the <strong>Browser</strong> tab inside the app</li>
            <li>Navigate to <strong>solomentelabs.com</strong></li>
            <li>Tap <strong>Connect Wallet</strong></li>
          </ol>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <button class="dex-deposit-check-btn" onclick="navigator.clipboard.writeText('${decodeURIComponent(encodedUrl)}').then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy Site URL',1500)})" style="background:linear-gradient(135deg,#7c3aed,#a855f7)">
            Copy Site URL
          </button>
          <a href="${appStoreUrl}" target="_blank" style="display:inline-block;padding:10px 20px;background:linear-gradient(135deg,var(--green),var(--green-dim));border-radius:var(--radius-sm);color:#fff;font-weight:600;font-size:.9rem;text-align:center;text-decoration:none">
            Install ${name} App
          </a>
          <button class="dex-deposit-check-btn" onclick="document.getElementById('mobileWalletModal').remove()" style="background:var(--bg4);border:1px solid var(--border)">
            Cancel
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}
