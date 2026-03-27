/**
 * @txai/agent-sdk — Market Maker Strategy
 *
 * Deploys 3 agents to create a full orderbook for a token:
 * - Market Maker A (Buyer): Places buy limit orders at various price levels
 * - Market Maker B (Seller): Places sell limit orders, with some overlapping buyer prices
 * - Taker Bot: Sweeps the orderbook with aggressive market-like orders
 *
 * @example
 * ```typescript
 * import { Swarm, MarketMakerStrategy } from '@txai/agent-sdk';
 *
 * const swarm = new Swarm({ network: 'testnet' });
 * swarm.createAgent('MM-A', 'buyer');
 * swarm.createAgent('MM-B', 'seller');
 * swarm.createAgent('Taker', 'taker');
 *
 * await swarm.initAll();
 * await swarm.fundAll();
 *
 * const result = await swarm.execute(new MarketMakerStrategy({
 *   baseDenom: 'mytoken-testcore1abc...',
 *   basePrice: 0.001,
 * }));
 *
 * console.log(`Placed ${result.ordersPlaced} orders, ${result.fills} fills`);
 * swarm.disconnectAll();
 * ```
 */

import { Swarm, Strategy, StrategyResult } from "../swarm";
import { StrategyConfig, DexSide } from "../types";

// ─── Price Utilities ─────────────────────────────────────────────────────────

/**
 * Format a decimal price into Coreum DEX-compatible format.
 * Coreum requires: integer mantissa, no trailing zeros, no decimals.
 * Example: 0.0015 → "15e-4"
 */
function formatPrice(price: number): string {
  const s = price.toExponential();
  const [mantissaStr, expStr] = s.split("e");
  let exp = parseInt(expStr);
  const parts = mantissaStr.split(".");
  const fracPart = parts[1] || "";
  let digits = parts[0] + fracPart;
  exp = exp - fracPart.length;

  // Remove trailing zeros from mantissa
  while (digits.length > 1 && digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    exp++;
  }

  if (exp === 0) return digits;
  return `${digits}e${exp}`;
}

/**
 * Round a price to the nearest tick (10^-6).
 */
