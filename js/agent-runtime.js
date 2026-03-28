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
        twitter: opts.twitter || '',
        personality: opts.personality || 'default',
        autoTweet: opts.autoTweet !== false,
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
          ${agent.social?.recentTweets?.length > 0 ? `
            <div class="runtime-tweet-preview">
              <div class="runtime-sub-label">🐦 Latest Tweet:</div>
              <div class="runtime-tweet-text">${escapeHtml(agent.social.recentTweets[0].text)}</div>
            </div>
          ` : ''}
          <div class="runtime-agent-actions">
            <button class="runtime-btn logs" onclick="runtimeShowLogs('${agent.agentId}')">📋 Logs</button>
            <button class="runtime-btn sub" onclick="runtimeShowSubcontract('${agent.agentId}')">🔗 Hire Sub</button>
            <button class="runtime-btn tw" onclick="runtimeShowTweets('${agent.agentId}')">🐦 ${agent.social?.tweetCount || 0} Tweets</button>
            <button class="runtime-btn" onclick="runtimeShowSocial('${agent.agentId}')">⚙️ Social</button>
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

  // Global tweet feed
  html += `
    <div class="runtime-feed" id="runtimeFeed">
      <div class="runtime-section-title">🐦 Agent Feed</div>
      <div class="runtime-feed-list" id="runtimeFeedList">Loading...</div>
    </div>
  `;

  wrap.innerHTML = html;

  // Load feed
  runtimeLoadFeed();
}

