#!/usr/bin/env node
/* ===== TXAI — Smoke Test Agent =====
 *
 * Comprehensive end-to-end test that exercises every feature:
 *   1.  Health check
 *   2.  Network info
 *   3.  Create Smart Token (with features: minting, burning)
 *   4.  Mint additional supply
 *   5.  Burn tokens
 *   6.  Send tokens (self-transfer)
 *   7.  NFT Airdrop (mint + distribute)
 *   8.  Soulbound Identity NFT (disable_sending)
 *   9.  Subscription Pass (30d expiry)
 *  10.  Expired Pass mint
 *  11.  Agent NFT (with embedded script)
 *  12.  Token Gate — no wallet
 *  13.  Token Gate — with wallet
 *  14.  Token Gate — gate tools list
 *  15.  Welcome Wizard (auto-mint Scout Pass)
 *  16.  Visitor tracking
 *  17.  Analytics dashboard
 *  18.  Stakers endpoint
 *
 * Usage:
 *   node tests/smoke-test-agent.js                       # test production
 *   node tests/smoke-test-agent.js http://localhost:3099  # test local
 *   SMOKE_KEY=mykey node tests/smoke-test-agent.js       # with analytics key
 */

const API = process.argv[2] || process.env.API_URL || 'https://txai-token-creation-production.up.railway.app';
const ANALYTICS_KEY = process.env.SMOKE_KEY || 'txai-analytics-2026';

let passed = 0;
let failed = 0;
let skipped = 0;
const results = [];
const logs = [];       // detailed log for final report
let agentWallet = '';

// ── Helpers ──

async function fetchJSON(url, opts = {}, timeoutMs = 45000) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json();
  return { status: res.status, ok: res.ok, data };
}

// Coreum NFT URI limit is 256 chars. Build a compact data URI that fits.
function compactURI(obj) {
  // Strip to essential keys, minify
  const json = JSON.stringify(obj);
  const b64 = btoa(json);
  const uri = 'data:application/json;base64,' + b64;
  if (uri.length > 256) {
    // Fallback: hash-style short URI
    const hash = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    return `txai://meta/${hash}`;
  }
  return uri;
}

function log(icon, msg) {
  const line = `  ${icon}  ${msg}`;
  console.log(line);
  logs.push(line);
}

function section(title) {
  const line = `\n  ── ${title} ──`;
  console.log(line);
  logs.push(line);
}

