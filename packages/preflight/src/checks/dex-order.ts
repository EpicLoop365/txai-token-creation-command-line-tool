/**
 * checks/dex-order.ts — Solomente TXAI Preflight Compliance Engine
 *
 * Pipeline for DEX order placement (coreum/dex/MsgPlaceOrder).
 * Validates the trading pair, price, amount, balance on the correct
 * side (base tokens for sell orders, quote tokens for buy orders),
 * gas availability, and compliance.
 */

import { PreflightCheck, DexOrderParams } from "../types.js";
import { CheckId } from "../check-ids.js";
import { IChainQuerier } from "../chain-querier.js";
import {
  validateAddress,
  checkBalance,
  checkGas,
  checkComplianceNFT,
  denomLabel,
} from "./common.js";

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

/** Estimated gas units for a DEX order placement */
const DEX_GAS_ESTIMATE = 250_000;

// ─── RESULT TYPE ────────────────────────────────────────────────────────────

/** Result returned by the DEX order preflight pipeline */
export interface DexOrderResult {
  /** All individual check results */
  checks: PreflightCheck[];
  /** Estimated gas units */
  estimatedGas: number;
  /** Estimated fee in native denom (base units) */
  estimatedFee: string;
}

// ─── PIPELINE ───────────────────────────────────────────────────────────────

/**
 * Run the full preflight pipeline for a DEX order placement.
 *
 * Check order:
 *   1. Sender address validation
 *   2. Both denoms present and different from each other
 *   3. Price is a positive number
 *   4. Amount is a positive integer
 *   5. Balance check (sell side: need base tokens; buy side: need quote = amount * price)
 *   6. Gas fee sufficiency
 *   7. Compliance NFT verification
 *
 * @param querier        - Chain querier instance
 * @param sender         - The trader/signer address
 * @param params         - DEX order parameters (baseDenom, quoteDenom, side, price, amount)
 * @param addressPrefix  - Expected bech32 prefix
 * @returns Pipeline result with checks and gas estimate
 */
export async function dexOrderChecks(
  querier: IChainQuerier,
  sender: string,
  params: DexOrderParams,
  addressPrefix?: string
): Promise<DexOrderResult> {
  const checks: PreflightCheck[] = [];
  const { baseDenom, quoteDenom, side, price, amount } = params;

  // ── 1. Sender address validation ──────────────────────────────────────

  const addrCheck = validateAddress(sender, "sender", addressPrefix);
  checks.push(addrCheck);

  if (!addrCheck.passed) {
    return { checks, estimatedGas: DEX_GAS_ESTIMATE, estimatedFee: "0" };
  }

  // ── 2. Validate denoms are present and different ──────────────────────

  const denomCheck = validateDenoms(baseDenom, quoteDenom);
  checks.push(denomCheck);

  if (!denomCheck.passed) {
    return { checks, estimatedGas: DEX_GAS_ESTIMATE, estimatedFee: "0" };
  }

  // ── 3. Price validation ───────────────────────────────────────────────

  const priceCheck = validatePrice(price);
  checks.push(priceCheck);

  // ── 4. Amount validation ──────────────────────────────────────────────

  const amountCheck = validateAmount(amount);
  checks.push(amountCheck);

  // Short-circuit if params are fundamentally invalid
  if (!priceCheck.passed || !amountCheck.passed) {
    const gasResult = await checkGas(querier, sender, DEX_GAS_ESTIMATE);
    checks.push(gasResult);
    return { checks, estimatedGas: gasResult.estimatedGas, estimatedFee: gasResult.estimatedFee };
  }

  // ── 5. Balance check (depends on order side) ─────────────────────────

  if (side === "sell") {
    // Selling base tokens: need `amount` of base denom
    const balCheck = await checkBalance(
      querier,
      sender,
      baseDenom,
      amount,
      `sell ${amount} ${denomLabel(baseDenom)}`
    );
    checks.push(balCheck);

    if (!balCheck.passed) {
      checks.push({
        id: CheckId.DEX_INSUFFICIENT_BALANCE,
        category: "dex",
        severity: "error",
        passed: false,
        message: `Insufficient ${denomLabel(baseDenom)} to cover the sell order.`,
        suggestion: `Fund the account with enough ${denomLabel(baseDenom)} or reduce the order size.`,
        data: { side, requiredDenom: baseDenom, requiredAmount: amount },
      });
    }
  } else {
    // Buying base tokens: need `amount * price` of quote denom
    const requiredQuote = calculateQuoteRequired(amount, price);

    if (requiredQuote === null) {
      checks.push({
        id: CheckId.DEX_INSUFFICIENT_BALANCE,
        category: "dex",
        severity: "warning",
        passed: true,
        message: "Could not calculate required quote amount. Balance will be checked on-chain.",
      });
    } else {
      const balCheck = await checkBalance(
        querier,
        sender,
        quoteDenom,
        requiredQuote,
        `buy ${amount} ${denomLabel(baseDenom)} at price ${price}`
      );
      checks.push(balCheck);

      if (!balCheck.passed) {
        checks.push({
          id: CheckId.DEX_INSUFFICIENT_BALANCE,
          category: "dex",
          severity: "error",
          passed: false,
          message: `Insufficient ${denomLabel(quoteDenom)} to cover the buy order (need ~${requiredQuote}).`,
          suggestion: `Fund the account with enough ${denomLabel(quoteDenom)} or reduce the order size/price.`,
          data: { side, requiredDenom: quoteDenom, requiredAmount: requiredQuote },
        });
      }
    }
  }

  // ── 6. Gas check ──────────────────────────────────────────────────────

  const gasResult = await checkGas(querier, sender, DEX_GAS_ESTIMATE);
  checks.push(gasResult);

  // ── 7. Compliance NFT ─────────────────────────────────────────────────

  const complianceChecks = await checkComplianceNFT(querier, sender);
  checks.push(...complianceChecks);

  return {
    checks,
    estimatedGas: gasResult.estimatedGas,
    estimatedFee: gasResult.estimatedFee,
  };
}

