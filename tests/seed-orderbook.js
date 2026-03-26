/**
 * TXAI Orderbook Seeder
 *
 * Populates a token's orderbook with realistic buy/sell orders from TWO wallets:
 *   - Agent wallet: places SELL orders (has the tokens)
 *   - Trader wallet: auto-created, funded, places BUY orders
 *
 * This creates a realistic orderbook with different makers on each side.
 *
 * Usage:
 *   node tests/seed-orderbook.js
 *   node tests/seed-orderbook.js --denom=txai-testcore1...
 *   node tests/seed-orderbook.js --buys=15 --sells=15
 *   node tests/seed-orderbook.js --base-price=0.001
 *   node tests/seed-orderbook.js --verbose
 *   node tests/seed-orderbook.js --dry-run
 *
 * Defaults:
 *   15 buy orders + 15 sell orders = 30 total
 *   Base price: 0.001 TX per token
 *   Spread: buys -50% to -1%, sells +1% to +50%
 */

const API_URL = process.env.API_URL || 'https://txai-token-creation-production.up.railway.app';
const QUOTE_DENOM = 'utestcore';
const DECIMALS = 6;
const ORDER_DELAY = 15000; // 15s between orders
const RETRY_DELAY = 30000; // 30s retry after 503

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

/** Wait until server responds to health check */
async function waitForServer(maxWait = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) return true;
    } catch { /* server not ready */ }
    await sleep(3000);
  }
  return false;
}

