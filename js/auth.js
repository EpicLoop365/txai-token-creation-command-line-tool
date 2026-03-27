/* ===== TXAI - Auth & Permissions Tab ===== */
/* Cosmos authz module: query, grant, and revoke permissions */

let authViewMode = 'granter'; // 'granter' | 'grantee'
let authGrantsData = [];

// Known message type labels
const AUTH_MSG_LABELS = {
  '/cosmos.bank.v1beta1.MsgSend': 'Send Tokens',
  '/coreum.dex.v1.MsgPlaceOrder': 'Place DEX Orders',
  '/coreum.dex.v1.MsgCancelOrder': 'Cancel DEX Orders',
  '/coreum.asset.ft.v1.MsgMint': 'Mint Tokens',
  '/coreum.asset.ft.v1.MsgBurn': 'Burn Tokens',
  '/coreum.asset.ft.v1.MsgFreeze': 'Freeze Account',
  '/coreum.asset.ft.v1.MsgUnfreeze': 'Unfreeze Account',
  '/coreum.asset.ft.v1.MsgGloballyFreeze': 'Global Freeze',
  '/coreum.asset.ft.v1.MsgGloballyUnfreeze': 'Global Unfreeze',
  '/coreum.asset.ft.v1.MsgClawback': 'Clawback Tokens',
  '/coreum.asset.ft.v1.MsgSetWhitelistedLimit': 'Set Whitelist Limit',
  '/coreum.asset.nft.v1.MsgMint': 'Mint NFT',
  '/coreum.asset.nft.v1.MsgBurn': 'Burn NFT',
  '/coreum.asset.nft.v1.MsgFreeze': 'Freeze NFT',
};

/* ── Toggle View ── */
function authToggleView(mode) {
  authViewMode = mode;
  document.getElementById('authToggleGranter').classList.toggle('active', mode === 'granter');
  document.getElementById('authToggleGrantee').classList.toggle('active', mode === 'grantee');
  // Show/hide revoke hints
  document.getElementById('authRevokeHint').style.display = mode === 'granter' ? '' : 'none';
  authLoadGrants();
}

/* ── Load Grants from REST ── */
async function authLoadGrants() {
  const addr = dexGetActiveAddress();
  const list = document.getElementById('authGrantsList');

  if (!addr) {
    list.innerHTML = '<div class="auth-empty">Connect a wallet or use the agent wallet to view permissions.</div>';
    return;
  }

  list.innerHTML = '<div class="auth-loading">Loading grants...</div>';

  try {
    const endpoint = authViewMode === 'granter'
      ? `${COREUM_REST}/cosmos/authz/v1beta1/grants/granter/${addr}`
      : `${COREUM_REST}/cosmos/authz/v1beta1/grants/grantee/${addr}`;

    const res = await fetch(endpoint);
    const data = await res.json();
    authGrantsData = data.grants || [];
    authRenderGrants(addr);
  } catch (err) {
    list.innerHTML = `<div class="auth-error">Failed to load grants: ${err.message}</div>`;
  }
}

