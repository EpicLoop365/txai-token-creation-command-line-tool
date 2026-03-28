/**
 * smart-airdrop.ts — Smart Airdrop Agent for TXAI Studio
 *
 * Core module providing:
 *   - NLP-powered intent parsing (via Anthropic SDK)
 *   - Multi-source address resolution (stakers, NFT holders, CSV, tx history, etc.)
 *   - Union/intersection combining, deduplication, validation
 *   - Email/Telegram delivery formatting
 */

import Anthropic from "@anthropic-ai/sdk";

// ─── TYPES ──────────────────────────────────────────────────────────────────

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

// ─── VESTING TYPES ──────────────────────────────────────────────────────────

export interface VestingSchedule {
  type: "cliff" | "linear" | "cliff_linear" | "milestone";
  // For cliff:
  cliffDate?: string; // ISO date — unfreeze all at this date
  // For linear:
  startDate?: string; // ISO date
  endDate?: string; // ISO date
  intervalMonths?: number; // unlock interval (default 1)
  // For cliff_linear:
  linearStartDate?: string; // usually same as cliffDate
  linearEndDate?: string;
  // For milestone:
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

// ─── NLP PARSER ─────────────────────────────────────────────────────────────

const AIRDROP_SYSTEM_PROMPT = `You are a structured data extraction engine for a Coreum blockchain airdrop tool.

Your job: parse the user's natural language airdrop description into a strict JSON object matching the AirdropIntent schema.

## Supported source types:

1. **holders** — Token holders of a specific denom
   Examples: "all holders of ucore", "holders of MYTOKEN-testcore1abc..."

2. **stakers** — Delegators of a specific validator
   Examples: "stakers of testcorevaloper1abc...", "all delegators of validator X"

3. **nft_holders** — Holders of NFTs in a specific class
   Examples: "holders of NFT class my-nft-testcore1abc...", "everyone with an NFT from class Z"

4. **csv** — Raw CSV data with addresses (one per line, or address,amount format)
   Examples: "use this CSV: testcore1aaa...\\ntestcore1bbb..."

5. **tx_history** — Addresses that have transacted with a specific address
   Examples: "everyone who sent tokens to testcore1abc...", "all counterparties of address X"

6. **addresses** — A direct list of addresses
   Examples: "send to testcore1aaa, testcore1bbb, testcore1ccc"

## Combine modes:
- "union" (default) — combine all addresses from all sources (OR)
- "intersection" — only addresses that appear in ALL sources (AND)

## Amount modes:
- "fixed" (default) — same amount to every recipient
- "proportional" — amount proportional to balance/stake (requires sortBy)

## Exclusion:
If the user says "EXCEPT", "excluding", "not including", "exclude", etc., extract the excluded addresses into the "excludeAddresses" array.
Examples:
- "Airdrop to all stakers EXCEPT core1abc..., core1def..." → excludeAddresses: ["core1abc...", "core1def..."]
- "Airdrop to holders excluding exchanges" → excludeAddresses: [] (no specific addresses; the word "exchanges" is a hint for the UI, not parseable addresses)

## Output schema (JSON only, no markdown):
{
  "sources": [{ "type": "...", ... }],
  "combineMode": "union" | "intersection",
  "tokenDenom": "string — the token denom to airdrop",
  "amountPerRecipient": "string — amount in base units",
  "amountMode": "fixed" | "proportional",
  "limit": number | null,
  "sortBy": "balance" | "stake" | null,
  "csvData": "string | null",
  "excludeAddresses": ["string"] | null
}

## Rules:
- Always return valid JSON, no explanation, no markdown fences.
- If the user mentions a limit like "top 50", set limit to 50 and sortBy to the relevant field.
- If the user pastes CSV data, put it in a csv source and also in csvData.
- Default combineMode to "union" unless the user says "AND", "intersection", "only addresses in both", etc.
- Default amountMode to "fixed".
- The tokenDenom should be the denom being sent (airdropped), not the denom being used to select recipients.
- If the user doesn't specify an amount, default amountPerRecipient to "1000000" (1 token in base units).
- If the user says "airdrop TOKEN to stakers of VALIDATOR", tokenDenom = TOKEN, source type = stakers.
`;

/**
 * Parse a natural language airdrop prompt into a structured AirdropIntent.
 *
 * @param prompt - User's natural language description of the airdrop
 * @param anthropicClient - Anthropic SDK client instance
 * @returns Parsed AirdropIntent
 */
export async function parseAirdropPrompt(
  prompt: string,
  anthropicClient: Anthropic
): Promise<AirdropIntent> {
  const response = await anthropicClient.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    system: AIRDROP_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Strip any accidental markdown fences
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned) as AirdropIntent;

