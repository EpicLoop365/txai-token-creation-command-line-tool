/**
 * TXAI Orderbook Seeder
 *
 * One-time script to populate a token's orderbook with realistic buy/sell
 * limit orders at various price levels. Uses the direct /api/dex/place-order
 * endpoint (no AI, no 60s rate limit) — just sequential on-chain TXs.
 *
 * After running this, the DEX smoke & stress tests can validate against
 * a populated orderbook without spending hours placing orders.
 *
 * Usage:
 *   node tests/seed-orderbook.js
 *   node tests/seed-orderbook.js --denom=mytoken-testcore1...
 *   node tests/seed-orderbook.js --buys=15 --sells=15
 *   node tests/seed-orderbook.js --base-price=0.001
 *   node tests/seed-orderbook.js --verbose
 *   node tests/seed-orderbook.js --dry-run
 *
 * Defaults:
 *   15 buy orders + 15 sell orders = 30 total
 *   Base price: 0.001 TX per token
 *   Spread: buys from -50% to -1%, sells from +1% to +50%
 *   Quantity: random 1-100 tokens per order
 */

const API_URL = process.env.API_URL || 'https://txai-token-creation-production.up.railway.app';
const QUOTE_DENOM = 'utestcore';
const DECIMALS = 6;

const VERBOSE = process.argv.includes('--verbose');
const DRY_RUN = process.argv.includes('--dry-run');
const DENOM_ARG = process.argv.find(a => a.startsWith('--denom='));
const BUYS_ARG = process.argv.find(a => a.startsWith('--buys='));
const SELLS_ARG = process.argv.find(a => a.startsWith('--sells='));
const PRICE_ARG = process.argv.find(a => a.startsWith('--base-price='));

const NUM_BUYS = parseInt(BUYS_ARG?.split('=')[1] || '15');
const NUM_SELLS = parseInt(SELLS_ARG?.split('=')[1] || '15');
const BASE_PRICE = parseFloat(PRICE_ARG?.split('=')[1] || '0.001');

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(icon, msg) { console.log(`  ${icon} ${msg}`); }
function pass(msg) { log('✅', msg); }
function fail(msg) { log('❌', msg); }
function info(msg) { log('ℹ️ ', msg); }
function warn(msg) { log('⚠️ ', msg); }

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`);
  }
  if (VERBOSE) console.log('    →', JSON.stringify(data).slice(0, 200));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${data.error || JSON.stringify(data).slice(0, 100)}`);
  return data;
}

/**
 * Generate price levels spread around a base price.
 * Buys: below base price (descending from -1% to -spreadPct%)
 * Sells: above base price (ascending from +1% to +spreadPct%)
 */
function generatePriceLevels(basePrice, count, side) {
  const levels = [];
  const spreadPct = 50; // max % away from base price
  const minPct = 1;     // min % away from base price

  for (let i = 0; i < count; i++) {
    const pct = minPct + (spreadPct - minPct) * (i / Math.max(count - 1, 1));
    const multiplier = side === 'buy'
      ? 1 - (pct / 100)   // below base
      : 1 + (pct / 100);  // above base
    const price = basePrice * multiplier;
    // Random quantity between 1 and 100 tokens
    const quantity = Math.floor(Math.random() * 100) + 1;
    levels.push({ price, quantity });
  }

  return levels;
}

/**
 * Convert human-readable price to chain format.
 * Coreum DEX uses scientific notation: e.g., 0.001 → "1e-3"
 * The price represents quote_amount / base_amount in minimal denoms.
 */
function formatPrice(price) {
  // Use scientific notation that Coreum understands
  // The price is in TX per token (both have 6 decimals, so ratio stays the same)
  return price.toExponential();
}

/**
 * Convert human-readable quantity to raw (×10^6)
 */
function toRaw(amount) {
  return Math.round(amount * Math.pow(10, DECIMALS)).toString();
}

// ─── State ──────────────────────────────────────────────────────────────────

let agentWallet = '';
let baseDenom = '';
let tokenName = '';
let placedOrders = [];