// ── Global agent tweet feed ──────────────────────────────────────────────
async function runtimeLoadFeed() {
  const list = document.getElementById('runtimeFeedList');
  if (!list) return;

  try {
    const res = await fetch(`${API_URL}/api/runtime/feed`);
    const data = await res.json();
    const tweets = data.tweets || [];

    if (tweets.length === 0) {
      list.innerHTML = `<div class="runtime-feed-empty">No tweets yet. Start an agent with auto-tweet enabled!</div>`;
      return;
    }

    list.innerHTML = tweets.map(t => `
      <div class="runtime-feed-item ${t.posted ? 'posted' : ''}">
        <div class="runtime-feed-header">
          <span class="runtime-feed-agent">${escapeHtml(t.agentName)}</span>
          ${t.twitter ? `<span class="runtime-feed-handle">@${escapeHtml(t.twitter)}</span>` : ''}
          <span class="runtime-feed-trigger">${t.trigger}</span>
          <span class="runtime-feed-time">${new Date(t.timestamp).toLocaleTimeString()}</span>
        </div>
        <div class="runtime-feed-text">${escapeHtml(t.text)}</div>
        <div class="runtime-feed-actions">
          ${!t.posted ? `
            <a class="runtime-btn tw" href="${t.intentUrl}" target="_blank" onclick="runtimeMarkPosted('${t.agentId}','${t.id}')">Post to X →</a>
          ` : `<span class="runtime-feed-posted-badge">✅ Posted</span>`}
          <button class="runtime-btn" onclick="navigator.clipboard.writeText('${escapeHtml(t.text).replace(/'/g, "\\'")}')">📋 Copy</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = `<div class="runtime-feed-empty">Could not load feed</div>`;
  }
}

async function runtimeMarkPosted(agentId, tweetId) {
  try {
    await fetch(`${API_URL}/api/runtime/tweet/mark-posted`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, tweetId }),
    });
    // Refresh after a moment (let the intent URL open first)
    setTimeout(runtimeLoadFeed, 2000);
  } catch (e) {}
}

// ── Show tweets modal ────────────────────────────────────────────────────
async function runtimeShowTweets(agentId) {
  const parts = agentId.split('/');
  let tweets = [];
  let agentName = agentId;

  try {
    const res = await fetch(`${API_URL}/api/runtime/tweets/${parts[0]}/${parts[1]}?limit=30`);
    const data = await res.json();
    tweets = data.tweets || [];
    agentName = data.name || agentId;
  } catch (e) {}

  const overlay = document.createElement('div');
  overlay.className = 'runtime-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const tweetHtml = tweets.length === 0
    ? '<div class="runtime-feed-empty">No tweets yet</div>'
    : tweets.map(t => `
        <div class="runtime-feed-item ${t.posted ? 'posted' : ''}">
          <div class="runtime-feed-header">
            <span class="runtime-feed-trigger">${t.trigger}</span>
            <span class="runtime-feed-time">${new Date(t.timestamp).toLocaleString()}</span>
            ${t.posted ? '<span class="runtime-feed-posted-badge">✅</span>' : ''}
          </div>
          <div class="runtime-feed-text">${escapeHtml(t.text)}</div>
          ${!t.posted ? `
            <a class="runtime-btn tw" href="${t.intentUrl}" target="_blank" onclick="runtimeMarkPosted('${agentId}','${t.id}')">Post to X →</a>
          ` : ''}
        </div>
      `).join('');

  // Compose new tweet
  overlay.innerHTML = `
    <div class="runtime-modal">
      <div class="runtime-modal-header">
        <h3>🐦 ${escapeHtml(agentName)} — Tweets</h3>
        <button class="runtime-modal-close" onclick="this.closest('.runtime-overlay').remove()">&times;</button>
      </div>
      <div class="runtime-compose">
        <textarea id="runtimeComposeText" class="runtime-input" rows="3" maxlength="280" placeholder="Compose a tweet as ${escapeHtml(agentName)}..."></textarea>
        <div class="runtime-compose-footer">
          <span class="runtime-compose-count">0/280</span>
          <button class="runtime-btn primary" onclick="runtimePostManual('${agentId}')">Queue Tweet</button>
        </div>
      </div>
      <div class="runtime-tweet-list">${tweetHtml}</div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Character counter
  const ta = document.getElementById('runtimeComposeText');
  const counter = overlay.querySelector('.runtime-compose-count');
  ta.addEventListener('input', () => {
    counter.textContent = `${ta.value.length}/280`;
  });
}

async function runtimePostManual(agentId) {
  const text = document.getElementById('runtimeComposeText')?.value?.trim();
  if (!text) return;

  try {
    await fetch(`${API_URL}/api/runtime/tweet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, text }),
    });
    document.querySelector('.runtime-overlay')?.remove();
    runtimeRefreshDashboard();
  } catch (e) {
    alert('Failed to queue tweet');
  }
}

// ── Social settings modal ────────────────────────────────────────────────
function runtimeShowSocial(agentId) {
  const agent = runtimeAgents.find(a => a.agentId === agentId);
  if (!agent) return;

  const overlay = document.createElement('div');
  overlay.className = 'runtime-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  overlay.innerHTML = `
    <div class="runtime-modal">
      <div class="runtime-modal-header">
        <h3>⚙️ ${escapeHtml(agent.name)} — Social Config</h3>
        <button class="runtime-modal-close" onclick="this.closest('.runtime-overlay').remove()">&times;</button>
      </div>
      <div class="runtime-sub-form">
        <label>Twitter/X Handle</label>
        <input id="runtimeSocialTwitter" class="runtime-input" placeholder="@myagent" value="${escapeHtml(agent.social?.twitter || '')}">

        <label>Telegram Channel</label>
        <input id="runtimeSocialTelegram" class="runtime-input" placeholder="@mychannel" value="${escapeHtml(agent.social?.telegram || '')}">

        <label>Tweet Personality</label>
        <select id="runtimeSocialPersonality" class="runtime-input">
          <option value="default" ${agent.social?.personality === 'default' ? 'selected' : ''}>Default — balanced, informative</option>
          <option value="hype" ${agent.social?.personality === 'hype' ? 'selected' : ''}>Hype — ALL CAPS, excited!!!</option>
          <option value="chill" ${agent.social?.personality === 'chill' ? 'selected' : ''}>Chill — calm, minimal emoji</option>
          <option value="degen" ${agent.social?.personality === 'degen' ? 'selected' : ''}>Degen — crypto slang, moon vibes</option>
          <option value="professional" ${agent.social?.personality === 'professional' ? 'selected' : ''}>Professional — formal, data-driven</option>
        </select>

        <label style="display:flex;align-items:center;gap:8px;margin-top:12px">
          <input type="checkbox" id="runtimeSocialAutoTweet" ${agent.social?.autoTweet !== false ? 'checked' : ''}>
          Auto-tweet on alerts, milestones & earnings
        </label>

        <button class="runtime-btn primary" style="margin-top:14px" onclick="runtimeSaveSocial('${agentId}')">Save Settings</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function runtimeSaveSocial(agentId) {
  const twitter = document.getElementById('runtimeSocialTwitter')?.value?.trim().replace(/^@/, '') || '';
  const telegram = document.getElementById('runtimeSocialTelegram')?.value?.trim().replace(/^@/, '') || '';
  const personality = document.getElementById('runtimeSocialPersonality')?.value || 'default';
  const autoTweet = document.getElementById('runtimeSocialAutoTweet')?.checked !== false;

  try {
    await fetch(`${API_URL}/api/runtime/social`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, twitter, telegram, personality, autoTweet }),
    });
    document.querySelector('.runtime-overlay')?.remove();
    runtimeRefreshDashboard();
  } catch (e) {
    alert('Failed to save social settings');
  }
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
  const twitter = document.getElementById('runtimeTwitter')?.value?.trim().replace(/^@/, '') || '';
  const personality = document.getElementById('runtimePersonality')?.value || 'default';
  const autoTweet = document.getElementById('runtimeAutoTweet')?.checked !== false;

  if (!classId || !nftId) return alert('Enter Class ID and NFT ID');

  const btn = document.querySelector('#runtimeStartForm .runtime-btn.primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Starting...'; }

  const result = await runtimeRegister(classId, nftId, { interval, twitter, personality, autoTweet });

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
