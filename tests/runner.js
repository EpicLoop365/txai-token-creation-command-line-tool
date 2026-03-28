#!/usr/bin/env node
/**
 * TXAI Smoke Test Runner — Unified test pipeline
 *
 * Runs all smoke test suites, collects results, and optionally sends
 * alerts on failure via the TXAI API's send-review endpoint (email)
 * or logs structured JSON for monitoring.
 *
 * Usage:
 *   node tests/runner.js [options]
 *
 * Options:
 *   --api <url>        API base URL (default: production)
 *   --site <url>       Frontend URL for asset tests
 *   --alert-email <e>  Send failure alerts to this email
 *   --telegram <id>    Send failure alerts to this Telegram chat ID
 *   --webhook <url>    POST failure alerts to this webhook URL
 *   --json             Output structured JSON results
 *   --quiet            Only output on failure
 *   --suite <name>     Run only a specific suite (general|airdrop|all)
 *
 * Environment variables:
 *   TELEGRAM_BOT_TOKEN   Bot token for Telegram alerts
 *   SMOKE_WEBHOOK_URL    Default webhook URL for alerts
 */

const { execSync, spawn } = require("child_process");
const path = require("path");

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}
function hasFlag(name) {
  return args.includes(name);
}

const API = getArg("--api") || "https://txai-token-creation-production.up.railway.app";
const SITE = getArg("--site") || "https://epicloop365.github.io/solomente-txai-studio";
const ALERT_EMAIL = getArg("--alert-email");
const TELEGRAM_CHAT = getArg("--telegram");
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const WEBHOOK_URL = getArg("--webhook") || process.env.SMOKE_WEBHOOK_URL || "";
const JSON_OUTPUT = hasFlag("--json");
const QUIET = hasFlag("--quiet");
const SUITE = getArg("--suite") || "all";

const TESTS_DIR = path.resolve(__dirname);

// ─── SUITE DEFINITIONS ──────────────────────────────────────────────────────

const suites = [
  {
    name: "general",
    file: "smoke-test.js",
    args: [API, SITE],
    description: "API + Frontend smoke tests (59 tests)",
  },
  {
    name: "airdrop",
    file: "smoke-airdrop.js",
    args: [API],
    description: "Smart Airdrop + DAO pipeline (27 tests)",
  },
];

// ─── RUNNER ─────────────────────────────────────────────────────────────────

function runSuite(suite) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const scriptPath = path.join(TESTS_DIR, suite.file);

    let stdout = "";
    let stderr = "";

    const proc = spawn("node", [scriptPath, ...suite.args], {
      timeout: 120000,
      env: { ...process.env },
    });

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
      if (!QUIET && !JSON_OUTPUT) process.stdout.write(data);
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      const durationMs = Date.now() - startTime;

      // Parse pass/fail counts from output
      const passMatch = stdout.match(/PASSED:\s+(\d+)/);
      const failMatch = stdout.match(/FAILED:\s+(\d+)/);
      const totalMatch = stdout.match(/TOTAL:\s+(\d+)/);
      const passed = passMatch ? parseInt(passMatch[1]) : 0;
      const failed = failMatch ? parseInt(failMatch[1]) : 0;
      const total = totalMatch ? parseInt(totalMatch[1]) : passed + failed;

      // Extract failure details
      const failures = [];
      const failRegex = /✗\s+(.+?)\s+—\s+(.+)/g;
      let match;
      while ((match = failRegex.exec(stdout)) !== null) {
        failures.push({ test: match[1], error: match[2] });
      }

      resolve({
        suite: suite.name,
        description: suite.description,
        passed,
        failed,
        total,
        durationMs,
        exitCode: code,
        failures,
        output: stdout,
        stderr: stderr.trim() || undefined,
      });
    });

    proc.on("error", (err) => {
      resolve({
        suite: suite.name,
        description: suite.description,
        passed: 0,
        failed: 1,
        total: 1,
        durationMs: Date.now() - startTime,
        exitCode: 1,
        failures: [{ test: "suite_launch", error: err.message }],
        output: "",
        stderr: err.message,
      });
    });
  });
}

// ─── ALERT ──────────────────────────────────────────────────────────────────

function buildAlertMessage(results) {
  const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
  const totalPassed = results.reduce((sum, r) => sum + r.passed, 0);
  const totalTests = results.reduce((sum, r) => sum + r.total, 0);

  const failureDetails = results
    .filter((r) => r.failed > 0)
    .map((r) => {
      const lines = [`${r.suite}: ${r.failed}/${r.total} failed`];
      r.failures.forEach((f) => lines.push(`  - ${f.test}: ${f.error}`));
      return lines.join("\n");
    })
    .join("\n\n");

  return {
    totalFailed,
    totalPassed,
    totalTests,
    text: `TXAI Smoke Test Alert\n\n${totalFailed} FAILURES / ${totalTests} tests\nPassed: ${totalPassed} | Failed: ${totalFailed}\nTime: ${new Date().toISOString()}\n\n${failureDetails}`,
    json: { totalPassed, totalFailed, totalTests, timestamp: new Date().toISOString(), failures: results.flatMap(r => r.failures.map(f => ({ suite: r.suite, ...f }))) },
  };
}

