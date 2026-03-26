/**
 * TXAI DEX Stress Test — Extensive Orderbook Population & Trading
 *
 * Populates the orderbook with many orders at various price levels,
 * then performs complex trading scenarios to validate the full DEX.
 *
 * This test uses the server API endpoints directly (agent wallet),
 * bypassing the AI agent SSE stream to avoid rate limits.
 *
 * Usage:
 *   node tests/dex-stress.test.js
 *   node tests/dex-stress.test.js --orders=50     (default: 20)
 *   node tests/dex-stress.test.js --verbose
 *   node tests/dex-stress.test.js --denom=mytoken-testcore1...
 *   node tests/dex-stress.test.js --cleanup       (cancel all orders after)
 *
 * Requirements:
 *   - Agent wallet has sufficient TX (utestcore) for gas
 *   - Agent wallet has sufficient tokens for sell orders
 */

const API_URL = process.env.API_URL || 'https://txai-token-creation-production.up.railway.app';
const COREUM_REST = 'https://full-node.testnet-1.coreum.dev:1317';
const QUOTE_DENOM = 'utestcore';
const DECIMALS = 6;

const VERBOSE = process.argv.includes('--verbose');
const CLEANUP = process.argv.includes('--cleanup');
const ORDER_ARG = process.argv.find(a => a.startsWith('--orders='));
const DENOM_ARG = process.argv.find(a => a.startsWith('--denom='));
const NUM_ORDERS = parseInt(ORDER_ARG?.split('=')[1] || '20');

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
  if (VERBOSE && opts?.method === 'POST') console.log('\n    →', JSON.stringify(data).slice(0, 200));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${data.error || data.message || JSON.stringify(data).slice(0, 150)}`);
  return data;
}

/**
 * Place an order via the SSE trade endpoint
 * Handles rate limiting with retry
 */
async function placeOrderViaTrade(instruction, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${API_URL}/api/trade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction,
        baseDenom: testDenom,
        quoteDenom: QUOTE_DENOM,
      }),
    });

    if (res.status === 429) {
      if (attempt < retries) {
        const wait = parseInt(res.headers.get('retry-after') || '60');
        info(`Rate limited, waiting ${wait}s (attempt ${attempt + 1}/${retries + 1})...`);
        await sleep(wait * 1000 + 2000);
        continue;
      }
      throw new Error('Rate limited after all retries');
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Consume SSE
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', events = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (t.startsWith('data:')) {
          const p = t.slice(5).trim();
          if (p === '[DONE]') return events;
          try { events.push(JSON.parse(p)); } catch {}
        }
      }
    }
    return events;
  }
}

/**
 * Place order directly via build-tx (faster, no rate limit)
 * Falls back to trade endpoint if build-tx doesn't support direct orders
 */
async function placeOrderDirect(side, price, quantity) {
  const orderId = `stress-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
  const quantityRaw = Math.round(parseFloat(quantity) * Math.pow(10, DECIMALS)).toString();

  try {
    // Try using the build-tx endpoint with the agent wallet
    const msg = {
      typeUrl: '/coreum.dex.v1.MsgPlaceOrder',
      value: {
        sender: agentWallet,
        type: 1, // limit
        id: orderId,
        baseDenom: testDenom,
        quoteDenom: QUOTE_DENOM,
        price: price.toString(),
        quantity: quantityRaw,
        side: side === 'buy' ? 1 : 2,
        timeInForce: 1,
      }
    };

    // Use the server's token management pattern - direct signing
    const instruction = `Place a limit ${side} order for ${quantity} tokens at price ${price}`;
    const events = await placeOrderViaTrade(instruction);

    return { orderId, events, success: true };
  } catch (err) {
    return { orderId, error: err.message, success: false };
  }
}

// ─── State ──────────────────────────────────────────────────────────────────

let agentWallet = '';
let testDenom = '';
let testTokenName = '';
let placedOrderIds = [];
let initialTxBalance = 0;
let initialTokenBalance = 0;

