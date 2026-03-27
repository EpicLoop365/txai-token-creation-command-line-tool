/* ===== TXAI - Smart Token Manager ===== */
/* ===== TOKEN MANAGER ===== */
let manageTokenData = null;

async function manageLoadToken(){
  const denom = document.getElementById('manageTokenDenom').value.trim();
  if(!denom) return;

  const btn = document.getElementById('manageLoadBtn');
  btn.disabled = true;
  btn.textContent = 'Loading...';
  document.getElementById('manageResult').style.display = 'none';

  try {
    const res = await fetch(`${API_URL}/api/token-info?denom=${encodeURIComponent(denom)}`);
    const data = await res.json();
    if(data.error) throw new Error(data.error);

    manageTokenData = data;
    manageTokenData.denom = denom;
    // Fallback: extract issuer from denom (format is subunit-issuerAddress)
    if(!manageTokenData.issuer && denom.includes('-')){
      manageTokenData.issuer = denom.substring(denom.indexOf('-') + 1);
    }

    // Populate info header
    const symbol = data.symbol || data.subunit || denom.split('-')[0] || denom;
    document.getElementById('manageTokenName').textContent = symbol.toUpperCase();
    document.getElementById('manageTokenDenomDisplay').textContent = denom;
    document.getElementById('manageIssuer').textContent = `Issuer: ${manageTokenData.issuer || 'unknown'}`;
    // Token logo via Multiavatar
    const logoEl = document.getElementById('manageTokenLogo');
    if(logoEl){
      const logoUri = data.uri || `https://api.multiavatar.com/${encodeURIComponent(symbol)}.svg`;
      logoEl.innerHTML = `<img src="${logoUri}" alt="${symbol}" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.textContent='${symbol.slice(0,2).toUpperCase()}'">`;
    }

    // Populate stats
    const precision = data.precision || 6;
    const supply = data.supply || '0';
    const humanSupply = (parseInt(supply) / Math.pow(10, precision)).toLocaleString(undefined, {maximumFractionDigits: precision});
    document.getElementById('manageSupply').textContent = humanSupply;
    document.getElementById('managePrecision').textContent = precision;

    const burnRate = data.burn_rate || data.burnRate || '0';
    const burnPct = (parseFloat(burnRate) * 100).toFixed(2);
    document.getElementById('manageBurnRate').textContent = burnPct + '%';

    const commission = data.send_commission_rate || data.sendCommissionRate || '0';
    const commPct = (parseFloat(commission) * 100).toFixed(2);
    document.getElementById('manageCommission').textContent = commPct + '%';

    const globalFrozen = data.globally_frozen || data.globallyFrozen || false;
    const frozenEl = document.getElementById('manageGlobalFrozen');
    frozenEl.textContent = globalFrozen ? 'Yes' : 'No';
    frozenEl.style.color = globalFrozen ? '#ef4444' : 'var(--green)';

    // Feature badges
    const features = data.features || [];
    const allFeatures = [
      { key: 'minting', label: 'Minting', icon: '🪙' },
      { key: 'burning', label: 'Burning', icon: '🔥' },
      { key: 'freezing', label: 'Freezing', icon: '❄️' },
      { key: 'whitelisting', label: 'Whitelisting', icon: '📋' },
      { key: 'ibc', label: 'IBC', icon: '🌐' },
      { key: 'clawback', label: 'Clawback', icon: '🔙' },
    ];
    const featureEl = document.getElementById('manageFeatures');
    featureEl.innerHTML = allFeatures.map(f => {
      const isOn = features.some(feat =>
        feat.toLowerCase().includes(f.key.toLowerCase()) ||
        feat.toLowerCase().replace(/_/g,'').includes(f.key.toLowerCase())
      );
      return `<span class="manage-feature-badge ${isOn ? 'on' : 'off'}">${f.icon} ${f.label}</span>`;
    }).join('');

    // Check if current agent wallet is the issuer
    // Check if either the agent wallet or the connected wallet is the issuer
    const isIssuer = data.issuer && (
      (dexAgentWallet && data.issuer === dexAgentWallet) ||
      (connectedAddress && data.issuer === connectedAddress)
    );
    document.getElementById('manageIssuerNotice').style.display = isIssuer ? 'none' : 'flex';

    // Show/hide action panels based on features and issuer status
    const hasFeature = (key) => features.some(f =>
      f.toLowerCase().includes(key.toLowerCase()) ||
      f.toLowerCase().replace(/_/g,'').includes(key.toLowerCase())
    );

    document.getElementById('manageActionMint').style.display = hasFeature('minting') ? '' : 'none';
    document.getElementById('manageActionBurn').style.display = hasFeature('burning') ? '' : 'none';
    document.getElementById('manageActionFreeze').style.display = hasFeature('freezing') ? '' : 'none';
    document.getElementById('manageActionGlobalFreeze').style.display = hasFeature('freezing') ? '' : 'none';
    document.getElementById('manageActionClawback').style.display = hasFeature('clawback') ? '' : 'none';
    document.getElementById('manageActionWhitelist').style.display = hasFeature('whitelisting') ? '' : 'none';

    // Disable buttons if not issuer
    if(!isIssuer){
      document.querySelectorAll('.manage-exec-btn').forEach(b => b.disabled = true);
    } else {
      document.querySelectorAll('.manage-exec-btn').forEach(b => b.disabled = false);
    }

    document.getElementById('manageInfoCard').style.display = '';
  } catch(err){
    alert('Failed to load token: ' + (err.message || err));
    document.getElementById('manageInfoCard').style.display = 'none';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Load Token';
  }
}

