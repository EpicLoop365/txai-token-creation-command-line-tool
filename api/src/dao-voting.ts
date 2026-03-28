/**
 * dao-voting.ts — NFT-gated DAO Voting Tool for TXAI Studio
 *
 * Provides:
 *   - Proposal creation with NFT/token/open gating
 *   - On-chain eligibility verification (NFT ownership, token balance)
 *   - Voting power modes: equal, token-weighted, NFT-count
 *   - In-memory proposal + vote storage
 *   - Result tallying with quorum detection
 */

// ─── TYPES ──────────────────────────────────────────────────────────────────

export interface DAOProposal {
  id: string;
  title: string;
  description: string;
  creator: string; // wallet address
  options: string[]; // e.g. ["Yes", "No", "Abstain"]
  gateType: "nft" | "token" | "any_wallet";
  // For NFT gating:
  nftClassId?: string; // required NFT class to vote
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

// ─── ELIGIBILITY CHECKER ────────────────────────────────────────────────────

export async function checkEligibility(
  voter: string,
  proposal: DAOProposal,
  _network: string,
  restUrl: string
): Promise<EligibilityResult> {
  try {
    // any_wallet gate: always eligible, power = 1
    if (proposal.gateType === "any_wallet") {
      return { eligible: true, power: 1 };
    }

    // NFT gate: check if voter owns an NFT in the required class
    if (proposal.gateType === "nft") {
      if (!proposal.nftClassId) {
        return { eligible: false, power: 0, reason: "Proposal has no NFT class configured." };
      }

      const nftsUrl = `${restUrl}/coreum/asset/nft/v1/nfts?class_id=${encodeURIComponent(proposal.nftClassId)}&owner=${encodeURIComponent(voter)}`;
      const nftsRes = await fetch(nftsUrl);
      const nftsData: any = await nftsRes.json();

      const nfts: any[] = nftsData.nfts || nftsData.items || [];

      if (nfts.length === 0) {
        return {
          eligible: false,
          power: 0,
          reason: `You do not hold any NFTs from class ${proposal.nftClassId}.`,
        };
      }

      // Determine power
      let power = 1;
      if (proposal.votingPower === "nft_count") {
        power = nfts.length;
      }

      return {
        eligible: true,
        power,
        nftId: nfts[0].id || nfts[0].nft_id || nfts[0].Id || "unknown",
      };
    }

    // Token gate: check balance
    if (proposal.gateType === "token") {
      if (!proposal.tokenDenom) {
        return { eligible: false, power: 0, reason: "Proposal has no token denom configured." };
      }

      const balUrl = `${restUrl}/cosmos/bank/v1beta1/balances/${encodeURIComponent(voter)}/by_denom?denom=${encodeURIComponent(proposal.tokenDenom)}`;
      const balRes = await fetch(balUrl);
      const balData: any = await balRes.json();
      const balance = balData?.balance?.amount || "0";
      const balNum = parseInt(balance, 10);

      const minBalance = parseInt(proposal.minTokenBalance || "1", 10);

      if (balNum < minBalance) {
        return {
          eligible: false,
          power: 0,
          reason: `Insufficient balance. You hold ${balance} but need at least ${proposal.minTokenBalance || "1"} of ${proposal.tokenDenom}.`,
          tokenBalance: balance,
        };
      }

      // Determine power
      let power = 1;
      if (proposal.votingPower === "token_weighted") {
        power = balNum;
      }

      return {
        eligible: true,
        power,
        tokenBalance: balance,
      };
    }

    return { eligible: false, power: 0, reason: "Unknown gate type." };
  } catch (err) {
    return {
      eligible: false,
      power: 0,
      reason: `Chain query failed: ${(err as Error).message}`,
    };
  }
}
