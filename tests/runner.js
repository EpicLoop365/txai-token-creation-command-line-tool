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
 *   --json             Output structured JSON results
 *   --quiet            Only output on failure
 *   --suite <name>     Run only a specific suite (general|airdrop|all)
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

async function sendAlert(results) {
  if (!ALERT_EMAIL) return;

  const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
  if (totalFailed === 0) return; // No alert needed

  const totalPassed = results.reduce((sum, r) => sum + r.passed, 0);
  const totalTests = results.reduce((sum, r) => sum + r.total, 0);

  const failureDetails = results
    .filter((r) => r.failed > 0)
    .map((r) => {
      const lines = [`Suite: ${r.suite} (${r.failed}/${r.total} failed)`];
      r.failures.forEach((f) => lines.push(`  - ${f.test}: ${f.error}`));
      return lines.join("\n");
    })
    .join("\n\n");

  try {
    const res = await fetch(`${API}/api/smart-airdrop/send-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resolved: {
          recipients: [],
          totalAmount: "0",
          invalidAddresses: [],
          duplicatesRemoved: 0,
          sourceBreakdown: {},
        },
        delivery: { type: "email", target: ALERT_EMAIL },
        tokenDenom: "SMOKE-TEST-ALERT",
        // Hijack the review system to send an alert
        _alert: true,
        _alertBody: `TXAI Smoke Test Alert\n\nResult: ${totalFailed} FAILURES out of ${totalTests} tests\nPassed: ${totalPassed} | Failed: ${totalFailed}\nTime: ${new Date().toISOString()}\n\n${failureDetails}`,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (res.ok) {
      console.log(`\n  Alert sent to ${ALERT_EMAIL}`);
    }
  } catch (err) {
    console.error(`\n  Failed to send alert: ${err.message}`);
  }
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
