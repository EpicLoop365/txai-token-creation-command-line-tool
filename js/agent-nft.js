/* ===== TXAI — Agent NFT System ===== */
/*
 * Architecture:
 *   1. User selects from 6 prepackaged agent templates (Whale Watcher, Chain Scout, etc.)
 *   2. User configures agent parameters and names the agent
 *   3. Agent config is serialized as NFT metadata (JSON in URI field)
 *   4. Mint calls /api/nft-airdrop to create the NFT, sent to the user's own wallet
 *   5. Holding the NFT = owning the agent. Transfer NFT = transfer agent ownership.
 *   6. History saved to localStorage for reference
 */

const AGENT_NFT_STORAGE_KEY = 'txai_agent_nft_history';

const AGENT_NFT_TEMPLATES = [
  {
    id: 'whale-watcher',
    name: 'Whale Watcher',
    desc: 'Monitors top holders of any token. Alerts when large wallets move.',
    icon: '\u{1F40B}',
    symbol: 'WHALE',
    params: [
      { key: 'denom', label: 'Token to watch', type: 'text', placeholder: 'e.g. utestcore' },
      { key: 'threshold', label: 'Alert threshold (tokens)', type: 'number', placeholder: '10000' },
      { key: 'interval', label: 'Check every (minutes)', type: 'number', placeholder: '60', default: 60 }
    ]
  },
  {
    id: 'chain-scout',
    name: 'Chain Scout',
    desc: 'Tracks new token launches, DEX volume spikes, and trending activity.',
    icon: '\u{1F52D}',
    symbol: 'SCOUT',
    params: [
      { key: 'minVolume', label: 'Min volume to report', type: 'number', placeholder: '1000' },
      { key: 'interval', label: 'Scan every (minutes)', type: 'number', placeholder: '30', default: 30 }
    ]
  },
  {
    id: 'holder-analytics',
    name: 'Holder Analytics',
    desc: 'Snapshots holder distribution, concentration metrics, and growth trends.',
    icon: '\u{1F4CA}',
    symbol: 'HANALYT',
    params: [
      { key: 'denom', label: 'Token to analyze', type: 'text', placeholder: 'e.g. mytoken-testcore1...' },
      { key: 'interval', label: 'Snapshot every (hours)', type: 'number', placeholder: '24', default: 24 }
    ]
  },
  {
    id: 'event-monitor',
    name: 'Event Monitor',
    desc: 'Watches for specific on-chain events \u2014 mints, burns, large transfers.',
    icon: '\u{1F441}',
    symbol: 'EVTMON',
    params: [
      { key: 'denom', label: 'Token to monitor', type: 'text', placeholder: 'e.g. utestcore' },
      { key: 'events', label: 'Events to watch', type: 'text', placeholder: 'mint,burn,transfer' },
      { key: 'interval', label: 'Check every (minutes)', type: 'number', placeholder: '15', default: 15 }
    ]
  },
  {
    id: 'price-guardian',
    name: 'Price Guardian',
    desc: 'Monitors DEX price of any pair. Alerts on threshold crossings.',
    icon: '\u{1F6E1}',
    symbol: 'PGUARD',
    params: [
      { key: 'denom', label: 'Token denom', type: 'text', placeholder: 'e.g. mytoken-testcore1...' },
      { key: 'alertAbove', label: 'Alert if price above', type: 'number', placeholder: '1.50' },
      { key: 'alertBelow', label: 'Alert if price below', type: 'number', placeholder: '0.50' },
      { key: 'interval', label: 'Check every (minutes)', type: 'number', placeholder: '5', default: 5 }
    ]
  },
  {
    id: 'airdrop-scheduler',
    name: 'Airdrop Scheduler',
    desc: 'Auto-airdrops tokens on a schedule. Weekly rewards, loyalty drops, etc.',
    icon: '\u{1F4C5}',
    symbol: 'ADROP',
    params: [
      { key: 'denom', label: 'Token to airdrop', type: 'text', placeholder: 'e.g. loyalty-testcore1...' },
      { key: 'amount', label: 'Amount per recipient', type: 'number', placeholder: '100' },
      { key: 'schedule', label: 'Schedule', type: 'text', placeholder: 'weekly' },
      { key: 'recipients', label: 'Recipient source', type: 'text', placeholder: 'validator:testcorevaloper1...' }
    ]
  },
  {
    id: 'social-agent',
    name: 'Social Agent',
    desc: 'Auto-tweets from on-chain data. Whale alerts, milestones, daily summaries — always-on social presence.',
    icon: '\u{1F4E3}',
    symbol: 'SOCIAL',
    params: [
      { key: 'denom', label: 'Token to track', type: 'text', placeholder: 'e.g. mytoken-testcore1...' },
      { key: 'triggers', label: 'Tweet triggers', type: 'text', placeholder: 'whale,milestone,daily,price' },
      { key: 'whaleThreshold', label: 'Whale alert threshold', type: 'number', placeholder: '100000' },
      { key: 'tweetTemplate', label: 'Tweet template', type: 'text', placeholder: '🐋 Whale alert! {amount} ${symbol} moved' },
      { key: 'interval', label: 'Check every (minutes)', type: 'number', placeholder: '15', default: 15 }
    ]
  }
];

