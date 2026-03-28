/**
 * chain-querier.ts — Solomente TXAI Preflight Compliance Engine
 *
 * Abstraction layer for querying the Coreum/TX blockchain REST API.
 * Uses a short-lived per-request cache to avoid duplicate queries when
 * multiple checks need the same data (e.g. token info, balance).
 *
 * All methods return typed data or null/defaults on failure, so preflight
 * checks can degrade gracefully when the chain is unreachable.
 */

import { ComplianceNFT } from "./types";

// ─── NETWORK CONFIG ─────────────────────────────────────────────────────────

const REST_ENDPOINTS: Record<string, string> = {
  testnet: "https://full-node.testnet-1.coreum.dev:1317",
  mainnet: "https://full-node.mainnet-1.coreum.dev:1317",
  devnet:  "https://full-node.devnet-1.coreum.dev:1317",
};

const NATIVE_DENOMS: Record<string, string> = {
  testnet: "utestcore",
  mainnet: "ucore",
  devnet:  "udevcore",
};

// Default gas price in native denom (micro-units)
const DEFAULT_GAS_PRICE = 0.0625;

// ─── TOKEN INFO TYPE ────────────────────────────────────────────────────────

export interface TokenInfo {
  denom: string;
  issuer?: string;
  subunit?: string;
  symbol?: string;
  precision?: number;
  description?: string;
  globallyFrozen?: boolean;
  features?: string[];
  burnRate?: string;
  sendCommissionRate?: string;
  uri?: string;
  uri_hash?: string;
  admin?: string;
}

export interface NFTClassInfo {
  id: string;
  issuer: string;
  name: string;
  symbol: string;
  description: string;
  uri: string;
  uriHash: string;
  features: string[];
  royaltyRate: string;
}

export interface NFTOwnerResponse {
  owner: string;
}

// ─── CHAIN QUERIER INTERFACE ────────────────────────────────────────────────

/**
 * Interface for querying on-chain state.
 * Implementations can be swapped for testing (mock querier).
 */
export interface IChainQuerier {
  /** Fetch full token info including features, freeze state, and rates */
  getTokenInfo(denom: string): Promise<TokenInfo | null>;

  /** Fetch balance for a specific denom */
  getBalance(address: string, denom: string): Promise<string>;

  /** Fetch all balances for an address */
  getAllBalances(address: string): Promise<Array<{ denom: string; amount: string }>>;

  /** Fetch the frozen balance for an address+denom pair */
  getFrozenBalance(address: string, denom: string): Promise<string>;

  /** Fetch the whitelisted balance limit for an address+denom pair */
  getWhitelistedBalance(address: string, denom: string): Promise<string>;

  /** Fetch NFT class metadata */
  getNFTClassInfo(classId: string): Promise<NFTClassInfo | null>;

  /** Get the owner of a specific NFT */
  getNFTOwner(classId: string, nftId: string): Promise<string | null>;

  /** Check if a specific NFT is frozen */
  isNFTFrozen(classId: string, nftId: string): Promise<boolean>;

  /** Check if an account is whitelisted for a specific NFT class */
  isNFTWhitelisted(classId: string, nftId: string, account: string): Promise<boolean>;

  /** Query for a soulbound compliance NFT attached to an address */
  getComplianceNFT(address: string): Promise<ComplianceNFT | null>;

  /** Get the native denom for the current network (e.g. "utestcore") */
  getNativeDenom(): string;

  /** Get the current gas price in native micro-units */
  getGasPrice(): number;
}

// ─── REST QUERIER IMPLEMENTATION ────────────────────────────────────────────

/**
 * Production implementation that queries the Coreum REST (LCD) API.
 * Includes a short-lived per-request cache to deduplicate parallel queries.
 */
export class CoreumRestQuerier implements IChainQuerier {
  private readonly baseUrl: string;
  private readonly network: string;
  private readonly cache = new Map<string, Promise<unknown>>();
  private readonly cacheTTL: number;
  private readonly cacheTimestamps = new Map<string, number>();

  constructor(network: string = "testnet", cacheTTLMs: number = 5000) {
    this.network = network;
    this.baseUrl = REST_ENDPOINTS[network] || REST_ENDPOINTS.testnet;
    this.cacheTTL = cacheTTLMs;
  }

  // ── Cached fetch wrapper ──────────────────────────────────────────────

