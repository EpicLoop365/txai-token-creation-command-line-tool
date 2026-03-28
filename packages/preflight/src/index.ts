/**
 * @solomente/txai-preflight — Barrel export
 *
 * Pre-transaction validation and compliance engine for TX blockchain.
 */

// ─── Dispatcher ──────────────────────────────────────────────────────────────
export {
  runPreflight,
  buildResult,
  createQuerier,
  preflightTokenSend,
  preflightTokenIssue,
  preflightNFTMint,
  preflightNFTTransfer,
  preflightAirdrop,
  preflightDexOrder,
} from "./dispatcher.js";

// ─── Types ───────────────────────────────────────────────────────────────────
export type {
  TransactionType,
  PreflightResult,
  PreflightCheck,
  PreflightParams,
  CheckSeverity,
  CheckCategory,
  ComplianceNFT,
  TokenSendParams,
  TokenIssueParams,
  NFTMintParams,
  NFTTransferParams,
  AirdropParams,
  DexOrderParams,
} from "./types.js";

// ─── Check IDs ───────────────────────────────────────────────────────────────
export { CheckId } from "./check-ids.js";
export type { CheckIdType } from "./check-ids.js";

// ─── Chain Querier ───────────────────────────────────────────────────────────
export { CoreumRestQuerier } from "./chain-querier.js";
export type { IChainQuerier, TokenInfo, NFTClassInfo, NFTOwnerResponse } from "./chain-querier.js";