    // Apply defaults
    if (!parsed.combineMode) parsed.combineMode = "union";
    if (!parsed.amountMode) parsed.amountMode = "fixed";
    if (!parsed.amountPerRecipient) parsed.amountPerRecipient = "1000000";
    if (!parsed.sources) parsed.sources = [];

    return parsed;
  } catch (err) {
    throw new Error(
      `Failed to parse AI response into AirdropIntent: ${(err as Error).message}. Raw: ${cleaned.slice(0, 500)}`
    );
  }
}

// ─── ADDRESS RESOLVER ───────────────────────────────────────────────────────

/**
 * Resolve all addresses from the AirdropIntent sources, apply combine mode,
 * deduplication, limit/sort, and validate address format.
 *
 * @param intent - The parsed airdrop intent
 * @param network - Network name ("testnet" | "mainnet")
 * @param restUrl - Coreum REST endpoint URL
 * @returns ResolvedAirdrop with recipients and metadata
 */
export async function resolveAddresses(
  intent: AirdropIntent,
  network: string,
  restUrl: string
): Promise<ResolvedAirdrop> {
  const addressPrefix = network === "mainnet" ? "core1" : "testcore1";
  const sourceBreakdown: Record<string, number> = {};

  // Resolve each source into a set of addresses
  const resolvedSources: Array<{ label: string; addresses: Set<string> }> = [];

  for (const source of intent.sources) {
    let addresses: string[] = [];
    let label: string = source.type;

    switch (source.type) {
      case "stakers": {
        label = `stakers:${source.validator}`;
        addresses = await fetchStakers(restUrl, source.validator);
        break;
      }
      case "nft_holders": {
        label = `nft_holders:${source.classId}`;
        addresses = await fetchNFTHolders(restUrl, source.classId);
        break;
      }
      case "holders": {
        label = `holders:${source.denom}`;
        addresses = await fetchHolders(restUrl, source.denom);
        break;
      }
      case "csv": {
        label = "csv";
        addresses = parseCSVAddresses(source.raw || intent.csvData || "");
        break;
      }
      case "tx_history": {
        label = `tx_history:${source.address}`;
        addresses = await fetchTxCounterparties(restUrl, source.address);
        break;
      }
      case "addresses": {
        label = "addresses";
        addresses = source.list;
        break;
      }
    }

    const addrSet = new Set(addresses);
    sourceBreakdown[label] = addrSet.size;
    resolvedSources.push({ label, addresses: addrSet });
  }

  // Combine sources
  let combinedAddresses: Set<string>;

  if (intent.combineMode === "intersection" && resolvedSources.length > 1) {
    // Intersection: only addresses in ALL sources
    combinedAddresses = new Set(resolvedSources[0].addresses);
    for (let i = 1; i < resolvedSources.length; i++) {
      const srcSet = resolvedSources[i].addresses;
      for (const addr of combinedAddresses) {
        if (!srcSet.has(addr)) {
          combinedAddresses.delete(addr);
        }
      }
    }
  } else {
    // Union: all addresses from all sources
    combinedAddresses = new Set<string>();
    for (const src of resolvedSources) {
      for (const addr of src.addresses) {
        combinedAddresses.add(addr);
      }
    }
  }

  // Track duplicates removed (total across sources minus unique count)
  const totalAcrossSources = resolvedSources.reduce(
    (sum, s) => sum + s.addresses.size,
    0
  );
  const duplicatesRemoved =
    intent.combineMode === "union"
      ? totalAcrossSources - combinedAddresses.size
      : 0;

  // Filter out excluded addresses
  let excludedCount = 0;
  if (intent.excludeAddresses && intent.excludeAddresses.length > 0) {
    const excludeSet = new Set(intent.excludeAddresses.map((a) => a.trim()).filter(Boolean));
    for (const addr of combinedAddresses) {
      if (excludeSet.has(addr)) {
        combinedAddresses.delete(addr);
        excludedCount++;
      }
    }
  }

  // Validate addresses
  const validAddresses: string[] = [];
  const invalidAddresses: string[] = [];

  for (const addr of combinedAddresses) {
    if (addr.startsWith("core1") || addr.startsWith("testcore1")) {
      validAddresses.push(addr);
    } else {
      invalidAddresses.push(addr);
    }
  }

  // Apply sort (best effort — for now just alphabetical, as we don't have
  // balance/stake data per address without additional queries)
  let sorted = validAddresses;
  // sortBy would require fetching balance/stake for each address — skip for
  // performance unless explicitly needed in the future

  // Apply limit
  if (intent.limit && intent.limit > 0) {
    sorted = sorted.slice(0, intent.limit);
  }

  // Build recipients with amounts
  const recipients = sorted.map((address) => ({
    address,
    amount: intent.amountPerRecipient,
  }));

  // Calculate total
  const totalAmount = (
    BigInt(intent.amountPerRecipient) * BigInt(recipients.length)
  ).toString();

  return {
    recipients,
    totalAmount,
    invalidAddresses,
    duplicatesRemoved,
    sourceBreakdown,
    excludedCount,
  };
}

