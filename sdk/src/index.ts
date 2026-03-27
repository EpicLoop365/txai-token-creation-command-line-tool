/**
 * @txai/agent-sdk
 *
 * Deploy AI agent swarms on Coreum blockchain.
 * Autonomous wallets, DEX trading, token management, and NFTs.
 *
 * @example
 * ```typescript
 * import { Swarm, Agent, MarketMakerStrategy } from '@txai/agent-sdk';
 *
 * // Create a swarm with 3 agents
 * const swarm = new Swarm({ network: 'testnet' });
 * swarm.createAgent('MM-Buyer', 'buyer');
 * swarm.createAgent('MM-Seller', 'seller');
 * swarm.createAgent('Taker', 'taker');
 *
 * // Set up event streaming
 * swarm.onEvent((event, data) => {
 *   console.log(`[${event}]`, data);
 * });
 *
 * // Initialize, fund, and execute
 * await swarm.initAll();
 * await swarm.fundAll();
 * const result = await swarm.execute(
 *   new MarketMakerStrategy({ baseDenom: 'mytoken-testcore1abc...' })
 * );
 *
 * console.log(`Done! ${result.ordersPlaced} orders, ${result.fills} fills`);
 * swarm.disconnectAll();
 * ```
 *
 * @packageDocumentation
 */

// Core classes
export { Agent } from "./agent";
export { Swarm } from "./swarm";

// Strategy interface & implementations
export type { Strategy, StrategyResult } from "./swarm";
export { MarketMakerStrategy } from "./strategies/market-maker";

// All types
export {
  // Network
  type NetworkName,
  type NetworkConfig,

  // Wallet
  type WalletInfo,

  // Balances & Transactions
  type TokenBalance,
  type TransactionResult,

  // Smart Tokens
  type SmartTokenFeatures,
  type IssueSmartTokenParams,
  type SmartTokenInfo,

  // DEX
  DexSide,
  DexOrderType,
  type PlaceOrderParams,
  type DexOrder,
  type OrderbookData,

  // NFT
  type NFTClassFeatures,
  type IssueNFTClassParams,
  type MintNFTParams,

  // Agent / Swarm config
  type AgentConfig,
  type SwarmConfig,
  type SwarmEventType,
  type SwarmEventHandler,
  type StrategyConfig,
} from "./types";
