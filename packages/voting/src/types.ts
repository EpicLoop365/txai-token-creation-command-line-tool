/**
 * @solomente/txai-voting — Type Definitions
 */

export interface NFTMetadataRequirement {
  field: string;       // e.g. "role", "tier", "status"
  value: string;       // e.g. "member", "gold", "active"
  operator?: "eq" | "neq" | "exists" | "gt" | "lt"; // default "eq"
}

export interface DAOProposal {
  id: string;
  title: string;
  description: string;
  creator: string; // wallet address
  options: string[]; // e.g. ["Yes", "No", "Abstain"]
  gateType: "nft" | "token" | "any_wallet";
  // For NFT gating:
  nftClassId?: string; // required NFT class to vote
  nftMetadataRequirements?: NFTMetadataRequirement[]; // metadata fields to verify
  // For token gating:
  tokenDenom?: string; // required token denom
  minTokenBalance?: string; // minimum balance to vote
  // Voting power:
  votingPower: "equal" | "token_weighted" | "nft_count";
  // Timing:
  startTime: string; // ISO date
  endTime: string; // ISO date
  status: "draft" | "active" | "closed" | "cancelled";
  // Results:
  votes: DAOVote[];
  createdAt: string;
  network: string;
}

export interface DAOVote {
  voter: string; // wallet address
  option: number; // index into options array
  power: number; // voting power (1 for equal, balance for weighted)
  timestamp: string;
  // Verification:
  nftId?: string; // which NFT qualified them
  tokenBalance?: string; // their balance at time of vote
}

export interface DAOResult {
  proposalId: string;
  title: string;
  totalVoters: number;
  totalPower: number;
  options: Array<{
    label: string;
    votes: number;
    power: number;
    percentage: number;
  }>;
  quorumMet: boolean;
  winningOption: string;
  status: string;
}

export interface EligibilityResult {
  eligible: boolean;
  power: number;
  reason?: string;
  nftId?: string;
  tokenBalance?: string;
}
