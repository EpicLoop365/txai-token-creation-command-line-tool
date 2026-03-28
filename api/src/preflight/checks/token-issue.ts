/**
 * checks/token-issue.ts — Solomente TXAI Preflight Compliance Engine
 *
 * Pipeline for smart token issuance (coreum/asset/ft/MsgIssue).
 * Validates every parameter of a new token before the issuance message
 * is signed: symbol format, subunit, precision, rates, features,
 * description/URI lengths, issuance fee coverage, and compliance.
 */

import { PreflightCheck, TokenIssueParams } from "../types";
import { CheckId } from "../check-ids";
import { IChainQuerier } from "../chain-querier";
import {
  validateAddress,
  checkBalance,
  checkGas,
  checkComplianceNFT,
  denomLabel,
} from "./common";

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

/** Estimated gas units for a token issuance message */
const ISSUE_GAS_ESTIMATE = 350_000;

/** Maximum allowed symbol length (Coreum constraint) */
const MAX_SYMBOL_LENGTH = 128;

/** Maximum description length */
const MAX_DESCRIPTION_LENGTH = 200;

/** Maximum URI length */
const MAX_URI_LENGTH = 256;

/** Maximum precision (decimal places) */
const MAX_PRECISION = 20;

/** Maximum decimal places for burn rate and send commission rate */
const MAX_RATE_DECIMALS = 4;

/** Maximum allowed rate value (100% = 1.0) */
const MAX_RATE = 1.0;

/**
 * Issuance fee by network in native micro-units.
 * Testnet: 10,000,000 utestcore (10 TESTCORE)
 * Mainnet: 100,000,000 ucore (100 CORE)
 */
const ISSUANCE_FEES: Record<string, string> = {
  utestcore: "10000000",
  ucore: "100000000",
  udevcore: "10000000",
};

/** Valid smart token features on Coreum */
const VALID_FEATURES = new Set([
  "minting",
  "burning",
  "freezing",
  "whitelisting",
  "ibc",
  "block_smart_contracts",
  "clawback",
  "extension",
]);

// ─── RESULT TYPE ────────────────────────────────────────────────────────────

/** Result returned by the token issuance preflight pipeline */
export interface TokenIssueResult {
  /** All individual check results */
  checks: PreflightCheck[];
  /** Estimated gas units */
  estimatedGas: number;
  /** Estimated fee in native denom (base units) */
  estimatedFee: string;
}

// ─── PIPELINE ───────────────────────────────────────────────────────────────

/**
 * Run the full preflight pipeline for smart token issuance.
 *
 * Check order:
 *   1. Sender address validation
 *   2. Symbol format (alphanumeric, max 128 chars)
 *   3. Subunit format (lowercase alphanumeric)
 *   4. Initial amount validation (positive integer)
 *   5. Precision (0–20)
 *   6. Description length (max 200)
 *   7. URI length (max 256)
 *   8. Burn rate precision (max 4 decimal places) and range (0–1)
 *   9. Send commission rate precision (max 4 decimal places) and range (0–1)
 *  10. Feature validation against allowed set
 *  11. Issuance fee info + balance check (fee + gas)
 *  12. Gas check
 *  13. Compliance NFT verification
 *
 * @param querier        - Chain querier instance
 * @param sender         - The issuer/signer address
 * @param params         - Token issuance parameters
 * @param addressPrefix  - Expected bech32 prefix
 * @returns Pipeline result with checks and gas estimate
 */
