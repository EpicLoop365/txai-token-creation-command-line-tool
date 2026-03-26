/**
 * TXAI NFT Smoke Test
 *
 * Tests the NFT collection and minting lifecycle:
 * - Issue NFT class
 * - Mint NFT
 * - Query class info
 * - Query NFTs by class
 * - Query NFTs by owner
 *
 * Usage:
 *   node tests/nft-smoke.test.js
 *   node tests/nft-smoke.test.js --quick    (query-only, no create/mint)
 *   node tests/nft-smoke.test.js --verbose
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
let createdClassId = '';

// ─── Tests ──────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   TXAI NFT Smoke Test                    ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Mode:   ${(QUICK ? 'Quick (query only)' : 'Full (create + mint)').padEnd(31)}║`);
  console.log('╚══════════════════════════════════════════╝\n');

  // ── Health check ──
  await test('Health check', async () => {
    const data = await fetchJSON(`${API_URL}/health`);
    assert(data.status === 'ok', `Server not healthy: ${data.status}`);
    agentWallet = data.walletAddress || '';
    assert(agentWallet, 'No wallet address');
    pass(`Wallet: ${agentWallet.slice(0, 12)}...`);
  });

  // ── NFT endpoints exist ──
  await test('NFT class endpoint exists', async () => {
    const res = await fetch(`${API_URL}/api/nft/class?classId=nonexistent`);
    // Should return 404, not 500 or connection error
    assert(res.status === 404 || res.status === 200, `Unexpected status: ${res.status}`);
    pass('Endpoint responding');
  });

  await test('NFT nfts endpoint exists', async () => {
    const res = await fetch(`${API_URL}/api/nft/nfts?owner=${agentWallet}`);
    assert(res.ok, `Unexpected status: ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data.nfts), 'Expected nfts array');
    pass(`Agent owns ${data.nfts.length} NFTs`);
  });

  // ── Query NFTs by owner from chain directly ──
  await test('Chain REST: query NFTs by owner', async () => {
    const res = await fetch(`${COREUM_REST}/cosmos/nft/v1beta1/nfts?owner=${encodeURIComponent(agentWallet)}`);
    if (res.ok) {
      const data = await res.json();
      const nfts = data.nfts || [];
      pass(`Chain shows ${nfts.length} NFTs for agent`);
    } else {
      // NFT module might not return for empty, that's ok
      pass(`Chain NFT query responded (${res.status})`);
    }
  });

  if (QUICK) {
    console.log('\n  ⏭️  Skipping create/mint tests (--quick mode)\n');
    skipped = 4;
    printSummary();
    return;
  }

  console.log('\n  ⏳ Starting create/mint tests...\n');

  // ── Issue NFT Class ──
  const testSymbol = 'SMOKE' + Date.now().toString(36).slice(-3).toUpperCase();
  await test(`Issue NFT class: ${testSymbol}`, async () => {
    const data = await fetchJSON(`${API_URL}/api/nft/issue-class`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: testSymbol,
        name: `Smoke Test Collection ${testSymbol}`,
        description: 'Automated smoke test NFT collection',
        features: { burning: true, freezing: true },
        royaltyRate: '0.05',
      }),
    });
    assert(data.classId, `No classId returned: ${JSON.stringify(data).slice(0, 200)}`);
    assert(data.success !== false, `Issue failed: ${data.error || 'unknown'}`);
    createdClassId = data.classId;
    pass(`Class: ${createdClassId}`);
    if (data.txHash) pass(`TX: ${data.txHash.slice(0, 16)}...`);
  });

  // ── Verify class on chain ──
  await test('Verify class on chain', async () => {
    assert(createdClassId, 'No classId to verify');
    await sleep(3000);

    const data = await fetchJSON(`${API_URL}/api/nft/class?classId=${encodeURIComponent(createdClassId)}`);
    assert(data.class, 'Class not found');
    const cls = data.class;
    pass(`Name: ${cls.name}, Symbol: ${cls.symbol}`);
    if (cls.features) pass(`Features: ${cls.features.join(', ')}`);
  });

  // ── Mint NFT ──
  await test('Mint NFT into collection', async () => {
    assert(createdClassId, 'No classId for minting');
    const nftId = 'smoke-nft-001';

    const data = await fetchJSON(`${API_URL}/api/nft/mint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        classId: createdClassId,
        id: nftId,
        uri: 'https://example.com/metadata/smoke-nft-001.json',
      }),
    });
    assert(data.success !== false, `Mint failed: ${data.error || JSON.stringify(data).slice(0, 200)}`);
    pass(`Minted ${nftId}`);
    if (data.txHash) pass(`TX: ${data.txHash.slice(0, 16)}...`);
  });

  // ── Verify NFT on chain ──
  await test('Verify NFT on chain', async () => {
    assert(createdClassId, 'No classId');
    await sleep(3000);

    const data = await fetchJSON(`${API_URL}/api/nft/nfts?classId=${encodeURIComponent(createdClassId)}`);
    assert(Array.isArray(data.nfts), 'Expected nfts array');
    assert(data.nfts.length > 0, 'No NFTs found in class');
    pass(`Found ${data.nfts.length} NFT(s) in class`);
    const nft = data.nfts[0];
    pass(`NFT ID: ${nft.id || nft.nft_id || '?'}`);
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
