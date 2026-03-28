/**
 * feature-flags.ts — Feature Flag System for TXAI Studio
 *
 * Provides:
 *   - Env-var based feature flags with defaults
 *   - Runtime flag checking
 *   - Flag status endpoint for debugging
 *   - Express middleware to gate endpoints behind flags
 */

// ─── FLAG DEFINITIONS ───────────────────────────────────────────────────────

export interface FlagDefinition {
  name: string;
  envVar: string;
  defaultValue: boolean;
  description: string;
  category: "core" | "airdrop" | "dao" | "experimental" | "ops";
}

const FLAG_DEFINITIONS: FlagDefinition[] = [
  // ── Core ──
  {
    name: "token_creation",
    envVar: "FF_TOKEN_CREATION",
    defaultValue: true,
    description: "Token creation endpoints",
    category: "core",
  },
  {
    name: "nft_tools",
    envVar: "FF_NFT_TOOLS",
    defaultValue: true,
    description: "NFT minting and management",
    category: "core",
  },
  {
    name: "dex",
    envVar: "FF_DEX",
    defaultValue: true,
    description: "DEX trading and order placement",
    category: "core",
  },
  {
    name: "chat",
    envVar: "FF_CHAT",
    defaultValue: true,
    description: "AI chat assistant",
    category: "core",
  },

  // ── Airdrop ──
  {
    name: "smart_airdrop",
    envVar: "FF_SMART_AIRDROP",
    defaultValue: true,
    description: "Smart Airdrop Agent (NLP parse, resolve, execute)",
    category: "airdrop",
  },
  {
    name: "airdrop_scheduling",
    envVar: "FF_AIRDROP_SCHEDULING",
    defaultValue: true,
    description: "Scheduled and price-triggered airdrops",
    category: "airdrop",
  },
  {
    name: "airdrop_vesting",
    envVar: "FF_AIRDROP_VESTING",
    defaultValue: true,
    description: "Vesting airdrop plans (cliff, linear, milestones)",
    category: "airdrop",
  },

  // ── DAO ──
  {
    name: "dao_voting",
    envVar: "FF_DAO_VOTING",
    defaultValue: true,
    description: "DAO proposal creation and voting",
    category: "dao",
  },
  {
    name: "dao_nft_gating",
    envVar: "FF_DAO_NFT_GATING",
    defaultValue: true,
    description: "NFT-gated voting with metadata verification",
    category: "dao",
  },

  // ── Experimental ──
  {
    name: "twitter_posting",
    envVar: "FF_TWITTER",
    defaultValue: false,
    description: "Agent-controlled Twitter posting",
    category: "experimental",
  },
  {
    name: "telegram_delivery",
    envVar: "FF_TELEGRAM",
    defaultValue: false,
    description: "Telegram message delivery for airdrop reviews",
    category: "experimental",
  },

  // ── Ops ──
  {
    name: "verbose_logging",
    envVar: "FF_VERBOSE_LOGGING",
    defaultValue: false,
    description: "Include request/response bodies in logs",
    category: "ops",
  },
  {
    name: "debug_mode",
    envVar: "FF_DEBUG",
    defaultValue: false,
    description: "Expose stack traces and internal state in error responses",
    category: "ops",
  },
  {
    name: "rate_limiting",
    envVar: "FF_RATE_LIMITING",
    defaultValue: true,
    description: "API rate limiting",
    category: "ops",
  },
];

// ─── FLAG CACHE ─────────────────────────────────────────────────────────────

const flagCache = new Map<string, boolean>();
let cacheBuilt = false;

function buildCache(): void {
  if (cacheBuilt) return;
  for (const def of FLAG_DEFINITIONS) {
    const envVal = process.env[def.envVar];
    if (envVal !== undefined) {
      flagCache.set(def.name, envVal === "true" || envVal === "1");
    } else {
      flagCache.set(def.name, def.defaultValue);
    }
  }
  cacheBuilt = true;
}

// ─── PUBLIC API ─────────────────────────────────────────────────────────────

export function isEnabled(flagName: string): boolean {
  buildCache();
  return flagCache.get(flagName) ?? false;
}

export function getAllFlags(): Array<{
  name: string;
  enabled: boolean;
  description: string;
  category: string;
  envVar: string;
}> {
  buildCache();
  return FLAG_DEFINITIONS.map((def) => ({
    name: def.name,
    enabled: flagCache.get(def.name) ?? def.defaultValue,
    description: def.description,
    category: def.category,
    envVar: def.envVar,
  }));
}

export function getFlagsByCategory(): Record<string, Array<{ name: string; enabled: boolean; description: string }>> {
  const flags = getAllFlags();
  const result: Record<string, Array<{ name: string; enabled: boolean; description: string }>> = {};
  for (const f of flags) {
    if (!result[f.category]) result[f.category] = [];
    result[f.category].push({ name: f.name, enabled: f.enabled, description: f.description });
  }
  return result;
}

// Runtime override (useful for testing, resets on restart)
export function setFlag(flagName: string, value: boolean): void {
  buildCache();
  flagCache.set(flagName, value);
}

// ─── EXPRESS MIDDLEWARE ──────────────────────────────────────────────────────

import type { Request, Response, NextFunction } from "express";

export function requireFlag(flagName: string) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (!isEnabled(flagName)) {
      res.status(503).json({
        error: `Feature '${flagName}' is currently disabled.`,
        flag: flagName,
      });
      return;
    }
    next();
  };
}
