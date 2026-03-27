/* ===== TXAI - AI Agent Swarm Tab ===== */

let swarmRunning = false;
let swarmTimerInterval = null;
let swarmStartTime = null;
let swarmOrderCounts = { A: 0, B: 0, Taker: 0 };
let swarmHistory = [];
let swarmCurrentDenom = '';
let swarmCurrentSymbol = '';

/* ── Template Selection ── */
function swarmSelectTemplate(templateId) {
  if (templateId !== 'market-maker') {
    // Coming soon templates
    const card = document.querySelector(`.swarm-template-card[data-template="${templateId}"]`);
    if (card) {
      const badge = card.querySelector('.swarm-soon-badge');
      if (badge) {
        badge.textContent = 'Coming Soon!';
        badge.style.background = 'rgba(239,68,68,.3)';
        setTimeout(() => { badge.textContent = 'COMING SOON'; badge.style.background = ''; }, 2000);
      }
    }
    return;
  }

  // Highlight selected card
  document.querySelectorAll('.swarm-template-card').forEach(c => c.classList.remove('selected'));
  document.querySelector('.swarm-template-card[data-template="market-maker"]').classList.add('selected');

  // Show launch panel
  const panel = document.getElementById('swarmLaunchPanel');
  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  document.getElementById('swarmTokenDenom').focus();
}

/* ── Load Token Info ── */
async function swarmLoadToken() {
  const denomInput = document.getElementById('swarmTokenDenom');
  const denom = denomInput.value.trim();
  if (!denom) { alert('Enter a token denom.'); return; }

  swarmCurrentDenom = denom;
  swarmCurrentSymbol = denom.split('-')[0].toUpperCase();

  const info = document.getElementById('swarmTokenInfo');
  info.style.display = 'block';
  info.innerHTML = `<span class="swarm-loading">Checking token readiness...</span>`;

  try {
    const res = await fetch(`${API_URL}/api/dex/check-demo-ready`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseDenom: denom }),
    });
    const data = await res.json();

    if (data.error) {
      info.innerHTML = `<span class="swarm-error">Error: ${data.error}</span>`;
      return;
    }

    if (data.ready) {
      info.innerHTML = `
        <div class="swarm-token-ready">
          <span class="swarm-ready-badge">READY</span>
          <b>${swarmCurrentSymbol}</b> — Agent wallet has enough tokens.
          <br><small>3 agents will place 23+ orders with overlapping prices for fills.</small>
        </div>`;
      document.getElementById('swarmDeployBtn').disabled = false;
    } else {
      info.innerHTML = `
        <div class="swarm-token-deposit">
          <span class="swarm-deposit-badge">DEPOSIT NEEDED</span>
          <b>${swarmCurrentSymbol}</b> — Agent needs <b>${(data.tokensNeeded || 7000).toLocaleString()}</b> tokens.
          <span style="color:#8b949e">(Has ${(data.tokensHeld || 0).toLocaleString()})</span>
          <div class="swarm-deposit-addr">
            <code>${data.agentAddress || '?'}</code>
            <button class="swarm-copy-btn" onclick="swarmCopyAddr('${data.agentAddress || ''}')">Copy</button>
          </div>
          <small style="color:#22c55e">Send tokens to this address, then click "Check Again" below.</small>
          <button class="swarm-check-again-btn" onclick="swarmLoadToken()">🔍 Check Again</button>
        </div>`;
      document.getElementById('swarmDeployBtn').disabled = true;
    }
  } catch (err) {
    info.innerHTML = `<span class="swarm-error">Error: ${err.message}</span>`;
  }
}

function swarmCopyAddr(addr) {
  navigator.clipboard.writeText(addr).then(() => {
    const btns = document.querySelectorAll('.swarm-copy-btn');
    btns.forEach(b => { b.textContent = '✅'; setTimeout(() => { b.textContent = 'Copy'; }, 2000); });
  });
}

