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
  },
  {
    id: 'custom-script',
    name: 'Custom Script',
    desc: 'Write your own agent logic. Full sandboxed access to chain queries, alerts, and transactions.',
    icon: '\u{1F4BB}',
    symbol: 'SCRIPT',
    hasScript: true,
    params: [
      { key: 'trigger', label: 'Trigger type', type: 'text', placeholder: 'cron | event | threshold | webhook' },
      { key: 'interval', label: 'Check every (minutes)', type: 'number', placeholder: '15', default: 15 },
      { key: 'description', label: 'What does this script do?', type: 'text', placeholder: 'Describe your agent logic...' }
    ]
  },
  // ── Hidden templates (dev mode only) ──
  {
    id: 'fund-rescue',
    name: 'Fund Recovery',
    desc: 'Monitors unstaking events and races to recover funds from compromised wallets. Cosmo Rescue style.',
    icon: '\u{1F6A8}',
    symbol: 'RESCUE',
    hidden: true,
    hasScript: true,
    params: [
      { key: 'watchAddress', label: 'Address to watch', type: 'text', placeholder: 'testcore1... or core1...' },
      { key: 'safeAddress', label: 'Safe recovery address', type: 'text', placeholder: 'Your safe wallet address' },
      { key: 'denom', label: 'Token denom', type: 'text', placeholder: 'utestcore', default: 'utestcore' },
      { key: 'interval', label: 'Check every (seconds)', type: 'number', placeholder: '5', default: 5 }
    ]
  }
];

/* ── Dev Mode — unlocked by NFT, URL param, or console ── */
let agentNftDevMode = false;
const DEV_PASS_CLASSES = [
  'devpass',    // Generic dev pass NFT class prefix
  'rescue',     // Cosmo Rescue provider pass
  'provider',   // Verified provider pass
  'txaidev',    // TXAI team dev pass
];

/* Check if wallet holds a dev/provider NFT */
async function agentNftCheckDevNft() {
  const wallet = (window.txaiWallet && window.txaiWallet.address)
    || (typeof connectedAddress !== 'undefined' && connectedAddress)
    || null;

  if (!wallet) return false;

  try {
    // Query NFTs owned by this wallet from the chain
    const network = (window.txaiWallet && window.txaiWallet.chainId === 'coreum-mainnet-1') ? 'mainnet' : 'testnet';
    const restBase = network === 'mainnet'
      ? 'https://full-node.mainnet-1.coreum.dev:1317'
      : 'https://full-node.testnet-1.coreum.dev:1317';

    const res = await fetch(`${restBase}/coreum/nft/v1beta1/nfts?owner=${wallet}`);
    const data = await res.json();
    const nfts = data.nfts || [];

    // Check if any NFT class matches a dev pass pattern
    for (const nft of nfts) {
      const classId = (nft.class_id || '').toLowerCase();
      for (const prefix of DEV_PASS_CLASSES) {
        if (classId.includes(prefix)) {
          return { unlocked: true, classId: nft.class_id, nftId: nft.id };
        }
      }
    }

    return false;
  } catch (err) {
    console.warn('Dev NFT check failed:', err.message);
    return false;
  }
}

/* Enable dev mode */
function agentNftEnableDevMode(source) {
  if (agentNftDevMode) return;
  agentNftDevMode = true;
  agentNftRenderTemplates();
  const label = source || 'manual';
  agentNftLog('info', `Dev mode enabled (${label}) — hidden templates unlocked.`);
  console.log('%c🔓 TXAI Dev Mode — hidden agent templates unlocked via ' + label, 'color:#06d6a0;font-size:14px;font-weight:bold');
}

/* Auto-check for dev NFT when wallet connects */
async function agentNftAutoCheckDev() {
  const result = await agentNftCheckDevNft();
  if (result && result.unlocked) {
    agentNftEnableDevMode('NFT: ' + result.classId + ' #' + result.nftId);
    return true;
  }
  return false;
}