export async function tokenIssueChecks(
  querier: IChainQuerier,
  sender: string,
  params: TokenIssueParams,
  addressPrefix?: string
): Promise<TokenIssueResult> {
  const checks: PreflightCheck[] = [];

  // ── 1. Sender address validation ──────────────────────────────────────

  const senderCheck = validateAddress(sender, "sender", addressPrefix);
  checks.push(senderCheck);

  if (!senderCheck.passed) {
    return { checks, estimatedGas: ISSUE_GAS_ESTIMATE, estimatedFee: "0" };
  }

  // ── 2. Symbol format ──────────────────────────────────────────────────

  checks.push(validateSymbol(params.symbol));

  // ── 3. Subunit format ─────────────────────────────────────────────────

  checks.push(validateSubunit(params.subunit));

  // ── 4. Initial amount ─────────────────────────────────────────────────

  checks.push(validateInitialAmount(params.initialAmount));

  // ── 5. Precision ──────────────────────────────────────────────────────

  if (params.precision !== undefined) {
    checks.push(validatePrecision(params.precision));
  }

  // ── 6. Description length ─────────────────────────────────────────────

  if (params.description !== undefined) {
    checks.push(validateDescription(params.description));
  }

  // ── 7. URI length ─────────────────────────────────────────────────────

  if (params.uri !== undefined) {
    checks.push(validateUri(params.uri));
  }

  // ── 8. Burn rate ──────────────────────────────────────────────────────

  if (params.burnRate !== undefined && params.burnRate !== "0") {
    checks.push(...validateRate(params.burnRate, "burn rate", "BURN"));
  }

  // ── 9. Send commission rate ───────────────────────────────────────────

  if (params.sendCommissionRate !== undefined && params.sendCommissionRate !== "0") {
    checks.push(...validateRate(params.sendCommissionRate, "send commission rate", "COMMISSION"));
  }

  // ── 10. Feature validation ────────────────────────────────────────────

  if (params.features && params.features.length > 0) {
    checks.push(validateFeatures(params.features));
  }

  // ── 11. Issuance fee info + balance for fee ───────────────────────────

  const nativeDenom = querier.getNativeDenom();
  const issuanceFee = ISSUANCE_FEES[nativeDenom] ?? ISSUANCE_FEES.utestcore;

  checks.push({
    id: CheckId.ISSUANCE_FEE_INFO,
    category: "balance",
    severity: "info",
    passed: true,
    message: `Token issuance requires a fee of ${issuanceFee} ${denomLabel(nativeDenom)} (${nativeDenom}).`,
    data: { issuanceFee, nativeDenom },
  });

  // Check balance covers the issuance fee + gas
  const gasResult = await checkGas(querier, sender, ISSUE_GAS_ESTIMATE);
  const totalNeeded = BigInt(issuanceFee) + BigInt(gasResult.estimatedFee);

  try {
    const balance = await querier.getBalance(sender, nativeDenom);
    const balBig = BigInt(balance);

    if (balBig < totalNeeded) {
      checks.push({
        id: CheckId.BALANCE_INSUFFICIENT,
        category: "balance",
        severity: "error",
        passed: false,
        message: `Insufficient funds for issuance fee + gas. Have ${balance} ${nativeDenom}, need ~${totalNeeded.toString()}.`,
        suggestion: `Fund the account with at least ${(totalNeeded - balBig).toString()} more ${nativeDenom}. On testnet, use the faucet.`,
        data: { balance, issuanceFee, gasEstimate: gasResult.estimatedFee, totalNeeded: totalNeeded.toString() },
      });
    } else {
      checks.push({
        id: CheckId.BALANCE_OK,
        category: "balance",
        severity: "info",
        passed: true,
        message: `Balance sufficient for issuance fee + gas: ${balance} ${nativeDenom} (need ~${totalNeeded.toString()}).`,
        data: { balance, issuanceFee, totalNeeded: totalNeeded.toString() },
      });
    }
  } catch {
    checks.push({
      id: CheckId.BALANCE_QUERY_FAILED,
      category: "balance",
      severity: "warning",
      passed: true,
      message: `Could not verify balance for issuance fee. Ensure you have at least ${totalNeeded.toString()} ${nativeDenom}.`,
    });
  }

  // ── 12. Gas check ─────────────────────────────────────────────────────

  checks.push(gasResult);

  // ── 13. Compliance NFT ────────────────────────────────────────────────

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
 * Validate the token symbol: must be alphanumeric and max 128 characters.
 *
 * @param symbol - The token symbol string to validate
 */
function validateSymbol(symbol: string): PreflightCheck {
  if (!symbol || symbol.trim().length === 0) {
    return {
      id: CheckId.INVALID_SYMBOL,
      category: "parameter",
      severity: "error",
      passed: false,
      message: "Token symbol is empty or missing.",
      suggestion: 'Provide a non-empty alphanumeric symbol (e.g. "MYTOKEN").',
    };
  }

  if (!/^[a-zA-Z0-9]+$/.test(symbol)) {
    return {
      id: CheckId.INVALID_SYMBOL,
      category: "parameter",
      severity: "error",
      passed: false,
      message: `Symbol "${symbol}" contains invalid characters. Only alphanumeric characters are allowed.`,
      suggestion: "Use only letters (A-Z, a-z) and digits (0-9) in the symbol.",
    };
  }

  if (symbol.length > MAX_SYMBOL_LENGTH) {
    return {
      id: CheckId.SYMBOL_TOO_LONG,
      category: "parameter",
      severity: "error",
      passed: false,
      message: `Symbol "${symbol}" is ${symbol.length} characters (max ${MAX_SYMBOL_LENGTH}).`,
      suggestion: `Shorten the symbol to ${MAX_SYMBOL_LENGTH} characters or fewer.`,
    };
  }

  return {
    id: CheckId.PARAMETER_OK,
    category: "parameter",
    severity: "info",
    passed: true,
    message: `Symbol "${symbol}" is valid.`,
  };
}

/**
 * Validate the token subunit: must be lowercase alphanumeric.
 *
 * @param subunit - The token subunit string to validate
 */
function validateSubunit(subunit: string): PreflightCheck {
  if (!subunit || subunit.trim().length === 0) {
    return {
      id: CheckId.INVALID_SYMBOL,
      category: "parameter",
      severity: "error",
      passed: false,
      message: "Token subunit is empty or missing.",
      suggestion: 'Provide a lowercase alphanumeric subunit (e.g. "mytoken").',
    };
  }

  if (!/^[a-z][a-z0-9]*$/.test(subunit)) {
    return {
      id: CheckId.INVALID_SYMBOL,
      category: "parameter",
      severity: "error",
      passed: false,
      message: `Subunit "${subunit}" must start with a letter and contain only lowercase alphanumeric characters.`,
      suggestion: 'Use a subunit like "mytoken", "agentcoin", or "txusd".',
    };
  }

  return {
    id: CheckId.PARAMETER_OK,
    category: "parameter",
    severity: "info",
    passed: true,
    message: `Subunit "${subunit}" is valid.`,
  };
}

/**
 * Validate the initial token supply amount: must be a positive integer string.
 *
 * @param amount - The initial supply amount as a string
 */
function validateInitialAmount(amount: string): PreflightCheck {
  if (!amount || amount.trim().length === 0) {
    return {
      id: CheckId.INVALID_AMOUNT,
      category: "parameter",
      severity: "error",
      passed: false,
      message: "Initial amount is empty or missing.",
      suggestion: "Provide a positive integer for the initial token supply.",
    };
  }

  try {
    const val = BigInt(amount);
    if (val <= 0n) {
      return {
        id: CheckId.INVALID_AMOUNT,
        category: "parameter",
        severity: "error",
        passed: false,
        message: `Initial amount "${amount}" must be greater than zero.`,
        suggestion: "Provide a positive integer for the initial supply.",
      };
    }
  } catch {
    return {
      id: CheckId.INVALID_AMOUNT,
      category: "parameter",
      severity: "error",
      passed: false,
      message: `Initial amount "${amount}" is not a valid integer.`,
      suggestion: 'Provide a whole number string (e.g. "1000000").',
    };
  }

  return {
    id: CheckId.PARAMETER_OK,
    category: "parameter",
    severity: "info",
    passed: true,
    message: `Initial amount ${amount} is valid.`,
  };
}

/**
 * Validate precision (decimal places): must be an integer between 0 and 20.
 *
 * @param precision - The number of decimal places
 */
function validatePrecision(precision: number): PreflightCheck {
  if (!Number.isInteger(precision) || precision < 0 || precision > MAX_PRECISION) {
    return {
      id: CheckId.INVALID_AMOUNT,
      category: "parameter",
      severity: "error",
      passed: false,
      message: `Precision ${precision} is out of range. Must be 0–${MAX_PRECISION}.`,
      suggestion: `Set precision to an integer between 0 and ${MAX_PRECISION}. Common values: 6 (like USDC), 8 (like BTC), 18 (like ETH).`,
    };
  }

  return {
    id: CheckId.PARAMETER_OK,
    category: "parameter",
    severity: "info",
    passed: true,
    message: `Precision ${precision} is valid.`,
  };
}

/**
 * Validate description length: max 200 characters.
 *
 * @param description - The token description string
 */
function validateDescription(description: string): PreflightCheck {
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return {
      id: CheckId.PARAMETER_OK,
      category: "parameter",
      severity: "error",
      passed: false,
      message: `Description is ${description.length} characters (max ${MAX_DESCRIPTION_LENGTH}).`,
      suggestion: `Shorten the description to ${MAX_DESCRIPTION_LENGTH} characters or fewer.`,
    };
  }

  return {
    id: CheckId.PARAMETER_OK,
    category: "parameter",
    severity: "info",
    passed: true,
    message: `Description length (${description.length}) is within limits.`,
  };
}

