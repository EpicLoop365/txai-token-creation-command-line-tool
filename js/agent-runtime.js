// ─── Agent Runtime Engine ─────────────────────────────────────────────────
// Manages running agents, execution logs, subcontracting, and the dashboard.
// Agents registered here have their scripts executed server-side on cron.

const RUNTIME_POLL_MS = 10_000; // refresh dashboard every 10s
let runtimePollTimer = null;
let runtimeAgents = []; // cached from API

// ── Register agent to run ────────────────────────────────────────────────
async function runtimeRegister(agentClassId, agentNftId, opts = {}) {
  try {
    const res = await fetch(`${API_URL}/api/runtime/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        classId: agentClassId,
        nftId: agentNftId,
        interval: opts.interval || 60,
        network: typeof getSelectedNetwork === 'function' ? getSelectedNetwork() : 'testnet',
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    runtimeRefreshDashboard();
    return data;
  } catch (e) {
    console.error('[runtime] Register failed:', e.message);
    return { error: e.message };
  }
}

// ── Stop agent ───────────────────────────────────────────────────────────
async function runtimeStop(agentId) {
  try {
    const res = await fetch(`${API_URL}/api/runtime/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId }),
    });
    const data = await res.json();
    runtimeRefreshDashboard();
    return data;
  } catch (e) {
    console.error('[runtime] Stop failed:', e.message);
    return { error: e.message };
  }
}

// ── Get execution logs ───────────────────────────────────────────────────
async function runtimeGetLogs(agentId, limit = 50) {
  try {
    const res = await fetch(`${API_URL}/api/runtime/logs/${encodeURIComponent(agentId)}?limit=${limit}`);
    return await res.json();
  } catch (e) {
    return { logs: [], error: e.message };
  }
}

