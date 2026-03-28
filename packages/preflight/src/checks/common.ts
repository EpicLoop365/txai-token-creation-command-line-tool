/**
 * checks/common.ts — Solomente TXAI Preflight Compliance Engine
 *
 * Shared check builders used across multiple transaction pipelines.
 * Each function returns one or more PreflightCheck objects that can
 * be spread into the final checks array.
 */

import { PreflightCheck, ComplianceNFT } from "../types.js";
import { CheckId } from "../check-ids.js";
import { IChainQuerier, TokenInfo } from "../chain-querier.js";

// ─── ADDRESS VALIDATION ─────────────────────────────────────────────────────

/**
 * Validate a bech32 address format.
 * Checks length, character set, and optional prefix matching.
 *
 * @param address - The address to validate
 * @param label   - Human label like "sender" or "recipient"
 * @param prefix  - Expected bech32 prefix (e.g. "testcore", "core")
 */
export function validateAddress(
  address: string,
  label: string = "address",
  prefix?: string
): PreflightCheck {
  if (!address || typeof address !== "string") {
    return {
      id: label === "sender" ? CheckId.INVALID_SENDER_ADDRESS : CheckId.INVALID_RECIPIENT_ADDRESS,
      category: "parameter",
      severity: "error",
      passed: false,
      message: `The ${label} address is empty or missing.`,
      suggestion: `Provide a valid bech32 ${label} address.`,
    };
  }

  // Basic bech32 structure: prefix + "1" + data (at least 6 chars data)
  const bech32Regex = /^[a-z]+1[a-z0-9]{6,}$/i;
  if (!bech32Regex.test(address)) {
    return {
      id: label === "sender" ? CheckId.INVALID_SENDER_ADDRESS : CheckId.INVALID_RECIPIENT_ADDRESS,
      category: "parameter",
      severity: "error",
      passed: false,
      message: `The ${label} address "${truncateAddr(address)}" is not a valid bech32 address.`,
      suggestion: `Ensure the address starts with the correct prefix (e.g. "testcore1..." or "core1...") and contains only lowercase alphanumeric characters.`,
    };
  }

  // Check prefix if specified
  if (prefix && !address.startsWith(prefix + "1")) {
    return {
      id: label === "sender" ? CheckId.INVALID_SENDER_ADDRESS : CheckId.INVALID_RECIPIENT_ADDRESS,
      category: "parameter",
      severity: "error",
      passed: false,
      message: `The ${label} address has prefix "${address.split("1")[0]}" but expected "${prefix}". Wrong network?`,
      suggestion: `Use an address with the "${prefix}" prefix for this network.`,
    };
  }

  return {
    id: CheckId.ADDRESS_VALIDATION_OK,
    category: "parameter",
    severity: "info",
    passed: true,
    message: `The ${label} address "${truncateAddr(address)}" is valid.`,
  };
}

// ─── BALANCE CHECK ──────────────────────────────────────────────────────────

/**
 * Check that an address has sufficient balance of a given denom.
 *
 * @param querier        - Chain querier instance
 * @param address        - Address to check
 * @param denom          - Token denomination
 * @param requiredAmount - Required amount in base units (string)
 * @param label          - Context label for messages (e.g. "send 1000 MYTOKEN")
 */
export async function checkBalance(
  querier: IChainQuerier,
  address: string,
  denom: string,
  requiredAmount: string,
  label?: string
): Promise<PreflightCheck> {
  try {
    const balance = await querier.getBalance(address, denom);
    const balBig = BigInt(balance);
    const reqBig = BigInt(requiredAmount);

    if (balBig < reqBig) {
      const deficit = (reqBig - balBig).toString();
      return {
        id: CheckId.BALANCE_INSUFFICIENT,
        category: "balance",
        severity: "error",
        passed: false,
        message: `Insufficient balance${label ? ` to ${label}` : ""}. Have ${balance}, need ${requiredAmount}.`,
        suggestion: `Fund the account with at least ${deficit} more units of ${denomLabel(denom)}.`,
        data: { balance, required: requiredAmount, deficit, denom },
      };
    }

    return {
      id: CheckId.BALANCE_OK,
      category: "balance",
      severity: "info",
      passed: true,
      message: `Balance sufficient: ${balance} ${denomLabel(denom)} (need ${requiredAmount}).`,
      data: { balance, required: requiredAmount, denom },
    };
  } catch (err) {
    return {
      id: CheckId.BALANCE_QUERY_FAILED,
      category: "balance",
      severity: "warning",
      passed: true, // Don't block on query failure — let the chain reject it
      message: `Could not verify balance for ${denomLabel(denom)}: ${(err as Error).message}`,
      suggestion: "The chain may be temporarily unreachable. The transaction will be validated on-chain.",
    };
  }
}

// ─── GAS CHECK ──────────────────────────────────────────────────────────────

/**
 * Check that the sender has enough native tokens to cover gas fees.
 *
 * @param querier      - Chain querier instance
 * @param address      - Sender address
 * @param estimatedGas - Estimated gas units for this transaction
 */
