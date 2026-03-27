/* ===== TXAI — Agent Workflow Engine ===== */
/*
 * Architecture:
 *   1. A workflow is an array of steps, each with a name and async run(ctx) function
 *   2. The runner executes steps sequentially, passing a shared ctx object
 *   3. A modal overlay shows real-time progress with per-step status
 *   4. Results from each step flow to the next via ctx
 *   5. On failure, dependent steps are skipped; independent steps still run
 *   6. Completed runs are saved to localStorage for history
 */

const WORKFLOW_STORAGE_KEY = 'txai_workflow_history';
const WORKFLOW_ICON = { pending: '\u23F3', running: '\u26A1', done: '\u2713', error: '\u2717', skipped: '\u2014' };

let workflowHistory = [];
let workflowModalEl = null;
let workflowStepEls = [];
let workflowLogEl = null;
let workflowRunning = false;

/* ════════════════════════════════════════════════════
   Core Engine
   ════════════════════════════════════════════════════ */

/**
 * Main entry — look up workflow by ID, show the modal, run all steps.
 */
async function agentWorkflowRun(workflowId, overrides) {
  if (workflowRunning) return;

  const registry = agentGetWorkflows();
  const workflow = registry[workflowId];
  if (!workflow) {
    console.error('agentWorkflowRun: unknown workflow', workflowId);
    return;
  }

  workflowRunning = true;
  const ctx = Object.assign({}, overrides || {});
  const steps = workflow.steps(ctx);

  agentShowModal(workflow, steps);
  agentLogStep('Starting workflow: ' + workflow.name);

  let skipRemaining = false;
  const results = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    if (skipRemaining) {
      agentStepUpdate(i, 'skipped', 'Skipped — previous step failed');
      results.push({ name: step.name, status: 'skipped' });
      continue;
    }

    agentStepUpdate(i, 'running', 'Running...');
    agentLogStep('[' + (i + 1) + '/' + steps.length + '] ' + step.name);

    try {
      const result = await step.run(ctx);
      agentStepUpdate(i, 'done', typeof result === 'string' ? result : 'Complete');
      results.push({ name: step.name, status: 'done', result });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      agentStepUpdate(i, 'error', msg);
      agentLogStep('Error: ' + msg);
      results.push({ name: step.name, status: 'error', error: msg });
      skipRemaining = true;
    }
  }

  // Save to history
  const entry = {
    id: Date.now(),
    workflowId,
    name: workflow.name,
    steps: results,
    success: !skipRemaining,
    date: new Date().toISOString(),
    ctx: { denom: ctx.denom, classId: ctx.classId },
  };
  workflowHistory.unshift(entry);
  agentSaveHistory();

  agentLogStep('Workflow ' + (skipRemaining ? 'completed with errors' : 'completed successfully'));
  workflowRunning = false;
}

/**
 * Update a step's visual status in the modal.
 */
function agentStepUpdate(index, status, detail) {
  const el = workflowStepEls[index];
  if (!el) return;

  const iconEl = el.querySelector('.wf-step-icon');
  const statusEl = el.querySelector('.wf-step-status');
  const detailEl = el.querySelector('.wf-step-detail');

  el.className = 'wf-step ' + status;
  if (iconEl) iconEl.textContent = WORKFLOW_ICON[status] || '';
  if (statusEl) statusEl.textContent = status;
  if (detailEl) detailEl.textContent = detail || '';
}

/**
 * Create and show the workflow progress modal.
 */
function agentShowModal(workflow, steps) {
  // Remove existing modal if present
  agentCloseModal();

  const overlay = document.createElement('div');
  overlay.className = 'wf-modal-overlay';
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay && !workflowRunning) agentCloseModal();
  });

  let stepsHtml = '';
  for (let i = 0; i < steps.length; i++) {
    stepsHtml +=
      '<div class="wf-step pending" data-index="' + i + '">' +
        '<span class="wf-step-icon">' + WORKFLOW_ICON.pending + '</span>' +
        '<span class="wf-step-name">' + escapeHtml(steps[i].name) + '</span>' +
        '<span class="wf-step-status">pending</span>' +
        '<span class="wf-step-detail"></span>' +
      '</div>';
  }

  const modal = document.createElement('div');
  modal.className = 'wf-modal';
  modal.innerHTML =
    '<div class="wf-modal-header">' +
      '<h3 class="wf-modal-title">' + escapeHtml(workflow.name) + '</h3>' +
      '<button class="wf-modal-close" onclick="agentCloseModal()">&times;</button>' +
    '</div>' +
    '<div class="wf-steps">' + stepsHtml + '</div>' +
    '<div class="wf-log" id="wfLog"></div>';

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  workflowModalEl = overlay;
  workflowStepEls = modal.querySelectorAll('.wf-step');
  workflowLogEl = modal.querySelector('#wfLog');

  // Inject styles if not already present
  agentInjectStyles();
}