// Auto-enable if URL has ?dev=1 or #dev (fallback for testing)
(function() {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('dev') === '1' || url.hash.includes('dev')) {
      document.addEventListener('DOMContentLoaded', () => {
        agentNftEnableDevMode('url-param');
      });
    }
  } catch {}
})();

// Console shortcut
window.txaiDev = function() { agentNftEnableDevMode('console'); };

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

  // Check for dev/provider NFT to unlock hidden templates
  agentNftAutoCheckDev();

  agentNftLog('info', 'Agent NFT system ready.');
}

/* ── Render Template Grid ── */
function agentNftRenderTemplates() {
  const gridEl = document.getElementById('agentNftGrid');
  if (!gridEl) return;

  let html = '';
  for (const tpl of AGENT_NFT_TEMPLATES) {
    // Skip hidden templates unless dev mode
    if (tpl.hidden && !agentNftDevMode) continue;

    const hiddenBadge = tpl.hidden ? '<span class="agent-nft-dev-badge">DEV</span>' : '';
    html += `
      <div class="agent-nft-card ${tpl.hidden ? 'agent-nft-card-dev' : ''}" onclick="agentNftSelectTemplate('${tpl.id}')">
        <div class="agent-nft-card-icon">${tpl.icon}</div>
        <div class="agent-nft-card-name">${escapeHtml(tpl.name)} ${hiddenBadge}</div>
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

  // Script editor visibility + init
  agentScriptUpdateVisibility();
  agentScriptInitEditor();
  if (tpl.hasScript) {
    // Auto-load matching script template if one exists
    const autoTemplate = tpl.id === 'fund-rescue' ? 'fund-rescue' : 'blank';
    agentScriptLoadTemplate(autoTemplate);
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

  // Collect script if present
  const scriptCode = agentScriptGetCode();
  const permissions = agentScriptGetPermissions();

  // Build metadata
  const metadata = {
    type: tpl.id,
    name: agentName,
    params: params,
    status: 'active',
    created: new Date().toISOString()
  };

  // Attach script + permissions if code exists
  if (scriptCode) {
    metadata.script = scriptCode;
    metadata.permissions = permissions;
    metadata.scriptHash = await agentScriptHash(scriptCode);
  }

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
      hasScript: !!scriptCode,
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
          <div class="agent-nft-history-meta">${escapeHtml(entry.typeName || entry.type)}${entry.hasScript ? ' &middot; <span style="color:var(--green)">Scripted</span>' : ''} &middot; ${dateStr}${entry.classId ? ' &middot; Class: ' + escapeHtml(entry.classId) : ''}</div>
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

/* ═══════════════════════════════════════════════════════════
   SCRIPT EDITOR — Advanced agent scripting
   ═══════════════════════════════════════════════════════════ */

const AGENT_SCRIPT_TEMPLATES = {
  'blank': `// Your agent logic here
// Runs on each trigger interval

async function run(ctx) {
  // ctx.chain  — chain query helpers
  // ctx.agent  — agent actions (alert, log)
  // ctx.params — your config params above

  agent.log('Agent tick at ' + new Date().toISOString());
}
`,

  'monitor-alert': `// Monitor + Alert — watches a value and alerts when threshold crossed
async function run(ctx) {
  const denom = ctx.params.denom || 'utestcore';
  const threshold = ctx.params.threshold || 10000;

  // Query top holders
  const holders = await ctx.chain.getHolders(denom);

  for (const h of holders) {
    if (h.balance > threshold) {
      ctx.agent.alert(
        \`Whale detected: \${h.address} holds \${h.balance} \${denom}\`
      );
    }
  }

  ctx.agent.log(\`Scanned \${holders.length} holders\`);
}
`,

  'monitor-tx': `// Monitor + Transact — watches events and auto-executes transactions
// ⚠️ Requires "Sign transactions" permission enabled
async function run(ctx) {
  const denom = ctx.params.denom || 'utestcore';

  // Check for large pending transfers
  const events = await ctx.chain.query('/cosmos/tx/v1beta1/txs?events=transfer.amount>' + ctx.params.threshold);

  for (const tx of events.txs || []) {
    ctx.agent.log('Large transfer detected: ' + tx.txhash);

    // Example: auto-buy when whale sells
    if (ctx.permissions.canSign) {
      await ctx.chain.send({
        to: ctx.wallet,
        amount: ctx.params.buyAmount || 1000,
        denom: denom,
        memo: 'Auto-buy by agent'
      });
      ctx.agent.alert('Auto-bought ' + ctx.params.buyAmount + ' ' + denom);
    }
  }
}
`,

  'watchdog': `// Watchdog — Monitor any wallet for suspicious activity
// Alerts you when something unusual happens. Does NOT take action.
async function run(ctx) {
  const watchAddr = ctx.params.watchAddress || ctx.params.denom;
  if (!watchAddr) {
    ctx.agent.log('Set an address or denom to watch');
    return;
  }

  // Check current balance
  const balance = await ctx.chain.getBalance(watchAddr, 'utestcore');
  ctx.agent.log('Current balance: ' + balance + ' utestcore');

  // Check for unbonding (unstaking) events
  const unbonding = await ctx.chain.query(
    '/cosmos/staking/v1beta1/delegators/' + watchAddr + '/unbonding_delegations'
  );
  const entries = unbonding.unbonding_responses || [];

  if (entries.length > 0) {
    ctx.agent.alert('⚠️ UNSTAKING DETECTED for ' + watchAddr + '! ' + entries.length + ' unbonding entries found.');
  }

  // Check recent large transfers
  const holders = await ctx.chain.getHolders('utestcore');
  const suspicious = holders.filter(h => h.balance > 100000);
  if (suspicious.length > 0) {
    ctx.agent.alert('Large holders detected: ' + suspicious.length + ' wallets > 100k');
  }

  ctx.agent.log('Watchdog scan complete — ' + new Date().toISOString());
}
`,

  'fund-rescue': `// Fund Recovery — Cosmo Rescue style
// Monitors unstaking events and races to recover funds
// ⚠️ Requires "Sign transactions" permission enabled
async function run(ctx) {
  const watchAddress = ctx.params.watchAddress;
  const safeAddress  = ctx.params.safeAddress;

  if (!watchAddress || !safeAddress) {
    ctx.agent.log('ERROR: Set watchAddress and safeAddress in params');
    return;
  }

  // Check for unbonding delegations
  const unbonding = await ctx.chain.query(
    '/cosmos/staking/v1beta1/delegators/' + watchAddress + '/unbonding_delegations'
  );

  const entries = unbonding.unbonding_responses || [];
  if (entries.length === 0) {
    ctx.agent.log('No unbonding detected for ' + watchAddress);
    return;
  }

  ctx.agent.alert('⚠️ UNBONDING DETECTED for ' + watchAddress + '!');

  // Check if funds are available (completion time passed)
  for (const entry of entries) {
    for (const e of entry.entries || []) {
      const completionTime = new Date(e.completion_time);
      if (completionTime <= new Date()) {
        // Funds are claimable — race to send to safe wallet
        const balance = await ctx.chain.getBalance(watchAddress, 'utestcore');
        if (balance > 0 && ctx.permissions.canSign) {
          await ctx.chain.send({
            to: safeAddress,
            amount: balance,
            denom: 'utestcore',
            memo: 'Emergency fund rescue by TXAI Agent'
          });
          ctx.agent.alert('RESCUED ' + balance + ' utestcore → ' + safeAddress);
        }
      }
    }
  }
}
`
};

/* ── Show/hide script section based on template ── */
function agentScriptUpdateVisibility() {
  const section = document.getElementById('agentScriptSection');
  const perms = document.getElementById('agentPermissions');
  if (!section) return;

  const tpl = agentNftSelectedTemplate;
  const isScript = tpl && tpl.hasScript;

  // Always show for custom-script, collapsible for others
  if (isScript) {
    section.style.display = '';
    section.open = true;
    if (perms) perms.style.display = '';
  } else {
    section.style.display = '';
    section.open = false;
    if (perms) perms.style.display = 'none';
  }
}

/* ── Load script template ── */
function agentScriptLoadTemplate(templateId) {
  const editor = document.getElementById('agentScriptEditor');
  if (!editor) return;

  const code = AGENT_SCRIPT_TEMPLATES[templateId] || AGENT_SCRIPT_TEMPLATES['blank'];
  editor.value = code;

  // Update active button
  document.querySelectorAll('.agent-script-tpl-btn').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.toLowerCase().includes(templateId.replace('-', ' ').split(' ')[0]));
  });

  agentScriptUpdateCounts();
  agentNftLog('info', `Loaded script template: ${templateId}`);
}

/* ── Update line/char counts ── */
function agentScriptUpdateCounts() {
  const editor = document.getElementById('agentScriptEditor');
  const lineEl = document.getElementById('agentScriptLineCount');
  const charEl = document.getElementById('agentScriptCharCount');
  if (!editor) return;

  const text = editor.value || '';
  const lines = text.split('\n').length;
  if (lineEl) lineEl.textContent = lines + ' line' + (lines !== 1 ? 's' : '');
  if (charEl) charEl.textContent = text.length + ' char' + (text.length !== 1 ? 's' : '');
}

/* ── Dry Run — simulate script execution ── */
async function agentScriptDryRun() {
  const editor = document.getElementById('agentScriptEditor');
  const output = document.getElementById('agentScriptDryRunOutput');
  const status = document.getElementById('agentScriptStatus');
  if (!editor || !output) return;

  const code = editor.value.trim();
  if (!code) {
    output.style.display = 'block';
    output.innerHTML = '<div class="dry-run-error">No script to run.</div>';
    return;
  }

  // Update status
  if (status) status.innerHTML = '<span class="agent-script-dot running"></span> Running dry run...';
  output.style.display = 'block';
  output.innerHTML = '<div class="dry-run-info">Simulating script execution on testnet...</div>';

  const logs = [];
  const alerts = [];

  // Create sandbox context
  const mockCtx = {
    chain: {
      query: async (path) => {
        logs.push(`[chain.query] ${path}`);
        return { txs: [], pagination: {} };
      },
      getBalance: async (addr, denom) => {
        logs.push(`[chain.getBalance] ${addr} / ${denom}`);
        return 1000000;
      },
      getHolders: async (denom) => {
        logs.push(`[chain.getHolders] ${denom}`);
        return [
          { address: 'testcore1...abc', balance: 50000 },
          { address: 'testcore1...def', balance: 12000 },
          { address: 'testcore1...ghi', balance: 3000 },
        ];
      },
      getStakers: async (validator) => {
        logs.push(`[chain.getStakers] ${validator}`);
        return [{ address: 'testcore1...abc', amount: 5000 }];
      },
      send: async (opts) => {
        logs.push(`[chain.send] ${opts.amount} ${opts.denom} → ${opts.to}`);
        return { txhash: 'DRY_RUN_' + Date.now().toString(16) };
      }
    },
    agent: {
      alert: (msg) => { alerts.push(msg); logs.push(`[ALERT] ${msg}`); },
      log: (msg) => { logs.push(`[LOG] ${msg}`); },
      getParam: (key) => {
        const el = document.getElementById('agentNftParam_' + key);
        return el ? el.value : '';
      }
    },
    params: {},
    permissions: {
      canSign: !!document.getElementById('agentPermSign')?.checked,
      canAlert: true,
      canWebhook: !!document.getElementById('agentPermWebhook')?.checked
    },
    wallet: 'testcore1_dry_run_wallet'
  };

  // Collect params
  if (agentNftSelectedTemplate) {
    for (const p of agentNftSelectedTemplate.params) {
      const el = document.getElementById('agentNftParam_' + p.key);
      mockCtx.params[p.key] = el ? el.value : '';
    }
  }

  try {
    // Execute in pseudo-sandbox
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const fn = new AsyncFunction('ctx', 'chain', 'agent',
      code.replace(/async function run\(ctx\)\s*\{/, '').replace(/\}$/, '')
        || code
    );

    const startTime = performance.now();
    await Promise.race([
      fn(mockCtx, mockCtx.chain, mockCtx.agent),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Script timed out (5s limit)')), 5000))
    ]);
    const elapsed = (performance.now() - startTime).toFixed(1);

    // Render output
    let html = `<div class="dry-run-header">Dry Run Complete — ${elapsed}ms</div>`;
    if (alerts.length) {
      html += '<div class="dry-run-alerts">';
      for (const a of alerts) html += `<div class="dry-run-alert-item">&#x1F514; ${escapeHtml(a)}</div>`;
      html += '</div>';
    }
    html += '<div class="dry-run-log">';
    for (const l of logs) html += `<div class="dry-run-log-line">${escapeHtml(l)}</div>`;
    if (!logs.length) html += '<div class="dry-run-log-line dim">No output.</div>';
    html += '</div>';

    output.innerHTML = html;
    if (status) status.innerHTML = '<span class="agent-script-dot success"></span> Dry run passed';

    agentNftLog('success', `Dry run OK — ${elapsed}ms, ${logs.length} log entries`);

  } catch (err) {
    output.innerHTML = `<div class="dry-run-header error">Dry Run Failed</div>
      <div class="dry-run-error">${escapeHtml(err.message)}</div>
      <div class="dry-run-log">${logs.map(l => `<div class="dry-run-log-line">${escapeHtml(l)}</div>`).join('')}</div>`;
    if (status) status.innerHTML = '<span class="agent-script-dot error"></span> Error';

    agentNftLog('error', `Dry run failed: ${err.message}`);
  }
}

/* ── Format script ── */
function agentScriptFormat() {
  const editor = document.getElementById('agentScriptEditor');
  if (!editor) return;

  let code = editor.value;
  // Basic formatting: normalize indentation
  code = code.replace(/\t/g, '  ');
  // Remove trailing whitespace
  code = code.split('\n').map(l => l.trimEnd()).join('\n');
  // Remove excessive blank lines
  code = code.replace(/\n{3,}/g, '\n\n');

  editor.value = code;
  agentScriptUpdateCounts();
  agentNftLog('info', 'Script formatted.');
}

/* ── Get script content for mint ── */
function agentScriptGetCode() {
  const editor = document.getElementById('agentScriptEditor');
  return editor ? editor.value.trim() : '';
}

/* ── Get permissions for mint ── */
function agentScriptGetPermissions() {
  return {
    readChain: true, // always on
    alert: !!document.getElementById('agentPermAlert')?.checked,
    signTx: !!document.getElementById('agentPermSign')?.checked,
    webhook: !!document.getElementById('agentPermWebhook')?.checked
  };
}

/* ── Hash script for integrity verification ── */
async function agentScriptHash(code) {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(code);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return 'hash-unavailable';
  }
}

/* ── Wire up editor events ── */
function agentScriptInitEditor() {
  const editor = document.getElementById('agentScriptEditor');
  if (!editor) return;

  editor.addEventListener('input', agentScriptUpdateCounts);

  // Tab key support in textarea
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end);
      editor.selectionStart = editor.selectionEnd = start + 2;
      agentScriptUpdateCounts();
    }
  });

  agentScriptUpdateCounts();
}