// ─── Main ───────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   TXAI Orderbook Seeder                          ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  Buy orders:  ${String(NUM_BUYS).padEnd(35)}║`);
  console.log(`║  Sell orders: ${String(NUM_SELLS).padEnd(35)}║`);
  console.log(`║  Base price:  ${String(BASE_PRICE + ' TX').padEnd(35)}║`);
  console.log(`║  Mode:        ${(DRY_RUN ? 'Dry run (no orders)' : 'Live').padEnd(35)}║`);
  console.log('╚══════════════════════════════════════════════════╝\n');

  // ── Setup ──
  info('Checking health...');
  const health = await fetchJSON(`${API_URL}/health`);
  if (health.status !== 'ok') throw new Error('Server not healthy');
  agentWallet = health.walletAddress || '';
  pass(`Server OK, wallet: ${agentWallet.slice(0, 16)}...`);

  // ── Find token ──
  if (DENOM_ARG) {
    baseDenom = DENOM_ARG.split('=')[1];
  } else {
    info('Finding a token to seed...');
    const balRes = await fetchJSON(`${API_URL}/api/balances?address=${agentWallet}`);
    const tokens = (balRes.balances || [])
      .filter(b => b.denom !== 'utestcore' && b.denom.includes(agentWallet))
      .sort((a, b) => parseInt(b.amount) - parseInt(a.amount)); // Pick highest balance

    if (tokens.length === 0) throw new Error('No agent-owned tokens found. Create a token first.');
    baseDenom = tokens[0].denom;
  }
  tokenName = baseDenom.split('-')[0].toUpperCase();
  pass(`Token: ${tokenName} (${baseDenom.slice(0, 40)}...)`);

  // ── Check balances ──
  const balRes = await fetchJSON(`${API_URL}/api/balances?address=${agentWallet}`);
  const balances = {};
  (balRes.balances || []).forEach(b => { balances[b.denom] = parseInt(b.amount); });

  const coreBal = (balances[QUOTE_DENOM] || 0) / 1e6;
  const tokenBal = (balances[baseDenom] || 0) / 1e6;
  pass(`Balances: ${coreBal.toFixed(2)} TX, ${tokenBal.toLocaleString()} ${tokenName}`);

  // Estimate gas cost: ~0.125 TX per order
  const totalOrders = NUM_BUYS + NUM_SELLS;
  const estGas = totalOrders * 0.15;
  if (coreBal < estGas) {
    warn(`Low TX balance! Need ~${estGas.toFixed(2)} TX for gas, have ${coreBal.toFixed(2)} TX`);
  }

  // ── Check existing orderbook ──
  const ob = await fetchJSON(
    `${API_URL}/api/orderbook?baseDenom=${encodeURIComponent(baseDenom)}&quoteDenom=${encodeURIComponent(QUOTE_DENOM)}`
  );
  info(`Current orderbook: ${ob.bids.length} bids, ${ob.asks.length} asks`);

  // ── Generate orders ──
  const buyLevels = generatePriceLevels(BASE_PRICE, NUM_BUYS, 'buy');
  const sellLevels = generatePriceLevels(BASE_PRICE, NUM_SELLS, 'sell');

  console.log('\n  📊 Planned orders:\n');
  console.log('  BUY SIDE (bids):');
  buyLevels.forEach((l, i) => {
    console.log(`    ${String(i + 1).padStart(3)}. ${l.quantity.toString().padStart(4)} ${tokenName} @ ${l.price.toFixed(6)} TX`);
  });
  console.log('\n  SELL SIDE (asks):');
  sellLevels.forEach((l, i) => {
    console.log(`    ${String(i + 1).padStart(3)}. ${l.quantity.toString().padStart(4)} ${tokenName} @ ${l.price.toFixed(6)} TX`);
  });

  if (DRY_RUN) {
    console.log('\n  🏁 Dry run complete — no orders placed.\n');
    return;
  }

  // ── Place orders ──
  console.log(`\n  🚀 Placing ${totalOrders} orders...\n`);

  let placed = 0, errors = 0;

  // Place buy orders
  for (let i = 0; i < buyLevels.length; i++) {
    const level = buyLevels[i];
    const label = `BUY  ${String(i + 1).padStart(2)}/${NUM_BUYS}`;
    process.stdout.write(`  ${label}: ${level.quantity} ${tokenName} @ ${level.price.toFixed(6)} TX ... `);

    const orderBody = JSON.stringify({
      baseDenom,
      quoteDenom: QUOTE_DENOM,
      side: 'buy',
      price: formatPrice(level.price),
      quantity: toRaw(level.quantity),
    });

    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      if (attempt > 0) {
        process.stdout.write(`  ↻ Retry ${attempt}... `);
        await sleep(8000);
      }
      try {
        const result = await fetchJSON(`${API_URL}/api/dex/place-order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: orderBody,
        });
        if (result.success) {
          console.log(`✅ ${result.orderId || ''}`);
          placedOrders.push({ side: 'buy', orderId: result.orderId, ...level });
          placed++;
          ok = true;
        } else {
          console.log(`⚠️  ${result.error || 'unknown error'}`);
          if (!result.error?.includes('sequence')) break; // non-retryable
        }
      } catch (err) {
        console.log(`❌ ${err.message.slice(0, 80)}`);
        if (err.message.includes('Service Unavailable')) await sleep(10000);
      }
    }
    if (!ok) errors++;

    // Delay between orders — server needs time to process TX + free resources
    await sleep(15000);
  }

  // Place sell orders
  for (let i = 0; i < sellLevels.length; i++) {
    const level = sellLevels[i];
    const label = `SELL ${String(i + 1).padStart(2)}/${NUM_SELLS}`;
    process.stdout.write(`  ${label}: ${level.quantity} ${tokenName} @ ${level.price.toFixed(6)} TX ... `);

    const orderBody = JSON.stringify({
      baseDenom,
      quoteDenom: QUOTE_DENOM,
      side: 'sell',
      price: formatPrice(level.price),
      quantity: toRaw(level.quantity),
    });

    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      if (attempt > 0) {
        process.stdout.write(`  ↻ Retry ${attempt}... `);
        await sleep(8000);
      }
      try {
        const result = await fetchJSON(`${API_URL}/api/dex/place-order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: orderBody,
        });
        if (result.success) {
          console.log(`✅ ${result.orderId || ''}`);
          placedOrders.push({ side: 'sell', orderId: result.orderId, ...level });
          placed++;
          ok = true;
        } else {
          console.log(`⚠️  ${result.error || 'unknown error'}`);
          if (!result.error?.includes('sequence')) break;
        }
      } catch (err) {
        console.log(`❌ ${err.message.slice(0, 80)}`);
        if (err.message.includes('Service Unavailable')) await sleep(10000);
      }
    }
    if (!ok) errors++;

    await sleep(1500);
  }

  // ── Verify final orderbook ──
  console.log('\n  ⏳ Waiting for chain propagation...');
  await sleep(4000);

  const finalOb = await fetchJSON(
    `${API_URL}/api/orderbook?baseDenom=${encodeURIComponent(baseDenom)}&quoteDenom=${encodeURIComponent(QUOTE_DENOM)}`
  );

  // ── Summary ──
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║              SEED RESULTS                        ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  ✅ Placed:   ${String(placed).padEnd(35)}║`);
  console.log(`║  ❌ Errors:   ${String(errors).padEnd(35)}║`);
  console.log(`║  📊 Bids:     ${String(finalOb.bids.length).padEnd(35)}║`);
  console.log(`║  📊 Asks:     ${String(finalOb.asks.length).padEnd(35)}║`);
  console.log(`║  💰 Token:    ${tokenName.padEnd(35)}║`);
  console.log('╚══════════════════════════════════════════════════╝\n');

  if (placed > 0) {
    console.log('  📌 Token denom (for smoke tests):');
    console.log(`     --denom=${baseDenom}\n`);
  }

  process.exit(errors > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('\n💀 Fatal error:', err.message);
  process.exit(2);
});