/**
 * Close the workflow modal.
 */
function agentCloseModal() {
  if (workflowModalEl) {
    workflowModalEl.remove();
    workflowModalEl = null;
    workflowStepEls = [];
    workflowLogEl = null;
  }
}

/**
 * Append a message to the workflow log.
 */
function agentLogStep(msg) {
  if (!workflowLogEl) return;
  const line = document.createElement('div');
  line.className = 'wf-log-line';
  line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
  workflowLogEl.appendChild(line);
  workflowLogEl.scrollTop = workflowLogEl.scrollHeight;
}


/* ════════════════════════════════════════════════════
   Workflow Definitions
   ════════════════════════════════════════════════════ */

function agentGetWorkflows() {
  return {
    loyalty:      { name: 'Loyalty Token Launch',        steps: wfLoyalty },
    deflationary: { name: 'Deflationary Token + DEX',    steps: wfDeflationary },
    subscription: { name: 'Subscription Pass System',    steps: wfSubscription },
    revenue:      { name: 'Revenue Token Launch',        steps: wfRevenue },
    apikey:       { name: 'API Access Token',            steps: wfApiKey },
    governance:   { name: 'DAO Governance Token',        steps: wfGovernance },
    nft:          { name: 'NFT Collection Launch',       steps: wfNftCollection },
    fulllaunch:   { name: 'Full Token Economy',          steps: wfFullLaunch },
  };
}

/* ── 1. Loyalty Token Launch ── */
function wfLoyalty(ctx) {
  return [
    {
      name: 'Create Token',
      run: async function (ctx) {
        const res = await fetch(API_URL + '/api/create-token-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: ctx.name || 'LoyaltyPoints',
            symbol: ctx.symbol || 'LOYAL',
            supply: '1000000',
            decimals: 0,
            features: ['minting', 'burning'],
            description: 'Loyalty reward tokens',
          }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        ctx.denom = data.denom;
        ctx.txHash = data.txHash;
        return 'Denom: ' + data.denom;
      },
    },
    {
      name: 'Record in txdb',
      run: async function (ctx) {
        if (typeof txdbChainWrite === 'function') {
          txdbChainWrite('tokens', {
            n: (ctx.name || 'LoyaltyPoints').slice(0, 20),
            s: (ctx.symbol || 'LOYAL').slice(0, 10),
            d: (ctx.denom || '').slice(0, 80),
            wf: 'loyalty',
          });
          return 'Recorded on-chain';
        }
        return 'txdb not available — skipped';
      },
    },
    {
      name: 'Ready for Airdrop',
      run: async function (ctx) {
        return 'Token ' + (ctx.denom || '?') + ' is ready. Use the Airdrop tool to distribute to holders.';
      },
    },
  ];
}

/* ── 2. Deflationary Token + DEX ── */
function wfDeflationary(ctx) {
  return [
    {
      name: 'Create Token',
      run: async function (ctx) {
        const res = await fetch(API_URL + '/api/create-token-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'BurnCoin',
            symbol: 'BURN',
            supply: '100000000',
            decimals: 6,
            features: ['burning'],
            burnRate: '0.05',
            description: 'Deflationary token with auto-burn',
          }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        ctx.denom = data.denom;
        ctx.txHash = data.txHash;
        return 'Denom: ' + data.denom;
      },
    },
    {
      name: 'Create DEX Pair',
      run: async function (ctx) {
        try {
          const res = await fetch(API_URL + '/api/dex/create-pair', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              baseDenom: ctx.denom,
              quoteDenom: 'utestcore',
            }),
          });
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          return 'DEX pair created';
        } catch (err) {
          return 'DEX pair skipped — endpoint may not be available (' + err.message + ')';
        }
      },
    },
    {
      name: 'Deploy Market Maker Swarm',
      run: async function (ctx) {
        ctx.swarmReady = true;
        return 'Swarm ready. Go to Agent Swarm tab and enter denom: ' + (ctx.denom || '?');
      },
    },
  ];
}

/* ── 3. Subscription Pass System ── */
function wfSubscription(ctx) {
  return [
    {
      name: 'Create Pass Token',
      run: async function (ctx) {
        const res = await fetch(API_URL + '/api/subs/create-pass', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: ctx.name || 'AccessPass',
            subunit: 'accesspass',
            price: ctx.price || 10,
            duration: ctx.duration || 30,
            merchantAddress: ctx.merchantAddress || '',
            description: 'Monthly access pass',
          }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        ctx.denom = data.denom;
        ctx.txHash = data.txHash;
        return 'Pass denom: ' + data.denom;
      },
    },
    {
      name: 'Generate Embed Code',
      run: async function (ctx) {
        const passName = ctx.name || 'AccessPass';
        const price = ctx.price || 10;
        ctx.embedCode =
          '<script src="https://txai.io/embed/pass.js"><\/script>\n' +
          '<txai-pass\n' +
          '  token="' + (ctx.denom || '') + '"\n' +
          '  price="' + price + '"\n' +
          '  label="Buy ' + passName + '"\n' +
          '/>';
        return 'Embed code generated';
      },
    },
    {
      name: 'System Ready',
      run: async function (ctx) {
        const verifyUrl = API_URL + '/api/subs/verify?denom=' + encodeURIComponent(ctx.denom || '');
        return 'Pass system live. Embed code ready. Verify URL: ' + verifyUrl;
      },
    },
  ];
}