let agentNftHistory = [];
let agentNftInitialized = false;
let agentNftMinting = false;
let agentNftSelectedTemplate = null;

/* ── Init ── */
function agentNftInit() {
  if (agentNftInitialized) return;
  agentNftInitialized = true;

  agentNftLoadHistory();
  agentNftRenderTemplates();
  agentNftRenderHistory();

  // Wire up mint button
  const mintBtn = document.getElementById('agentNftMintBtn');
  if (mintBtn) {
    mintBtn.addEventListener('click', agentNftMint);
  }

  agentNftLog('info', 'Agent NFT system ready.');
}

/* ── Render Template Grid ── */
function agentNftRenderTemplates() {
  const gridEl = document.getElementById('agentNftGrid');
  if (!gridEl) return;

  let html = '';
  for (const tpl of AGENT_NFT_TEMPLATES) {
    html += `
      <div class="agent-nft-card" onclick="agentNftSelectTemplate('${tpl.id}')">
        <div class="agent-nft-card-icon">${tpl.icon}</div>
        <div class="agent-nft-card-name">${escapeHtml(tpl.name)}</div>
        <div class="agent-nft-card-desc">${escapeHtml(tpl.desc)}</div>
        <button class="agent-nft-configure-btn" onclick="event.stopPropagation(); agentNftSelectTemplate('${tpl.id}')">Configure</button>
      </div>`;
  }
  gridEl.innerHTML = html;
}

/* ── Select Template → Show Config Panel ── */
function agentNftSelectTemplate(templateId) {
  const tpl = AGENT_NFT_TEMPLATES.find(t => t.id === templateId);
  if (!tpl) return;

  agentNftSelectedTemplate = tpl;

  const gridEl = document.getElementById('agentNftGrid');
  const configEl = document.getElementById('agentNftConfig');
  const titleEl = document.getElementById('agentNftConfigTitle');
  const fieldsEl = document.getElementById('agentNftConfigFields');
  const nameInput = document.getElementById('agentNftAgentName');
  const resultEl = document.getElementById('agentNftResult');

  if (gridEl) gridEl.style.display = 'none';
  if (configEl) configEl.style.display = '';
  if (resultEl) { resultEl.style.display = 'none'; resultEl.textContent = ''; }

  // Title
  if (titleEl) {
    titleEl.innerHTML = `<span class="agent-nft-config-icon">${tpl.icon}</span> ${escapeHtml(tpl.name)}`;
  }

  // Pre-fill agent name
  if (nameInput) {
    nameInput.value = tpl.name;
  }

  // Dynamic fields
  if (fieldsEl) {
    let fieldsHtml = '';
    for (const p of tpl.params) {
      const val = p.default != null ? p.default : '';
      fieldsHtml += `
        <div class="cp-field" style="margin-bottom:10px">
          <label class="cp-label" for="agentNftParam_${p.key}">${escapeHtml(p.label)}</label>
          <input class="cp-input" type="${p.type}" id="agentNftParam_${p.key}" placeholder="${escapeHtml(p.placeholder)}" value="${escapeHtml(String(val))}" />
        </div>`;
    }
    fieldsEl.innerHTML = fieldsHtml;
  }

  agentNftLog('info', `Selected template: ${tpl.name}`);
}

/* ── Back to Templates ── */
function agentNftBackToTemplates() {
  agentNftSelectedTemplate = null;

  const gridEl = document.getElementById('agentNftGrid');
  const configEl = document.getElementById('agentNftConfig');
  const resultEl = document.getElementById('agentNftResult');

  if (gridEl) gridEl.style.display = '';
  if (configEl) configEl.style.display = 'none';
  if (resultEl) { resultEl.style.display = 'none'; resultEl.textContent = ''; }
}