export async function checkGas(
  querier: IChainQuerier,
  address: string,
  estimatedGas: number
): Promise<PreflightCheck & { estimatedGas: number; estimatedFee: string }> {
  const gasPrice = querier.getGasPrice();
  const feeAmount = Math.ceil(estimatedGas * gasPrice);
  const nativeDenom = querier.getNativeDenom();
  const feeStr = feeAmount.toString();

  try {
    const balance = await querier.getBalance(address, nativeDenom);
    const balBig = BigInt(balance);
    const feeBig = BigInt(feeStr);

    if (balBig < feeBig) {
      return {
        id: CheckId.GAS_INSUFFICIENT,
        category: "gas",
        severity: "error",
        passed: false,
        message: `Insufficient gas funds. Have ${balance} ${nativeDenom}, need ~${feeStr} for fees.`,
        suggestion: `Top up the account with ${nativeDenom}. On testnet, use the faucet.`,
        data: { balance, estimatedFee: feeStr, nativeDenom },
        estimatedGas,
        estimatedFee: feeStr,
      };
    }

    return {
      id: CheckId.GAS_OK,
      category: "gas",
      severity: "info",
      passed: true,
      message: `Gas funds OK: ${balance} ${nativeDenom} (fee ~${feeStr}).`,
      data: { balance, estimatedFee: feeStr, nativeDenom },
      estimatedGas,
      estimatedFee: feeStr,
    };
  } catch {
    return {
      id: CheckId.GAS_ESTIMATION_FAILED,
      category: "gas",
      severity: "warning",
      passed: true,
      message: `Could not verify gas balance. Estimated fee: ~${feeStr} ${nativeDenom}.`,
      suggestion: "Ensure the account has native tokens for gas fees.",
      estimatedGas,
      estimatedFee: feeStr,
    };
  }
}

// ─── GLOBAL FREEZE CHECK ───────────────────────────────────────────────────

/**
 * Check if a token is globally frozen (no transfers allowed by anyone).
 *
 * @param tokenInfo - Token info object from chain query
 */
export function checkGlobalFreeze(tokenInfo: TokenInfo | null): PreflightCheck {
  if (!tokenInfo) {
    return {
      id: CheckId.FREEZE_CHECK_OK,
      category: "freeze",
      severity: "info",
      passed: true,
      message: "Token info not available — freeze status unknown (likely a native or IBC token).",
    };
  }

  if (tokenInfo.globallyFrozen) {
    return {
      id: CheckId.TOKEN_GLOBALLY_FROZEN,
      category: "freeze",
      severity: "error",
      passed: false,
      message: `Token ${denomLabel(tokenInfo.denom)} is globally frozen. No transfers are allowed.`,
      suggestion: "Contact the token issuer to unfreeze the token before attempting transfers.",
      data: { denom: tokenInfo.denom, issuer: tokenInfo.issuer },
    };
  }

  return {
    id: CheckId.FREEZE_CHECK_OK,
    category: "freeze",
    severity: "info",
    passed: true,
    message: `Token ${denomLabel(tokenInfo.denom)} is not globally frozen.`,
  };
}

// ─── SENDER FROZEN CHECK ────────────────────────────────────────────────────

/**
 * Check if the sender's tokens are frozen (partially or fully).
 *
 * @param querier - Chain querier instance
 * @param address - Sender address
 * @param denom   - Token denomination
 * @param amount  - Amount being sent (base units)
 */
export async function checkSenderFrozen(
  querier: IChainQuerier,
  address: string,
  denom: string,
  amount: string
): Promise<PreflightCheck> {
  try {
    const frozenBalance = await querier.getFrozenBalance(address, denom);
    const frozenBig = BigInt(frozenBalance);

    if (frozenBig <= 0n) {
      return {
        id: CheckId.FREEZE_CHECK_OK,
        category: "freeze",
        severity: "info",
        passed: true,
        message: "No frozen balance on sender account.",
      };
    }

    // Check if total balance minus frozen is still enough
    const totalBalance = await querier.getBalance(address, denom);
    const totalBig = BigInt(totalBalance);
    const amountBig = BigInt(amount);
    const available = totalBig - frozenBig;

    if (available < amountBig) {
      return {
        id: CheckId.SENDER_FROZEN,
        category: "freeze",
        severity: "error",
        passed: false,
        message: `Sender has ${frozenBalance} frozen. Available: ${available.toString()}, need ${amount}.`,
        suggestion: "Contact the token issuer to unfreeze tokens, or reduce the send amount.",
        data: { frozen: frozenBalance, total: totalBalance, available: available.toString(), required: amount },
      };
    }

    return {
      id: CheckId.SENDER_FROZEN_PARTIAL,
      category: "freeze",
      severity: "warning",
      passed: true,
      message: `Sender has ${frozenBalance} frozen, but enough unfrozen balance (${available.toString()}) to cover ${amount}.`,
      data: { frozen: frozenBalance, available: available.toString() },
    };
  } catch {
    return {
      id: CheckId.FREEZE_CHECK_OK,
      category: "freeze",
      severity: "info",
      passed: true,
      message: "Could not check frozen balance (token may not support freezing).",
    };
  }
}