/* ── Render Grants ── */
function authRenderGrants(activeAddr) {
  const list = document.getElementById('authGrantsList');

  if (authGrantsData.length === 0) {
    list.innerHTML = `<div class="auth-empty">
      No ${authViewMode === 'granter' ? 'outgoing' : 'incoming'} grants found.
      ${authViewMode === 'granter' ? 'Create a new grant below.' : ''}
    </div>`;
    return;
  }

  list.innerHTML = authGrantsData.map((g, i) => {
    const auth = g.authorization || {};
    const authType = auth['@type'] || '';
    const otherAddr = authViewMode === 'granter' ? g.grantee : g.granter;
    const otherLabel = authViewMode === 'granter' ? 'Grantee' : 'Granter';

    // Parse authorization details
    let permLabel = 'Unknown';
    let details = '';
    let msgTypeUrl = '';

    if (authType.includes('GenericAuthorization')) {
      msgTypeUrl = auth.msg || '';
      permLabel = AUTH_MSG_LABELS[msgTypeUrl] || msgTypeUrl.split('.').pop() || 'Generic';
      details = `<span class="auth-detail-mono">${msgTypeUrl}</span>`;
    } else if (authType.includes('SendAuthorization')) {
      permLabel = 'Send Tokens';
      msgTypeUrl = '/cosmos.bank.v1beta1.MsgSend';
      const limits = auth.spend_limit || [];
      if (limits.length > 0) {
        details = limits.map(l => {
          const display = parseInt(l.amount) / 1e6;
          const symbol = l.denom === 'utestcore' ? 'TX' : l.denom.split('-')[0].toUpperCase();
          return `Limit: ${display.toLocaleString()} ${symbol}`;
        }).join(', ');
      } else {
        details = 'No spend limit';
      }
    } else if (authType.includes('StakeAuthorization')) {
      permLabel = 'Staking';
      msgTypeUrl = '/cosmos.staking.v1beta1.MsgDelegate';
    }

    // Expiration
    let expStr = 'No expiration';
    let expClass = '';
    if (g.expiration) {
      const expDate = new Date(g.expiration);
      if (expDate < new Date()) {
        expStr = `Expired ${expDate.toLocaleDateString()}`;
        expClass = 'expired';
      } else {
        expStr = `Expires ${expDate.toLocaleDateString()}`;
      }
    }

    const shortAddr = otherAddr ? `${otherAddr.slice(0, 14)}...${otherAddr.slice(-4)}` : '?';
    const revokeBtn = authViewMode === 'granter'
      ? `<button class="auth-revoke-btn" onclick="authRevokeGrant('${otherAddr}','${msgTypeUrl}')">Revoke</button>`
      : '';

    return `
      <div class="auth-grant-card ${expClass}">
        <div class="auth-grant-top">
          <span class="auth-grant-perm">${permLabel}</span>
          ${revokeBtn}
        </div>
        <div class="auth-grant-details">
          <div class="auth-grant-row">
            <span class="auth-grant-label">${otherLabel}</span>
            <span class="auth-grant-value" title="${otherAddr}">${shortAddr}</span>
          </div>
          ${details ? `<div class="auth-grant-row"><span class="auth-grant-label">Details</span><span class="auth-grant-value">${details}</span></div>` : ''}
          <div class="auth-grant-row">
            <span class="auth-grant-label">Expiration</span>
            <span class="auth-grant-value ${expClass}">${expStr}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/* ── Show/Hide Spend Limit Fields ── */
function authOnTypeChange() {
  const type = document.getElementById('authGrantType').value;
  const sendFields = document.getElementById('authSendLimitFields');
  const customRow = document.getElementById('authCustomMsgRow');
  sendFields.style.display = type === 'send' ? 'flex' : 'none';
  customRow.style.display = type === 'custom' ? '' : 'none';
}

/* ── Create Grant ── */
async function authCreateGrant() {
  const grantee = document.getElementById('authGrantee').value.trim();
  const grantType = document.getElementById('authGrantType').value;
  const expirationDays = parseInt(document.getElementById('authExpiration').value) || 365;

  if (!grantee) { alert('Enter a grantee address.'); return; }
  if (!grantee.startsWith('testcore')) { alert('Invalid address. Must start with "testcore".'); return; }

  const activeAddr = dexGetActiveAddress();
  if (!activeAddr) { alert('Connect a wallet first.'); return; }
  if (grantee === activeAddr) { alert('Cannot grant permissions to yourself.'); return; }

  // Build grant details
  let authorizationTypeUrl, authorizationValue;
  if (grantType === 'send') {
    authorizationTypeUrl = '/cosmos.bank.v1beta1.SendAuthorization';
    const limitAmount = document.getElementById('authSpendLimit').value.trim();
    const limitDenom = document.getElementById('authSpendDenom').value.trim() || 'utestcore';
    authorizationValue = {};
    if (limitAmount) {
      const rawAmount = (parseFloat(limitAmount) * 1e6).toString();
      authorizationValue.spend_limit = [{ denom: limitDenom, amount: rawAmount }];
    }
  } else {
    authorizationTypeUrl = '/cosmos.authz.v1beta1.GenericAuthorization';
    // Map selection to msg typeUrl
    const msgTypeUrls = {
      'dex-place': '/coreum.dex.v1.MsgPlaceOrder',
      'dex-cancel': '/coreum.dex.v1.MsgCancelOrder',
      'mint': '/coreum.asset.ft.v1.MsgMint',
      'burn': '/coreum.asset.ft.v1.MsgBurn',
      'freeze': '/coreum.asset.ft.v1.MsgFreeze',
      'nft-mint': '/coreum.asset.nft.v1.MsgMint',
      'custom': document.getElementById('authCustomMsg')?.value?.trim() || '',
    };
    authorizationValue = { msg: msgTypeUrls[grantType] || grantType };
    if (!authorizationValue.msg) { alert('Enter a message type URL.'); return; }
  }

  // Expiration: seconds from now
  const expirationSeconds = expirationDays * 86400;

  const btn = document.getElementById('authGrantBtn');
  btn.disabled = true;
  btn.textContent = 'Granting...';

  try {
    let result;
    if (walletMode !== 'agent' && connectedAddress) {
      // Client-side signing via Keplr/Leap
      result = await authGrantClientSide(grantee, authorizationTypeUrl, authorizationValue, expirationSeconds);
    } else {
      // Server-side signing via agent wallet
      result = await authGrantServerSide(grantee, authorizationTypeUrl, authorizationValue, expirationSeconds);
    }

    if (result.success || result.txHash) {
      authShowResult(true, 'Grant created successfully!', result.txHash || result.tx_response?.txhash);
      setTimeout(() => authLoadGrants(), 3000);
    } else {
      authShowResult(false, result.error || 'Grant failed');
    }
  } catch (err) {
    authShowResult(false, err.message);
  }

  btn.disabled = false;
  btn.textContent = '🔐 Create Grant';
}

/* ── Server-side grant (agent wallet) ── */
async function authGrantServerSide(grantee, authType, authValue, expirationSeconds) {
  const res = await fetch(`${API_URL}/api/auth/grant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grantee, authorizationType: authType, authorizationValue: authValue, expirationSeconds }),
  });
  return res.json();
}

