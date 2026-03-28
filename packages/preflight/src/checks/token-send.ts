/**
 * checks/token-send.ts — Solomente TXAI Preflight Compliance Engine
 *
 * Pipeline for token send (bank/MsgSend) transactions.
 * Validates the full lifecycle of a token transfer: address format,
 * balance, gas, freeze state, whitelisting, effective amount breakdown
 * (accounting for burn rate and send commission), and compliance.
 */

import { PreflightCheck, TokenSendParams } from "../types.js";
import { CheckId } from "../check-ids.js";
import { IChainQuerier, TokenInfo } from "../chain-querier.js";
import {
  validateAddress,
  checkBalance,
  checkGas,
  checkGlobalFreeze,
  checkSenderFrozen,
  checkComplianceNFT,
  denomLabel,
} from "./common.js";

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

/** Estimated gas units for a simple bank/MsgSend */
const SEND_GAS_ESTIMATE = 120_000;

// ─── RESULT TYPE ────────────────────────────────────────────────────────────

/** Result returned by the token send preflight pipeline */
export interface TokenSendResult {
  /** All individual check results */
  checks: PreflightCheck[];
  /** Estimated gas units */
  estimatedGas: number;
  /** Estimated fee in native denom (base units) */
  estimatedFee: string;
  /** Breakdown of what the recipient actually receives after burn/commission */
  effectiveAmount?: {
    sent: string;
    burned: string;
    commission: string;
    received: string;
  };
}

// ─── PIPELINE ───────────────────────────────────────────────────────────────

/**
 * Run the full preflight pipeline for a token send (bank/MsgSend).
 *
 * Check order:
 *   1. Address validation (sender + recipient)
 *   2. Denom and amount parameter validation
 *   3. Token info fetch (needed for freeze, whitelist, rates)
 *   4. Balance sufficiency
 *   5. Gas fee sufficiency
 *   6. Global freeze status
 *   7. Sender frozen balance
 *   8. Recipient whitelisting (if token has whitelisting feature)
 *   9. Effective amount breakdown (burn rate + send commission)
 *  10. Compliance NFT verification on both parties
 *
 * @param querier        - Chain querier instance for on-chain lookups
 * @param sender         - The sender/signer address
 * @param params         - Token send parameters (recipient, denom, amount)
 * @param addressPrefix  - Expected bech32 prefix (e.g. "testcore", "core")
 * @returns Pipeline result with checks, gas estimate, and effective amount
 */
