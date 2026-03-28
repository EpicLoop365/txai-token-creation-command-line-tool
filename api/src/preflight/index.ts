/**
 * preflight/index.ts — Solomente TXAI Preflight Compliance Engine
 *
 * Main dispatcher and entry point for the pre-transaction validation system.
 * Routes each transaction type to its specialized check pipeline, aggregates
 * results into a unified PreflightResult, and exports convenience helpers.
 *
 * Usage:
 *   const result = await runPreflight({
 *     txType: "token_send",
 *     sender: "testcore1abc...",
 *     params: { recipient, denom, amount },
 *     network: "testnet",
 *   });
 *   if (!result.canProceed) {
 *     // Surface errors to the user before signing
 *   }
 */

// ─── CHECK PIPELINE IMPORTS ─────────────────────────────────────────────────

import { tokenSendChecks } from "./checks/token-send";
import { tokenIssueChecks } from "./checks/token-issue";
import { nftMintChecks } from "./checks/nft-mint";
import { nftTransferChecks } from "./checks/nft-transfer";
import { airdropChecks } from "./checks/airdrop";
import { dexOrderChecks } from "./checks/dex-order";

// ─── CHAIN QUERIER ──────────────────────────────────────────────────────────

import { CoreumRestQuerier } from "./chain-querier";

// ─── TYPES ──────────────────────────────────────────────────────────────────

import {
  PreflightResult,
  TransactionType,
  PreflightParams,
  PreflightCheck,
  TokenSendParams,
  TokenIssueParams,
  NFTMintParams,
  NFTTransferParams,
  AirdropParams,
  DexOrderParams,
} from "./types";

// ─── NETWORK → ADDRESS PREFIX MAP ───────────────────────────────────────────

/** Maps each supported network to the bech32 address prefix used on that chain. */
const NETWORK_PREFIXES: Record<string, string> = {
  testnet: "testcore",
  mainnet: "core",
  devnet: "devcore",
};

// ─── MAIN DISPATCHER ────────────────────────────────────────────────────────

/**
 * Run the full preflight validation suite for a given transaction.
 *
 * This is the **primary entry point** for the Solomente TXAI Preflight
 * Compliance Engine. It creates a chain querier, routes the request to the
 * appropriate check pipeline, aggregates the individual check results, and
 * returns a unified PreflightResult with summary counts.
 *
 * @param opts.txType  - The transaction type to validate
 * @param opts.sender  - Sender/signer bech32 address
 * @param opts.params  - Transaction-specific parameters (union type)
 * @param opts.network - Network name ("testnet" | "mainnet" | "devnet"); defaults to "testnet"
 * @returns Complete PreflightResult with all checks, summary, and metadata
 */
export async function runPreflight(opts: {
  txType: TransactionType;
  sender: string;
  params: PreflightParams;
  network?: string;
}): Promise<PreflightResult> {
  const { txType, sender, params, network = "testnet" } = opts;

  // Stand up a querier for the target network
  const querier = createQuerier(network);

  // Determine the expected bech32 address prefix
  const prefix = NETWORK_PREFIXES[network] || "testcore";

  // Accumulators for pipeline output
  let checks: PreflightCheck[] = [];
  let estimatedGas: number | undefined;
  let estimatedFee: string | undefined;
  let effectiveAmount: PreflightResult["effectiveAmount"];

  try {
    // ── Route to the correct check pipeline ─────────────────────────────
    switch (txType) {
      case "token_send": {
        const result = await tokenSendChecks(querier, sender, params as TokenSendParams, prefix);
        checks = result.checks;
        estimatedGas = result.estimatedGas;
        estimatedFee = result.estimatedFee;
        effectiveAmount = result.effectiveAmount;
        break;
      }

      case "token_issue": {
        const result = await tokenIssueChecks(querier, sender, params as TokenIssueParams, prefix);
        checks = result.checks;
        estimatedGas = result.estimatedGas;
        estimatedFee = result.estimatedFee;
        break;
      }

      case "nft_mint": {
        const result = await nftMintChecks(querier, sender, params as NFTMintParams, prefix);
        checks = result.checks;
        estimatedGas = result.estimatedGas;
        estimatedFee = result.estimatedFee;
        break;
      }

      case "nft_transfer": {
        const result = await nftTransferChecks(querier, sender, params as NFTTransferParams, prefix);
        checks = result.checks;
        estimatedGas = result.estimatedGas;
        estimatedFee = result.estimatedFee;
        break;
      }

      case "airdrop": {
        const result = await airdropChecks(querier, sender, params as AirdropParams, prefix);
        checks = result.checks;
        estimatedGas = result.estimatedGas;
        estimatedFee = result.estimatedFee;
        break;
      }

      case "dex_place_order": {
        const result = await dexOrderChecks(querier, sender, params as DexOrderParams, prefix);
        checks = result.checks;
        estimatedGas = result.estimatedGas;
        estimatedFee = result.estimatedFee;
        break;
      }

      default:
        checks.push({
          id: "UNKNOWN_TX_TYPE",
          category: "parameter",
          severity: "error",
          passed: false,
          message: `Unknown transaction type: "${txType}".`,
          suggestion: `Supported types: token_send, token_issue, nft_mint, nft_transfer, airdrop, dex_place_order.`,
        });
    }
  } catch (err) {
    // Pipeline-level errors become a single error check so the caller always
    // gets a well-formed PreflightResult rather than an unhandled rejection.
    checks.push({
      id: "PREFLIGHT_INTERNAL_ERROR",
      category: "parameter",
      severity: "error",
      passed: false,
      message: `Preflight engine error: ${(err as Error).message}`,
      suggestion: "This is an internal error. The transaction may still succeed on-chain.",
    });
  } finally {
    // Clean up the querier cache so stale data doesn't leak between runs
    querier.clearCache();
  }

  // ── Aggregate results ───────────────────────────────────────────────────

  return buildResult(
    txType,
    sender,
    network as "testnet" | "mainnet" | "devnet",
    checks,
    { estimatedGas, estimatedFee, effectiveAmount },
  );
}

