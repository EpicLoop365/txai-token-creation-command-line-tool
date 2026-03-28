/**
 * preflight-middleware.ts — Solomente TXAI Preflight Compliance Engine
 *
 * Express middleware that registers the `POST /api/preflight` endpoint.
 * This is the HTTP gateway into the preflight engine: clients POST a
 * transaction descriptor and receive a full PreflightResult with check
 * details, summary counts, and a canProceed verdict.
 *
 * Usage:
 *   import express from "express";
 *   import { setupPreflightRoutes } from "./preflight-middleware";
 *
 *   const app = express();
 *   app.use(express.json());
 *   setupPreflightRoutes(app);
 */

import type { Application, Request, Response } from "express";
import { runPreflight } from "./preflight/index";
import type { TransactionType, PreflightParams } from "./preflight/types";

// ─── VALID TRANSACTION TYPES ────────────────────────────────────────────────

/** The set of transaction types the preflight engine accepts. */
const VALID_TX_TYPES: ReadonlySet<string> = new Set<TransactionType>([
  "token_send",
  "token_issue",
  "nft_mint",
  "nft_transfer",
  "airdrop",
  "dex_place_order",
]);

// ─── ROUTE SETUP ────────────────────────────────────────────────────────────

/**
 * Register the preflight REST endpoint on the given Express application.
 *
 * Adds:
 *   POST /api/preflight
 *     Body: { txType, sender, params, network? }
 *     200 → PreflightResult (JSON)
 *     400 → validation error
 *     500 → internal error
 *
 * @param app - The Express application instance to attach routes to
 */
export function setupPreflightRoutes(app: Application): void {
  app.post("/api/preflight", async (req: Request, res: Response): Promise<void> => {
    const { txType, sender, params, network } = req.body as {
      txType?: string;
      sender?: string;
      params?: Record<string, unknown>;
      network?: string;
    };

    // ── Validate txType ───────────────────────────────────────────────────

    if (!txType || !VALID_TX_TYPES.has(txType)) {
      res.status(400).json({
        error: `Invalid or missing txType. Must be one of: ${[...VALID_TX_TYPES].join(", ")}`,
      });
      return;
    }

    // ── Validate sender ───────────────────────────────────────────────────

    if (!sender || typeof sender !== "string" || sender.trim() === "") {
      res.status(400).json({
        error: "Missing required field: sender. Provide a valid bech32 address.",
      });
      return;
    }

    // ── Resolve network (fallback chain: body → env → testnet) ──────────

    const networkName = network || (process.env.TX_NETWORK as string) || "testnet";

    // ── Run preflight checks ──────────────────────────────────────────────

    try {
      const result = await runPreflight({
        txType: txType as TransactionType,
        sender,
        params: (params || {}) as unknown as PreflightParams,
        network: networkName,
      });

      // ── Log the run for observability ─────────────────────────────────

      const truncatedSender = sender.length > 16
        ? `${sender.slice(0, 10)}...${sender.slice(-4)}`
        : sender;

      console.log(
        `[preflight] txType=${txType} sender=${truncatedSender} network=${networkName} ` +
        `canProceed=${result.canProceed} ` +
        `errors=${result.summary.errors} warnings=${result.summary.warnings} ` +
        `info=${result.summary.info} total=${result.summary.totalChecks}`,
      );

      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[preflight] Internal error: ${message}`);
      res.status(500).json({ error: `Preflight error: ${message}` });
    }
  });
}