// ─── CHAIN QUERY HELPERS ────────────────────────────────────────────────────

/**
 * Fetch all delegators of a given validator via paginated REST queries.
 */
async function fetchStakers(
  restUrl: string,
  validatorAddr: string
): Promise<string[]> {
  const addresses: string[] = [];
  let nextKey: string | null = null;

  try {
    do {
      let url = `${restUrl}/cosmos/staking/v1beta1/validators/${validatorAddr}/delegations?pagination.limit=1000`;
      if (nextKey) {
        url += `&pagination.key=${encodeURIComponent(nextKey)}`;
      }

      const resp = await fetch(url);
      if (!resp.ok) {
        console.error(
          `[smart-airdrop] Stakers query failed: ${resp.status} ${resp.statusText}`
        );
        break;
      }

      const data: any = await resp.json();
      const delegations = data.delegation_responses || [];
      for (const d of delegations) {
        if (d.delegation?.delegator_address) {
          addresses.push(d.delegation.delegator_address);
        }
      }

      nextKey = data.pagination?.next_key || null;
    } while (nextKey);
  } catch (err) {
    console.error(
      `[smart-airdrop] Error fetching stakers for ${validatorAddr}:`,
      (err as Error).message
    );
  }

  return addresses;
}

/**
 * Fetch NFT holders for a given class by iterating all NFTs and collecting owners.
 */
async function fetchNFTHolders(
  restUrl: string,
  classId: string
): Promise<string[]> {
  const owners: string[] = [];
  let nextKey: string | null = null;

  try {
    do {
      let url = `${restUrl}/coreum/asset/nft/v1/classes/${classId}/nfts?pagination.limit=1000`;
      if (nextKey) {
        url += `&pagination.key=${encodeURIComponent(nextKey)}`;
      }

      const resp = await fetch(url);
      if (!resp.ok) {
        // Fallback: try cosmos NFT module
        const fallbackUrl = `${restUrl}/cosmos/nft/v1beta1/nfts?class_id=${classId}&pagination.limit=1000`;
        const fallbackResp = await fetch(fallbackUrl);
        if (!fallbackResp.ok) break;

        const fallbackData: any = await fallbackResp.json();
        const nfts = fallbackData.nfts || [];

        // For each NFT, query the owner
        for (const nft of nfts) {
          try {
            const ownerResp = await fetch(
              `${restUrl}/cosmos/nft/v1beta1/owner/${classId}/${nft.id}`
            );
            if (ownerResp.ok) {
              const ownerData: any = await ownerResp.json();
              if (ownerData.owner) {
                owners.push(ownerData.owner);
              }
            }
          } catch {
            // Skip individual NFT errors
          }
        }
        break;
      }

      const data: any = await resp.json();
      const nfts = data.nfts || [];
      for (const nft of nfts) {
        if (nft.owner) {
          owners.push(nft.owner);
        }
      }

      nextKey = data.pagination?.next_key || null;
    } while (nextKey);
  } catch (err) {
    console.error(
      `[smart-airdrop] Error fetching NFT holders for ${classId}:`,
      (err as Error).message
    );
  }

  return owners;
}

