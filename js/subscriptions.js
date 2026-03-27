/* ===== TXAI — Subscription Pass System ===== */
/*
 * Architecture:
 *   1. Merchant creates a "pass token" — a smart token with minting enabled
 *   2. When a user buys a pass:
 *      a. User pays TX → split: 95% to merchant, 5% to TXAI platform
 *      b. Server mints 1 pass token to the user's wallet
 *      c. Pass metadata (expiry, tier) is stored in txdb
 *   3. Verification: check if user holds the pass token + hasn't expired
 *   4. Embed widget: 4 lines of HTML/JS for any website
 */

const SUBS_PLATFORM_FEE_PCT = 5;  // 5% platform fee
const SUBS_STORAGE_KEY = 'txai_subs_passes';

let subsPassList = [];
let subsInitialized = false;

/* ── Init ── */
function subsInit() {
  if (subsInitialized) return;
  subsInitialized = true;
  subsLoadPasses();
  subsRenderPasses();
  subsSetupFeeCalc();

  // Auto-fill merchant address if wallet connected
  const addr = typeof dexGetActiveAddress === 'function' ? dexGetActiveAddress() : '';
  if (addr) {
    document.getElementById('subsMerchantAddr').value = addr;
  }
}

/* ── Fee Calculator ── */
function subsSetupFeeCalc() {
  const priceInput = document.getElementById('subsPrice');
  if (!priceInput) return;
  priceInput.addEventListener('input', () => {
    const price = parseFloat(priceInput.value) || 0;
    const fee = price * (SUBS_PLATFORM_FEE_PCT / 100);
    const net = price - fee;
    document.getElementById('subsFeePrice').textContent = price.toFixed(2) + ' TX';
    document.getElementById('subsFeeAmount').textContent = fee.toFixed(2) + ' TX';
    document.getElementById('subsFeeNet').textContent = net.toFixed(2) + ' TX';
  });
}

/* ── Create Pass Token ── */
async function subsCreatePass() {
  const name = document.getElementById('subsName').value.trim();
  const price = parseFloat(document.getElementById('subsPrice').value);
  const duration = parseInt(document.getElementById('subsDuration').value);
  const merchantAddr = document.getElementById('subsMerchantAddr').value.trim();
  const desc = document.getElementById('subsDesc').value.trim();

  // Validation
  if (!name) return subsShowError('Pass name is required');
  if (!price || price <= 0) return subsShowError('Price must be greater than 0');
  if (!merchantAddr) return subsShowError('Merchant wallet address is required');
  if (!merchantAddr.startsWith('testcore') && !merchantAddr.startsWith('core')) {
    return subsShowError('Invalid wallet address');
  }

  const btn = document.getElementById('subsCreateBtn');
  btn.disabled = true;
  btn.textContent = 'Creating...';
  subsLog('info', `Creating pass token "${name}"...`);

  try {
    // Generate a subunit from the name
    const subunit = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) + 'pass';

    // Call the API to create a pass token
    const res = await fetch(`${API_URL}/api/subs/create-pass`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        subunit,
        price,
        duration,
        merchantAddress: merchantAddr,
        description: desc,
      }),
    });

    const result = await res.json();
    if (result.error) throw new Error(result.error);

    // Save pass locally
    const pass = {
      id: Date.now(),
      name,
      subunit,
      denom: result.denom,
      price,
      duration,
      merchantAddress: merchantAddr,
      description: desc,
      txHash: result.txHash,
      createdAt: new Date().toISOString(),
      holders: 0,
    };

    subsPassList.unshift(pass);
    subsSavePasses();
    subsRenderPasses();
    subsShowEmbed(pass);

    subsLog('success', `Pass "${name}" created! Denom: ${result.denom}`);

    // Save to txdb
    if (typeof txdbChainWrite === 'function') {
      txdbChainWrite('subs', {
        n: name.slice(0, 20),
        d: (result.denom || '').slice(0, 80),
        p: price,
        dur: duration,
        m: merchantAddr.slice(0, 50),
      });
    }

    // Clear form
    document.getElementById('subsName').value = '';
    document.getElementById('subsPrice').value = '';
    document.getElementById('subsDesc').value = '';

  } catch (err) {
    subsLog('error', `Failed: ${err.message}`);
    subsShowError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Pass Token';
  }
}

/* ── Buy Pass (called from embed widget or UI) ── */
async function subsBuyPass(passId) {
  const pass = subsPassList.find(p => p.id === passId || p.denom === passId);
  if (!pass) return subsShowError('Pass not found');

  const buyerAddr = typeof dexGetActiveAddress === 'function' ? dexGetActiveAddress() : '';
  if (!buyerAddr) return subsShowError('Connect a wallet first');

  subsLog('info', `Buying "${pass.name}" for ${pass.price} TX...`);

  try {
    const res = await fetch(`${API_URL}/api/subs/buy-pass`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        passDenom: pass.denom,
        buyerAddress: buyerAddr,
        merchantAddress: pass.merchantAddress,
        price: pass.price,
        duration: pass.duration,
      }),
    });

    const result = await res.json();
    if (result.error) throw new Error(result.error);

    subsLog('success', `Pass purchased! Token minted to ${buyerAddr.slice(0, 16)}...`);
    pass.holders = (pass.holders || 0) + 1;
    subsSavePasses();
    subsRenderPasses();

    return result;
  } catch (err) {
    subsLog('error', `Buy failed: ${err.message}`);
    throw err;
  }
}

