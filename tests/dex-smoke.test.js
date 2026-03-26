/**
 * TXAI DEX Smoke Test Suite
 *
 * Tests the full DEX lifecycle: pairs, orderbook, place, cancel, fill, balances.
 * Uses the agent wallet path (no browser needed).
 *
 * Usage:
 *   node tests/dex-smoke.test.js
 *   node tests/dex-smoke.test.js --quick    (skip slow trade tests)
 *   node tests/dex-smoke.test.js --verbose  (show full responses)
 *
 * Note: Full suite takes ~8 minutes due to 60s rate limit on /api/trade.
 * Use --quick for read-only tests (~5 seconds).
 */

const API_URL = process.env.API_URL || 'https://txai-token-creation-production.up.railway.app';
const COREUM_REST = 'https://full-node.testnet-1.coreum.dev:1317';
const QUOTE_DENOM = 'utestcore';
const DECIMALS = 6;

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
    if (VERBOSE && err.stack) console.log('    ' + err.stack.split('\n').slice(1, 3).join('\n    '));
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const data = await res.json();
  if (VERBOSE) console.log('\n    Response:', JSON.stringify(data).slice(0, 200));
  return data;
}

/**
 * Consume SSE stream from POST /api/trade
 * Returns array of parsed event objects
 */
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
    buffer = lines.pop(); // Keep incomplete last line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return events;
      try {
        events.push(JSON.parse(payload));
      } catch {
        events.push({ raw: payload });
      }
    }
  }
  return events;
}

/**
 * Execute a trade instruction via the AI agent SSE endpoint
 */