/* ── Client-side grant (Keplr/Leap) ── */
async function authGrantClientSide(grantee, authType, authValue, expirationSeconds) {
  const expiration = new Date(Date.now() + expirationSeconds * 1000).toISOString();
  const msg = {
    typeUrl: '/cosmos.authz.v1beta1.MsgGrant',
    value: {
      granter: connectedAddress,
      grantee: grantee,
      grant: {
        authorization: {
          typeUrl: authType,
          ...authValue,
        },
        expiration: expiration,
      },
    },
  };
  return dexBuildAndSignTx([msg], 300000);
}

/* ── Revoke Grant ── */
async function authRevokeGrant(grantee, msgTypeUrl) {
  if (!confirm(`Revoke "${AUTH_MSG_LABELS[msgTypeUrl] || msgTypeUrl}" permission for ${grantee.slice(0, 14)}...?`)) return;

  const activeAddr = dexGetActiveAddress();
  if (!activeAddr) return;

  try {
    let result;
    if (walletMode !== 'agent' && connectedAddress) {
      const msg = {
        typeUrl: '/cosmos.authz.v1beta1.MsgRevoke',
        value: {
          granter: connectedAddress,
          grantee: grantee,
          msgTypeUrl: msgTypeUrl,
        },
      };
      result = await dexBuildAndSignTx([msg], 200000);
    } else {
      const res = await fetch(`${API_URL}/api/auth/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grantee, msgTypeUrl }),
      });
      result = await res.json();
    }

    if (result.success || result.txHash || result.tx_response?.txhash) {
      authShowResult(true, 'Grant revoked!', result.txHash || result.tx_response?.txhash);
      setTimeout(() => authLoadGrants(), 3000);
    } else {
      authShowResult(false, result.error || 'Revoke failed');
    }
  } catch (err) {
    authShowResult(false, err.message);
  }
}

/* ── Result Display ── */
function authShowResult(success, message, txHash) {
  const el = document.getElementById('authResult');
  const icon = success ? '✅' : '❌';
  const txLink = txHash ? ` <a href="https://explorer.testnet-1.coreum.dev/coreum/transactions/${txHash}" target="_blank" class="auth-tx-link">${txHash.slice(0, 10)}...</a>` : '';
  el.innerHTML = `<span class="auth-result-${success ? 'success' : 'error'}">${icon} ${message}${txLink}</span>`;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 10000);
}
