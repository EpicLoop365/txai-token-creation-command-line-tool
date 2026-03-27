/**
 * Faucet Bot — Super Faucet Agent
 *
 * Keeps the agent wallet topped up by maintaining a pool of reserve wallets
 * that rotate through the testnet faucet. Sweeps accumulated TX to the
 * main agent wallet periodically.
 *
 * Run standalone:  npx ts-node src/faucet-bot.ts
 * Or import startFaucetBot() into the server (only enable on ONE instance).
 *
 * Environment:
 *   AGENT_MNEMONIC     — main agent wallet mnemonic
 *   TX_NETWORK         — "testnet" (default)
 *   FAUCET_BOT         — set to "true" to enable when imported into server
 *   FAUCET_POOL_SIZE   — number of reserve wallets (default: 8)
 *   FAUCET_TARGET_TX   — target balance in TX (default: 100000)
 *   FAUCET_INTERVAL_MS — ms between faucet rounds (default: 300000 = 5 min)
 */

import {
  createWallet,
  importWallet,
  requestFaucet,
  TxClient,
  NetworkName,
} from "./tx-sdk";
import * as fs from "fs";
import * as path from "path";

// ─── Config ──────────────────────────────────────────────────────────────────

const POOL_SIZE = parseInt(process.env.FAUCET_POOL_SIZE || "8", 10);
const TARGET_BALANCE = parseInt(process.env.FAUCET_TARGET_TX || "100000", 10) * 1e6; // in utestcore
const SWEEP_THRESHOLD = 50 * 1e6; // sweep when reserve has > 50 TX
const FAUCET_INTERVAL = parseInt(process.env.FAUCET_INTERVAL_MS || "300000", 10); // 5 min default
const POOL_FILE = path.join(__dirname, "..", "data", "faucet-pool.json");
const QUOTE_DENOM = "utestcore";

interface ReserveWallet {
  address: string;
  mnemonic: string;
  lastFaucet: number; // timestamp of last faucet request
  totalSwept: number; // total TX swept to agent
}

interface PoolState {
  wallets: ReserveWallet[];
  agentAddress: string;
  totalSwept: number;
  createdAt: string;
}

// ─── Pool Management ─────────────────────────────────────────────────────────

function loadPool(): PoolState | null {
  try {
    if (fs.existsSync(POOL_FILE)) {
      return JSON.parse(fs.readFileSync(POOL_FILE, "utf-8"));
    }
  } catch { /* ignore */ }
  return null;
}

function savePool(pool: PoolState): void {
  const dir = path.dirname(POOL_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(POOL_FILE, JSON.stringify(pool, null, 2));
}

async function initPool(networkName: NetworkName, agentAddress: string): Promise<PoolState> {
  let pool = loadPool();

  // If pool exists and matches agent, reuse it
  if (pool && pool.agentAddress === agentAddress && pool.wallets.length > 0) {
    console.log(`[faucet-bot] Loaded existing pool: ${pool.wallets.length} wallets`);
    // Top up pool if needed
    while (pool.wallets.length < POOL_SIZE) {
      const w = await createWallet(networkName);
      pool.wallets.push({
        address: w.address,
        mnemonic: w.mnemonic,
        lastFaucet: 0,
        totalSwept: 0,
      });
      console.log(`[faucet-bot] Added reserve wallet #${pool.wallets.length}: ${w.address.slice(0, 20)}...`);
    }
    savePool(pool);
    return pool;
  }

  // Create fresh pool
  console.log(`[faucet-bot] Creating ${POOL_SIZE} reserve wallets...`);
  const wallets: ReserveWallet[] = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const w = await createWallet(networkName);
    wallets.push({
      address: w.address,
      mnemonic: w.mnemonic,
      lastFaucet: 0,
      totalSwept: 0,
    });
    console.log(`[faucet-bot] Reserve #${i + 1}: ${w.address.slice(0, 20)}...`);
  }

  pool = {
    wallets,
    agentAddress,
    totalSwept: 0,
    createdAt: new Date().toISOString(),
  };
  savePool(pool);
  return pool;
}

// ─── Faucet Round ────────────────────────────────────────────────────────────

async function runFaucetRound(pool: PoolState, networkName: NetworkName): Promise<void> {
  const now = Date.now();
  // Minimum 60s between faucet attempts per wallet to avoid hammering
  const MIN_INTERVAL = 60_000;
  let requested = 0;
  let failed = 0;

  for (const wallet of pool.wallets) {
    if (now - wallet.lastFaucet < MIN_INTERVAL) continue;

    try {
      const result = await requestFaucet(wallet.address, networkName);
      wallet.lastFaucet = now;
      requested++;
      console.log(`[faucet-bot] ✅ Faucet → ${wallet.address.slice(0, 16)}...`);
      // Small delay between requests to be nice
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      failed++;
      const msg = (err as Error).message.slice(0, 60);
      // Don't spam logs for rate limits
      if (!msg.includes("rate") && !msg.includes("limit")) {
        console.log(`[faucet-bot] ⚠️ Faucet ${wallet.address.slice(0, 12)}...: ${msg}`);
      }
      wallet.lastFaucet = now; // mark as attempted even on failure
    }
  }

  if (requested > 0) {
    console.log(`[faucet-bot] Round complete: ${requested} funded, ${failed} rate-limited`);
  }
  savePool(pool);
}