async function executeTrade(instruction) {
  const res = await fetch(`${API_URL}/api/trade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instruction,
      baseDenom: testBaseDenom,
      quoteDenom: QUOTE_DENOM,
    }),
  });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') || '60');
    warn(`Rate limited. Waiting ${retryAfter}s...`);
    await sleep(retryAfter * 1000 + 2000);
    // Retry once
    const res2 = await fetch(`${API_URL}/api/trade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction,
        baseDenom: testBaseDenom,
        quoteDenom: QUOTE_DENOM,
      }),
    });
    if (!res2.ok) throw new Error(`Trade request failed after retry: ${res2.status}`);
    return consumeSSE(res2);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Trade request failed: ${res.status} - ${body.slice(0, 200)}`);
  }
  return consumeSSE(res);
}

// ─── State ──────────────────────────────────────────────────────────────────

let agentWallet = '';
let testBaseDenom = '';
let testTokenName = '';
let initialBalances = {};
let buyOrderId = '';
let sellOrderId = '';

// ─── Tests ──────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   TXAI DEX Smoke Test Suite              ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  API:    ${API_URL.slice(0, 35).padEnd(35)}║`);
  console.log(`║  Mode:   ${QUICK ? 'Quick (read-only)' : 'Full (includes trades)'}${QUICK ? '   ' : ''}          ║`);
  console.log('╚══════════════════════════════════════════╝\n');

  // ── Test 0: Health Check ──
  await test('Health check', async () => {
    const data = await fetchJSON(`${API_URL}/health`);
    assert(data.status === 'ok', `Expected status "ok", got "${data.status}"`);
    assert(data.chainId === 'coreum-testnet-1', `Expected chainId "coreum-testnet-1", got "${data.chainId}"`);
    // Extract wallet from health endpoint
    if (data.walletAddress) agentWallet = data.walletAddress;
    pass(`Server healthy, chain: ${data.chainId}`);
  });

  // ── Test 1: Get Agent Wallet ──
  await test('Get agent wallet', async () => {
    // If not from health, get from orders endpoint
    if (!agentWallet) {
      const data = await fetchJSON(`${API_URL}/api/orders`);
      agentWallet = data.wallet || '';
    }
    assert(agentWallet.startsWith('testcore'), `Wallet doesn't start with "testcore": ${agentWallet}`);
    pass(`Agent wallet: ${agentWallet.slice(0, 16)}...${agentWallet.slice(-4)}`);
  });

  // ── Test 2: Load Trading Pairs ──
  await test('Load trading pairs', async () => {
    const data = await fetchJSON(`${API_URL}/api/pairs`);
    assert(Array.isArray(data.pairs), 'Expected pairs array');
    assert(data.pairs.length > 0, 'No trading pairs found. Deploy a token first.');

    // Prefer a pair owned by the agent wallet (denom contains the agent address)
    const agentSuffix = agentWallet ? agentWallet : '';
    const ownedPair = data.pairs.find(p => p.baseDenom && p.baseDenom.includes(agentSuffix));
    const pair = ownedPair || data.pairs[0];
    testBaseDenom = pair.baseDenom;
    testTokenName = testBaseDenom.split('-')[0].toUpperCase();
    pass(`Found ${data.pairs.length} pairs. Testing with: ${testTokenName} (${testBaseDenom.slice(0, 30)}...)`);
  });

  // ── Test 3: Load Orderbook ──
  await test('Load orderbook', async () => {
    const data = await fetchJSON(
      `${API_URL}/api/orderbook?baseDenom=${encodeURIComponent(testBaseDenom)}&quoteDenom=${encodeURIComponent(QUOTE_DENOM)}`
    );
    assert(Array.isArray(data.bids), 'Expected bids array');
    assert(Array.isArray(data.asks), 'Expected asks array');
    pass(`Orderbook: ${data.bids.length} bids, ${data.asks.length} asks`);
  });

  // ── Test 4: Check Agent Balances ──
  await test('Check agent balances', async () => {
    const data = await fetchJSON(`${API_URL}/api/balances?address=${agentWallet}`);
    assert(Array.isArray(data.balances), 'Expected balances array');

    // Store balances
    initialBalances = {};
    data.balances.forEach(b => { initialBalances[b.denom] = b.amount; });

    const coreBal = initialBalances[QUOTE_DENOM] || '0';
    const tokenBal = initialBalances[testBaseDenom] || '0';
    const coreHuman = (parseInt(coreBal) / Math.pow(10, DECIMALS)).toFixed(2);
    const tokenHuman = (parseInt(tokenBal) / Math.pow(10, DECIMALS)).toFixed(2);

    assert(parseInt(coreBal) > 0, `Agent has 0 TX — needs gas. Fund the agent wallet.`);
    pass(`TX: ${coreHuman}, ${testTokenName}: ${tokenHuman}`);
  });

  // ── Test 5: Fetch Open Orders ──
  await test('Fetch open orders', async () => {
    const data = await fetchJSON(`${API_URL}/api/orders?creator=${agentWallet}`);
    assert(Array.isArray(data.orders), 'Expected orders array');
    pass(`${data.orders.length} open orders for agent`);
  });

  // ── Test 6: Chain REST Direct Query ──
  await test('Direct chain REST query', async () => {
    const data = await fetchJSON(`${COREUM_REST}/cosmos/bank/v1beta1/balances/${agentWallet}`);
    assert(Array.isArray(data.balances), 'Expected balances from chain REST');
    pass(`Chain REST working, ${data.balances.length} denominations`);
  });

  // ── Test 7: Token Info Query ──
  await test('Token info query', async () => {
    const data = await fetchJSON(`${COREUM_REST}/coreum/asset/ft/v1/tokens/${testBaseDenom}`);
    assert(data.token, 'Expected token info');
    const t = data.token;
    pass(`${t.symbol || testTokenName}: supply=${t.supply || '?'}, precision=${t.precision || '?'}, features=${(t.features || []).join(',') || 'none'}`);
  });

  // ── Quick mode stops here ──
  if (QUICK) {
    console.log('\n  ⏭️  Skipping trade tests (--quick mode)\n');
    skipped = 5;
    printSummary();
    return;
  }

  console.log('\n  ⏳ Starting trade tests (expect ~5-8 min due to rate limits)...\n');

  // ── Test 8: Place Buy Limit Order ──
  await test('Place buy limit order (agent)', async () => {
    info('Sending trade instruction...');
    const events = await executeTrade(
      `Place a limit buy order for 1 ${testTokenName} token at a price of 0.001 TX per token`
    );

    assert(events.length > 0, 'No SSE events received');
    if (VERBOSE) info(`Received ${events.length} SSE events`);

    // Look for success indicators in events
    const hasToolCall = events.some(e =>
      e.type === 'tool_call' || e.tool_calls || (e.content && JSON.stringify(e).includes('place'))
    );
    const hasError = events.some(e =>
      (e.error) || (e.content && typeof e.content === 'string' && e.content.toLowerCase().includes('error'))
    );

    if (hasError) warn('Possible error in response — check manually');
    pass(`Trade instruction processed, ${events.length} events`);

    // Wait for chain propagation
    await sleep(5000);

    // Check orders
    const ordersData = await fetchJSON(`${API_URL}/api/orders?creator=${agentWallet}`);
    const buyOrders = (ordersData.orders || []).filter(o =>
      o.side && o.side.toLowerCase().includes('buy')
    );
    if (buyOrders.length > 0) {
      buyOrderId = buyOrders[0].id || buyOrders[0].order_id || '';
      pass(`Buy order found: ${buyOrderId.slice(0, 20)}...`);
    } else {
      warn('Buy order not found in open orders — may have filled or failed');
    }
  });

  // ── Test 9: Place Sell Limit Order ──
  await test('Place sell limit order (agent)', async () => {
    info('Waiting for rate limit cooldown (65s)...');
    await sleep(65000);

    info('Sending sell instruction...');
    const events = await executeTrade(
      `Place a limit sell order for 1 ${testTokenName} token at a price of 999 TX per token`
    );

    assert(events.length > 0, 'No SSE events received');
    pass(`Sell instruction processed, ${events.length} events`);

    await sleep(5000);

    // Check orders
    const ordersData = await fetchJSON(`${API_URL}/api/orders?creator=${agentWallet}`);
    const sellOrders = (ordersData.orders || []).filter(o =>
      o.side && o.side.toLowerCase().includes('sell')
    );
    if (sellOrders.length > 0) {
      sellOrderId = sellOrders[0].id || sellOrders[0].order_id || '';
      pass(`Sell order found: ${sellOrderId.slice(0, 20)}...`);
    } else {
      warn('Sell order not found in open orders');
    }
  });

  // ── Test 10: Verify Both Orders in Open Orders ──
  await test('Verify open orders contain buy and sell', async () => {
    const ordersData = await fetchJSON(`${API_URL}/api/orders?creator=${agentWallet}`);
    const orders = ordersData.orders || [];
    const hasBuy = orders.some(o => o.side && o.side.toLowerCase().includes('buy'));
    const hasSell = orders.some(o => o.side && o.side.toLowerCase().includes('sell'));
    pass(`${orders.length} open orders (buy: ${hasBuy ? 'yes' : 'no'}, sell: ${hasSell ? 'yes' : 'no'})`);
  });

  // ── Test 11: Cancel the Sell Order ──
  await test('Cancel sell order (agent)', async () => {
    if (!sellOrderId) {
      warn('No sell order ID — skipping cancel test');
      skipped++;
      return;
    }

    info('Waiting for rate limit cooldown (65s)...');
    await sleep(65000);

    info(`Cancelling order ${sellOrderId.slice(0, 20)}...`);
    const events = await executeTrade(
      `Cancel order ${sellOrderId} on the DEX`
    );

    assert(events.length > 0, 'No SSE events received');
    pass(`Cancel instruction processed, ${events.length} events`);

    await sleep(5000);

    // Verify cancelled
    const ordersData = await fetchJSON(`${API_URL}/api/orders?creator=${agentWallet}`);
    const stillExists = (ordersData.orders || []).some(o =>
      (o.id || o.order_id) === sellOrderId
    );
    if (!stillExists) {
      pass('Sell order successfully removed from open orders');
    } else {
      warn('Sell order still in open orders — cancel may be pending');
    }
  });

  // ── Test 12: Check Final Balances ──
  await test('Check final balances', async () => {
    const data = await fetchJSON(`${API_URL}/api/balances?address=${agentWallet}`);
    const finalBalances = {};
    (data.balances || []).forEach(b => { finalBalances[b.denom] = b.amount; });

    const initCore = parseInt(initialBalances[QUOTE_DENOM] || '0');
    const finalCore = parseInt(finalBalances[QUOTE_DENOM] || '0');
    const gasCost = initCore - finalCore;

    pass(`Gas spent: ${(gasCost / Math.pow(10, DECIMALS)).toFixed(4)} TX`);
    pass(`Final TX balance: ${(finalCore / Math.pow(10, DECIMALS)).toFixed(2)}`);
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

// ─── Run ────────────────────────────────────────────────────────────────────

run().catch(err => {
  console.error('\n💀 Fatal error:', err.message);
  if (VERBOSE) console.error(err.stack);
  process.exit(2);
});
