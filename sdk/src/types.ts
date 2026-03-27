/**
 * @txai/agent-sdk — Type Definitions
 */

// ─── Network ─────────────────────────────────────────────────────────────────

export type NetworkName = "testnet" | "mainnet" | "devnet";

export interface NetworkConfig {
  chainId: string;
  rpcEndpoint: string;
  restEndpoint: string;
  denom: string;
  addressPrefix: string;
  explorerUrl: string;
  hdPath: string;
  faucetUrl: string;
}

// ─── Wallet ──────────────────────────────────────────────────────────────────

export interface WalletInfo {
  address: string;
  mnemonic: string;
  networkName: NetworkName;
}

// ─── Balances ────────────────────────────────────────────────────────────────

export interface TokenBalance {
  denom: string;
  amount: string;
  display: string;
}

// ─── Transaction ─────────────────────────────────────────────────────────────

export interface TransactionResult {
  success: boolean;
  txHash: string;
  height?: number;
  gasUsed?: number;
  explorerUrl?: string;
  error?: string;
}

// ─── Smart Tokens ────────────────────────────────────────────────────────────

export interface SmartTokenFeatures {
  minting?: boolean;
  burning?: boolean;
  freezing?: boolean;
  whitelisting?: boolean;
  ibcEnabled?: boolean;
  clawback?: boolean;
}

export interface IssueSmartTokenParams {
  subunit: string;
  symbol?: string;
  name: string;
  description?: string;
  initialAmount: string;
  precision?: number;
  features?: SmartTokenFeatures;
  burnRate?: string;
  sendCommissionRate?: string;
  uri?: string;
  uriHash?: string;
}

export interface SmartTokenInfo {
  denom: string;
  issuer?: string;
  subunit?: string;
  precision?: number;
  description?: string;
  globallyFrozen?: boolean;
  features?: SmartTokenFeatures;
}

// ─── DEX ─────────────────────────────────────────────────────────────────────

export enum DexSide {
  BUY = 1,
  SELL = 2,
}

export enum DexOrderType {
  LIMIT = 1,
  MARKET = 2,
}

export interface PlaceOrderParams {
  baseDenom: string;
  quoteDenom: string;
  side: DexSide;
  orderType: DexOrderType;
  price?: string;
  quantity: string;
  timeInForce?: number;
}

export interface DexOrder {
  id: string;
  creator: string;
  type: number;
  baseDenom: string;
  quoteDenom: string;
  price: string;
  quantity: string;
  side: number;
  remainingQuantity: string;
  remainingBalance: string;
}

export interface OrderbookData {
  bids: DexOrder[];
  asks: DexOrder[];
}

// ─── NFT ─────────────────────────────────────────────────────────────────────

export interface NFTClassFeatures {
  burning?: boolean;
  freezing?: boolean;
  whitelisting?: boolean;
  disableSending?: boolean;
  soulbound?: boolean;
}

export interface IssueNFTClassParams {
  symbol: string;
  name: string;
  description?: string;
  uri?: string;
  uriHash?: string;
  features?: NFTClassFeatures;
  royaltyRate?: string;
}

export interface MintNFTParams {
  classId: string;
  id: string;
  uri?: string;
  uriHash?: string;
  data?: string;
  recipient?: string;
}

// ─── Agent / Swarm ───────────────────────────────────────────────────────────

export interface AgentConfig {
  name: string;
  role: string;
  network?: NetworkName;
  mnemonic?: string;          // Import existing wallet
  isolatedMutex?: boolean;    // Default: true
}

export interface SwarmConfig {
  network?: NetworkName;
  onEvent?: SwarmEventHandler;
  abortSignal?: AbortSignal;
}

export type SwarmEventType =
  | "phase" | "wallet" | "funding" | "balance" | "token"
  | "transfer" | "order" | "fill" | "taker"
  | "return" | "summary" | "done" | "error";

export type SwarmEventHandler = (
  event: SwarmEventType,
  data: Record<string, unknown>
) => void;

export interface StrategyConfig {
  baseDenom: string;
  quoteDenom?: string;        // Default: utestcore
  basePrice?: number;         // Default: 0.001
  buyOrders?: number;         // Default: 12
  sellOrders?: number;        // Default: 11
  overlapCount?: number;      // Default: 6
  takerEnabled?: boolean;     // Default: true
  sellerTokenAmount?: number; // Default: 5000
  takerTokenAmount?: number;  // Default: 2000
}