/* ── Verify Access ── */
async function subsVerifyAccess() {
  const addr = document.getElementById('subsVerifyAddr').value.trim();
  const passDenom = document.getElementById('subsVerifyPass').value;
  const resultEl = document.getElementById('subsVerifyResult');

  if (!addr) return subsShowError('Enter a wallet address to verify');
  if (!passDenom) return subsShowError('Select a pass to verify');

  resultEl.className = 'subs-verify-result checking';
  resultEl.textContent = 'Checking...';

  try {
    const res = await fetch(`${API_URL}/api/subs/verify?address=${encodeURIComponent(addr)}&denom=${encodeURIComponent(passDenom)}`);
    const result = await res.json();

    if (result.valid) {
      resultEl.className = 'subs-verify-result valid';
      resultEl.textContent = `✓ Valid — holds ${result.balance} pass token(s)${result.expiresAt ? '. Expires: ' + new Date(result.expiresAt).toLocaleDateString() : ''}`;
    } else {
      resultEl.className = 'subs-verify-result invalid';
      resultEl.textContent = `✗ No valid pass found${result.reason ? ': ' + result.reason : ''}`;
    }
  } catch (err) {
    resultEl.className = 'subs-verify-result invalid';
    resultEl.textContent = `Error: ${err.message}`;
  }
}

/* ── Embed Code Generator ── */
function subsShowEmbed(pass) {
  const section = document.getElementById('subsEmbedSection');
  const codeEl = document.getElementById('subsEmbedCode');
  section.style.display = '';

  const embedCode = `<script src="https://txai.io/embed/pass.js"><\/script>
<txai-pass
  token="${pass.denom}"
  price="${pass.price}"
  label="Buy ${pass.name}"
/>`;

  codeEl.textContent = embedCode;
}

function subsCopyEmbed() {
  const code = document.getElementById('subsEmbedCode').textContent;
  navigator.clipboard.writeText(code).then(() => {
    const btn = document.querySelector('.subs-copy-btn');
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 1500);
  });
}

/* ── Render Passes List ── */
function subsRenderPasses() {
  const listEl = document.getElementById('subsPassesList');
  const verifySelect = document.getElementById('subsVerifyPass');

  if (!subsPassList.length) {
    listEl.innerHTML = '<div class="subs-empty">No subscription passes created yet.</div>';
    return;
  }

  let html = '';
  for (const pass of subsPassList) {
    const durLabel = pass.duration === 0 ? 'Lifetime' :
      pass.duration === 365 ? '1 Year' :
      pass.duration + ' Days';

    html += `
      <div class="subs-pass-card">
        <div>
          <div class="subs-pass-name">${escapeHtml(pass.name)}</div>
          <div class="subs-pass-meta">${durLabel} · ${pass.holders || 0} holders · ${pass.denom ? pass.denom.split('-')[0] : '?'}</div>
        </div>
        <div class="subs-pass-actions">
          <span class="subs-pass-price">${pass.price} TX</span>
          <button class="subs-pass-embed-btn" onclick="subsShowEmbed(subsPassList.find(p=>p.id===${pass.id}))">Embed</button>
        </div>
      </div>`;
  }
  listEl.innerHTML = html;

  // Update verify dropdown
  verifySelect.innerHTML = '<option value="">-- Select Pass --</option>';
  for (const pass of subsPassList) {
    const opt = document.createElement('option');
    opt.value = pass.denom || pass.subunit;
    opt.textContent = pass.name;
    verifySelect.appendChild(opt);
  }
}

/* ── Local Storage ── */
function subsLoadPasses() {
  try {
    const raw = localStorage.getItem(SUBS_STORAGE_KEY);
    subsPassList = raw ? JSON.parse(raw) : [];
  } catch { subsPassList = []; }
}

function subsSavePasses() {
  try {
    localStorage.setItem(SUBS_STORAGE_KEY, JSON.stringify(subsPassList));
  } catch {}
}

/* ── Logging ── */
function subsLog(type, msg) {
  const logEl = document.getElementById('subsLog');
  if (!logEl) return;
  const entry = document.createElement('div');
  entry.className = 'subs-log-entry ' + type;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logEl.prepend(entry);
  // Keep max 20 entries
  while (logEl.children.length > 20) logEl.removeChild(logEl.lastChild);
}

function subsShowError(msg) {
  subsLog('error', msg);
}
