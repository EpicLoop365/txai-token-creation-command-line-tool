/**
 * types.ts — Solomente TXAI Preflight Compliance Engine
 *
 * Core type definitions for the pre-transaction validation system.
 */

export type CheckSeverity = "error" | "warning" | "info";

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

export interface PreflightCheck {
  id: string;
  category: CheckCategory;
  severity: CheckSeverity;
  passed: boolean;
  message: string;
  suggestion?: string;
  data?: Record<string, unknown>;
}

export type TransactionType =
  | "token_send"
  | "token_issue"
  | "nft_mint"
  | "nft_transfer"
  | "airdrop"
  | "dex_place_order";

export interface PreflightResult {
  txType: TransactionType;
  timestamp: string;
  network: "testnet" | "mainnet" | "devnet";
  sender: string;
  canProceed: boolean;
  checks: PreflightCheck[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
    totalChecks: number;
  };
  estimatedGas?: number;
  estimatedFee?: string;
  effectiveAmount?: {
    sent: string;
    burned: string;
    commission: string;
    received: string;
  };
}

export interface ComplianceNFT {
  jurisdiction: string;
  kycLevel: number;
  accredited: boolean;
  sanctioned: boolean;
  restrictions: string[];
  issuedBy: string;
  expiresAt: string;
}

export interface TokenSendParams {
  recipient: string;
  denom: string;
  amount: string;
}

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

export interface NFTMintParams {
  classId: string;
  nftId: string;
  recipient?: string;
  uri?: string;
  uriHash?: string;
}

export interface NFTTransferParams {
  classId: string;
  nftId: string;
  recipient: string;
}

export interface AirdropParams {
  denom: string;
  recipients: Array<{ address: string; amount: string }>;
}

export interface DexOrderParams {
  baseDenom: string;
  quoteDenom: string;
  side: "buy" | "sell";
  price: string;
  amount: string;
}

export type PreflightParams =
  | TokenSendParams
  | TokenIssueParams
  | NFTMintParams
  | NFTTransferParams
  | AirdropParams
  | DexOrderParams;
