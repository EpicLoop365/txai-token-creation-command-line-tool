/**
 * DEX Live Demo — AI Agent Swarm Orchestrator
 *
 * Populates the orderbook for a USER'S token with realistic trading activity.
 * Uses the server's agent wallet (token issuer) to distribute tokens, then
 * 3 AI agent wallets trade it live:
 *
 *   - Agent Wallet: distributes tokens to sellers (already holds supply)
 *   - Market Maker A (MM-A): funded via faucet, places BUY limit orders
 *   - Market Maker B (MM-B): receives tokens from agent, places SELL limit orders
 *   - Taker Bot: receives tokens + TX, executes market-style fills
 *
 * The user watches their newly created token get a real orderbook with
 * live fills — demonstrating a full AI agent swarm on-chain.
 *
 * Emits SSE events for real-time UI updates.
 */

import {
  createWallet,
  importWallet,
  requestFaucet,
  placeOrder,
  cancelOrder,
  queryOrderbook,
  queryOrdersByCreator,
  getTokenInfo,
  setWhitelistedLimit,
  getDexModuleAddress,
  DexTimeInForce,
  TxClient,
  NetworkName,
  NETWORKS,
} from "./tx-sdk";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DemoConfig {
  baseDenom: string;         // The user's token denom
  agentMnemonic: string;     // Server's agent wallet (holds the tokens)
  networkName: NetworkName;
  onEvent: (event: string, data: Record<string, unknown>) => void;
  abortSignal?: AbortSignal;
  returnAddress?: string;    // If set, return leftover tokens here after demo
}

interface AgentWallet {
  name: string;
  role: string;
  address: string;
  mnemonic: string;
  client: TxClient | null;
  txBalance: number;    // utestcore
  tokenBalance: number; // base token (raw)
}

// ─── Constants ──────────────────────────────────────────────────────────────

const AGENT_FUND_AMOUNT = 150_000_000; // 150 TX in utestcore per sub-wallet
const MIN_AGENT_BALANCE = 500_000_000; // 500 TX — below this, try faucet refill
const ORDER_DELAY = 5000;             // 5s between orders (same wallet)
const INTERLEAVE_DELAY = 2000;        // 2s between different wallet orders
const PAINT_DELAY = 1500;             // 1.5s between orders during chart painting
const TOKEN_PRECISION = 6;
const QUOTE_DENOM = "utestcore";

// Token distribution: how many tokens to give each seller agent
export const SELLER_TOKEN_AMOUNT = 5000;  // 5000 tokens to MM-B
export const TAKER_TOKEN_AMOUNT = 2000;   // 2000 tokens to Taker
export const DEMO_TOKENS_NEEDED = SELLER_TOKEN_AMOUNT + TAKER_TOKEN_AMOUNT; // 7000

// Price config: 0.001 TX per token (1e-3)
const BASE_PRICE = 0.001;

// Chart painting: how many candles the agents paint
const PAINT_CANDLES = 100;

/**
 * Generate Coreum-compatible price string.
 * Must match: ^(([1-9])|([1-9]\d*[1-9]))(e-?[1-9]\d*)?$
 */
function formatPrice(price: number): string {
  if (price <= 0) throw new Error(`Invalid price: ${price}`);
  // Round to tick size (6 decimals) to avoid floating point artifacts
  price = Math.round(price * 1e6) / 1e6;
  const s = price.toExponential();
  const [mantissaStr, expStr] = s.split("e");
  let exp = parseInt(expStr);
  const parts = mantissaStr.split(".");
  const fracPart = parts[1] || "";
  let digits = parts[0] + fracPart;
  exp = exp - fracPart.length;
  while (digits.length > 1 && digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    exp++;
  }
  if (exp === 0) return digits;
  return `${digits}e${exp}`;
}

