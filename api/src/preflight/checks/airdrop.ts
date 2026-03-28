/**
 * checks/airdrop.ts — Solomente TXAI Preflight Compliance Engine
 *
 * Pipeline for batch airdrop transactions (multiple bank/MsgSend).
 * This pipeline was born from the bug that inspired the entire preflight
 * engine: an airdrop executed from the wrong wallet, sending tokens the
 * user didn't intend. Every airdrop now runs through these gates first.
 *
 * Validates: recipient list integrity, batch size, duplicates, address
 * format (sampled), total balance, global freeze, wallet identity
 * verification, gas scaling, and compliance.
 */

import { PreflightCheck, AirdropParams } from "../types";
import { CheckId } from "../check-ids";
import { IChainQuerier } from "../chain-querier";
import {
  validateAddress,
  checkBalance,
  checkGas,
  checkGlobalFreeze,
  checkComplianceNFT,
  denomLabel,
} from "./common";

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

/** Maximum number of recipients per airdrop batch */
const MAX_BATCH_SIZE = 500;

/** Base gas for the airdrop transaction overhead */
const BASE_GAS = 100_000;

/** Additional gas per recipient in the airdrop */
const GAS_PER_RECIPIENT = 80_000;

/** Number of recipient addresses to validate (first N to avoid O(n) for huge lists) */
const ADDRESS_VALIDATION_SAMPLE = 10;

// ─── RESULT TYPE ────────────────────────────────────────────────────────────

/** Result returned by the airdrop preflight pipeline */
export interface AirdropResult {
  /** All individual check results */
  checks: PreflightCheck[];
  /** Estimated gas units (scales with recipient count) */
  estimatedGas: number;
  /** Estimated fee in native denom (base units) */
  estimatedFee: string;
}

// ─── PIPELINE ───────────────────────────────────────────────────────────────

/**
 * Run the full preflight pipeline for a batch airdrop.
 *
 * Check order:
 *   1. Sender address validation
 *   2. Empty recipients check
 *   3. Batch size check (max 500)
 *   4. Duplicate recipients (warning — not a blocker)
 *   5. Validate first 10 recipient addresses (sampled)
 *   6. Calculate total airdrop amount
 *   7. Global freeze check on the token
 *   8. Total balance check — THE critical check that catches wrong-wallet bugs
 *   9. Gas estimate (scales: 100k base + 80k per recipient)
 *  10. Compliance NFT verification
 *
 * @param querier        - Chain querier instance
 * @param sender         - The airdrop sender/signer address
 * @param params         - Airdrop parameters (denom, recipients[])
 * @param addressPrefix  - Expected bech32 prefix
 * @returns Pipeline result with checks and gas estimate
 */
