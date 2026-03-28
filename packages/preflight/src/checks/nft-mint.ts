/**
 * checks/nft-mint.ts — Solomente TXAI Preflight Compliance Engine
 *
 * Pipeline for NFT minting (coreum/asset/nft/MsgMint).
 * Validates that the sender is the class issuer, the class exists,
 * URI constraints, recipient whitelisting, gas, and compliance.
 */

import { PreflightCheck, NFTMintParams } from "../types.js";
import { CheckId } from "../check-ids.js";
import { IChainQuerier } from "../chain-querier.js";
import {
  validateAddress,
  checkGas,
  checkComplianceNFT,
} from "./common.js";

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

/** Estimated gas units for an NFT mint message */
const MINT_GAS_ESTIMATE = 200_000;

/** Maximum URI length for NFT metadata */
const MAX_URI_LENGTH = 256;

// ─── RESULT TYPE ────────────────────────────────────────────────────────────

/** Result returned by the NFT mint preflight pipeline */
export interface NFTMintResult {
  /** All individual check results */
  checks: PreflightCheck[];
  /** Estimated gas units */
  estimatedGas: number;
  /** Estimated fee in native denom (base units) */
  estimatedFee: string;
}

// ─── PIPELINE ───────────────────────────────────────────────────────────────

/**
 * Run the full preflight pipeline for NFT minting.
 *
 * Check order:
 *   1. Sender address validation
 *   2. Recipient address validation (if specified)
 *   3. NFT class existence on-chain
 *   4. Sender is the class issuer (only issuers can mint)
 *   5. URI length validation (max 256 chars)
 *   6. Recipient whitelisting (if class has whitelisting feature)
 *   7. Gas fee sufficiency
 *   8. Compliance NFT verification
 *
 * @param querier        - Chain querier instance
 * @param sender         - The minter/signer address (must be the class issuer)
 * @param params         - NFT mint parameters (classId, nftId, recipient?, uri?)
 * @param addressPrefix  - Expected bech32 prefix
 * @returns Pipeline result with checks and gas estimate
 */
export async function nftMintChecks(
  querier: IChainQuerier,
  sender: string,
  params: NFTMintParams,
  addressPrefix?: string
): Promise<NFTMintResult> {
  const checks: PreflightCheck[] = [];
  const { classId, nftId, recipient, uri } = params;

  // ── 1. Sender address validation ──────────────────────────────────────

  const senderCheck = validateAddress(sender, "sender", addressPrefix);
  checks.push(senderCheck);

  if (!senderCheck.passed) {
    return { checks, estimatedGas: MINT_GAS_ESTIMATE, estimatedFee: "0" };
  }

  // ── 2. Recipient address validation (if specified) ────────────────────

  if (recipient) {
    const recipientCheck = validateAddress(recipient, "recipient", addressPrefix);
    checks.push(recipientCheck);
    if (!recipientCheck.passed) {
      return { checks, estimatedGas: MINT_GAS_ESTIMATE, estimatedFee: "0" };
    }
  }

  // ── 3. Validate NFT ID is present ────────────────────────────────────

  if (!nftId || typeof nftId !== "string" || nftId.trim() === "") {
    checks.push({
      id: CheckId.PARAMETER_OK,
      category: "parameter",
      severity: "error",
      passed: false,
      message: "NFT ID is missing or empty.",
      suggestion: "Provide a unique identifier for this NFT within the class.",
    });
    return { checks, estimatedGas: MINT_GAS_ESTIMATE, estimatedFee: "0" };
  }

  // ── 4. NFT class existence + issuer check ─────────────────────────────

  const [classInfo, gasResult] = await Promise.all([
    querier.getNFTClassInfo(classId),
    checkGas(querier, sender, MINT_GAS_ESTIMATE),
  ]);

  if (!classInfo) {
    checks.push({
      id: CheckId.NFT_CLASS_NOT_FOUND,
      category: "nft",
      severity: "error",
      passed: false,
      message: `NFT class "${classId}" was not found on-chain.`,
      suggestion:
        "Verify the class ID is correct. If this is a new class, create it before minting NFTs.",
      data: { classId },
    });
    // Can't check issuer or features without class info — still return gas
    checks.push(gasResult);
    return { checks, estimatedGas: gasResult.estimatedGas, estimatedFee: gasResult.estimatedFee };
  }

  checks.push({
    id: CheckId.NFT_CHECK_OK,
    category: "nft",
    severity: "info",
    passed: true,
    message: `NFT class "${classInfo.name || classId}" found (issuer: ${classInfo.issuer.slice(0, 12)}...).`,
  });

  // ── 5. Sender is the class issuer ─────────────────────────────────────

  if (classInfo.issuer !== sender) {
    checks.push({
      id: CheckId.NOT_NFT_ISSUER,
      category: "permission",
      severity: "error",
      passed: false,
      message: `Sender is not the issuer of class "${classId}". Only the issuer can mint.`,
      suggestion: `The class issuer is ${classInfo.issuer}. Use that account to mint.`,
      data: { classIssuer: classInfo.issuer, sender },
    });
  } else {
    checks.push({
      id: CheckId.NFT_CHECK_OK,
      category: "permission",
      severity: "info",
      passed: true,
      message: "Sender is the authorized issuer for this NFT class.",
    });
  }

  // ── 6. URI length validation ──────────────────────────────────────────

  if (uri !== undefined) {
    if (uri.length > MAX_URI_LENGTH) {
      checks.push({
        id: CheckId.URI_TOO_LONG,
        category: "nft",
        severity: "error",
        passed: false,
        message: `NFT URI is ${uri.length} characters (max ${MAX_URI_LENGTH}).`,
        suggestion: `Shorten the URI to ${MAX_URI_LENGTH} characters or fewer, or use an IPFS hash.`,
        data: { uriLength: uri.length, maxLength: MAX_URI_LENGTH },
      });
    } else {
      checks.push({
        id: CheckId.NFT_CHECK_OK,
        category: "nft",
        severity: "info",
        passed: true,
        message: `URI length OK (${uri.length}/${MAX_URI_LENGTH}).`,
      });
    }
  }

  // ── 7. Recipient whitelisting (if class has whitelisting feature) ─────

  const hasWhitelisting = classInfo.features?.includes("whitelisting");
  if (hasWhitelisting && recipient) {
    try {
      const isWhitelisted = await querier.isNFTWhitelisted(classId, nftId, recipient);
      if (!isWhitelisted) {
        checks.push({
          id: CheckId.NFT_RECIPIENT_NOT_WHITELISTED,
          category: "whitelist",
          severity: "warning",
          passed: true, // Warning only — the issuer can auto-whitelist during mint
          message: `Recipient may not be whitelisted for class "${classId}". The mint may auto-whitelist.`,
          suggestion: "If the mint fails, whitelist the recipient first.",
          data: { classId, recipient },
        });
      } else {
        checks.push({
          id: CheckId.WHITELIST_OK,
          category: "whitelist",
          severity: "info",
          passed: true,
          message: "Recipient is whitelisted for this NFT class.",
        });
      }
    } catch {
      // Non-blocking — whitelist query may not apply to all class types
    }
  }

  // ── 8. Gas check ──────────────────────────────────────────────────────

  checks.push(gasResult);

  // ── 9. Compliance NFT ─────────────────────────────────────────────────

  const complianceChecks = await checkComplianceNFT(querier, sender);
  checks.push(...complianceChecks);

  return {
    checks,
    estimatedGas: gasResult.estimatedGas,
    estimatedFee: gasResult.estimatedFee,
  };
}