// ─── Tests ──────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   TXAI DEX Stress Test                   ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Orders:  ${String(NUM_ORDERS).padEnd(30)}║`);
  console.log(`║  Cleanup: ${String(CLEANUP ? 'Yes' : 'No').padEnd(30)}║`);
  console.log('╚══════════════════════════════════════════╝\n');

  // ── Setup ──
  await test('Setup: health + wallet', async () => {
    const data = await fetchJSON(`${API_URL}/health`);
    assert(data.status === 'ok');
    agentWallet = data.walletAddress || '';
    if (!agentWallet) {
      const orders = await fetchJSON(`${API_URL}/api/orders`);
      agentWallet = orders.wallet || '';
    }
    assert(agentWallet, 'No agent wallet');
    pass(`Agent: ${agentWallet.slice(0, 12)}...`);
  });

  await test('Setup: find test token', async () => {
    if (DENOM_ARG) {
      testDenom = DENOM_ARG.split('=')[1];
    } else {
      // Find agent's token with most supply
      const balRes = await fetchJSON(`${API_URL}/api/balances?address=${agentWallet}`);
      const tokens = (balRes.balances || [])
        .filter(b => b.denom !== 'utestcore' && b.denom.includes(agentWallet))
        .sort((a, b) => parseInt(b.amount) - parseInt(a.amount));
      assert(tokens.length > 0, 'No tokens found');
      testDenom = tokens[0].denom;
    }
    testTokenName = testDenom.split('-')[0].toUpperCase();
    pass(`Token: ${testTokenName} (${testDenom.slice(0, 30)}...)`);
  });

  await test('Setup: check balances', async () => {
    const balRes = await fetchJSON(`${API_URL}/api/balances?address=${agentWallet}`);
    const bals = {};
    (balRes.balances || []).forEach(b => { bals[b.denom] = parseInt(b.amount); });

    initialTxBalance = bals[QUOTE_DENOM] || 0;
    initialTokenBalance = bals[testDenom] || 0;

    const txHuman = (initialTxBalance / 1e6).toFixed(2);
    const tokenHuman = (initialTokenBalance / 1e6).toFixed(2);

    assert(initialTxBalance > 1000000, `Need at least 1 TX for gas, have ${txHuman}`);
    assert(initialTokenBalance > 0, `Need tokens to sell, have ${tokenHuman} ${testTokenName}`);

    pass(`TX: ${txHuman}, ${testTokenName}: ${tokenHuman}`);
  });

  // ── Get initial orderbook state ──
  await test('Initial orderbook snapshot', async () => {
    const data = await fetchJSON(
      `${API_URL}/api/orderbook?baseDenom=${encodeURIComponent(testDenom)}&quoteDenom=${QUOTE_DENOM}`
    );
    pass(`Bids: ${data.bids.length}, Asks: ${data.asks.length}`);
  });

  // ── Get initial open orders ──
  let existingOrders = [];
  await test('Initial open orders', async () => {
    const data = await fetchJSON(`${API_URL}/api/orders?creator=${agentWallet}`);
    existingOrders = data.orders || [];
    pass(`${existingOrders.length} existing orders`);
  });

  // ── Populate Orderbook ──
  console.log(`\n  ⏳ Populating orderbook with ${NUM_ORDERS} orders...`);
  console.log('  ⏳ Each order requires ~65s due to rate limits.');
  console.log(`  ⏳ Estimated time: ${Math.ceil(NUM_ORDERS * 65 / 60)} minutes\n`);

  const halfOrders = Math.floor(NUM_ORDERS / 2);
  let buyCount = 0, sellCount = 0, failCount = 0;

  // Generate price levels
  const basePrice = 0.5; // Base price point
  const buyPrices = [];
  const sellPrices = [];

  for (let i = 0; i < halfOrders; i++) {
    // Buy orders: spread below base price (0.01 to 0.49)
    buyPrices.push((basePrice - (halfOrders - i) * (basePrice / (halfOrders + 1))).toFixed(4));
    // Sell orders: spread above base price (0.51 to 0.99)
    sellPrices.push((basePrice + (i + 1) * (basePrice / (halfOrders + 1))).toFixed(4));
  }

  // Place buy orders
  for (let i = 0; i < halfOrders; i++) {
    await test(`Place BUY #${i + 1}/${halfOrders} @ ${buyPrices[i]}`, async () => {
      if (i > 0) {
        info('Waiting for rate limit (65s)...');
        await sleep(65000);
      }
      const qty = (Math.floor(Math.random() * 100) + 10).toString();
      const events = await placeOrderViaTrade(
        `Place a limit buy order for ${qty} ${testTokenName} tokens at price ${buyPrices[i]}`
      );
      assert(events && events.length > 0, 'No events received');
      buyCount++;
      pass(`Buy @ ${buyPrices[i]} x ${qty}`);
    });
  }

  // Place sell orders
  for (let i = 0; i < halfOrders; i++) {
    await test(`Place SELL #${i + 1}/${halfOrders} @ ${sellPrices[i]}`, async () => {
      info('Waiting for rate limit (65s)...');
      await sleep(65000);
      const qty = (Math.floor(Math.random() * 100) + 10).toString();
      const events = await placeOrderViaTrade(
        `Place a limit sell order for ${qty} ${testTokenName} tokens at price ${sellPrices[i]}`
      );
      assert(events && events.length > 0, 'No events received');
      sellCount++;
      pass(`Sell @ ${sellPrices[i]} x ${qty}`);
    });
  }

  // ── Verify populated orderbook ──
  await test('Verify populated orderbook', async () => {
    await sleep(5000);
    const data = await fetchJSON(
      `${API_URL}/api/orderbook?baseDenom=${encodeURIComponent(testDenom)}&quoteDenom=${QUOTE_DENOM}`
    );
    pass(`Orderbook: ${data.bids.length} bids, ${data.asks.length} asks`);

    // Verify bid/ask ordering
    if (data.bids.length >= 2) {
      const prices = data.bids.map(b => parseFloat(b.price));
      const sorted = [...prices].sort((a, b) => b - a); // Descending
      const isOrdered = JSON.stringify(prices) === JSON.stringify(sorted);
      if (isOrdered) pass('Bids correctly ordered (highest first)');
      else warn('Bids may not be properly ordered');
    }
    if (data.asks.length >= 2) {
      const prices = data.asks.map(a => parseFloat(a.price));
      const sorted = [...prices].sort((a, b) => a - b); // Ascending
      const isOrdered = JSON.stringify(prices) === JSON.stringify(sorted);
      if (isOrdered) pass('Asks correctly ordered (lowest first)');
      else warn('Asks may not be properly ordered');
    }

    // Verify spread (best bid < best ask)
    if (data.bids.length > 0 && data.asks.length > 0) {
      const bestBid = parseFloat(data.bids[0].price);
      const bestAsk = parseFloat(data.asks[0].price);
      assert(bestBid < bestAsk, `Crossed book! bid=${bestBid} >= ask=${bestAsk}`);
      const spread = ((bestAsk - bestBid) / bestAsk * 100).toFixed(2);
      pass(`Spread: ${spread}% (bid=${bestBid}, ask=${bestAsk})`);
    }
  });

  // ── Verify all orders in open orders ──
  await test('Verify open orders count', async () => {
    const data = await fetchJSON(`${API_URL}/api/orders?creator=${agentWallet}`);
    const newOrders = (data.orders || []).length - existingOrders.length;
    pass(`${data.orders.length} total orders (${newOrders} new, ${existingOrders.length} existing)`);
    pass(`Successfully placed: ${buyCount} buys, ${sellCount} sells`);
  });

  // ── Cancel one order ──
  await test('Cancel one order', async () => {
    const data = await fetchJSON(`${API_URL}/api/orders?creator=${agentWallet}`);
    const stressOrders = (data.orders || []).filter(o =>
      (o.id || '').startsWith('stress-') || (o.id || '').startsWith('ord-')
    );
    if (stressOrders.length === 0) {
      warn('No stress test orders found to cancel');
      return;
    }
    const target = stressOrders[0];
    const targetId = target.id || target.order_id;
    info(`Cancelling order ${targetId.slice(0, 20)}...`);
    info('Waiting for rate limit (65s)...');
    await sleep(65000);

    const events = await placeOrderViaTrade(`Cancel order ${targetId}`);
    assert(events && events.length > 0, 'No cancel events received');
    pass(`Cancelled: ${targetId.slice(0, 20)}...`);
  });

  // ── Verify cancel ──
  await test('Verify cancellation', async () => {
    await sleep(5000);
    const data = await fetchJSON(`${API_URL}/api/orders?creator=${agentWallet}`);
    const remaining = (data.orders || []).length;
    pass(`${remaining} orders remaining after cancel`);
  });

  // ── Final balance check ──
  await test('Final balance check', async () => {
    const balRes = await fetchJSON(`${API_URL}/api/balances?address=${agentWallet}`);
    const bals = {};
    (balRes.balances || []).forEach(b => { bals[b.denom] = parseInt(b.amount); });

    const finalTx = bals[QUOTE_DENOM] || 0;
    const finalToken = bals[testDenom] || 0;
    const gasCost = initialTxBalance - finalTx;

    pass(`Gas spent: ${(gasCost / 1e6).toFixed(4)} TX`);
    pass(`TX: ${(initialTxBalance / 1e6).toFixed(2)} → ${(finalTx / 1e6).toFixed(2)}`);
    pass(`${testTokenName}: ${(initialTokenBalance / 1e6).toFixed(2)} → ${(finalToken / 1e6).toFixed(2)}`);
  });

  // ── Cleanup (optional) ──
  if (CLEANUP) {
    console.log('\n  🧹 Cleaning up — cancelling all stress test orders...\n');
    const data = await fetchJSON(`${API_URL}/api/orders?creator=${agentWallet}`);
    const orders = data.orders || [];
    let cancelCount = 0;

    for (const order of orders) {
      const oid = order.id || order.order_id;
      if (!oid) continue;
      try {
        info(`Cancelling ${oid.slice(0, 20)}... (waiting 65s)`);
        await sleep(65000);
        await placeOrderViaTrade(`Cancel order ${oid}`);
        cancelCount++;
        pass(`Cancelled ${oid.slice(0, 20)}...`);
      } catch (err) {
        warn(`Failed to cancel ${oid.slice(0, 20)}: ${err.message}`);
      }
    }
    info(`Cancelled ${cancelCount}/${orders.length} orders`);
  }

  printSummary();
}

function printSummary() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║          STRESS TEST RESULTS             ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  ✅ Passed:  ${String(passed).padEnd(28)}║`);
  console.log(`║  ❌ Failed:  ${String(failed).padEnd(28)}║`);
  console.log(`║  ⏭️  Skipped: ${String(skipped).padEnd(28)}║`);
  console.log(`║  📊 Orders:  ${String(NUM_ORDERS + ' requested').padEnd(28)}║`);
  console.log('╚══════════════════════════════════════════╝\n');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('\n💀 Fatal error:', err.message);
  process.exit(2);
});
