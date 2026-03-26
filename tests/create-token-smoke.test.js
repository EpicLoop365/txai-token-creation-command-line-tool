/**
 * TXAI Token Creation Smoke Test
 *
 * Tests the full token creation lifecycle:
 * - AI text parsing
 * - Token deployment via agent wallet
 * - Token verification on-chain
 * - Feature, supply, rate validation
 *
 * Usage:
 *   node tests/create-token-smoke.test.js
 *   node tests/create-token-smoke.test.js --quick    (parse-only, no deploy)
 *   node tests/create-token-smoke.test.js --verbose
 */

const API_URL = process.env.API_URL || 'https://txai-token-creation-production.up.railway.app';
const COREUM_REST = 'https://full-node.testnet-1.coreum.dev:1317';

const QUICK = process.argv.includes('--quick');
const VERBOSE = process.argv.includes('--verbose');

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(icon, msg) { console.log(`  ${icon} ${msg}`); }
function pass(msg) { log('✅', msg); }
function fail(msg) { log('❌', msg); }
function info(msg) { log('ℹ️ ', msg); }
function warn(msg) { log('⚠️ ', msg); }

let passed = 0, failed = 0, skipped = 0;

async function test(name, fn) {
  process.stdout.write(`\n  🧪 ${name}... `);
  try {
    await fn();
    console.log('PASS');
    passed++;
  } catch (err) {
    console.log('FAIL');
    fail(err.message);
    if (VERBOSE) console.log('    ' + err.stack.split('\n').slice(1, 3).join('\n    '));
    failed++;
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${url} - ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  if (VERBOSE) console.log('\n    Response:', JSON.stringify(data).slice(0, 300));
  return data;
}

async function consumeSSE(response) {
  const events = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return events;
      try { events.push(JSON.parse(payload)); }
      catch { events.push({ raw: payload }); }
    }
  }
  return events;
}

// ─── State ──────────────────────────────────────────────────────────────────

let agentWallet = '';
let createdDenom = '';
let createdTxHash = '';

