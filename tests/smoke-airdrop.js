/**
 * TXAI Smart Airdrop — End-to-End Smoke Test
 *
 * Tests the full airdrop pipeline: parse → resolve → dry-run → schedule → history
 * Does NOT execute a real airdrop (no tokens sent).
 *
 * Usage: node tests/smoke-airdrop.js [api-url]
 */

const API = process.argv[2] || "https://txai-token-creation-production.up.railway.app";

let passed = 0, failed = 0;
const results = [];

async function test(name, fn) {
  try {
    const result = await fn();
    passed++;
    results.push({ name, status: "PASS", detail: result });
    console.log(`  ✓ ${name}${result ? " — " + result : ""}`);
  } catch (e) {
    failed++;
    results.push({ name, status: "FAIL", error: e.message });
    console.log(`  ✗ ${name} — ${e.message}`);
  }
}

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  return { status: res.status, data: await res.json() };
}

async function get(path) {
  const res = await fetch(`${API}${path}`, {
    signal: AbortSignal.timeout(15000),
  });
  return { status: res.status, data: await res.json() };
}

console.log("=========================================");
console.log("  TXAI Smart Airdrop Smoke Test");
console.log("=========================================");
console.log(`  API: ${API}`);
console.log(`  Time: ${new Date().toISOString()}\n`);

