/**
 * DEX Live Demo — AI Agent Swarm Orchestrator
 *
 * Creates 3 AI agent wallets that demonstrate a full DEX trading lifecycle:
 *   - Market Maker A (MM-A): places BUY limit orders
 *   - Market Maker B (MM-B): creates token, places SELL limit orders
 *   - Taker: executes market-style orders that fill against the book
 *
 * The demo is fully self-contained: MM-B creates a fresh demo token,
 * so no existing tokens are needed.
 *
 * Emits SSE events for real-time UI updates.
 */

import {
  createWallet,
  importWallet,
  requestFaucet,
  issueSmartToken,
  placeOrder,
  cancelOrder,
  queryOrderbook,
  queryOrdersByCreator,
  TxClient,
  NetworkName,
  NETWORKS,
} from "./tx-sdk";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DemoConfig {
  networkName: NetworkName;
  onEvent: (event: string, data: Record<string, unknown>) => void;
  abortSignal?: AbortSignal;
}

interface AgentWallet {
  name: string;
  address: string;
  mnemonic: string;
  client: TxClient | null;
  balance: number; // utestcore
}

// ─── Constants ──────────────────────────────────────────────────────────────

const FAUCET_REQUESTS_PER_WALLET = 3; // ~200 TX each × 3 = ~600 TX per wallet
const FAUCET_DELAY = 5000;            // 5s between faucet requests
const ORDER_DELAY = 5000;             // 5s between orders (same wallet)
const INTERLEAVE_DELAY = 2000;        // 2s between different wallet orders
const TOKEN_SUPPLY = 10_000_000;      // 10M demo tokens
const TOKEN_PRECISION = 6;
const QUOTE_DENOM = "utestcore";

// Price ladder: midpoint at 1e-2 (0.01 TX per token)
// BUY orders below midpoint, SELL orders above
// 6 overlapping prices create instant fills
const MIDPOINT = 0.01; // 0.01 TX per token = 1e-2

/**
 * Generate Coreum-compatible price string.
 * Must match: ^(([1-9])|([1-9]\d*[1-9]))(e-?[1-9]\d*)?$
 */