// ── Subcontract: one agent hires another ─────────────────────────────────
async function runtimeSubcontract(leadAgentId, subAgentId, task, budgetTx) {
  try {
    const res = await fetch(`${API_URL}/api/runtime/subcontract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leadAgentId,
        subAgentId,
        task,
        budget: budgetTx,
      }),
    });
    return await res.json();
  } catch (e) {
    return { error: e.message };
  }
}

// ── Refresh dashboard data ───────────────────────────────────────────────
async function runtimeRefreshDashboard() {
  const wrap = document.getElementById('runtimeDashboard');
  if (!wrap) return;

  try {
    const res = await fetch(`${API_URL}/api/runtime/status`);
    const data = await res.json();
    runtimeAgents = data.agents || [];
    runtimeRenderDashboard(data);
  } catch (e) {
    wrap.innerHTML = `<div class="runtime-empty">⚠️ Cannot reach runtime API</div>`;
  }
}

// ── Render dashboard ─────────────────────────────────────────────────────
function runtimeRenderDashboard(data) {
  const wrap = document.getElementById('runtimeDashboard');
  if (!wrap) return;

  const agents = data.agents || [];
  const stats = data.stats || {};

  // Summary cards
  let html = `
    <div class="runtime-stats">
      <div class="runtime-stat-card">
        <div class="runtime-stat-value">${agents.length}</div>
        <div class="runtime-stat-label">Running Agents</div>
      </div>
      <div class="runtime-stat-card">
        <div class="runtime-stat-value">${stats.totalExecutions || 0}</div>
        <div class="runtime-stat-label">Total Executions</div>
      </div>
      <div class="runtime-stat-card">
        <div class="runtime-stat-value">${stats.totalAlerts || 0}</div>
        <div class="runtime-stat-label">Alerts Fired</div>
      </div>
      <div class="runtime-stat-card">
        <div class="runtime-stat-value">${(stats.totalEarnings || 0).toFixed(1)} TX</div>
        <div class="runtime-stat-label">Earnings</div>
      </div>
    </div>
  `;

  if (agents.length === 0) {
    html += `
      <div class="runtime-empty">
        <div class="runtime-empty-icon">🤖</div>
        <div class="runtime-empty-text">No agents running yet</div>
        <div class="runtime-empty-hint">Mint an Agent NFT with a script, then start it here</div>
      </div>
    `;
  } else {
    html += `<div class="runtime-agent-list">`;
    for (const agent of agents) {
      const statusClass = agent.status === 'running' ? 'running' : agent.status === 'error' ? 'error' : 'paused';
      const lastRun = agent.lastRun ? new Date(agent.lastRun).toLocaleTimeString() : 'Never';
      const nextRun = agent.nextRun ? new Date(agent.nextRun).toLocaleTimeString() : '—';

      html += `
        <div class="runtime-agent-card ${statusClass}">
          <div class="runtime-agent-header">
            <div class="runtime-agent-status-dot ${statusClass}"></div>
            <div class="runtime-agent-name">${escapeHtml(agent.name || agent.agentId)}</div>
            <div class="runtime-agent-type">${escapeHtml(agent.template || 'custom')}</div>
          </div>
          <div class="runtime-agent-meta">
            <span>⏱️ Every ${agent.interval}s</span>
            <span>📊 ${agent.execCount || 0} runs</span>
            <span>⚡ ${agent.alertCount || 0} alerts</span>
            <span>💰 ${(agent.earnings || 0).toFixed(2)} TX</span>
          </div>
          <div class="runtime-agent-timing">
            <span>Last: ${lastRun}</span>
            <span>Next: ${nextRun}</span>
          </div>
          ${agent.lastError ? `<div class="runtime-agent-error">❌ ${escapeHtml(agent.lastError)}</div>` : ''}
          ${agent.subcontracts && agent.subcontracts.length > 0 ? `
            <div class="runtime-agent-subs">
              <div class="runtime-sub-label">🔗 Subcontractors:</div>
              ${agent.subcontracts.map(s => `
                <span class="runtime-sub-badge">${escapeHtml(s.name)} — ${s.task} (${s.budget} TX)</span>
              `).join('')}
            </div>
          ` : ''}
          <div class="runtime-agent-actions">
            <button class="runtime-btn logs" onclick="runtimeShowLogs('${agent.agentId}')">📋 Logs</button>
            <button class="runtime-btn sub" onclick="runtimeShowSubcontract('${agent.agentId}')">🔗 Hire Sub</button>
            ${agent.social?.twitter ? `<a class="runtime-btn tw" href="https://twitter.com/${agent.social.twitter}" target="_blank">🐦 @${agent.social.twitter}</a>` : ''}
            <button class="runtime-btn stop" onclick="runtimeStop('${agent.agentId}')">⏹ Stop</button>
          </div>
        </div>
      `;
    }
    html += `</div>`;
  }

  // Leaderboard
  if (data.leaderboard && data.leaderboard.length > 0) {
    html += `
      <div class="runtime-leaderboard">
        <div class="runtime-section-title">🏆 Agent Leaderboard</div>
        <div class="runtime-lb-list">
          ${data.leaderboard.map((a, i) => `
            <div class="runtime-lb-row">
              <span class="runtime-lb-rank">#${i + 1}</span>
              <span class="runtime-lb-name">${escapeHtml(a.name)}</span>
              <span class="runtime-lb-rep">⭐ ${a.reputation}</span>
              <span class="runtime-lb-jobs">${a.jobsCompleted} jobs</span>
              <span class="runtime-lb-earn">${a.earnings.toFixed(1)} TX</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  wrap.innerHTML = html;
}

// ── Show logs modal ──────────────────────────────────────────────────────
async function runtimeShowLogs(agentId) {
  const data = await runtimeGetLogs(agentId, 30);
  const logs = data.logs || [];

  const overlay = document.createElement('div');
  overlay.className = 'runtime-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const agent = runtimeAgents.find(a => a.agentId === agentId);
  const name = agent ? (agent.name || agent.agentId) : agentId;

  let logHtml = logs.length === 0
    ? '<div class="runtime-log-empty">No execution logs yet</div>'
    : logs.map(l => `
        <div class="runtime-log-entry ${l.status}">
          <span class="runtime-log-time">${new Date(l.timestamp).toLocaleString()}</span>
          <span class="runtime-log-status ${l.status}">${l.status === 'ok' ? '✅' : l.status === 'alert' ? '🚨' : '❌'}</span>
          <span class="runtime-log-msg">${escapeHtml(l.message || '')}</span>
          ${l.duration ? `<span class="runtime-log-dur">${l.duration}ms</span>` : ''}
        </div>
      `).join('');

  overlay.innerHTML = `
    <div class="runtime-modal">
      <div class="runtime-modal-header">
        <h3>📋 ${escapeHtml(name)} — Execution Log</h3>
        <button class="runtime-modal-close" onclick="this.closest('.runtime-overlay').remove()">&times;</button>
      </div>
      <div class="runtime-log-list">${logHtml}</div>
    </div>
  `;
  document.body.appendChild(overlay);
}

// ── Show subcontract modal ───────────────────────────────────────────────
function runtimeShowSubcontract(leadAgentId) {
  const overlay = document.createElement('div');
  overlay.className = 'runtime-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  // Build available agents list (exclude self)
  const available = runtimeAgents.filter(a => a.agentId !== leadAgentId);
  const options = available.map(a =>
    `<option value="${a.agentId}">${escapeHtml(a.name || a.agentId)} — ⭐ ${a.reputation || 0}</option>`
  ).join('');

  overlay.innerHTML = `
    <div class="runtime-modal">
      <div class="runtime-modal-header">
        <h3>🔗 Hire a Subcontractor</h3>
        <button class="runtime-modal-close" onclick="this.closest('.runtime-overlay').remove()">&times;</button>
      </div>
      <div class="runtime-sub-form">
        <label>Select Agent:</label>
        <select id="runtimeSubSelect" class="runtime-input">${options || '<option disabled>No other agents running</option>'}</select>
        <label>Task Description:</label>
        <input id="runtimeSubTask" class="runtime-input" placeholder="e.g. Monitor whale wallets > 100k TX">
        <label>Budget (TX):</label>
        <input id="runtimeSubBudget" class="runtime-input" type="number" placeholder="50" min="1">
        <button class="runtime-btn primary" onclick="runtimeDoSubcontract('${leadAgentId}')">Hire Agent</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function runtimeDoSubcontract(leadAgentId) {
  const subId = document.getElementById('runtimeSubSelect')?.value;
  const task = document.getElementById('runtimeSubTask')?.value;
  const budget = parseFloat(document.getElementById('runtimeSubBudget')?.value) || 0;
  if (!subId || !task || budget <= 0) return alert('Fill in all fields');

  const result = await runtimeSubcontract(leadAgentId, subId, task, budget);
  if (result.error) {
    alert('Subcontract failed: ' + result.error);
  } else {
    document.querySelector('.runtime-overlay')?.remove();
    runtimeRefreshDashboard();
  }
}

// ── Start agent from UI ──────────────────────────────────────────────────
function runtimeShowStartForm() {
  const wrap = document.getElementById('runtimeStartForm');
  if (!wrap) return;
  wrap.style.display = wrap.style.display === 'none' ? '' : 'none';
}

async function runtimeStartAgent() {
  const classId = document.getElementById('runtimeClassId')?.value?.trim();
  const nftId = document.getElementById('runtimeNftId')?.value?.trim();
  const interval = parseInt(document.getElementById('runtimeInterval')?.value) || 60;

  if (!classId || !nftId) return alert('Enter Class ID and NFT ID');

  const btn = document.querySelector('#runtimeStartForm .runtime-btn.primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Starting...'; }

  const result = await runtimeRegister(classId, nftId, { interval });

  if (btn) { btn.disabled = false; btn.textContent = 'Start Agent'; }

  if (result.error) {
    alert('Failed: ' + result.error);
  } else {
    document.getElementById('runtimeStartForm').style.display = 'none';
    document.getElementById('runtimeClassId').value = '';
    document.getElementById('runtimeNftId').value = '';
  }
}

// ── Init: start polling when runtime tab visible ─────────────────────────
function runtimeInit() {
  runtimeRefreshDashboard();
  if (runtimePollTimer) clearInterval(runtimePollTimer);
  runtimePollTimer = setInterval(runtimeRefreshDashboard, RUNTIME_POLL_MS);
}

function runtimeCleanup() {
  if (runtimePollTimer) { clearInterval(runtimePollTimer); runtimePollTimer = null; }
}

// ── Utility ──────────────────────────────────────────────────────────────
function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