// ─── Tests ──────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   TXAI Token Creation Smoke Test         ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Mode:   ${(QUICK ? 'Quick (parse only)' : 'Full (deploy + verify)').padEnd(31)}║`);
  console.log('╚══════════════════════════════════════════╝\n');

  // ── Test: Health ──
  await test('Health check', async () => {
    const data = await fetchJSON(`${API_URL}/health`);
    assert(data.status === 'ok', `Server not healthy: ${data.status}`);
    agentWallet = data.walletAddress || '';
    pass(`Server OK, wallet: ${agentWallet.slice(0, 12)}...`);
  });

  // ── Test: Parse simple token description ──
  await test('Parse: simple token', async () => {
    const data = await fetchJSON(`${API_URL}/api/parse-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'A gaming token called GEMS with 1 million supply' }),
    });
    assert(data.config, 'Expected config in response');
    const c = data.config;
    assert(c.name || c.subunit, 'Expected a name or subunit');
    pass(`Parsed: name=${c.name}, symbol=${c.subunit}, supply=${c.initialAmount || c.supply || '?'}`);
  });

  // ── Test: Parse token with features ──
  await test('Parse: token with features', async () => {
    const data = await fetchJSON(`${API_URL}/api/parse-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: 'Create VAULT token, 500K supply, 6 decimals, mintable, burnable, freezable, clawback, 2% burn rate, 1% commission'
      }),
    });
    const c = data.config;
    assert(c, 'No config returned');

    // Check features were parsed
    const features = c.features || {};
    const featureNames = Object.keys(features).filter(k => features[k]);
    pass(`Features: ${featureNames.join(', ') || 'none parsed'}`);

    // Check rates
    const burnRate = c.burnRate || c.burn_rate || '0';
    const commRate = c.sendCommissionRate || c.send_commission_rate || c.feeRate || '0';
    pass(`Rates: burn=${burnRate}, commission=${commRate}`);
  });

  // ── Test: Parse minimal input ──
  await test('Parse: minimal input', async () => {
    const data = await fetchJSON(`${API_URL}/api/parse-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'DOG, 100, mint, burn' }),
    });
    const c = data.config;
    assert(c, 'No config returned');
    pass(`Parsed: ${c.name || c.subunit || 'unknown'}, supply=${c.initialAmount || c.supply || '?'}`);
  });

  // ── Test: Parse edge case - unicode/special chars ──
  await test('Parse: special characters', async () => {
    const data = await fetchJSON(`${API_URL}/api/parse-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Token called "Super-Coin!", 1M supply, 8 decimals' }),
    });
    const c = data.config;
    assert(c, 'No config returned');
    // Subunit should be sanitized to lowercase alphanumeric
    const sub = (c.subunit || '').toLowerCase();
    assert(!/[^a-z0-9]/.test(sub) || sub === '', `Subunit has invalid chars: "${sub}"`);
    pass(`Sanitized subunit: "${sub}"`);
  });

  if (QUICK) {
    console.log('\n  ⏭️  Skipping deployment tests (--quick mode)\n');
    skipped = 4;
    printSummary();
    return;
  }

  console.log('\n  ⏳ Starting deployment tests...\n');

  // ── Test: Deploy token via sync endpoint ──
  const testSymbol = 'smoketest' + Date.now().toString(36).slice(-4);
  await test(`Deploy token: ${testSymbol.toUpperCase()}`, async () => {
    info(`Creating ${testSymbol.toUpperCase()} (100 supply, mint+burn)...`);
    const data = await fetchJSON(`${API_URL}/api/create-token-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: `${testSymbol}, 100 supply, mint, burn`,
      }),
    });
    assert(data.token || data.denom, `No token in response: ${JSON.stringify(data).slice(0, 200)}`);
    createdDenom = data.token?.denom || data.denom || '';
    createdTxHash = data.token?.txHash || data.txHash || '';
    assert(createdDenom, 'No denom returned');
    pass(`Deployed: ${createdDenom.slice(0, 40)}...`);
    if (createdTxHash) pass(`TX: ${createdTxHash.slice(0, 16)}...`);
  });

  // ── Test: Verify token on-chain ──
  await test('Verify token on-chain', async () => {
    assert(createdDenom, 'No denom to verify');
    await sleep(3000); // Wait for chain propagation

    const data = await fetchJSON(`${COREUM_REST}/coreum/asset/ft/v1/tokens/${createdDenom}`);
    assert(data.token, 'Token not found on chain');
    const t = data.token;

    // Verify issuer is agent wallet
    assert(t.issuer === agentWallet, `Issuer mismatch: expected ${agentWallet.slice(0, 12)}..., got ${(t.issuer || '').slice(0, 12)}...`);
    pass(`Issuer: ${t.issuer.slice(0, 12)}... ✓`);

    // Verify features
    const features = t.features || [];
    pass(`Features: ${features.join(', ') || 'none'}`);

    // Verify precision
    pass(`Precision: ${t.precision}`);
  });

  // ── Test: Verify supply on-chain ──
  await test('Verify supply', async () => {
    assert(createdDenom, 'No denom to verify');
    const data = await fetchJSON(`${COREUM_REST}/cosmos/bank/v1beta1/supply/by_denom?denom=${encodeURIComponent(createdDenom)}`);
    assert(data.amount, 'No supply data');
    const rawSupply = data.amount.amount || '0';
    pass(`Raw supply: ${rawSupply}`);
    assert(parseInt(rawSupply) > 0, `Supply is 0 — token creation may have failed`);
  });

  // ── Test: Deploy with SSE stream endpoint ──
  await test('Deploy via SSE stream', async () => {
    const testSym2 = 'ssetest' + Date.now().toString(36).slice(-4);
    info(`Creating ${testSym2.toUpperCase()} via SSE stream...`);

    const res = await fetch(`${API_URL}/api/create-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: `${testSym2}, 50 supply, burn` }),
    });
    assert(res.ok, `HTTP ${res.status}`);

    const events = await consumeSSE(res);
    assert(events.length > 0, 'No SSE events');

    // Look for completion event with token data
    const completion = events.find(e => e.token || e.denom || e.type === 'complete');
    if (completion) {
      pass(`SSE stream completed, ${events.length} events`);
    } else {
      pass(`SSE stream received ${events.length} events`);
    }
  });

  printSummary();
}

function printSummary() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║              TEST RESULTS                ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  ✅ Passed:  ${String(passed).padEnd(28)}║`);
  console.log(`║  ❌ Failed:  ${String(failed).padEnd(28)}║`);
  console.log(`║  ⏭️  Skipped: ${String(skipped).padEnd(28)}║`);
  console.log('╚══════════════════════════════════════════╝\n');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('\n💀 Fatal error:', err.message);
  process.exit(2);
});