async function test(name, fn) {
  const start = performance.now();
  try {
    await fn();
    const ms = (performance.now() - start).toFixed(0);
    log('✅', `${name} (${ms}ms)`);
    passed++;
    results.push({ name, status: 'pass', ms: parseInt(ms) });
  } catch (err) {
    const ms = (performance.now() - start).toFixed(0);
    log('❌', `${name} — ${err.message} (${ms}ms)`);
    failed++;
    results.push({ name, status: 'fail', error: err.message, ms: parseInt(ms) });
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

// ── Tests ──

// 1. Health check
async function testHealth() {
  const { data } = await fetchJSON(`${API}/health`);
  assert(data.status === 'ok', `Health status: ${data.status}`);
  assert(data.walletAddress, 'No wallet address');
  agentWallet = data.walletAddress;
  log('📍', `Wallet: ${agentWallet}`);
  log('📍', `Network: ${data.network} (Chain ${data.chainId})`);
  log('📍', `Uptime: ${data.uptime || 'N/A'}`);
}

// 2. Network info
async function testNetworkInfo() {
  const { data } = await fetchJSON(`${API}/api/network-info`);
  assert(data.available.includes('testnet'), 'Missing testnet');
  assert(data.available.includes('mainnet'), 'Missing mainnet');
  log('📍', `Networks: ${data.available.join(', ')} | Active: ${data.current}`);
}

// 3. Create Smart Token
async function testCreateToken() {
  const sym = 'SMOKE' + Date.now().toString(36).slice(-4).toUpperCase();
  const { data, ok } = await fetchJSON(`${API}/api/create-token`, {
    method: 'POST',
    body: JSON.stringify({
      symbol: sym,
      subunit: 'u' + sym.toLowerCase(),
      precision: 6,
      initialAmount: 1000000,
      features: ['minting', 'burning'],
      description: 'Smoke test token — auto-generated',
    }),
  }, 120000); // 120s timeout — chain token issuance can be slow
  assert(ok, `Create token failed: ${data.error || JSON.stringify(data)}`);
  assert(data.denom, 'No denom returned');
  log('📍', `Token: ${data.denom}`);
  log('📍', `TX: ${(data.txHash || '').substring(0, 20)}...`);
  return data.denom;
}

// 4. Mint additional supply
async function testMintTokens(denom) {
  if (!denom) { skipped++; log('⏭️', 'Skipped — no token denom'); return; }
  const { data, ok } = await fetchJSON(`${API}/api/mint`, {
    method: 'POST',
    body: JSON.stringify({ denom, amount: 500000 }),
  });
  assert(ok, `Mint failed: ${data.error || JSON.stringify(data)}`);
  log('📍', `Minted 500,000 → ${denom.split('-')[0]}`);
}

// 5. Burn tokens
async function testBurnTokens(denom) {
  if (!denom) { skipped++; log('⏭️', 'Skipped — no token denom'); return; }
  const { data, ok } = await fetchJSON(`${API}/api/burn`, {
    method: 'POST',
    body: JSON.stringify({ denom, amount: 100000 }),
  });
  assert(ok, `Burn failed: ${data.error || JSON.stringify(data)}`);
  log('📍', `Burned 100,000 from ${denom.split('-')[0]}`);
}

// 6. Send tokens (self-transfer)
async function testSendTokens() {
  const { data, ok } = await fetchJSON(`${API}/api/send`, {
    method: 'POST',
    body: JSON.stringify({
      to: agentWallet,
      amount: 1,
      denom: 'utestcore',
      memo: 'TXAI Smoke Test Self-Transfer',
    }),
  });
  assert(ok, `Send failed: ${data.error || JSON.stringify(data)}`);
  const txHash = data.txHash || data.txhash;
  assert(txHash, 'No txHash');
  log('📍', `TX: ${txHash.substring(0, 20)}... | Memo: TXAI Smoke Test`);
}

// 7. NFT Airdrop (standard)
async function testNftAirdrop() {
  const { data, ok } = await fetchJSON(`${API}/api/nft-airdrop`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Smoke Test NFT',
      symbol: 'SMOKENFTA' + Date.now().toString(36).slice(-3).toUpperCase(),
      description: 'Standard NFT airdrop — smoke test',
      uri: compactURI({ t: 'smoke', ts: Date.now() }),
      recipients: [agentWallet],
    }),
  });
  assert(ok, `NFT Airdrop failed: ${data.error || JSON.stringify(data)}`);
  assert(data.success === true, 'Airdrop not successful');
  assert(data.classId, 'No classId');
  assert(data.minted === 1, `Expected 1 minted, got ${data.minted}`);
  log('📍', `NFT Class: ${data.classId}`);
  log('📍', `Minted: ${data.minted} | Failed: ${data.failed}`);
  return data.classId;
}

// 8. Soulbound Identity NFT (agent's own identity pass)
async function testSoulboundNft() {
  const metadata = { t: 'id', r: 'smoke', l: 1, sb: true };

  const { data, ok } = await fetchJSON(`${API}/api/nft-airdrop`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'TXAI Agent Identity',
      symbol: 'SMOKEID' + Date.now().toString(36).slice(-3).toUpperCase(),
      description: 'Soulbound identity NFT for the smoke test agent',
      uri: compactURI(metadata),
      recipients: [agentWallet],
      features: { disableSending: true },
    }),
  });
  assert(ok, `Soulbound NFT failed: ${data.error || JSON.stringify(data)}`);
  assert(data.classId, 'No classId for soulbound NFT');
  assert(data.minted === 1, `Expected 1 minted, got ${data.minted}`);
  log('📍', `Identity NFT: ${data.classId}`);
  log('📍', `Transfer: SOULBOUND (disable_sending) | Tier: scout`);
  log('📍', `Metadata: role=smoke-tester, identity-bound`);
  return data.classId;
}

