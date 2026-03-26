/* ===== TXAI - Global Wallet Connection ===== */
function globalShowWalletOptions(){
  const dd = document.getElementById('gwDropdown');
  dd.classList.toggle('show');
  const handler = (e) => {
    if(!document.getElementById('globalWalletBar').contains(e.target)){
      dd.classList.remove('show');
      document.removeEventListener('click', handler);
    }
  };
  setTimeout(() => document.addEventListener('click', handler), 10);
}

async function globalConnectWallet(provider){
  document.getElementById('gwDropdown').classList.remove('show');

  const walletObj = provider === 'keplr' ? window.keplr : window.leap;
  if(!walletObj){
    alert(`${provider === 'keplr' ? 'Keplr' : 'Leap'} wallet extension not found.\n\nPlease install it from:\n${
      provider === 'keplr' ? 'https://www.keplr.app/download' : 'https://www.leapwallet.io/download'
    }`);
    return;
  }

  try {
    if(walletObj.experimentalSuggestChain) await walletObj.experimentalSuggestChain(COREUM_CHAIN_INFO);
    await walletObj.enable(COREUM_CHAIN_ID);

    const signer = walletObj.getOfflineSigner
      ? walletObj.getOfflineSigner(COREUM_CHAIN_ID)
      : await walletObj.getOfflineSignerAuto(COREUM_CHAIN_ID);
    const accounts = await signer.getAccounts();
    if(!accounts || !accounts.length){ alert('No accounts found.'); return; }

    connectedAddress = accounts[0].address;
    connectedOfflineSigner = signer;
    walletMode = provider;

    updateGlobalWalletUI(true, provider);
    window.addEventListener('keplr_keystorechange', globalOnAccountChange);
    console.log(`Connected ${provider} wallet: ${connectedAddress}`);
  } catch(err){
    console.error('Wallet connect error:', err);
    alert('Failed to connect wallet: ' + (err.message || err));
  }
}

function globalDisconnectWallet(){
  walletMode = 'agent';
  connectedAddress = '';
  connectedOfflineSigner = null;
  updateGlobalWalletUI(false);
  window.removeEventListener('keplr_keystorechange', globalOnAccountChange);
}

async function fundWallet(){
  // Use server proxy to call the Coreum testnet faucet (avoids CORS)
  const addr = connectedAddress || dexAgentWallet;
  if(!addr){ alert('No wallet address to fund.'); return; }
  // Find whichever fund button was clicked
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
      // Refresh balances after a short delay
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
  // Global wallet bar
  document.getElementById('gwAgent').style.display = connected ? 'none' : '';
  document.getElementById('gwConnected').style.display = connected ? 'flex' : 'none';
  document.getElementById('gwActions').style.display = connected ? 'none' : '';
  document.getElementById('gwDisconnectWrap').style.display = connected ? '' : 'none';

  if(connected){
    const provName = provider === 'keplr' ? 'Keplr' : 'Leap';
    document.getElementById('gwProviderBadge').textContent = provName;
    document.getElementById('gwAddr').textContent = connectedAddress.slice(0, 12) + '...' + connectedAddress.slice(-4);
    document.getElementById('gwAddr').title = connectedAddress;
  }

  // Update DEX order form info
  const modeBadge = document.getElementById('dexModeBadge');
  const walletAddr = document.getElementById('dexWalletAddr');
  if(modeBadge){
    if(connected){
      modeBadge.className = 'dex-wallet-mode-badge connected';
      modeBadge.textContent = provider === 'keplr' ? 'Keplr' : 'Leap';
    } else {
      modeBadge.className = 'dex-wallet-mode-badge agent';
      modeBadge.textContent = 'Agent';
    }
  }
  if(walletAddr){
    walletAddr.textContent = connected ? connectedAddress : (dexAgentWallet || 'Loading...');
  }

  // Update Create tab button text — always same label, modal handles the choice
  const demoBtn = document.getElementById('demoBtn');
  if(demoBtn){
    demoBtn.textContent = 'Deploy Token (Testnet)';
  }

  // Fetch balances for active address
  const activeAddr = connected ? connectedAddress : dexAgentWallet;
  if(activeAddr) dexFetchBalances(activeAddr);
  if(dexBaseDenom) dexFetchMyOrders();

  // Refresh DEX pairs to include connected wallet's tokens
  if(typeof dexFetchPairs === 'function') dexFetchPairs();
}

async function globalOnAccountChange(){
  if(walletMode === 'agent') return;
  try {
    const walletObj = walletMode === 'keplr' ? window.keplr : window.leap;
    const signer = walletObj.getOfflineSigner
      ? walletObj.getOfflineSigner(COREUM_CHAIN_ID)
      : await walletObj.getOfflineSignerAuto(COREUM_CHAIN_ID);
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

/* ---- Client-Side Transaction (Keplr/Leap) ---- */

async function dexBuildAndSignTx(messages, gasLimit){
  // Get the signer's public key (needed for AuthInfo)
  const accounts = await connectedOfflineSigner.getAccounts();
  const pubkeyBytes = accounts[0].pubkey;
  // Convert Uint8Array to hex string for transport
  const pubkeyHex = Array.from(pubkeyBytes).map(b => b.toString(16).padStart(2, '0')).join('');

  // Step 1: Ask server to build the unsigned tx bytes using Coreum protobuf registry
  const buildRes = await fetch(`${API_URL}/api/build-tx`, {
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

  // Step 2: Convert hex to Uint8Array
  const bodyBytes = new Uint8Array(txData.bodyBytes.match(/.{1,2}/g).map(b => parseInt(b, 16)));
  const authInfoBytes = new Uint8Array(txData.authInfoBytes.match(/.{1,2}/g).map(b => parseInt(b, 16)));

  // Step 3: Sign with Keplr/Leap using signDirect
  const walletObj = walletMode === 'keplr' ? window.keplr : window.leap;

  const signDoc = {
    bodyBytes: bodyBytes,
    authInfoBytes: authInfoBytes,
    chainId: txData.chainId,
    accountNumber: '' + txData.accountNumber, // Keplr expects string for Long
  };

  // Use signDirect — works with protobuf-encoded messages
  // preferNoSetFee: use our pre-set high gas fee, don't show wallet fee selector
  const signResponse = await walletObj.signDirect(
    txData.chainId,
    connectedAddress,
    signDoc,
    { preferNoSetFee: true, preferNoSetMemo: true }
  );

  // Step 4: Build the final TxRaw and broadcast via REST
  const signed = signResponse.signed;
  const signature = signResponse.signature.signature;

  // Encode as TxRaw (simple protobuf: field 1=bodyBytes, field 2=authInfoBytes, field 3=signatures)

/* === Encode helper === */
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

  // Decode base64 signature
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

  // Base64 encode for REST broadcast
  const txRawB64 = btoa(String.fromCharCode(...txRaw));

  // Step 5: Broadcast via REST
  const broadcastRes = await fetch(`${COREUM_REST}/cosmos/tx/v1beta1/txs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tx_bytes: txRawB64,
      mode: 'BROADCAST_MODE_SYNC',
    })
  });

  const broadcastData = await broadcastRes.json();

  if(broadcastData.tx_response && broadcastData.tx_response.code !== 0){
    throw new Error(broadcastData.tx_response.raw_log || `TX failed with code ${broadcastData.tx_response.code}`);
  }

  return broadcastData.tx_response || broadcastData;
}