// ─── Sweep to Agent ──────────────────────────────────────────────────────────

async function sweepToAgent(pool: PoolState, networkName: NetworkName): Promise<void> {
  let totalSwept = 0;

  for (const wallet of pool.wallets) {
    try {
      const w = await importWallet(wallet.mnemonic, networkName);
      const client = await TxClient.connectWithWallet(w, { isolatedMutex: true });

      const bals = await client.getBalances(wallet.address);
      const txBal = bals.find(b => b.denom === QUOTE_DENOM);
      const balance = txBal ? parseInt(txBal.amount) : 0;

      // Keep 5 TX for gas, sweep the rest
      const sweepAmount = balance - 5_000_000;
      if (sweepAmount > SWEEP_THRESHOLD) {
        await client.signAndBroadcastMsg({
          typeUrl: "/cosmos.bank.v1beta1.MsgSend",
          value: {
            fromAddress: wallet.address,
            toAddress: pool.agentAddress,
            amount: [{ denom: QUOTE_DENOM, amount: sweepAmount.toString() }],
          },
        }, 200000);

        const swept = sweepAmount / 1e6;
        totalSwept += swept;
        wallet.totalSwept += swept;
        console.log(`[faucet-bot] 💰 Swept ${swept.toFixed(1)} TX from ${wallet.address.slice(0, 12)}... → agent`);
        await new Promise(r => setTimeout(r, 2000));
      }

      client.disconnect();
    } catch (err) {
      // Non-fatal — wallet may not exist on chain yet or have no balance
    }
  }

  if (totalSwept > 0) {
    pool.totalSwept += totalSwept;
    console.log(`[faucet-bot] 💰 Total swept this round: ${totalSwept.toFixed(1)} TX (lifetime: ${pool.totalSwept.toFixed(0)} TX)`);
    savePool(pool);
  }
}

// ─── Main Loop ───────────────────────────────────────────────────────────────

async function checkAgentBalance(networkName: NetworkName, agentMnemonic: string): Promise<number> {
  try {
    const wallet = await importWallet(agentMnemonic, networkName);
    const client = await TxClient.connectWithWallet(wallet, { isolatedMutex: true });
    const bals = await client.getBalances(client.address);
    const txBal = bals.find(b => b.denom === QUOTE_DENOM);
    const balance = txBal ? parseInt(txBal.amount) : 0;
    client.disconnect();
    return balance;
  } catch {
    return 0;
  }
}

export async function startFaucetBot(): Promise<void> {
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  const agentMnemonic = process.env.AGENT_MNEMONIC;

  if (!agentMnemonic) {
    console.warn("[faucet-bot] No AGENT_MNEMONIC — bot disabled");
    return;
  }

  console.log("[faucet-bot] Starting super faucet agent...");
  console.log(`[faucet-bot] Pool size: ${POOL_SIZE}, Target: ${TARGET_BALANCE / 1e6} TX, Interval: ${FAUCET_INTERVAL / 1000}s`);

  // Get agent address
  const agentWallet = await importWallet(agentMnemonic, networkName);
  const agentClient = await TxClient.connectWithWallet(agentWallet, { isolatedMutex: true });
  const agentAddress = agentClient.address;
  agentClient.disconnect();

  console.log(`[faucet-bot] Agent wallet: ${agentAddress}`);

  // Initialize pool
  const pool = await initPool(networkName, agentAddress);

  // Also request faucet for the agent wallet itself
  try {
    await requestFaucet(agentAddress, networkName);
    console.log("[faucet-bot] ✅ Faucet → agent wallet (direct)");
  } catch { /* rate limited, ok */ }

  // Main loop
  const runCycle = async () => {
    try {
      // Check agent balance
      const balance = await checkAgentBalance(networkName, agentMnemonic);
      const balTx = balance / 1e6;
      console.log(`[faucet-bot] Agent balance: ${balTx.toFixed(1)} TX (target: ${TARGET_BALANCE / 1e6})`);

      if (balance >= TARGET_BALANCE) {
        console.log("[faucet-bot] ✅ Target reached! Sleeping until next check.");
        return;
      }

      // Request faucet for all reserve wallets
      await runFaucetRound(pool, networkName);

      // Sweep accumulated TX to agent
      await sweepToAgent(pool, networkName);

      // Also try direct faucet for agent
      try {
        await requestFaucet(agentAddress, networkName);
      } catch { /* rate limited */ }

    } catch (err) {
      console.error("[faucet-bot] Cycle error:", (err as Error).message);
    }
  };

  // Run first cycle immediately
  await runCycle();

  // Then run on interval
  setInterval(runCycle, FAUCET_INTERVAL);
  console.log(`[faucet-bot] Running every ${FAUCET_INTERVAL / 1000}s`);
}

// ─── Standalone Entry Point ──────────────────────────────────────────────────

if (require.main === module) {
  // Running as standalone script
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
  startFaucetBot().catch(err => {
    console.error("[faucet-bot] Fatal:", err);
    process.exit(1);
  });
}