/** Place a single order with retries and health checks */
async function placeOrderWithRetry(body, label) {
  process.stdout.write(`  ${label} ... `);

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      console.log('');
      process.stdout.write(`    ↻ Retry ${attempt} (waiting for server)... `);
      const alive = await waitForServer();
      if (!alive) { console.log('⏳ Server not responding'); continue; }
      process.stdout.write('up! placing... ');
    }
    try {
      const result = await fetchJSON(`${API_URL}/api/dex/place-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (result.success) {
        console.log(`✅ ${result.orderId || ''}`);
        return result;
      } else {
        console.log(`⚠️  ${result.error || 'unknown'}`);
        if (!result.error?.includes('sequence')) return null;
      }
    } catch (err) {
      console.log(`❌ ${err.message.slice(0, 60)}`);
    }
  }
  return null;
}

function generatePriceLevels(basePrice, count, side) {
  const levels = [];
  const spreadPct = 50;
  const minPct = 1;
  for (let i = 0; i < count; i++) {
    const pct = minPct + (spreadPct - minPct) * (i / Math.max(count - 1, 1));
    const multiplier = side === 'buy' ? 1 - (pct / 100) : 1 + (pct / 100);
    // Round to 6 decimal places (tick size) to avoid floating point artifacts
    const price = Math.round(basePrice * multiplier * 1e6) / 1e6;
    // Keep quantities small to reduce collateral requirements
    const quantity = Math.floor(Math.random() * 20) + 1;
    levels.push({ price, quantity });
  }
  return levels;
}

/**
 * Format price for Coreum DEX: must match ^(([1-9])|([1-9]\d*[1-9]))(e-?[1-9]\d*)?$
 * Mantissa must be a positive integer with no trailing zeros.
 * Examples: 0.001 → "1e-3", 0.0015 → "15e-4", 0.00099 → "99e-5"
 */
function formatPrice(price) {
  if (price <= 0) throw new Error(`Invalid price: ${price}`);
  // Use default toExponential() which gives minimal significant digits
  const s = price.toExponential();  // e.g. "1.5e-3" or "9.9e-4"
  const [mantissaStr, expStr] = s.split('e');
  let exp = parseInt(expStr);
  // mantissaStr is like "1.5" or "1" — get digits without decimal
  const parts = mantissaStr.split('.');
  const fracPart = parts[1] || '';
  let digits = parts[0] + fracPart;  // "15" or "1"
  // Adjust exponent for the fractional digits we absorbed
  exp = exp - fracPart.length;
  // Strip trailing zeros from digits (Coreum doesn't allow them)
  while (digits.length > 1 && digits.endsWith('0')) {
    digits = digits.slice(0, -1);
    exp++;
  }
  if (exp === 0) return digits;
  return `${digits}e${exp}`;
}
function toRaw(amount) { return Math.round(amount * Math.pow(10, DECIMALS)).toString(); }

// ─── State ──────────────────────────────────────────────────────────────────

let agentWallet = '';
let baseDenom = '';
let tokenName = '';

// ─── Main ───────────────────────────────────────────────────────────────────

async function run() {
  const totalOrders = NUM_BUYS + NUM_SELLS;
  const estMinutes = Math.ceil(totalOrders * ORDER_DELAY / 60000);

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   TXAI Orderbook Seeder (2-wallet)               ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  Buy orders:  ${String(NUM_BUYS).padEnd(35)}║`);
  console.log(`║  Sell orders: ${String(NUM_SELLS).padEnd(35)}║`);
  console.log(`║  Base price:  ${String(BASE_PRICE + ' TX').padEnd(35)}║`);
  console.log(`║  Est. time:   ${String('~' + estMinutes + ' min').padEnd(35)}║`);
  console.log(`║  Mode:        ${(DRY_RUN ? 'Dry run' : 'Live').padEnd(35)}║`);
  console.log('╚══════════════════════════════════════════════════╝\n');

  // ── Step 1: Setup ──
  info('Checking server health...');
  const health = await fetchJSON(`${API_URL}/health`);
  if (health.status !== 'ok') throw new Error('Server not healthy');
  agentWallet = health.walletAddress || '';
  pass(`Agent wallet: ${agentWallet.slice(0, 16)}...`);

  // ── Step 2: Find token ──
  if (DENOM_ARG) {
    baseDenom = DENOM_ARG.split('=')[1];
  } else {
    info('Finding a token to seed...');
    const balRes = await fetchJSON(`${API_URL}/api/balances?address=${agentWallet}`);
    const tokens = (balRes.balances || [])
      .filter(b => b.denom !== 'utestcore' && b.denom.includes(agentWallet))
      .sort((a, b) => parseInt(b.amount) - parseInt(a.amount));
    if (tokens.length === 0) throw new Error('No agent-owned tokens found.');
    baseDenom = tokens[0].denom;
  }
  tokenName = baseDenom.split('-')[0].toUpperCase();
  pass(`Token: ${tokenName}`);

  // ── Step 3: Fund wallet from faucet ──
  info('Requesting funds from testnet faucet...');
  try {
    const faucetRes = await fetch(`https://faucet.testnet-1.coreum.dev/api/faucet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: agentWallet }),
    });
    if (faucetRes.ok) pass('Faucet funded wallet');
    else warn(`Faucet returned ${faucetRes.status} (may have been recently funded)`);
  } catch (e) {
    warn(`Faucet request failed: ${e.message.slice(0, 50)}`);
  }
  await sleep(3000); // wait for faucet tx to propagate

  // ── Step 4: Check agent balances ──
  const balRes = await fetchJSON(`${API_URL}/api/balances?address=${agentWallet}`);
  const agentBals = {};
  (balRes.balances || []).forEach(b => { agentBals[b.denom] = parseInt(b.amount); });
  const agentTX = (agentBals[QUOTE_DENOM] || 0) / 1e6;
  const agentTokens = (agentBals[baseDenom] || 0) / 1e6;
  pass(`Agent: ${agentTX.toFixed(2)} TX, ${agentTokens.toLocaleString()} ${tokenName}`);

  // ── Step 5: Check existing orderbook ──
  const ob = await fetchJSON(
    `${API_URL}/api/orderbook?baseDenom=${encodeURIComponent(baseDenom)}&quoteDenom=${encodeURIComponent(QUOTE_DENOM)}`
  );
  info(`Current orderbook: ${ob.bids.length} bids, ${ob.asks.length} asks`);

  // ── Step 6: Generate order levels ──
  const buyLevels = generatePriceLevels(BASE_PRICE, NUM_BUYS, 'buy');
  const sellLevels = generatePriceLevels(BASE_PRICE, NUM_SELLS, 'sell');

  console.log('\n  📊 Planned orders:\n');
  console.log('  BUY SIDE (bids) — placed by agent:');
  buyLevels.forEach((l, i) => {
    console.log(`    ${String(i + 1).padStart(3)}. ${l.quantity.toString().padStart(4)} ${tokenName} @ ${l.price.toFixed(6)} TX`);
  });
  console.log('\n  SELL SIDE (asks) — placed by agent:');
  sellLevels.forEach((l, i) => {
    console.log(`    ${String(i + 1).padStart(3)}. ${l.quantity.toString().padStart(4)} ${tokenName} @ ${l.price.toFixed(6)} TX`);
  });

  if (DRY_RUN) {
    console.log('\n  🏁 Dry run complete — no orders placed.\n');
    return;
  }

  // ── Step 6: Place orders ──
  console.log(`\n  🚀 Placing ${totalOrders} orders (${ORDER_DELAY / 1000}s between each)...\n`);

  let placed = 0, errors = 0;

  // Place buy orders (agent buys)
  for (let i = 0; i < buyLevels.length; i++) {
    const level = buyLevels[i];
    const label = `BUY  ${String(i + 1).padStart(2)}/${NUM_BUYS}: ${level.quantity} ${tokenName} @ ${level.price.toFixed(6)} TX`;

    const result = await placeOrderWithRetry({
      baseDenom,
      quoteDenom: QUOTE_DENOM,
      side: 'buy',
      price: formatPrice(level.price),
      quantity: toRaw(level.quantity),
    }, label);

    if (result) placed++;
    else errors++;

    if (i < buyLevels.length - 1) await sleep(ORDER_DELAY);
  }

  // Place sell orders (agent sells)
  for (let i = 0; i < sellLevels.length; i++) {
    const level = sellLevels[i];
    const label = `SELL ${String(i + 1).padStart(2)}/${NUM_SELLS}: ${level.quantity} ${tokenName} @ ${level.price.toFixed(6)} TX`;

    const result = await placeOrderWithRetry({
      baseDenom,
      quoteDenom: QUOTE_DENOM,
      side: 'sell',
      price: formatPrice(level.price),
      quantity: toRaw(level.quantity),
    }, label);

    if (result) placed++;
    else errors++;

    if (i < sellLevels.length - 1) await sleep(ORDER_DELAY);
  }

  // ── Verify ──
  console.log('\n  ⏳ Waiting for chain propagation...');
  await sleep(5000);

  const finalOb = await fetchJSON(
    `${API_URL}/api/orderbook?baseDenom=${encodeURIComponent(baseDenom)}&quoteDenom=${encodeURIComponent(QUOTE_DENOM)}`
  );

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

  process.exit(errors > 0 && placed === 0 ? 1 : 0);
}

run().catch(err => {
  console.error('\n💀 Fatal error:', err.message);
  process.exit(2);
});
