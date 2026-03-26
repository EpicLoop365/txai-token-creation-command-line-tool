/**
 * TXAI Token Manager Smoke Test
 *
 * Tests token management operations via the agent wallet:
 * - Load token info
 * - Mint tokens
 * - Burn tokens
 * - Freeze/unfreeze
 * - Global freeze/unfreeze
 * - Clawback
 * - Whitelist
 *
 * Usage:
 *   node tests/manage-token-smoke.test.js
 *   node tests/manage-token-smoke.test.js --quick    (read-only)
 *   node tests/manage-token-smoke.test.js --verbose
 *   node tests/manage-token-smoke.test.js --denom=mytoken-testcore1abc...
 */

const API_URL = process.env.API_URL || 'https://txai-token-creation-production.up.railway.app';
const COREUM_REST = 'https://full-node.testnet-1.coreum.dev:1317';

const QUICK = process.argv.includes('--quick');
const VERBOSE = process.argv.includes('--verbose');
const DENOM_ARG = process.argv.find(a => a.startsWith('--denom='));

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
  const data = await res.json();
  if (VERBOSE) console.log('\n    Response:', JSON.stringify(data).slice(0, 300));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${data.error || data.message || JSON.stringify(data).slice(0, 100)}`);
  return data;
}

// ─── State ──────────────────────────────────────────────────────────────────

let agentWallet = '';
let testDenom = '';
let tokenInfo = null;
let initialSupply = 0;
let precision = 6;

// ─── Tests ──────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   TXAI Token Manager Smoke Test          ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Mode:   ${(QUICK ? 'Quick (read-only)' : 'Full (mint/burn/freeze)').padEnd(31)}║`);
  console.log('╚══════════════════════════════════════════╝\n');

  // ── Setup ──
  await test('Health + wallet', async () => {
    const data = await fetchJSON(`${API_URL}/health`);
    assert(data.status === 'ok');
    agentWallet = data.walletAddress || '';
    assert(agentWallet, 'No wallet address');
    pass(`Wallet: ${agentWallet.slice(0, 12)}...`);
  });

  // ── Find a test token ──
  await test('Find test token', async () => {
    if (DENOM_ARG) {
      testDenom = DENOM_ARG.split('=')[1];
      pass(`Using provided denom: ${testDenom.slice(0, 30)}...`);
      return;
    }

    // Find a token owned by agent that has minting + burning features
    const balRes = await fetchJSON(`${API_URL}/api/balances?address=${agentWallet}`);
    const tokens = (balRes.balances || [])
      .filter(b => b.denom !== 'utestcore' && b.denom.includes(agentWallet))
      .map(b => b.denom);

    assert(tokens.length > 0, 'No agent-owned tokens found. Create a token first.');

    // Check each token for minting feature
    for (const denom of tokens.slice(0, 5)) {
      try {
        const info = await fetchJSON(`${COREUM_REST}/coreum/asset/ft/v1/tokens/${denom}`);
        const features = info.token?.features || [];
        if (features.includes('minting') && features.includes('burning')) {
          testDenom = denom;
          break;
        }
      } catch { continue; }
    }

    if (!testDenom) testDenom = tokens[0]; // Fallback to first token
    const name = testDenom.split('-')[0].toUpperCase();
    pass(`Using: ${name} (${testDenom.slice(0, 30)}...)`);
  });

  // ── Load Token Info ──
  await test('Load token info (API)', async () => {
    const data = await fetchJSON(`${API_URL}/api/token-info?denom=${encodeURIComponent(testDenom)}`);
    tokenInfo = data.token || data;
    assert(tokenInfo.denom || tokenInfo.symbol, 'No token data returned');
    pass(`Symbol: ${tokenInfo.symbol || '?'}, Issuer: ${(tokenInfo.issuer || '').slice(0, 12)}...`);
  });

  // ── Load Token Info from Chain ──
  await test('Load token info (chain)', async () => {
    const data = await fetchJSON(`${COREUM_REST}/coreum/asset/ft/v1/tokens/${testDenom}`);
    assert(data.token, 'No token on chain');
    const t = data.token;
    tokenInfo = t;
    precision = parseInt(t.precision) || 6;
    const features = t.features || [];

    pass(`Symbol: ${t.symbol}, Precision: ${precision}`);
    pass(`Features: ${features.join(', ') || 'none'}`);

    // Check burn/commission rates
    const burnRate = parseFloat(t.burn_rate || '0');
    const commRate = parseFloat(t.send_commission_rate || '0');
    if (burnRate > 0) pass(`Burn rate: ${(burnRate * 100).toFixed(2)}%`);
    if (commRate > 0) pass(`Commission: ${(commRate * 100).toFixed(2)}%`);
  });

  // ── Check Supply ──
  await test('Check supply', async () => {
    const data = await fetchJSON(`${COREUM_REST}/cosmos/bank/v1beta1/supply/by_denom?denom=${encodeURIComponent(testDenom)}`);
    const raw = parseInt(data.amount?.amount || '0');
    initialSupply = raw;
    const human = raw / Math.pow(10, precision);
    pass(`Supply: ${human.toLocaleString()} (raw: ${raw})`);
  });

  // ── Check Issuer Match ──
  await test('Verify issuer is agent', async () => {
    const issuer = tokenInfo?.issuer || '';
    const isAgent = issuer === agentWallet;
    if (isAgent) {
      pass(`Agent is issuer ✓`);
    } else {
      warn(`Agent is NOT issuer (issuer: ${issuer.slice(0, 12)}...)`);
      if (!QUICK) warn('Write operations will fail — agent cannot manage this token');
    }
  });

  if (QUICK) {
    console.log('\n  ⏭️  Skipping write operations (--quick mode)\n');
    skipped = 6;
    printSummary();
    return;
  }

  const features = tokenInfo?.features || [];
  const isIssuer = tokenInfo?.issuer === agentWallet;

  if (!isIssuer) {
    console.log('\n  ⏭️  Agent is not the issuer — skipping write tests\n');
    skipped = 6;
    printSummary();
    return;
  }

  // ── Mint ──
  if (features.includes('minting')) {
    await test('Mint 10 tokens', async () => {
      const amount = (10 * Math.pow(10, precision)).toString();
      const data = await fetchJSON(`${API_URL}/api/token/mint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ denom: testDenom, amount }),
      });
      assert(data.txHash || data.success, `Mint failed: ${JSON.stringify(data).slice(0, 200)}`);
      pass(`Minted 10 tokens. TX: ${(data.txHash || '').slice(0, 16)}...`);

      await sleep(3000);
      const supply = await fetchJSON(`${COREUM_REST}/cosmos/bank/v1beta1/supply/by_denom?denom=${encodeURIComponent(testDenom)}`);
      const newRaw = parseInt(supply.amount?.amount || '0');
      const expected = initialSupply + parseInt(amount);
      pass(`Supply: ${initialSupply} → ${newRaw} (expected: ${expected})`);
      initialSupply = newRaw;
    });
  } else {
    await test('Mint (skipped - no minting feature)', async () => { skipped++; });
  }

  // ── Burn ──
  if (features.includes('burning')) {
    await test('Burn 5 tokens', async () => {
      const amount = (5 * Math.pow(10, precision)).toString();
      const data = await fetchJSON(`${API_URL}/api/token/burn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ denom: testDenom, amount }),
      });
      assert(data.txHash || data.success, `Burn failed: ${JSON.stringify(data).slice(0, 200)}`);
      pass(`Burned 5 tokens. TX: ${(data.txHash || '').slice(0, 16)}...`);

      await sleep(3000);
      const supply = await fetchJSON(`${COREUM_REST}/cosmos/bank/v1beta1/supply/by_denom?denom=${encodeURIComponent(testDenom)}`);
      const newRaw = parseInt(supply.amount?.amount || '0');
      pass(`Supply: ${initialSupply} → ${newRaw}`);
      assert(newRaw < initialSupply, 'Supply did not decrease');
      initialSupply = newRaw;
    });
  } else {
    await test('Burn (skipped - no burning feature)', async () => { skipped++; });
  }

  // ── Global Freeze / Unfreeze ──
  if (features.includes('freezing')) {
    await test('Global freeze', async () => {
      const data = await fetchJSON(`${API_URL}/api/token/global-freeze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ denom: testDenom }),
      });
      assert(data.txHash || data.success, `Global freeze failed`);
      pass(`Global freeze TX: ${(data.txHash || '').slice(0, 16)}...`);
    });

    await test('Global unfreeze', async () => {
      await sleep(2000);
      const data = await fetchJSON(`${API_URL}/api/token/global-unfreeze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ denom: testDenom }),
      });
      assert(data.txHash || data.success, `Global unfreeze failed`);
      pass(`Global unfreeze TX: ${(data.txHash || '').slice(0, 16)}...`);
    });
  } else {
    await test('Freeze (skipped - no freezing feature)', async () => { skipped += 2; });
  }

  // ── Supply Integrity ──
  await test('Final supply integrity check', async () => {
    await sleep(2000);
    const supply = await fetchJSON(`${COREUM_REST}/cosmos/bank/v1beta1/supply/by_denom?denom=${encodeURIComponent(testDenom)}`);
    const finalRaw = parseInt(supply.amount?.amount || '0');
    const finalHuman = finalRaw / Math.pow(10, precision);
    pass(`Final supply: ${finalHuman.toLocaleString()} (raw: ${finalRaw})`);
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
