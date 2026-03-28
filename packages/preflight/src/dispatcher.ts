/**
 * dispatcher.ts — Main entry point for the preflight validation system.
 *
 * Routes each transaction type to its specialized check pipeline, aggregates
 * results into a unified PreflightResult, and exports convenience helpers.
 */

import { tokenSendChecks } from "./checks/token-send.js";
import { tokenIssueChecks } from "./checks/token-issue.js";
import { nftMintChecks } from "./checks/nft-mint.js";
import { nftTransferChecks } from "./checks/nft-transfer.js";
import { airdropChecks } from "./checks/airdrop.js";
import { dexOrderChecks } from "./checks/dex-order.js";
import { CoreumRestQuerier } from "./chain-querier.js";
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
} from "./types.js";

const NETWORK_PREFIXES: Record<string, string> = {
  testnet: "testcore",
  mainnet: "core",
  devnet: "devcore",
};

export async function runPreflight(opts: {
  txType: TransactionType;
  sender: string;
  params: PreflightParams;
  network?: string;
}): Promise<PreflightResult> {
  const { txType, sender, params, network = "testnet" } = opts;

  const querier = createQuerier(network);
  const prefix = NETWORK_PREFIXES[network] || "testcore";

  let checks: PreflightCheck[] = [];
  let estimatedGas: number | undefined;
  let estimatedFee: string | undefined;
  let effectiveAmount: PreflightResult["effectiveAmount"];

  try {
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
    checks.push({
      id: "PREFLIGHT_INTERNAL_ERROR",
      category: "parameter",
      severity: "error",
      passed: false,
      message: `Preflight engine error: ${(err as Error).message}`,
      suggestion: "This is an internal error. The transaction may still succeed on-chain.",
    });
  } finally {
    querier.clearCache();
  }

  return buildResult(
    txType,
    sender,
    network as "testnet" | "mainnet" | "devnet",
    checks,
    { estimatedGas, estimatedFee, effectiveAmount },
  );
}

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
    summary: { errors, warnings, info, totalChecks: checks.length },
    estimatedGas: meta?.estimatedGas,
    estimatedFee: meta?.estimatedFee,
    effectiveAmount: meta?.effectiveAmount,
  };
}

export function createQuerier(network: string): CoreumRestQuerier {
  return new CoreumRestQuerier(network);
}

export function preflightTokenSend(sender: string, params: TokenSendParams, network = "testnet"): Promise<PreflightResult> {
  return runPreflight({ txType: "token_send", sender, params, network });
}

export function preflightTokenIssue(sender: string, params: TokenIssueParams, network = "testnet"): Promise<PreflightResult> {
  return runPreflight({ txType: "token_issue", sender, params, network });
}

export function preflightNFTMint(sender: string, params: NFTMintParams, network = "testnet"): Promise<PreflightResult> {
  return runPreflight({ txType: "nft_mint", sender, params, network });
}

export function preflightNFTTransfer(sender: string, params: NFTTransferParams, network = "testnet"): Promise<PreflightResult> {
  return runPreflight({ txType: "nft_transfer", sender, params, network });
}

export function preflightAirdrop(sender: string, params: AirdropParams, network = "testnet"): Promise<PreflightResult> {
  return runPreflight({ txType: "airdrop", sender, params, network });
}

export function preflightDexOrder(sender: string, params: DexOrderParams, network = "testnet"): Promise<PreflightResult> {
  return runPreflight({ txType: "dex_place_order", sender, params, network });
}
