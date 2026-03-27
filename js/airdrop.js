/* ===== TXAI — Airdrop Tool ===== */
/*
 * Architecture:
 *   1. User pastes a list of wallet addresses (one per line or comma-separated)
 *   2. User enters token denom and amount per address
 *   3. Preview shows recipient count, total tokens, estimated fees
 *   4. Execute sends to /api/airdrop in batches of 10
 *   5. Live progress bar and log updates per batch
 *   6. Completion summary: sent / failed / total
 */

const AIRDROP_STORAGE_KEY = 'txai_airdrop_history';
const AIRDROP_BATCH_SIZE = 10;
const AIRDROP_EST_FEE_PER_TX = 0.05; // estimated fee per recipient in CORE

let airdropHistory = [];
let airdropInitialized = false;
let airdropParsedAddresses = [];
let airdropRunning = false;

/* ── Init ── */
function airdropInit() {
  if (airdropInitialized) return;
  airdropInitialized = true;
  airdropLoadHistory();
  airdropRenderHistory();

  // Wire up textarea for live parsing
  const textarea = document.getElementById('airdropAddresses');
  if (textarea) {
    textarea.addEventListener('input', airdropParseAddresses);
  }

  airdropLog('info', 'Airdrop tool ready.');
}

/* ── Parse & Validate Addresses ── */
function airdropParseAddresses() {
  const textarea = document.getElementById('airdropAddresses');
  const countEl = document.getElementById('airdropAddrCount');
  const errorEl = document.getElementById('airdropAddrError');

  if (!textarea) return [];

  const raw = textarea.value.trim();
  if (!raw) {
    airdropParsedAddresses = [];
    if (countEl) countEl.textContent = '0';
    if (errorEl) { errorEl.textContent = ''; errorEl.style.display = 'none'; }
    return [];
  }

  // Split by newline, comma, or whitespace
  const parts = raw.split(/[\n,\s]+/).map(s => s.trim()).filter(Boolean);

  const valid = [];
  const invalid = [];
  const seen = new Set();

  for (const addr of parts) {
    if (!addr.startsWith('testcore') && !addr.startsWith('core')) {
      invalid.push(addr);
      continue;
    }
    if (seen.has(addr)) continue; // deduplicate
    seen.add(addr);
    valid.push(addr);
  }

  airdropParsedAddresses = valid;

  if (countEl) countEl.textContent = valid.length;

  if (invalid.length > 0 && errorEl) {
    errorEl.textContent = `${invalid.length} invalid address(es) skipped (must start with testcore or core)`;
    errorEl.style.display = 'block';
  } else if (errorEl) {
    errorEl.textContent = '';
    errorEl.style.display = 'none';
  }

  return valid;
}

/* ── Preview ── */
function airdropPreview() {
  const previewEl = document.getElementById('airdropPreview');
  if (!previewEl) return;

  airdropParseAddresses();

  const denom = (document.getElementById('airdropDenom').value || '').trim();
  const amount = parseFloat(document.getElementById('airdropAmount').value) || 0;
  const count = airdropParsedAddresses.length;

  if (!count) {
    previewEl.style.display = 'none';
    return airdropShowResult(false, 'No valid addresses found. Paste wallet addresses above.');
  }
  if (!denom) {
    previewEl.style.display = 'none';
    return airdropShowResult(false, 'Token denom is required.');
  }
  if (amount <= 0) {
    previewEl.style.display = 'none';
    return airdropShowResult(false, 'Amount per address must be greater than 0.');
  }

  const totalTokens = amount * count;
  const batches = Math.ceil(count / AIRDROP_BATCH_SIZE);
  const estFees = (count * AIRDROP_EST_FEE_PER_TX).toFixed(4);

  previewEl.innerHTML = `
    <div class="airdrop-preview-row"><span>Recipients</span><strong>${count}</strong></div>
    <div class="airdrop-preview-row"><span>Token</span><strong>${escapeHtml(denom)}</strong></div>
    <div class="airdrop-preview-row"><span>Amount per address</span><strong>${amount}</strong></div>
    <div class="airdrop-preview-row"><span>Total tokens</span><strong>${totalTokens}</strong></div>
    <div class="airdrop-preview-row"><span>Batches</span><strong>${batches} (${AIRDROP_BATCH_SIZE}/batch)</strong></div>
    <div class="airdrop-preview-row"><span>Est. fees</span><strong>~${estFees} CORE</strong></div>
  `;
  previewEl.style.display = 'block';

  // Hide any previous result
  const resultEl = document.getElementById('airdropResult');
  if (resultEl) resultEl.style.display = 'none';

  airdropLog('info', `Preview: ${count} recipients, ${totalTokens} ${denom} total, ~${estFees} CORE fees`);
}