/* ── Deploy Swarm ── */
async function swarmDeploy() {
  if (!swarmCurrentDenom) { alert('Load a token first.'); return; }
  if (swarmRunning || window.txaiDemoRunning) {
    alert('A swarm is already running. Please wait.');
    return;
  }

  // Determine return address
  const returnAddr = (typeof walletMode !== 'undefined' && walletMode !== 'agent' && typeof connectedAddress !== 'undefined' && connectedAddress)
    ? connectedAddress : undefined;

  swarmRunning = true;
  window.txaiDemoRunning = true;

  // Hide launch panel, show monitor
  document.getElementById('swarmLaunchPanel').style.display = 'none';
  const monitor = document.getElementById('swarmMonitor');
  monitor.style.display = 'block';
  monitor.scrollIntoView({ behavior: 'smooth' });

  // Reset monitor UI
  document.getElementById('swarmMonitorTitle').textContent = swarmCurrentSymbol;
  document.getElementById('swarmTimeline').innerHTML =
    `<div class="demo-log-entry info">Deploying Market Maker swarm for ${swarmCurrentSymbol}...</div>`;
  document.getElementById('swarmSummary').style.display = 'none';
  document.getElementById('swarmPhase').textContent = 'Initializing...';
  document.getElementById('swarmBar').style.width = '0%';
  document.getElementById('swarmAddrA').textContent = 'Creating wallet...';
  document.getElementById('swarmAddrB').textContent = 'Creating wallet...';
  document.getElementById('swarmAddrTaker').textContent = 'Creating wallet...';
  document.getElementById('swarmBalA').textContent = '--';
  document.getElementById('swarmBalB').textContent = '--';
  document.getElementById('swarmBalTaker').textContent = '--';
  document.getElementById('swarmOrdersA').textContent = '0';
  document.getElementById('swarmOrdersB').textContent = '0';
  document.getElementById('swarmOrdersTaker').textContent = '0';
  swarmOrderCounts = { A: 0, B: 0, Taker: 0 };

  // Start timer
  swarmStartTime = Date.now();
  swarmTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - swarmStartTime) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    document.getElementById('swarmTimer').textContent = `${m}:${s}`;
  }, 1000);

  // Add to history
  const historyEntry = {
    id: Date.now(),
    token: swarmCurrentSymbol,
    denom: swarmCurrentDenom,
    status: 'running',
    startTime: new Date(),
    duration: '--',
    orders: 0,
    fills: 0,
  };
  swarmHistory.unshift(historyEntry);
  swarmUpdateHistory();

  // Start SSE
  await swarmFetchSSE(swarmCurrentDenom, returnAddr, historyEntry);
}

