/**
 * types.ts — Solomente TXAI Preflight Compliance Engine
 *
 * Core type definitions for the pre-transaction validation system.
 * Every transaction on TX flows through preflight checks before signing,
 * catching errors, compliance violations, and edge cases at the gate.
 */

// ─── CHECK SEVERITY ─────────────────────────────────────────────────────────

/** How severe a failed check is */
export type CheckSeverity = "error" | "warning" | "info";

// ─── CHECK CATEGORIES ───────────────────────────────────────────────────────

/** Logical grouping for each preflight check */
export type CheckCategory =
  | "balance"
  | "gas"
  | "whitelist"
  | "freeze"
  | "permission"
  | "parameter"
  | "nft"
  | "dex"
  | "compliance";

// ─── INDIVIDUAL CHECK RESULT ────────────────────────────────────────────────

/** Result of a single preflight check */
export interface PreflightCheck {
  /** Unique machine-readable identifier (e.g. "BALANCE_INSUFFICIENT") */
  id: string;
  /** Logical category this check belongs to */
  category: CheckCategory;
  /** Severity: error blocks the tx, warning advises, info is informational */
  severity: CheckSeverity;
  /** Whether this check passed */
  passed: boolean;
  /** Human-readable explanation of what was checked / what went wrong */
  message: string;
  /** Actionable suggestion to fix the issue (only present when check fails) */
  suggestion?: string;
  /** Arbitrary structured data for the frontend to render (balances, rates, etc.) */
  data?: Record<string, unknown>;
}

// ─── TRANSACTION TYPES ──────────────────────────────────────────────────────

/** All transaction types the preflight engine can validate */
export type TransactionType =
  | "token_send"
  | "token_issue"
  | "nft_mint"
  | "nft_transfer"
  | "airdrop"
  | "dex_place_order";

// ─── PREFLIGHT RESULT ───────────────────────────────────────────────────────

/** The complete result returned by a preflight run */
export interface PreflightResult {
  /** Which transaction type was validated */
  txType: TransactionType;
  /** ISO 8601 timestamp of when the preflight ran */
  timestamp: string;
  /** Which network this was checked against */
  network: "testnet" | "mainnet" | "devnet";
  /** The sender/signer address */
  sender: string;
  /** Whether the transaction can proceed (no errors) */
  canProceed: boolean;
  /** All individual check results */
  checks: PreflightCheck[];
  /** Aggregate summary counts */
  summary: {
    errors: number;
    warnings: number;
    info: number;
    totalChecks: number;
  };
  /** Estimated gas units for this transaction */
  estimatedGas?: number;
  /** Estimated fee in native denom (human-readable string) */
  estimatedFee?: string;
  /** For token sends: breakdown of what the recipient actually gets */
  effectiveAmount?: {
    sent: string;
    burned: string;
    commission: string;
    received: string;
  };
}

// ─── COMPLIANCE NFT ─────────────────────────────────────────────────────────

/**
 * Represents a soulbound compliance/identity NFT attached to an address.
 * Used to enforce jurisdiction, KYC, and sanctions rules at the protocol level.
 */
export interface ComplianceNFT {
  /** ISO 3166-1 alpha-2 jurisdiction code (e.g. "US", "GB") */
  jurisdiction: string;
  /** KYC verification level: 0 = none, 1 = basic, 2 = enhanced, 3 = institutional */
  kycLevel: number;
  /** Whether the holder is an accredited/qualified investor */
  accredited: boolean;
  /** Whether the address appears on any sanctions list */
  sanctioned: boolean;
  /** List of restriction tags (e.g. ["US_SECURITIES", "OFAC"]) */
  restrictions: string[];
  /** Address of the entity that issued this compliance NFT */
  issuedBy: string;
  /** ISO 8601 expiration timestamp */
  expiresAt: string;
}

// ─── PIPELINE PARAMS ────────────────────────────────────────────────────────

/** Parameters for a token send preflight */
export interface TokenSendParams {
  recipient: string;
  denom: string;
  amount: string;
}

/** Parameters for a token issuance preflight */
export interface TokenIssueParams {
  symbol: string;
  subunit: string;
  precision?: number;
  initialAmount: string;
  description?: string;
  features?: string[];
  burnRate?: string;
  sendCommissionRate?: string;
  uri?: string;
}

/** Parameters for an NFT mint preflight */
export interface NFTMintParams {
  classId: string;
  nftId: string;
  recipient?: string;
  uri?: string;
  uriHash?: string;
}

/** Parameters for an NFT transfer preflight */
export interface NFTTransferParams {
  classId: string;
  nftId: string;
  recipient: string;
}

/** Parameters for an airdrop preflight */
export interface AirdropParams {
  denom: string;
  recipients: Array<{ address: string; amount: string }>;
}

/** Parameters for a DEX order placement preflight */
export interface DexOrderParams {
  baseDenom: string;
  quoteDenom: string;
  side: "buy" | "sell";
  price: string;
  amount: string;
}

/** Union of all param types */
export type PreflightParams =
  | TokenSendParams
  | TokenIssueParams
  | NFTMintParams
  | NFTTransferParams
  | AirdropParams
  | DexOrderParams;