function formatPrice(price: number): string {
  if (price <= 0) throw new Error(`Invalid price: ${price}`);
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

export function isDemoRunning(): boolean {
  return demoRunning;
}

export async function runDexDemo(config: DemoConfig): Promise<void> {
  if (demoRunning) throw new Error("Demo already in progress");
  demoRunning = true;

  const { networkName, onEvent, abortSignal } = config;
  const emit = (event: string, data: Record<string, unknown>) => {
    try { onEvent(event, data); } catch { /* ignore */ }
  };

  const agents: AgentWallet[] = [];
  const clients: TxClient[] = [];

  try {
    // ── Phase 1: Create Wallets ──
    emit("phase", { phase: "wallets", message: "Creating 3 AI agent wallets..." });

    const walletNames = ["Market Maker A (Buyer)", "Market Maker B (Seller)", "Taker"];
    for (const name of walletNames) {
      if (abortSignal?.aborted) throw new Error("Demo aborted");
      const w = await createWallet(networkName);
      agents.push({
        name,
        address: w.address,
        mnemonic: w.mnemonic,
        client: null,
        balance: 0,
      });
      emit("wallet", { agent: name, address: w.address });
    }
    emit("phase", { phase: "wallets", message: "All wallets created", done: true });

    // ── Phase 2: Fund Wallets ──
    emit("phase", { phase: "funding", message: "Funding wallets from testnet faucet..." });

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

    // Wait for funds to propagate
    emit("phase", { phase: "funding", message: "Waiting for funds to arrive..." });
    await sleep(8000);

    // ── Phase 3: Connect Clients ──
    emit("phase", { phase: "connecting", message: "Connecting to blockchain..." });

    for (const agent of agents) {
      if (abortSignal?.aborted) throw new Error("Demo aborted");
      const wallet = await importWallet(agent.mnemonic, networkName);
      const client = await TxClient.connectWithWallet(wallet, { isolatedMutex: true });
      agent.client = client;
      clients.push(client);

      // Check balance
      const balances = await client.getBalances(agent.address);
      const coreBal = balances.find(b => b.denom === QUOTE_DENOM);
      agent.balance = coreBal ? parseInt(coreBal.amount) : 0;
      emit("balance", {
        agent: agent.name,
        address: agent.address,
        balance: agent.balance,
        display: (agent.balance / 1e6).toFixed(2) + " TX",
      });
    }

    const [mmA, mmB, taker] = agents;

    // ── Phase 4: MM-B Creates Demo Token ──
    emit("phase", { phase: "token", message: "Market Maker B creating demo token..." });

    const demoSymbol = "DEMO" + Date.now().toString(36).slice(-3).toUpperCase();
    const tokenResult = await issueSmartToken(mmB.client!, {
      subunit: demoSymbol.toLowerCase(),
      symbol: demoSymbol,
      name: `AI DEX Demo ${demoSymbol}`,
      description: `AI DEX Demo Token ${demoSymbol}`,
      initialAmount: String(TOKEN_SUPPLY),
      precision: TOKEN_PRECISION,
      features: { minting: true, burning: true },
    });

    const baseDenom = tokenResult.denom;
    emit("token", {
      symbol: demoSymbol,
      denom: baseDenom,
      supply: TOKEN_SUPPLY,
      txHash: tokenResult.txHash,
      issuer: mmB.address,
    });

    if (!tokenResult.success) {
      throw new Error(`Token creation failed: ${tokenResult.error}`);
    }

    await sleep(3000); // wait for token to propagate

    // ── Phase 5: MM-B Sends Tokens to Taker ──
    emit("phase", { phase: "transfer", message: "Distributing tokens to Taker agent..." });

    const takerTokens = Math.floor(TOKEN_SUPPLY * 0.1); // 10% to taker
    const sendMsg = {
      typeUrl: "/cosmos.bank.v1beta1.MsgSend",
      value: {
        fromAddress: mmB.address,
        toAddress: taker.address,
        amount: [{ denom: baseDenom, amount: toRaw(takerTokens) }],
      },
    };
    const sendResult = await mmB.client!.signAndBroadcastMsg(sendMsg, 200000);
    emit("transfer", {
      from: mmB.name,
      to: taker.name,
      amount: takerTokens,
      symbol: demoSymbol,
      txHash: sendResult.txHash,
    });

    await sleep(3000);

    // ── Phase 6: Place Orders ──
    // Generate price levels
    // Buy orders: 12 total (6 non-overlapping below mid, 6 overlapping near mid)
    // Sell orders: 11 total (5 non-overlapping above mid, 6 overlapping near mid)
    // Overlapping prices: both sides at same price → instant fill

    const buyPrices: { price: number; quantity: number; overlap: boolean }[] = [];
    const sellPrices: { price: number; quantity: number; overlap: boolean }[] = [];

    // Non-overlapping buys: spread below midpoint
    for (let i = 0; i < 6; i++) {
      const price = Math.round((MIDPOINT * (0.5 + 0.08 * i)) * 1e6) / 1e6;
      buyPrices.push({ price, quantity: 100 + i * 50, overlap: false });
    }

    // Non-overlapping sells: spread above midpoint
    for (let i = 0; i < 5; i++) {
      const price = Math.round((MIDPOINT * (1.2 + 0.1 * i)) * 1e6) / 1e6;
      sellPrices.push({ price, quantity: 100 + i * 50, overlap: false });
    }

    // Overlapping prices (creates fills): 6 prices right around midpoint
    const overlapPrices = [
      Math.round(MIDPOINT * 0.99 * 1e6) / 1e6,
      Math.round(MIDPOINT * 1.0 * 1e6) / 1e6,
      Math.round(MIDPOINT * 1.01 * 1e6) / 1e6,
      Math.round(MIDPOINT * 1.02 * 1e6) / 1e6,
      Math.round(MIDPOINT * 1.03 * 1e6) / 1e6,
      Math.round(MIDPOINT * 1.04 * 1e6) / 1e6,
    ];
    for (const p of overlapPrices) {
      buyPrices.push({ price: p, quantity: 200, overlap: true });
      sellPrices.push({ price: p, quantity: 200, overlap: true });
    }

    emit("phase", {
      phase: "orders",
      message: `Placing ${buyPrices.length} buy + ${sellPrices.length} sell orders...`,
      buyCount: buyPrices.length,
      sellCount: sellPrices.length,
      overlapCount: 6,
    });

    let placedCount = 0;
    let fillCount = 0;
    let errorCount = 0;

    // Place non-overlapping buys first (MM-A)
    const nonOverlapBuys = buyPrices.filter((p) => !p.overlap);
    for (let i = 0; i < nonOverlapBuys.length; i++) {
      if (abortSignal?.aborted) throw new Error("Demo aborted");
      const level = nonOverlapBuys[i];
      const priceStr = formatPrice(level.price);
      try {
        const result = await placeOrder(mmA.client!, {
          baseDenom,
          quoteDenom: QUOTE_DENOM,
          side: 1, // BUY
          orderType: 1, // LIMIT
          price: priceStr,
          quantity: toRaw(level.quantity),
          timeInForce: 1, // GTC
        } as any);
        placedCount++;
        emit("order", {
          agent: mmA.name,
          side: "buy",
          price: priceStr,
          priceDisplay: level.price,
          quantity: level.quantity,
          symbol: demoSymbol,
          orderId: result.orderId,
          txHash: result.txHash,
          status: result.success ? "placed" : "failed",
          error: result.error,
          overlap: false,
        });
      } catch (err) {
        errorCount++;
        emit("order", {
          agent: mmA.name,
          side: "buy",
          price: priceStr,
          quantity: level.quantity,
          status: "error",
          error: (err as Error).message.slice(0, 100),
        });
      }
      if (i < nonOverlapBuys.length - 1) await sleep(ORDER_DELAY);
    }

    // Place non-overlapping sells (MM-B)
    const nonOverlapSells = sellPrices.filter((p) => !p.overlap);
    for (let i = 0; i < nonOverlapSells.length; i++) {
      if (abortSignal?.aborted) throw new Error("Demo aborted");
      const level = nonOverlapSells[i];
      const priceStr = formatPrice(level.price);
      try {
        const result = await placeOrder(mmB.client!, {
          baseDenom,
          quoteDenom: QUOTE_DENOM,
          side: 2, // SELL
          orderType: 1, // LIMIT
          price: priceStr,
          quantity: toRaw(level.quantity),
          timeInForce: 1, // GTC
        } as any);
        placedCount++;
        emit("order", {
          agent: mmB.name,
          side: "sell",
          price: priceStr,
          priceDisplay: level.price,
          quantity: level.quantity,
          symbol: demoSymbol,
          orderId: result.orderId,
          txHash: result.txHash,
          status: result.success ? "placed" : "failed",
          error: result.error,
          overlap: false,
        });
      } catch (err) {
        errorCount++;
        emit("order", {
          agent: mmB.name,
          side: "sell",
          price: priceStr,
          quantity: level.quantity,
          status: "error",
          error: (err as Error).message.slice(0, 100),
        });
      }
      if (i < nonOverlapSells.length - 1) await sleep(ORDER_DELAY);
    }

    // Now place overlapping orders (interleaved: buy then sell at same price → fill)
    emit("phase", {
      phase: "fills",
      message: "Placing overlapping orders (will create instant fills)...",
    });

    const overlapBuys = buyPrices.filter((p) => p.overlap);
    const overlapSells = sellPrices.filter((p) => p.overlap);

    for (let i = 0; i < overlapBuys.length; i++) {
      if (abortSignal?.aborted) throw new Error("Demo aborted");

      const buyLevel = overlapBuys[i];
      const sellLevel = overlapSells[i];
      const priceStr = formatPrice(buyLevel.price);

      // Place buy first
      try {
        const buyResult = await placeOrder(mmA.client!, {
          baseDenom,
          quoteDenom: QUOTE_DENOM,
          side: 1,
          orderType: 1,
          price: priceStr,
          quantity: toRaw(buyLevel.quantity),
          timeInForce: 1,
        } as any);
        placedCount++;
        emit("order", {
          agent: mmA.name,
          side: "buy",
          price: priceStr,
          priceDisplay: buyLevel.price,
          quantity: buyLevel.quantity,
          symbol: demoSymbol,
          orderId: buyResult.orderId,
          txHash: buyResult.txHash,
          status: buyResult.success ? "placed" : "failed",
          overlap: true,
        });
      } catch (err) {
        errorCount++;
        emit("order", {
          agent: mmA.name,
          side: "buy",
          price: priceStr,
          status: "error",
          error: (err as Error).message.slice(0, 100),
          overlap: true,
        });
      }

      await sleep(INTERLEAVE_DELAY);

      // Place matching sell → should trigger fill
      try {
        const sellResult = await placeOrder(mmB.client!, {
          baseDenom,
          quoteDenom: QUOTE_DENOM,
          side: 2,
          orderType: 1,
          price: priceStr,
          quantity: toRaw(sellLevel.quantity),
          timeInForce: 1,
        } as any);
        placedCount++;

        const filled = sellResult.success;
        if (filled) fillCount++;

        emit("order", {
          agent: mmB.name,
          side: "sell",
          price: priceStr,
          priceDisplay: sellLevel.price,
          quantity: sellLevel.quantity,
          symbol: demoSymbol,
          orderId: sellResult.orderId,
          txHash: sellResult.txHash,
          status: sellResult.success ? "placed" : "failed",
          overlap: true,
        });

        if (filled) {
          emit("fill", {
            price: priceStr,
            priceDisplay: buyLevel.price,
            quantity: buyLevel.quantity,
            symbol: demoSymbol,
            buyer: mmA.name,
            seller: mmB.name,
            txHash: sellResult.txHash,
          });
        }
      } catch (err) {
        errorCount++;
        emit("order", {
          agent: mmB.name,
          side: "sell",
          price: priceStr,
          status: "error",
          error: (err as Error).message.slice(0, 100),
          overlap: true,
        });
      }

      if (i < overlapBuys.length - 1) await sleep(ORDER_DELAY);
    }

    // ── Phase 7: Taker Market Orders ──
    emit("phase", { phase: "taker", message: "Taker placing market-style orders..." });

    // Taker buys with aggressive limit (acts like market order)
    const takerBuyPrice = formatPrice(Math.round(MIDPOINT * 1.5 * 1e6) / 1e6);
    try {
      const takerBuyResult = await placeOrder(taker.client!, {
        baseDenom,
        quoteDenom: QUOTE_DENOM,
        side: 1, // BUY
        orderType: 1, // LIMIT (aggressive)
        price: takerBuyPrice,
        quantity: toRaw(500),
        timeInForce: 1,
      } as any);
      placedCount++;
      emit("taker", {
        action: "buy",
        price: takerBuyPrice,
        quantity: 500,
        symbol: demoSymbol,
        txHash: takerBuyResult.txHash,
        success: takerBuyResult.success,
      });
    } catch (err) {
      emit("taker", {
        action: "buy",
        status: "error",
        error: (err as Error).message.slice(0, 100),
      });
    }

    await sleep(ORDER_DELAY);

    // Taker sells with aggressive limit
    const takerSellPrice = formatPrice(Math.round(MIDPOINT * 0.5 * 1e6) / 1e6);
    try {
      const takerSellResult = await placeOrder(taker.client!, {
        baseDenom,
        quoteDenom: QUOTE_DENOM,
        side: 2, // SELL
        orderType: 1,
        price: takerSellPrice,
        quantity: toRaw(500),
        timeInForce: 1,
      } as any);
      placedCount++;
      emit("taker", {
        action: "sell",
        price: takerSellPrice,
        quantity: 500,
        symbol: demoSymbol,
        txHash: takerSellResult.txHash,
        success: takerSellResult.success,
      });
    } catch (err) {
      emit("taker", {
        action: "sell",
        status: "error",
        error: (err as Error).message.slice(0, 100),
      });
    }

    // ── Phase 8: Final Summary ──
    await sleep(5000); // wait for chain propagation

    emit("phase", { phase: "summary", message: "Gathering final results..." });

    // Query final orderbook
    const network = NETWORKS[networkName];
    const finalOb = await queryOrderbook(baseDenom, QUOTE_DENOM, networkName);

    // Query open orders per agent
    const mmAOrders = await queryOrdersByCreator(mmA.address, networkName);
    const mmBOrders = await queryOrdersByCreator(mmB.address, networkName);
    const takerOrders = await queryOrdersByCreator(taker.address, networkName);

    emit("summary", {
      token: { symbol: demoSymbol, denom: baseDenom },
      orderbook: { bids: finalOb.bids.length, asks: finalOb.asks.length },
      agents: {
        mmA: { address: mmA.address, openOrders: mmAOrders.length || 0 },
        mmB: { address: mmB.address, openOrders: mmBOrders.length || 0 },
        taker: { address: taker.address, openOrders: takerOrders.length || 0 },
      },
      totals: {
        placed: placedCount,
        fills: fillCount,
        errors: errorCount,
      },
    });

    emit("done", { success: true });

  } catch (err) {
    emit("error", { message: (err as Error).message });
  } finally {
    // Cleanup: disconnect all clients
    for (const client of clients) {
      try { client.disconnect(); } catch { /* ignore */ }
    }
    // Clear mnemonics from memory
    for (const agent of agents) {
      agent.mnemonic = "";
    }
    demoRunning = false;
  }
}