// ─── COMPLIANCE NFT CHECK ───────────────────────────────────────────────────

/**
 * Check the compliance NFT for an address against token restrictions.
 * This is a soft check — missing compliance NFTs produce warnings, not errors,
 * unless the token explicitly requires compliance.
 *
 * @param querier           - Chain querier instance
 * @param address           - Address to check
 * @param tokenRestrictions - Optional restriction tags from the token metadata
 */
export async function checkComplianceNFT(
  querier: IChainQuerier,
  address: string,
  tokenRestrictions?: string[]
): Promise<PreflightCheck[]> {
  const checks: PreflightCheck[] = [];
  const complianceNFT = await querier.getComplianceNFT(address);

  if (!complianceNFT) {
    // No compliance NFT — this is only a warning, not a blocker
    // Most tokens don't require compliance NFTs yet
    checks.push({
      id: CheckId.COMPLIANCE_NFT_MISSING,
      category: "compliance",
      severity: "info",
      passed: true,
      message: "No compliance NFT found for this address. Most tokens do not require one.",
    });
    return checks;
  }

  // Check if sanctioned
  if (complianceNFT.sanctioned) {
    checks.push({
      id: CheckId.COMPLIANCE_SANCTIONED,
      category: "compliance",
      severity: "error",
      passed: false,
      message: "This address is flagged as sanctioned. Transactions are blocked.",
      suggestion: "If this is an error, contact the compliance NFT issuer for remediation.",
      data: { issuedBy: complianceNFT.issuedBy },
    });
    return checks; // Short-circuit — sanctioned addresses can't do anything
  }

  // Check expiration
  if (complianceNFT.expiresAt) {
    const expiry = new Date(complianceNFT.expiresAt);
    if (expiry < new Date()) {
      checks.push({
        id: CheckId.COMPLIANCE_NFT_EXPIRED,
        category: "compliance",
        severity: "warning",
        passed: true, // Soft warning — let the chain decide
        message: `Compliance NFT expired on ${complianceNFT.expiresAt}. Some operations may be restricted.`,
        suggestion: "Request a renewed compliance NFT from the issuing authority.",
        data: { expiresAt: complianceNFT.expiresAt, issuedBy: complianceNFT.issuedBy },
      });
    }
  }

  // Check jurisdiction restrictions
  if (tokenRestrictions && tokenRestrictions.length > 0 && complianceNFT.jurisdiction) {
    const blocked = tokenRestrictions.some(
      (r) => r === `BLOCK_${complianceNFT.jurisdiction}` || r === complianceNFT.jurisdiction
    );
    if (blocked) {
      checks.push({
        id: CheckId.COMPLIANCE_JURISDICTION_BLOCKED,
        category: "compliance",
        severity: "error",
        passed: false,
        message: `Jurisdiction "${complianceNFT.jurisdiction}" is blocked for this token.`,
        suggestion: "This token cannot be transferred to/from addresses in your jurisdiction.",
        data: { jurisdiction: complianceNFT.jurisdiction, restrictions: tokenRestrictions },
      });
    }
  }

  // Check KYC level
  if (tokenRestrictions?.includes("KYC_REQUIRED") && complianceNFT.kycLevel < 1) {
    checks.push({
      id: CheckId.COMPLIANCE_KYC_REQUIRED,
      category: "compliance",
      severity: "error",
      passed: false,
      message: "This token requires KYC verification. Your KYC level is 0 (unverified).",
      suggestion: "Complete KYC verification to receive a compliance NFT with kycLevel >= 1.",
      data: { kycLevel: complianceNFT.kycLevel },
    });
  }

  // If we got here with no issues, compliance is OK
  if (checks.length === 0) {
    checks.push({
      id: CheckId.COMPLIANCE_OK,
      category: "compliance",
      severity: "info",
      passed: true,
      message: `Compliance verified: ${complianceNFT.jurisdiction} jurisdiction, KYC level ${complianceNFT.kycLevel}.`,
      data: {
        jurisdiction: complianceNFT.jurisdiction,
        kycLevel: complianceNFT.kycLevel,
        accredited: complianceNFT.accredited,
      },
    });
  }

  return checks;
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

/** Truncate an address for display: "testcore1abc...xyz" */
function truncateAddr(addr: string): string {
  if (addr.length <= 20) return addr;
  return addr.slice(0, 12) + "..." + addr.slice(-6);
}

/** Extract a short label from a denom string */
export function denomLabel(denom: string): string {
  // Smart token denoms look like "subunit-issuerAddress"
  if (denom.includes("-")) {
    return denom.split("-")[0];
  }
  // IBC denoms
  if (denom.startsWith("ibc/")) {
    return "IBC/" + denom.slice(4, 10) + "...";
  }
  // Native denoms: utestcore -> TESTCORE, ucore -> CORE
  if (denom.startsWith("u")) {
    return denom.slice(1).toUpperCase();
  }
  return denom;
}
