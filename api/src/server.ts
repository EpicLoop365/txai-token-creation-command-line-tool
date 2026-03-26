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
} from "./tx-sdk";

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
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

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
  const baseDenom = req.query.base as string;
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  const quoteDenom = (req.query.quote as string) || NETWORKS[networkName].denom;
  if (!baseDenom) { res.status(400).json({ error: "Missing 'base' query parameter." }); return; }
  try {
    const book = await queryOrderbook(baseDenom, quoteDenom, networkName);
    res.json(book);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ─── DEX: GET ORDERS ─────────────────────────────────────────────────────────

app.get("/api/orders", async (req, res) => {
  const creator = req.query.creator as string;
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  if (!creator) { res.status(400).json({ error: "Missing 'creator' query parameter." }); return; }
  try {
    const orders = await queryOrdersByCreator(creator, networkName);
    res.json({ orders });
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

// ─── START ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  console.log(`TXAI Smart Token Studio API on port ${PORT}`);
  console.log(`Network: ${networkName}`);
});
