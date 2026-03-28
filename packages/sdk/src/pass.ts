/**
 * @solomente/txai-sdk — Pass
 *
 * NFT-based access passes with three tiers:
 * - Scout (free, soulbound) — auto-minted identity pass
 * - Creator (50 TX, soulbound) — unlock agent creation
 * - Pro (200 TX, whitelisted) — full access, transferable
 */

// ─── Types ──────────────────────────────────────────────────────────────

export interface PassTier {
  level: number;
  name: string;
  price: number;
  transfer: "soulbound" | "whitelisted" | "open";
  duration: number;  // default days, 0 = lifetime
}

export interface PassStatus {
  level: number;
  tier: string;
  name: string;
  expired: boolean;
  expiresAt: number | null;
  daysLeft: number;
}

export interface PassDuration {
  days: number;
  label: string;
  multiplier: number;
}

// ─── Constants ──────────────────────────────────────────────────────────

export const PASS_TIERS: Record<string, PassTier> = {
  scout: {
    level: 1,
    name: "Scout Pass",
    price: 0,
    transfer: "soulbound",
    duration: 0,  // lifetime
  },
  creator: {
    level: 2,
    name: "Creator Pass",
    price: 50,
    transfer: "soulbound",
    duration: 30,
  },
  pro: {
    level: 3,
    name: "Pro Pass",
    price: 200,
    transfer: "whitelisted",
    duration: 30,
  },
};

export const PASS_DURATIONS: PassDuration[] = [
  { days: 1,   label: "24 Hours",  multiplier: 0.1 },
  { days: 7,   label: "7 Days",    multiplier: 0.3 },
  { days: 30,  label: "30 Days",   multiplier: 1 },
  { days: 90,  label: "90 Days",   multiplier: 2.7 },
  { days: 365, label: "1 Year",    multiplier: 9 },
  { days: 0,   label: "Lifetime",  multiplier: 25 },
];

// ─── Pass Class ─────────────────────────────────────────────────────────

export class Pass {
  /**
   * Calculate the price for a tier + duration combo.
   */
  static getPrice(tierKey: string, durationDays: number): number {
    const tier = PASS_TIERS[tierKey];
    if (!tier) return 0;
    if (tier.price === 0) return 0; // Scout is always free

    const dur = PASS_DURATIONS.find((d) => d.days === durationDays);
    if (!dur) return tier.price; // fallback to base
    return Math.ceil(tier.price * dur.multiplier);
  }

  /**
   * Get all available tiers.
   */
  static getTiers(): Record<string, PassTier> {
    return { ...PASS_TIERS };
  }

  /**
   * Get all duration options with prices for a tier.
   */
  static getDurationOptions(tierKey: string): Array<PassDuration & { price: number }> {
    return PASS_DURATIONS.map((d) => ({
      ...d,
      price: Pass.getPrice(tierKey, d.days),
    }));
  }

  /**
   * Check if a duration is expired.
   */
  static isExpired(expiresAt: number | null): boolean {
    if (!expiresAt || expiresAt === 0) return false; // lifetime
    return Date.now() > expiresAt;
  }

  /**
   * Calculate days remaining.
   */
  static daysLeft(expiresAt: number | null): number {
    if (!expiresAt || expiresAt === 0) return Infinity; // lifetime
    const remaining = expiresAt - Date.now();
    return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
  }

  /**
   * Build NFT metadata for a pass.
   */
  static buildMetadata(tierKey: string, durationDays: number): string {
    const tier = PASS_TIERS[tierKey];
    if (!tier) throw new Error(`Unknown tier: ${tierKey}`);

    const now = Date.now();
    const expiresAt = durationDays === 0 ? 0 : now + durationDays * 24 * 60 * 60 * 1000;

    const metadata = {
      type: "txai-pass",
      tier: tierKey,
      level: tier.level,
      name: tier.name,
      transfer: tier.transfer,
      mintedAt: now,
      expiresAt,
      durationDays,
    };

    return btoa(JSON.stringify(metadata));
  }

  /**
   * Parse NFT metadata to extract pass info.
   */
  static parseMetadata(uri: string): PassStatus | null {
    try {
      const json = JSON.parse(atob(uri));
      if (json.type !== "txai-pass") return null;

      const tierKey = json.tier || "scout";
      const tier = PASS_TIERS[tierKey] || PASS_TIERS.scout;

      return {
        level: json.level || tier.level,
        tier: tierKey,
        name: json.name || tier.name,
        expired: Pass.isExpired(json.expiresAt),
        expiresAt: json.expiresAt || null,
        daysLeft: Pass.daysLeft(json.expiresAt),
      };
    } catch {
      return null;
    }
  }
}