/* ── SSE Stream ── */
async function swarmFetchSSE(baseDenom, returnAddress, historyEntry) {
  try {
    const body = { baseDenom };
    if (returnAddress) body.returnAddress = returnAddress;
    const res = await fetch(`${API_URL}/api/dex/live-demo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      swarmLog('error', err.error || `HTTP ${res.status}`);
      swarmFinish(historyEntry, 'failed');
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let currentEvent = '';
      let currentData = '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          currentData = line.slice(6).trim();
        } else if (line === '' && currentEvent && currentData) {
          try {
            const data = JSON.parse(currentData);
            swarmProcessEvent(currentEvent, data, historyEntry);
          } catch { /* ignore */ }
          currentEvent = '';
          currentData = '';
        }
      }
    }
  } catch (err) {
    swarmLog('error', `Connection error: ${err.message}`);
    swarmFinish(historyEntry, 'failed');
  }
}

/* ── Process SSE Events ── */
function swarmProcessEvent(event, data, historyEntry) {
  const phases = {
    wallets: 5, funding: 15, connecting: 20, token: 25,
    transfer: 30, orders: 40, fills: 70, taker: 85, summary: 95, return: 97,
  };

  switch (event) {
    case 'phase':
      document.getElementById('swarmPhase').textContent = data.message;
      if (phases[data.phase]) {
        document.getElementById('swarmBar').style.width = phases[data.phase] + '%';
      }
      swarmLog('info', data.message);
      break;

    case 'wallet':
      swarmLog('success', `${data.agent} (${data.role}): ${addrLink(data.address)}`);
      if (data.agent.includes('Maker A')) {
        document.getElementById('swarmAddrA').innerHTML = addrLink(data.address);
      } else if (data.agent.includes('Maker B')) {
        document.getElementById('swarmAddrB').innerHTML = addrLink(data.address);
      } else if (data.agent.includes('Taker')) {
        document.getElementById('swarmAddrTaker').innerHTML = addrLink(data.address);
      }
      break;

    case 'funding': {
      const icon = data.success ? '💰' : '⚠️';
      swarmLog(data.success ? 'info' : 'warn',
        `${icon} ${data.agent} faucet ${data.request}/${data.total}: ${data.success ? 'funded' : data.message}`);
      break;
    }

    case 'balance':
      if (data.tokenBalance) {
        swarmLog('success', `${data.agent}: ${data.txBalance} | ${data.tokenBalance}`);
      } else {
        swarmLog('success', `${data.agent}: ${data.display}`);
      }
      if (data.agent?.includes('Maker A')) {
        document.getElementById('swarmBalA').textContent = data.display || data.txBalance || '--';
      } else if (data.agent?.includes('Maker B')) {
        document.getElementById('swarmBalB').textContent = data.display || data.txBalance || '--';
      } else if (data.agent?.includes('Taker')) {
        document.getElementById('swarmBalTaker').textContent = data.display || data.txBalance || '--';
      }
      break;

    case 'token':
      swarmLog('success', `Target token: <b>${data.symbol}</b>`);
      break;

    case 'transfer':
      swarmLog('transfer', `💰 ${data.from} → ${data.to}: <b>${data.amount.toLocaleString()} ${data.symbol}</b>${txLink(data.txHash)}`);
      break;

    case 'order': {
      const sideIcon = data.side === 'buy' ? '🟢' : '🔴';
      const statusIcon = data.status === 'placed' ? '✅' : data.status === 'error' ? '❌' : '⚠️';
      const overlap = data.overlap ? ' <span class="demo-overlap-badge">MATCH</span>' : '';
      const tx = data.txHash ? txLink(data.txHash) : '';
      swarmLog(data.status === 'error' ? 'error' : 'order',
        `${sideIcon} ${statusIcon} ${data.agent?.split(' ')[0] || '?'}: ${data.side?.toUpperCase()} <b>${data.quantity || '?'} ${data.symbol || ''}</b> @ ${data.priceDisplay || data.price} TX${overlap}${tx}`);

      if (data.status === 'placed') historyEntry.orders++;

      if (data.agent?.includes('Maker A')) {
        swarmOrderCounts.A++;
        document.getElementById('swarmOrdersA').textContent = swarmOrderCounts.A;
      } else if (data.agent?.includes('Maker B')) {
        swarmOrderCounts.B++;
        document.getElementById('swarmOrdersB').textContent = swarmOrderCounts.B;
      }

      const totalOrders = 23;
      const totalPlaced = swarmOrderCounts.A + swarmOrderCounts.B;
      const orderProgress = 40 + (totalPlaced / totalOrders) * 45;
      document.getElementById('swarmBar').style.width = Math.min(orderProgress, 85) + '%';
      break;
    }

    case 'fill':
      swarmLog('fill', `⚡ FILL: <b>${data.buyQty || data.quantity} ${data.symbol}</b> @ ${data.priceDisplay} TX — ${data.buyer} ↔ ${data.seller}${txLink(data.txHash)}`);
      historyEntry.fills++;
      break;

    case 'taker': {
      const takerIcon = data.action === 'buy' ? '🟢' : '🔴';
      swarmLog('taker', `${takerIcon} Taker ${data.action?.toUpperCase()}: <b>${data.quantity || '?'}</b> @ ${data.price}${txLink(data.txHash)}`);
      swarmOrderCounts.Taker++;
      document.getElementById('swarmOrdersTaker').textContent = swarmOrderCounts.Taker;
      historyEntry.orders++;
      break;
    }

    case 'return':
      if (data.step === 'sweep') {
        swarmLog('transfer', `🔄 Sweeping: ${data.from} → Agent: ${(data.amount || 0).toLocaleString()} ${data.symbol}`);
      } else if (data.step === 'refund') {
        swarmLog('success', `💰 Returned <b>${(data.amount || 0).toLocaleString()} ${data.symbol}</b> to your wallet${txLink(data.txHash)}`);
      } else if (data.step === 'error') {
        swarmLog('warn', `⚠️ ${data.message}`);
      }
      break;

    case 'summary':
      document.getElementById('swarmBar').style.width = '100%';
      document.getElementById('swarmPhase').textContent = 'Swarm complete!';
      document.getElementById('swarmSummary').style.display = 'block';
      document.getElementById('swarmSummaryGrid').innerHTML = `
        <div class="demo-stat"><span class="demo-stat-label">Token</span><span class="demo-stat-value">${data.token?.symbol || '?'}</span></div>
        <div class="demo-stat"><span class="demo-stat-label">Orders Placed</span><span class="demo-stat-value">${data.totals?.placed || 0}</span></div>
        <div class="demo-stat"><span class="demo-stat-label">Fills</span><span class="demo-stat-value">${data.totals?.fills || 0}</span></div>
        <div class="demo-stat"><span class="demo-stat-label">Errors</span><span class="demo-stat-value">${data.totals?.errors || 0}</span></div>
        <div class="demo-stat"><span class="demo-stat-label">Final Bids</span><span class="demo-stat-value green">${data.orderbook?.bids || 0}</span></div>
        <div class="demo-stat"><span class="demo-stat-label">Final Asks</span><span class="demo-stat-value red">${data.orderbook?.asks || 0}</span></div>
      `;
      break;

    case 'done':
      swarmLog('success', '🏁 Swarm complete! The orderbook is now populated.');
      swarmFinish(historyEntry, 'complete');
      break;

    case 'error':
      swarmLog('error', `💀 ${data.message}`);
      swarmFinish(historyEntry, 'failed');
      break;
  }
}

/* ── Finish / Cleanup ── */
function swarmFinish(historyEntry, status) {
  swarmRunning = false;
  window.txaiDemoRunning = false;
  if (swarmTimerInterval) {
    clearInterval(swarmTimerInterval);
    swarmTimerInterval = null;
  }
  if (historyEntry) {
    historyEntry.status = status;
    const elapsed = Math.floor((Date.now() - swarmStartTime) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    historyEntry.duration = `${m}m ${s}s`;
  }
  swarmUpdateHistory();
}

function swarmStop() {
  const monitor = document.getElementById('swarmMonitor');
  if (monitor) monitor.style.display = 'none';
  // Show templates again
  document.getElementById('swarmLaunchPanel').style.display = 'none';
  swarmRunning = false;
  window.txaiDemoRunning = false;
  if (swarmTimerInterval) {
    clearInterval(swarmTimerInterval);
    swarmTimerInterval = null;
  }
}

/* ── Timeline Logger ── */
function swarmLog(type, message) {
  const timeline = document.getElementById('swarmTimeline');
  if (!timeline) return;
  const entry = document.createElement('div');
  entry.className = `demo-log-entry ${type}`;
  const time = new Date().toLocaleTimeString();
  entry.innerHTML = `<span class="demo-log-time">${time}</span> ${message}`;
  timeline.appendChild(entry);
  timeline.scrollTop = timeline.scrollHeight;
}

/* ── History Renderer ── */
function swarmUpdateHistory() {
  const list = document.getElementById('swarmHistoryList');
  if (!list) return;

  if (swarmHistory.length === 0) {
    list.innerHTML = '<div class="swarm-history-empty">No swarm runs yet. Deploy your first swarm above!</div>';
    return;
  }

  list.innerHTML = swarmHistory.map(h => {
    const statusClass = h.status === 'complete' ? 'success' : h.status === 'running' ? 'running' : 'failed';
    const statusIcon = h.status === 'complete' ? '✅' : h.status === 'running' ? '⏳' : '❌';
    const time = h.startTime.toLocaleTimeString();
    return `
      <div class="swarm-history-row ${statusClass}">
        <span class="swarm-history-token">${h.token}</span>
        <span class="swarm-history-status ${statusClass}">${statusIcon} ${h.status}</span>
        <span class="swarm-history-duration">${h.duration}</span>
        <span class="swarm-history-orders">${h.orders} orders</span>
        <span class="swarm-history-fills">${h.fills} fills</span>
        <span class="swarm-history-time">${time}</span>
      </div>
    `;
  }).join('');
}

/* ── Initialize ── */
window.txaiDemoRunning = false;
