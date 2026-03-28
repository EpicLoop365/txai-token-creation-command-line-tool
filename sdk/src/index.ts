/**
 * @txai/agent-sdk
 *
 * Build autonomous AI agents on TX (Coreum) blockchain.
 * NFTs are careers — agents that work, earn, and build reputations.
 *
 * @example
 * ```typescript
 * import { RuntimeAgent } from '@txai/agent-sdk';
 *
 * // Create an agent that monitors whale activity
 * const watcher = new RuntimeAgent({
 *   name: 'Whale Watcher',
 *   interval: 60,
 *   script: `
 *     const bal = await chain.getBalance('testcore1abc...', 'utestcore');
 *     if (parseInt(bal.amount) > 10000000) {
 *       agent.alert('Whale: ' + bal.amount);
 *     }
 *   `,
 * });
 *
 * watcher.onAlert((msg) => console.log('ALERT:', msg));
 * await watcher.start();
 * ```
 *
 * @example
 * ```typescript
 * import { Swarm, Agent, MarketMakerStrategy } from '@txai/agent-sdk';
 *
 * // Create a DEX trading swarm
 * const swarm = new Swarm({ network: 'testnet' });
 * swarm.createAgent('Buyer', 'buyer');
 * swarm.createAgent('Seller', 'seller');
 * await swarm.initAll();
 * await swarm.execute(new MarketMakerStrategy({ baseDenom: 'mytoken-...' }));
 * ```
 *
 * @packageDocumentation
 */

// Runtime agents (script-based, scheduled)
export { RuntimeAgent } from "./runtime-agent";
export type { RuntimeAgentConfig, ExecutionLog, RuntimeAgentStats } from "./runtime-agent";

// NFT access passes (soulbound / whitelisted)
export { Pass, PASS_TIERS, PASS_DURATIONS } from "./pass";
export type { PassTier, PassStatus, PassDuration } from "./pass";

// Core agent classes (wallet-based)
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