// ─── PARAMETER VALIDATORS ───────────────────────────────────────────────────

/**
 * Validate that both denoms are provided and are different from each other.
 *
 * @param baseDenom  - The base denomination of the trading pair
 * @param quoteDenom - The quote denomination of the trading pair
 */
function validateDenoms(baseDenom: string, quoteDenom: string): PreflightCheck {
  if (!baseDenom || typeof baseDenom !== "string" || baseDenom.trim() === "") {
    return {
      id: CheckId.DEX_INVALID_PAIR,
      category: "dex",
      severity: "error",
      passed: false,
      message: "Base denomination is missing or empty.",
      suggestion: "Provide a valid base denom (e.g. 'mytoken-testcore1...').",
    };
  }

  if (!quoteDenom || typeof quoteDenom !== "string" || quoteDenom.trim() === "") {
    return {
      id: CheckId.DEX_INVALID_PAIR,
      category: "dex",
      severity: "error",
      passed: false,
      message: "Quote denomination is missing or empty.",
      suggestion: "Provide a valid quote denom (e.g. 'utestcore').",
    };
  }

  if (baseDenom === quoteDenom) {
    return {
      id: CheckId.DEX_INVALID_PAIR,
      category: "dex",
      severity: "error",
      passed: false,
      message: "Base and quote denominations cannot be the same.",
      suggestion: "Select two different tokens for the trading pair.",
      data: { baseDenom, quoteDenom },
    };
  }

  return {
    id: CheckId.DEX_ORDER_OK,
    category: "dex",
    severity: "info",
    passed: true,
    message: `Trading pair: ${denomLabel(baseDenom)} / ${denomLabel(quoteDenom)}.`,
    data: { baseDenom, quoteDenom },
  };
}

/**
 * Validate that the price is a positive number.
 *
 * @param price - Price as a string
 */
function validatePrice(price: string): PreflightCheck {
  if (!price || isNaN(Number(price)) || Number(price) <= 0) {
    return {
      id: CheckId.INVALID_PRICE,
      category: "dex",
      severity: "error",
      passed: false,
      message: `Invalid price: "${price}". Must be a positive number.`,
      suggestion: "Provide a valid price (e.g. '1.5' for 1.5 quote per base).",
    };
  }

  return {
    id: CheckId.PARAMETER_OK,
    category: "dex",
    severity: "info",
    passed: true,
    message: `Price ${price} is valid.`,
  };
}

/**
 * Validate that the order amount is a positive integer.
 *
 * @param amount - Amount as a string in base units
 */
function validateAmount(amount: string): PreflightCheck {
  if (!amount || amount.trim().length === 0) {
    return {
      id: CheckId.INVALID_AMOUNT,
      category: "dex",
      severity: "error",
      passed: false,
      message: "Order amount is empty or missing.",
      suggestion: "Provide a positive integer amount in base units.",
    };
  }

  try {
    if (isNaN(Number(amount)) || BigInt(amount) <= 0n) {
      return {
        id: CheckId.INVALID_AMOUNT,
        category: "dex",
        severity: "error",
        passed: false,
        message: `Invalid order amount: "${amount}". Must be a positive integer in base units.`,
        suggestion: "Provide the amount in the smallest token unit.",
      };
    }
  } catch {
    return {
      id: CheckId.INVALID_AMOUNT,
      category: "dex",
      severity: "error",
      passed: false,
      message: `Invalid order amount: "${amount}". Must be a positive integer.`,
      suggestion: 'Provide a whole number string in base units (e.g. "1000000").',
    };
  }

  return {
    id: CheckId.PARAMETER_OK,
    category: "dex",
    severity: "info",
    passed: true,
    message: `Order amount ${amount} is valid.`,
  };
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

/**
 * Calculate the required quote tokens for a buy order: amount * price.
 * Uses integer arithmetic with sufficient precision to avoid floating-point errors.
 * Returns the required amount as a string, or null if calculation fails.
 *
 * @param amount - Base amount as integer string
 * @param price  - Price as decimal string (e.g. "1.5")
 */
function calculateQuoteRequired(amount: string, price: string): string | null {
  try {
    const amountBig = BigInt(amount);

    // Convert price to integer representation:
    // "1.5"   -> numerator 15,  scale 10
    // "0.001" -> numerator 1,   scale 1000
    // "2"     -> numerator 2,   scale 1
    const parts = price.split(".");
    const decimals = parts[1]?.length ?? 0;
    const scale = 10n ** BigInt(decimals);
    const priceInt = BigInt(parts[0] + (parts[1] ?? ""));

    // quote = amount * priceInt / scale, rounded up to ensure sufficient balance
    const product = amountBig * priceInt;
    const quotient = product / scale;
    const remainder = product % scale;

    // Round up if there's a remainder
    const required = remainder > 0n ? quotient + 1n : quotient;

    return required.toString();
  } catch {
    return null;
  }
}
