/**
 * resolver.ts — Multi-source address resolution, combining, validation
 */

import { AirdropIntent, ResolvedAirdrop } from "./types.js";

/**
 * Resolve all addresses from the AirdropIntent sources, apply combine mode,
 * deduplication, limit/sort, and validate address format.
 */
export async function resolveAddresses(
  intent: AirdropIntent,
  network: string,
  restUrl: string
): Promise<ResolvedAirdrop> {
  const addressPrefix = network === "mainnet" ? "core1" : "testcore1";
  const sourceBreakdown: Record<string, number> = {};

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
    combinedAddresses = new Set<string>();
    for (const src of resolvedSources) {
      for (const addr of src.addresses) {
        combinedAddresses.add(addr);
      }
    }
  }

  const totalAcrossSources = resolvedSources.reduce((sum, s) => sum + s.addresses.size, 0);
  const duplicatesRemoved =
    intent.combineMode === "union" ? totalAcrossSources - combinedAddresses.size : 0;

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

  let sorted = validAddresses;

  if (intent.limit && intent.limit > 0) {
    sorted = sorted.slice(0, intent.limit);
  }

  const recipients = sorted.map((address) => ({
    address,
    amount: intent.amountPerRecipient,
  }));

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

async function fetchStakers(restUrl: string, validatorAddr: string): Promise<string[]> {
  const addresses: string[] = [];
  let nextKey: string | null = null;

  try {
    do {
      let url = `${restUrl}/cosmos/staking/v1beta1/validators/${validatorAddr}/delegations?pagination.limit=1000`;
      if (nextKey) url += `&pagination.key=${encodeURIComponent(nextKey)}`;

      const resp = await fetch(url);
      if (!resp.ok) break;

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
    console.error(`[smart-airdrop] Error fetching stakers for ${validatorAddr}:`, (err as Error).message);
  }

  return addresses;
}

async function fetchNFTHolders(restUrl: string, classId: string): Promise<string[]> {
  const owners: string[] = [];
  let nextKey: string | null = null;

  try {
    do {
      let url = `${restUrl}/coreum/asset/nft/v1/classes/${classId}/nfts?pagination.limit=1000`;
      if (nextKey) url += `&pagination.key=${encodeURIComponent(nextKey)}`;

      const resp = await fetch(url);
      if (!resp.ok) {
        const fallbackUrl = `${restUrl}/cosmos/nft/v1beta1/nfts?class_id=${classId}&pagination.limit=1000`;
        const fallbackResp = await fetch(fallbackUrl);
        if (!fallbackResp.ok) break;

        const fallbackData: any = await fallbackResp.json();
        const nfts = fallbackData.nfts || [];

        for (const nft of nfts) {
          try {
            const ownerResp = await fetch(`${restUrl}/cosmos/nft/v1beta1/owner/${classId}/${nft.id}`);
            if (ownerResp.ok) {
              const ownerData: any = await ownerResp.json();
              if (ownerData.owner) owners.push(ownerData.owner);
            }
          } catch { /* skip */ }
        }
        break;
      }

      const data: any = await resp.json();
      const nfts = data.nfts || [];
      for (const nft of nfts) {
        if (nft.owner) owners.push(nft.owner);
      }
      nextKey = data.pagination?.next_key || null;
    } while (nextKey);
  } catch (err) {
    console.error(`[smart-airdrop] Error fetching NFT holders for ${classId}:`, (err as Error).message);
  }

  return owners;
}

async function fetchHolders(restUrl: string, denom: string): Promise<string[]> {
  const addresses: string[] = [];
  try {
    const resp = await fetch(`${restUrl}/cosmos/bank/v1beta1/denom_owners/${denom}?pagination.limit=1000`);
    if (resp.ok) {
      const data: any = await resp.json();
      const denomOwners = data.denom_owners || [];
      for (const owner of denomOwners) {
        if (owner.address) addresses.push(owner.address);
      }
    }
  } catch (err) {
    console.error(`[smart-airdrop] Error fetching holders for ${denom}:`, (err as Error).message);
  }
  return addresses;
}

export function parseCSVAddresses(raw: string): string[] {
  const addresses: string[] = [];
  const lines = raw.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const parts = line.split(",").map((p) => p.trim());
    const addr = parts[0];
    if (addr && (addr.startsWith("core1") || addr.startsWith("testcore1"))) {
      addresses.push(addr);
    }
  }
  return addresses;
}

async function fetchTxCounterparties(restUrl: string, address: string): Promise<string[]> {
  const counterparties = new Set<string>();

  try {
    const senderUrl = `${restUrl}/cosmos/tx/v1beta1/txs?events=message.sender%3D%27${address}%27&pagination.limit=100`;
    const senderResp = await fetch(senderUrl);
    if (senderResp.ok) {
      const senderData: any = await senderResp.json();
      extractCounterparties(senderData, address, counterparties);
    }

    const recipientUrl = `${restUrl}/cosmos/tx/v1beta1/txs?events=transfer.recipient%3D%27${address}%27&pagination.limit=100`;
    const recipientResp = await fetch(recipientUrl);
    if (recipientResp.ok) {
      const recipientData: any = await recipientResp.json();
      extractCounterparties(recipientData, address, counterparties);
    }
  } catch (err) {
    console.error(`[smart-airdrop] Error fetching tx history for ${address}:`, (err as Error).message);
  }

  return Array.from(counterparties);
}

function extractCounterparties(txData: any, selfAddress: string, counterparties: Set<string>): void {
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
            if (val && val !== selfAddress && (val.startsWith("core1") || val.startsWith("testcore1"))) {
              counterparties.add(val);
            }
          }
        }
      }
    }
  }
}
