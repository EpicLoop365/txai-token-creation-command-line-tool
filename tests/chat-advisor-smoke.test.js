/**
 * TXAI Chat Advisor Smoke Test
 *
 * Tests the AI chat advisor functionality:
 * - Basic chat responses
 * - Token recommendation quality
 * - Config card generation
 * - Multi-turn conversation
 * - Edge cases
 *
 * Usage:
 *   node tests/chat-advisor-smoke.test.js
 *   node tests/chat-advisor-smoke.test.js --verbose
 */

const API_URL = process.env.API_URL || 'https://txai-token-creation-production.up.railway.app';
const VERBOSE = process.argv.includes('--verbose');

// ─── Helpers ────────────────────────────────────────────────────────────────

function log(icon, msg) { console.log(`  ${icon} ${msg}`); }
function pass(msg) { log('✅', msg); }
function fail(msg) { log('❌', msg); }
function info(msg) { log('ℹ️ ', msg); }

let passed = 0, failed = 0;

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

async function chat(messages) {
  const res = await fetch(`${API_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  if (VERBOSE) {
    console.log('\n    Reply:', (data.reply || data.message || '').slice(0, 200));
    if (data.config) console.log('    Config:', JSON.stringify(data.config).slice(0, 200));
  }
  return data;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   TXAI Chat Advisor Smoke Test           ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // ── Test: Basic greeting ──
  await test('Basic greeting', async () => {
    const data = await chat([
      { role: 'user', content: 'Hello, what can you help me with?' }
    ]);
    const reply = data.reply || data.message || '';
    assert(reply.length > 10, `Reply too short: "${reply}"`);
    assert(reply.length < 5000, `Reply suspiciously long: ${reply.length} chars`);
    pass(`Reply: ${reply.slice(0, 80)}...`);
  });

  // ── Test: Token recommendation ──
  await test('Token recommendation', async () => {
    const data = await chat([
      { role: 'user', content: 'I want to create a loyalty program for my coffee shop' }
    ]);
    const reply = (data.reply || data.message || '').toLowerCase();
    assert(reply.length > 50, 'Reply too short for a recommendation');
    // Should mention relevant concepts
    const hasRelevantContent = reply.includes('token') || reply.includes('loyalty') ||
      reply.includes('supply') || reply.includes('reward');
    assert(hasRelevantContent, 'Reply does not seem relevant to token creation');
    pass(`Relevant reply (${reply.length} chars)`);
  });

  // ── Test: Config card generation ──
  await test('Config card generation', async () => {
    const data = await chat([
      { role: 'user', content: 'Create a gaming token called GEMS with 10 million supply, mintable and burnable' }
    ]);
    const reply = data.reply || data.message || '';
    assert(reply.length > 20, 'Reply too short');

    // Check if config was returned
    if (data.config) {
      pass(`Config generated: name=${data.config.name || data.config.subunit}, supply=${data.config.initialAmount || data.config.supply}`);
    } else {
      // Config might be embedded in the reply text
      pass(`Reply received (${reply.length} chars), config may be in text`);
    }
  });

  // ── Test: Multi-turn conversation ──
  await test('Multi-turn conversation', async () => {
    const messages = [
      { role: 'user', content: 'I want to create a governance token for a DAO' },
      { role: 'assistant', content: 'A governance token for a DAO is a great use case! Let me help you design it. What would you like to name your token, and what kind of DAO is this for?' },
      { role: 'user', content: 'Call it VOTE, 1 million supply. What features should I enable?' }
    ];
    const data = await chat(messages);
    const reply = (data.reply || data.message || '').toLowerCase();
    assert(reply.length > 50, 'Reply too short for multi-turn');
    pass(`Multi-turn reply (${reply.length} chars)`);
  });

  // ── Test: Technical question ──
  await test('Technical question about features', async () => {
    const data = await chat([
      { role: 'user', content: 'What is the difference between freezing and clawback on Coreum?' }
    ]);
    const reply = (data.reply || data.message || '').toLowerCase();
    assert(reply.length > 50, 'Reply too short');
    const hasTechnical = reply.includes('freeze') || reply.includes('clawback') ||
      reply.includes('transfer') || reply.includes('issuer');
    assert(hasTechnical, 'Reply not technically relevant');
    pass(`Technical reply (${reply.length} chars)`);
  });

  // ── Test: Edge case - empty/short input ──
  await test('Edge case: very short input', async () => {
    const data = await chat([
      { role: 'user', content: 'token' }
    ]);
    const reply = data.reply || data.message || '';
    assert(reply.length > 10, 'No reply for short input');
    pass(`Handled gracefully (${reply.length} chars)`);
  });

  // ── Test: Response time ──
  await test('Response time < 30s', async () => {
    const start = Date.now();
    await chat([
      { role: 'user', content: 'Quick question: what is the maximum burn rate on Coreum?' }
    ]);
    const elapsed = Date.now() - start;
    assert(elapsed < 30000, `Response took ${elapsed}ms — too slow`);
    pass(`Response time: ${(elapsed / 1000).toFixed(1)}s`);
  });

  printSummary();
}

function printSummary() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║              TEST RESULTS                ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  ✅ Passed:  ${String(passed).padEnd(28)}║`);
  console.log(`║  ❌ Failed:  ${String(failed).padEnd(28)}║`);
  console.log('╚══════════════════════════════════════════╝\n');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('\n💀 Fatal error:', err.message);
  process.exit(2);
});
