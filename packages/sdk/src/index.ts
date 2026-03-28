/**
 * @solomente/txai-sdk — Umbrella SDK
 *
 * Re-exports everything from core, preflight, airdrop, and voting packages,
 * plus agent/swarm orchestration, runtime agents, and access passes.
 *
 * @packageDocumentation
 */

// ─── Core (tokens, NFTs, DEX, wallet, faucet) ───────────────────────────────
export * from "@solomente/txai-core";

// ─── Preflight (compliance checks) ──────────────────────────────────────────
export * from "@solomente/txai-preflight";

// ─── Airdrop (NLP parsing, vesting, scheduling, delivery) ───────────────────
export * from "@solomente/txai-airdrop";

// ─── Voting (DAO proposals, eligibility) ────────────────────────────────────
export * from "@solomente/txai-voting";

// ─── Runtime Agents (script-based, scheduled) ───────────────────────────────
export { RuntimeAgent } from "./runtime-agent.js";
export type { RuntimeAgentConfig, ExecutionLog, RuntimeAgentStats } from "./runtime-agent.js";

// ─── NFT Access Passes (soulbound / whitelisted) ────────────────────────────
export { Pass, PASS_TIERS, PASS_DURATIONS } from "./pass.js";
export type { PassTier, PassStatus, PassDuration } from "./pass.js";

// ─── Agent / Swarm (wallet-based orchestration) ─────────────────────────────
export { Agent } from "./agent.js";
export { Swarm } from "./swarm.js";

// ─── Strategy Interface & Implementations ───────────────────────────────────
export type { Strategy, StrategyResult } from "./swarm.js";
export { MarketMakerStrategy } from "./strategies/market-maker.js";

// ─── Agent / Swarm Types ────────────────────────────────────────────────────
export {
  type AgentConfig,
  type SwarmConfig,
  type SwarmEventType,
  type SwarmEventHandler,
  type StrategyConfig,
} from "./types.js";