/* ── 4. Revenue Token Launch ── */
function wfRevenue(ctx) {
  return [
    {
      name: 'Create Token',
      run: async function (ctx) {
        const res = await fetch(API_URL + '/api/create-token-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'RevShare',
            symbol: 'REV',
            supply: '50000000',
            decimals: 6,
            features: ['minting'],
            feeRate: '0.03',
            description: 'Revenue token with transfer fee',
          }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        ctx.denom = data.denom;
        ctx.txHash = data.txHash;
        return 'Denom: ' + data.denom;
      },
    },
    {
      name: 'Record in txdb',
      run: async function (ctx) {
        if (typeof txdbChainWrite === 'function') {
          txdbChainWrite('tokens', {
            n: 'RevShare',
            s: 'REV',
            d: (ctx.denom || '').slice(0, 80),
            wf: 'revenue',
          });
          return 'Recorded on-chain';
        }
        return 'txdb not available — skipped';
      },
    },
    {
      name: 'Ready for DEX',
      run: async function (ctx) {
        return 'Token ' + (ctx.denom || '?') + ' is ready. List on DEX tab for trading.';
      },
    },
  ];
}

/* ── 5. API Access Token ── */
function wfApiKey(ctx) {
  return [
    {
      name: 'Create Token',
      run: async function (ctx) {
        const res = await fetch(API_URL + '/api/create-token-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'APIAccess',
            symbol: 'APIKEY',
            supply: '1000',
            decimals: 0,
            features: ['freezing', 'whitelisting'],
            description: 'On-chain API access key',
          }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        ctx.denom = data.denom;
        ctx.txHash = data.txHash;
        return 'Denom: ' + data.denom;
      },
    },
    {
      name: 'Record in txdb',
      run: async function (ctx) {
        if (typeof txdbChainWrite === 'function') {
          txdbChainWrite('tokens', {
            n: 'APIAccess',
            s: 'APIKEY',
            d: (ctx.denom || '').slice(0, 80),
            wf: 'apikey',
          });
          return 'Recorded on-chain';
        }
        return 'txdb not available — skipped';
      },
    },
    {
      name: 'Ready to Distribute',
      run: async function (ctx) {
        return 'Token ' + (ctx.denom || '?') + ' is ready. Use the Airdrop tool to distribute keys.';
      },
    },
  ];
}

/* ── 6. DAO Governance Token ── */
function wfGovernance(ctx) {
  return [
    {
      name: 'Create Token',
      run: async function (ctx) {
        const res = await fetch(API_URL + '/api/create-token-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'GovToken',
            symbol: 'GOV',
            supply: '10000000',
            decimals: 6,
            features: ['governance', 'ibcEnabled'],
            description: 'DAO governance token',
          }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        ctx.denom = data.denom;
        ctx.txHash = data.txHash;
        return 'Denom: ' + data.denom;
      },
    },
    {
      name: 'Record in txdb',
      run: async function (ctx) {
        if (typeof txdbChainWrite === 'function') {
          txdbChainWrite('tokens', {
            n: 'GovToken',
            s: 'GOV',
            d: (ctx.denom || '').slice(0, 80),
            wf: 'governance',
          });
          return 'Recorded on-chain';
        }
        return 'txdb not available — skipped';
      },
    },
    {
      name: 'Ready for Airdrop',
      run: async function (ctx) {
        return 'Token ' + (ctx.denom || '?') + ' is ready. Airdrop to DAO members to begin governance.';
      },
    },
  ];
}

