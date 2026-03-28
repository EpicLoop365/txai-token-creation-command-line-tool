/**
 * @solomente/txai-airdrop — Barrel export
 *
 * Smart airdrop agent: NLP parsing, address resolution, vesting, scheduling, delivery.
 */

// ─── Types ───────────────────────────────────────────────────────────────────
export type {
  AirdropSource,
  AirdropIntent,
  VestingSchedule,
  VestingStep,
  ResolvedAirdrop,
  ScheduledAirdrop,
  AirdropRecord,
  VestingPlan,
} from "./types.js";

// ─── Parser ──────────────────────────────────────────────────────────────────
export { parseAirdropPrompt } from "./parser.js";

// ─── Resolver ────────────────────────────────────────────────────────────────
export { resolveAddresses, parseCSVAddresses } from "./resolver.js";

// ─── Vesting ─────────────────────────────────────────────────────────────────
export {
  createVestingPlan,
  getVestingPlans,
  getVestingPlanById,
  updateVestingPlan,
  calculateVestingSteps,
  getPendingVestingSteps,
} from "./vesting.js";

// ─── Scheduler ───────────────────────────────────────────────────────────────
export {
  createScheduledAirdrop,
  getScheduledAirdrops,
  getScheduledAirdropById,
  cancelScheduledAirdrop,
  updateScheduledAirdrop,
  getPendingScheduledAirdrops,
} from "./scheduler.js";

// ─── History ─────────────────────────────────────────────────────────────────
export {
  recordAirdrop,
  getAirdropHistory,
  getAirdropById,
} from "./history.js";

// ─── Delivery ────────────────────────────────────────────────────────────────
export { sendAirdropReview } from "./delivery.js";