/**
 * Fetch token holders for a denom. Coreum has limited holder enumeration,
 * so this uses a best-effort approach via the supply endpoint and known APIs.
 */
async function fetchHolders(
  restUrl: string,
  denom: string
): Promise<string[]> {
  const addresses: string[] = [];

  try {
    // Try the Coreum-specific denom holders endpoint (if available)
    const resp = await fetch(
      `${restUrl}/cosmos/bank/v1beta1/denom_owners/${denom}?pagination.limit=1000`
    );
    if (resp.ok) {
      const data: any = await resp.json();
      const denomOwners = data.denom_owners || [];
      for (const owner of denomOwners) {
        if (owner.address) {
          addresses.push(owner.address);
        }
      }
    }
  } catch (err) {
    console.error(
      `[smart-airdrop] Error fetching holders for ${denom}:`,
      (err as Error).message
    );
  }

  return addresses;
}

/**
 * Parse CSV text into an array of addresses.
 * Supports: one address per line, or address,amount format.
 */
function parseCSVAddresses(raw: string): string[] {
  const addresses: string[] = [];
  const lines = raw
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    // Handle address,amount format
    const parts = line.split(",").map((p) => p.trim());
    const addr = parts[0];
    if (addr && (addr.startsWith("core1") || addr.startsWith("testcore1"))) {
      addresses.push(addr);
    }
  }

  return addresses;
}

/**
 * Fetch counterparty addresses from transaction history of a given address.
 * Queries for both sent and received transactions.
 */
async function fetchTxCounterparties(
  restUrl: string,
  address: string
): Promise<string[]> {
  const counterparties = new Set<string>();

  try {
    // Query transactions where the address is the sender
    const senderUrl = `${restUrl}/cosmos/tx/v1beta1/txs?events=message.sender%3D%27${address}%27&pagination.limit=100`;
    const senderResp = await fetch(senderUrl);
    if (senderResp.ok) {
      const senderData: any = await senderResp.json();
      extractCounterparties(senderData, address, counterparties);
    }

    // Query transactions where the address is the recipient
    const recipientUrl = `${restUrl}/cosmos/tx/v1beta1/txs?events=transfer.recipient%3D%27${address}%27&pagination.limit=100`;
    const recipientResp = await fetch(recipientUrl);
    if (recipientResp.ok) {
      const recipientData: any = await recipientResp.json();
      extractCounterparties(recipientData, address, counterparties);
    }
  } catch (err) {
    console.error(
      `[smart-airdrop] Error fetching tx history for ${address}:`,
      (err as Error).message
    );
  }

  return Array.from(counterparties);
}

/**
 * Extract counterparty addresses from tx query results.
 */
function extractCounterparties(
  txData: any,
  selfAddress: string,
  counterparties: Set<string>
): void {
  const txResponses = txData.tx_responses || [];
  for (const txResp of txResponses) {
    const logs = txResp.logs || [];
    for (const log of logs) {
      const events = log.events || [];
      for (const event of events) {
        if (event.type === "transfer") {
          const attrs = event.attributes || [];
          for (const attr of attrs) {
            const val = attr.value;
            if (
              val &&
              val !== selfAddress &&
              (val.startsWith("core1") || val.startsWith("testcore1"))
            ) {
              counterparties.add(val);
            }
          }
        }
      }
    }
  }
}

// ─── EMAIL / TELEGRAM DELIVERY ──────────────────────────────────────────────

/**
 * Format and "send" an airdrop review summary via email or Telegram.
 * Currently formats the data and logs it. Transport can be wired later.
 *
 * @param resolved - The resolved airdrop data
 * @param delivery - Delivery method and target
 * @param tokenDenom - The token denom being airdropped
 * @returns Success/error status
 */