/**
 * Validate URI length: max 256 characters.
 *
 * @param uri - The token URI string
 */
function validateUri(uri: string): PreflightCheck {
  if (uri.length > MAX_URI_LENGTH) {
    return {
      id: CheckId.URI_TOO_LONG,
      category: "parameter",
      severity: "error",
      passed: false,
      message: `URI is ${uri.length} characters (max ${MAX_URI_LENGTH}).`,
      suggestion: `Shorten the URI to ${MAX_URI_LENGTH} characters or fewer, or use a URL shortener.`,
    };
  }

  return {
    id: CheckId.PARAMETER_OK,
    category: "parameter",
    severity: "info",
    passed: true,
    message: `URI length (${uri.length}) is within limits.`,
  };
}

/**
 * Validate a rate (burn rate or send commission rate):
 *  - Must be a valid number
 *  - Must be between 0 and 1 (inclusive)
 *  - Must have at most 4 decimal places
 *
 * @param rate   - Rate as a decimal string (e.g. "0.01")
 * @param label  - Human-readable label for messages
 * @param prefix - "BURN" or "COMMISSION" for check ID selection
 */
function validateRate(
  rate: string,
  label: string,
  prefix: "BURN" | "COMMISSION"
): PreflightCheck[] {
  const checks: PreflightCheck[] = [];
  const num = parseFloat(rate);

  if (isNaN(num)) {
    checks.push({
      id: prefix === "BURN" ? CheckId.BURN_RATE_PRECISION : CheckId.COMMISSION_RATE_PRECISION,
      category: "parameter",
      severity: "error",
      passed: false,
      message: `Invalid ${label}: "${rate}" is not a valid number.`,
      suggestion: 'Provide a decimal between 0 and 1 (e.g. "0.01" for 1%).',
    });
    return checks;
  }

  // Range check: 0 to 1
  if (num < 0 || num > MAX_RATE) {
    checks.push({
      id: prefix === "BURN" ? CheckId.BURN_RATE_OUT_OF_RANGE : CheckId.COMMISSION_RATE_OUT_OF_RANGE,
      category: "parameter",
      severity: "error",
      passed: false,
      message: `${label} ${rate} is out of range. Must be between 0 and ${MAX_RATE} (0% to 100%).`,
      suggestion: 'Use a value like "0.01" for 1% or "0.1" for 10%.',
    });
  }

  // Precision check: max 4 decimal places
  const decimalPart = rate.includes(".") ? rate.split(".")[1] ?? "" : "";
  if (decimalPart.length > MAX_RATE_DECIMALS) {
    checks.push({
      id: prefix === "BURN" ? CheckId.BURN_RATE_PRECISION : CheckId.COMMISSION_RATE_PRECISION,
      category: "parameter",
      severity: "error",
      passed: false,
      message: `${label} "${rate}" has ${decimalPart.length} decimal places (max ${MAX_RATE_DECIMALS}).`,
      suggestion: `Round to at most ${MAX_RATE_DECIMALS} decimal places.`,
    });
  }

  if (checks.length === 0) {
    checks.push({
      id: CheckId.PARAMETER_OK,
      category: "parameter",
      severity: "info",
      passed: true,
      message: `${label} ${rate} (${(num * 100).toFixed(2)}%) is valid.`,
    });
  }

  return checks;
}

/**
 * Validate token features against the allowed set.
 *
 * @param features - Array of feature strings to validate
 */
function validateFeatures(features: string[]): PreflightCheck {
  const invalid = features.filter((f) => !VALID_FEATURES.has(f));

  if (invalid.length > 0) {
    return {
      id: CheckId.PARAMETER_OK,
      category: "parameter",
      severity: "error",
      passed: false,
      message: `Invalid feature(s): ${invalid.join(", ")}. Allowed: ${[...VALID_FEATURES].join(", ")}.`,
      suggestion: "Remove or correct the invalid features.",
      data: { invalid, valid: [...VALID_FEATURES] },
    };
  }

  return {
    id: CheckId.PARAMETER_OK,
    category: "parameter",
    severity: "info",
    passed: true,
    message: `Features are valid: ${features.join(", ")}.`,
    data: { features },
  };
}