export async function tokenSendChecks(
  querier: IChainQuerier,
  sender: string,
  params: TokenSendParams,
  addressPrefix?: string
): Promise<TokenSendResult> {
  const checks: PreflightCheck[] = [];
  let effectiveAmount: TokenSendResult["effectiveAmount"] | undefined;

  const { recipient, denom, amount } = params;

  // ── 1. Address validation ─────────────────────────────────────────────

  const senderCheck = validateAddress(sender, "sender", addressPrefix);
  const recipientCheck = validateAddress(recipient, "recipient", addressPrefix);
  checks.push(senderCheck, recipientCheck);

  // If either address is invalid, short-circuit — further checks are meaningless
  if (!senderCheck.passed || !recipientCheck.passed) {
    return { checks, estimatedGas: SEND_GAS_ESTIMATE, estimatedFee: "0" };
  }

  // ── 2. Denom + amount parameter validation ────────────────────────────

  if (!denom || typeof denom !== "string" || denom.trim() === "") {
    checks.push({
      id: CheckId.INVALID_DENOM,
      category: "parameter",
      severity: "error",
      passed: false,
      message: "Token denomination is missing or empty.",
      suggestion: "Provide a valid token denom (e.g. 'utestcore' or 'mytoken-testcore1...').",
    });
    return { checks, estimatedGas: SEND_GAS_ESTIMATE, estimatedFee: "0" };
  }

  if (!amount || isNaN(Number(amount)) || BigInt(amount) <= 0n) {
    checks.push({
      id: CheckId.INVALID_AMOUNT,
      category: "parameter",
      severity: "error",
      passed: false,
      message: `Invalid amount: "${amount}". Must be a positive integer in base units.`,
      suggestion: "Provide the amount in the smallest token unit (e.g. 1000000 for 1 token with 6 decimals).",
    });
    return { checks, estimatedGas: SEND_GAS_ESTIMATE, estimatedFee: "0" };
  }

  checks.push({
    id: CheckId.PARAMETER_OK,
    category: "parameter",
    severity: "info",
    passed: true,
    message: `Parameters valid: sending ${amount} ${denomLabel(denom)} to ${recipient.slice(0, 12)}...`,
  });

  // ── 3. Fetch token info (needed for freeze, whitelist, rates) ─────────

  const [tokenInfo, gasResult] = await Promise.all([
    querier.getTokenInfo(denom),
    checkGas(querier, sender, SEND_GAS_ESTIMATE),
  ]);

  // ── 4. Balance check ──────────────────────────────────────────────────

  const balanceCheck = await checkBalance(
    querier,
    sender,
    denom,
    amount,
    `send ${amount} ${denomLabel(denom)}`
  );
  checks.push(balanceCheck);

  // ── 5. Gas check ──────────────────────────────────────────────────────

  checks.push(gasResult);

  // ── 6. Global freeze ──────────────────────────────────────────────────

  const freezeCheck = checkGlobalFreeze(tokenInfo);
  checks.push(freezeCheck);

  if (!freezeCheck.passed) {
    return {
      checks,
      estimatedGas: gasResult.estimatedGas,
      estimatedFee: gasResult.estimatedFee,
    };
  }

  // ── 7. Sender frozen balance ──────────────────────────────────────────

  if (tokenInfo?.features?.includes("freezing")) {
    const frozenCheck = await checkSenderFrozen(querier, sender, denom, amount);
    checks.push(frozenCheck);
  }

  // ── 8. Whitelist check (if token has whitelisting feature) ────────────

  if (tokenInfo?.features?.includes("whitelisting")) {
    const whitelistCheck = await checkRecipientWhitelist(
      querier,
      recipient,
      denom,
      amount
    );
    checks.push(whitelistCheck);
  }

  // ── 9. Effective amount breakdown (burn rate + send commission) ───────

  effectiveAmount = calculateEffectiveAmount(amount, tokenInfo);
  if (effectiveAmount) {
    checks.push({
      id: CheckId.EFFECTIVE_AMOUNT_INFO,
      category: "balance",
      severity: "info",
      passed: true,
      message:
        `Effective amount breakdown: sending ${effectiveAmount.sent}, ` +
        `burn ${effectiveAmount.burned}, commission ${effectiveAmount.commission}, ` +
        `recipient receives ${effectiveAmount.received}.`,
      data: { ...effectiveAmount },
    });
  }

  // ── 10. Compliance NFT on both parties ────────────────────────────────

  const complianceChecks = await checkComplianceNFT(querier, sender);
  checks.push(...complianceChecks);

  const recipientCompliance = await checkComplianceNFT(querier, recipient);
  checks.push(...recipientCompliance);

  // ── Build result ──────────────────────────────────────────────────────

  return {
    checks,
    estimatedGas: gasResult.estimatedGas,
    estimatedFee: gasResult.estimatedFee,
    effectiveAmount,
  };
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

/**
 * Check if the recipient is whitelisted for the given token and
 * whether the whitelisted limit is sufficient for the send amount.
 *
 * @param querier   - Chain querier instance
 * @param recipient - Recipient address
 * @param denom     - Token denomination
 * @param amount    - Amount being sent (base units)
 */
async function checkRecipientWhitelist(
  querier: IChainQuerier,
  recipient: string,
  denom: string,
  amount: string
): Promise<PreflightCheck> {
  try {
    const whitelistedBalance = await querier.getWhitelistedBalance(recipient, denom);
    const whitelistedBig = BigInt(whitelistedBalance);
    const amountBig = BigInt(amount);

    if (whitelistedBig <= 0n) {
      return {
        id: CheckId.RECIPIENT_NOT_WHITELISTED,
        category: "whitelist",
        severity: "error",
        passed: false,
        message: `Recipient is not whitelisted for ${denomLabel(denom)}. Transfer will be rejected.`,
        suggestion:
          "The token issuer must whitelist the recipient address before transfers can be received.",
        data: { recipient, denom },
      };
    }

    if (whitelistedBig < amountBig) {
      return {
        id: CheckId.WHITELIST_LIMIT_LOW,
        category: "whitelist",
        severity: "warning",
        passed: true,
        message:
          `Recipient whitelist limit (${whitelistedBalance}) is less than send amount (${amount}). ` +
          `The chain may accept up to the whitelisted limit.`,
        suggestion: "Request the token issuer to increase the recipient's whitelist limit.",
        data: { whitelistedBalance, amount, denom },
      };
    }

    return {
      id: CheckId.WHITELIST_OK,
      category: "whitelist",
      severity: "info",
      passed: true,
      message: `Recipient is whitelisted for ${denomLabel(denom)} (limit: ${whitelistedBalance}).`,
      data: { whitelistedBalance, denom },
    };
  } catch {
    return {
      id: CheckId.WHITELIST_OK,
      category: "whitelist",
      severity: "info",
      passed: true,
      message: "Could not verify whitelist status (token may not require whitelisting).",
    };
  }
}

/**
 * Calculate the effective amount the recipient receives after burn rate
 * and send commission rate are applied.
 *
 * Coreum stores rates as decimal strings. The burn amount and commission
 * are calculated as a proportion of the sent amount. On Coreum, these fees
 * are deducted from the sent amount (recipient receives less).
 *
 * @param amount    - Amount being sent in base units
 * @param tokenInfo - Token info with burnRate and sendCommissionRate
 * @returns Breakdown object, or undefined if no rates apply
 */
function calculateEffectiveAmount(
  amount: string,
  tokenInfo: TokenInfo | null
): TokenSendResult["effectiveAmount"] | undefined {
  if (!tokenInfo) return undefined;

  const burnRateRaw = tokenInfo.burnRate || "0";
  const commissionRateRaw = tokenInfo.sendCommissionRate || "0";

  // If both are zero, no fee calculation needed
  if (burnRateRaw === "0" && commissionRateRaw === "0") return undefined;

  const amountBig = BigInt(amount);

  // Rates may be stored as 10^18-precision integers or as decimal strings.
  // Handle both formats: if the rate looks like a large integer, treat as 10^18 precision.
  // Otherwise, parse as a decimal and convert to basis points.
  const burned = calculateFeeComponent(amountBig, burnRateRaw);
  const commission = calculateFeeComponent(amountBig, commissionRateRaw);
  const received = amountBig - burned - commission;

  return {
    sent: amount,
    burned: burned.toString(),
    commission: commission.toString(),
    received: received > 0n ? received.toString() : "0",
  };
}

/**
 * Calculate a fee component (burn or commission) from a rate string.
 * Supports both 10^18-precision integer rates and decimal string rates.
 *
 * @param amount - Base amount as BigInt
 * @param rate   - Rate string (e.g. "50000000000000000" for 5% or "0.05")
 */
function calculateFeeComponent(amount: bigint, rate: string): bigint {
  if (rate === "0") return 0n;

  // If the rate contains a decimal point, it's a human-readable rate (e.g. "0.05")
  if (rate.includes(".")) {
    const parts = rate.split(".");
    const decimals = parts[1]?.length ?? 0;
    const scale = 10n ** BigInt(decimals);
    const rateInt = BigInt(parts[0] + (parts[1] ?? ""));
    return (amount * rateInt) / scale;
  }

  // Otherwise treat as 10^18 precision integer
  const PRECISION = BigInt("1000000000000000000"); // 10^18
  return (amount * BigInt(rate)) / PRECISION;
}