export async function sendAirdropReview(
  resolved: ResolvedAirdrop,
  delivery: { type: "email" | "telegram"; target: string },
  tokenDenom: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (delivery.type === "email") {
      const html = formatEmailHTML(resolved, tokenDenom);
      const text = formatEmailText(resolved, tokenDenom);

      // For now, log the formatted output. Nodemailer or SMTP transport
      // can be wired in by setting SMTP_HOST, SMTP_USER, etc.
      console.log(`[smart-airdrop] Email review for ${delivery.target}:`);
      console.log(`[smart-airdrop] Subject: Airdrop Review — ${tokenDenom}`);
      console.log(`[smart-airdrop] Text preview:\n${text}`);

      // TODO: Wire actual email transport when SMTP is configured
      // const transporter = nodemailer.createTransport({ ... });
      // await transporter.sendMail({ to: delivery.target, subject, html, text });

      return { ok: true };
    }

    if (delivery.type === "telegram") {
      const message = formatTelegramMessage(resolved, tokenDenom);

      console.log(
        `[smart-airdrop] Telegram review for ${delivery.target}:`
      );
      console.log(message);

      // TODO: Wire Telegram Bot API when BOT_TOKEN is configured
      // await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      //   method: "POST",
      //   headers: { "Content-Type": "application/json" },
      //   body: JSON.stringify({ chat_id: delivery.target, text: message, parse_mode: "HTML" }),
      // });

      return { ok: true };
    }

    return { ok: false, error: `Unknown delivery type: ${delivery.type}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── FORMATTING HELPERS ─────────────────────────────────────────────────────

function formatEmailHTML(
  resolved: ResolvedAirdrop,
  tokenDenom: string
): string {
  const rows = resolved.recipients
    .slice(0, 100)
    .map(
      (r) =>
        `<tr><td style="padding:4px 8px;border:1px solid #ddd;font-family:monospace;font-size:12px">${r.address}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right">${r.amount}</td></tr>`
    )
    .join("\n");

  const sourceLines = Object.entries(resolved.sourceBreakdown)
    .map(([k, v]) => `<li>${k}: ${v} addresses</li>`)
    .join("\n");

  return `
<h2>Airdrop Review — ${tokenDenom}</h2>
<table style="border-collapse:collapse;margin:8px 0">
  <tr><td><strong>Total recipients:</strong></td><td>${resolved.recipients.length}</td></tr>
  <tr><td><strong>Total amount:</strong></td><td>${resolved.totalAmount} ${tokenDenom}</td></tr>
  <tr><td><strong>Duplicates removed:</strong></td><td>${resolved.duplicatesRemoved}</td></tr>
  <tr><td><strong>Invalid addresses:</strong></td><td>${resolved.invalidAddresses.length}</td></tr>
</table>

<h3>Source breakdown</h3>
<ul>${sourceLines}</ul>

<h3>Recipients${resolved.recipients.length > 100 ? " (first 100)" : ""}</h3>
<table style="border-collapse:collapse">
  <tr><th style="padding:4px 8px;border:1px solid #ddd;background:#f5f5f5">Address</th><th style="padding:4px 8px;border:1px solid #ddd;background:#f5f5f5">Amount</th></tr>
  ${rows}
</table>
`.trim();
}

function formatEmailText(
  resolved: ResolvedAirdrop,
  tokenDenom: string
): string {
  const lines = [
    `Airdrop Review — ${tokenDenom}`,
    ``,
    `Total recipients: ${resolved.recipients.length}`,
    `Total amount: ${resolved.totalAmount} ${tokenDenom}`,
    `Duplicates removed: ${resolved.duplicatesRemoved}`,
    `Invalid addresses: ${resolved.invalidAddresses.length}`,
    ``,
    `Source breakdown:`,
    ...Object.entries(resolved.sourceBreakdown).map(
      ([k, v]) => `  ${k}: ${v} addresses`
    ),
    ``,
    `Recipients${resolved.recipients.length > 100 ? " (first 100)" : ""}:`,
    ...resolved.recipients
      .slice(0, 100)
      .map((r) => `  ${r.address}  ${r.amount}`),
  ];
  return lines.join("\n");
}

function formatTelegramMessage(
  resolved: ResolvedAirdrop,
  tokenDenom: string
): string {
  const sourceLines = Object.entries(resolved.sourceBreakdown)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join("\n");

  const addrList = resolved.recipients
    .slice(0, 20)
    .map((r) => `<code>${r.address}</code> — ${r.amount}`)
    .join("\n");

  const moreText =
    resolved.recipients.length > 20
      ? `\n... and ${resolved.recipients.length - 20} more`
      : "";

  return [
    `<b>Airdrop Review — ${tokenDenom}</b>`,
    ``,
    `Recipients: ${resolved.recipients.length}`,
    `Total: ${resolved.totalAmount} ${tokenDenom}`,
    `Duplicates removed: ${resolved.duplicatesRemoved}`,
    `Invalid: ${resolved.invalidAddresses.length}`,
    ``,
    `<b>Sources:</b>`,
    sourceLines,
    ``,
    `<b>Recipients:</b>`,
    addrList,
    moreText,
  ].join("\n");
}

