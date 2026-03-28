/**
 * scheduler.ts — Scheduled airdrop CRUD
 */

import { ScheduledAirdrop } from "./types.js";

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
  if (sa) Object.assign(sa, updates);
}

export function getPendingScheduledAirdrops(): ScheduledAirdrop[] {
  return Array.from(scheduledAirdrops.values()).filter((s) => s.status === "pending");
}
