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
  NETWORKS,
  NetworkName,
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
      if (
        allowedOrigins.length === 0 ||
        allowedOrigins.includes(origin) ||
        origin.startsWith("http://localhost")
      ) {
        return callback(null, true);
      }
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
        ...(authorizationValue || {}),
      };
    } else {
      authorization = {
        typeUrl: "/cosmos.authz.v1beta1.GenericAuthorization",
        ...(authorizationValue || {}),
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

// ─── DEX DEMO: Reset stuck demo lock ────────────────────────────────────────
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

// ─── START ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  console.log(`TXAI Smart Token Studio API on port ${PORT}`);
  console.log(`Network: ${networkName}`);
});