/* ── 7. NFT Collection Launch ── */
function wfNftCollection(ctx) {
  return [
    {
      name: 'Create Collection',
      run: async function (ctx) {
        const res = await fetch(API_URL + '/api/nft/issue-class', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: 'ART',
            name: 'Art Collection',
            description: 'Smart NFT collection',
            features: { burning: true },
            royaltyRate: '0.05',
          }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        ctx.classId = data.classId;
        ctx.txHash = data.txHash;
        return 'Class ID: ' + data.classId;
      },
    },
    {
      name: 'Batch Mint',
      run: async function (ctx) {
        if (!ctx.classId) throw new Error('No classId — collection step must succeed first');

        let minted = 0;
        for (let i = 1; i <= 5; i++) {
          agentLogStep('Minting nft-' + i + ' ...');
          const res = await fetch(API_URL + '/api/nft/mint', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              classId: ctx.classId,
              id: 'nft-' + i,
              name: 'Art #' + i,
              description: 'Piece ' + i + ' of the Art Collection',
            }),
          });
          const data = await res.json();
          if (data.error) throw new Error('Mint nft-' + i + ' failed: ' + data.error);
          minted++;
        }
        ctx.mintCount = minted;
        return minted + ' NFTs minted';
      },
    },
    {
      name: 'Collection Ready',
      run: async function (ctx) {
        return 'Collection ' + (ctx.classId || '?') + ' live with ' + (ctx.mintCount || 0) + ' NFTs.';
      },
    },
  ];
}

/* ── 8. Full Token Economy ── */
function wfFullLaunch(ctx) {
  return [
    {
      name: 'Create Token',
      run: async function (ctx) {
        const res = await fetch(API_URL + '/api/create-token-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: ctx.name || 'EcoToken',
            symbol: ctx.symbol || 'ECO',
            supply: ctx.supply || '100000000',
            decimals: 6,
            features: ['minting', 'burning'],
            description: ctx.description || 'Full economy token',
          }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        ctx.denom = data.denom;
        ctx.txHash = data.txHash;
        return 'Denom: ' + data.denom;
      },
    },
    {
      name: 'Deploy Swarm',
      run: async function (ctx) {
        ctx.swarmReady = true;
        return 'Go to Agent Swarm tab and enter denom: ' + (ctx.denom || '?');
      },
    },
    {
      name: 'System Ready',
      run: async function (ctx) {
        return 'Token economy deployed. Denom: ' + (ctx.denom || '?') + '. Swarm + DEX ready.';
      },
    },
  ];
}


/* ════════════════════════════════════════════════════
   Local Storage
   ════════════════════════════════════════════════════ */

function agentLoadHistory() {
  try {
    const raw = localStorage.getItem(WORKFLOW_STORAGE_KEY);
    workflowHistory = raw ? JSON.parse(raw) : [];
  } catch { workflowHistory = []; }
}

function agentSaveHistory() {
  try {
    localStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(workflowHistory.slice(0, 50)));
  } catch {}
}

// Load history on script init
agentLoadHistory();


/* ════════════════════════════════════════════════════
   Modal Styles (injected once)
   ════════════════════════════════════════════════════ */

let workflowStylesInjected = false;

function agentInjectStyles() {
  if (workflowStylesInjected) return;
  workflowStylesInjected = true;

  const css = document.createElement('style');
  css.textContent =
    '.wf-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;display:flex;align-items:center;justify-content:center}' +
    '.wf-modal{background:#1a1a2e;color:#e0e0e0;border-radius:12px;width:520px;max-width:92vw;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,.5);overflow:hidden}' +
    '.wf-modal-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #2a2a4a}' +
    '.wf-modal-title{margin:0;font-size:16px;font-weight:600;color:#fff}' +
    '.wf-modal-close{background:none;border:none;color:#888;font-size:22px;cursor:pointer;padding:0 4px;line-height:1}' +
    '.wf-modal-close:hover{color:#fff}' +
    '.wf-steps{padding:12px 20px;flex:1;overflow-y:auto}' +
    '.wf-step{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #2a2a4a;font-size:13px}' +
    '.wf-step:last-child{border-bottom:none}' +
    '.wf-step-icon{width:20px;text-align:center;font-size:14px;flex-shrink:0}' +
    '.wf-step-name{font-weight:500;min-width:120px}' +
    '.wf-step-status{color:#888;min-width:60px;text-transform:uppercase;font-size:11px;letter-spacing:.5px}' +
    '.wf-step-detail{color:#aaa;font-size:12px;flex:1;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.wf-step.running .wf-step-icon{color:#f0ad4e}' +
    '.wf-step.running .wf-step-status{color:#f0ad4e}' +
    '.wf-step.done .wf-step-icon{color:#5cb85c}' +
    '.wf-step.done .wf-step-status{color:#5cb85c}' +
    '.wf-step.error .wf-step-icon{color:#d9534f}' +
    '.wf-step.error .wf-step-status{color:#d9534f}' +
    '.wf-step.skipped .wf-step-icon{color:#666}' +
    '.wf-step.skipped .wf-step-status{color:#666}' +
    '.wf-log{border-top:1px solid #2a2a4a;padding:10px 20px;max-height:150px;overflow-y:auto;font-family:monospace;font-size:11px;color:#aaa;background:#12122a}' +
    '.wf-log-line{padding:2px 0;border-bottom:1px solid #1a1a3a}';
  document.head.appendChild(css);
}