  /**
   * Fetch a URL with short-lived deduplication cache.
   * Multiple parallel calls to the same endpoint share one in-flight request.
   */
  private async cachedFetch<T>(url: string): Promise<T | null> {
    const now = Date.now();
    const cachedTs = this.cacheTimestamps.get(url);

    // If cached and still fresh, reuse the promise
    if (cachedTs && now - cachedTs < this.cacheTTL && this.cache.has(url)) {
      return this.cache.get(url) as Promise<T | null>;
    }

    // Create a new fetch promise
    const fetchPromise = (async (): Promise<T | null> => {
      try {
        const resp = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(8000),
        });
        if (!resp.ok) return null;
        return (await resp.json()) as T;
      } catch {
        return null;
      }
    })();

    this.cache.set(url, fetchPromise);
    this.cacheTimestamps.set(url, now);
    return fetchPromise;
  }

  /** Clear the in-memory cache (call between unrelated preflight runs) */
  clearCache(): void {
    this.cache.clear();
    this.cacheTimestamps.clear();
  }

  // ── Token queries ─────────────────────────────────────────────────────

  async getTokenInfo(denom: string): Promise<TokenInfo | null> {
    const url = `${this.baseUrl}/coreum/asset/ft/v1/tokens/${encodeURIComponent(denom)}`;
    const data = await this.cachedFetch<{ token?: TokenInfo }>(url);
    return data?.token ?? null;
  }

  async getBalance(address: string, denom: string): Promise<string> {
    const url = `${this.baseUrl}/cosmos/bank/v1beta1/balances/${address}/by_denom?denom=${encodeURIComponent(denom)}`;
    const data = await this.cachedFetch<{ balance?: { amount?: string } }>(url);
    return data?.balance?.amount ?? "0";
  }

  async getAllBalances(address: string): Promise<Array<{ denom: string; amount: string }>> {
    const url = `${this.baseUrl}/cosmos/bank/v1beta1/balances/${address}`;
    const data = await this.cachedFetch<{ balances?: Array<{ denom: string; amount: string }> }>(url);
    return data?.balances ?? [];
  }

  async getFrozenBalance(address: string, denom: string): Promise<string> {
    const url = `${this.baseUrl}/coreum/asset/ft/v1/frozen-balances/${address}/${encodeURIComponent(denom)}`;
    const data = await this.cachedFetch<{ balance?: { amount?: string } }>(url);
    return data?.balance?.amount ?? "0";
  }

  async getWhitelistedBalance(address: string, denom: string): Promise<string> {
    const url = `${this.baseUrl}/coreum/asset/ft/v1/whitelisted-balance/${address}/${encodeURIComponent(denom)}`;
    const data = await this.cachedFetch<{ balance?: { amount?: string } }>(url);
    return data?.balance?.amount ?? "0";
  }

  // ── NFT queries ───────────────────────────────────────────────────────

  async getNFTClassInfo(classId: string): Promise<NFTClassInfo | null> {
    const url = `${this.baseUrl}/coreum/asset/nft/v1/classes/${encodeURIComponent(classId)}`;
    const data = await this.cachedFetch<{ class?: NFTClassInfo }>(url);
    return data?.class ?? null;
  }

  async getNFTOwner(classId: string, nftId: string): Promise<string | null> {
    const url = `${this.baseUrl}/cosmos/nft/v1beta1/owner/${encodeURIComponent(classId)}/${encodeURIComponent(nftId)}`;
    const data = await this.cachedFetch<{ owner?: string }>(url);
    return data?.owner ?? null;
  }

  async isNFTFrozen(classId: string, nftId: string): Promise<boolean> {
    const url = `${this.baseUrl}/coreum/asset/nft/v1/frozen/${encodeURIComponent(classId)}/${encodeURIComponent(nftId)}`;
    const data = await this.cachedFetch<{ frozen?: boolean }>(url);
    return data?.frozen ?? false;
  }

  async isNFTWhitelisted(classId: string, nftId: string, account: string): Promise<boolean> {
    const url = `${this.baseUrl}/coreum/asset/nft/v1/whitelisted/${encodeURIComponent(classId)}/${encodeURIComponent(nftId)}/${account}`;
    const data = await this.cachedFetch<{ whitelisted?: boolean }>(url);
    return data?.whitelisted ?? false;
  }

  // ── Compliance queries ────────────────────────────────────────────────

  /**
   * Query for a soulbound compliance NFT on the address.
   * Looks for NFTs in the well-known "txai-compliance" class.
   * Returns null if no compliance NFT is found (non-blocking).
   */
  async getComplianceNFT(address: string): Promise<ComplianceNFT | null> {
    try {
      // Query NFTs owned by this address in the compliance class
      const classId = "txai-compliance";
      const url = `${this.baseUrl}/cosmos/nft/v1beta1/nfts?class_id=${encodeURIComponent(classId)}&owner=${address}`;
      const data = await this.cachedFetch<{ nfts?: Array<{ uri?: string; data?: unknown }> }>(url);
      const nfts = data?.nfts;
      if (!nfts || nfts.length === 0) return null;

      // Parse compliance data from the first matching NFT's URI or data field
      const nft = nfts[0];
      if (nft.uri) {
        try {
          // URI may contain base64-encoded JSON compliance data
          const decoded = Buffer.from(nft.uri, "base64").toString("utf8");
          return JSON.parse(decoded) as ComplianceNFT;
        } catch {
          // URI is not base64 JSON — ignore
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  // ── Network helpers ───────────────────────────────────────────────────

  getNativeDenom(): string {
    return NATIVE_DENOMS[this.network] || NATIVE_DENOMS.testnet;
  }

  getGasPrice(): number {
    return DEFAULT_GAS_PRICE;
  }
}