/* ── Execute Airdrop ── */
async function airdropExecute() {
  if (airdropRunning) return;

  airdropParseAddresses();

  const denom = (document.getElementById('airdropDenom').value || '').trim();
  const amount = parseFloat(document.getElementById('airdropAmount').value) || 0;
  const recipients = airdropParsedAddresses;

  // Validation
  if (!recipients.length) return airdropShowResult(false, 'No valid addresses to airdrop to.');
  if (!denom) return airdropShowResult(false, 'Token denom is required.');
  if (amount <= 0) return airdropShowResult(false, 'Amount must be greater than 0.');

  const btn = document.getElementById('airdropExecuteBtn');
  const progressWrap = document.getElementById('airdropProgress');
  const progressBar = document.getElementById('airdropProgressBar');
  const progressText = document.getElementById('airdropProgressText');

  airdropRunning = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
  if (progressWrap) progressWrap.style.display = 'block';

  const totalBatches = Math.ceil(recipients.length / AIRDROP_BATCH_SIZE);
  let sent = 0;
  let failed = 0;
  let failedAddresses = [];

  airdropLog('info', `Starting airdrop: ${recipients.length} recipients, ${amount} ${denom} each`);

  for (let i = 0; i < totalBatches; i++) {
    const batchStart = i * AIRDROP_BATCH_SIZE;
    const batch = recipients.slice(batchStart, batchStart + AIRDROP_BATCH_SIZE);
    const batchNum = i + 1;

    // Update progress
    const pct = Math.round((i / totalBatches) * 100);
    if (progressBar) progressBar.style.width = pct + '%';
    if (progressText) progressText.textContent = `Batch ${batchNum}/${totalBatches} (${pct}%)`;

    airdropLog('info', `Sending batch ${batchNum}/${totalBatches} (${batch.length} addresses)...`);

    try {
      const res = await fetch(`${API_URL}/api/airdrop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          denom,
          amount: String(amount),
          recipients: batch,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      sent += batch.length;
      airdropLog('success', `Batch ${batchNum} sent${data.txHash ? ' — tx: ' + data.txHash : ''}`);

    } catch (err) {
      failed += batch.length;
      failedAddresses = failedAddresses.concat(batch);
      airdropLog('error', `Batch ${batchNum} failed: ${err.message}`);
    }
  }

  // Complete
  if (progressBar) progressBar.style.width = '100%';
  if (progressText) progressText.textContent = `Done — ${sent} sent, ${failed} failed`;

  airdropRunning = false;
  if (btn) { btn.disabled = false; btn.textContent = 'Execute Airdrop'; }

  // Summary
  const success = failed === 0;
  const summary = `Airdrop complete: ${sent} sent, ${failed} failed out of ${recipients.length} total.`;
  airdropShowResult(success, summary);
  airdropLog(success ? 'success' : 'error', summary);

  // Save to history
  const entry = {
    id: Date.now(),
    denom,
    amount,
    total: recipients.length,
    sent,
    failed,
    failedAddresses: failedAddresses.slice(0, 50), // cap stored failures
    date: new Date().toISOString(),
  };
  airdropHistory.unshift(entry);
  airdropSaveHistory();
  airdropRenderHistory();
}

/* ── Render History ── */
function airdropRenderHistory() {
  const listEl = document.getElementById('airdropHistoryList');
  if (!listEl) return;

  if (!airdropHistory.length) {
    listEl.innerHTML = '<div class="airdrop-empty">No airdrops yet.</div>';
    return;
  }

  let html = '';
  for (const entry of airdropHistory) {
    const dateStr = new Date(entry.date).toLocaleString();
    const status = entry.failed === 0 ? 'success' : (entry.sent === 0 ? 'failed' : 'partial');
    const statusLabel = entry.failed === 0 ? 'Success' : (entry.sent === 0 ? 'Failed' : 'Partial');

    html += `
      <div class="airdrop-history-card ${status}">
        <div>
          <div class="airdrop-history-denom">${escapeHtml(entry.denom)}</div>
          <div class="airdrop-history-meta">${dateStr} · ${entry.amount} each · ${entry.total} recipients</div>
        </div>
        <div class="airdrop-history-status">
          <span class="airdrop-status-badge ${status}">${statusLabel}</span>
          <span class="airdrop-history-count">${entry.sent}/${entry.total}</span>
        </div>
      </div>`;
  }
  listEl.innerHTML = html;
}

/* ── Show Result ── */
function airdropShowResult(success, msg) {
  const el = document.getElementById('airdropResult');
  if (!el) return;
  el.className = 'airdrop-result ' + (success ? 'success' : 'error');
  el.textContent = msg;
  el.style.display = 'block';
}

/* ── Logging ── */
function airdropLog(type, msg) {
  const logEl = document.getElementById('airdropLog');
  if (!logEl) return;
  const entry = document.createElement('div');
  entry.className = 'airdrop-log-entry ' + type;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logEl.prepend(entry);
  // Keep max 30 entries
  while (logEl.children.length > 30) logEl.removeChild(logEl.lastChild);
}

/* ── Local Storage ── */
function airdropLoadHistory() {
  try {
    const raw = localStorage.getItem(AIRDROP_STORAGE_KEY);
    airdropHistory = raw ? JSON.parse(raw) : [];
  } catch { airdropHistory = []; }
}

function airdropSaveHistory() {
  try {
    localStorage.setItem(AIRDROP_STORAGE_KEY, JSON.stringify(airdropHistory));
  } catch {}
}