// ─── SCHEDULED AIRDROP TYPES & STORE ─────────────────────────────────────

export interface ScheduledAirdrop {
  id: string;
  denom: string;
  recipients: Array<{ address: string; amount: string }>;
  sender: string;
  network: string;
  scheduleType: "time" | "price";
  // For time-based:
  executeAt?: string; // ISO date string
  // For price-based:
  triggerDenom?: string; // denom to watch
  triggerPrice?: number; // USD price threshold
  triggerDirection?: "above" | "below";
  status: "pending" | "executing" | "completed" | "failed" | "cancelled";
  createdAt: string;
  executedAt?: string;
  result?: { sent: number; failed: number; txHashes: string[] };
}

const scheduledAirdrops = new Map<string, ScheduledAirdrop>();

let _scheduleCounter = 0;

export function createScheduledAirdrop(
  data: Omit<ScheduledAirdrop, "id" | "status" | "createdAt">
): ScheduledAirdrop {
  _scheduleCounter++;
  const id = `sa-sched-${Date.now()}-${_scheduleCounter}`;
  const scheduled: ScheduledAirdrop = {
    ...data,
    id,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  scheduledAirdrops.set(id, scheduled);
  return scheduled;
}

export function getScheduledAirdrops(): ScheduledAirdrop[] {
  return Array.from(scheduledAirdrops.values());
}

export function getScheduledAirdropById(id: string): ScheduledAirdrop | undefined {
  return scheduledAirdrops.get(id);
}

export function cancelScheduledAirdrop(id: string): boolean {
  const sa = scheduledAirdrops.get(id);
  if (!sa || sa.status !== "pending") return false;
  sa.status = "cancelled";
  return true;
}

export function updateScheduledAirdrop(id: string, updates: Partial<ScheduledAirdrop>): void {
  const sa = scheduledAirdrops.get(id);
  if (sa) {
    Object.assign(sa, updates);
  }
}

export function getPendingScheduledAirdrops(): ScheduledAirdrop[] {
  return Array.from(scheduledAirdrops.values()).filter((s) => s.status === "pending");
}

// ─── AIRDROP HISTORY / AUDIT LOG ─────────────────────────────────────────

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

const airdropHistory: AirdropRecord[] = [];
let _historyCounter = 0;

export function recordAirdrop(record: Omit<AirdropRecord, "id">): AirdropRecord {
  _historyCounter++;
  const full: AirdropRecord = {
    ...record,
    id: `sa-hist-${Date.now()}-${_historyCounter}`,
  };
  airdropHistory.unshift(full); // newest first
  return full;
}

export function getAirdropHistory(): AirdropRecord[] {
  return airdropHistory;
}

export function getAirdropById(id: string): AirdropRecord | undefined {
  return airdropHistory.find((r) => r.id === id);
}

// ─── VESTING PLANS ──────────────────────────────────────────────────────────

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

const vestingPlans = new Map<string, VestingPlan>();
let _vestingCounter = 0;

export function createVestingPlan(
  data: Omit<VestingPlan, "id" | "completedSteps" | "status" | "createdAt">
): VestingPlan {
  _vestingCounter++;
  const id = `sa-vest-${Date.now()}-${_vestingCounter}`;
  const plan: VestingPlan = {
    ...data,
    id,
    completedSteps: 0,
    status: "active",
    createdAt: new Date().toISOString(),
  };
  vestingPlans.set(id, plan);
  return plan;
}

export function getVestingPlans(): VestingPlan[] {
  return Array.from(vestingPlans.values());
}

export function getVestingPlanById(id: string): VestingPlan | undefined {
  return vestingPlans.get(id);
}

export function updateVestingPlan(id: string, updates: Partial<VestingPlan>): void {
  const plan = vestingPlans.get(id);
  if (plan) {
    Object.assign(plan, updates);
  }
}

/**
 * Calculate all vesting unlock steps from a schedule and list of recipients.
 */
export function calculateVestingSteps(
  schedule: VestingSchedule,
  recipients: Array<{ address: string; amount: string }>
): VestingStep[] {
  const steps: VestingStep[] = [];

  switch (schedule.type) {
    case "cliff": {
      // One unfreeze action per recipient at cliffDate
      const cliffDate = schedule.cliffDate || new Date().toISOString();
      for (const r of recipients) {
        steps.push({
          date: cliffDate,
          action: "unfreezeAccount",
          address: r.address,
          amount: r.amount,
        });
      }
      break;
    }

    case "linear": {
      const start = new Date(schedule.startDate || new Date().toISOString());
      const end = new Date(schedule.endDate || new Date().toISOString());
      const intervalMonths = schedule.intervalMonths || 1;

      // Calculate number of intervals
      const intervals: Date[] = [];
      const current = new Date(start);
      while (current <= end) {
        intervals.push(new Date(current));
        current.setMonth(current.getMonth() + intervalMonths);
      }
      // Ensure end date is included
      if (intervals.length > 0 && intervals[intervals.length - 1].getTime() < end.getTime()) {
        intervals.push(new Date(end));
      }
      if (intervals.length === 0) {
        intervals.push(new Date(end));
      }

      for (const r of recipients) {
        const totalAmount = BigInt(r.amount);
        for (let i = 0; i < intervals.length; i++) {
          // Cumulative fraction at this interval
          const cumulativeFraction = (i + 1) / intervals.length;
          const cumulativeAmount = (totalAmount * BigInt(Math.round(cumulativeFraction * 10000))) / BigInt(10000);
          steps.push({
            date: intervals[i].toISOString(),
            action: "setWhitelistedLimit",
            address: r.address,
            amount: cumulativeAmount.toString(),
          });
        }
      }
      break;
    }

    case "cliff_linear": {
      const cliffDate = schedule.cliffDate || new Date().toISOString();
      const linearStart = new Date(schedule.linearStartDate || cliffDate);
      const linearEnd = new Date(schedule.linearEndDate || new Date().toISOString());
      const intervalMonths = schedule.intervalMonths || 1;

      // Calculate linear intervals after cliff
      const intervals: Date[] = [];
      const current = new Date(linearStart);
      while (current <= linearEnd) {
        intervals.push(new Date(current));
        current.setMonth(current.getMonth() + intervalMonths);
      }
      if (intervals.length > 0 && intervals[intervals.length - 1].getTime() < linearEnd.getTime()) {
        intervals.push(new Date(linearEnd));
      }
      if (intervals.length === 0) {
        intervals.push(new Date(linearEnd));
      }

      for (const r of recipients) {
        const totalAmount = BigInt(r.amount);
        for (let i = 0; i < intervals.length; i++) {
          const cumulativeFraction = (i + 1) / intervals.length;
          const cumulativeAmount = (totalAmount * BigInt(Math.round(cumulativeFraction * 10000))) / BigInt(10000);
          steps.push({
            date: intervals[i].toISOString(),
            action: "setWhitelistedLimit",
            address: r.address,
            amount: cumulativeAmount.toString(),
          });
        }
      }
      break;
    }

    case "milestone": {
      const milestones = schedule.milestones || [];
      // Sort milestones by date
      const sorted = [...milestones].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );

      for (const r of recipients) {
        const totalAmount = BigInt(r.amount);
        let cumulativePercentage = 0;
        for (const ms of sorted) {
          cumulativePercentage += ms.percentage;
          const cumulativeAmount = (totalAmount * BigInt(Math.round(cumulativePercentage * 100))) / BigInt(10000);
          steps.push({
            date: ms.date,
            action: "setWhitelistedLimit",
            address: r.address,
            amount: cumulativeAmount.toString(),
          });
        }
      }
      break;
    }
  }

  // Sort all steps by date
  steps.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return steps;
}

/**
 * Get all pending vesting steps across all active plans that are due.
 */
export function getPendingVestingSteps(): Array<{ plan: VestingPlan; step: VestingStep; stepIndex: number }> {
  const now = Date.now();
  const pending: Array<{ plan: VestingPlan; step: VestingStep; stepIndex: number }> = [];

  for (const plan of vestingPlans.values()) {
    if (plan.status !== "active") continue;
    for (let i = plan.completedSteps; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      if (new Date(step.date).getTime() <= now) {
        pending.push({ plan, step, stepIndex: i });
      } else {
        break; // Steps are sorted by date, so no need to check further
      }
    }
  }

  return pending;
}