async function sendAlert(results) {
  const { totalFailed, text, json } = buildAlertMessage(results);
  if (totalFailed === 0) {
    if (!QUIET) console.log("\n  All tests passed — no alert needed.");
    return;
  }

  const promises = [];

  // Telegram alert
  if (TELEGRAM_CHAT && TELEGRAM_TOKEN) {
    promises.push(
      fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text, parse_mode: "HTML" }),
        signal: AbortSignal.timeout(15000),
      })
        .then((r) => r.ok ? console.log(`\n  Telegram alert sent to chat ${TELEGRAM_CHAT}`) : console.error(`\n  Telegram alert failed: ${r.status}`))
        .catch((err) => console.error(`\n  Telegram alert error: ${err.message}`))
    );
  }

  // Webhook alert
  if (WEBHOOK_URL) {
    promises.push(
      fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "txai-smoke-tests", ...json }),
        signal: AbortSignal.timeout(15000),
      })
        .then((r) => r.ok ? console.log(`\n  Webhook alert sent to ${WEBHOOK_URL}`) : console.error(`\n  Webhook alert failed: ${r.status}`))
        .catch((err) => console.error(`\n  Webhook alert error: ${err.message}`))
    );
  }

  // Email alert (via TXAI API)
  if (ALERT_EMAIL) {
    promises.push(
      fetch(`${API}/api/smart-airdrop/send-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resolved: { recipients: [], totalAmount: "0", invalidAddresses: [], duplicatesRemoved: 0, sourceBreakdown: {} },
          delivery: { type: "email", target: ALERT_EMAIL },
          tokenDenom: "SMOKE-TEST-ALERT",
          _alert: true,
          _alertBody: text,
        }),
        signal: AbortSignal.timeout(15000),
      })
        .then((r) => r.ok ? console.log(`\n  Email alert sent to ${ALERT_EMAIL}`) : console.error(`\n  Email alert failed: ${r.status}`))
        .catch((err) => console.error(`\n  Email alert error: ${err.message}`))
    );
  }

  if (promises.length === 0) {
    console.log("\n  No alert channels configured. Use --telegram, --webhook, or --alert-email.");
  }

  await Promise.allSettled(promises);
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

(async () => {
  const startTime = Date.now();
  const suitesToRun = SUITE === "all" ? suites : suites.filter((s) => s.name === SUITE);

  if (suitesToRun.length === 0) {
    console.error(`Unknown suite: ${SUITE}. Available: general, airdrop, all`);
    process.exit(1);
  }

  if (!QUIET && !JSON_OUTPUT) {
    console.log("╔═══════════════════════════════════════════╗");
    console.log("║      TXAI Smoke Test Runner               ║");
    console.log("╚═══════════════════════════════════════════╝");
    console.log(`  API:    ${API}`);
    console.log(`  Suites: ${suitesToRun.map((s) => s.name).join(", ")}`);
    console.log(`  Time:   ${new Date().toISOString()}\n`);
  }

  const results = [];

  for (const suite of suitesToRun) {
    if (!QUIET && !JSON_OUTPUT) {
      console.log(`\n━━━ Running: ${suite.name} (${suite.description}) ━━━\n`);
    }
    const result = await runSuite(suite);
    results.push(result);
  }

  const totalDuration = Date.now() - startTime;
  const totalPassed = results.reduce((sum, r) => sum + r.passed, 0);
  const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
  const totalTests = results.reduce((sum, r) => sum + r.total, 0);

  // ─── Output ────────────────────────────────────────────────────────────

  if (JSON_OUTPUT) {
    const output = {
      timestamp: new Date().toISOString(),
      api: API,
      durationMs: totalDuration,
      totalPassed,
      totalFailed,
      totalTests,
      allPassed: totalFailed === 0,
      suites: results.map((r) => ({
        name: r.suite,
        passed: r.passed,
        failed: r.failed,
        total: r.total,
        durationMs: r.durationMs,
        failures: r.failures,
      })),
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log("\n╔═══════════════════════════════════════════╗");
    console.log("║         COMBINED RESULTS                  ║");
    console.log("╠═══════════════════════════════════════════╣");

    for (const r of results) {
      const status = r.failed === 0 ? "PASS" : "FAIL";
      console.log(`║  ${r.suite.padEnd(12)} ${String(r.passed).padStart(3)}/${String(r.total).padStart(3)}  ${status.padEnd(4)}  ${r.durationMs}ms`);
    }

    console.log("╠═══════════════════════════════════════════╣");
    console.log(`║  TOTAL       ${String(totalPassed).padStart(3)}/${String(totalTests).padStart(3)}  ${totalFailed === 0 ? "PASS" : "FAIL"}  ${totalDuration}ms`);
    console.log("╚═══════════════════════════════════════════╝");

    if (totalFailed > 0) {
      console.log("\n  FAILURES:");
      for (const r of results) {
        for (const f of r.failures) {
          console.log(`    [${r.suite}] ${f.test} — ${f.error}`);
        }
      }
    }
  }

  // Send alert if configured
  await sendAlert(results);

  process.exit(totalFailed > 0 ? 1 : 0);
})();