function manageGetPrecision(){
  return manageTokenData?.precision || 6;
}

function manageToSmallest(humanAmount){
  return Math.round(parseFloat(humanAmount) * Math.pow(10, manageGetPrecision())).toString();
}

function manageShowResult(success, message, txHash){
  const el = document.getElementById('manageResult');
  el.style.display = 'flex';
  el.className = 'manage-result ' + (success ? 'success' : 'error');
  document.getElementById('manageResultIcon').textContent = success ? '✓' : '✗';
  document.getElementById('manageResultMsg').textContent = message;
  const link = document.getElementById('manageResultLink');
  if(txHash){
    link.style.display = '';
    link.href = `https://explorer.testnet-1.tx.org/tx/${txHash}`;
    link.textContent = 'View on Explorer →';
  } else {
    link.style.display = 'none';
  }
  // Refresh token info after successful operation
  if(success) setTimeout(() => manageLoadToken(), 3000);
}

/* Check if the connected wallet is the issuer of the currently loaded token */
function manageIsWalletIssuer(){
  return connectedAddress && manageTokenData && manageTokenData.issuer === connectedAddress;
}

/* Execute a manage operation — routes through wallet signing if connected wallet is issuer */
async function manageExec(endpoint, body, actionLabel){
  try {
    // If the connected wallet is the issuer, sign with Keplr/Leap
    if(manageIsWalletIssuer()){
      await manageExecWallet(endpoint, body, actionLabel);
      return;
    }

    // Otherwise use the server's agent wallet
    const res = await fetch(`${API_URL}/api/token/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if(data.error) throw new Error(data.error);
    if(data.success === false) throw new Error(data.error || 'Transaction failed');
    manageShowResult(true, `${actionLabel} successful!`, data.txHash);
  } catch(err){
    manageShowResult(false, `${actionLabel} failed: ${err.message}`, null);
  }
}

/* Execute manage operation via connected wallet (Keplr/Leap) */
async function manageExecWallet(endpoint, body, actionLabel){
  // Build the appropriate MsgType for this operation
  let msg;
  const denom = body.denom;
  const sender = connectedAddress;

  switch(endpoint){
    case 'mint':
      msg = {
        typeUrl: '/coreum.asset.ft.v1.MsgMint',
        value: { sender, coin: { denom, amount: body.amount }, recipient: body.recipient || sender }
      };
      break;
    case 'burn':
      msg = {
        typeUrl: '/coreum.asset.ft.v1.MsgBurn',
        value: { sender, coin: { denom, amount: body.amount } }
      };
      break;
    case 'freeze':
      msg = {
        typeUrl: '/coreum.asset.ft.v1.MsgFreeze',
        value: { sender, account: body.account, coin: { denom, amount: body.amount } }
      };
      break;
    case 'unfreeze':
      msg = {
        typeUrl: '/coreum.asset.ft.v1.MsgUnfreeze',
        value: { sender, account: body.account, coin: { denom, amount: body.amount } }
      };
      break;
    case 'global-freeze':
      msg = {
        typeUrl: '/coreum.asset.ft.v1.MsgGloballyFreeze',
        value: { sender, denom }
      };
      break;
    case 'global-unfreeze':
      msg = {
        typeUrl: '/coreum.asset.ft.v1.MsgGloballyUnfreeze',
        value: { sender, denom }
      };
      break;
    case 'clawback':
      msg = {
        typeUrl: '/coreum.asset.ft.v1.MsgClawback',
        value: { sender, account: body.account, coin: { denom, amount: body.amount } }
      };
      break;
    case 'whitelist':
      msg = {
        typeUrl: '/coreum.asset.ft.v1.MsgSetWhitelistedLimit',
        value: { sender, account: body.account, coin: { denom, amount: body.amount } }
      };
      break;
    default:
      throw new Error('Unknown operation: ' + endpoint);
  }

  const result = await dexBuildAndSignTx([msg], 500000);
  const txHash = result.txhash || result.hash || '';
  manageShowResult(true, `${actionLabel} successful!`, txHash);
}

async function manageExecMint(){
  const amt = document.getElementById('manageMintAmt').value;
  if(!amt) return;
  const recipient = document.getElementById('manageMintRecipient').value.trim() || undefined;
  await manageExec('mint', {
    denom: manageTokenData.denom,
    amount: manageToSmallest(amt),
    recipient
  }, 'Mint');
}

async function manageExecBurn(){
  const amt = document.getElementById('manageBurnAmt').value;
  if(!amt) return;
  await manageExec('burn', {
    denom: manageTokenData.denom,
    amount: manageToSmallest(amt)
  }, 'Burn');
}

async function manageExecFreeze(){
  const account = document.getElementById('manageFreezeAccount').value.trim();
  const amt = document.getElementById('manageFreezeAmt').value;
  if(!account || !amt) return;
  await manageExec('freeze', {
    denom: manageTokenData.denom,
    account,
    amount: manageToSmallest(amt)
  }, 'Freeze');
}

async function manageExecUnfreeze(){
  const account = document.getElementById('manageFreezeAccount').value.trim();
  const amt = document.getElementById('manageFreezeAmt').value;
  if(!account || !amt) return;
  await manageExec('unfreeze', {
    denom: manageTokenData.denom,
    account,
    amount: manageToSmallest(amt)
  }, 'Unfreeze');
}

async function manageExecGlobalFreeze(){
  await manageExec('global-freeze', {
    denom: manageTokenData.denom
  }, 'Global Freeze');
}

async function manageExecGlobalUnfreeze(){
  await manageExec('global-unfreeze', {
    denom: manageTokenData.denom
  }, 'Global Unfreeze');
}

async function manageExecClawback(){
  const account = document.getElementById('manageClawbackAccount').value.trim();
  const amt = document.getElementById('manageClawbackAmt').value;
  if(!account || !amt) return;
  await manageExec('clawback', {
    denom: manageTokenData.denom,
    account,
    amount: manageToSmallest(amt)
  }, 'Clawback');
}

async function manageExecWhitelist(){
  const account = document.getElementById('manageWhitelistAccount').value.trim();
  const amt = document.getElementById('manageWhitelistAmt').value;
  if(!account || !amt) return;
  await manageExec('whitelist', {
    denom: manageTokenData.denom,
    account,
    amount: manageToSmallest(amt)
  }, 'Whitelist');
}

/* Auto-populate Manage tab from token creation */
function populateManageFromToken(denom){
  if(denom){
    document.getElementById('manageTokenDenom').value = denom;
  }
}