// ─── RESULT BUILDER ─────────────────────────────────────────────────────────

/**
 * Assemble a PreflightResult from a checks array.
 * Computes the summary counts and the canProceed flag.
 *
 * @param txType  - Transaction type
 * @param sender  - Sender address
 * @param network - Network name
 * @param checks  - Array of individual check results
 * @param meta    - Optional metadata (gas, fees, effective amount)
 */
export function buildResult(
  txType: TransactionType,
  sender: string,
  network: "testnet" | "mainnet" | "devnet",
  checks: PreflightCheck[],
  meta?: {
    estimatedGas?: number;
    estimatedFee?: string;
    effectiveAmount?: PreflightResult["effectiveAmount"];
  },
): PreflightResult {
  const errors = checks.filter((c) => c.severity === "error" && !c.passed).length;
  const warnings = checks.filter((c) => c.severity === "warning" && !c.passed).length;
  const info = checks.filter((c) => c.severity === "info").length;

  return {
    txType,
    timestamp: new Date().toISOString(),
    network,
    sender,
    canProceed: errors === 0,
    checks,
    summary: {
      errors,
      warnings,
      info,
      totalChecks: checks.length,
    },
    estimatedGas: meta?.estimatedGas,
    estimatedFee: meta?.estimatedFee,
    effectiveAmount: meta?.effectiveAmount,
  };
}

// ─── CONVENIENCE: QUERIER FACTORY ───────────────────────────────────────────

/**
 * Create a CoreumRestQuerier for the specified network.
 * Useful when callers need direct chain access outside of the preflight pipeline
 * (e.g. ad-hoc balance lookups in the CLI tool).
 *
 * @param network - Network name ("testnet" | "mainnet" | "devnet")
 * @returns A new CoreumRestQuerier instance with default cache TTL
 */
export function createQuerier(network: string): CoreumRestQuerier {
  return new CoreumRestQuerier(network);
}

// ─── CONVENIENCE WRAPPERS ───────────────────────────────────────────────────

/**
 * Preflight a token send transaction.
 * @param sender  - Sender bech32 address
 * @param params  - { recipient, denom, amount }
 * @param network - Network name
 */
export function preflightTokenSend(
  sender: string,
  params: TokenSendParams,
  network: string = "testnet",
): Promise<PreflightResult> {
  return runPreflight({ txType: "token_send", sender, params, network });
}

/**
 * Preflight a token issuance transaction.
 * @param sender  - Issuer bech32 address
 * @param params  - { symbol, subunit, initialAmount, ... }
 * @param network - Network name
 */
export function preflightTokenIssue(
  sender: string,
  params: TokenIssueParams,
  network: string = "testnet",
): Promise<PreflightResult> {
  return runPreflight({ txType: "token_issue", sender, params, network });
}

/**
 * Preflight an NFT mint transaction.
 * @param sender  - Minter bech32 address (must be class issuer)
 * @param params  - { classId, nftId, recipient?, uri? }
 * @param network - Network name
 */
export function preflightNFTMint(
  sender: string,
  params: NFTMintParams,
  network: string = "testnet",
): Promise<PreflightResult> {
  return runPreflight({ txType: "nft_mint", sender, params, network });
}

/**
 * Preflight an NFT transfer transaction.
 * @param sender  - Current owner bech32 address
 * @param params  - { classId, nftId, recipient }
 * @param network - Network name
 */
export function preflightNFTTransfer(
  sender: string,
  params: NFTTransferParams,
  network: string = "testnet",
): Promise<PreflightResult> {
  return runPreflight({ txType: "nft_transfer", sender, params, network });
}

/**
 * Preflight an airdrop transaction.
 * @param sender  - Airdropper bech32 address
 * @param params  - { denom, recipients: [{ address, amount }] }
 * @param network - Network name
 */
export function preflightAirdrop(
  sender: string,
  params: AirdropParams,
  network: string = "testnet",
): Promise<PreflightResult> {
  return runPreflight({ txType: "airdrop", sender, params, network });
}

/**
 * Preflight a DEX order placement.
 * @param sender  - Trader bech32 address
 * @param params  - { baseDenom, quoteDenom, side, price, amount }
 * @param network - Network name
 */
export function preflightDexOrder(
  sender: string,
  params: DexOrderParams,
  network: string = "testnet",
): Promise<PreflightResult> {
  return runPreflight({ txType: "dex_place_order", sender, params, network });
}

// ─── RE-EXPORTS ─────────────────────────────────────────────────────────────

export type {
  TransactionType,
  PreflightResult,
  PreflightCheck,
  PreflightParams,
  CheckSeverity,
  CheckCategory,
  ComplianceNFT,
} from "./types";
export { CheckId } from "./check-ids";
