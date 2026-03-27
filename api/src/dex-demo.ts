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

const FAUCET_REQUESTS_PER_WALLET = 1; // 1 request = ~200 TX per wallet (faucet rate-limits fast)
const FAUCET_DELAY = 6000;            // 6s between faucet requests to avoid 429
const AGENT_FUND_AMOUNT = 100_000_000; // 100 TX in utestcore — backup funding from agent wallet
const ORDER_DELAY = 5000;             // 5s between orders (same wallet)
const INTERLEAVE_DELAY = 2000;        // 2s between different wallet orders
const TOKEN_PRECISION = 6;
const QUOTE_DENOM = "utestcore";

// Token distribution: how many tokens to give each seller agent
export const SELLER_TOKEN_AMOUNT = 5000;  // 5000 tokens to MM-B
export const TAKER_TOKEN_AMOUNT = 2000;   // 2000 tokens to Taker
export const DEMO_TOKENS_NEEDED = SELLER_TOKEN_AMOUNT + TAKER_TOKEN_AMOUNT; // 7000

// Price config: 0.001 TX per token (1e-3)
const BASE_PRICE = 0.001;

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

// ─── Demo Logic ─────────────────────────────────────────────────────────────

let demoRunning = false;
let demoStartedAt = 0;
const DEMO_MAX_DURATION = 5 * 60 * 1000; // 5 min safety timeout

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

    // ── Phase 3: Fund Wallets from Faucet ──
    emit("phase", { phase: "funding", message: "Funding wallets from testnet faucet (this takes ~30s)..." });

    for (const agent of agents) {
      for (let i = 0; i < FAUCET_REQUESTS_PER_WALLET; i++) {
        if (abortSignal?.aborted) throw new Error("Demo aborted");
        try {
          const result = await requestFaucet(agent.address, networkName);
          emit("funding", {
            agent: agent.name,
            request: i + 1,
            total: FAUCET_REQUESTS_PER_WALLET,
            success: result.success,
            message: result.message,
          });
        } catch (err) {
          emit("funding", {
            agent: agent.name,
            request: i + 1,
            total: FAUCET_REQUESTS_PER_WALLET,
            success: false,
            message: (err as Error).message,
          });
        }
        if (i < FAUCET_REQUESTS_PER_WALLET - 1) await sleep(FAUCET_DELAY);
      }
    }

    emit("phase", { phase: "funding", message: "Waiting for faucet transactions..." });
    await sleep(4000);

    // ── Phase 3.5: Backup fund from agent wallet if faucet was insufficient ──
    if (abortSignal?.aborted) throw new Error("Demo aborted");
    const agentBals = await agentClient.getBalances(agentClient.address);
    const agentTxBal = agentBals.find(b => b.denom === QUOTE_DENOM);
    const agentTxAmount = agentTxBal ? parseInt(agentTxBal.amount) : 0;

    // If agent has enough TX, top up sub-wallets that didn't get enough from faucet
    if (agentTxAmount > AGENT_FUND_AMOUNT * agents.length + 50_000_000) {
      emit("phase", { phase: "funding", message: "Topping up agent wallets from issuer..." });
      for (const agent of agents) {
        if (abortSignal?.aborted) throw new Error("Demo aborted");
        try {
          const sendTx = {
            typeUrl: "/cosmos.bank.v1beta1.MsgSend",
            value: {
              fromAddress: agentClient.address,
              toAddress: agent.address,
              amount: [{ denom: QUOTE_DENOM, amount: AGENT_FUND_AMOUNT.toString() }],
            },
          };
          await agentClient.signAndBroadcastMsg(sendTx, 200000);
          emit("log", { message: `Sent 100 TX to ${agent.name}` });
          await sleep(2000);
        } catch (fundErr) {
          emit("log", { message: `Top-up ${agent.name}: ${(fundErr as Error).message}` });
        }
      }
    }

    // ── Phase 4: Connect Trading Clients ──
    emit("phase", { phase: "connecting", message: "Connecting trading agents to blockchain..." });

    for (const agent of agents) {
      if (abortSignal?.aborted) throw new Error("Demo aborted");
      const wallet = await importWallet(agent.mnemonic, networkName);
      const client = await TxClient.connectWithWallet(wallet, { isolatedMutex: true });
      agent.client = client;
      clients.push(client);

      const bals = await client.getBalances(agent.address);
      const txBal = bals.find(b => b.denom === QUOTE_DENOM);
      agent.txBalance = txBal ? parseInt(txBal.amount) : 0;

      emit("balance", {
        agent: agent.name,
        address: agent.address,
        display: (agent.txBalance / 1e6).toFixed(2) + " TX",
      });
    }

    const [mmA, mmB, taker] = agents;

    // ── Phase 4.5: Whitelist agent wallets if token has whitelisting ──
    if (abortSignal?.aborted) throw new Error("Demo aborted");
    try {
      const tokenInfo = await getTokenInfo(baseDenom, networkName);
      const features = tokenInfo.features || [];
      if (features.includes("whitelisting")) {
        emit("phase", { phase: "whitelist", message: `Whitelisting agent wallets for ${tokenSymbol}...` });
        const whitelistAmount = toRaw(10000); // generous limit
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

    // ── Phase 6: Place Limit Orders ──
    // 12 buy orders (MM-A) + 11 sell orders (MM-B)
    // 6 prices overlap → instant fills when both sides hit

    const buyPrices: { price: number; quantity: number; overlap: boolean }[] = [];
    const sellPrices: { price: number; quantity: number; overlap: boolean }[] = [];

    // 6 non-overlapping buys spread below midpoint
    for (let i = 0; i < 6; i++) {
      const price = Math.round(BASE_PRICE * (0.5 + 0.07 * i) * 1e6) / 1e6;
      buyPrices.push({ price, quantity: 10 + i * 5, overlap: false });
    }

    // 5 non-overlapping sells spread above midpoint
    for (let i = 0; i < 5; i++) {
      const price = Math.round(BASE_PRICE * (1.15 + 0.08 * i) * 1e6) / 1e6;
      sellPrices.push({ price, quantity: 10 + i * 5, overlap: false });
    }

    // 6 overlapping prices near midpoint (creates fills)
    const overlapMultipliers = [0.97, 0.98, 0.99, 1.0, 1.01, 1.02];
    for (const mult of overlapMultipliers) {
      const price = Math.round(BASE_PRICE * mult * 1e6) / 1e6;
      // Vary quantities: some partial fills, some full fills
      const buyQty = 15 + Math.floor(Math.random() * 20);
      const sellQty = mult < 1.0 ? buyQty : Math.floor(buyQty * 0.6); // partials for some
      buyPrices.push({ price, quantity: buyQty, overlap: true });
      sellPrices.push({ price, quantity: sellQty, overlap: true });
    }

    emit("phase", {
      phase: "orders",
      message: `Placing ${buyPrices.length} buy + ${sellPrices.length} sell orders for ${tokenSymbol}...`,
      buyCount: buyPrices.length,
      sellCount: sellPrices.length,
      overlapCount: 6,
    });

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
      overlap: boolean
    ) => {
      const priceStr = formatPrice(price);
      const sideStr = side === 1 ? "buy" : "sell";
      try {
        const result = await placeOrder(client, {
          baseDenom,
          quoteDenom: QUOTE_DENOM,
          side,
          orderType: 1,
          price: priceStr,
          quantity: toRaw(quantity),
          timeInForce: 1,
        } as any);
        placedCount++;
        emit("order", {
          agent: agentName, side: sideStr, price: priceStr, priceDisplay: price,
          quantity, symbol: tokenSymbol, orderId: result.orderId,
          txHash: result.txHash, status: result.success ? "placed" : "failed",
          error: result.error, overlap,
        });
        return result;
      } catch (err) {
        errorCount++;
        emit("order", {
          agent: agentName, side: sideStr, price: priceStr, priceDisplay: price,
          quantity, symbol: tokenSymbol, status: "error",
          error: (err as Error).message.slice(0, 120), overlap,
        });
        return null;
      }
    };

    // Place non-overlapping buys (MM-A)
    const nonOverlapBuys = buyPrices.filter(p => !p.overlap);
    for (let i = 0; i < nonOverlapBuys.length; i++) {
      if (abortSignal?.aborted) throw new Error("Demo aborted");
      const l = nonOverlapBuys[i];
      await placeAndEmit(mmA.client!, mmA.name, 1, l.price, l.quantity, false);
      if (i < nonOverlapBuys.length - 1) await sleep(ORDER_DELAY);
    }

    // Place non-overlapping sells (MM-B)
    const nonOverlapSells = sellPrices.filter(p => !p.overlap);
    for (let i = 0; i < nonOverlapSells.length; i++) {
      if (abortSignal?.aborted) throw new Error("Demo aborted");
      const l = nonOverlapSells[i];
      await placeAndEmit(mmB.client!, mmB.name, 2, l.price, l.quantity, false);
      if (i < nonOverlapSells.length - 1) await sleep(ORDER_DELAY);
    }

    // Place overlapping orders (interleaved buy → sell for fills)
    emit("phase", { phase: "fills", message: "Placing matching orders (instant fills)..." });

    const overlapBuys = buyPrices.filter(p => p.overlap);
    const overlapSells = sellPrices.filter(p => p.overlap);

    for (let i = 0; i < overlapBuys.length; i++) {
      if (abortSignal?.aborted) throw new Error("Demo aborted");

      // Buy first
      await placeAndEmit(mmA.client!, mmA.name, 1, overlapBuys[i].price, overlapBuys[i].quantity, true);
      await sleep(INTERLEAVE_DELAY);

      // Matching sell → triggers fill
      const sellResult = await placeAndEmit(mmB.client!, mmB.name, 2, overlapSells[i].price, overlapSells[i].quantity, true);
      if (sellResult?.success) {
        fillCount++;
        emit("fill", {
          price: formatPrice(overlapBuys[i].price),
          priceDisplay: overlapBuys[i].price,
          buyQty: overlapBuys[i].quantity,
          sellQty: overlapSells[i].quantity,
          symbol: tokenSymbol,
          buyer: mmA.name,
          seller: mmB.name,
          txHash: sellResult.txHash,
        });
      }

      if (i < overlapBuys.length - 1) await sleep(ORDER_DELAY);
    }

    // ── Phase 7: Taker Market Orders ──
    emit("phase", { phase: "taker", message: "Taker sweeping the orderbook..." });

    // Taker buys aggressively (sweeps asks)
    const takerBuyPrice = Math.round(BASE_PRICE * 1.5 * 1e6) / 1e6;
    await placeAndEmit(taker.client!, taker.name, 1, takerBuyPrice, 100, false);
    await sleep(ORDER_DELAY);

    // Taker sells aggressively (sweeps bids)
    const takerSellPrice = Math.round(BASE_PRICE * 0.4 * 1e6) / 1e6;
    await placeAndEmit(taker.client!, taker.name, 2, takerSellPrice, 100, false);

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
