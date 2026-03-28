/**
 * vesting.ts — Vesting schedule calculations and plan CRUD
 */

import { VestingSchedule, VestingStep, VestingPlan } from "./types.js";

// ─── IN-MEMORY STORE ────────────────────────────────────────────────────────

const vestingPlans = new Map<string, VestingPlan>();
let _vestingCounter = 0;

// ─── CRUD ───────────────────────────────────────────────────────────────────

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
  if (plan) Object.assign(plan, updates);
}

// ─── STEP CALCULATION ───────────────────────────────────────────────────────

export function calculateVestingSteps(
  schedule: VestingSchedule,
  recipients: Array<{ address: string; amount: string }>
): VestingStep[] {
  const steps: VestingStep[] = [];

  switch (schedule.type) {
    case "cliff": {
      const cliffDate = schedule.cliffDate || new Date().toISOString();
      for (const r of recipients) {
        steps.push({ date: cliffDate, action: "unfreezeAccount", address: r.address, amount: r.amount });
      }
      break;
    }

    case "linear": {
      const start = new Date(schedule.startDate || new Date().toISOString());
      const end = new Date(schedule.endDate || new Date().toISOString());
      const intervalMonths = schedule.intervalMonths || 1;

      const intervals: Date[] = [];
      const current = new Date(start);
      while (current <= end) {
        intervals.push(new Date(current));
        current.setMonth(current.getMonth() + intervalMonths);
      }
      if (intervals.length > 0 && intervals[intervals.length - 1].getTime() < end.getTime()) {
        intervals.push(new Date(end));
      }
      if (intervals.length === 0) intervals.push(new Date(end));

      for (const r of recipients) {
        const totalAmount = BigInt(r.amount);
        for (let i = 0; i < intervals.length; i++) {
          const cumulativeFraction = (i + 1) / intervals.length;
          const cumulativeAmount = (totalAmount * BigInt(Math.round(cumulativeFraction * 10000))) / BigInt(10000);
          steps.push({ date: intervals[i].toISOString(), action: "setWhitelistedLimit", address: r.address, amount: cumulativeAmount.toString() });
        }
      }
      break;
    }

    case "cliff_linear": {
      const cliffDate = schedule.cliffDate || new Date().toISOString();
      const linearStart = new Date(schedule.linearStartDate || cliffDate);
      const linearEnd = new Date(schedule.linearEndDate || new Date().toISOString());
      const intervalMonths = schedule.intervalMonths || 1;

      const intervals: Date[] = [];
      const current = new Date(linearStart);
      while (current <= linearEnd) {
        intervals.push(new Date(current));
        current.setMonth(current.getMonth() + intervalMonths);
      }
      if (intervals.length > 0 && intervals[intervals.length - 1].getTime() < linearEnd.getTime()) {
        intervals.push(new Date(linearEnd));
      }
      if (intervals.length === 0) intervals.push(new Date(linearEnd));

      for (const r of recipients) {
        const totalAmount = BigInt(r.amount);
        for (let i = 0; i < intervals.length; i++) {
          const cumulativeFraction = (i + 1) / intervals.length;
          const cumulativeAmount = (totalAmount * BigInt(Math.round(cumulativeFraction * 10000))) / BigInt(10000);
          steps.push({ date: intervals[i].toISOString(), action: "setWhitelistedLimit", address: r.address, amount: cumulativeAmount.toString() });
        }
      }
      break;
    }

    case "milestone": {
      const milestones = schedule.milestones || [];
      const sorted = [...milestones].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      for (const r of recipients) {
        const totalAmount = BigInt(r.amount);
        let cumulativePercentage = 0;
        for (const ms of sorted) {
          cumulativePercentage += ms.percentage;
          const cumulativeAmount = (totalAmount * BigInt(Math.round(cumulativePercentage * 100))) / BigInt(10000);
          steps.push({ date: ms.date, action: "setWhitelistedLimit", address: r.address, amount: cumulativeAmount.toString() });
        }
      }
      break;
    }
  }

  steps.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return steps;
}

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
        break;
      }
    }
  }

  return pending;
}