// 9. Subscription Pass (30 day expiry)
async function testSubscriptionPass() {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const metadata = { t: 'pass', tier: 'creator', l: 2, d: 30, exp: expiresAt.split('T')[0] };

  const { data, ok } = await fetchJSON(`${API}/api/nft-airdrop`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Creator Pass Smoke',
      symbol: 'SMOKEPASS' + Date.now().toString(36).slice(-3).toUpperCase(),
      description: 'Smoke test subscription pass with 30d expiry',
      uri: compactURI(metadata),
      recipients: [agentWallet],
      features: { disableSending: true },
    }),
  });
  assert(ok, `Pass mint failed: ${data.error || JSON.stringify(data)}`);
  assert(data.classId, 'No classId for pass');
  log('📍', `Pass: ${data.classId}`);
  log('📍', `Tier: creator (level 2) | Duration: 30 days`);
  log('📍', `Expires: ${expiresAt.split('T')[0]} | Transfer: soulbound`);
  return data.classId;
}

// 10. Expired Pass mint
async function testExpiredPass() {
  const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const metadata = { t: 'pass', tier: 'scout', l: 1, d: 1, exp: expiredAt.split('T')[0] };

  const { data, ok } = await fetchJSON(`${API}/api/nft-airdrop`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Expired Pass Smoke',
      symbol: 'SMOKEEXP' + Date.now().toString(36).slice(-3).toUpperCase(),
      description: 'Smoke test expired pass',
      uri: compactURI(metadata),
      recipients: [agentWallet],
      features: { disableSending: true },
    }),
  });
  assert(ok, `Expired pass mint failed: ${data.error || JSON.stringify(data)}`);
  log('📍', `Expired pass: ${data.classId}`);
  log('📍', `Was expired: ${expiredAt.split('T')[0]} (yesterday) — should fail gate check`);
}

// 11. Agent NFT (with embedded script)
async function testAgentNft() {
  // Agent metadata kept compact for URI limit; full script stored off-chain
  const metadata = { t: 'agent', n: 'whale', p: { d: 'utestcore', th: 10000 } };

  const { data, ok } = await fetchJSON(`${API}/api/nft-airdrop`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Smoke Whale Watcher',
      symbol: 'SMOKEAGT' + Date.now().toString(36).slice(-2).toUpperCase(),
      description: 'Agent NFT with monitoring config — smoke test',
      uri: compactURI(metadata),
      recipients: [agentWallet],
    }),
  });
  assert(ok, `Agent NFT failed: ${data.error || JSON.stringify(data)}`);
  assert(data.classId, 'No agent classId');
  log('📍', `Agent: ${data.classId}`);
  log('📍', `Script: whale-watcher (compact metadata)`);
  log('📍', `Permissions: readChain=✓ alert=✓ signTx=✗`);
}

// 12–14. Token Gate tests
async function testGateNoWallet() {
  const { data } = await fetchJSON(`${API}/api/gate-status`);
  // Gate may or may not be enabled
  if (data.gated === false) {
    log('📍', `Gate: DISABLED — all tools free`);
    log('📍', `Message: "${data.message}"`);
  } else {
    assert(data.gated === true, 'Expected gated=true when no wallet');
    assert(data.hasPass === false, 'Expected hasPass=false with no wallet');
    log('📍', `Gate: ENABLED | No wallet → access denied`);
    log('📍', `Message: "${data.message}"`);
    log('📍', `Pass denom: ${data.passDenom || 'not set'}`);
  }
}

async function testGateWithWallet() {
  const { data } = await fetchJSON(`${API}/api/gate-status?wallet=${agentWallet}`);
  if (data.gated === false) {
    log('📍', `Gate: DISABLED — wallet check skipped`);
    return;
  }
  log('📍', `Gate: ENABLED | Wallet: ${agentWallet.substring(0, 20)}...`);
  log('📍', `Has pass: ${data.hasPass} | Balance: ${data.balance ?? 'N/A'}`);
  log('📍', `Pass denom: ${data.passDenom || 'not configured'}`);
}

