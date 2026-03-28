/**
 * @solomente/txai-voting — Barrel export
 *
 * NFT-gated DAO voting: proposals, eligibility, results.
 */

// ─── Types ───────────────────────────────────────────────────────────────────
export type {
  NFTMetadataRequirement,
  DAOProposal,
  DAOVote,
  DAOResult,
  EligibilityResult,
} from "./types.js";

// ─── Proposals ───────────────────────────────────────────────────────────────
export {
  createProposal,
  getProposals,
  getProposalById,
  castVote,
  getResults,
  closeProposal,
  closeExpiredProposals,
} from "./proposals.js";

// ─── Eligibility ─────────────────────────────────────────────────────────────
export { checkEligibility } from "./eligibility.js";
