/**
 * types.ts — Airdrop type definitions
 */

export type AirdropSource =
  | { type: "holders"; denom: string }
  | { type: "stakers"; validator: string }
  | { type: "nft_holders"; classId: string }
  | { type: "csv"; raw: string }
  | { type: "tx_history"; address: string }
  | { type: "addresses"; list: string[] };

export interface AirdropIntent {
  sources: AirdropSource[];
  combineMode: "union" | "intersection";
  tokenDenom: string;
  amountPerRecipient: string;
  amountMode: "fixed" | "proportional";
  limit?: number;
  sortBy?: "balance" | "stake";
  csvData?: string;
  excludeAddresses?: string[];
  vesting?: VestingSchedule;
}

export interface VestingSchedule {
  type: "cliff" | "linear" | "cliff_linear" | "milestone";
  cliffDate?: string;
  startDate?: string;
  endDate?: string;
  intervalMonths?: number;
  linearStartDate?: string;
  linearEndDate?: string;
  milestones?: Array<{ date: string; percentage: number }>;
}

export interface VestingStep {
  date: string;
  action: "setWhitelistedLimit" | "unfreezeAccount";
  address: string;
  amount?: string;
}

export interface ResolvedAirdrop {
  recipients: Array<{ address: string; amount: string }>;
  totalAmount: string;
  invalidAddresses: string[];
  duplicatesRemoved: number;
  sourceBreakdown: Record<string, number>;
  excludedCount: number;
}

export interface ScheduledAirdrop {
  id: string;
  denom: string;
  recipients: Array<{ address: string; amount: string }>;
  sender: string;
  network: string;
  scheduleType: "time" | "price";
  executeAt?: string;
  triggerDenom?: string;
  triggerPrice?: number;
  triggerDirection?: "above" | "below";
  status: "pending" | "executing" | "completed" | "failed" | "cancelled";
  createdAt: string;
  executedAt?: string;
  result?: { sent: number; failed: number; txHashes: string[] };
}

export interface AirdropRecord {
  id: string;
  timestamp: string;
  denom: string;
  sender: string;
  network: string;
  totalRecipients: number;
  totalAmount: string;
  sent: number;
  failed: number;
  txHashes: string[];
  failedAddresses: Array<{ address: string; error: string }>;
  dryRun: boolean;
  scheduled: boolean;
  durationMs: number;
}

export interface VestingPlan {
  id: string;
  airdropId?: string;
  denom: string;
  sender: string;
  network: string;
  schedule: VestingSchedule;
  recipients: Array<{ address: string; amount: string }>;
  steps: VestingStep[];
  completedSteps: number;
  status: "active" | "completed" | "cancelled";
  createdAt: string;
}