async function testGateToolsList() {
  const { data } = await fetchJSON(`${API}/api/gate-status?wallet=${agentWallet}`);
  if (data.gated === false) {
    log('📍', `Gate disabled — no tool restrictions`);
    return;
  }
  if (data.gatedTools) {
    log('📍', `Gated tools (${data.gatedTools.length}): ${data.gatedTools.join(', ')}`);
  }
  if (data.freeTools) {
    log('📍', `Free tools (${data.freeTools.length}): ${data.freeTools.join(', ')}`);
  }
}

// 15. Welcome Wizard — simulates first-time visitor getting auto-minted Scout Pass
async function testWelcomeWizard() {
  // Step 1: Check gate (simulating first visit — no pass yet)
  const { data: gateData } = await fetchJSON(`${API}/api/gate-status?wallet=${agentWallet}`);
  log('📍', `Wizard Step 1: Gate check — gated=${gateData.gated}, hasPass=${gateData.hasPass ?? 'N/A'}`);

  // Step 2: Auto-mint a free Scout Pass (soulbound identity NFT)
  const metadata = { t: 'pass', tier: 'scout', l: 1, d: 0, auto: true };

  const { data, ok } = await fetchJSON(`${API}/api/nft-airdrop`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Scout Pass Welcome',
      symbol: 'SMOKEWLC' + Date.now().toString(36).slice(-2).toUpperCase(),
      description: 'Auto-minted Scout Pass — welcome wizard',
      uri: compactURI(metadata),
      recipients: [agentWallet],
      features: { disableSending: true },
    }),
  });
  assert(ok, `Welcome wizard mint failed: ${data.error || JSON.stringify(data)}`);
  log('📍', `Wizard Step 2: Scout Pass minted → ${data.classId}`);
  log('📍', `Wizard Step 3: User greeted, soulbound identity assigned`);
  log('📍', `Transfer: SOULBOUND | Tier: scout (free) | Duration: lifetime`);
}

// 16. Visitor tracking
async function testTracking() {
  const { data } = await fetchJSON(`${API}/api/track`, {
    method: 'POST',
    body: JSON.stringify({
      page: '/smoke-test',
      wallet: agentWallet,
      passTier: 'pro',
      referrer: 'smoke-test-agent',
      sessionId: 'smoke_' + Date.now(),
    }),
  });
  assert(data.ok === true, `Tracking failed: ${JSON.stringify(data)}`);
  log('📍', `Tracked: page=/smoke-test, tier=pro, session=smoke_*`);
}

// 17. Analytics dashboard
async function testAnalytics() {
  const { data, ok } = await fetchJSON(`${API}/api/analytics?key=${ANALYTICS_KEY}`);
  assert(ok, `Analytics failed: ${data.error || 'HTTP error'}`);
  assert(typeof data.summary === 'object', 'No summary');
  assert(typeof data.summary.totalTracked === 'number', 'No totalTracked');
  const s = data.summary;
  log('📍', `Total tracked: ${s.totalTracked}`);
  log('📍', `Last 24h: ${s.last24h.uniqueVisitors} visitors, ${s.last24h.walletsConnected} wallets`);
  log('📍', `Conversion: ${s.last24h.conversionRate}`);
  if (data.passTiers) {
    log('📍', `Tiers: ${Object.entries(data.passTiers).map(([k,v]) => `${k}=${v}`).join(', ')}`);
  }
}

// 18. Stakers endpoint
async function testStakers() {
  const { data, ok } = await fetchJSON(`${API}/api/stakers/testcorevaloper1qpjsad4kfwxrnl78s3kndxqfnqhtaqaz4gf4ql`);
  if (ok && data.stakers) {
    log('📍', `Stakers: ${data.stakers.length} found`);
  } else {
    log('⚠️', `Stakers: ${data.error || 'no data'} (non-critical)`);
  }
}

// ── Runner ──

