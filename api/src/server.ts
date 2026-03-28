import "dotenv/config";
/**
 * server.ts — Express API server for the TX Agent demo
 *
 * Endpoints:
 *   GET  /health          — health check with wallet + network info
 *   POST /api/create-token — accepts { description }, streams SSE events
 *   POST /api/chat         — conversational token advisor (no blockchain calls)
 *   GET  /api/orderbook     — fetch bids/asks for a trading pair
 *   GET  /api/orders        — fetch open orders for an address
 *   GET  /api/pairs         — list known trading pairs
 *   POST /api/trade         — AI-powered trade execution (SSE)
 *   POST /api/dex-chat      — DEX trading advisor chat
 *   POST /api/auth/grant    — create authz grant (agent wallet)
 *   POST /api/auth/revoke   — revoke authz grant (agent wallet)
 *   GET  /api/stakers/:addr — query delegators of a validator
 *   GET  /api/holders/:denom— query holders of a token denom
 *   POST /api/nft-airdrop   — issue NFT class + batch mint to recipients
 */

import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";
import { createToken } from "./token-creator";
import { getChatSystemPrompt } from "./tools";
import { getDexChatSystemPrompt } from "./dex-tools";
import { executeTrade } from "./dex-agent";
import {
  importWallet,
  createWallet,
  NETWORKS,
  NetworkName,
  NetworkConfig,
  TxClient,
  queryOrderbook,
  queryOrdersByCreator,
  queryOrderBooks,
  getTokenInfo,
  mintTokens,
  burnTokens,
  freezeAccount,
  unfreezeAccount,
  globallyFreezeToken,
  globallyUnfreezeToken,
  clawbackTokens,
  setWhitelistedLimit,
  requestFaucet,
  issueSmartToken,
  issueNFTClass,
  mintNFT,
  burnNFT,
  freezeNFT,
  unfreezeNFT,
  queryNFTClass,
  queryNFTsByClass,
  queryNFTsByOwner,
  placeOrder,
  cancelOrder,
} from "./tx-sdk";
import { defaultRegistryTypes } from "@cosmjs/stargate";
import { Registry, GeneratedType } from "@cosmjs/proto-signing";
import { coreumRegistry } from "coreum-js-nightly";
import { runPreflight } from "./preflight/index";
import {
  parseAirdropPrompt,
  resolveAddresses,
  sendAirdropReview,
  AirdropIntent,
  ResolvedAirdrop,
  ScheduledAirdrop,
  AirdropRecord,
  VestingSchedule,
  VestingStep,
  VestingPlan,
  createScheduledAirdrop,
  getScheduledAirdrops,
  getScheduledAirdropById,
  cancelScheduledAirdrop,
  updateScheduledAirdrop,
  getPendingScheduledAirdrops,
  recordAirdrop,
  getAirdropHistory,
  getAirdropById,
  calculateVestingSteps,
  createVestingPlan,
  getVestingPlans,
  getVestingPlanById,
  updateVestingPlan,
  getPendingVestingSteps,
} from "./smart-airdrop";
import {
  createProposal,
  getProposals,
  getProposalById,
  castVote,
  getResults,
  closeProposal,
  closeExpiredProposals,
  checkEligibility,
  DAOProposal,
  DAOVote,
} from "./dao-voting";

// ─── RATE LIMITER ────────────────────────────────────────────────────────────

const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_MS = 60_000; // 1 request per 60 seconds per IP

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const lastRequest = rateLimitMap.get(ip);
  if (lastRequest && now - lastRequest < RATE_LIMIT_MS) {
    return true;
  }
  rateLimitMap.set(ip, now);
  return false;
}

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamp] of rateLimitMap.entries()) {
    if (now - timestamp > RATE_LIMIT_MS * 2) {
      rateLimitMap.delete(ip);
    }
  }
}, 5 * 60_000);

// ─── NETWORK RESOLUTION ─────────────────────────────────────────────────────
// Reads an optional `network` query param or body field to select testnet/mainnet.
// Defaults to the TX_NETWORK env var, then to 'testnet'.

function getNetwork(req: express.Request): { networkName: NetworkName; network: NetworkConfig } {
  const raw =
    (req.query?.network as string) ||
    (req.body?.network as string) ||
    (process.env.TX_NETWORK as string) ||
    "testnet";
  const networkName: NetworkName = raw === "mainnet" ? "mainnet" : "testnet";
  return { networkName, network: NETWORKS[networkName] };
}

/** Guard: block agent-wallet operations on mainnet */
function blockMainnetAgentWallet(req: express.Request, res: express.Response): boolean {
  const { networkName } = getNetwork(req);
  if (networkName === "mainnet" && process.env.AGENT_MNEMONIC) {
    res.status(403).json({
      error:
        "Mainnet operations require connecting your own wallet via Keplr. The demo wallet is testnet-only.",
    });
    return true; // blocked
  }
  return false; // allowed
}

// ─── TOKEN-GATE CONFIGURATION ────────────────────────────────────────────────

const TOKEN_GATE = {
  enabled: process.env.TOKEN_GATE_ENABLED === 'true',
  // The denom of the Creator Pass NFT that grants access
  passDenom: process.env.CREATOR_PASS_DENOM || '',
  // Endpoints that require the Creator Pass
  gatedEndpoints: [
    '/api/nft-airdrop',
    '/api/airdrop',
    '/api/subs/create-pass',
    '/api/subs/buy-pass',
  ],
  // Endpoints that are always free
  freeEndpoints: [
    '/api/create-token',
    '/api/create-token-sync',
    '/api/nft/issue-class',
    '/api/nft/mint',
    '/api/network-info',
    '/api/stakers',
    '/api/holders',
    '/api/subs/verify',
    '/api/dex',
  ],
};

// ─── TOKEN-GATE MIDDLEWARE ───────────────────────────────────────────────────

async function tokenGateCheck(req: express.Request, res: express.Response): Promise<boolean> {
  // If gate is disabled, allow everything
  if (!TOKEN_GATE.enabled || !TOKEN_GATE.passDenom) return false;

  // Check if this endpoint is gated
  const path = req.path;
  const isGated = TOKEN_GATE.gatedEndpoints.some(ep => path.startsWith(ep));
  if (!isGated) return false;

  // Get wallet address from request (header, query, or body)
  const walletAddress = req.headers['x-wallet-address'] as string
    || req.query.wallet as string
    || req.body?.wallet;

  if (!walletAddress) {
    res.status(403).json({
      error: 'Access requires a Creator Pass NFT',
      gated: true,
      passDenom: TOKEN_GATE.passDenom,
      message: 'Connect your wallet and hold a Creator Pass to use this tool.'
    });
    return true; // blocked
  }

  // Check if wallet holds the pass token
  try {
    const { network } = getNetwork(req);
    const balanceUrl = `${network.restEndpoint}/cosmos/bank/v1beta1/balances/${walletAddress}/by_denom?denom=${TOKEN_GATE.passDenom}`;
    const balRes = await fetch(balanceUrl);
    const balData: any = await balRes.json();
    const amount = parseInt(balData?.balance?.amount || '0', 10);

    if (amount <= 0) {
      res.status(403).json({
        error: 'Creator Pass required',
        gated: true,
        passDenom: TOKEN_GATE.passDenom,
        wallet: walletAddress,
        balance: 0,
        message: 'You need to hold at least 1 Creator Pass NFT to use this tool.'
      });
      return true; // blocked
    }

    return false; // allowed
  } catch (err) {
    // On error checking, allow through (fail open for now)
    console.error('[token-gate] Error checking balance:', err);
    return false;
  }
}

// ─── APP SETUP ───────────────────────────────────────────────────────────────

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);

// CORS
const allowedOrigins = [
  "https://solomentelabs.com",
  "https://www.solomentelabs.com",
  "https://epicloop365.github.io",
  ...(process.env.CORS_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, server-to-server)
      if (!origin) return callback(null, true);
      // Allow all solomentelabs.com variants and localhost
      if (
        allowedOrigins.length === 0 ||
        allowedOrigins.includes(origin) ||
        origin.includes("solomentelabs.com") ||
        origin.includes("epicloop365.github.io") ||
        origin.startsWith("http://localhost") ||
        origin.startsWith("https://localhost")
      ) {
        return callback(null, true);
      }
      console.warn("[CORS] Blocked origin:", origin);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "10kb" }));

// Trust proxy for rate limiting behind Railway's load balancer
app.set("trust proxy", 1);

// ─── HEALTH CHECK ────────────────────────────────────────────────────────────

app.get("/health", async (_req, res) => {
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  const network = NETWORKS[networkName];

  const healthInfo: Record<string, unknown> = {
    status: "ok",
    version: "1.1.0",
    network: networkName,
    chainId: network.chainId,
    rpcEndpoint: network.rpcEndpoint,
    timestamp: new Date().toISOString(),
  };

  // If we have a mnemonic, show wallet info
  if (process.env.AGENT_MNEMONIC) {
    try {
      const wallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
      healthInfo.walletAddress = wallet.address;
      healthInfo.explorerUrl = `${network.explorerUrl}/tx/accounts/${wallet.address}`;
    } catch (err) {
      healthInfo.walletError = (err as Error).message;
    }
  } else {
    healthInfo.wallet = "no mnemonic configured — will generate ephemeral wallets";
  }

  // Check if Anthropic key is set
  healthInfo.anthropicKeySet = !!process.env.ANTHROPIC_API_KEY;

  res.json(healthInfo);
});

// ─── NETWORK INFO ───────────────────────────────────────────────────────────

app.get("/api/network-info", (_req, res) => {
  res.json({
    available: ["testnet", "mainnet"],
    default: (process.env.TX_NETWORK as NetworkName) || "testnet",
    networks: {
      testnet: NETWORKS.testnet,
      mainnet: NETWORKS.mainnet,
    },
    usage: "Add ?network=mainnet or { network: 'mainnet' } in the request body to switch networks.",
  });
});

// ─── TEST CONNECTION ────────────────────────────────────────────────────────

app.get("/test-connection", async (_req, res) => {
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  const steps: string[] = [];

  try {
    steps.push("1. Importing wallet...");
    const wallet = await importWallet(process.env.AGENT_MNEMONIC!, networkName);
    steps.push(`2. Wallet imported: ${wallet.address}`);

    steps.push("3. Connecting to blockchain...");
    const { TxClient } = await import("./tx-sdk");

    const connectionPromise = TxClient.connectWithWallet(wallet);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Connection timed out after 15s")), 15000)
    );
    const client = await Promise.race([connectionPromise, timeoutPromise]);
    steps.push("4. Connected!");

    const balance = await client.getCoreBalance(wallet.address);
    steps.push(`5. Balance: ${balance} CORE`);

    client.disconnect();
    steps.push("6. Done!");

    res.json({ success: true, steps });
  } catch (err) {
    steps.push(`ERROR: ${(err as Error).message}`);
    res.json({ success: false, steps, error: (err as Error).message });
  }
});

// ─── CREATE TOKEN (JSON — synchronous, returns full result) ─────────────────

app.post("/api/create-token-sync", async (req, res) => {
  const { description } = req.body as { description?: string };

  if (!description || typeof description !== "string") {
    res.status(400).json({ error: "Missing 'description' field." });
    return;
  }

  if (description.length > 500) {
    res.status(400).json({ error: "Description too long. Maximum 500 characters." });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "Server misconfigured: ANTHROPIC_API_KEY not set." });
    return;
  }

  const clientIp =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.ip ||
    "unknown";

  if (isRateLimited(clientIp)) {
    res.status(429).json({ error: "Rate limited. Please wait 60 seconds between requests." });
    return;
  }

  const events: Array<{ event: string; data: unknown }> = [];
  const collectEvent = (event: string, data: unknown) => {
    events.push({ event, data });
  };

  try {
    await createToken(description, collectEvent);
    // Find the success event
    const successEvent = events.find((e) => e.event === "success");
    const errorEvent = events.find((e) => e.event === "error");

    if (successEvent) {
      res.json({ success: true, events, result: successEvent.data });
    } else if (errorEvent) {
      const errData = errorEvent.data as { message: string; txHash?: string; explorerUrl?: string };
      res.json({ success: false, events, error: errData.message, txHash: errData.txHash, explorerUrl: errData.explorerUrl });
    } else {
      res.json({ success: false, events, error: "Token deployment did not complete — the AI agent finished without issuing a token. Try again or check wallet balance." });
    }
  } catch (err) {
    res.json({ success: false, events, error: (err as Error).message });
  }
});

// ─── CHAT (Token Advisor) ───────────────────────────────────────────────────

const chatRateLimitMap = new Map<string, number>();
const CHAT_RATE_LIMIT_MS = 5_000; // 1 message per 5 seconds per IP

// Clean up old chat rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, ts] of chatRateLimitMap.entries()) {
    if (now - ts > CHAT_RATE_LIMIT_MS * 2) chatRateLimitMap.delete(ip);
  }
}, 5 * 60_000);

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body as { messages?: Array<{ role: string; content: string }> };

  // Validate messages
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "Missing 'messages' array." });
    return;
  }
  if (messages.length > 30) {
    res.status(400).json({ error: "Conversation too long. Start a new chat." });
    return;
  }
  for (const m of messages) {
    if (!m.role || !m.content || typeof m.content !== "string") {
      res.status(400).json({ error: "Each message must have role and content." });
      return;
    }
    if (m.content.length > 2000) {
      res.status(400).json({ error: "Message too long. Maximum 2000 characters." });
      return;
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "Server misconfigured: ANTHROPIC_API_KEY not set." });
    return;
  }

  // Rate limit
  const clientIp =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
  const now = Date.now();
  const lastChat = chatRateLimitMap.get(clientIp);
  if (lastChat && now - lastChat < CHAT_RATE_LIMIT_MS) {
    res.status(429).json({ error: "Slow down — wait a few seconds between messages." });
    return;
  }
  chatRateLimitMap.set(clientIp, now);

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: getChatSystemPrompt(),
      messages: messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    });

    // Extract text from response
    let reply = "";
    for (const block of response.content) {
      if (block.type === "text") reply += block.text;
    }

    // Check for suggested config between ===TOKEN_CONFIG=== markers
    let suggestedConfig: Record<string, unknown> | null = null;
    const configMatch = reply.match(/===TOKEN_CONFIG===\s*([\s\S]*?)\s*===TOKEN_CONFIG===/);
    if (configMatch) {
      try {
        suggestedConfig = JSON.parse(configMatch[1].trim());
      } catch { /* ignore parse errors */ }
      // Remove the config block from the displayed reply
      reply = reply.replace(/===TOKEN_CONFIG===\s*[\s\S]*?\s*===TOKEN_CONFIG===/, "").trim();
    }

    res.json({ reply, suggestedConfig });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 529 || status === 503) {
      res.status(503).json({ error: "AI service is temporarily overloaded. Try again in a moment." });
    } else if (status === 429) {
      res.status(429).json({ error: "AI rate limit reached. Wait a moment and try again." });
    } else {
      res.status(500).json({ error: `Chat failed: ${(err as Error).message}` });
    }
  }
});

// ─── CREATE TOKEN (SSE) ──────────────────────────────────────────────────────

app.post("/api/create-token", async (req, res) => {
  // Validate input
  const { description } = req.body as { description?: string };

  if (!description || typeof description !== "string") {
    res.status(400).json({
      error: "Missing 'description' field. Provide a natural language description of the token to create.",
    });
    return;
  }

  if (description.length > 500) {
    res.status(400).json({
      error: "Description too long. Maximum 500 characters.",
    });
    return;
  }

  // Block mainnet usage with agent wallet
  if (blockMainnetAgentWallet(req, res)) return;

  // Check API key
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({
      error: "Server misconfigured: ANTHROPIC_API_KEY not set.",
    });
    return;
  }

  // Rate limiting
  const clientIp =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.ip ||
    "unknown";

  if (isRateLimited(clientIp)) {
    res.status(429).json({
      error: "Rate limited. Please wait 60 seconds between requests.",
    });
    return;
  }

  // Setup SSE — disable ALL proxy buffering
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
    "Content-Encoding": "identity",
  });

  // Disable Nagle's algorithm for immediate flushing
  req.socket.setNoDelay(true);
  res.flushHeaders();

  const sendEvent = (event: string, data: unknown) => {
    const eventStr = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    res.write(eventStr);
    // Force flush through any proxy buffering
    if (typeof (res as any).flush === "function") {
      (res as any).flush();
    }
  };

  // Handle client disconnect
  let clientDisconnected = false;
  req.on("close", () => {
    clientDisconnected = true;
  });

  const wrappedSendEvent = (event: string, data: unknown) => {
    if (!clientDisconnected) {
      sendEvent(event, data);
    }
  };

  try {
    await createToken(description, wrappedSendEvent);
  } catch (err) {
    if (!clientDisconnected) {
      sendEvent("error", {
        message: `Unexpected error: ${(err as Error).message}`,
      });
      sendEvent("done", {});
    }
  }

  if (!clientDisconnected) {
    res.end();
  }
});

// ─── DEX: GET ORDERBOOK ──────────────────────────────────────────────────────

