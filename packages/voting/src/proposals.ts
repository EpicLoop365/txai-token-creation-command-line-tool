/**
 * proposals.ts — In-memory proposal store + CRUD functions
 */

import { DAOProposal, DAOVote, DAOResult, NFTMetadataRequirement } from "./types.js";

// ─── IN-MEMORY STORE ────────────────────────────────────────────────────────

const proposals = new Map<string, DAOProposal>();

function generateId(): string {
  return "dao-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

// ─── CRUD FUNCTIONS ─────────────────────────────────────────────────────────

export function createProposal(data: {
  title: string;
  description: string;
  creator: string;
  options: string[];
  gateType: "nft" | "token" | "any_wallet";
  nftClassId?: string;
  nftMetadataRequirements?: NFTMetadataRequirement[];
  tokenDenom?: string;
  minTokenBalance?: string;
  votingPower: "equal" | "token_weighted" | "nft_count";
  startTime: string;
  endTime: string;
  network?: string;
}): DAOProposal {
  const now = new Date();
  const start = new Date(data.startTime);
  const status: DAOProposal["status"] = start <= now ? "active" : "draft";

  const proposal: DAOProposal = {
    id: generateId(),
    title: data.title,
    description: data.description,
    creator: data.creator,
    options: data.options,
    gateType: data.gateType,
    nftClassId: data.nftClassId,
    nftMetadataRequirements: data.nftMetadataRequirements,
    tokenDenom: data.tokenDenom,
    minTokenBalance: data.minTokenBalance,
    votingPower: data.votingPower,
    startTime: data.startTime,
    endTime: data.endTime,
    status,
    votes: [],
    createdAt: now.toISOString(),
    network: data.network || "testnet",
  };

  proposals.set(proposal.id, proposal);
  return proposal;
}

export function getProposals(filters?: {
  status?: string;
  network?: string;
}): DAOProposal[] {
  let result = Array.from(proposals.values());

  if (filters?.status) {
    result = result.filter((p) => p.status === filters.status);
  }
  if (filters?.network) {
    result = result.filter((p) => p.network === filters.network);
  }

  // Sort by creation date, newest first
  result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return result;
}

export function getProposalById(id: string): DAOProposal | undefined {
  return proposals.get(id);
}

export function castVote(
  proposalId: string,
  vote: DAOVote
): { success: boolean; error?: string } {
  const proposal = proposals.get(proposalId);
  if (!proposal) return { success: false, error: "Proposal not found." };

  // Check for double voting
  const existing = proposal.votes.find((v) => v.voter === vote.voter);
  if (existing) return { success: false, error: "You have already voted on this proposal." };

  // Check proposal is active
  if (proposal.status !== "active") {
    return { success: false, error: `Proposal is ${proposal.status}, not active.` };
  }

  // Check time window
  const now = new Date();
  if (now < new Date(proposal.startTime)) {
    return { success: false, error: "Voting has not started yet." };
  }
  if (now > new Date(proposal.endTime)) {
    return { success: false, error: "Voting period has ended." };
  }

  // Check option is valid
  if (vote.option < 0 || vote.option >= proposal.options.length) {
    return { success: false, error: "Invalid voting option." };
  }

  proposal.votes.push(vote);
  return { success: true };
}

export function getResults(proposalId: string): DAOResult | null {
  const proposal = proposals.get(proposalId);
  if (!proposal) return null;

  const optionResults = proposal.options.map((label, index) => {
    const optionVotes = proposal.votes.filter((v) => v.option === index);
    const votes = optionVotes.length;
    const power = optionVotes.reduce((sum, v) => sum + v.power, 0);
    return { label, votes, power, percentage: 0 };
  });

  const totalPower = optionResults.reduce((sum, o) => sum + o.power, 0);

  // Calculate percentages
  for (const opt of optionResults) {
    opt.percentage = totalPower > 0 ? Math.round((opt.power / totalPower) * 10000) / 100 : 0;
  }

  // Determine winner (by power)
  const maxPower = Math.max(...optionResults.map((o) => o.power));
  const winners = optionResults.filter((o) => o.power === maxPower);
  const winningOption = winners.length === 1 ? winners[0].label : "Tie";

  // Simple quorum: at least 1 voter (can be made configurable)
  const quorumMet = proposal.votes.length > 0;

  return {
    proposalId: proposal.id,
    title: proposal.title,
    totalVoters: proposal.votes.length,
    totalPower,
    options: optionResults,
    quorumMet,
    winningOption,
    status: proposal.status,
  };
}

export function closeProposal(
  proposalId: string,
  creator: string
): { success: boolean; error?: string } {
  const proposal = proposals.get(proposalId);
  if (!proposal) return { success: false, error: "Proposal not found." };

  if (proposal.creator !== creator) {
    return { success: false, error: "Only the proposal creator can close it." };
  }

  if (proposal.status === "closed" || proposal.status === "cancelled") {
    return { success: false, error: `Proposal is already ${proposal.status}.` };
  }

  proposal.status = "closed";
  return { success: true };
}

export function closeExpiredProposals(): number {
  const now = new Date();
  let closed = 0;

  for (const proposal of proposals.values()) {
    if (proposal.status === "active" && new Date(proposal.endTime) < now) {
      proposal.status = "closed";
      closed++;
    }
    // Activate drafts whose start time has passed
    if (proposal.status === "draft" && new Date(proposal.startTime) <= now) {
      proposal.status = "active";
    }
  }

  return closed;
}
