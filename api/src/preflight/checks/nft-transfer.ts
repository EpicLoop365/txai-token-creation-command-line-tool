/**
 * checks/nft-transfer.ts — Solomente TXAI Preflight Compliance Engine
 *
 * Pipeline for NFT transfer (cosmos/nft/MsgSend).
 * Validates ownership, soulbound restrictions (disable_sending),
 * frozen status, recipient whitelisting, gas, and compliance on both parties.
 */

import { PreflightCheck, NFTTransferParams } from "../types";
import { CheckId } from "../check-ids";
import { IChainQuerier } from "../chain-querier";
import {
  validateAddress,
  checkGas,
  checkComplianceNFT,
} from "./common";

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

/** Estimated gas units for an NFT transfer message */
const TRANSFER_GAS_ESTIMATE = 150_000;

// ─── RESULT TYPE ────────────────────────────────────────────────────────────

/** Result returned by the NFT transfer preflight pipeline */
export interface NFTTransferResult {
  /** All individual check results */
  checks: PreflightCheck[];
  /** Estimated gas units */
  estimatedGas: number;
  /** Estimated fee in native denom (base units) */
  estimatedFee: string;
}

// ─── PIPELINE ───────────────────────────────────────────────────────────────

/**
 * Run the full preflight pipeline for an NFT transfer.
 *
 * Check order:
 *   1. Address validation (sender + recipient)
 *   2. NFT ownership (sender owns the NFT)
 *   3. Soulbound check (disable_sending feature blocks transfer)
 *   4. Frozen check (NFT-level freeze)
 *   5. Recipient whitelisting (if class has whitelisting feature)
 *   6. Gas fee sufficiency
 *   7. Compliance NFT on both sender and recipient
 *
 * @param querier        - Chain querier instance
 * @param sender         - The current owner/signer address
 * @param params         - NFT transfer parameters (classId, nftId, recipient)
 * @param addressPrefix  - Expected bech32 prefix
 * @returns Pipeline result with checks and gas estimate
 */
export async function nftTransferChecks(
  querier: IChainQuerier,
  sender: string,
  params: NFTTransferParams,
  addressPrefix?: string
): Promise<NFTTransferResult> {
  const checks: PreflightCheck[] = [];
  const { classId, nftId, recipient } = params;

  // ── 1. Address validation ─────────────────────────────────────────────

  const senderCheck = validateAddress(sender, "sender", addressPrefix);
  const recipientCheck = validateAddress(recipient, "recipient", addressPrefix);
  checks.push(senderCheck, recipientCheck);

  if (!senderCheck.passed || !recipientCheck.passed) {
    return { checks, estimatedGas: TRANSFER_GAS_ESTIMATE, estimatedFee: "0" };
  }

  // ── Parallel chain queries for ownership, class info, freeze, gas ────

  const [owner, classInfo, frozen, gasResult] = await Promise.all([
    querier.getNFTOwner(classId, nftId),
    querier.getNFTClassInfo(classId),
    querier.isNFTFrozen(classId, nftId),
    checkGas(querier, sender, TRANSFER_GAS_ESTIMATE),
  ]);

  // ── 2. Ownership check ────────────────────────────────────────────────

  if (!owner) {
    checks.push({
      id: CheckId.NOT_NFT_OWNER,
      category: "nft",
      severity: "error",
      passed: false,
      message: `Could not find NFT "${nftId}" in class "${classId}". It may not exist.`,
      suggestion: "Verify the class ID and NFT ID are correct.",
      data: { classId, nftId },
    });
  } else if (owner !== sender) {
    checks.push({
      id: CheckId.NOT_NFT_OWNER,
      category: "nft",
      severity: "error",
      passed: false,
      message: `Sender does not own NFT "${nftId}". Current owner: ${owner.slice(0, 12)}...`,
      suggestion: "Only the NFT owner can transfer it. Use the correct account.",
      data: { currentOwner: owner, sender },
    });
  } else {
    checks.push({
      id: CheckId.NFT_CHECK_OK,
      category: "nft",
      severity: "info",
      passed: true,
      message: `Sender owns NFT "${nftId}" in class "${classId}".`,
    });
  }

  // ── 3. Soulbound check (disable_sending) ──────────────────────────────

  if (classInfo?.features?.includes("disable_sending")) {
    checks.push({
      id: CheckId.NFT_SOULBOUND,
      category: "nft",
      severity: "error",
      passed: false,
      message: `NFT class "${classId}" has "disable_sending" enabled. This NFT is soulbound and cannot be transferred.`,
      suggestion: "Soulbound NFTs are permanently bound to their owner. This transfer cannot proceed.",
      data: { classId, features: classInfo.features },
    });
  }

  // ── 4. Frozen check ───────────────────────────────────────────────────

  if (frozen) {
    checks.push({
      id: CheckId.NFT_FROZEN,
      category: "freeze",
      severity: "error",
      passed: false,
      message: `NFT "${nftId}" in class "${classId}" is frozen. Transfers are blocked.`,
      suggestion: "Contact the NFT class issuer to unfreeze this specific NFT.",
      data: { classId, nftId },
    });
  } else {
    checks.push({
      id: CheckId.FREEZE_CHECK_OK,
      category: "freeze",
      severity: "info",
      passed: true,
      message: "NFT is not frozen.",
    });
  }

  // ── 5. Recipient whitelisting ─────────────────────────────────────────

  if (classInfo?.features?.includes("whitelisting")) {
    try {
      const isWhitelisted = await querier.isNFTWhitelisted(classId, nftId, recipient);
      if (!isWhitelisted) {
        checks.push({
          id: CheckId.NFT_RECIPIENT_NOT_WHITELISTED,
          category: "whitelist",
          severity: "error",
          passed: false,
          message: `Recipient is not whitelisted for NFT "${nftId}" in class "${classId}".`,
          suggestion: "The class issuer must whitelist the recipient before the transfer.",
          data: { classId, nftId, recipient },
        });
      } else {
        checks.push({
          id: CheckId.WHITELIST_OK,
          category: "whitelist",
          severity: "info",
          passed: true,
          message: "Recipient is whitelisted for this NFT.",
        });
      }
    } catch {
      // Non-blocking — allow chain to enforce
      checks.push({
        id: CheckId.WHITELIST_OK,
        category: "whitelist",
        severity: "info",
        passed: true,
        message: "Could not verify recipient whitelist status (non-blocking).",
      });
    }
  }

  // ── 6. Gas check ──────────────────────────────────────────────────────

  checks.push(gasResult);

  // ── 7. Compliance NFT on both sender and recipient ────────────────────

  const senderCompliance = await checkComplianceNFT(querier, sender);
  checks.push(...senderCompliance);

  const recipientCompliance = await checkComplianceNFT(querier, recipient);
  checks.push(...recipientCompliance);

  return {
    checks,
    estimatedGas: gasResult.estimatedGas,
    estimatedFee: gasResult.estimatedFee,
  };
}
