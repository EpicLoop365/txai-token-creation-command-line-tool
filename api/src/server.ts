/**
 * server.ts — Express API server for the TX Agent demo
 *
 * Endpoints:
 *   GET  /health          — health check with wallet + network info
 *   POST /api/create-token — accepts { description }, streams SSE events
 */

import express from "express";
import cors from "cors";
import { createToken } from "./token-creator";
import { launchTokenSwarm } from "./swarm-launcher";
import {
  importWallet,
  NETWORKS,
  NetworkName,
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

// ─── SWARM LAUNCH (SSE) ─────────────────────────────────────────────────────

const swarmRateLimitMap = new Map<string, number>();
const SWARM_RATE_LIMIT_MS = 120_000; // 2 minutes between swarm launches

app.post("/api/swarm-launch", async (req, res) => {
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

  const now = Date.now();
  const lastSwarm = swarmRateLimitMap.get(clientIp);
  if (lastSwarm && now - lastSwarm < SWARM_RATE_LIMIT_MS) {
    res.status(429).json({ error: "Rate limited. Please wait 2 minutes between swarm launches." });
    return;
  }
  swarmRateLimitMap.set(clientIp, now);

  // SSE setup
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
    "Content-Encoding": "identity",
  });
  req.socket.setNoDelay(true);
  res.flushHeaders();

  const sendEvent = (event: string, data: unknown) => {
    const eventStr = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    res.write(eventStr);
    if (typeof (res as any).flush === "function") {
      (res as any).flush();
    }
  };

  let clientDisconnected = false;
  req.on("close", () => { clientDisconnected = true; });

  const wrappedSendEvent = (event: string, data: unknown) => {
    if (!clientDisconnected) sendEvent(event, data);
  };

  try {
    await launchTokenSwarm(description, wrappedSendEvent);
  } catch (err) {
    if (!clientDisconnected) {
      sendEvent("error", { message: `Swarm error: ${(err as Error).message}` });
      sendEvent("done", {});
    }
  }

  if (!clientDisconnected) res.end();
});

// ─── START ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  console.log(`TX Agent Demo API running on port ${PORT}`);
  console.log(`Network: ${networkName}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`Create token: POST http://localhost:${PORT}/api/create-token`);
});