function roundToTick(price: number): number {
  return Math.round(price * 1e6) / 1e6;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Strategy ────────────────────────────────────────────────────────────────

export class MarketMakerStrategy implements Strategy {
  readonly name = "Market Maker";
  private config: Required<StrategyConfig>;

  constructor(config: StrategyConfig) {
    this.config = {
      baseDenom: config.baseDenom,
      quoteDenom: config.quoteDenom || "utestcore",
      basePrice: config.basePrice ?? 0.001,
      buyOrders: config.buyOrders ?? 12,
      sellOrders: config.sellOrders ?? 11,
      overlapCount: config.overlapCount ?? 6,
      takerEnabled: config.takerEnabled ?? true,
      sellerTokenAmount: config.sellerTokenAmount ?? 5000,
      takerTokenAmount: config.takerTokenAmount ?? 2000,
    };
  }

  async run(
    swarm: Swarm,
    emit: (event: string, data: Record<string, unknown>) => void
  ): Promise<StrategyResult> {
    const { baseDenom, quoteDenom, basePrice, buyOrders, sellOrders, overlapCount } =
      this.config;

    const buyer = swarm.getAgentsByRole("buyer")[0];
    const seller = swarm.getAgentsByRole("seller")[0];
    const taker = swarm.getAgentsByRole("taker")[0];

    if (!buyer || !seller || !taker) {
      throw new Error(
        "MarketMakerStrategy requires agents with roles: buyer, seller, taker"
      );
    }

    const tokenSymbol = baseDenom.split("-")[0].toUpperCase();
    const ORDER_DELAY = 5000;
    const INTERLEAVE_DELAY = 2000;

    let placedCount = 0;
    let fillCount = 0;
    let errorCount = 0;

    // ── Helper: place order and emit events ──
    async function placeAndEmit(
      agent: typeof buyer,
      side: number,
      price: number,
      quantity: number,
      isOverlap: boolean
    ) {
      const priceFormatted = formatPrice(roundToTick(price));
      const rawQty = (quantity * 1e6).toString();

      try {
        const result = await agent.placeLimitOrder({
          baseDenom,
          quoteDenom,
          side,
          price: priceFormatted,
          quantity: rawQty,
        });

        if (result.success) {
          placedCount++;
          emit("order", {
            agent: agent.name,
            side: side === 1 ? "buy" : "sell",
            price: priceFormatted,
            priceDisplay: roundToTick(price).toFixed(10),
            quantity,
            symbol: tokenSymbol,
            status: "placed",
            txHash: result.txHash,
            overlap: isOverlap,
          });
        } else {
          errorCount++;
          emit("order", {
            agent: agent.name,
            side: side === 1 ? "buy" : "sell",
            price: priceFormatted,
            quantity,
            symbol: tokenSymbol,
            status: "error",
            error: result.error,
          });
        }
      } catch (err) {
        errorCount++;
        emit("order", {
          agent: agent.name,
          side: side === 1 ? "buy" : "sell",
          price: priceFormatted,
          quantity,
          symbol: tokenSymbol,
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    // ── Phase: Non-overlapping Buy Orders ──
    emit("phase", { phase: "orders", message: "Placing buy orders..." });

    const nonOverlapBuys = buyOrders - overlapCount;
    const buyMultipliers = Array.from({ length: nonOverlapBuys }, (_, i) => {
      return 0.5 + (i / nonOverlapBuys) * 0.49; // 0.50 → 0.99
    });

    for (let i = 0; i < buyMultipliers.length; i++) {
      if (swarm.aborted) throw new Error("Aborted");
      const price = roundToTick(basePrice * buyMultipliers[i]);
      const qty = Math.floor(Math.random() * 20) + 5;
      await placeAndEmit(buyer, DexSide.BUY, price, qty, false);
      await sleep(ORDER_DELAY);
    }

    // ── Phase: Non-overlapping Sell Orders ──
    emit("phase", { phase: "orders", message: "Placing sell orders..." });
    await sleep(INTERLEAVE_DELAY);

    const nonOverlapSells = sellOrders - overlapCount;
    const sellMultipliers = Array.from({ length: nonOverlapSells }, (_, i) => {
      return 1.1 + (i / nonOverlapSells) * 0.9; // 1.10 → 2.00
    });

    for (let i = 0; i < sellMultipliers.length; i++) {
      if (swarm.aborted) throw new Error("Aborted");
      const price = roundToTick(basePrice * sellMultipliers[i]);
      const qty = Math.floor(Math.random() * 20) + 5;
      await placeAndEmit(seller, DexSide.SELL, price, qty, false);
      await sleep(ORDER_DELAY);
    }

    // ── Phase: Overlapping Orders (create fills) ──
    emit("phase", {
      phase: "fills",
      message: "Creating overlapping orders for fills...",
    });
    await sleep(INTERLEAVE_DELAY);

    const overlapPrices = Array.from({ length: overlapCount }, (_, i) => {
      return roundToTick(basePrice * (1.0 + (i + 1) * 0.01)); // 1.01, 1.02, ...
    });

    for (let i = 0; i < overlapPrices.length; i++) {
      if (swarm.aborted) throw new Error("Aborted");

      // Buyer places buy at overlap price
      const buyQty = Math.floor(Math.random() * 15) + 10;
      await placeAndEmit(buyer, DexSide.BUY, overlapPrices[i], buyQty, true);
      await sleep(ORDER_DELAY);

      // Seller places sell at same price → fill!
      const sellQty = Math.floor(Math.random() * 10) + 5;
      await placeAndEmit(seller, DexSide.SELL, overlapPrices[i], sellQty, true);
      await sleep(INTERLEAVE_DELAY);

      // Emit fill event
      fillCount++;
      emit("fill", {
        price: formatPrice(overlapPrices[i]),
        priceDisplay: overlapPrices[i].toFixed(10),
        buyQty,
        symbol: tokenSymbol,
        buyer: buyer.name,
        seller: seller.name,
      });

      if (i < overlapPrices.length - 1) await sleep(ORDER_DELAY);
    }

    // ── Phase: Taker Sweeps ──
    if (this.config.takerEnabled) {
      emit("phase", { phase: "taker", message: "Taker sweeping the orderbook..." });

      // Taker buys aggressively
      const takerBuyPrice = roundToTick(basePrice * 1.5);
      await placeAndEmit(taker, DexSide.BUY, takerBuyPrice, 100, false);
      await sleep(ORDER_DELAY);

      // Taker sells aggressively
      const takerSellPrice = roundToTick(basePrice * 0.4);
      await placeAndEmit(taker, DexSide.SELL, takerSellPrice, 100, false);
    }

    return {
      success: true,
      ordersPlaced: placedCount,
      fills: fillCount,
      errors: errorCount,
      token: tokenSymbol,
    };
  }
}