export async function airdropChecks(
  querier: IChainQuerier,
  sender: string,
  params: AirdropParams,
  addressPrefix?: string
): Promise<AirdropResult> {
  const checks: PreflightCheck[] = [];
  const { denom, recipients } = params;

  // ── 1. Sender address validation ──────────────────────────────────────

  const senderCheck = validateAddress(sender, "sender", addressPrefix);
  checks.push(senderCheck);

  if (!senderCheck.passed) {
    return { checks, estimatedGas: BASE_GAS, estimatedFee: "0" };
  }

  // ── 2. Empty recipients ───────────────────────────────────────────────

  if (!recipients || recipients.length === 0) {
    checks.push({
      id: CheckId.AIRDROP_EMPTY_RECIPIENTS,
      category: "parameter",
      severity: "error",
      passed: false,
      message: "Airdrop recipient list is empty.",
      suggestion: "Provide at least one recipient with an address and amount.",
    });
    return { checks, estimatedGas: BASE_GAS, estimatedFee: "0" };
  }

  // ── 3. Batch size check ───────────────────────────────────────────────

  if (recipients.length > MAX_BATCH_SIZE) {
    checks.push({
      id: CheckId.AIRDROP_BATCH_TOO_LARGE,
      category: "parameter",
      severity: "error",
      passed: false,
      message: `Batch size ${recipients.length} exceeds maximum of ${MAX_BATCH_SIZE} recipients.`,
      suggestion: `Split the airdrop into batches of ${MAX_BATCH_SIZE} or fewer recipients.`,
      data: { batchSize: recipients.length, maxBatchSize: MAX_BATCH_SIZE },
    });
    return { checks, estimatedGas: BASE_GAS, estimatedFee: "0" };
  }

  checks.push({
    id: CheckId.AIRDROP_OK,
    category: "parameter",
    severity: "info",
    passed: true,
    message: `Batch size: ${recipients.length} recipient(s) (max ${MAX_BATCH_SIZE}).`,
    data: { batchSize: recipients.length },
  });

  // ── 4. Duplicate recipients (warning — not a blocker) ────────────────

  const addressSet = new Set<string>();
  const duplicates: string[] = [];
  for (const r of recipients) {
    const normalized = r.address.toLowerCase();
    if (addressSet.has(normalized)) {
      duplicates.push(r.address);
    }
    addressSet.add(normalized);
  }

  if (duplicates.length > 0) {
    checks.push({
      id: CheckId.AIRDROP_DUPLICATE_RECIPIENTS,
      category: "parameter",
      severity: "warning",
      passed: true, // Warning only — duplicates are allowed but suspicious
      message: `Found ${duplicates.length} duplicate recipient address(es). Same address will receive multiple sends.`,
      suggestion: "Review the recipient list for unintended duplicates.",
      data: {
        duplicateCount: duplicates.length,
        firstDuplicate: duplicates[0]?.slice(0, 16) + "...",
      },
    });
  }

  // ── 5. Validate first N recipient addresses (sampled) ────────────────

  const sampled = recipients.slice(0, ADDRESS_VALIDATION_SAMPLE);
  let invalidCount = 0;

  for (const r of sampled) {
    const addrCheck = validateAddress(r.address, "recipient", addressPrefix);
    if (!addrCheck.passed) {
      invalidCount++;
      // Only include the first few failures to avoid noise
      if (invalidCount <= 3) {
        checks.push(addrCheck);
      }
    }
  }

  if (invalidCount === 0) {
    checks.push({
      id: CheckId.ADDRESS_VALIDATION_OK,
      category: "parameter",
      severity: "info",
      passed: true,
      message: `Sampled ${sampled.length} recipient address(es) — all valid.`,
    });
  } else if (invalidCount > 3) {
    checks.push({
      id: CheckId.INVALID_RECIPIENT_ADDRESS,
      category: "parameter",
      severity: "error",
      passed: false,
      message: `${invalidCount} of the first ${sampled.length} addresses are invalid (showing first 3).`,
      suggestion: "Review and correct all recipient addresses before proceeding.",
    });
  }

  // ── 6. Calculate total airdrop amount ─────────────────────────────────

  let totalAmount = 0n;
  let amountError = false;

  for (const r of recipients) {
    try {
      const val = BigInt(r.amount);
      if (val <= 0n) {
        amountError = true;
      }
      totalAmount += val;
    } catch {
      amountError = true;
    }
  }

  if (amountError) {
    checks.push({
      id: CheckId.INVALID_AMOUNT,
      category: "parameter",
      severity: "warning",
      passed: true,
      message: "Some recipient amounts are invalid or non-positive. Total calculation may be inaccurate.",
      suggestion: "Ensure every recipient has a positive integer amount in base units.",
    });
  }

  // ── 7. Global freeze check ────────────────────────────────────────────

  const tokenInfo = await querier.getTokenInfo(denom);
  const freezeCheck = checkGlobalFreeze(tokenInfo);
  checks.push(freezeCheck);

  if (!freezeCheck.passed) {
    return { checks, estimatedGas: BASE_GAS, estimatedFee: "0" };
  }

  // ── 8. Total balance check — THE critical check ───────────────────────
  //
  // This is the check that would have caught the original bug:
  // "Am I sending from the right wallet, and does it have enough?"
  //
  // If the balance is insufficient, this almost always means the user
  // connected the wrong wallet. We add an extra loud warning to make
  // this unmissable.

  const totalStr = totalAmount.toString();
  const balanceCheck = await checkBalance(
    querier,
    sender,
    denom,
    totalStr,
    `airdrop ${totalStr} ${denomLabel(denom)} to ${recipients.length} recipients`
  );
  checks.push(balanceCheck);

  if (!balanceCheck.passed) {
    checks.push({
      id: CheckId.AIRDROP_TOTAL_EXCEEDS_BALANCE,
      category: "balance",
      severity: "error",
      passed: false,
      message:
        `Total airdrop amount (${totalStr} ${denomLabel(denom)}) exceeds sender balance. ` +
        `Double-check you are using the correct wallet.`,
      suggestion:
        "Verify: (1) the sender wallet is correct, (2) the token denom is correct, " +
        "(3) the amounts are in base units. This was the #1 cause of failed airdrops.",
      data: {
        totalAmount: totalStr,
        recipientCount: recipients.length,
        denom,
      },
    });
  }

  // ── 9. Gas estimate (scales with recipients) ─────────────────────────

  const estimatedGas = BASE_GAS + GAS_PER_RECIPIENT * recipients.length;
  const gasResult = await checkGas(querier, sender, estimatedGas);
  checks.push(gasResult);

  // ── 10. Compliance NFT ────────────────────────────────────────────────

  const complianceChecks = await checkComplianceNFT(querier, sender);
  checks.push(...complianceChecks);

  return {
    checks,
    estimatedGas: gasResult.estimatedGas,
    estimatedFee: gasResult.estimatedFee,
  };
}
