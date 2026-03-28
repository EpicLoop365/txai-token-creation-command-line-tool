/**
 * history.ts — Airdrop history / audit log CRUD
 */

import { AirdropRecord } from "./types.js";

const airdropHistory: AirdropRecord[] = [];
let _historyCounter = 0;

export function recordAirdrop(record: Omit<AirdropRecord, "id">): AirdropRecord {
  _historyCounter++;
  const full: AirdropRecord = {
    ...record,
    id: `sa-hist-${Date.now()}-${_historyCounter}`,
  };
  airdropHistory.unshift(full);
  return full;
}

export function getAirdropHistory(): AirdropRecord[] {
  return airdropHistory;
}

export function getAirdropById(id: string): AirdropRecord | undefined {
  return airdropHistory.find((r) => r.id === id);
}