(async () => {
  // ─── 1. NLP Parse ─────────────────────────────────────────────────
  console.log("── NLP Prompt Parsing ──\n");

  let parsedIntent = null;

  await test("Parse: stakers prompt", async () => {
    const { status, data } = await post("/api/smart-airdrop/parse", {
      prompt: "Airdrop 100 MYTOKEN to all stakers of testcorevaloper1abc123",
    });
    if (status !== 200) throw new Error(`Status ${status}: ${JSON.stringify(data)}`);
    if (!data.intent) throw new Error("No intent returned");
    parsedIntent = data.intent;
    return `sources: ${data.intent.sources?.length || 0}, token: ${data.intent.tokenDenom || "?"}`;
  });

  await test("Parse: CSV prompt", async () => {
    const { status, data } = await post("/api/smart-airdrop/parse", {
      prompt: "Airdrop 50 GEMS to testcore1aaa, testcore1bbb, testcore1ccc",
    });
    if (status !== 200) throw new Error(`Status ${status}`);
    if (!data.intent) throw new Error("No intent returned");
    return `sources: ${data.intent.sources?.length || 0}`;
  });

  await test("Parse: exclusion prompt", async () => {
    const { status, data } = await post("/api/smart-airdrop/parse", {
      prompt: "Airdrop 10 TOKEN to all holders of utestcore EXCEPT testcore1exchange",
    });
    if (status !== 200) throw new Error(`Status ${status}`);
    if (!data.intent) throw new Error("No intent returned");
    const hasExclude = data.intent.excludeAddresses && data.intent.excludeAddresses.length > 0;
    return `has exclusions: ${hasExclude}`;
  });

  await test("Parse: NFT holders prompt", async () => {
    const { status, data } = await post("/api/smart-airdrop/parse", {
      prompt: "Airdrop 25 REWARD to all holders of NFT class scout-pass-abc",
    });
    if (status !== 200) throw new Error(`Status ${status}`);
    if (!data.intent) throw new Error("No intent returned");
    return `sources: ${JSON.stringify(data.intent.sources?.map(s => s.type))}`;
  });

  // ─── 2. Address Resolution ────────────────────────────────────────
  console.log("\n── Address Resolution ──\n");

  let resolvedData = null;

  await test("Resolve: direct addresses", async () => {
    const { status, data } = await post("/api/smart-airdrop/resolve", {
      intent: {
        sources: [{ type: "addresses", list: ["testcore1aaa111", "testcore1bbb222", "testcore1ccc333"] }],
        combineMode: "union",
        tokenDenom: "utestcore",
        amountPerRecipient: "1000000",
        amountMode: "fixed",
      },
      sender: "testcore1sender000",
      network: "testnet",
    });
    if (status !== 200) throw new Error(`Status ${status}: ${JSON.stringify(data)}`);
    resolvedData = data;
    const r = data.resolved;
    return `recipients: ${r?.recipients?.length || 0}, invalid: ${r?.invalidAddresses?.length || 0}, dupes removed: ${r?.duplicatesRemoved || 0}`;
  });

  await test("Resolve: CSV source", async () => {
    const { status, data } = await post("/api/smart-airdrop/resolve", {
      intent: {
        sources: [{ type: "csv", raw: "testcore1addr1\ntestcore1addr2\ntestcore1addr3\ninvalid_address\ntestcore1addr1" }],
        combineMode: "union",
        tokenDenom: "utestcore",
        amountPerRecipient: "500",
        amountMode: "fixed",
      },
      sender: "testcore1sender000",
      network: "testnet",
    });
    if (status !== 200) throw new Error(`Status ${status}`);
    const r = data.resolved;
    return `recipients: ${r?.recipients?.length || 0}, invalid: ${r?.invalidAddresses?.length || 0}, dupes: ${r?.duplicatesRemoved || 0}`;
  });

  await test("Resolve: returns preflight result", async () => {
    if (!resolvedData?.preflight) throw new Error("No preflight in resolve response");
    const pf = resolvedData.preflight;
    return `canProceed: ${pf.canProceed}, checks: ${pf.checks?.length || 0}`;
  });

  // ─── 3. Dry Run ──────────────────────────────────────────────────
  console.log("\n── Dry Run ──\n");

  await test("Dry run: small batch", async () => {
    const { status, data } = await post("/api/smart-airdrop/dry-run", {
      denom: "utestcore",
      recipients: [
        { address: "testcore1aaa111", amount: "1000" },
        { address: "testcore1bbb222", amount: "1000" },
        { address: "testcore1ccc333", amount: "1000" },
      ],
      sender: "testcore1sender000",
      network: "testnet",
    });
    if (status !== 200) throw new Error(`Status ${status}: ${JSON.stringify(data)}`);
    return `batches: ${data.batches?.length || 0}, totalGas: ${data.totalGasEstimate || "?"}, canExecute: ${data.canExecute}`;
  });

  await test("Dry run: large batch (250 recipients)", async () => {
    const recipients = [];
    for (let i = 0; i < 250; i++) {
      recipients.push({ address: `testcore1addr${String(i).padStart(4, "0")}`, amount: "100" });
    }
    const { status, data } = await post("/api/smart-airdrop/dry-run", {
      denom: "utestcore",
      recipients,
      sender: "testcore1sender000",
      network: "testnet",
    });
    if (status !== 200) throw new Error(`Status ${status}`);
    return `batches: ${data.batches?.length || 0}, totalRecipients: ${data.totalRecipients || 0}`;
  });

  // ─── 4. Vesting Preview ───────────────────────────────────────────
  console.log("\n── Vesting ──\n");

  await test("Vesting preview: cliff", async () => {
    const { status, data } = await post("/api/smart-airdrop/vesting-preview", {
      recipients: [
        { address: "testcore1aaa", amount: "1000000" },
        { address: "testcore1bbb", amount: "500000" },
      ],
      schedule: {
        type: "cliff",
        cliffDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    if (status !== 200) throw new Error(`Status ${status}: ${JSON.stringify(data)}`);
    return `steps: ${data.steps?.length || 0}`;
  });

  await test("Vesting preview: linear", async () => {
    const now = Date.now();
    const { status, data } = await post("/api/smart-airdrop/vesting-preview", {
      recipients: [
        { address: "testcore1aaa", amount: "1200000" },
      ],
      schedule: {
        type: "linear",
        startDate: new Date(now).toISOString(),
        endDate: new Date(now + 365 * 24 * 60 * 60 * 1000).toISOString(),
        intervalMonths: 3,
      },
    });
    if (status !== 200) throw new Error(`Status ${status}`);
    return `steps: ${data.steps?.length || 0}`;
  });

  await test("Vesting preview: milestones", async () => {
    const now = Date.now();
    const { status, data } = await post("/api/smart-airdrop/vesting-preview", {
      recipients: [
        { address: "testcore1aaa", amount: "1000000" },
      ],
      schedule: {
        type: "milestone",
        milestones: [
          { date: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(), percentage: 25 },
          { date: new Date(now + 90 * 24 * 60 * 60 * 1000).toISOString(), percentage: 50 },
          { date: new Date(now + 180 * 24 * 60 * 60 * 1000).toISOString(), percentage: 100 },
        ],
      },
    });
    if (status !== 200) throw new Error(`Status ${status}`);
    return `steps: ${data.steps?.length || 0}`;
  });

  // ─── 5. Scheduling ────────────────────────────────────────────────
  console.log("\n── Scheduling ──\n");

  let scheduleId = null;

  await test("Schedule: create time-based", async () => {
    const { status, data } = await post("/api/smart-airdrop/schedule", {
      denom: "utestcore",
      recipients: [
        { address: "testcore1aaa", amount: "1000" },
        { address: "testcore1bbb", amount: "1000" },
      ],
      sender: "testcore1sender000",
      network: "testnet",
      scheduleType: "time",
      executeAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (status !== 200) throw new Error(`Status ${status}: ${JSON.stringify(data)}`);
    scheduleId = data.scheduled?.id || data.id;
    return `id: ${scheduleId}, status: ${data.scheduled?.status || data.status}`;
  });

  await test("Schedule: list schedules", async () => {
    const { status, data } = await get("/api/smart-airdrop/schedules");
    if (status !== 200) throw new Error(`Status ${status}`);
    const count = Array.isArray(data) ? data.length : data.schedules?.length || 0;
    return `count: ${count}`;
  });

  await test("Schedule: cancel", async () => {
    if (!scheduleId) throw new Error("No schedule ID from previous test");
    const { status, data } = await post("/api/smart-airdrop/schedule/cancel", {
      id: scheduleId,
    });
    if (status !== 200) throw new Error(`Status ${status}: ${JSON.stringify(data)}`);
    return `cancelled: ${data.success !== false}`;
  });

  // ─── 6. History ───────────────────────────────────────────────────
  console.log("\n── History ──\n");

  await test("History: list", async () => {
    const { status, data } = await get("/api/smart-airdrop/history");
    if (status !== 200) throw new Error(`Status ${status}`);
    const count = Array.isArray(data) ? data.length : data.history?.length || 0;
    return `records: ${count}`;
  });

  // ─── 7. Delivery (format check only) ─────────────────────────────
  console.log("\n── Delivery ──\n");

  await test("Send review: email format", async () => {
    const { status, data } = await post("/api/smart-airdrop/send-review", {
      resolved: {
        recipients: [
          { address: "testcore1aaa", amount: "1000" },
          { address: "testcore1bbb", amount: "2000" },
        ],
        totalAmount: "3000",
        invalidAddresses: [],
        duplicatesRemoved: 0,
        sourceBreakdown: { addresses: 2 },
      },
      delivery: { type: "email", target: "test@example.com" },
      tokenDenom: "utestcore",
    });
    if (status !== 200) throw new Error(`Status ${status}: ${JSON.stringify(data)}`);
    return `ok: ${data.ok}`;
  });

  // ─── 8. DAO Voting ────────────────────────────────────────────────
  console.log("\n── DAO Voting ──\n");

  let proposalId = null;

  await test("DAO: create proposal", async () => {
    const { status, data } = await post("/api/dao/create-proposal", {
      title: "Smoke Test Proposal",
      description: "Testing the DAO voting system",
      options: ["Yes", "No", "Abstain"],
      gateType: "any_wallet",
      votingPower: "equal",
      startTime: new Date().toISOString(),
      endTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      creator: "testcore1creator000",
      network: "testnet",
    });
    if (status !== 200) throw new Error(`Status ${status}: ${JSON.stringify(data)}`);
    proposalId = data.proposal?.id || data.id;
    return `id: ${proposalId}`;
  });

  await test("DAO: list proposals", async () => {
    const { status, data } = await get("/api/dao/proposals?network=testnet");
    if (status !== 200) throw new Error(`Status ${status}`);
    const count = Array.isArray(data) ? data.length : data.proposals?.length || 0;
    return `count: ${count}`;
  });

  await test("DAO: cast vote", async () => {
    if (!proposalId) throw new Error("No proposal ID");
    const { status, data } = await post("/api/dao/vote", {
      proposalId,
      voter: "testcore1voter001",
      option: 0,
      network: "testnet",
    });
    if (status !== 200) throw new Error(`Status ${status}: ${JSON.stringify(data)}`);
    return `success: ${data.success !== false}`;
  });

  await test("DAO: get results", async () => {
    if (!proposalId) throw new Error("No proposal ID");
    const { status, data } = await get(`/api/dao/results/${proposalId}`);
    if (status !== 200) throw new Error(`Status ${status}`);
    const r = data.results || data;
    return `voters: ${r.totalVoters || 0}, winner: ${r.winningOption || "?"}`;
  });

  await test("DAO: prevent double vote", async () => {
    if (!proposalId) throw new Error("No proposal ID");
    const { status, data } = await post("/api/dao/vote", {
      proposalId,
      voter: "testcore1voter001",
      option: 1,
      network: "testnet",
    });
    // Should fail with "already voted"
    if (data.success === true) throw new Error("Double vote was allowed!");
    return `blocked: ${data.error || data.message || "yes"}`;
  });

  await test("DAO: close proposal", async () => {
    if (!proposalId) throw new Error("No proposal ID");
    const { status, data } = await post(`/api/dao/close/${proposalId}`, {
      creator: "testcore1creator000",
    });
    if (status !== 200) throw new Error(`Status ${status}: ${JSON.stringify(data)}`);
    return `closed: ${data.success !== false}`;
  });

  // ─── 9. Feature Flags ───────────────────────────────────────────────
  console.log("\n── Feature Flags ──\n");

  await test("Flags: endpoint returns flags", async () => {
    const { status, data } = await get("/api/flags");
    if (status !== 200) throw new Error(`Status ${status}`);
    if (!data.flags || !Array.isArray(data.flags)) throw new Error("No flags array");
    return `flags: ${data.flags.length}, enabled: ${data.flags.filter(f => f.enabled).length}`;
  });

  await test("Flags: has categories", async () => {
    const { status, data } = await get("/api/flags");
    if (status !== 200) throw new Error(`Status ${status}`);
    const cats = Object.keys(data.byCategory || {});
    if (cats.length === 0) throw new Error("No categories");
    return `categories: ${cats.join(", ")}`;
  });

  await test("Flags: smart_airdrop is enabled", async () => {
    const { status, data } = await get("/api/flags");
    if (status !== 200) throw new Error(`Status ${status}`);
    const flag = data.flags.find(f => f.name === "smart_airdrop");
    if (!flag) throw new Error("smart_airdrop flag not found");
    if (!flag.enabled) throw new Error("smart_airdrop is disabled");
    return `enabled: true`;
  });

  await test("Flags: dao_voting is enabled", async () => {
    const { status, data } = await get("/api/flags");
    if (status !== 200) throw new Error(`Status ${status}`);
    const flag = data.flags.find(f => f.name === "dao_voting");
    if (!flag) throw new Error("dao_voting flag not found");
    if (!flag.enabled) throw new Error("dao_voting is disabled");
    return `enabled: true`;
  });

  // ─── Summary ──────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════");
  console.log("  SMART AIRDROP + DAO SMOKE RESULTS");
  console.log("═══════════════════════════════════════");
  console.log(`  PASSED:  ${passed}`);
  console.log(`  FAILED:  ${failed}`);
  console.log(`  TOTAL:   ${passed + failed}`);
  console.log("═══════════════════════════════════════\n");

  if (failed > 0) {
    console.log("FAILURES:");
    results.filter(r => r.status === "FAIL").forEach(r => {
      console.log(`  ✗ ${r.name} — ${r.error}`);
    });
    console.log();
  }

  process.exit(failed > 0 ? 1 : 0);
})();