function toRaw(amount: number): string {
  return Math.round(amount * Math.pow(10, TOKEN_PRECISION)).toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Price Trajectory Generator ─────────────────────────────────────────────
// Creates a dramatic but semi-random price path for chart painting.
// Phases: accumulation → breakout → consolidation → second leap →
//         plateau → selloff → capitulation → recovery → settling

interface PricePhase {
  pct: number;       // fraction of total candles
  drift: number;     // directional bias (fraction of basePrice per candle)
  vol: number;       // volatility (fraction of basePrice)
  volMult: number;   // volume multiplier for trade sizing
  desc: string;      // phase description for UI
}

const PRICE_PHASES: PricePhase[] = [
  { pct: 0.14, drift: 0.006,  vol: 0.012, volMult: 0.6,  desc: "quiet accumulation" },
  { pct: 0.10, drift: 0.045,  vol: 0.025, volMult: 1.8,  desc: "breakout rally 🚀" },
  { pct: 0.11, drift: 0.002,  vol: 0.015, volMult: 0.8,  desc: "consolidation" },
  { pct: 0.08, drift: 0.04,   vol: 0.03,  volMult: 2.2,  desc: "second leap 📈" },
  { pct: 0.11, drift: 0.001,  vol: 0.01,  volMult: 0.6,  desc: "high plateau" },
  { pct: 0.10, drift: -0.055, vol: 0.04,  volMult: 2.5,  desc: "selloff 📉" },
  { pct: 0.10, drift: 0.003,  vol: 0.025, volMult: 1.0,  desc: "capitulation base" },
  { pct: 0.14, drift: 0.025,  vol: 0.018, volMult: 1.3,  desc: "recovery bounce" },
  { pct: 0.12, drift: 0.004,  vol: 0.01,  volMult: 0.7,  desc: "settling" },
];

function getPricePhase(candleIndex: number, totalCandles: number): PricePhase {
  let cum = 0;
  for (const phase of PRICE_PHASES) {
    cum += phase.pct;
    if (candleIndex / totalCandles < cum) return phase;
  }
  return PRICE_PHASES[PRICE_PHASES.length - 1];
}

function generatePriceTrajectory(basePrice: number, count: number): number[] {
  const prices: number[] = [];
  // Randomize starting point: 40-60% of base price
  let price = basePrice * (0.4 + Math.random() * 0.2);
  let idx = 0;

  for (const phase of PRICE_PHASES) {
    const phaseCount = Math.max(1, Math.round(count * phase.pct));
    // Add randomness to phase duration (+/- 20%)
    const jitter = Math.round(phaseCount * (Math.random() * 0.4 - 0.2));
    const actualCount = Math.max(1, phaseCount + jitter);

    for (let i = 0; i < actualCount && idx < count; i++) {
      // Drift with randomness: 60-140% of base drift
      const driftMult = 0.6 + Math.random() * 0.8;
      const drift = phase.drift * basePrice * driftMult;
      // Volatility noise
      const noise = (Math.random() - 0.5) * basePrice * phase.vol * 2;
      // Mean-reversion nudge toward expected level
      price = Math.max(price + drift + noise, basePrice * 0.08);
      // Round to 6 decimals (Coreum tick size)
      prices.push(Math.round(price * 1e6) / 1e6);
      idx++;
    }
  }

  // Fill remaining if rounding left some out
  while (prices.length < count) {
    const last = prices[prices.length - 1];
    const noise = (Math.random() - 0.5) * basePrice * 0.01;
    prices.push(Math.round((last + noise) * 1e6) / 1e6);
  }

  return prices.slice(0, count);
}

// ─── Demo Logic ─────────────────────────────────────────────────────────────

let demoRunning = false;
let demoStartedAt = 0;
const DEMO_MAX_DURATION = 10 * 60 * 1000; // 10 min safety timeout (chart painting needs time)

export function isDemoRunning(): boolean {
  // Auto-reset if stuck for longer than max duration
  if (demoRunning && Date.now() - demoStartedAt > DEMO_MAX_DURATION) {
    console.warn("[dex-demo] Demo stuck — auto-resetting lock after 5 min timeout");
    demoRunning = false;
  }
  return demoRunning;
}

export function resetDemoLock(): void {
  console.warn("[dex-demo] Manual demo lock reset");
  demoRunning = false;
}

export async function runDexDemo(config: DemoConfig): Promise<void> {
  if (demoRunning) throw new Error("Demo already in progress");
  demoRunning = true;
  demoStartedAt = Date.now();

  const { baseDenom, agentMnemonic, networkName, onEvent, abortSignal, returnAddress } = config;
  const tokenSymbol = baseDenom.split("-")[0].toUpperCase();

  const emit = (event: string, data: Record<string, unknown>) => {
    try { onEvent(event, data); } catch { /* ignore */ }
  };

  const agents: AgentWallet[] = [];
  const clients: TxClient[] = [];
  let agentClient: TxClient | null = null;

  try {
    emit("phase", { phase: "init", message: `Populating orderbook for ${tokenSymbol}...` });
    emit("token", { symbol: tokenSymbol, denom: baseDenom });

    // ── Phase 1: Connect Agent Wallet (token issuer) ──
    emit("phase", { phase: "agent", message: "Connecting issuer wallet..." });

    const agentWallet = await importWallet(agentMnemonic, networkName);
    agentClient = await TxClient.connectWithWallet(agentWallet, { isolatedMutex: true });
    clients.push(agentClient);

    // Check agent has the token
    const agentBals = await agentClient.getBalances(agentClient.address);
    const agentTokenBal = agentBals.find(b => b.denom === baseDenom);
    const agentTxBal = agentBals.find(b => b.denom === QUOTE_DENOM);
    const agentTokenAmount = agentTokenBal ? parseInt(agentTokenBal.amount) : 0;
    const agentTxAmount = agentTxBal ? parseInt(agentTxBal.amount) : 0;

    emit("balance", {
      agent: "Issuer (Agent)",
      address: agentClient.address,
      txBalance: (agentTxAmount / 1e6).toFixed(2) + " TX",
      tokenBalance: (agentTokenAmount / 1e6).toLocaleString() + ` ${tokenSymbol}`,
    });

    const neededTokens = (SELLER_TOKEN_AMOUNT + TAKER_TOKEN_AMOUNT) * 1e6;
    if (agentTokenAmount < neededTokens) {
      throw new Error(
        `Agent needs at least ${(neededTokens / 1e6).toLocaleString()} ${tokenSymbol} but only has ${(agentTokenAmount / 1e6).toLocaleString()}`
      );
    }

    // ── Phase 2: Create 3 Trading Wallets ──
    emit("phase", { phase: "wallets", message: "Creating 3 AI trading agents..." });

    const walletDefs = [
      { name: "Market Maker A", role: "BUYER" },
      { name: "Market Maker B", role: "SELLER" },
      { name: "Taker Bot", role: "MARKET TAKER" },
    ];

    for (const def of walletDefs) {
      console.log(`[dex-demo] Creating wallet: ${def.name}, aborted=${abortSignal?.aborted}`);
      if (abortSignal?.aborted) throw new Error("Demo aborted");
      const w = await createWallet(networkName);
      console.log(`[dex-demo] Wallet created: ${def.name} → ${w.address}`);
      agents.push({
        name: def.name,
        role: def.role,
        address: w.address,
        mnemonic: w.mnemonic,
        client: null,
        txBalance: 0,
        tokenBalance: 0,
      });
      emit("wallet", { agent: def.name, role: def.role, address: w.address });
    }

    // ── Phase 3: Fund agent wallet if low, then distribute to sub-wallets ──
    if (abortSignal?.aborted) throw new Error("Demo aborted");

    let fundBals = await agentClient.getBalances(agentClient.address);
    let fundTxBal = fundBals.find(b => b.denom === QUOTE_DENOM);
    let fundTxAmount = fundTxBal ? parseInt(fundTxBal.amount) : 0;

    // If agent wallet is running low, try faucet to refill (best effort)
    if (fundTxAmount < MIN_AGENT_BALANCE) {
      emit("phase", { phase: "funding", message: "Refilling agent wallet from faucet..." });
      for (let i = 0; i < 3; i++) {
        if (abortSignal?.aborted) throw new Error("Demo aborted");
        try {
          await requestFaucet(agentClient.address, networkName);
          emit("log", { message: `Faucet request ${i + 1}/3: success` });
        } catch {
          emit("log", { message: `Faucet request ${i + 1}/3: rate limited, skipping` });
          break;
        }
        await sleep(6000);
      }
      await sleep(4000);
      fundBals = await agentClient.getBalances(agentClient.address);
      fundTxBal = fundBals.find(b => b.denom === QUOTE_DENOM);
      fundTxAmount = fundTxBal ? parseInt(fundTxBal.amount) : 0;
    }

    // Fund sub-wallets directly from agent wallet (no faucet needed)
    emit("phase", { phase: "funding", message: "Funding trading agents from issuer wallet..." });
    const fundPerWallet = Math.min(AGENT_FUND_AMOUNT, Math.floor((fundTxAmount - 50_000_000) / agents.length));

    if (fundPerWallet < 10_000_000) {
      emit("error", { message: `Agent wallet too low (${(fundTxAmount / 1e6).toFixed(1)} TX). Please fund it using the Fund Agent button and try again.` });
      throw new Error("Insufficient agent TX balance");
    }

    for (const agent of agents) {
      if (abortSignal?.aborted) throw new Error("Demo aborted");
      let funded = false;

      // Attempt 1: Fund from agent wallet
      try {
        await agentClient.signAndBroadcastMsg({
          typeUrl: "/cosmos.bank.v1beta1.MsgSend",
          value: {
            fromAddress: agentClient.address,
            toAddress: agent.address,
            amount: [{ denom: QUOTE_DENOM, amount: fundPerWallet.toString() }],
          },
        }, 200000);
        funded = true;
        emit("funding", {
          agent: agent.name,
          request: 1,
          total: 1,
          success: true,
          message: `Funded ${(fundPerWallet / 1e6).toFixed(0)} TX from issuer`,
        });
        await sleep(2000);
      } catch (fundErr) {
        emit("funding", {
          agent: agent.name,
          request: 1,
          total: 1,
          success: false,
          message: `Issuer send failed: ${(fundErr as Error).message.slice(0, 80)}`,
        });
      }

      // Attempt 2: If agent send failed, try faucet directly to this wallet
      if (!funded) {
        emit("log", { message: `Trying faucet directly for ${agent.name}...` });
        for (let f = 0; f < 2; f++) {
          try {
            await requestFaucet(agent.address, networkName);
            funded = true;
            emit("funding", {
              agent: agent.name,
              request: f + 1,
              total: 2,
              success: true,
              message: `Funded from faucet (attempt ${f + 1})`,
            });
            await sleep(6000);
            break;
          } catch {
            emit("log", { message: `Faucet ${f + 1}/2 for ${agent.name}: rate limited` });
            await sleep(3000);
          }
        }
      }

      if (!funded) {
        emit("error", { message: `Could not fund ${agent.name}. Agent wallet may be empty and faucet rate limited.` });
      }
    }

    // ── Phase 4: Connect Trading Clients ──
    emit("phase", { phase: "connecting", message: "Connecting trading agents to blockchain..." });

    let unfundedCount = 0;
    for (const agent of agents) {
      if (abortSignal?.aborted) throw new Error("Demo aborted");
      const wallet = await importWallet(agent.mnemonic, networkName);
      const client = await TxClient.connectWithWallet(wallet, { isolatedMutex: true });
      agent.client = client;
      clients.push(client);

      const bals = await client.getBalances(agent.address);
      const txBal = bals.find(b => b.denom === QUOTE_DENOM);
      agent.txBalance = txBal ? parseInt(txBal.amount) : 0;

      if (agent.txBalance < 1_000_000) unfundedCount++;

      emit("balance", {
        agent: agent.name,
        address: agent.address,
        display: (agent.txBalance / 1e6).toFixed(2) + " TX",
      });
    }

    // Abort early if agents aren't funded — no point placing 200 failing orders
    if (unfundedCount >= 2) {
      emit("error", {
        message: `${unfundedCount}/3 agents have no TX. The issuer wallet needs more funds. Use "Fund Agent" or connect a wallet with TX.`,
      });
      throw new Error(`${unfundedCount} agents unfunded — aborting demo`);
    }

    const [mmA, mmB, taker] = agents;

    // ── Phase 4.5: Whitelist agent wallets + DEX module if token has whitelisting ──
    if (abortSignal?.aborted) throw new Error("Demo aborted");
    try {
      const tokenInfo = await getTokenInfo(baseDenom, networkName);
      const features = tokenInfo.features || [];
      if (features.includes("whitelisting")) {
        emit("phase", { phase: "whitelist", message: `Whitelisting agents + DEX module for ${tokenSymbol}...` });
        const whitelistAmount = toRaw(10000); // generous limit

        // Whitelist the DEX module address (critical: DEX escrows tokens for sell orders)
        const dexModuleAddr = getDexModuleAddress(networkName);
        try {
          await setWhitelistedLimit(agentClient, baseDenom, dexModuleAddr, toRaw(100000));
          emit("log", { message: `✅ Whitelisted DEX module (${dexModuleAddr.slice(0,16)}...)` });
          await sleep(2000);
        } catch (wlErr) {
          emit("log", { message: `⚠️ DEX module whitelist: ${(wlErr as Error).message.slice(0, 100)}` });
        }

        // Whitelist each agent wallet
        for (const agent of agents) {
          try {
            await setWhitelistedLimit(agentClient, baseDenom, agent.address, whitelistAmount);
            emit("log", { message: `Whitelisted ${agent.name} (${agent.address.slice(0,12)}...)` });
            await sleep(2000);
          } catch (wlErr) {
            emit("log", { message: `Whitelist ${agent.name}: ${(wlErr as Error).message}` });
          }
        }
      }
    } catch (infoErr) {
      // Non-fatal — if we can't check, try sending anyway
      emit("log", { message: `Token info check: ${(infoErr as Error).message}` });
    }

    // ── Phase 5: Distribute Tokens to Sellers ──
    emit("phase", { phase: "transfer", message: `Sending ${tokenSymbol} to trading agents...` });

    // Send tokens to MM-B (seller)
    const sendToB = {
      typeUrl: "/cosmos.bank.v1beta1.MsgSend",
      value: {
        fromAddress: agentClient.address,
        toAddress: mmB.address,
        amount: [{ denom: baseDenom, amount: toRaw(SELLER_TOKEN_AMOUNT) }],
      },
    };
    const sendBResult = await agentClient.signAndBroadcastMsg(sendToB, 200000);
    emit("transfer", {
      from: "Issuer",
      to: mmB.name,
      amount: SELLER_TOKEN_AMOUNT,
      symbol: tokenSymbol,
      txHash: sendBResult.txHash,
      success: sendBResult.success,
    });

    await sleep(3000);

    // Send tokens to Taker
    const sendToTaker = {
      typeUrl: "/cosmos.bank.v1beta1.MsgSend",
      value: {
        fromAddress: agentClient.address,
        toAddress: taker.address,
        amount: [{ denom: baseDenom, amount: toRaw(TAKER_TOKEN_AMOUNT) }],
      },
    };
    const sendTakerResult = await agentClient.signAndBroadcastMsg(sendToTaker, 200000);
    emit("transfer", {
      from: "Issuer",
      to: taker.name,
      amount: TAKER_TOKEN_AMOUNT,
      symbol: tokenSymbol,
      txHash: sendTakerResult.txHash,
      success: sendTakerResult.success,
    });

    await sleep(3000);

    // Log agent balances before placing orders
    for (const agent of agents) {
      const bals = await agent.client!.getBalances(agent.address);
      const txBal = bals.find(b => b.denom === QUOTE_DENOM);
      const tokenBal = bals.find(b => b.denom === baseDenom);
      const txAmt = txBal ? parseInt(txBal.amount) / 1e6 : 0;
      const tokenAmt = tokenBal ? parseInt(tokenBal.amount) / 1e6 : 0;
      emit("balance", {
        agent: agent.name,
        address: agent.address,
        txBalance: txAmt.toFixed(2) + " TX",
        tokenBalance: tokenAmt.toFixed(0) + " " + tokenSymbol,
      });
      console.log(`[dex-demo] ${agent.name}: ${txAmt.toFixed(2)} TX, ${tokenAmt.toFixed(0)} ${tokenSymbol}`);
    }

    // ── Phase 6: Paint the Chart ──
    // Agents trade ~100 times following a dramatic price trajectory.
    // Each matched buy+sell creates one candle on the live chart.

    let placedCount = 0;
    let fillCount = 0;
    let errorCount = 0;

    // Helper to place an order and emit events
    const placeAndEmit = async (
      client: TxClient,
      agentName: string,
      side: 1 | 2,
      price: number,
      quantity: number,
      overlap: boolean,
      tif: DexTimeInForce = DexTimeInForce.GTC,
    ) => {
      const priceStr = formatPrice(price);
      const sideStr = side === 1 ? "buy" : "sell";
      const tifLabel = tif === DexTimeInForce.IOC ? "IOC" : tif === DexTimeInForce.FOK ? "FOK" : "GTC";
      try {
        const result = await placeOrder(client, {
          baseDenom,
          quoteDenom: QUOTE_DENOM,
          side,
          orderType: 1, // LIMIT
          price: priceStr,
          quantity: toRaw(quantity),
          timeInForce: tif,
        } as any);
        placedCount++;
        emit("order", {
          agent: agentName, side: sideStr, price: priceStr, priceDisplay: price,
          quantity, symbol: tokenSymbol, orderId: result.orderId,
          txHash: result.txHash, status: result.success ? "placed" : "failed",
          error: result.error, overlap, timeInForce: tifLabel,
        });
        return result;
      } catch (err) {
        errorCount++;
        const errMsg = (err as Error).message.slice(0, 200);
        console.error(`[dex-demo] Order error (${agentName} ${sideStr} ${quantity} @ ${priceStr} ${tifLabel}): ${errMsg}`);
        emit("order", {
          agent: agentName, side: sideStr, price: priceStr, priceDisplay: price,
          quantity, symbol: tokenSymbol, status: "error",
          error: errMsg, overlap, timeInForce: tifLabel,
        });
        return null;
      }
    };

    // ── Phase 6a: Seed depth orders (non-overlapping) ──
    emit("phase", { phase: "orders", message: `Seeding ${tokenSymbol} orderbook depth...` });

    // 4 buy orders spread below midpoint
    for (let i = 0; i < 4; i++) {
      if (abortSignal?.aborted) throw new Error("Demo aborted");
      const price = Math.round(BASE_PRICE * (0.4 + 0.08 * i) * 1e6) / 1e6;
      await placeAndEmit(mmA.client!, mmA.name, 1, price, 20 + i * 10, false);
      await sleep(INTERLEAVE_DELAY);
    }

    // 4 sell orders spread above midpoint
    for (let i = 0; i < 4; i++) {
      if (abortSignal?.aborted) throw new Error("Demo aborted");
      const price = Math.round(BASE_PRICE * (1.2 + 0.1 * i) * 1e6) / 1e6;
      await placeAndEmit(mmB.client!, mmB.name, 2, price, 20 + i * 10, false);
      await sleep(INTERLEAVE_DELAY);
    }

    // ── Phase 6b: Paint the chart with ~100 matched trades ──
    emit("phase", {
      phase: "fills",
      message: `Painting ${PAINT_CANDLES} candles — agents trading ${tokenSymbol}...`,
      buyCount: PAINT_CANDLES,
      sellCount: PAINT_CANDLES,
      overlapCount: PAINT_CANDLES,
    });

    // Generate dramatic price trajectory
    const trajectory = generatePriceTrajectory(BASE_PRICE, PAINT_CANDLES);
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 5;

    for (let i = 0; i < trajectory.length; i++) {
      if (abortSignal?.aborted) throw new Error("Demo aborted");

      // Circuit breaker: stop if too many consecutive failures
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        emit("error", { message: `${MAX_CONSECUTIVE_ERRORS} consecutive order failures — stopping early. Check agent funding.` });
        emit("log", { message: `Placed ${placedCount} orders, ${fillCount} fills, ${errorCount} errors before aborting.` });
        break;
      }

      const targetPrice = trajectory[i];
      // Vary quantity per trade: more during volatile phases
      const phase = getPricePhase(i, PAINT_CANDLES);
      const baseQty = phase.volMult > 1.5 ? 15 + Math.floor(Math.random() * 25)
                     : phase.volMult > 1.0 ? 8 + Math.floor(Math.random() * 18)
                     : 5 + Math.floor(Math.random() * 12);

      // Vary timeInForce: mostly GTC, some IOC during volatility, occasional FOK
      let tif = DexTimeInForce.GTC;
      if (phase.volMult > 2.0 && Math.random() > 0.5) {
        tif = DexTimeInForce.IOC; // Immediate-or-Cancel during breakouts/selloffs
      } else if (i % 25 === 0 && i > 0) {
        tif = DexTimeInForce.FOK; // Fill-or-Kill every 25th trade
      }

      // MM-A places a buy at targetPrice → sits on book
      const buyResult = await placeAndEmit(mmA.client!, mmA.name, 1, targetPrice, baseQty, true, tif);
      if (!buyResult) { consecutiveErrors++; await sleep(PAINT_DELAY); continue; }
      consecutiveErrors = 0;
      await sleep(PAINT_DELAY);

      // MM-B places a sell at same price → matches → fill!
      const sellResult = await placeAndEmit(mmB.client!, mmB.name, 2, targetPrice, baseQty, true, tif);
      if (sellResult?.success) {
        fillCount++;
        consecutiveErrors = 0;
        emit("fill", {
          price: formatPrice(targetPrice),
          priceDisplay: targetPrice,
          buyQty: baseQty,
          sellQty: baseQty,
          quantity: baseQty,
          symbol: tokenSymbol,
          buyer: mmA.name,
          seller: mmB.name,
          txHash: sellResult.txHash,
          timeInForce: tif === DexTimeInForce.IOC ? "IOC" : tif === DexTimeInForce.FOK ? "FOK" : "GTC",
        });
      } else {
        consecutiveErrors++;
      }

      // Every 15 trades, Taker adds depth or sweeps with IOC for variety
      if (i > 0 && i % 15 === 0) {
        const takerSide = Math.random() > 0.5 ? 1 : 2;
        const aggressive = Math.random() > 0.6; // 40% aggressive IOC sweeps
        const offset = takerSide === 1
          ? targetPrice * (aggressive ? 1.0 : (0.85 + Math.random() * 0.1))
          : targetPrice * (aggressive ? 1.0 : (1.05 + Math.random() * 0.1));
        const takerPrice = Math.round(offset * 1e6) / 1e6;
        const takerTif = aggressive ? DexTimeInForce.IOC : DexTimeInForce.GTC;
        await placeAndEmit(
          taker.client!, taker.name, takerSide as 1 | 2, takerPrice,
          20 + Math.floor(Math.random() * 30), aggressive, takerTif
        );
      }

      // Progress update every 10 candles
      if (i > 0 && i % 10 === 0) {
        emit("phase", {
          phase: "fills",
          message: `Candle ${i}/${PAINT_CANDLES} — ${phase.desc}`,
        });
      }

      if (i < trajectory.length - 1) await sleep(PAINT_DELAY);
    }

    // ── Phase 7: Taker Sweep (aggressive IOC orders) ──
    emit("phase", { phase: "taker", message: "Taker sweeping with IOC orders..." });

    const lastPrice = trajectory[trajectory.length - 1];

    // Taker buys aggressively (IOC sweep of asks)
    const takerBuyPrice = Math.round(lastPrice * 1.3 * 1e6) / 1e6;
    await placeAndEmit(taker.client!, taker.name, 1, takerBuyPrice, 50, false, DexTimeInForce.IOC);
    await sleep(ORDER_DELAY);

    // Taker sells aggressively (IOC sweep of bids)
    const takerSellPrice = Math.round(lastPrice * 0.7 * 1e6) / 1e6;
    await placeAndEmit(taker.client!, taker.name, 2, takerSellPrice, 50, false, DexTimeInForce.IOC);

    // ── Phase 8: Final Summary ──
    await sleep(5000);
    emit("phase", { phase: "summary", message: "Gathering final results..." });

    const finalOb = await queryOrderbook(baseDenom, QUOTE_DENOM, networkName);
    const mmAOrders = await queryOrdersByCreator(mmA.address, networkName);
    const mmBOrders = await queryOrdersByCreator(mmB.address, networkName);
    const takerOrders = await queryOrdersByCreator(taker.address, networkName);

    emit("summary", {
      token: { symbol: tokenSymbol, denom: baseDenom },
      orderbook: { bids: finalOb.bids.length, asks: finalOb.asks.length },
      agents: {
        mmA: { name: mmA.name, address: mmA.address, openOrders: mmAOrders.length },
        mmB: { name: mmB.name, address: mmB.address, openOrders: mmBOrders.length },
        taker: { name: taker.name, address: taker.address, openOrders: takerOrders.length },
      },
      totals: { placed: placedCount, fills: fillCount, errors: errorCount },
    });

    // ── Phase 9: Return Leftover Tokens to User ──
    if (returnAddress) {
      emit("phase", { phase: "return", message: `Returning leftover ${tokenSymbol} to your wallet...` });
      await sleep(3000);

      try {
        // Sweep tokens from MM-B → agent
        const mmBBals = await mmB.client!.getBalances(mmB.address);
        const mmBTokenBal = mmBBals.find(b => b.denom === baseDenom);
        if (mmBTokenBal && parseInt(mmBTokenBal.amount) > 0) {
          await mmB.client!.signAndBroadcastMsg({
            typeUrl: "/cosmos.bank.v1beta1.MsgSend",
            value: {
              fromAddress: mmB.address,
              toAddress: agentClient!.address,
              amount: [{ denom: baseDenom, amount: mmBTokenBal.amount }],
            },
          }, 200000);
          emit("return", { step: "sweep", from: mmB.name, amount: parseInt(mmBTokenBal.amount) / 1e6, symbol: tokenSymbol });
        }

        await sleep(2000);

        // Sweep tokens from Taker → agent
        const takerBals = await taker.client!.getBalances(taker.address);
        const takerTokenBal = takerBals.find(b => b.denom === baseDenom);
        if (takerTokenBal && parseInt(takerTokenBal.amount) > 0) {
          await taker.client!.signAndBroadcastMsg({
            typeUrl: "/cosmos.bank.v1beta1.MsgSend",
            value: {
              fromAddress: taker.address,
              toAddress: agentClient!.address,
              amount: [{ denom: baseDenom, amount: takerTokenBal.amount }],
            },
          }, 200000);
          emit("return", { step: "sweep", from: taker.name, amount: parseInt(takerTokenBal.amount) / 1e6, symbol: tokenSymbol });
        }

        await sleep(3000);

        // Send all collected tokens from agent → user
        const agentFinalBals = await agentClient!.getBalances(agentClient!.address);
        const agentFinalToken = agentFinalBals.find(b => b.denom === baseDenom);
        const returnAmount = agentFinalToken ? parseInt(agentFinalToken.amount) : 0;

        if (returnAmount > 0) {
          const returnResult = await agentClient!.signAndBroadcastMsg({
            typeUrl: "/cosmos.bank.v1beta1.MsgSend",
            value: {
              fromAddress: agentClient!.address,
              toAddress: returnAddress,
              amount: [{ denom: baseDenom, amount: returnAmount.toString() }],
            },
          }, 200000);
          emit("return", {
            step: "refund",
            to: returnAddress,
            amount: returnAmount / 1e6,
            symbol: tokenSymbol,
            txHash: returnResult.txHash,
            success: returnResult.success,
          });
        }
      } catch (err) {
        console.error("[dex-demo] Token return failed:", (err as Error).message);
        emit("return", { step: "error", message: `Could not return all tokens: ${(err as Error).message.slice(0, 100)}` });
      }
    }

    emit("done", { success: true, denom: baseDenom });

    // ── Post-demo: Sweep leftover TX from sub-wallets back to agent ──
    try {
      for (const agent of agents) {
        if (!agent.client) continue;
        const bals = await agent.client.getBalances(agent.address);
        const txBal = bals.find(b => b.denom === QUOTE_DENOM);
        const amount = txBal ? parseInt(txBal.amount) : 0;
        // Keep 10 TX for gas, sweep the rest
        const sweepAmount = amount - 10_000_000;
        if (sweepAmount > 0) {
          try {
            await agent.client.signAndBroadcastMsg({
              typeUrl: "/cosmos.bank.v1beta1.MsgSend",
              value: {
                fromAddress: agent.address,
                toAddress: agentClient!.address,
                amount: [{ denom: QUOTE_DENOM, amount: sweepAmount.toString() }],
              },
            }, 200000);
          } catch { /* best effort */ }
        }
      }
    } catch { /* non-fatal */ }

    // ── Post-demo: Refill agent wallet from faucet so it's ready for next run ──
    try {
      await requestFaucet(agentClient!.address, networkName);
      emit("log", { message: "Agent wallet refilled from faucet for next run" });
    } catch { /* non-fatal — faucet may rate limit, that's ok */ }

  } catch (err) {
    emit("error", { message: (err as Error).message });
  } finally {
    for (const client of clients) {
      try { client.disconnect(); } catch { /* ignore */ }
    }
    for (const agent of agents) {
      agent.mnemonic = "";
    }
    demoRunning = false;
  }
}