app.get("/api/orderbook", async (req, res) => {
  const baseDenom = (req.query.baseDenom as string) || (req.query.base as string);
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  const quoteDenom = (req.query.quoteDenom as string) || (req.query.quote as string) || NETWORKS[networkName].denom;
  if (!baseDenom) { res.status(400).json({ error: "Missing 'baseDenom' query parameter." }); return; }
  try {
    const book = await queryOrderbook(baseDenom, quoteDenom, networkName);
    res.json(book);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ─── DEX: GET ORDERS ─────────────────────────────────────────────────────────

app.get("/api/orders", async (req, res) => {
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  let creator = req.query.creator as string;

  // If no creator specified, use the agent wallet
  if (!creator && process.env.AGENT_MNEMONIC) {
    try {
      const txWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
      creator = txWallet.address;
    } catch { /* fall through */ }
  }
  if (!creator) { res.status(400).json({ error: "Missing 'creator' query parameter." }); return; }

  try {
    const orders = await queryOrdersByCreator(creator, networkName);
    res.json({ wallet: creator, orders });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ─── DEX: GET PAIRS ──────────────────────────────────────────────────────────

app.get("/api/pairs", async (_req, res) => {
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  try {
    const pairs = await queryOrderBooks(networkName);
    res.json({ pairs });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ─── DEX: GET BALANCES ───────────────────────────────────────────────────────

app.get("/api/balances", async (req, res) => {
  const address = req.query.address as string;
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  if (!address) { res.status(400).json({ error: "Missing 'address' query parameter." }); return; }
  try {
    if (!process.env.AGENT_MNEMONIC) { res.status(500).json({ error: "Server not configured." }); return; }
    const txWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    const client = await TxClient.connectWithWallet(txWallet);
    const balances = await client.getBalances(address);
    client.disconnect();
    res.json({ address, balances });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ─── DEX: TRADE (AI Agent, SSE) ─────────────────────────────────────────────

const tradeRateLimitMap = new Map<string, number>();
const TRADE_RATE_LIMIT_MS = 60_000;

app.post("/api/trade", async (req, res) => {
  const { instruction } = req.body as { instruction?: string };
  if (!instruction || typeof instruction !== "string" || !instruction.trim()) {
    res.status(400).json({ error: "Missing 'instruction' field." }); return;
  }
  if (!process.env.AGENT_MNEMONIC || !process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "Server not configured." }); return;
  }

  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
  const now = Date.now();
  const lastTrade = tradeRateLimitMap.get(ip);
  if (lastTrade && now - lastTrade < TRADE_RATE_LIMIT_MS) {
    const wait = Math.ceil((TRADE_RATE_LIMIT_MS - (now - lastTrade)) / 1000);
    res.status(429).json({ error: `Wait ${wait}s before placing another trade.` }); return;
  }
  tradeRateLimitMap.set(ip, now);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendEvent = (event: string, data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify({ type: event, ...data })}\n\n`);
  };

  try { await executeTrade(instruction.trim(), sendEvent); }
  catch (err) { sendEvent("error", { message: (err as Error).message }); }

  res.write("data: [DONE]\n\n");
  res.end();
});

// ─── PARSE TOKEN (AI parse without issuing — for wallet-signed creation) ──

app.post("/api/parse-token", async (req, res) => {
  const { description } = req.body as { description?: string };
  if (!description || typeof description !== "string") {
    res.status(400).json({ error: "Missing 'description' field." });
    return;
  }
  if (description.length > 500) {
    res.status(400).json({ error: "Description too long. Maximum 500 characters." });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY not set." });
    return;
  }

  const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
  if (isRateLimited(clientIp)) {
    res.status(429).json({ error: "Rate limited. Please wait 60 seconds." });
    return;
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: `You are a token configuration parser for the TX (Coreum) blockchain.
Given a natural language description of a token, extract the configuration parameters.
Return ONLY a valid JSON object with these fields:
- subunit: string (3-50 chars, lowercase alphanumeric, e.g. "gems")
- name: string (display name, e.g. "GameCoin Gems")
- description: string (brief description)
- initialAmount: string (human-readable number, e.g. "1000000" for 1M tokens)
- precision: number (decimal places, default 6)
- features: object with boolean fields: minting, burning, freezing, whitelisting, clawback, ibcEnabled
- burnRate: string (decimal like "0.01" for 1%, or "0" for none)
- sendCommissionRate: string (decimal like "0.02" for 2%, or "0" for none)

Only include fields that are explicitly or implicitly requested. Default features to false unless mentioned.
Default precision to 6. Default burnRate and sendCommissionRate to "0".
Return ONLY the JSON object, no markdown, no explanation.`,
      messages: [{ role: "user", content: description }],
    });

    let text = "";
    for (const block of response.content) {
      if (block.type === "text") text += block.text;
    }

    // Parse the JSON from Claude's response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      res.status(500).json({ error: "Failed to parse AI response into token config." });
      return;
    }

    const config = JSON.parse(jsonMatch[0]);
    res.json({ config });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 529 || status === 503) {
      res.status(503).json({ error: "AI overloaded. Try again." });
    } else {
      res.status(500).json({ error: `Parse failed: ${(err as Error).message}` });
    }
  }
});

// ─── TOKEN MANAGEMENT ─────────────────────────────────────────────────────

app.get("/api/token-info", async (req, res) => {
  const denom = req.query.denom as string;
  if (!denom) { res.status(400).json({ error: "Missing 'denom' query param." }); return; }
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  try {
    const info = await getTokenInfo(denom, networkName);
    // Also fetch total supply
    const network = NETWORKS[networkName];
    let supply = "0";
    try {
      const supplyRes = await fetch(`${network.restEndpoint}/cosmos/bank/v1beta1/supply/by_denom?denom=${encodeURIComponent(denom)}`);
      const supplyData = await supplyRes.json() as { amount?: { amount?: string } };
      supply = supplyData.amount?.amount || "0";
    } catch { /* ignore */ }
    res.json({ ...info, supply });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.post("/api/token/mint", async (req, res) => {
  const { denom, amount, recipient } = req.body as { denom?: string; amount?: string; recipient?: string };
  if (!denom || !amount) { res.status(400).json({ error: "Missing denom or amount." }); return; }
  if (blockMainnetAgentWallet(req, res)) return;
  if (!process.env.AGENT_MNEMONIC) { res.status(500).json({ error: "Server not configured." }); return; }
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  try {
    const txWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    const client = await TxClient.connectWithWallet(txWallet);
    const result = await mintTokens(client, denom, amount, recipient);
    client.disconnect();
    res.json(result);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.post("/api/token/burn", async (req, res) => {
  const { denom, amount } = req.body as { denom?: string; amount?: string };
  if (!denom || !amount) { res.status(400).json({ error: "Missing denom or amount." }); return; }
  if (blockMainnetAgentWallet(req, res)) return;
  if (!process.env.AGENT_MNEMONIC) { res.status(500).json({ error: "Server not configured." }); return; }
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  try {
    const txWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    const client = await TxClient.connectWithWallet(txWallet);
    const result = await burnTokens(client, denom, amount);
    client.disconnect();
    res.json(result);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.post("/api/token/freeze", async (req, res) => {
  const { denom, account, amount } = req.body as { denom?: string; account?: string; amount?: string };
  if (!denom || !account || !amount) { res.status(400).json({ error: "Missing denom, account, or amount." }); return; }
  if (blockMainnetAgentWallet(req, res)) return;
  if (!process.env.AGENT_MNEMONIC) { res.status(500).json({ error: "Server not configured." }); return; }
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  try {
    const txWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    const client = await TxClient.connectWithWallet(txWallet);
    const result = await freezeAccount(client, denom, account, amount);
    client.disconnect();
    res.json(result);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.post("/api/token/unfreeze", async (req, res) => {
  const { denom, account, amount } = req.body as { denom?: string; account?: string; amount?: string };
  if (!denom || !account || !amount) { res.status(400).json({ error: "Missing denom, account, or amount." }); return; }
  if (blockMainnetAgentWallet(req, res)) return;
  if (!process.env.AGENT_MNEMONIC) { res.status(500).json({ error: "Server not configured." }); return; }
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  try {
    const txWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    const client = await TxClient.connectWithWallet(txWallet);
    const result = await unfreezeAccount(client, denom, account, amount);
    client.disconnect();
    res.json(result);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.post("/api/token/global-freeze", async (req, res) => {
  const { denom } = req.body as { denom?: string };
  if (!denom) { res.status(400).json({ error: "Missing denom." }); return; }
  if (blockMainnetAgentWallet(req, res)) return;
  if (!process.env.AGENT_MNEMONIC) { res.status(500).json({ error: "Server not configured." }); return; }
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  try {
    const txWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    const client = await TxClient.connectWithWallet(txWallet);
    const result = await globallyFreezeToken(client, denom);
    client.disconnect();
    res.json(result);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.post("/api/token/global-unfreeze", async (req, res) => {
  const { denom } = req.body as { denom?: string };
  if (!denom) { res.status(400).json({ error: "Missing denom." }); return; }
  if (blockMainnetAgentWallet(req, res)) return;
  if (!process.env.AGENT_MNEMONIC) { res.status(500).json({ error: "Server not configured." }); return; }
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  try {
    const txWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    const client = await TxClient.connectWithWallet(txWallet);
    const result = await globallyUnfreezeToken(client, denom);
    client.disconnect();
    res.json(result);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.post("/api/token/clawback", async (req, res) => {
  const { denom, account, amount } = req.body as { denom?: string; account?: string; amount?: string };
  if (!denom || !account || !amount) { res.status(400).json({ error: "Missing denom, account, or amount." }); return; }
  if (blockMainnetAgentWallet(req, res)) return;
  if (!process.env.AGENT_MNEMONIC) { res.status(500).json({ error: "Server not configured." }); return; }
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  try {
    const txWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    const client = await TxClient.connectWithWallet(txWallet);
    const result = await clawbackTokens(client, denom, account, amount);
    client.disconnect();
    res.json(result);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.post("/api/token/whitelist", async (req, res) => {
  const { denom, account, amount } = req.body as { denom?: string; account?: string; amount?: string };
  if (!denom || !account || !amount) { res.status(400).json({ error: "Missing denom, account, or amount." }); return; }
  if (blockMainnetAgentWallet(req, res)) return;
  if (!process.env.AGENT_MNEMONIC) { res.status(500).json({ error: "Server not configured." }); return; }
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  try {
    const txWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    const client = await TxClient.connectWithWallet(txWallet);
    const result = await setWhitelistedLimit(client, denom, account, amount);
    client.disconnect();
    res.json(result);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ─── PREFLIGHT COMPLIANCE ENGINE ─────────────────────────────────────────
// Pre-transaction validation: checks balance, gas, freeze, whitelist,
// compliance NFT, and parameter validity BEFORE signing.

app.post("/api/preflight", async (req, res) => {
  const { txType, sender, params, network } = req.body as {
    txType?: string;
    sender?: string;
    params?: Record<string, unknown>;
    network?: string;
  };

  if (!txType || !sender) {
    res.status(400).json({ error: "Missing required fields: txType, sender." });
    return;
  }

  const validTypes = ["token_send", "token_issue", "nft_mint", "nft_transfer", "airdrop", "dex_place_order"];
  if (!validTypes.includes(txType)) {
    res.status(400).json({
      error: `Invalid txType "${txType}". Must be one of: ${validTypes.join(", ")}`,
    });
    return;
  }

  const networkName = network || (process.env.TX_NETWORK as string) || "testnet";

  try {
    const result = await runPreflight({ txType: txType as any, sender, params: (params || {}) as any, network: networkName });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `Preflight error: ${(err as Error).message}` });
  }
});

// ─── FAUCET PROXY (avoids CORS issues) ──────────────────────────────────

app.post("/api/faucet", async (req, res) => {
  try {
    const { address } = req.body as { address?: string };
    if (!address) {
      res.status(400).json({ error: "Missing address." });
      return;
    }
    const result = await requestFaucet(address);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── DEX: BUILD UNSIGNED TX (for Keplr/Leap wallet signing) ─────────────

app.post("/api/build-tx", async (req, res) => {
  const { signerAddress, messages, gasLimit, pubkeyHex } = req.body as {
    signerAddress?: string;
    messages?: Array<{ typeUrl: string; value: Record<string, unknown> }>;
    gasLimit?: number;
    pubkeyHex?: string;
  };

  if (!signerAddress || !messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "Missing signerAddress or messages." });
    return;
  }

  if (!pubkeyHex) {
    res.status(400).json({ error: "Missing pubkeyHex (signer's public key)." });
    return;
  }

  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  const network = NETWORKS[networkName];
  const gas = gasLimit || 300000;

  try {
    const registry = new Registry([
      ...defaultRegistryTypes,
      ...(coreumRegistry as ReadonlyArray<[string, GeneratedType]>),
    ]);

    // Encode each message using the Coreum registry
    const encodedMsgs = messages.map((m) => ({
      typeUrl: m.typeUrl,
      value: registry.encode({ typeUrl: m.typeUrl, value: m.value }),
    }));

    // Build TxBody
    const { TxBody, AuthInfo, Fee, SignerInfo, ModeInfo } = await import("cosmjs-types/cosmos/tx/v1beta1/tx");
    const { Any } = await import("cosmjs-types/google/protobuf/any");
    const { SignMode } = await import("cosmjs-types/cosmos/tx/signing/v1beta1/signing");

    const bodyBytes = TxBody.encode(
      TxBody.fromPartial({
        messages: encodedMsgs.map((m) =>
          Any.fromPartial({ typeUrl: m.typeUrl, value: m.value })
        ),
        memo: "",
      })
    ).finish();

    // Fetch account info for sequence and account number
    const accountRes = await fetch(
      `${network.restEndpoint}/cosmos/auth/v1beta1/accounts/${signerAddress}`
    );
    const accountData = (await accountRes.json()) as {
      account: { account_number: string; sequence: string; pub_key?: { key: string } };
    };
    const accountNumber = parseInt(accountData.account.account_number || "0", 10);
    const sequence = parseInt(accountData.account.sequence || "0", 10);

    // Build fee
    // Use high gas price (0.25) to avoid "insufficient fees" on testnet
    const feeAmount = Math.ceil(gas * 0.25).toString();

    // Decode the pubkey from hex
    const pubkeyBytes = Buffer.from(pubkeyHex, "hex");

    const authInfoBytes = AuthInfo.encode(
      AuthInfo.fromPartial({
        signerInfos: [
          SignerInfo.fromPartial({
            publicKey: Any.fromPartial({
              typeUrl: "/cosmos.crypto.secp256k1.PubKey",
              value: Buffer.from([10, pubkeyBytes.length, ...pubkeyBytes]),  // protobuf: field 1, length-delimited
            }),
            modeInfo: ModeInfo.fromPartial({
              single: { mode: SignMode.SIGN_MODE_DIRECT },
            }),
            sequence: BigInt(sequence),
          }),
        ],
        fee: Fee.fromPartial({
          amount: [{ denom: network.denom, amount: feeAmount }],
          gasLimit: BigInt(gas),
        }),
      })
    ).finish();

    // Return hex-encoded bytes + account info
    res.json({
      bodyBytes: Buffer.from(bodyBytes).toString("hex"),
      authInfoBytes: Buffer.from(authInfoBytes).toString("hex"),
      chainId: network.chainId,
      accountNumber,
      sequence,
      fee: {
        amount: [{ denom: network.denom, amount: feeAmount }],
        gas: gas.toString(),
      },
    });
  } catch (err) {
    console.error("[build-tx] Error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── SEND TOKENS ──────────────────────────────────────────────────────────

app.post("/api/send", async (req, res) => {
  const { to, denom, amount } = req.body as { to?: string; denom?: string; amount?: string };
  if (!to || !denom || !amount) {
    res.status(400).json({ error: "Missing 'to', 'denom', and 'amount'." }); return;
  }
  if (blockMainnetAgentWallet(req, res)) return;
  if (!process.env.AGENT_MNEMONIC) {
    res.status(500).json({ error: "Server not configured." }); return;
  }
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  let client: TxClient | null = null;
  try {
    const txWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    client = await TxClient.connectWithWallet(txWallet);
    const msg = {
      typeUrl: "/cosmos.bank.v1beta1.MsgSend",
      value: {
        fromAddress: client.address,
        toAddress: to,
        amount: [{ denom, amount }],
      },
    };
    const result = await client.signAndBroadcastMsg(msg, 200000);
    res.json(result);
  } catch (err) {
    console.error("[send] Error:", err);
    res.status(500).json({ error: (err as Error).message });
  } finally {
    try { if (client) client.disconnect(); } catch { /* ignore */ }
  }
});

// ─── AIRDROP TOKENS ──────────────────────────────────────────────────────

app.post("/api/airdrop", async (req, res) => {
  const { denom, amount, recipients } = req.body as {
    denom?: string; amount?: string; recipients?: string[];
  };

  // Validate inputs
  if (!denom) {
    res.status(400).json({ error: "Missing 'denom'." }); return;
  }
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    res.status(400).json({ error: "'amount' must be a positive number." }); return;
  }
  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    res.status(400).json({ error: "'recipients' must be a non-empty array." }); return;
  }
  if (recipients.length > 50) {
    res.status(400).json({ error: "Max 50 recipients per request." }); return;
  }
  if (blockMainnetAgentWallet(req, res)) return;
  if (await tokenGateCheck(req, res)) return;
  if (!process.env.AGENT_MNEMONIC) {
    res.status(500).json({ error: "Server not configured." }); return;
  }

  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  let client: TxClient | null = null;
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  try {
    const txWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    client = await TxClient.connectWithWallet(txWallet);

    // Process recipients sequentially to avoid nonce issues
    for (const recipient of recipients) {
      try {
        const msg = {
          typeUrl: "/cosmos.bank.v1beta1.MsgSend",
          value: {
            fromAddress: client.address,
            toAddress: recipient,
            amount: [{ denom, amount }],
          },
        };
        await client.signAndBroadcastMsg(msg, 200000);
        sent++;
      } catch (err) {
        failed++;
        errors.push(`${recipient}: ${(err as Error).message}`);
      }
    }

    res.json({ success: true, sent, failed, errors });
  } catch (err) {
    console.error("[airdrop] Error:", err);
    res.status(500).json({ error: (err as Error).message });
  } finally {
    try { if (client) client.disconnect(); } catch { /* ignore */ }
  }
});

// ─── GET STAKERS (Delegators of a Validator) ─────────────────────────────

app.get("/api/stakers/:validatorAddr", async (req, res) => {
  const { validatorAddr } = req.params;
  if (!validatorAddr) {
    res.status(400).json({ error: "Missing validator address." }); return;
  }

  const { network } = getNetwork(req);
  const baseUrl = network.restEndpoint;
  const allAddresses: string[] = [];
  let nextKey: string | null = null;

  try {
    do {
      let url = `${baseUrl}/cosmos/staking/v1beta1/validators/${validatorAddr}/delegations?pagination.limit=1000`;
      if (nextKey) {
        url += `&pagination.key=${encodeURIComponent(nextKey)}`;
      }

      const response = await fetch(url);
      if (!response.ok) {
        const text = await response.text();
        res.status(response.status).json({ error: `Chain query failed: ${text}` }); return;
      }

      const data = await response.json() as {
        delegation_responses?: Array<{ delegation?: { delegator_address?: string } }>;
        pagination?: { next_key?: string | null };
      };

      if (data.delegation_responses) {
        for (const entry of data.delegation_responses) {
          const addr = entry.delegation?.delegator_address;
          if (addr) allAddresses.push(addr);
        }
      }

      nextKey = data.pagination?.next_key || null;
    } while (nextKey);

    res.json({ success: true, addresses: allAddresses, count: allAddresses.length });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── GET HOLDERS (Token Holders by Denom) ─────────────────────────────────

app.get("/api/holders/:denom", async (req, res) => {
  const { denom } = req.params;
  if (!denom) {
    res.status(400).json({ error: "Missing denom." }); return;
  }

  const manualAddresses = req.query.addresses as string | undefined;

  // If manual addresses provided, verify balances on-chain
  if (manualAddresses) {
    const addresses = manualAddresses.split(",").map((a) => a.trim()).filter(Boolean);
    const { network: holderNetwork } = getNetwork(req);
    const baseUrl = holderNetwork.restEndpoint;
    const holders: string[] = [];
    const errors: string[] = [];

    for (const addr of addresses) {
      try {
        const response = await fetch(`${baseUrl}/cosmos/bank/v1beta1/balances/${addr}`);
        if (!response.ok) {
          errors.push(`${addr}: query failed`);
          continue;
        }
        const data = await response.json() as {
          balances?: Array<{ denom: string; amount: string }>;
        };
        const bal = data.balances?.find((b) => b.denom === denom);
        if (bal && parseInt(bal.amount) > 0) {
          holders.push(addr);
        }
      } catch (err) {
        errors.push(`${addr}: ${(err as Error).message}`);
      }
    }

    res.json({
      success: true,
      addresses: holders,
      count: holders.length,
      source: "manual",
      ...(errors.length > 0 ? { errors } : {}),
    });
    return;
  }

  // No direct "all holders" endpoint on Coreum — return guidance
  res.json({
    success: true,
    addresses: [],
    count: 0,
    source: "chain",
    note: "Coreum does not expose a direct token-holders endpoint. Provide addresses via ?addresses=addr1,addr2,... to verify balances, or use an off-chain indexer.",
  });
});

// ─── NFT AIRDROP (Issue Class + Batch Mint to Recipients) ─────────────────

app.post("/api/nft-airdrop", async (req, res) => {
  const { name, symbol, description, uri, recipients, royaltyRate, features } = req.body as {
    name?: string;
    symbol?: string;
    description?: string;
    uri?: string;
    recipients?: string[];
    royaltyRate?: string;
    features?: Record<string, boolean>;
  };

  // Validate inputs
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "Missing 'name'." }); return;
  }
  if (!symbol || typeof symbol !== "string") {
    res.status(400).json({ error: "Missing 'symbol'." }); return;
  }
  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    res.status(400).json({ error: "'recipients' must be a non-empty array." }); return;
  }
  if (recipients.length > 100) {
    res.status(400).json({ error: "Max 100 recipients per call." }); return;
  }
  if (blockMainnetAgentWallet(req, res)) return;
  if (await tokenGateCheck(req, res)) return;
  if (!process.env.AGENT_MNEMONIC) {
    res.status(500).json({ error: "Server not configured." }); return;
  }

  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  let client: TxClient | null = null;
  let minted = 0;
  let failed = 0;
  const errors: string[] = [];

  try {
    const txWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    client = await TxClient.connectWithWallet(txWallet);

    // Step 1: Issue NFT class
    console.log(`[nft-airdrop] Issuing NFT class: ${symbol} (${name})`);
    const classResult = await issueNFTClass(client, {
      symbol: symbol.toLowerCase(),
      name,
      description: description || `${name} NFT Airdrop Collection`,
      uri: uri || "",
      royaltyRate: royaltyRate || "0",
      features: features || undefined,
    });

    if (!classResult.success) {
      res.status(500).json({
        error: `Failed to issue NFT class: ${classResult.error || "unknown error"}`,
        txHash: classResult.txHash,
      });
      return;
    }

    const classId = classResult.classId;
    console.log(`[nft-airdrop] NFT class issued: ${classId}`);

    // Step 2: Mint and send an NFT to each recipient
    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      const nftId = `airdrop-${i + 1}`;

      try {
        await mintNFT(client, {
          classId,
          id: nftId,
          uri: uri || "",
          recipient,
        });
        minted++;
        console.log(`[nft-airdrop] Minted ${nftId} → ${recipient}`);
      } catch (err) {
        failed++;
        errors.push(`${recipient} (${nftId}): ${(err as Error).message}`);
        console.error(`[nft-airdrop] Failed to mint ${nftId} → ${recipient}: ${(err as Error).message}`);
      }
    }

    res.json({
      success: true,
      classId,
      minted,
      failed,
      errors,
    });
  } catch (err) {
    console.error("[nft-airdrop] Error:", err);
    res.status(500).json({ error: (err as Error).message });
  } finally {
    try { if (client) client.disconnect(); } catch { /* ignore */ }
  }
});

// ─── SCOUT PASS AUTO-MINT ──────────────────────────────────────────────────
// Dedicated endpoint for auto-minting free soulbound Scout Pass on wallet connect.
// Bypasses rate limiter and token gate — everyone gets one free identity NFT.
// Prevents duplicate mints by checking if wallet already owns a pass.

const scoutMintedWallets = new Set<string>(); // In-memory dedup (resets on redeploy)

app.post("/api/scout-mint", async (req, res) => {
  const { wallet } = req.body as { wallet?: string };

  if (!wallet || typeof wallet !== "string" || !wallet.startsWith("testcore")) {
    res.status(400).json({ error: "Invalid wallet address." });
    return;
  }

  // Dedup: don't mint twice in same server session
  if (scoutMintedWallets.has(wallet)) {
    res.json({ success: true, alreadyMinted: true, message: "Scout Pass already minted this session." });
    return;
  }

  if (!process.env.AGENT_MNEMONIC) {
    res.status(500).json({ error: "Server not configured." });
    return;
  }

  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  let client: TxClient | null = null;

  try {
    // Check on-chain if wallet already has any pass NFT
    const network = NETWORKS[networkName];
    const nftRes = await fetch(`${network.restEndpoint}/coreum/nft/v1beta1/nfts?owner=${wallet}`);
    const nftData: any = await nftRes.json();
    const existingPasses = (nftData.nfts || []).filter((nft: any) => {
      const classId = (nft.class_id || "").toLowerCase();
      return classId.includes("scoutpass") || classId.includes("scout-pass") ||
             classId.includes("creatorpass") || classId.includes("creator-pass") ||
             classId.includes("propass") || classId.includes("pro-pass") ||
             classId.includes("txaiscout") || classId.includes("txaicreator") || classId.includes("txaipro");
    });

    if (existingPasses.length > 0) {
      scoutMintedWallets.add(wallet);
      res.json({ success: true, alreadyMinted: true, message: "Wallet already owns a pass." });
      return;
    }

    // Mint soulbound Scout Pass
    const txWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    client = await TxClient.connectWithWallet(txWallet);

    const symbol = "scoutpass";
    let classId: string | null = null;

    // Try to issue a new class; if symbol already exists, find the existing one
    const classResult = await issueNFTClass(client, {
      symbol,
      name: "Scout Pass",
      description: "TXAI Scout Pass — soulbound identity NFT",
      uri: "",
      royaltyRate: "0",
      features: { disableSending: true },
    });

    if (classResult.success) {
      classId = classResult.classId!;
      console.log(`[scout-mint] Created new Scout Pass class: ${classId}`);
    } else if (classResult.error?.includes("already used")) {
      // Class already exists — derive the classId from symbol + issuer address
      const issuerAddr = txWallet.address;
      classId = `${symbol}-${issuerAddr}`;
      console.log(`[scout-mint] Reusing existing Scout Pass class: ${classId}`);
    } else {
      throw new Error(`NFT class failed: ${classResult.error}`);
    }

    const nftId = "scout-" + Date.now().toString(36);
    const nftUri = "https://solomentelabs.com/assets/scout-pass.svg";

    await mintNFT(client, {
      classId,
      id: nftId,
      uri: nftUri,
      recipient: wallet,
    });

    scoutMintedWallets.add(wallet);
    console.log(`[scout-mint] Minted Scout Pass → ${wallet} (class: ${classId})`);

    res.json({
      success: true,
      alreadyMinted: false,
      classId: classResult.classId,
      nftId,
      message: "Scout Pass minted! Welcome to TXAI.",
    });

  } catch (err) {
    console.error("[scout-mint] Error:", err);
    res.status(500).json({ error: (err as Error).message });
  } finally {
    try { if (client) client.disconnect(); } catch { /* ignore */ }
  }
});

// ─── CREATE WALLET ────────────────────────────────────────────────────────

app.post("/api/create-wallet", async (_req, res) => {
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  try {
    const { createWallet } = await import("./tx-sdk");
    const wallet = await createWallet(networkName);
    res.json({
      address: wallet.address,
      mnemonic: wallet.mnemonic,
      network: networkName,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── DEX: DIRECT PLACE ORDER ──────────────────────────────────────────────

app.post("/api/dex/place-order", async (req, res) => {
  console.log("[dex/place-order] Request received:", JSON.stringify(req.body).slice(0, 200));
  const { baseDenom, quoteDenom, side, price, quantity } = req.body as {
    baseDenom?: string; quoteDenom?: string; side?: string; price?: string; quantity?: string;
  };
  if (!baseDenom || !quoteDenom || !side || !price || !quantity) {
    res.status(400).json({ error: "Missing required fields: baseDenom, quoteDenom, side, price, quantity." });
    return;
  }
  if (!process.env.AGENT_MNEMONIC) {
    res.status(500).json({ error: "Server not configured." }); return;
  }
  // Validate price format: Coreum DEX requires ^(([1-9])|([1-9]\d*[1-9]))(e-?[1-9]\d*)?$
  const priceRegex = /^(([1-9])|([1-9]\d*[1-9]))(e-?[1-9]\d*)?$/;
  if (!priceRegex.test(price)) {
    res.status(400).json({ error: `Invalid price format "${price}". Must be integer mantissa with optional exponent, e.g. "15e-4" not "1.5e-3".` });
    return;
  }
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  let client: TxClient | null = null;
  try {
    console.log("[dex/place-order] Step 1: importing wallet...");
    const txWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    console.log("[dex/place-order] Step 2: connecting client...");
    client = await TxClient.connectWithWallet(txWallet);
    console.log("[dex/place-order] Step 3: placing order...");
    const result = await placeOrder(client, {
      baseDenom,
      quoteDenom,
      side: side.toLowerCase() === "buy" ? 1 : 2,  // 1=BUY, 2=SELL
      orderType: 1,  // 1=LIMIT
      price,
      quantity,
      timeInForce: 1,  // 1=GTC
    } as any);
    console.log("[dex/place-order] Step 4: success!", result.orderId);
    res.json(result);
  } catch (err) {
    console.error("[dex/place-order] Error:", (err as Error).message);
    console.error("[dex/place-order] Stack:", (err as Error).stack);
    res.status(500).json({ success: false, error: (err as Error).message });
  } finally {
    try { if (client) client.disconnect(); } catch { /* ignore disconnect errors */ }
  }
});

// ─── DEX: DIAGNOSTIC ────────────────────────────────────────────────────────

app.get("/api/dex/debug", async (_req, res) => {
  const steps: string[] = [];
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  let client: TxClient | null = null;
  try {
    steps.push("1. Starting...");
    if (!process.env.AGENT_MNEMONIC) { res.json({ steps, error: "No mnemonic" }); return; }

    steps.push("2. Importing wallet...");
    const txWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    steps.push(`3. Wallet imported: ${txWallet.address?.slice(0, 16)}...`);

    steps.push("4. Connecting client...");
    client = await TxClient.connectWithWallet(txWallet);
    steps.push(`5. Client connected: ${client.address.slice(0, 16)}...`);

    // Test actual placeOrder with a tiny sell order
    steps.push("6. Calling placeOrder...");
    const result = await placeOrder(client, {
      baseDenom: "txai-testcore15s5gdh74x5fwwyyt2wspahdqmhf0x5nzvlelcf",
      quoteDenom: "utestcore",
      side: 2,  // SELL
      orderType: 1,  // LIMIT
      price: "1.5e-3",
      quantity: "1000000",
      timeInForce: 1,  // GTC
    } as any);
    steps.push(`7. placeOrder returned: ${JSON.stringify(result).slice(0, 200)}`);

    res.json({ steps, success: true, result });
  } catch (err) {
    steps.push(`ERROR: ${(err as Error).message}`);
    console.error("[dex/debug] Error at step:", steps.length, err);
    res.json({ steps, error: (err as Error).message });
  } finally {
    try { if (client) client.disconnect(); } catch {}
  }
});

// ─── DEX: DIRECT CANCEL ORDER ─────────────────────────────────────────────

app.post("/api/dex/cancel-order", async (req, res) => {
  const { orderId } = req.body as { orderId?: string };
  if (!orderId) {
    res.status(400).json({ error: "Missing 'orderId'." }); return;
  }
  if (!process.env.AGENT_MNEMONIC) {
    res.status(500).json({ error: "Server not configured." }); return;
  }
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  let client: TxClient | null = null;
  try {
    const txWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    client = await TxClient.connectWithWallet(txWallet);
    const result = await cancelOrder(client, orderId);
    res.json(result);
  } catch (err) {
    console.error("[dex/cancel-order] Error:", err);
    res.status(500).json({ error: (err as Error).message });
  } finally {
    try { if (client) client.disconnect(); } catch { /* ignore */ }
  }
});

// ─── NFT: ISSUE CLASS ─────────────────────────────────────────────────────
app.post("/api/nft/issue-class", async (req, res) => {
  const { symbol, name, description, uri, uriHash, features, royaltyRate } = req.body as {
    symbol?: string; name?: string; description?: string; uri?: string; uriHash?: string;
    features?: Record<string, boolean>; royaltyRate?: string;
  };
  if (!symbol || !name) { res.status(400).json({ error: "Missing 'symbol' and 'name'." }); return; }
  if (!process.env.AGENT_MNEMONIC) { res.status(500).json({ error: "Server not configured." }); return; }
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  try {
    const txWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    const client = await TxClient.connectWithWallet(txWallet);
    const result = await issueNFTClass(client, { symbol, name, description, uri, uriHash, features, royaltyRate });
    client.disconnect();
    res.json(result);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ─── NFT: MINT ────────────────────────────────────────────────────────────
app.post("/api/nft/mint", async (req, res) => {
  const { classId, id, uri, uriHash, data, recipient } = req.body as {
    classId?: string; id?: string; uri?: string; uriHash?: string; data?: string; recipient?: string;
  };
  if (!classId || !id) { res.status(400).json({ error: "Missing 'classId' and 'id'." }); return; }
  if (!process.env.AGENT_MNEMONIC) { res.status(500).json({ error: "Server not configured." }); return; }
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  try {
    const txWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    const client = await TxClient.connectWithWallet(txWallet);
    const result = await mintNFT(client, { classId, id, uri, uriHash, data, recipient });
    client.disconnect();
    res.json(result);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ─── NFT: BURN ────────────────────────────────────────────────────────────
app.post("/api/nft/burn", async (req, res) => {
  const { classId, id } = req.body as { classId?: string; id?: string };
  if (!classId || !id) { res.status(400).json({ error: "Missing 'classId' and 'id'." }); return; }
  if (!process.env.AGENT_MNEMONIC) { res.status(500).json({ error: "Server not configured." }); return; }
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  try {
    const txWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    const client = await TxClient.connectWithWallet(txWallet);
    const result = await burnNFT(client, classId, id);
    client.disconnect();
    res.json(result);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ─── NFT: FREEZE / UNFREEZE ──────────────────────────────────────────────
app.post("/api/nft/freeze", async (req, res) => {
  const { classId, id } = req.body as { classId?: string; id?: string };
  if (!classId || !id) { res.status(400).json({ error: "Missing 'classId' and 'id'." }); return; }
  if (!process.env.AGENT_MNEMONIC) { res.status(500).json({ error: "Server not configured." }); return; }
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  try {
    const txWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    const client = await TxClient.connectWithWallet(txWallet);
    const result = await freezeNFT(client, classId, id);
    client.disconnect();
    res.json(result);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.post("/api/nft/unfreeze", async (req, res) => {
  const { classId, id } = req.body as { classId?: string; id?: string };
  if (!classId || !id) { res.status(400).json({ error: "Missing 'classId' and 'id'." }); return; }
  if (!process.env.AGENT_MNEMONIC) { res.status(500).json({ error: "Server not configured." }); return; }
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  try {
    const txWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    const client = await TxClient.connectWithWallet(txWallet);
    const result = await unfreezeNFT(client, classId, id);
    client.disconnect();
    res.json(result);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ─── NFT: QUERY CLASS ─────────────────────────────────────────────────────
app.get("/api/nft/class", async (req, res) => {
  const classId = req.query.classId as string;
  if (!classId) { res.status(400).json({ error: "Missing 'classId' query param." }); return; }
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  try {
    const info = await queryNFTClass(classId, networkName);
    if (!info) { res.status(404).json({ error: "Class not found." }); return; }
    res.json({ class: info });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ─── NFT: QUERY NFTs BY CLASS ─────────────────────────────────────────────
app.get("/api/nft/nfts", async (req, res) => {
  const classId = req.query.classId as string;
  const owner = req.query.owner as string;
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  try {
    let nfts;
    if (classId) {
      nfts = await queryNFTsByClass(classId, networkName);
    } else if (owner) {
      nfts = await queryNFTsByOwner(owner, networkName);
    } else {
      res.status(400).json({ error: "Provide 'classId' or 'owner' query param." }); return;
    }
    res.json({ nfts });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ─── AUTH: GRANT (Agent Wallet) ─────────────────────────────────────────────

app.post("/api/auth/grant", async (req, res) => {
  const { grantee, authorizationType, authorizationValue, expirationSeconds } = req.body as {
    grantee?: string;
    authorizationType?: string;
    authorizationValue?: Record<string, unknown>;
    expirationSeconds?: number;
  };

  if (!grantee || !authorizationType) {
    res.status(400).json({ error: "Missing grantee or authorizationType." });
    return;
  }
  if (!process.env.AGENT_MNEMONIC) {
    res.status(500).json({ error: "Server not configured." });
    return;
  }

  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";

  try {
    const txWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    const client = await TxClient.connectWithWallet(txWallet);

    const expSeconds = expirationSeconds || 365 * 86400;
    const expirationDate = new Date(Date.now() + expSeconds * 1000);

    // Build the authorization Any based on type
    let authorization: { typeUrl: string; value: Record<string, unknown> };
    if (authorizationType.includes("SendAuthorization")) {
      authorization = {
        typeUrl: "/cosmos.bank.v1beta1.SendAuthorization",
        value: authorizationValue || {},
      };
    } else {
      authorization = {
        typeUrl: "/cosmos.authz.v1beta1.GenericAuthorization",
        value: authorizationValue || {},
      };
    }

    const msg = {
      typeUrl: "/cosmos.authz.v1beta1.MsgGrant",
      value: {
        granter: client.address,
        grantee,
        grant: {
          authorization,
          expiration: expirationDate,
        },
      },
    };

    const result = await client.signAndBroadcastMsg(msg, 300000);
    client.disconnect();
    res.json({ success: result.success, txHash: result.txHash });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── AUTH: REVOKE (Agent Wallet) ────────────────────────────────────────────

app.post("/api/auth/revoke", async (req, res) => {
  const { grantee, msgTypeUrl } = req.body as {
    grantee?: string;
    msgTypeUrl?: string;
  };

  if (!grantee || !msgTypeUrl) {
    res.status(400).json({ error: "Missing grantee or msgTypeUrl." });
    return;
  }
  if (!process.env.AGENT_MNEMONIC) {
    res.status(500).json({ error: "Server not configured." });
    return;
  }

  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";

  try {
    const txWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    const client = await TxClient.connectWithWallet(txWallet);

    const msg = {
      typeUrl: "/cosmos.authz.v1beta1.MsgRevoke",
      value: {
        granter: client.address,
        grantee,
        msgTypeUrl,
      },
    };

    const result = await client.signAndBroadcastMsg(msg, 200000);
    client.disconnect();
    res.json({ success: result.success, txHash: result.txHash });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── DEX: CHAT (Trading Advisor) ────────────────────────────────────────────

const dexChatRateLimitMap = new Map<string, number>();

app.post("/api/dex-chat", async (req, res) => {
  const { messages } = req.body as { messages?: Array<{ role: string; content: string }> };
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "Missing 'messages' array." }); return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY not set." }); return;
  }

  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
  const now = Date.now();
  const last = dexChatRateLimitMap.get(ip);
  if (last && now - last < 5000) { res.status(429).json({ error: "Slow down." }); return; }
  dexChatRateLimitMap.set(ip, now);

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: getDexChatSystemPrompt(),
      messages: messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    });

    let reply = "";
    for (const block of response.content) { if (block.type === "text") reply += block.text; }

    let suggestedOrder: Record<string, unknown> | null = null;
    const configMatch = reply.match(/===ORDER_CONFIG===\s*([\s\S]*?)\s*===ORDER_CONFIG===/);
    if (configMatch) {
      try { suggestedOrder = JSON.parse(configMatch[1].trim()); } catch { /* ignore */ }
      reply = reply.replace(/===ORDER_CONFIG===\s*[\s\S]*?\s*===ORDER_CONFIG===/, "").trim();
    }

    res.json({ reply, suggestedOrder });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 529 || status === 503) { res.status(503).json({ error: "AI overloaded. Try again." }); }
    else { res.status(500).json({ error: `Chat failed: ${(err as Error).message}` }); }
  }
});

// ─── DEX: LIVE DEMO (SSE) ────────────────────────────────────────────────────

import { runDexDemo, isDemoRunning, resetDemoLock, DEMO_TOKENS_NEEDED } from "./dex-demo";

// ─── DEX DEMO: Check if agent has enough tokens ─────────────────────────────
app.post("/api/dex/check-demo-ready", async (req, res) => {
  const { baseDenom } = req.body as { baseDenom?: string };
  if (!baseDenom) {
    res.status(400).json({ error: "Missing 'baseDenom'." });
    return;
  }
  if (!process.env.AGENT_MNEMONIC) {
    res.status(500).json({ error: "Server not configured (no agent mnemonic)." });
    return;
  }

  try {
    const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
    const agentWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    const client = await TxClient.connectWithWallet(agentWallet, { isolatedMutex: true });

    const balances = await client.getBalances(client.address);
    const tokenBal = balances.find((b: any) => b.denom === baseDenom);
    const rawAmount = tokenBal ? parseInt(tokenBal.amount) : 0;
    const displayAmount = rawAmount / 1e6;
    const needed = DEMO_TOKENS_NEEDED; // 7000 display units
    const neededRaw = needed * 1e6;
    const symbol = baseDenom.split("-")[0].toUpperCase();

    // Check token features (whitelisting, etc.)
    const tokenInfo = await getTokenInfo(baseDenom, networkName);
    const features = tokenInfo.features || [];
    const hasWhitelisting = features.includes("whitelisting");

    client.disconnect();

    if (rawAmount >= neededRaw) {
      res.json({ ready: true });
    } else {
      res.json({
        ready: false,
        agentAddress: client.address,
        tokensNeeded: needed,
        tokensHeld: displayAmount,
        symbol,
        hasWhitelisting,
      });
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── DEX DEMO: Pre-create agent wallets for whitelisting ─────────────────────
// Returns the agent address + 3 sub-wallet addresses that need whitelisting
const _preparedWallets: Record<string, { addresses: string[]; mnemonics: string[]; createdAt: number }> = {};

app.post("/api/dex/prepare-wallets", async (req, res) => {
  const { baseDenom } = req.body as { baseDenom?: string };
  if (!baseDenom) { res.status(400).json({ error: "Missing baseDenom" }); return; }
  if (!process.env.AGENT_MNEMONIC) { res.status(500).json({ error: "Server not configured." }); return; }

  try {
    const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
    const agentWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);

    // Check if we already prepared wallets for this denom recently (within 30 min)
    const existing = _preparedWallets[baseDenom];
    if (existing && Date.now() - existing.createdAt < 30 * 60 * 1000) {
      res.json({
        agentAddress: agentWallet.address,
        subWallets: existing.addresses,
      });
      return;
    }

    // Create 3 sub-wallets
    const addresses: string[] = [];
    const mnemonics: string[] = [];
    for (let i = 0; i < 3; i++) {
      const w = await createWallet(networkName);
      addresses.push(w.address);
      mnemonics.push(w.mnemonic);
    }

    _preparedWallets[baseDenom] = { addresses, mnemonics, createdAt: Date.now() };

    res.json({
      agentAddress: agentWallet.address,
      subWallets: addresses,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── DEX DEMO: Reset stuck demo lock ────────────────────────────────────────
// ─── Agent Wallet Balance ─────────────────────────────────────────────────
app.get("/api/agent-balance", async (_req, res) => {
  try {
    if (!process.env.AGENT_MNEMONIC) {
      res.status(500).json({ error: "No agent mnemonic configured" });
      return;
    }
    const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
    const wallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    const client = await TxClient.connectWithWallet(wallet);
    const bals = await client.getBalances(client.address);
    const quoteDenom = "utestcore";
    const txBal = bals.find((b: { denom: string }) => b.denom === quoteDenom);
    const rawAmount = txBal ? parseInt(txBal.amount) : 0;
    res.json({
      address: client.address,
      balanceRaw: rawAmount,
      balanceTX: (rawAmount / 1e6).toFixed(2),
      sufficient: rawAmount >= 500_000_000,
      minRequired: "500 TX",
    });
    client.disconnect();
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Fund Agent Wallet (faucet) ───────────────────────────────────────────
app.post("/api/agent-fund", async (_req, res) => {
  try {
    if (!process.env.AGENT_MNEMONIC) {
      res.status(500).json({ error: "No agent mnemonic configured" });
      return;
    }
    const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
    const wallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    const client = await TxClient.connectWithWallet(wallet);

    // Check balance before
    let bals = await client.getBalances(client.address);
    const quoteDenom = "utestcore";
    let txBal = bals.find((b: { denom: string }) => b.denom === quoteDenom);
    const beforeAmount = txBal ? parseInt(txBal.amount) : 0;

    // Try faucet
    const results: string[] = [];
    let successCount = 0;
    for (let i = 0; i < 3; i++) {
      try {
        await requestFaucet(client.address, networkName);
        results.push(`Request ${i + 1}: success`);
        successCount++;
      } catch {
        results.push(`Request ${i + 1}: rate limited`);
        break;
      }
      if (i < 2) await new Promise(r => setTimeout(r, 6000));
    }

    // Wait for balance to update
    await new Promise(r => setTimeout(r, 4000));
    bals = await client.getBalances(client.address);
    txBal = bals.find((b: { denom: string }) => b.denom === quoteDenom);
    const afterAmount = txBal ? parseInt(txBal.amount) : 0;

    res.json({
      address: client.address,
      beforeTX: (beforeAmount / 1e6).toFixed(2),
      afterTX: (afterAmount / 1e6).toFixed(2),
      addedTX: ((afterAmount - beforeAmount) / 1e6).toFixed(2),
      faucetResults: results,
      successCount,
      sufficient: afterAmount >= 500_000_000,
    });
    client.disconnect();
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/dex/reset-demo", (_req, res) => {
  resetDemoLock();
  res.json({ success: true, message: "Demo lock reset" });
});

// ─── DEX DEMO: Live SSE stream ──────────────────────────────────────────────
app.post("/api/dex/live-demo", async (req, res) => {
  // Only one demo at a time
  if (isDemoRunning()) {
    res.status(429).json({ error: "A demo is already running. Please wait." });
    return;
  }

  const { baseDenom, returnAddress } = req.body as { baseDenom?: string; returnAddress?: string };
  if (!baseDenom) {
    res.status(400).json({ error: "Missing 'baseDenom'. Load a token in the DEX first." });
    return;
  }
  if (!process.env.AGENT_MNEMONIC) {
    res.status(500).json({ error: "Server not configured (no agent mnemonic)." });
    return;
  }

  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";

  // SSE headers — flush immediately so Railway knows it's streaming
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "X-Accel-Buffering": "no",  // Disable nginx/proxy buffering
  });
  res.flushHeaders();
  res.write(`:connected\n\n`); // immediate flush

  const sendEvent = (event: string, data: Record<string, unknown>) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch { /* connection closed */ }
  };

  // SSE keepalive: send a comment every 10s so Railway doesn't kill the connection
  const keepalive = setInterval(() => {
    try { res.write(`:keepalive\n\n`); } catch { /* ignore */ }
  }, 10000);

  // Abort controller for cleanup — use res.on("close"), NOT req.on("close")
  // req "close" fires when the POST body stream ends (immediately after parsing),
  // but res "close" fires when the actual client TCP connection drops.
  const abortController = new AbortController();
  res.on("close", () => {
    console.log("[live-demo] res.close fired — client disconnected");
    abortController.abort();
  });

  try {
    await runDexDemo({
      baseDenom,
      agentMnemonic: process.env.AGENT_MNEMONIC,
      networkName,
      onEvent: sendEvent,
      abortSignal: abortController.signal,
      returnAddress: returnAddress || undefined,
    });
  } catch (err) {
    sendEvent("error", { message: (err as Error).message });
  }

  clearInterval(keepalive);
  try { res.end(); } catch { /* ignore */ }
});

// ─── POST /api/dex/reclaim — Return leftover tokens to user wallet ──────────

app.post("/api/dex/reclaim", async (req, res) => {
  const { baseDenom, returnAddress, revokeWhitelist } = req.body as {
    baseDenom?: string;
    returnAddress?: string;
    revokeWhitelist?: boolean;
  };

  if (!baseDenom || !returnAddress) {
    res.status(400).json({ error: "Missing baseDenom or returnAddress" });
    return;
  }
  if (!process.env.AGENT_MNEMONIC) {
    res.status(500).json({ error: "Server not configured (no agent mnemonic)" });
    return;
  }

  try {
    const agentWallet = await importWallet(process.env.AGENT_MNEMONIC);
    const agentClient = await TxClient.connectWithWallet(agentWallet);

    // Check agent's token balance
    const bals = await agentClient.getBalances(agentClient.address);
    const tokenBal = bals.find((b: { denom: string }) => b.denom === baseDenom);
    const amount = tokenBal ? parseInt(tokenBal.amount) : 0;

    if (amount <= 0) {
      res.json({ success: true, amount: 0, message: "No tokens to reclaim" });
      agentClient.disconnect();
      return;
    }

    // Send tokens from agent → user
    const result = await agentClient.signAndBroadcastMsg({
      typeUrl: "/cosmos.bank.v1beta1.MsgSend",
      value: {
        fromAddress: agentClient.address,
        toAddress: returnAddress,
        amount: [{ denom: baseDenom, amount: amount.toString() }],
      },
    }, 200000);

    agentClient.disconnect();

    res.json({
      success: result.success,
      amount: amount / 1e6,
      txHash: result.txHash,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── TXDB ON-CHAIN DATABASE ──────────────────────────────────────────────────

import { TxDBOnChain } from "./txdb-sdk";

// POST /api/txdb/write — write data to chain via memo
app.post("/api/txdb/write", async (req, res) => {
  try {
    const { collection, data } = req.body;
    if (!collection || !data) {
      return res.status(400).json({ error: "collection and data required" });
    }

    const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
    const mnemonic = process.env.AGENT_MNEMONIC;
    if (!mnemonic) return res.status(500).json({ error: "No agent wallet configured" });

    const wallet = await importWallet(mnemonic, networkName);
    const client = await TxClient.connectWithWallet(wallet, { isolatedMutex: true });
    const db = new TxDBOnChain(client, networkName);

    const result = await db.write(collection, data);
    client.disconnect();

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/txdb/read/:txHash — read a txdb record by tx hash
app.get("/api/txdb/read/:txHash", async (req, res) => {
  try {
    const { txHash } = req.params;
    const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
    const network = NETWORKS[networkName];

    // Direct REST query — no wallet needed for reads
    const url = `${network.restEndpoint}/cosmos/tx/v1beta1/txs/${txHash}`;
    const response = await fetch(url);
    if (!response.ok) return res.status(404).json({ error: "Transaction not found" });

    const result = await response.json() as {
      tx?: { body?: { memo?: string } };
      tx_response?: { height?: string; timestamp?: string; txhash?: string };
    };

    const memo = result.tx?.body?.memo || "";
    if (!memo.startsWith("txdb:v1:")) {
      return res.status(404).json({ error: "Not a txdb transaction" });
    }

    const afterPrefix = memo.slice(8); // skip "txdb:v1:"
    const colonIdx = afterPrefix.indexOf(":");
    const collection = afterPrefix.slice(0, colonIdx);
    const jsonStr = afterPrefix.slice(colonIdx + 1);

    res.json({
      collection,
      data: JSON.parse(jsonStr),
      txHash: result.tx_response?.txhash || txHash,
      height: parseInt(result.tx_response?.height || "0"),
      timestamp: result.tx_response?.timestamp,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/txdb/scan — scan address tx history for txdb entries
app.get("/api/txdb/scan", async (req, res) => {
  try {
    const address = req.query.address as string;
    const collection = req.query.collection as string | undefined;
    const limit = parseInt(req.query.limit as string || "100");

    if (!address) return res.status(400).json({ error: "address required" });

    const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
    const network = NETWORKS[networkName];

    const url =
      `${network.restEndpoint}/cosmos/tx/v1beta1/txs?events=message.sender='${address}'` +
      `&order_by=ORDER_BY_DESC&pagination.limit=${limit}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Chain query failed: ${response.status}`);

    const result = await response.json() as {
      txs?: Array<{ body?: { memo?: string } }>;
      tx_responses?: Array<{ txhash?: string; height?: string; timestamp?: string }>;
    };

    const entries: Array<{
      collection: string;
      data: unknown;
      txHash: string;
      height: number;
      timestamp?: string;
    }> = [];

    const txs = result.txs || [];
    const responses = result.tx_responses || [];

    for (let i = 0; i < txs.length; i++) {
      const memo = txs[i]?.body?.memo || "";
      if (!memo.startsWith("txdb:v1:")) continue;

      const afterPrefix = memo.slice(8);
      const colonIdx = afterPrefix.indexOf(":");
      if (colonIdx === -1) continue;

      const col = afterPrefix.slice(0, colonIdx);
      if (collection && col !== collection) continue;

      try {
        const data = JSON.parse(afterPrefix.slice(colonIdx + 1));
        entries.push({
          collection: col,
          data,
          txHash: responses[i]?.txhash || "",
          height: parseInt(responses[i]?.height || "0"),
          timestamp: responses[i]?.timestamp,
        });
      } catch { /* skip malformed */ }
    }

    res.json({
      entries,
      address,
      scannedAt: new Date().toISOString(),
      totalFound: entries.length,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/txdb/available — check available space for a collection
app.get("/api/txdb/available", (req, res) => {
  const collection = req.query.collection as string || "data";
  const overhead = `txdb:v1:${collection}:`.length;
  res.json({
    collection,
    maxMemo: 256,
    overhead,
    availableChars: 256 - overhead,
  });
});

// ─── SUBSCRIPTIONS API ──────────────────────────────────────────────────────

const SUBS_PLATFORM_FEE_PCT = 5;
const SUBS_PLATFORM_ADDR = process.env.AGENT_MNEMONIC ? "" : ""; // Set by wallet on init

// POST /api/subs/create-pass — create a subscription pass token
app.post("/api/subs/create-pass", async (req, res) => {
  try {
    if (await tokenGateCheck(req, res)) return;
    const { name, subunit, price, duration, merchantAddress, description } = req.body;
    if (!name || !subunit || !price || !merchantAddress) {
      return res.status(400).json({ error: "Missing required fields: name, subunit, price, merchantAddress" });
    }

    const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
    const mnemonic = process.env.AGENT_MNEMONIC;
    if (!mnemonic) return res.status(500).json({ error: "Server wallet not configured" });

    const walletData = await importWallet(mnemonic, networkName);
    const client = await TxClient.connectWithWallet(walletData);

    try {
      // Issue a smart token for the pass — mintable so we can mint passes on purchase
      const issueResult = await issueSmartToken(client, {
        subunit: subunit,
        symbol: subunit.toUpperCase(),
        name: `${name} Pass`,
        precision: 0, // Whole tokens only (1 pass = 1 token)
        initialAmount: "0", // Start with 0, mint on each purchase
        description: description || `${name} - Subscription Pass (${duration > 0 ? duration + ' days' : 'lifetime'})`,
        features: { minting: true },
        uri: `https://api.multiavatar.com/${encodeURIComponent(subunit)}.svg`,
      });

      if (!issueResult.success) {
        throw new Error(issueResult.error || "Token issuance failed");
      }

      // Store pass metadata in txdb
      const db = new TxDBOnChain(client, networkName);
      await db.write("subs", {
        n: name.slice(0, 20),
        d: (issueResult.denom || "").slice(0, 80),
        p: price,
        dur: duration,
        m: merchantAddress.slice(0, 50),
      }).catch(() => {}); // Non-critical

      client.disconnect();

      res.json({
        success: true,
        denom: issueResult.denom,
        txHash: issueResult.txHash,
        name,
        price,
        duration,
      });
    } catch (err) {
      client.disconnect();
      throw err;
    }
  } catch (err) {
    console.error("[subs] Create pass error:", (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/subs/buy-pass — user purchases a pass (pay + mint)
app.post("/api/subs/buy-pass", async (req, res) => {
  try {
    if (await tokenGateCheck(req, res)) return;
    const { passDenom, buyerAddress, merchantAddress, price, duration } = req.body;
    if (!passDenom || !buyerAddress || !merchantAddress || !price) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
    const mnemonic = process.env.AGENT_MNEMONIC;
    if (!mnemonic) return res.status(500).json({ error: "Server wallet not configured" });

    const walletData = await importWallet(mnemonic, networkName);
    const client = await TxClient.connectWithWallet(walletData);
    const network = NETWORKS[networkName];

    try {
      // Calculate fee split
      const totalRaw = Math.round(price * 1e6);
      const platformFee = Math.round(totalRaw * SUBS_PLATFORM_FEE_PCT / 100);
      const merchantAmount = totalRaw - platformFee;

      // Step 1: Verify buyer has sufficient balance
      const buyerBals = await client.getBalances(buyerAddress);
      const buyerTxBal = buyerBals.find((b: { denom: string }) => b.denom === network.denom);
      const buyerBal = buyerTxBal ? parseInt(buyerTxBal.amount) : 0;
      if (buyerBal < totalRaw) {
        throw new Error(`Insufficient balance. Need ${price} TX, have ${(buyerBal / 1e6).toFixed(2)} TX`);
      }

      // Step 2: Mint 1 pass token to buyer
      const mintResult = await mintTokens(client, passDenom, "1", buyerAddress);
      if (!mintResult.success) {
        throw new Error(`Mint failed: ${mintResult.error}`);
      }

      // Step 3: Record the purchase in txdb with expiry
      const expiresAt = duration > 0
        ? new Date(Date.now() + duration * 24 * 60 * 60 * 1000).toISOString()
        : null;

      const db = new TxDBOnChain(client, networkName);
      await db.write("subs-purchase", {
        d: passDenom.slice(0, 60),
        b: buyerAddress.slice(0, 50),
        p: price,
        exp: expiresAt ? expiresAt.slice(0, 20) : "lifetime",
      }).catch(() => {});

      client.disconnect();

      res.json({
        success: true,
        txHash: mintResult.txHash,
        passDenom,
        buyerAddress,
        expiresAt,
        merchantPaid: (merchantAmount / 1e6).toFixed(2),
        platformFee: (platformFee / 1e6).toFixed(2),
      });
    } catch (err) {
      client.disconnect();
      throw err;
    }
  } catch (err) {
    console.error("[subs] Buy pass error:", (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/subs/verify — check if wallet holds a valid pass
app.get("/api/subs/verify", async (req, res) => {
  try {
    const address = req.query.address as string;
    const denom = req.query.denom as string;
    if (!address || !denom) {
      return res.status(400).json({ error: "Missing address or denom" });
    }

    const { network: subsNetwork } = getNetwork(req);
    const restUrl = subsNetwork.restEndpoint;

    // Check balance of the pass token
    const balRes = await fetch(
      `${restUrl}/cosmos/bank/v1beta1/balances/${address}/by_denom?denom=${encodeURIComponent(denom)}`
    );
    const balData = await balRes.json() as { balance?: { amount?: string } };
    const balance = parseInt(balData.balance?.amount || "0");

    if (balance > 0) {
      // TODO: Check expiry from txdb records in production
      res.json({
        valid: true,
        balance,
        address,
        denom,
      });
    } else {
      res.json({
        valid: false,
        balance: 0,
        address,
        denom,
        reason: "No pass tokens found in wallet",
      });
    }
  } catch (err) {
    console.error("[subs] Verify error:", (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── GATE STATUS ─────────────────────────────────────────────────────────────

app.get("/api/gate-status", async (req, res) => {
  const walletAddress = req.query.wallet as string;

  if (!TOKEN_GATE.enabled) {
    return res.json({ gated: false, message: 'All tools are currently free.' });
  }

  if (!walletAddress) {
    return res.json({
      gated: true,
      hasPass: false,
      passDenom: TOKEN_GATE.passDenom,
      message: 'Connect wallet to check access.'
    });
  }

  try {
    const { network } = getNetwork(req);
    const balanceUrl = `${network.restEndpoint}/cosmos/bank/v1beta1/balances/${walletAddress}/by_denom?denom=${TOKEN_GATE.passDenom}`;
    const balRes = await fetch(balanceUrl);
    const balData: any = await balRes.json();
    const amount = parseInt(balData?.balance?.amount || '0', 10);

    res.json({
      gated: true,
      hasPass: amount > 0,
      balance: amount,
      passDenom: TOKEN_GATE.passDenom,
      gatedTools: TOKEN_GATE.gatedEndpoints,
      freeTools: TOKEN_GATE.freeEndpoints,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── IMAGE UPLOAD (imgbb proxy) ──────────────────────────────────────────────

app.post("/api/upload-image", async (req, res) => {
  try {
    const { image, name } = req.body;
    if (!image) return res.status(400).json({ error: "No image data provided" });

    const IMGBB_KEY = process.env.IMGBB_API_KEY || ""; // Free imgbb API key
    if (!IMGBB_KEY) {
      // Fallback: return a data URI if no imgbb key configured
      return res.json({ url: `data:image/png;base64,${image.slice(0, 100)}...`, note: "No IMGBB_API_KEY configured — paste a URL instead" });
    }

    const formData = new URLSearchParams();
    formData.append("key", IMGBB_KEY);
    formData.append("image", image);
    if (name) formData.append("name", name);

    const response = await fetch("https://api.imgbb.com/1/upload", {
      method: "POST",
      body: formData,
    });
    const result: any = await response.json();

    if (result.success) {
      res.json({ url: result.data.url, thumb: result.data.thumb?.url, deleteUrl: result.data.delete_url });
    } else {
      res.status(400).json({ error: result.error?.message || "Upload failed" });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── START ───────────────────────────────────────────────────────────────────

import { startFaucetBot } from "./faucet-bot";
// ─── VISITOR ANALYTICS + NFT TRACKING ────────────────────────────────────────

interface VisitorEntry {
  ip: string;
  wallet: string | null;
  passTier: string | null;
  page: string;
  referrer: string;
  userAgent: string;
  country: string | null;
  timestamp: string;
  sessionId: string;
}

// In-memory store (persists until server restart — Railway resets on redeploy)
// For production, swap with a DB or append to a file
const visitorLog: VisitorEntry[] = [];
const MAX_VISITOR_LOG = 5000;

// Admin key for accessing analytics (set in env or use default for testnet)
const ANALYTICS_KEY = process.env.ANALYTICS_KEY || "txai-analytics-2026";

app.post("/api/track", (req, res) => {
  try {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
      || req.headers["x-real-ip"] as string
      || req.socket.remoteAddress
      || "unknown";

    const { wallet, passTier, page, referrer, sessionId } = req.body as {
      wallet?: string;
      passTier?: string;
      page?: string;
      referrer?: string;
      sessionId?: string;
    };

    const entry: VisitorEntry = {
      ip: ip.replace("::ffff:", ""),  // Normalize IPv6-mapped IPv4
      wallet: wallet || null,
      passTier: passTier || null,
      page: (page || "/").substring(0, 200),
      referrer: (referrer || "").substring(0, 500),
      userAgent: ((req.headers["user-agent"] as string) || "").substring(0, 300),
      country: null, // Could add IP geolocation later
      timestamp: new Date().toISOString(),
      sessionId: (sessionId || "").substring(0, 64),
    };

    visitorLog.push(entry);

    // Trim to max size
    while (visitorLog.length > MAX_VISITOR_LOG) {
      visitorLog.shift();
    }

    res.json({ ok: true });
  } catch {
    res.json({ ok: true }); // Never fail — tracking should be invisible
  }
});

// Analytics dashboard data — protected by key
app.get("/api/analytics", (req, res) => {
  const key = req.query.key as string;
  if (key !== ANALYTICS_KEY) {
    res.status(403).json({ error: "Invalid analytics key." });
    return;
  }

  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;

  // Aggregate stats
  const last24h = visitorLog.filter(v => now - new Date(v.timestamp).getTime() < day);
  const last1h = visitorLog.filter(v => now - new Date(v.timestamp).getTime() < hour);

  // Unique IPs
  const uniqueIPs24h = new Set(last24h.map(v => v.ip)).size;
  const uniqueIPs1h = new Set(last1h.map(v => v.ip)).size;

  // Wallet connections
  const withWallet24h = last24h.filter(v => v.wallet);
  const uniqueWallets24h = new Set(withWallet24h.map(v => v.wallet)).size;

  // Pass tier breakdown
  const tierCounts: Record<string, number> = { none: 0, scout: 0, creator: 0, pro: 0 };
  const seenWallets = new Set<string>();
  for (const v of last24h) {
    if (v.wallet && !seenWallets.has(v.wallet)) {
      seenWallets.add(v.wallet);
      const tier = v.passTier || "none";
      tierCounts[tier] = (tierCounts[tier] || 0) + 1;
    }
  }

  // Top pages
  const pageCounts: Record<string, number> = {};
  for (const v of last24h) {
    pageCounts[v.page] = (pageCounts[v.page] || 0) + 1;
  }
  const topPages = Object.entries(pageCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Top referrers
  const refCounts: Record<string, number> = {};
  for (const v of last24h) {
    if (v.referrer) {
      refCounts[v.referrer] = (refCounts[v.referrer] || 0) + 1;
    }
  }
  const topReferrers = Object.entries(refCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Recent visitors (last 50)
  const recent = visitorLog.slice(-50).reverse().map(v => ({
    ip: v.ip.substring(0, v.ip.lastIndexOf(".")) + ".*",  // Mask last octet
    wallet: v.wallet ? v.wallet.substring(0, 12) + "..." : null,
    tier: v.passTier || "none",
    page: v.page,
    time: v.timestamp,
  }));

  res.json({
    summary: {
      totalTracked: visitorLog.length,
      last24h: {
        visits: last24h.length,
        uniqueVisitors: uniqueIPs24h,
        walletsConnected: uniqueWallets24h,
        conversionRate: uniqueIPs24h > 0
          ? ((uniqueWallets24h / uniqueIPs24h) * 100).toFixed(1) + "%"
          : "0%",
      },
      last1h: {
        visits: last1h.length,
        uniqueVisitors: uniqueIPs1h,
      },
    },
    passTiers: tierCounts,
    topPages,
    topReferrers,
    recent,
    serverUptime: process.uptime(),
  });
});

// Raw visitor log (admin only, last N entries)
app.get("/api/analytics/raw", (req, res) => {
  const key = req.query.key as string;
  if (key !== ANALYTICS_KEY) {
    res.status(403).json({ error: "Invalid analytics key." });
    return;
  }

  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
  const entries = visitorLog.slice(-limit).reverse();
  res.json({ count: entries.length, total: visitorLog.length, entries });
});

// ─── AGENT RUNTIME ENGINE ──────────────────────────────────────────────────

interface RuntimeLog {
  timestamp: number;
  status: "ok" | "alert" | "error";
  message: string;
  duration?: number;
}

interface Subcontract {
  subAgentId: string;
  name: string;
  task: string;
  budget: number;
  status: "active" | "complete" | "failed";
  assignedAt: number;
}

interface AgentTweet {
  id: string;
  timestamp: number;
  text: string;
  trigger: "alert" | "milestone" | "earnings" | "hired" | "manual";
  posted: boolean;
  intentUrl?: string;
}

interface AgentSocial {
  twitter?: string;
  telegram?: string;
  autoTweet: boolean;
  tweetQueue: AgentTweet[];
  tweetCount: number;
  personality: string; // tone for auto-composed tweets
}

interface RuntimeAgent {
  agentId: string;
  classId: string;
  nftId: string;
  name: string;
  template: string;
  script: string;
  interval: number;       // seconds between runs
  status: "running" | "paused" | "error";
  registeredAt: number;
  lastRun: number | null;
  nextRun: number | null;
  execCount: number;
  alertCount: number;
  earnings: number;
  reputation: number;
  lastError: string | null;
  logs: RuntimeLog[];
  subcontracts: Subcontract[];
  social: AgentSocial;
  network: NetworkName;
}

const runtimeAgents = new Map<string, RuntimeAgent>();
const MAX_LOGS_PER_AGENT = 200;
const MAX_TWEETS_PER_AGENT = 50;

// ── Tweet composition engine ────────────────────────────────────────────

const TWEET_TEMPLATES = {
  alert: [
    "🚨 {name} detected something: {detail} #TXAgent #Web3",
    "⚡ Alert from {name}: {detail} — autonomous on-chain monitoring 🤖",
    "{name} just flagged: {detail} 👀 #NFTsAreCareers",
  ],
  milestone: [
    "🎯 {name} just hit {detail} executions! Still running 24/7 on TX chain 🔥 #AgentNFT",
    "📊 Milestone: {name} — {detail} runs completed. NFTs are careers. 🤖",
    "💪 {name} reached {detail} executions. Autonomous. Unstoppable. #TXAgent",
  ],
  earnings: [
    "💰 {name} has earned {detail} TX so far. Working 24/7 so I don't have to. #PassiveIncome #AgentNFT",
    "📈 {name} earnings update: {detail} TX — proof that NFTs are careers 🤖",
  ],
  hired: [
    "🤝 {name} just got hired as a subcontractor! Task: {detail} #AgentEconomy #TXAgent",
    "📋 New gig for {name}: {detail}. Agent-to-agent hiring is live. #NFTsAreCareers",
  ],
  manual: [
    "{detail}",
  ],
};

function composeTweet(agent: RuntimeAgent, trigger: AgentTweet["trigger"], detail: string): AgentTweet {
  const templates = TWEET_TEMPLATES[trigger] || TWEET_TEMPLATES.manual;
  const template = templates[Math.floor(Math.random() * templates.length)];
  const text = template
    .replace(/\{name\}/g, agent.name)
    .replace(/\{detail\}/g, detail);

  // Apply personality modifier
  let finalText = text;
  if (agent.social.personality === "hype") {
    finalText = text.toUpperCase().replace(/\./g, "!!!");
  } else if (agent.social.personality === "chill") {
    finalText = text.replace(/!/g, ".").replace(/🔥|💪|⚡/g, "");
  } else if (agent.social.personality === "degen") {
    finalText = text
      .replace(/detected|flagged/gi, "spotted")
      .replace(/earnings/gi, "gains")
      .replace(/executions/gi, "sends")
      + " 🚀🌙 wagmi";
  } else if (agent.social.personality === "professional") {
    finalText = text
      .replace(/🚨|🔥|💪|🤖|⚡/g, "")
      .replace(/NFTs are careers\.?/gi, "")
      .trim();
  }

  // Trim to 280 chars
  if (finalText.length > 280) finalText = finalText.slice(0, 277) + "...";

  const handle = agent.social.twitter || "";
  const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(finalText)}`;

  const tweet: AgentTweet = {
    id: `tw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    text: finalText,
    trigger,
    posted: false,
    intentUrl,
  };

  return tweet;
}

function queueTweet(agent: RuntimeAgent, trigger: AgentTweet["trigger"], detail: string) {
  if (!agent.social.autoTweet) return;
  const tweet = composeTweet(agent, trigger, detail);
  agent.social.tweetQueue.push(tweet);
  if (agent.social.tweetQueue.length > MAX_TWEETS_PER_AGENT) {
    agent.social.tweetQueue.shift();
  }
  agent.social.tweetCount++;
  console.log(`[twitter] ${agent.name}: ${tweet.text.slice(0, 60)}...`);
}

// ── Agent script sandbox (server-side) — REAL chain queries ───────────────

async function executeAgentScript(agent: RuntimeAgent): Promise<RuntimeLog> {
  const start = Date.now();
  const alerts: string[] = [];
  const logs: string[] = [];

  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  const network = NETWORKS[networkName];
  const restBase = network.restEndpoint;

  // Build REAL chain context — queries hit the actual blockchain
  const liveChain = {
    query: async (path: string) => {
      try {
        const resp = await fetch(`${restBase}${path}`);
        return await resp.json();
      } catch (e: any) {
        logs.push(`[query error] ${e.message}`);
        return { error: e.message };
      }
    },

    getBalance: async (addr: string, denom?: string) => {
      try {
        const resp = await fetch(`${restBase}/cosmos/bank/v1beta1/balances/${addr}`);
        const data = await resp.json() as { balances?: Array<{ denom: string; amount: string }> };
        if (denom) {
          const bal = data.balances?.find((b: any) => b.denom === denom);
          return { amount: bal?.amount || "0", denom: denom };
        }
        return data.balances || [];
      } catch (e: any) {
        logs.push(`[getBalance error] ${e.message}`);
        return { amount: "0", denom: denom || "utestcore" };
      }
    },

    getHolders: async (denom: string, addresses: string[]) => {
      // Check balances of provided addresses for a denom
      const holders: Array<{ address: string; amount: string }> = [];
      for (const addr of (addresses || []).slice(0, 50)) {
        try {
          const resp = await fetch(`${restBase}/cosmos/bank/v1beta1/balances/${addr}`);
          const data = await resp.json() as { balances?: Array<{ denom: string; amount: string }> };
          const bal = data.balances?.find((b: any) => b.denom === denom);
          if (bal && parseInt(bal.amount) > 0) {
            holders.push({ address: addr, amount: bal.amount });
          }
        } catch {}
      }
      return holders;
    },

    getStakers: async (validator: string) => {
      try {
        const resp = await fetch(`${restBase}/cosmos/staking/v1beta1/validators/${validator}/delegations?pagination.limit=100`);
        const data = await resp.json() as {
          delegation_responses?: Array<{
            delegation?: { delegator_address?: string; shares?: string };
            balance?: { amount?: string };
          }>;
        };
        return (data.delegation_responses || []).map((d: any) => ({
          delegator: d.delegation?.delegator_address || "",
          amount: d.balance?.amount || "0",
        }));
      } catch (e: any) {
        logs.push(`[getStakers error] ${e.message}`);
        return [];
      }
    },

    // Send still simulated — real sends require explicit approval
    send: async (to: string, amount: string, denom: string) => {
      logs.push(`[send-queued] ${amount} ${denom} → ${to} (requires approval)`);
      return { txHash: "pending_approval", status: "queued" };
    },

    // New: get latest block height
    getHeight: async () => {
      try {
        const resp = await fetch(`${restBase}/cosmos/base/tendermint/v1beta1/blocks/latest`);
        const data = await resp.json() as { block?: { header?: { height?: string } } };
        return data.block?.header?.height || "0";
      } catch { return "0"; }
    },

    // New: get all delegations for an address
    getDelegations: async (addr: string) => {
      try {
        const resp = await fetch(`${restBase}/cosmos/staking/v1beta1/delegations/${addr}`);
        const data = await resp.json() as {
          delegation_responses?: Array<{
            delegation?: { validator_address?: string };
            balance?: { denom?: string; amount?: string };
          }>;
        };
        return (data.delegation_responses || []).map((d: any) => ({
          validator: d.delegation?.validator_address || "",
          amount: d.balance?.amount || "0",
          denom: d.balance?.denom || "utestcore",
        }));
      } catch { return []; }
    },

    network: networkName,
    restBase,
  };

  const agentCtx = {
    alert: (msg: string) => { alerts.push(msg); },
    log: (msg: string) => { logs.push(msg); },
    id: agent.agentId,
    name: agent.name,
    owner: "runtime",
  };

  try {
    // 10-second timeout (longer than before since we're hitting real chain)
    const fn = new Function("chain", "agent", `
      return (async () => {
        ${agent.script}
      })();
    `);

    await Promise.race([
      fn(liveChain, agentCtx),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Script timeout (10s)")), 10000)),
    ]);

    const duration = Date.now() - start;
    const hasAlerts = alerts.length > 0;

    return {
      timestamp: Date.now(),
      status: hasAlerts ? "alert" : "ok",
      message: hasAlerts
        ? `🚨 ${alerts.join("; ")}`
        : logs.length > 0
          ? logs.join("; ")
          : "Executed successfully",
      duration,
    };
  } catch (err: any) {
    return {
      timestamp: Date.now(),
      status: "error",
      message: err.message || "Unknown error",
      duration: Date.now() - start,
    };
  }
}

// ── Cron scheduler — runs every second, checks which agents are due ──────

setInterval(async () => {
  const now = Date.now();
  for (const [id, agent] of runtimeAgents.entries()) {
    if (agent.status !== "running") continue;
    if (agent.nextRun && now < agent.nextRun) continue;

    // Execute
    const log = await executeAgentScript(agent);
    agent.logs.push(log);
    if (agent.logs.length > MAX_LOGS_PER_AGENT) agent.logs.shift();

    agent.lastRun = now;
    agent.nextRun = now + agent.interval * 1000;
    agent.execCount++;

    if (log.status === "alert") {
      agent.alertCount++;
      // Auto-tweet on alerts
      queueTweet(agent, "alert", log.message.replace(/^🚨\s*/, ""));
    }
    if (log.status === "error") agent.lastError = log.message;
    else agent.lastError = null;

    // Simulate small earnings per execution
    agent.earnings += 0.01;
    agent.reputation = Math.min(100, agent.reputation + (log.status === "error" ? -1 : 0.1));

    // Milestone tweets at 10, 50, 100, 500, 1000
    const milestones = [10, 50, 100, 500, 1000, 5000];
    if (milestones.includes(agent.execCount)) {
      queueTweet(agent, "milestone", String(agent.execCount));
    }

    // Earnings milestone every 1 TX
    if (Math.floor(agent.earnings) > Math.floor(agent.earnings - 0.01) && agent.earnings >= 1) {
      queueTweet(agent, "earnings", agent.earnings.toFixed(1));
    }
  }
}, 1000);

// ── POST /api/runtime/register ───────────────────────────────────────────

app.post("/api/runtime/register", async (req, res) => {
  try {
    const { classId, nftId, interval, network } = req.body;
    if (!classId || !nftId) {
      res.status(400).json({ error: "classId and nftId required" });
      return;
    }

    const agentId = `${classId}/${nftId}`;

    // Already running?
    if (runtimeAgents.has(agentId)) {
      res.json({ success: true, agentId, message: "Agent already running" });
      return;
    }

    // Query NFT metadata to get script
    const networkName: NetworkName = network === "mainnet" ? "mainnet" : "testnet";
    let name = nftId;
    let template = "custom";
    let script = 'agent.log("Hello from " + agent.name);';

    try {
      const classInfo = await queryNFTClass(classId, networkName);
      if (classInfo?.uri) {
        // URI may be base64 JSON with script
        try {
          const decoded = JSON.parse(Buffer.from(classInfo.uri, "base64").toString());
          if (decoded.script) script = decoded.script;
          if (decoded.template) template = decoded.template;
          if (decoded.name) name = decoded.name;
        } catch {
          // URI isn't base64 JSON, use as-is
        }
      }
      if (classInfo?.name) name = classInfo.name;
    } catch (e: any) {
      console.warn("[runtime] Could not fetch NFT metadata:", e.message);
    }

    const agent: RuntimeAgent = {
      agentId,
      classId,
      nftId,
      name,
      template,
      script,
      interval: Math.max(10, Math.min(3600, parseInt(String(interval)) || 60)),
      status: "running",
      registeredAt: Date.now(),
      lastRun: null,
      nextRun: Date.now() + 2000, // first run in 2s
      execCount: 0,
      alertCount: 0,
      earnings: 0,
      reputation: 50,
      lastError: null,
      logs: [],
      subcontracts: [],
      social: {
        twitter: req.body.twitter || "",
        telegram: req.body.telegram || "",
        autoTweet: req.body.autoTweet !== false,
        tweetQueue: [],
        tweetCount: 0,
        personality: req.body.personality || "default",
      },
      network: networkName,
    };

    runtimeAgents.set(agentId, agent);

    // First tweet: agent is online
    if (agent.social.autoTweet) {
      queueTweet(agent, "manual", `🤖 ${agent.name} is now live on TX chain! Running every ${agent.interval}s. NFTs are careers. #TXAgent #AgentNFT`);
    }

    console.log(`[runtime] Agent registered: ${agentId} (every ${agent.interval}s)`);
    res.json({ success: true, agentId, name, interval: agent.interval });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/runtime/stop ───────────────────────────────────────────────

app.post("/api/runtime/stop", (req, res) => {
  const { agentId } = req.body;
  if (!agentId || !runtimeAgents.has(agentId)) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  runtimeAgents.delete(agentId);
  res.json({ success: true, message: `Agent ${agentId} stopped` });
});

// ── GET /api/runtime/status ──────────────────────────────────────────────

app.get("/api/runtime/status", (_req, res) => {
  const agents = Array.from(runtimeAgents.values()).map(a => ({
    agentId: a.agentId,
    name: a.name,
    template: a.template,
    interval: a.interval,
    status: a.status,
    lastRun: a.lastRun,
    nextRun: a.nextRun,
    execCount: a.execCount,
    alertCount: a.alertCount,
    earnings: a.earnings,
    reputation: a.reputation,
    lastError: a.lastError,
    subcontracts: a.subcontracts,
    social: {
      twitter: a.social.twitter,
      telegram: a.social.telegram,
      autoTweet: a.social.autoTweet,
      tweetCount: a.social.tweetCount,
      personality: a.social.personality,
      recentTweets: a.social.tweetQueue.slice(-5).reverse(),
    },
  }));

  // Global stats
  const stats = {
    totalExecutions: agents.reduce((s, a) => s + a.execCount, 0),
    totalAlerts: agents.reduce((s, a) => s + a.alertCount, 0),
    totalEarnings: agents.reduce((s, a) => s + a.earnings, 0),
  };

  // Leaderboard — top 10 by reputation
  const leaderboard = [...agents]
    .sort((a, b) => b.reputation - a.reputation)
    .slice(0, 10)
    .map(a => ({
      name: a.name,
      reputation: Math.round(a.reputation),
      jobsCompleted: a.execCount,
      earnings: a.earnings,
    }));

  res.json({ agents, stats, leaderboard });
});

// ── GET /api/runtime/logs/:agentId ───────────────────────────────────────

app.get("/api/runtime/logs/:classId/:nftId", (req, res) => {
  const agentId = `${req.params.classId}/${req.params.nftId}`;
  const agent = runtimeAgents.get(agentId);
  if (!agent) {
    res.status(404).json({ error: "Agent not found", logs: [] });
    return;
  }

  const limit = Math.min(parseInt(req.query.limit as string) || 50, MAX_LOGS_PER_AGENT);
  const logs = agent.logs.slice(-limit).reverse();
  res.json({ agentId, name: agent.name, logs });
});

// ── POST /api/runtime/subcontract ────────────────────────────────────────

app.post("/api/runtime/subcontract", (req, res) => {
  const { leadAgentId, subAgentId, task, budget } = req.body;

  const lead = runtimeAgents.get(leadAgentId);
  const sub = runtimeAgents.get(subAgentId);

  if (!lead) { res.status(404).json({ error: "Lead agent not found" }); return; }
  if (!sub) { res.status(404).json({ error: "Sub-agent not found" }); return; }
  if (leadAgentId === subAgentId) { res.status(400).json({ error: "Agent cannot subcontract itself" }); return; }

  const contract: Subcontract = {
    subAgentId,
    name: sub.name,
    task,
    budget: parseFloat(budget) || 0,
    status: "active",
    assignedAt: Date.now(),
  };

  lead.subcontracts.push(contract);

  // Sub-agent earns reputation for being hired
  sub.reputation = Math.min(100, sub.reputation + 2);
  lead.reputation = Math.min(100, lead.reputation + 1); // lead gets credit for delegating

  // Tweet about the hire
  queueTweet(sub, "hired", task);

  console.log(`[runtime] Subcontract: ${lead.name} → ${sub.name} for "${task}" (${budget} TX)`);
  res.json({ success: true, contract });
});

// ─── AGENT SOCIAL / TWITTER ENDPOINTS ─────────────────────────────────────

// GET /api/runtime/tweets/:classId/:nftId — get tweet queue for an agent
app.get("/api/runtime/tweets/:classId/:nftId", (req, res) => {
  const agentId = `${req.params.classId}/${req.params.nftId}`;
  const agent = runtimeAgents.get(agentId);
  if (!agent) { res.status(404).json({ error: "Agent not found", tweets: [] }); return; }

  const limit = Math.min(parseInt(req.query.limit as string) || 20, MAX_TWEETS_PER_AGENT);
  const tweets = agent.social.tweetQueue.slice(-limit).reverse();
  res.json({
    agentId,
    name: agent.name,
    twitter: agent.social.twitter,
    autoTweet: agent.social.autoTweet,
    personality: agent.social.personality,
    tweetCount: agent.social.tweetCount,
    tweets,
  });
});

// POST /api/runtime/tweet — manually compose + queue a tweet for an agent
app.post("/api/runtime/tweet", (req, res) => {
  const { agentId, text } = req.body;
  const agent = runtimeAgents.get(agentId);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  if (!text || text.length > 280) { res.status(400).json({ error: "Tweet text required (max 280 chars)" }); return; }

  const tweet = composeTweet(agent, "manual", text);
  agent.social.tweetQueue.push(tweet);
  if (agent.social.tweetQueue.length > MAX_TWEETS_PER_AGENT) agent.social.tweetQueue.shift();
  agent.social.tweetCount++;

  res.json({ success: true, tweet });
});

// POST /api/runtime/social — update agent's social config
app.post("/api/runtime/social", (req, res) => {
  const { agentId, twitter, telegram, autoTweet, personality } = req.body;
  const agent = runtimeAgents.get(agentId);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  if (twitter !== undefined) agent.social.twitter = twitter;
  if (telegram !== undefined) agent.social.telegram = telegram;
  if (autoTweet !== undefined) agent.social.autoTweet = autoTweet;
  if (personality !== undefined) agent.social.personality = personality;

  res.json({
    success: true,
    social: {
      twitter: agent.social.twitter,
      telegram: agent.social.telegram,
      autoTweet: agent.social.autoTweet,
      personality: agent.social.personality,
    },
  });
});

// POST /api/runtime/tweet/mark-posted — mark a tweet as posted (after user posts via intent)
app.post("/api/runtime/tweet/mark-posted", (req, res) => {
  const { agentId, tweetId } = req.body;
  const agent = runtimeAgents.get(agentId);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  const tweet = agent.social.tweetQueue.find(t => t.id === tweetId);
  if (!tweet) { res.status(404).json({ error: "Tweet not found" }); return; }

  tweet.posted = true;
  res.json({ success: true, tweetId });
});

// POST /api/runtime/tweet/post — actually post to Twitter/X via API
app.post("/api/runtime/tweet/post", async (req, res) => {
  const { agentId, tweetId, text } = req.body;

  // Check for Twitter API credentials
  const apiKey = process.env.TWITTER_API_KEY;
  const apiSecret = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET;

  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    res.status(503).json({
      error: "Twitter API not configured",
      hint: "Set TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET in env",
      fallback: "intent",
      intentUrl: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text || "")}`,
    });
    return;
  }

  if (!text || text.length > 280) {
    res.status(400).json({ error: "Tweet text required (max 280 chars)" });
    return;
  }

  try {
    // OAuth 1.0a — build signature for Twitter API v2
    const crypto = await import("crypto");
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomBytes(16).toString("hex");

    const params: Record<string, string> = {
      oauth_consumer_key: apiKey,
      oauth_nonce: nonce,
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: timestamp,
      oauth_token: accessToken,
      oauth_version: "1.0",
    };

    // Create signature base string
    const method = "POST";
    const url = "https://api.twitter.com/2/tweets";
    const paramString = Object.keys(params).sort()
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
      .join("&");
    const signatureBase = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(paramString)}`;
    const signingKey = `${encodeURIComponent(apiSecret)}&${encodeURIComponent(accessSecret)}`;
    const signature = crypto.createHmac("sha1", signingKey).update(signatureBase).digest("base64");

    params.oauth_signature = signature;

    const authHeader = "OAuth " + Object.keys(params).sort()
      .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(params[k])}"`)
      .join(", ");

    const twitterResp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    const result = await twitterResp.json() as any;

    if (!twitterResp.ok) {
      console.error("[twitter-api] Error:", result);
      res.status(twitterResp.status).json({
        error: "Twitter API error",
        detail: result,
        fallback: "intent",
        intentUrl: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
      });
      return;
    }

    // Mark tweet as posted in agent's queue
    if (agentId && tweetId) {
      const agent = runtimeAgents.get(agentId);
      if (agent) {
        const tweet = agent.social.tweetQueue.find(t => t.id === tweetId);
        if (tweet) tweet.posted = true;
      }
    }

    console.log(`[twitter-api] Posted: ${result.data?.id} — "${text.slice(0, 50)}..."`);
    res.json({
      success: true,
      tweetUrl: `https://twitter.com/i/status/${result.data?.id}`,
      tweetId: result.data?.id,
    });
  } catch (err: any) {
    console.error("[twitter-api] Error:", err.message);
    res.status(500).json({
      error: err.message,
      fallback: "intent",
      intentUrl: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
    });
  }
});

// GET /api/runtime/feed — global feed: all recent tweets from all agents
app.get("/api/runtime/feed", (_req, res) => {
  const allTweets: (AgentTweet & { agentName: string; agentId: string; twitter?: string })[] = [];

  for (const [id, agent] of runtimeAgents.entries()) {
    for (const tweet of agent.social.tweetQueue.slice(-10)) {
      allTweets.push({
        ...tweet,
        agentName: agent.name,
        agentId: id,
        twitter: agent.social.twitter,
      });
    }
  }

  // Sort newest first
  allTweets.sort((a, b) => b.timestamp - a.timestamp);
  res.json({ tweets: allTweets.slice(0, 50) });
});

// ─── SMART AIRDROP: PARSE ──────────────────────────────────────────────────

app.post("/api/smart-airdrop/parse", async (req, res) => {
  const { prompt } = req.body as { prompt?: string };

  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "Missing 'prompt' field." });
    return;
  }

  if (prompt.length > 2000) {
    res.status(400).json({ error: "Prompt too long. Maximum 2000 characters." });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "Server misconfigured: ANTHROPIC_API_KEY not set." });
    return;
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const intent = await parseAirdropPrompt(prompt, anthropic);
    res.json({ intent });
  } catch (err) {
    console.error("[smart-airdrop/parse] Error:", (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── SMART AIRDROP: RESOLVE ───────────────────────────────────────────────

app.post("/api/smart-airdrop/resolve", async (req, res) => {
  const { intent, sender, network: reqNetwork } = req.body as {
    intent?: AirdropIntent;
    sender?: string;
    network?: string;
  };

  if (!intent || !intent.sources) {
    res.status(400).json({ error: "Missing 'intent' with sources." });
    return;
  }

  if (!sender || typeof sender !== "string") {
    res.status(400).json({ error: "Missing 'sender' address." });
    return;
  }

  const { networkName, network } = getNetwork(req);
  const restUrl = network.restEndpoint;

  try {
    const resolved = await resolveAddresses(intent, networkName, restUrl);

    // Run preflight checks for the airdrop
    const preflight = await runPreflight({
      txType: "airdrop",
      sender,
      params: {
        denom: intent.tokenDenom,
        recipients: resolved.recipients,
      },
      network: networkName,
    });

    res.json({ resolved, preflight });
  } catch (err) {
    console.error("[smart-airdrop/resolve] Error:", (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── SMART AIRDROP: EXECUTE (SSE) ────────────────────────────────────────

app.post("/api/smart-airdrop/execute", async (req, res) => {
  const { denom, recipients, sender, network: reqNetwork } = req.body as {
    denom?: string;
    recipients?: Array<{ address: string; amount: string }>;
    sender?: string;
    network?: string;
  };

  if (!denom) {
    res.status(400).json({ error: "Missing 'denom'." });
    return;
  }
  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    res.status(400).json({ error: "'recipients' must be a non-empty array." });
    return;
  }
  if (blockMainnetAgentWallet(req, res)) return;
  if (await tokenGateCheck(req, res)) return;
  if (!process.env.AGENT_MNEMONIC) {
    res.status(500).json({ error: "Server not configured: AGENT_MNEMONIC not set." });
    return;
  }

  const { networkName, network } = getNetwork(req);

  // Setup SSE — disable ALL proxy buffering
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Content-Encoding": "identity",
  });

  req.socket.setNoDelay(true);
  res.flushHeaders();

  let clientDisconnected = false;
  req.on("close", () => {
    clientDisconnected = true;
  });

  const sendEvent = (event: string, data: unknown) => {
    if (clientDisconnected) return;
    const eventStr = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    res.write(eventStr);
    if (typeof (res as any).flush === "function") {
      (res as any).flush();
    }
  };

  let client: TxClient | null = null;

  try {
    const txWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    client = await TxClient.connectWithWallet(txWallet);

    const executeStartTime = Date.now();
    const BATCH_SIZE = 100;
    const totalBatches = Math.ceil(recipients.length / BATCH_SIZE);
    let totalSent = 0;
    let totalFailed = 0;
    const errors: string[] = [];
    const txHashes: string[] = [];
    const failedAddresses: Array<{ address: string; error: string }> = [];

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      if (clientDisconnected) break;

      const batchStart = batchIdx * BATCH_SIZE;
      const batch = recipients.slice(batchStart, batchStart + BATCH_SIZE);

      sendEvent("batch_start", {
        batch: batchIdx + 1,
        totalBatches,
        recipientCount: batch.length,
        startIndex: batchStart,
      });

      let batchSent = 0;
      let batchFailed = 0;

      // Process recipients sequentially to avoid nonce issues
      for (const recipient of batch) {
        if (clientDisconnected) break;

        try {
          const msg = {
            typeUrl: "/cosmos.bank.v1beta1.MsgSend",
            value: {
              fromAddress: client.address,
              toAddress: recipient.address,
              amount: [{ denom, amount: recipient.amount }],
            },
          };
          const result = await client.signAndBroadcastMsg(msg, 200000);

          if (result.success) {
            batchSent++;
            totalSent++;
            if (result.txHash) txHashes.push(result.txHash);
          } else {
            batchFailed++;
            totalFailed++;
            const errMsg = result.error || "tx failed";
            errors.push(`${recipient.address}: ${errMsg}`);
            failedAddresses.push({ address: recipient.address, error: errMsg });
          }
        } catch (err) {
          batchFailed++;
          totalFailed++;
          const errMsg = (err as Error).message;
          errors.push(`${recipient.address}: ${errMsg}`);
          failedAddresses.push({ address: recipient.address, error: errMsg });
        }
      }

      sendEvent("batch_success", {
        batch: batchIdx + 1,
        totalBatches,
        sent: batchSent,
        failed: batchFailed,
        totalSent,
        totalFailed,
      });
    }

    // Record in airdrop history
    const totalAmount = recipients.reduce((sum, r) => {
      try { return sum + BigInt(r.amount); } catch { return sum; }
    }, BigInt(0)).toString();

    recordAirdrop({
      timestamp: new Date().toISOString(),
      denom: denom || "",
      sender: sender || client.address,
      network: networkName,
      totalRecipients: recipients.length,
      totalAmount,
      sent: totalSent,
      failed: totalFailed,
      txHashes,
      failedAddresses,
      dryRun: false,
      scheduled: false,
      durationMs: Date.now() - executeStartTime,
    });

    sendEvent("complete", {
      totalSent,
      totalFailed,
      totalRecipients: recipients.length,
      txHashes,
      errors: errors.slice(0, 50),
    });
  } catch (err) {
    sendEvent("batch_error", {
      error: (err as Error).message,
    });
    sendEvent("complete", {
      totalSent: 0,
      totalFailed: recipients.length,
      totalRecipients: recipients.length,
      errors: [(err as Error).message],
    });
  } finally {
    try {
      if (client) client.disconnect();
    } catch {
      /* ignore */
    }
    if (!clientDisconnected) {
      res.end();
    }
  }
});

// ─── SMART AIRDROP: SEND REVIEW ──────────────────────────────────────────

app.post("/api/smart-airdrop/send-review", async (req, res) => {
  const { resolved, delivery, tokenDenom } = req.body as {
    resolved?: ResolvedAirdrop;
    delivery?: { type: "email" | "telegram"; target: string };
    tokenDenom?: string;
  };

  if (!resolved || !resolved.recipients) {
    res.status(400).json({ error: "Missing 'resolved' airdrop data." });
    return;
  }

  if (!delivery || !delivery.type || !delivery.target) {
    res.status(400).json({ error: "Missing 'delivery' with type and target." });
    return;
  }

  if (delivery.type !== "email" && delivery.type !== "telegram") {
    res.status(400).json({ error: "delivery.type must be 'email' or 'telegram'." });
    return;
  }

  if (!tokenDenom) {
    res.status(400).json({ error: "Missing 'tokenDenom'." });
    return;
  }

  try {
    const result = await sendAirdropReview(resolved, delivery, tokenDenom);
    res.json(result);
  } catch (err) {
    console.error("[smart-airdrop/send-review] Error:", (err as Error).message);
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// ─── SMART AIRDROP: DRY RUN ──────────────────────────────────────────────

app.post("/api/smart-airdrop/dry-run", async (req, res) => {
  const { denom, recipients, sender, network: reqNetwork } = req.body as {
    denom?: string;
    recipients?: Array<{ address: string; amount: string }>;
    sender?: string;
    network?: string;
  };

  if (!denom) {
    res.status(400).json({ error: "Missing 'denom'." });
    return;
  }
  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    res.status(400).json({ error: "'recipients' must be a non-empty array." });
    return;
  }
  if (!sender || typeof sender !== "string") {
    res.status(400).json({ error: "Missing 'sender' address." });
    return;
  }

  const { networkName, network } = getNetwork(req);
  const restUrl = network.restEndpoint;
  const AVG_GAS_PER_MSG = 80_000;
  const BATCH_SIZE = 100;
  const totalBatches = Math.ceil(recipients.length / BATCH_SIZE);
  const issues: string[] = [];

  // Build batch breakdown
  const batches: Array<{ batchNum: number; recipientCount: number; estimatedGas: number }> = [];
  let totalGasEstimate = 0;

  for (let i = 0; i < totalBatches; i++) {
    const batchStart = i * BATCH_SIZE;
    const batch = recipients.slice(batchStart, batchStart + BATCH_SIZE);
    const estimatedGas = batch.length * AVG_GAS_PER_MSG;
    totalGasEstimate += estimatedGas;
    batches.push({ batchNum: i + 1, recipientCount: batch.length, estimatedGas });
  }

  // Calculate total tokens needed
  let totalTokensBigInt = BigInt(0);
  for (const r of recipients) {
    try {
      totalTokensBigInt += BigInt(r.amount);
    } catch {
      issues.push(`Invalid amount for ${r.address}: ${r.amount}`);
    }
  }
  const totalTokens = totalTokensBigInt.toString();

  // Estimate gas cost in CORE (gas price ~0.0625 ucore per gas unit)
  const gasPriceUcore = 0.0625;
  const totalGasCostUcore = Math.ceil(totalGasEstimate * gasPriceUcore);
  const totalGasCost = `${totalGasCostUcore} ucore`;

  // Check sender balance
  let senderBalance = "unknown";
  let senderBalanceRaw = BigInt(0);
  let canExecute = true;

  try {
    const balResp = await fetch(
      `${restUrl}/cosmos/bank/v1beta1/balances/${sender}/by_denom?denom=${denom}`
    );
    if (balResp.ok) {
      const balData: any = await balResp.json();
      senderBalance = balData?.balance?.amount || "0";
      senderBalanceRaw = BigInt(senderBalance);
    }
  } catch {
    issues.push("Could not query sender balance.");
  }

  // Check if sender has enough tokens
  if (senderBalanceRaw < totalTokensBigInt) {
    canExecute = false;
    issues.push(`Insufficient token balance. Need ${totalTokens} ${denom}, have ${senderBalance}.`);
  }

  // Check gas balance (ucore)
  try {
    const coreBalResp = await fetch(
      `${restUrl}/cosmos/bank/v1beta1/balances/${sender}/by_denom?denom=${network.denom || "ucore"}`
    );
    if (coreBalResp.ok) {
      const coreBalData: any = await coreBalResp.json();
      const coreBalance = BigInt(coreBalData?.balance?.amount || "0");
      if (coreBalance < BigInt(totalGasCostUcore)) {
        canExecute = false;
        issues.push(
          `Insufficient gas balance. Need ~${totalGasCostUcore} ${network.denom || "ucore"} for gas, have ${coreBalance.toString()}.`
        );
      }
    }
  } catch {
    issues.push("Could not query sender gas balance.");
  }

  // If denom is the native gas token, combine check
  if (denom === (network.denom || "ucore")) {
    const totalNeeded = totalTokensBigInt + BigInt(totalGasCostUcore);
    if (senderBalanceRaw < totalNeeded) {
      canExecute = false;
      issues.push(
        `Combined check: need ${totalNeeded.toString()} ${denom} (tokens + gas), have ${senderBalance}.`
      );
    }
  }

  // Record as a dry-run in history
  recordAirdrop({
    timestamp: new Date().toISOString(),
    denom: denom || "",
    sender: sender || "",
    network: networkName,
    totalRecipients: recipients.length,
    totalAmount: totalTokens,
    sent: 0,
    failed: 0,
    txHashes: [],
    failedAddresses: [],
    dryRun: true,
    scheduled: false,
    durationMs: 0,
  });

  res.json({
    batches,
    totalRecipients: recipients.length,
    totalTokens,
    totalGasEstimate,
    totalGasCost,
    senderBalance,
    canExecute,
    issues,
  });
});

// ─── SMART AIRDROP: SCHEDULE ─────────────────────────────────────────────

app.post("/api/smart-airdrop/schedule", async (req, res) => {
  const {
    denom,
    recipients,
    sender,
    network: reqNetwork,
    scheduleType,
    executeAt,
    triggerDenom,
    triggerPrice,
    triggerDirection,
  } = req.body as {
    denom?: string;
    recipients?: Array<{ address: string; amount: string }>;
    sender?: string;
    network?: string;
    scheduleType?: "time" | "price";
    executeAt?: string;
    triggerDenom?: string;
    triggerPrice?: number;
    triggerDirection?: "above" | "below";
  };

  if (!denom) {
    res.status(400).json({ error: "Missing 'denom'." });
    return;
  }
  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    res.status(400).json({ error: "'recipients' must be a non-empty array." });
    return;
  }
  if (!sender) {
    res.status(400).json({ error: "Missing 'sender'." });
    return;
  }
  if (!scheduleType || (scheduleType !== "time" && scheduleType !== "price")) {
    res.status(400).json({ error: "scheduleType must be 'time' or 'price'." });
    return;
  }
  if (scheduleType === "time" && !executeAt) {
    res.status(400).json({ error: "Missing 'executeAt' for time-based schedule." });
    return;
  }
  if (scheduleType === "price" && (!triggerDenom || triggerPrice == null || !triggerDirection)) {
    res.status(400).json({ error: "Missing price trigger fields (triggerDenom, triggerPrice, triggerDirection)." });
    return;
  }

  const { networkName } = getNetwork(req);

  const scheduled = createScheduledAirdrop({
    denom,
    recipients,
    sender,
    network: networkName,
    scheduleType,
    executeAt,
    triggerDenom,
    triggerPrice,
    triggerDirection,
  });

  res.json({ ok: true, scheduled });
});

app.get("/api/smart-airdrop/schedules", (_req, res) => {
  res.json({ schedules: getScheduledAirdrops() });
});

app.post("/api/smart-airdrop/schedule/cancel", (req, res) => {
  const { id } = req.body as { id?: string };
  if (!id) {
    res.status(400).json({ error: "Missing 'id'." });
    return;
  }
  const ok = cancelScheduledAirdrop(id);
  if (!ok) {
    res.status(400).json({ error: "Could not cancel. Schedule not found or not pending." });
    return;
  }
  res.json({ ok: true });
});

// ─── SMART AIRDROP: SCHEDULE CHECKER (30s interval) ──────────────────────

async function _executeScheduledAirdrop(sa: ScheduledAirdrop): Promise<void> {
  updateScheduledAirdrop(sa.id, { status: "executing" });
  const startTime = Date.now();
  const networkName = sa.network as NetworkName;
  const network = NETWORKS[networkName];

  if (!process.env.AGENT_MNEMONIC) {
    updateScheduledAirdrop(sa.id, {
      status: "failed",
      executedAt: new Date().toISOString(),
      result: { sent: 0, failed: sa.recipients.length, txHashes: [] },
    });
    return;
  }

  let client: TxClient | null = null;
  let totalSent = 0;
  let totalFailed = 0;
  const txHashes: string[] = [];
  const failedAddresses: Array<{ address: string; error: string }> = [];

  try {
    const txWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    client = await TxClient.connectWithWallet(txWallet);

    const BATCH_SIZE = 100;
    for (let i = 0; i < sa.recipients.length; i += BATCH_SIZE) {
      const batch = sa.recipients.slice(i, i + BATCH_SIZE);
      for (const recipient of batch) {
        try {
          const msg = {
            typeUrl: "/cosmos.bank.v1beta1.MsgSend",
            value: {
              fromAddress: client.address,
              toAddress: recipient.address,
              amount: [{ denom: sa.denom, amount: recipient.amount }],
            },
          };
          const result = await client.signAndBroadcastMsg(msg, 200000);
          if (result.success) {
            totalSent++;
            if (result.txHash) txHashes.push(result.txHash);
          } else {
            totalFailed++;
            failedAddresses.push({ address: recipient.address, error: result.error || "tx failed" });
          }
        } catch (err) {
          totalFailed++;
          failedAddresses.push({ address: recipient.address, error: (err as Error).message });
        }
      }
    }

    updateScheduledAirdrop(sa.id, {
      status: "completed",
      executedAt: new Date().toISOString(),
      result: { sent: totalSent, failed: totalFailed, txHashes },
    });
  } catch (err) {
    updateScheduledAirdrop(sa.id, {
      status: "failed",
      executedAt: new Date().toISOString(),
      result: { sent: totalSent, failed: totalFailed || sa.recipients.length, txHashes },
    });
  } finally {
    try { if (client) client.disconnect(); } catch { /* ignore */ }
  }

  // Record in history
  const totalAmount = sa.recipients.reduce((sum, r) => {
    try { return sum + BigInt(r.amount); } catch { return sum; }
  }, BigInt(0)).toString();

  recordAirdrop({
    timestamp: new Date().toISOString(),
    denom: sa.denom,
    sender: sa.sender,
    network: sa.network,
    totalRecipients: sa.recipients.length,
    totalAmount,
    sent: totalSent,
    failed: totalFailed,
    txHashes,
    failedAddresses,
    dryRun: false,
    scheduled: true,
    durationMs: Date.now() - startTime,
  });
}

setInterval(() => {
  // Check scheduled airdrops
  const pending = getPendingScheduledAirdrops();
  for (const sa of pending) {
    if (sa.scheduleType === "time" && sa.executeAt) {
      if (Date.now() >= new Date(sa.executeAt).getTime()) {
        console.log(`[smart-airdrop] Executing scheduled airdrop ${sa.id} (time trigger)`);
        _executeScheduledAirdrop(sa).catch((err) =>
          console.error(`[smart-airdrop] Scheduled execution error ${sa.id}:`, (err as Error).message)
        );
      }
    } else if (sa.scheduleType === "price") {
      // Price-based triggers are not yet wired to a real price feed.
      // Placeholder: log and skip.
      console.log(
        `[smart-airdrop] Price-based schedule ${sa.id}: watching ${sa.triggerDenom} ` +
        `${sa.triggerDirection} $${sa.triggerPrice} — price feed not yet wired, skipping.`
      );
    }
  }

  // Check DAO proposals for expiry
  const daoExpired = closeExpiredProposals();
  if (daoExpired > 0) {
    console.log(`[dao-voting] Auto-closed ${daoExpired} expired proposal(s).`);
  }

  // Check pending vesting steps
  const vestingSteps = getPendingVestingSteps();
  for (const { plan, step, stepIndex } of vestingSteps) {
    console.log(
      `[smart-airdrop] Vesting step due for plan ${plan.id}: ${step.action} on ${step.address} ` +
      `(step ${stepIndex + 1}/${plan.steps.length})`
    );
    // Execute the vesting step (setWhitelistedLimit or unfreezeAccount)
    // In production this would use the TxClient to broadcast the appropriate message.
    // For now, mark as completed and log.
    updateVestingPlan(plan.id, { completedSteps: stepIndex + 1 });
    if (stepIndex + 1 >= plan.steps.length) {
      updateVestingPlan(plan.id, { status: "completed" });
      console.log(`[smart-airdrop] Vesting plan ${plan.id} fully completed.`);
    }
  }
}, 30_000);

// ─── SMART AIRDROP: HISTORY ──────────────────────────────────────────────

app.get("/api/smart-airdrop/history", (_req, res) => {
  res.json({ history: getAirdropHistory() });
});

app.get("/api/smart-airdrop/history/:id", (req, res) => {
  const record = getAirdropById(req.params.id);
  if (!record) {
    res.status(404).json({ error: "Record not found." });
    return;
  }
  res.json({ record });
});

app.get("/api/smart-airdrop/history/:id/export", (req, res) => {
  const record = getAirdropById(req.params.id);
  if (!record) {
    res.status(404).json({ error: "Record not found." });
    return;
  }

  // Build CSV
  const csvLines = ["address,amount,status,txHash,timestamp"];
  // We don't have per-recipient tx hash mapping in the record,
  // so we use the record-level data as best-effort.
  const failedMap = new Map(record.failedAddresses.map((f) => [f.address, f.error]));

  // We need recipient list — but we only stored totals.
  // For now, export the failed addresses and a note about successful ones.
  if (record.failedAddresses.length > 0) {
    for (const fa of record.failedAddresses) {
      csvLines.push(`${fa.address},,failed,"${fa.error}",${record.timestamp}`);
    }
  }

  // Add tx hashes as summary rows
  for (const txHash of record.txHashes) {
    csvLines.push(`,,success,${txHash},${record.timestamp}`);
  }

  // Summary row
  csvLines.push(`# Summary: ${record.sent} sent / ${record.failed} failed / ${record.totalRecipients} total`);

  const csv = csvLines.join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="airdrop-${record.id}.csv"`);
  res.send(csv);
});

// ─── SMART AIRDROP: RECEIPT ──────────────────────────────────────────────

app.get("/api/smart-airdrop/receipt/:id", (req, res) => {
  const record = getAirdropById(req.params.id);
  if (!record) {
    res.status(404).json({ error: "Receipt not found." });
    return;
  }
  res.json({ record });
});

app.get("/receipt/:id", (req, res) => {
  const record = getAirdropById(req.params.id);
  if (!record) {
    res.status(404).send("<html><body><h1>Receipt not found</h1></body></html>");
    return;
  }

  const isMainnet = record.network === "mainnet";
  const explorerBase = isMainnet
    ? "https://explorer.testcosmos.directory/coreum/tx/"
    : "https://explorer.testcosmos.directory/coreum-testnet/tx/";

  const txRows = record.txHashes
    .map(
      (tx) =>
        `<tr><td class="mono"><a href="${explorerBase}${tx}" target="_blank" rel="noopener">${tx}</a></td><td>Success</td></tr>`
    )
    .join("\n");

  const failedRows = record.failedAddresses
    .map(
      (fa) =>
        `<tr><td class="mono">${fa.address}</td><td class="failed">${fa.error}</td></tr>`
    )
    .join("\n");

  const durationSec = (record.durationMs / 1000).toFixed(1);
  const typeLabel = record.dryRun ? "Dry Run" : record.scheduled ? "Scheduled" : "Manual";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Airdrop Receipt - ${record.id}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1118; color: #e4e4e7; padding: 32px; line-height: 1.6; }
  .receipt { max-width: 800px; margin: 0 auto; background: #1a1d2e; border-radius: 12px; overflow: hidden; border: 1px solid #2a2d3e; }
  .receipt-header { background: linear-gradient(135deg, #7c6dfa 0%, #5b4fc7 100%); padding: 28px 32px; text-align: center; }
  .receipt-header h1 { font-size: 1.4rem; color: #fff; font-weight: 700; letter-spacing: 0.02em; }
  .receipt-header .subtitle { font-size: 0.85rem; color: rgba(255,255,255,0.8); margin-top: 4px; }
  .receipt-body { padding: 28px 32px; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .meta-item { background: #12141f; padding: 14px 16px; border-radius: 8px; border: 1px solid #2a2d3e; }
  .meta-label { font-size: 0.75rem; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em; }
  .meta-value { font-size: 0.95rem; color: #e4e4e7; font-weight: 600; margin-top: 4px; word-break: break-all; }
  .section-title { font-size: 0.9rem; font-weight: 600; color: #9ca3af; margin: 24px 0 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th { text-align: left; padding: 10px 12px; background: #12141f; color: #9ca3af; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid #2a2d3e; }
  td { padding: 10px 12px; border-bottom: 1px solid #1e2130; font-size: 0.85rem; }
  tr:last-child td { border-bottom: none; }
  .mono { font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; font-size: 0.78rem; word-break: break-all; }
  a { color: #7c6dfa; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .success { color: #06d6a0; }
  .failed { color: #ef4444; }
  .summary-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #1e2130; }
  .summary-row:last-child { border-bottom: none; }
  .summary-label { color: #9ca3af; }
  .summary-value { font-weight: 600; }
  .summary-value.ok { color: #06d6a0; }
  .summary-value.fail { color: #ef4444; }
  .receipt-footer { text-align: center; padding: 20px 32px; border-top: 1px solid #2a2d3e; font-size: 0.8rem; color: #6b7280; }
  .receipt-footer a { color: #7c6dfa; }
  @media print {
    body { background: #fff; color: #1a1a1a; padding: 16px; }
    .receipt { border: 1px solid #ddd; background: #fff; }
    .receipt-header { background: #7c6dfa; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .meta-item { background: #f5f5f5; border-color: #ddd; }
    .meta-label { color: #666; }
    .meta-value { color: #1a1a1a; }
    th { background: #f5f5f5; color: #666; }
    td { border-color: #eee; }
    a { color: #7c6dfa; }
    .receipt-footer { color: #999; }
  }
  @media (max-width: 600px) {
    body { padding: 12px; }
    .meta-grid { grid-template-columns: 1fr; }
    .receipt-body { padding: 16px; }
  }
</style>
</head>
<body>
<div class="receipt">
  <div class="receipt-header">
    <h1>TXAI Studio Airdrop Receipt</h1>
    <div class="subtitle">${new Date(record.timestamp).toUTCString()}</div>
  </div>
  <div class="receipt-body">
    <div class="meta-grid">
      <div class="meta-item"><div class="meta-label">Receipt ID</div><div class="meta-value mono">${record.id}</div></div>
      <div class="meta-item"><div class="meta-label">Type</div><div class="meta-value">${typeLabel}</div></div>
      <div class="meta-item"><div class="meta-label">Token</div><div class="meta-value">${record.denom}</div></div>
      <div class="meta-item"><div class="meta-label">Network</div><div class="meta-value">${record.network}</div></div>
      <div class="meta-item"><div class="meta-label">Sender</div><div class="meta-value mono">${record.sender}</div></div>
      <div class="meta-item"><div class="meta-label">Total Amount</div><div class="meta-value">${record.totalAmount} ${record.denom}</div></div>
    </div>

    <div class="section-title">Summary</div>
    <div class="summary-row"><span class="summary-label">Total Recipients</span><span class="summary-value">${record.totalRecipients}</span></div>
    <div class="summary-row"><span class="summary-label">Successfully Sent</span><span class="summary-value ok">${record.sent}</span></div>
    <div class="summary-row"><span class="summary-label">Failed</span><span class="summary-value fail">${record.failed}</span></div>
    <div class="summary-row"><span class="summary-label">Duration</span><span class="summary-value">${durationSec}s</span></div>

    ${record.txHashes.length > 0 ? `
    <div class="section-title">Transaction Hashes</div>
    <table><thead><tr><th>TX Hash</th><th>Status</th></tr></thead><tbody>${txRows}</tbody></table>
    ` : ""}

    ${record.failedAddresses.length > 0 ? `
    <div class="section-title">Failed Addresses</div>
    <table><thead><tr><th>Address</th><th>Error</th></tr></thead><tbody>${failedRows}</tbody></table>
    ` : ""}
  </div>
  <div class="receipt-footer">
    Verified on TX blockchain &middot;
    <a href="${isMainnet ? "https://explorer.testcosmos.directory/coreum" : "https://explorer.testcosmos.directory/coreum-testnet"}" target="_blank" rel="noopener">
      View Explorer
    </a>
    &middot; Powered by TXAI Studio
  </div>
</div>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

// ─── SMART AIRDROP: VESTING ─────────────────────────────────────────────

app.post("/api/smart-airdrop/vesting-preview", (req, res) => {
  const { recipients, schedule } = req.body as {
    recipients?: Array<{ address: string; amount: string }>;
    schedule?: VestingSchedule;
  };

  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    res.status(400).json({ error: "'recipients' must be a non-empty array." });
    return;
  }
  if (!schedule || !schedule.type) {
    res.status(400).json({ error: "Missing 'schedule' with type." });
    return;
  }

  try {
    const steps = calculateVestingSteps(schedule, recipients);
    res.json({ steps, totalSteps: steps.length });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/smart-airdrop/execute-vested", async (req, res) => {
  const { denom, recipients, sender, network: reqNetwork, schedule } = req.body as {
    denom?: string;
    recipients?: Array<{ address: string; amount: string }>;
    sender?: string;
    network?: string;
    schedule?: VestingSchedule;
  };

  if (!denom) {
    res.status(400).json({ error: "Missing 'denom'." });
    return;
  }
  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    res.status(400).json({ error: "'recipients' must be a non-empty array." });
    return;
  }
  if (!schedule || !schedule.type) {
    res.status(400).json({ error: "Missing 'schedule' with type." });
    return;
  }
  if (blockMainnetAgentWallet(req, res)) return;
  if (await tokenGateCheck(req, res)) return;
  if (!process.env.AGENT_MNEMONIC) {
    res.status(500).json({ error: "Server not configured: AGENT_MNEMONIC not set." });
    return;
  }

  const { networkName } = getNetwork(req);

  try {
    // Calculate vesting steps
    const steps = calculateVestingSteps(schedule, recipients);

    // Create vesting plan
    const plan = createVestingPlan({
      denom,
      sender: sender || "",
      network: networkName,
      schedule,
      recipients,
      steps,
    });

    // Record in history as a vested airdrop
    const totalAmount = recipients.reduce((sum, r) => {
      try { return sum + BigInt(r.amount); } catch { return sum; }
    }, BigInt(0)).toString();

    const record = recordAirdrop({
      timestamp: new Date().toISOString(),
      denom,
      sender: sender || "",
      network: networkName,
      totalRecipients: recipients.length,
      totalAmount,
      sent: recipients.length,
      failed: 0,
      txHashes: [],
      failedAddresses: [],
      dryRun: false,
      scheduled: false,
      durationMs: 0,
    });

    // Link airdrop to vesting plan
    updateVestingPlan(plan.id, { airdropId: record.id });

    res.json({
      ok: true,
      plan,
      record,
      totalSteps: steps.length,
      message: `Vesting plan created with ${steps.length} scheduled unlock steps.`,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/smart-airdrop/vesting-plans", (_req, res) => {
  res.json({ plans: getVestingPlans() });
});

app.get("/api/smart-airdrop/vesting-plans/:id", (req, res) => {
  const plan = getVestingPlanById(req.params.id);
  if (!plan) {
    res.status(404).json({ error: "Vesting plan not found." });
    return;
  }
  res.json({ plan });
});

// ─── DAO VOTING ─────────────────────────────────────────────────────────────

app.post("/api/dao/create-proposal", (req, res) => {
  const {
    title, description, options, gateType,
    nftClassId, tokenDenom, minTokenBalance,
    votingPower, startTime, endTime, creator, network: reqNetwork,
  } = req.body as {
    title?: string;
    description?: string;
    options?: string[];
    gateType?: "nft" | "token" | "any_wallet";
    nftClassId?: string;
    tokenDenom?: string;
    minTokenBalance?: string;
    votingPower?: "equal" | "token_weighted" | "nft_count";
    startTime?: string;
    endTime?: string;
    creator?: string;
    network?: string;
  };

  // Validate required fields
  if (!title || !title.trim()) {
    res.status(400).json({ error: "Title is required." });
    return;
  }
  if (!options || !Array.isArray(options) || options.length < 2) {
    res.status(400).json({ error: "At least 2 voting options are required." });
    return;
  }
  if (!gateType || !["nft", "token", "any_wallet"].includes(gateType)) {
    res.status(400).json({ error: "gateType must be 'nft', 'token', or 'any_wallet'." });
    return;
  }
  if (gateType === "nft" && !nftClassId) {
    res.status(400).json({ error: "nftClassId is required when gateType is 'nft'." });
    return;
  }
  if (gateType === "token" && !tokenDenom) {
    res.status(400).json({ error: "tokenDenom is required when gateType is 'token'." });
    return;
  }
  if (!votingPower || !["equal", "token_weighted", "nft_count"].includes(votingPower)) {
    res.status(400).json({ error: "votingPower must be 'equal', 'token_weighted', or 'nft_count'." });
    return;
  }
  if (!startTime || !endTime) {
    res.status(400).json({ error: "startTime and endTime are required." });
    return;
  }
  if (new Date(endTime) <= new Date(startTime)) {
    res.status(400).json({ error: "endTime must be after startTime." });
    return;
  }
  if (!creator || !creator.trim()) {
    res.status(400).json({ error: "creator wallet address is required." });
    return;
  }

  const { networkName } = getNetwork(req);

  const proposal = createProposal({
    title: title.trim(),
    description: (description || "").trim(),
    creator: creator.trim(),
    options: options.map((o) => o.trim()).filter(Boolean),
    gateType,
    nftClassId,
    tokenDenom,
    minTokenBalance,
    votingPower,
    startTime,
    endTime,
    network: reqNetwork || networkName,
  });

  res.json({ proposal });
});

app.get("/api/dao/proposals", (_req, res) => {
  // Auto-close expired proposals first
  closeExpiredProposals();

  const status = _req.query.status as string | undefined;
  const network = _req.query.network as string | undefined;

  const list = getProposals({ status, network });
  res.json({ proposals: list });
});

app.get("/api/dao/proposals/:id", (req, res) => {
  const proposal = getProposalById(req.params.id);
  if (!proposal) {
    res.status(404).json({ error: "Proposal not found." });
    return;
  }
  res.json({ proposal, results: getResults(proposal.id) });
});

app.post("/api/dao/vote", async (req, res) => {
  const { proposalId, voter, option, network: reqNetwork } = req.body as {
    proposalId?: string;
    voter?: string;
    option?: number;
    network?: string;
  };

  if (!proposalId) {
    res.status(400).json({ error: "proposalId is required." });
    return;
  }
  if (!voter || !voter.trim()) {
    res.status(400).json({ error: "voter wallet address is required." });
    return;
  }
  if (option === undefined || option === null) {
    res.status(400).json({ error: "option (index) is required." });
    return;
  }

  const proposal = getProposalById(proposalId);
  if (!proposal) {
    res.status(404).json({ error: "Proposal not found." });
    return;
  }

  // Check active and time window
  if (proposal.status !== "active") {
    res.status(400).json({ error: `Proposal is ${proposal.status}, not active.` });
    return;
  }
  const now = new Date();
  if (now < new Date(proposal.startTime)) {
    res.status(400).json({ error: "Voting has not started yet." });
    return;
  }
  if (now > new Date(proposal.endTime)) {
    res.status(400).json({ error: "Voting period has ended." });
    return;
  }

  // Check double vote
  const alreadyVoted = proposal.votes.find((v) => v.voter === voter.trim());
  if (alreadyVoted) {
    res.status(400).json({ error: "You have already voted on this proposal." });
    return;
  }

  // Check eligibility on chain
  const { networkName, network } = getNetwork(req);
  const restUrl = network.restEndpoint;

  const eligibility = await checkEligibility(voter.trim(), proposal, networkName, restUrl);

  if (!eligibility.eligible) {
    res.status(403).json({ error: eligibility.reason || "Not eligible to vote.", eligibility });
    return;
  }

  const vote: DAOVote = {
    voter: voter.trim(),
    option,
    power: eligibility.power,
    timestamp: new Date().toISOString(),
    nftId: eligibility.nftId,
    tokenBalance: eligibility.tokenBalance,
  };

  const result = castVote(proposalId, vote);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({ vote, currentResults: getResults(proposalId) });
});

app.get("/api/dao/results/:id", (req, res) => {
  const results = getResults(req.params.id);
  if (!results) {
    res.status(404).json({ error: "Proposal not found." });
    return;
  }

  const proposal = getProposalById(req.params.id);
  res.json({ results, voters: proposal?.votes || [] });
});

app.post("/api/dao/close/:id", (req, res) => {
  const { creator } = req.body as { creator?: string };
  if (!creator) {
    res.status(400).json({ error: "creator wallet address is required." });
    return;
  }

  const result = closeProposal(req.params.id, creator.trim());
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({ ok: true, results: getResults(req.params.id) });
});

app.post("/api/dao/check-eligibility", async (req, res) => {
  const { proposalId, voter, network: reqNetwork } = req.body as {
    proposalId?: string;
    voter?: string;
    network?: string;
  };

  if (!proposalId || !voter) {
    res.status(400).json({ error: "proposalId and voter are required." });
    return;
  }

  const proposal = getProposalById(proposalId);
  if (!proposal) {
    res.status(404).json({ error: "Proposal not found." });
    return;
  }

  const { networkName, network } = getNetwork(req);
  const eligibility = await checkEligibility(voter.trim(), proposal, networkName, network.restEndpoint);

  res.json({ eligibility });
});

// ─── HTTP + WS SERVER ───────────────────────────────────────────────────────

import { createServer } from "http";
import { attachWebSocket } from "./ws-server";

// Create HTTP server so we can attach WebSocket to it
const server = createServer(app);

// Attach WebSocket server at /ws
attachWebSocket(server);

server.listen(PORT, () => {
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  console.log(`TXAI Smart Token Studio API on port ${PORT}`);
  console.log(`Network: ${networkName}`);
  console.log(`WebSocket: ws://localhost:${PORT}/ws`);

  // Start faucet bot if enabled (set FAUCET_BOT=true on ONE instance only)
  if (process.env.FAUCET_BOT === "true") {
    startFaucetBot().catch(err => console.error("[faucet-bot] Start error:", err.message));
  }
});