/* ── Mint Agent NFT ── */
async function agentNftMint() {
  if (agentNftMinting) return;

  const tpl = agentNftSelectedTemplate;
  if (!tpl) return agentNftShowResult(false, 'No template selected.');

  const agentName = (document.getElementById('agentNftAgentName').value || '').trim();
  if (!agentName) return agentNftShowResult(false, 'Agent name is required.');

  // Get wallet address
  const walletAddr = (window.txaiWallet && window.txaiWallet.address)
    || window.connectedAddress
    || (typeof dexGetActiveAddress === 'function' ? dexGetActiveAddress() : '');

  if (!walletAddr) return agentNftShowResult(false, 'Connect a wallet first.');

  // Collect param values
  const params = {};
  for (const p of tpl.params) {
    const el = document.getElementById('agentNftParam_' + p.key);
    const raw = el ? el.value.trim() : '';
    if (p.type === 'number') {
      params[p.key] = raw ? parseFloat(raw) : (p.default || 0);
    } else {
      params[p.key] = raw || '';
    }
  }

  // Build metadata
  const metadata = {
    type: tpl.id,
    name: agentName,
    params: params,
    status: 'active',
    created: new Date().toISOString()
  };

  const metadataUri = 'data:application/json;base64,' + btoa(JSON.stringify(metadata));

  const btn = document.getElementById('agentNftMintBtn');
  const spinner = document.getElementById('agentNftMintSpinner');

  agentNftMinting = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Minting...'; }
  if (spinner) spinner.style.display = '';

  agentNftLog('info', `Minting Agent NFT "${agentName}" (${tpl.symbol})...`);

  try {
    const res = await fetch(`${API_URL}/api/nft-airdrop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: agentName,
        symbol: tpl.symbol,
        description: tpl.desc,
        uri: metadataUri,
        recipients: [walletAddr],
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (data.error) throw new Error(data.error);

    const classId = data.classId || 'N/A';

    agentNftShowResult(true, `Agent NFT minted! Class ID: ${classId}. Agent "${agentName}" is now active in your wallet.`);
    agentNftLog('success', `Minted "${agentName}" — Class: ${classId}`);

    // Save to history
    const entry = {
      id: Date.now(),
      name: agentName,
      type: tpl.id,
      typeName: tpl.name,
      icon: tpl.icon,
      symbol: tpl.symbol,
      classId: classId,
      wallet: walletAddr,
      metadata: metadata,
      date: new Date().toISOString(),
      status: 'active',
    };
    agentNftHistory.unshift(entry);
    agentNftSaveHistory();
    agentNftRenderHistory();

  } catch (err) {
    agentNftShowResult(false, `Mint failed: ${err.message}`);
    agentNftLog('error', `Mint failed: ${err.message}`);
  } finally {
    agentNftMinting = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Mint Agent NFT'; }
    if (spinner) spinner.style.display = 'none';
  }
}

/* ── Show Result ── */
function agentNftShowResult(success, msg) {
  const el = document.getElementById('agentNftResult');
  if (!el) return;
  el.className = 'agent-nft-result ' + (success ? 'success' : 'error');
  el.textContent = msg;
  el.style.display = 'block';

  setTimeout(() => {
    if (el.textContent === msg) {
      el.style.display = 'none';
    }
  }, 8000);
}

/* ── Render History ── */
function agentNftRenderHistory() {
  const listEl = document.getElementById('agentNftHistory');
  if (!listEl) return;

  if (!agentNftHistory.length) {
    listEl.innerHTML = '<div class="agent-nft-empty">No agent NFTs minted yet.</div>';
    return;
  }

  let html = '';
  for (const entry of agentNftHistory) {
    const dateStr = new Date(entry.date).toLocaleString();
    const statusLabel = entry.status === 'active' ? 'Active'
      : entry.status === 'paused' ? 'Paused' : 'Inactive';

    html += `
      <div class="agent-nft-history-card ${entry.status}">
        <div class="agent-nft-history-icon">${entry.icon || ''}</div>
        <div class="agent-nft-history-info">
          <div class="agent-nft-history-name">${escapeHtml(entry.name)}</div>
          <div class="agent-nft-history-meta">${escapeHtml(entry.typeName || entry.type)} &middot; ${dateStr}${entry.classId ? ' &middot; Class: ' + escapeHtml(entry.classId) : ''}</div>
        </div>
        <div class="agent-nft-history-status">
          <span class="agent-nft-status-badge ${entry.status}">${statusLabel}</span>
        </div>
      </div>`;
  }
  listEl.innerHTML = html;
}

/* ── Logging ── */
function agentNftLog(type, msg) {
  const logEl = document.getElementById('agentNftLog');
  if (!logEl) return;
  const entry = document.createElement('div');
  entry.className = 'agent-nft-log-entry ' + type;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logEl.prepend(entry);
  // Keep max 20 entries
  while (logEl.children.length > 20) logEl.removeChild(logEl.lastChild);
}

/* ── Local Storage ── */
function agentNftLoadHistory() {
  try {
    const raw = localStorage.getItem(AGENT_NFT_STORAGE_KEY);
    agentNftHistory = raw ? JSON.parse(raw) : [];
  } catch { agentNftHistory = []; }
}

function agentNftSaveHistory() {
  try {
    localStorage.setItem(AGENT_NFT_STORAGE_KEY, JSON.stringify(agentNftHistory));
  } catch {}
}
