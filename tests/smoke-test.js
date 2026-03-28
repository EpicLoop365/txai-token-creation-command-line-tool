#!/usr/bin/env node
/**
 * TXAI Studio — Comprehensive Smoke Test Suite
 *
 * Usage:
 *   node tests/smoke-test.js [api-url] [site-url] [--verbose]
 *
 * Examples:
 *   node tests/smoke-test.js
 *   node tests/smoke-test.js http://localhost:3001
 *   node tests/smoke-test.js https://txai-api.up.railway.app https://solomentelabs.com --verbose
 *
 * Requires Node 18+ (built-in fetch). No npm dependencies.
 */

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const positional = args.filter(a => !a.startsWith('--'));

const API  = positional[0] || 'http://localhost:3001';
const SITE = positional[1] || 'https://solomentelabs.com';

const TIMEOUT_MS  = 8000;  // per-test timeout
const TEST_SENDER = 'testcore1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';  // placeholder

// ─── COUNTERS & RESULTS ──────────────────────────────────────────────────────

let passed  = 0;
let failed  = 0;
let skipped = 0;
const results  = [];
const failures = [];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function log(msg) { console.log(msg); }
function verbose(msg) { if (VERBOSE) console.log(`    [verbose] ${msg}`); }

/** Fetch with timeout */
async function fetchWithTimeout(url, opts = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** Assert helper */
function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

/** Run a single test */
async function test(name, fn) {
  try {
    await fn();
    passed++;
    results.push({ name, status: 'PASS' });
    log(`  \u2713 ${name}`);
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'Timeout (no response)' :
                e.cause?.code === 'ECONNREFUSED' ? 'Connection refused' :
                e.code === 'ECONNREFUSED' ? 'Connection refused' :
                e.message || String(e);
    failed++;
    results.push({ name, status: 'FAIL', error: msg });
    failures.push({ name, error: msg });
    log(`  \u2717 ${name} \u2014 ${msg}`);
  }
}

/** Skip a test */
function skip(name, reason) {
  skipped++;
  results.push({ name, status: 'SKIP', reason });
  log(`  \u2298 ${name} \u2014 ${reason}`);
}

// ─── API SMOKE TESTS ─────────────────────────────────────────────────────────

async function apiTests() {
  log('\n\u2500\u2500 API Smoke Tests (' + API + ') \u2500\u2500\n');

  // 1. Health check
  await test('Health check — GET /health', async () => {
    const res = await fetchWithTimeout(`${API}/health`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    verbose(JSON.stringify(data).slice(0, 200));
    assert(data.status === 'ok', `Expected status "ok", got "${data.status}"`);
    assert(data.network, 'Missing network field');
    assert(data.chainId, 'Missing chainId field');
  });

  // 2. Network info
  await test('Network info — GET /api/network-info', async () => {
    const res = await fetchWithTimeout(`${API}/api/network-info`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    verbose(JSON.stringify(data).slice(0, 200));
    assert(data.available && data.available.includes('testnet'), 'Missing testnet in available');
  });

  // 3. Chat endpoint
  await test('Chat endpoint — POST /api/chat', async () => {
    const res = await fetchWithTimeout(`${API}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'What is a smart token? Reply in one sentence.' }]
      })
    }, 15000);  // AI call may take longer
    assert(res.status !== 500, `Server error: ${res.status}`);
    // 200 = success, 429 = rate limited (ok for smoke), 503 = AI overloaded (ok)
    if (res.ok) {
      const data = await res.json();
      verbose(`Reply: ${(data.reply || '').slice(0, 100)}`);
      assert(data.reply, 'Missing reply field');
    } else {
      verbose(`Status ${res.status} (rate limited or overloaded — acceptable)`);
      assert([429, 503].includes(res.status), `Unexpected status ${res.status}`);
    }
  });

  // 4. Parse token
  await test('Parse token — POST /api/parse-token', async () => {
    const res = await fetchWithTimeout(`${API}/api/parse-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'A loyalty token called GEMS with minting and burning' })
    }, 15000);
    assert(res.status !== 500, `Server error: ${res.status}`);
    if (res.ok) {
      const data = await res.json();
      verbose(JSON.stringify(data).slice(0, 200));
      assert(data.config, 'Missing config field');
    } else {
      assert([429, 503].includes(res.status), `Unexpected status ${res.status}`);
    }
  });

  // 5. Preflight
  await test('Preflight — POST /api/preflight', async () => {
    const res = await fetchWithTimeout(`${API}/api/preflight`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        txType: 'token_send',
        sender: TEST_SENDER,
        params: { denom: 'utestcore', amount: '1000', recipient: TEST_SENDER }
      })
    });
    assert(res.status !== 500 || (await res.text()).includes('Preflight error'),
      `Unexpected 500 without preflight error shape`);
    if (res.ok) {
      const data = await res.json();
      verbose(JSON.stringify(data).slice(0, 300));
      assert(typeof data.canProceed === 'boolean' || data.checks, 'Missing preflight result shape');
    }
  });

  // 6. Smart Airdrop Parse
  await test('Smart Airdrop Parse — POST /api/smart-airdrop/parse', async () => {
    const res = await fetchWithTimeout(`${API}/api/smart-airdrop/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Airdrop 100 TEST to testcore1abc and testcore1def' })
    }, 15000);
    assert(res.status !== 500, `Server error: ${res.status}`);
    if (res.ok) {
      const data = await res.json();
      verbose(JSON.stringify(data).slice(0, 300));
      assert(data.intent, 'Missing intent field');
    } else {
      assert([429, 503].includes(res.status), `Unexpected status ${res.status}`);
    }
  });

  // 7. Smart Airdrop Resolve
  await test('Smart Airdrop Resolve — POST /api/smart-airdrop/resolve', async () => {
    const res = await fetchWithTimeout(`${API}/api/smart-airdrop/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: {
          tokenDenom: 'utestcore',
          amountPerRecipient: '1000000',
          sources: [{ type: 'addresses', addresses: [TEST_SENDER] }]
        },
        sender: TEST_SENDER
      })
    });
    // May fail due to invalid sender, but should not 500 without structure
    verbose(`Status: ${res.status}`);
    const data = await res.json();
    verbose(JSON.stringify(data).slice(0, 300));
    assert(data.resolved || data.error, 'Expected resolved or error field');
  });

  // 8. Smart Airdrop Dry Run
  await test('Smart Airdrop Dry Run — POST /api/smart-airdrop/dry-run', async () => {
    const res = await fetchWithTimeout(`${API}/api/smart-airdrop/dry-run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        denom: 'utestcore',
        recipients: [{ address: TEST_SENDER, amount: '1000000' }],
        sender: TEST_SENDER
      })
    });
    verbose(`Status: ${res.status}`);
    const text = await res.text();
    verbose(text.slice(0, 300));
    // Accept 200 or structured error — just not an unhandled crash
    assert(res.status !== 502 && res.status !== 503, `Bad gateway or service unavailable: ${res.status}`);
  });

  // 9. Smart Airdrop History
  await test('Smart Airdrop History — GET /api/smart-airdrop/history', async () => {
    const res = await fetchWithTimeout(`${API}/api/smart-airdrop/history`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    verbose(`History count: ${Array.isArray(data) ? data.length : JSON.stringify(data).slice(0, 100)}`);
    assert(Array.isArray(data) || data.history, 'Expected array or history field');
  });

  // 10. Smart Airdrop Schedules
  await test('Smart Airdrop Schedules — GET /api/smart-airdrop/schedules', async () => {
    const res = await fetchWithTimeout(`${API}/api/smart-airdrop/schedules`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    verbose(`Schedules: ${JSON.stringify(data).slice(0, 100)}`);
    assert(Array.isArray(data) || data.schedules, 'Expected array or schedules field');
  });

  // 11. Smart Airdrop Vesting Plans
  await test('Vesting Plans — GET /api/smart-airdrop/vesting-plans', async () => {
    const res = await fetchWithTimeout(`${API}/api/smart-airdrop/vesting-plans`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    verbose(`Vesting plans: ${JSON.stringify(data).slice(0, 100)}`);
    assert(Array.isArray(data) || data.plans, 'Expected array or plans field');
  });

  // 12. Vesting Preview
  await test('Vesting Preview — POST /api/smart-airdrop/vesting-preview', async () => {
    const res = await fetchWithTimeout(`${API}/api/smart-airdrop/vesting-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schedule: {
          type: 'cliff',
          cliffMonths: 3,
          totalMonths: 12
        },
        totalAmount: '1000000',
        startDate: new Date().toISOString()
      })
    });
    verbose(`Status: ${res.status}`);
    const text = await res.text();
    verbose(text.slice(0, 300));
    assert(res.status < 500 || text.includes('error'), 'Unexpected server crash');
  });

  // 13. Orderbook
  await test('Orderbook — GET /api/orderbook', async () => {
    const res = await fetchWithTimeout(`${API}/api/orderbook?baseDenom=utestcore&quoteDenom=utestcore`);
    verbose(`Status: ${res.status}`);
    // May 400 if params wrong, but should not 500
    assert(res.status < 500, `Server error: ${res.status}`);
  });

  // 14. Pairs
  await test('Pairs — GET /api/pairs', async () => {
    const res = await fetchWithTimeout(`${API}/api/pairs`);
    assert(res.ok || res.status < 500, `Server error: ${res.status}`);
    if (res.ok) {
      const data = await res.json();
      verbose(`Pairs: ${JSON.stringify(data).slice(0, 200)}`);
      assert(data.pairs !== undefined, 'Missing pairs field');
    }
  });

  // 15. Scout mint endpoint (shape check)
  await test('Scout mint — POST /api/scout-mint (shape check)', async () => {
    const res = await fetchWithTimeout(`${API}/api/scout-mint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'testcore1smoketestabc123def456' })
    });
    verbose(`Status: ${res.status}`);
    const data = await res.json();
    verbose(JSON.stringify(data).slice(0, 200));
    // 400 for invalid address is fine, 500 with structured error is fine
    // We just want it not to crash without a JSON response
    assert(data.error || data.success !== undefined, 'Expected error or success field');
  });

  // 16. Stakers endpoint
  await test('Stakers — GET /api/stakers/:addr', async () => {
    // Use a known testnet validator address format
    const validator = 'testcorevaloper1qs8tnw2t8l6amtzvdemnnsq9dzk0ag0z37gh3h';
    const res = await fetchWithTimeout(`${API}/api/stakers/${validator}`);
    verbose(`Status: ${res.status}`);
    // May 404 or return empty — just check no unhandled crash
    assert(res.status < 502, `Unhandled error: ${res.status}`);
    const data = await res.json();
    verbose(JSON.stringify(data).slice(0, 200));
  });

  // 17. Token info
  await test('Token info — GET /api/token-info', async () => {
    const res = await fetchWithTimeout(`${API}/api/token-info?denom=utestcore`);
    verbose(`Status: ${res.status}`);
    assert(res.status < 502, `Unhandled error: ${res.status}`);
  });

  // 18. Faucet endpoint exists
  await test('Faucet — POST /api/faucet (endpoint check)', async () => {
    const res = await fetchWithTimeout(`${API}/api/faucet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: TEST_SENDER })
    });
    verbose(`Status: ${res.status}`);
    // 400 or 500 with error message = endpoint exists. 404 = endpoint missing.
    assert(res.status !== 404, 'Faucet endpoint not found (404)');
    const data = await res.json();
    verbose(JSON.stringify(data).slice(0, 200));
    assert(data.error || data.success !== undefined || data.txHash, 'Unexpected response shape');
  });

  // 19. CORS headers
  await test('CORS headers — OPTIONS /api/chat', async () => {
    const res = await fetchWithTimeout(`${API}/api/chat`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://solomentelabs.com',
        'Access-Control-Request-Method': 'POST'
      }
    });
    verbose(`Status: ${res.status}, headers: ${JSON.stringify(Object.fromEntries(res.headers))}`);
    const acaoHeader = res.headers.get('access-control-allow-origin');
    assert(acaoHeader, 'Missing Access-Control-Allow-Origin header');
    verbose(`ACAO: ${acaoHeader}`);
  });

  // 20. Create wallet endpoint
  await test('Create wallet — POST /api/create-wallet', async () => {
    const res = await fetchWithTimeout(`${API}/api/create-wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    verbose(`Status: ${res.status}`);
    if (res.ok) {
      const data = await res.json();
      verbose(`Address: ${data.address}`);
      assert(data.address, 'Missing address field');
    } else {
      // 500 with "not configured" is acceptable
      const data = await res.json();
      assert(data.error, 'Expected error message');
    }
  });

  // 21. Holders endpoint
  await test('Holders — GET /api/holders/:denom', async () => {
    const res = await fetchWithTimeout(`${API}/api/holders/utestcore`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    verbose(JSON.stringify(data).slice(0, 200));
    assert(data.success !== undefined || data.addresses !== undefined, 'Missing expected fields');
  });

  // 22. Runtime status
  await test('Runtime status — GET /api/runtime/status', async () => {
    const res = await fetchWithTimeout(`${API}/api/runtime/status`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    verbose(JSON.stringify(data).slice(0, 200));
  });

  // 23. Gate status
  await test('Gate status — GET /api/gate-status', async () => {
    const res = await fetchWithTimeout(`${API}/api/gate-status`);
    verbose(`Status: ${res.status}`);
    assert(res.status < 500, `Server error: ${res.status}`);
  });

  // 24. Analytics endpoint
  await test('Analytics — GET /api/analytics', async () => {
    const res = await fetchWithTimeout(`${API}/api/analytics`);
    verbose(`Status: ${res.status}`);
    assert(res.status < 500, `Server error: ${res.status}`);
  });
}

// ─── FRONTEND ASSET TESTS ────────────────────────────────────────────────────

async function frontendTests() {
  log('\n\u2500\u2500 Frontend Asset Tests (' + SITE + ') \u2500\u2500\n');

  // Index page
  await test('index.html loads — GET /', async () => {
    const res = await fetchWithTimeout(`${SITE}/`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const text = await res.text();
    assert(text.includes('TXAI'), 'Missing TXAI in page title/body');
    verbose(`Page length: ${text.length} chars`);
  });

  // App page
  await test('app.html loads — GET /app.html', async () => {
    const res = await fetchWithTimeout(`${SITE}/app.html`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const text = await res.text();
    assert(text.includes('TXAI'), 'Missing TXAI in app page');
    verbose(`Page length: ${text.length} chars`);
  });

  // JS files
  const jsFiles = [
    'js/smart-airdrop.js',
    'js/preflight.js',
    'js/keplr.js',
    'js/wallet.js',
    'js/create-token.js',
    'js/agent-runtime.js',
    'js/dex.js',
    'js/agent-nft.js',
    'js/agent-jobs.js',
    'js/auth.js',
    'js/manage.js',
    'js/subscriptions.js',
    'js/airdrop.js',
    'js/nft-airdrop.js',
    'js/token-gate.js',
    'js/tracker.js',
    'js/analytics.js',
    'js/config.js',
    'js/txdb.js',
    'js/chat.js',
    'js/create-nft.js',
    'js/swarm.js',
    'js/agent-workflows.js',
    'js/ws-client.js',
    'js/tradingview-chart.js',
  ];

  for (const file of jsFiles) {
    await test(`JS loads — ${file}`, async () => {
      const res = await fetchWithTimeout(`${SITE}/${file}`);
      assert(res.ok, `Expected 200, got ${res.status}`);
      const text = await res.text();
      assert(text.length > 0, 'Empty file');
      verbose(`${file}: ${text.length} bytes`);
    });
  }

  // CSS
  await test('CSS loads — css/styles.css', async () => {
    const res = await fetchWithTimeout(`${SITE}/css/styles.css`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const text = await res.text();
    assert(text.length > 100, 'CSS file too small');
    verbose(`styles.css: ${text.length} bytes`);
  });

  // Function existence checks
  await test('smart-airdrop.js contains smartAirdropOpen', async () => {
    const res = await fetchWithTimeout(`${SITE}/js/smart-airdrop.js`);
    assert(res.ok, `Failed to fetch: ${res.status}`);
    const text = await res.text();
    assert(text.includes('smartAirdropOpen'), 'Function smartAirdropOpen not found');
    assert(text.includes('smartAirdropClose'), 'Function smartAirdropClose not found');
    verbose('smartAirdropOpen and smartAirdropClose found');
  });

  await test('preflight.js contains preflightShowModal', async () => {
    const res = await fetchWithTimeout(`${SITE}/js/preflight.js`);
    assert(res.ok, `Failed to fetch: ${res.status}`);
    const text = await res.text();
    assert(
      text.includes('preflightShowModal') || text.includes('preflightGate') || text.includes('txaiPreflight'),
      'No preflight function found (preflightShowModal, preflightGate, or txaiPreflight)'
    );
    verbose('Preflight function found');
  });

  await test('wallet.js contains walletQuickConnect', async () => {
    const res = await fetchWithTimeout(`${SITE}/js/wallet.js`);
    assert(res.ok, `Failed to fetch: ${res.status}`);
    const text = await res.text();
    assert(text.includes('walletQuickConnect'), 'Function walletQuickConnect not found');
    verbose('walletQuickConnect found');
  });

  await test('keplr.js contains walletDetect', async () => {
    const res = await fetchWithTimeout(`${SITE}/js/keplr.js`);
    assert(res.ok, `Failed to fetch: ${res.status}`);
    const text = await res.text();
    assert(text.includes('walletDetect'), 'Function walletDetect not found');
    assert(text.includes('walletConnectWith'), 'Function walletConnectWith not found');
    verbose('walletDetect and walletConnectWith found');
  });

  await test('dex.js contains dexSetSide', async () => {
    const res = await fetchWithTimeout(`${SITE}/js/dex.js`);
    assert(res.ok, `Failed to fetch: ${res.status}`);
    const text = await res.text();
    assert(text.includes('dexSetSide'), 'Function dexSetSide not found');
    verbose('dexSetSide found');
  });

  await test('create-token.js contains switchTab', async () => {
    const res = await fetchWithTimeout(`${SITE}/js/create-token.js`);
    assert(res.ok, `Failed to fetch: ${res.status}`);
    const text = await res.text();
    assert(text.includes('switchTab'), 'Function switchTab not found');
    verbose('switchTab found');
  });

  await test('agent-runtime.js contains runtimeInit', async () => {
    const res = await fetchWithTimeout(`${SITE}/js/agent-runtime.js`);
    assert(res.ok, `Failed to fetch: ${res.status}`);
    const text = await res.text();
    assert(text.includes('runtimeInit'), 'Function runtimeInit not found');
    verbose('runtimeInit found');
  });
}

// ─── REPORT ──────────────────────────────────────────────────────────────────

function printReport() {
  const total = passed + failed + skipped;

  log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  log('  TXAI SMOKE TEST RESULTS');
  log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  log(`  PASSED:  ${String(passed).padStart(3)}`);
  log(`  FAILED:  ${String(failed).padStart(3)}`);
  log(`  SKIPPED: ${String(skipped).padStart(3)}`);
  log(`  TOTAL:   ${String(total).padStart(3)}`);
  log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  if (failures.length > 0) {
    log('\nFAILURES:');
    for (const f of failures) {
      log(`  \u2717 ${f.name} \u2014 ${f.error}`);
    }
  }

  if (VERBOSE) {
    log('\nFull results:');
    log(JSON.stringify(results, null, 2));
  }

  log(`\nAPI:  ${API}`);
  log(`Site: ${SITE}`);
  log(`Time: ${new Date().toISOString()}`);
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  log('=========================================');
  log('  TXAI Studio Smoke Test Suite');
  log('=========================================');
  log(`  API:     ${API}`);
  log(`  Site:    ${SITE}`);
  log(`  Verbose: ${VERBOSE}`);
  log(`  Time:    ${new Date().toISOString()}`);

  // Check if API is reachable first
  log('\n-- Connectivity Check --\n');
  try {
    await fetchWithTimeout(`${API}/health`, {}, 5000);
    log('  API server is reachable.\n');
  } catch (e) {
    log(`  WARNING: API server unreachable at ${API}`);
    log(`  Error: ${e.message || e}`);
    log('  API tests will likely fail. Continuing anyway...\n');
  }

  await apiTests();
  await frontendTests();
  printReport();

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