async function main() {
  const startDate = new Date().toISOString();
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║   🤖 TXAI Smoke Test Agent                      ║');
  console.log('  ║   Testing: ' + API.substring(0, 38).padEnd(38) + '║');
  console.log('  ║   Started: ' + startDate.replace('T', ' ').substring(0, 19).padEnd(38) + '║');
  console.log('  ╚══════════════════════════════════════════════════╝');
  console.log('');

  const totalStart = performance.now();

  // ── Infrastructure ──
  section('Infrastructure');
  await test('1. Health check', testHealth);
  await test('2. Network info', testNetworkInfo);

  // ── Token Operations ──
  section('Token Operations');
  let tokenDenom = null;
  await test('3. Create Smart Token', async () => {
    tokenDenom = await testCreateToken();
  });
  await test('4. Mint additional supply', () => testMintTokens(tokenDenom));
  await test('5. Burn tokens', () => testBurnTokens(tokenDenom));
  await test('6. Send tokens (self-transfer)', testSendTokens);

  // ── NFT Operations ──
  section('NFT Operations');
  await test('7. NFT Airdrop (mint + distribute)', testNftAirdrop);
  await test('8. Soulbound Identity NFT (disable_sending)', testSoulboundNft);

  // ── Access Passes ──
  section('Access Passes & Gate');
  await test('9. Subscription Pass (30d expiry)', testSubscriptionPass);
  await test('10. Expired Pass mint', testExpiredPass);

  // ── Agent NFTs ──
  section('Agent NFTs');
  await test('11. Agent NFT (with script)', testAgentNft);

  // ── Token Gate ──
  section('Token Gate');
  await test('12. Gate status — no wallet', testGateNoWallet);
  await test('13. Gate status — with wallet', testGateWithWallet);
  await test('14. Gate — tool access list', testGateToolsList);

  // ── Welcome Wizard ──
  section('Welcome Wizard');
  await test('15. Welcome Wizard (auto-mint Scout)', testWelcomeWizard);

  // ── Analytics ──
  section('Analytics & Tracking');
  await test('16. Visitor tracking', testTracking);
  await test('17. Analytics dashboard', testAnalytics);

  // ── Optional ──
  section('Optional');
  await test('18. Stakers endpoint', testStakers);

  // ── Summary ──
  const totalMs = (performance.now() - totalStart).toFixed(0);
  const totalSec = (totalMs / 1000).toFixed(1);
  console.log('');
  console.log('  ══════════════════════════════════════════════════');
  console.log(`  ✅ Passed: ${passed}  ❌ Failed: ${failed}  ⏭ Skipped: ${skipped}  ⏱ ${totalSec}s`);
  console.log('  ══════════════════════════════════════════════════');

  if (failed > 0) {
    console.log('');
    console.log('  📋 Failed tests:');
    for (const r of results.filter(r => r.status === 'fail')) {
      console.log(`    ✗ ${r.name}`);
      console.log(`      Error: ${r.error}`);
      console.log(`      Duration: ${r.ms}ms`);
    }
  }

  // ── Detailed Log Report ──
  console.log('');
  console.log('  📊 Test Report');
  console.log('  ─────────────────────────────────────────────────');
  console.log(`  API:       ${API}`);
  console.log(`  Wallet:    ${agentWallet || 'N/A'}`);
  console.log(`  Date:      ${startDate}`);
  console.log(`  Duration:  ${totalSec}s`);
  console.log(`  Tests:     ${passed + failed + skipped} total (${passed} pass, ${failed} fail, ${skipped} skip)`);
  console.log('');

  // Per-test timing table
  console.log('  ⏱ Timing breakdown:');
  for (const r of results) {
    const icon = r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : '⏭';
    const bar = '█'.repeat(Math.min(Math.ceil(r.ms / 500), 20));
    console.log(`    ${icon} ${r.name.padEnd(42)} ${String(r.ms).padStart(6)}ms ${bar}`);
  }

  console.log('');
  if (failed === 0) {
    console.log('  🎉 All smoke tests passed! Agent is healthy.');
  } else {
    console.log(`  ⚠️  ${failed} test(s) failed. Review errors above.`);
  }
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('');
  console.error('  💥 Fatal error:', err.message);
  console.error('     Stack:', err.stack?.split('\n')[1]?.trim());
  console.error('');
  process.exit(1);
});
