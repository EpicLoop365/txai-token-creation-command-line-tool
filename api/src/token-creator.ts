/**
 * token-creator.ts — Agentic token creation loop
 *
 * Takes a natural language token description, uses Claude to parse it,
 * and deploys the smart token on the TX blockchain. Streams progress
 * via SSE events back to the caller.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  importWallet,
  createWallet,
  TxClient,
  requestFaucet,
  NetworkName,
  NETWORKS,
} from "./tx-sdk";
import { DEMO_TOOLS, DemoToolExecutor, getSystemPrompt } from "./tools";

const MODEL = "claude-sonnet-4-20250514";
const MAX_ITERATIONS = 10;
const MAX_RETRIES = 3;
const API_CALL_TIMEOUT_MS = 60_000; // 60s max per Claude API call
const TOTAL_TIMEOUT_MS = 120_000;   // 2 min max for entire token creation

/** Race a promise against a timeout */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

/** Call Claude API with retry + exponential backoff for transient errors (429, 500, 503, 529) */
async function callClaudeWithRetry(
  anthropic: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming,
  sendEvent: SendEventFn
): Promise<Anthropic.Message> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await withTimeout(
        anthropic.messages.create(params),
        API_CALL_TIMEOUT_MS,
        "AI request"
      );
    } catch (err) {
      const status = (err as { status?: number }).status;
      const isRetryable = status === 429 || status === 500 || status === 503 || status === 529;

      if (isRetryable && attempt < MAX_RETRIES - 1) {
        const waitSec = Math.pow(2, attempt + 1); // 2s, 4s, 8s
        sendEvent("status", {
          message: `AI service busy, retrying in ${waitSec}s... (attempt ${attempt + 2}/${MAX_RETRIES})`,
        });
        await new Promise((r) => setTimeout(r, waitSec * 1000));
        continue;
      }

      // Non-retryable or exhausted retries — throw a clean error
      if (status === 529 || status === 503) {
        throw new Error("AI service is temporarily overloaded. Please try again in a minute.");
      } else if (status === 429) {
        throw new Error("AI rate limit reached. Please wait a moment and try again.");
      }
      throw err;
    }
  }
  throw new Error("AI service unavailable after retries. Please try again.");
}

export type SendEventFn = (event: string, data: unknown) => void;

export async function createToken(
  description: string,
  sendEvent: SendEventFn
): Promise<void> {
  // Wrap the entire creation flow in a hard timeout
  const timeoutId = setTimeout(() => {
    sendEvent("error", { message: "Token creation timed out after 2 minutes. Please try again." });
    sendEvent("done", {});
  }, TOTAL_TIMEOUT_MS);

  try {
    await _createTokenInner(description, sendEvent);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function _createTokenInner(
  description: string,
  sendEvent: SendEventFn
): Promise<void> {
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  const network = NETWORKS[networkName];

  // 1. Setup wallet
  sendEvent("status", { message: "Initializing wallet..." });

  let walletData;
  try {
    if (process.env.AGENT_MNEMONIC) {
      walletData = await importWallet(process.env.AGENT_MNEMONIC, networkName);
      sendEvent("status", {
        message: `Wallet loaded: ${walletData.address}`,
      });
    } else {
      const newWallet = await createWallet(networkName);
      walletData = newWallet;
      sendEvent("status", {
        message: `New wallet created: ${newWallet.address}`,
      });

      // Auto-fund from faucet on testnet/devnet
      if (network.faucetUrl) {
        sendEvent("status", { message: "Requesting testnet tokens from faucet..." });
        const faucetResult = await requestFaucet(newWallet.address, networkName);
        sendEvent("status", { message: faucetResult.message });

        if (faucetResult.success) {
          // Wait for faucet tx to be included in a block
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }
  } catch (err) {
    sendEvent("error", { message: `Wallet setup failed: ${(err as Error).message}` });
    sendEvent("done", {});
    return;
  }

  // 2. Connect to blockchain with timeout
  sendEvent("status", { message: "Connecting to TX blockchain..." });

  let client: TxClient;
  try {
    const connectionPromise = TxClient.connectWithWallet(walletData);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Blockchain connection timed out after 30s")), 30000)
    );
    client = await Promise.race([connectionPromise, timeoutPromise]);
  } catch (err) {
    sendEvent("error", { message: `Blockchain connection failed: ${(err as Error).message}` });
    sendEvent("done", {});
    return;
  }

  // 3. Check balance
  sendEvent("status", { message: "Checking wallet balance..." });
  const balance = await client.getCoreBalance(walletData.address);
  sendEvent("status", {
    message: `Wallet balance: ${balance} CORE`,
  });

  if (balance < 11) {
    sendEvent("error", {
      message: `Insufficient balance (${balance} CORE). Need at least 11 CORE (10 issue fee + gas). Wallet: ${walletData.address}`,
    });
    client.disconnect();
    return;
  }

  // 4. Create Claude client and tools
  sendEvent("status", { message: "Connecting to Claude AI..." });

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const executor = new DemoToolExecutor(client, networkName);
  const systemPrompt = getSystemPrompt(walletData.address, networkName);

  // 5. Run agentic loop
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Create this token on the TX blockchain: ${description}`,
    },
  ];

  let lastDenom: string | undefined;
  let lastTxHash: string | undefined;
  let lastExplorerUrl: string | undefined;
  let lastSupply: string | undefined;
  let lastFeatures: Record<string, boolean> | undefined;
  let lastDecimals: number | undefined;
  let lastError: { message: string; txHash?: string; explorerUrl?: string } | null = null;
  let iteration = 0;

  try {
    while (iteration < MAX_ITERATIONS) {
      iteration++;

      sendEvent("status", {
        message: `AI reasoning... (step ${iteration}/${MAX_ITERATIONS})`,
      });

      const response = await callClaudeWithRetry(
        anthropic,
        {
          model: MODEL,
          max_tokens: 4096,
          system: systemPrompt,
          tools: DEMO_TOOLS as Anthropic.Tool[],
          messages,
        },
        sendEvent
      );

      // Process response content blocks
      const toolUseBlocks: Anthropic.ToolUseBlock[] = [];

      for (const block of response.content) {
        if (block.type === "text") {
          sendEvent("text", { content: block.text });
        } else if (block.type === "tool_use") {
          toolUseBlocks.push(block);
        }
      }

      // If no tool calls and end_turn, we're done
      if (response.stop_reason === "end_turn" && toolUseBlocks.length === 0) {
        break;
      }

      if (toolUseBlocks.length === 0) {
        break;
      }

      // Add assistant response to history
      messages.push({ role: "assistant", content: response.content });

      // Execute each tool call
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolBlock of toolUseBlocks) {
        sendEvent("tool_call", {
          tool: toolBlock.name,
          args: toolBlock.input,
        });

        const result = await executor.execute(
          toolBlock.name,
          toolBlock.input as Record<string, unknown>
        );

        sendEvent("tool_result", {
          tool: toolBlock.name,
          result: result.success ? result.data : { error: result.error },
          success: result.success,
        });

        // Track the denom/txHash/supply/features if a token was issued
        if (toolBlock.name === "tx_issue_smart_token") {
          const issueData = (result.data || {}) as {
            denom?: string;
            txHash?: string;
            explorerUrl?: string;
            success?: boolean;
            error?: string;
          };
          const toolArgs = toolBlock.input as Record<string, unknown>;
          if (issueData.denom) lastDenom = issueData.denom;
          if (issueData.txHash) lastTxHash = issueData.txHash;
          if (issueData.explorerUrl) lastExplorerUrl = issueData.explorerUrl;
          if (toolArgs.initialAmount) lastSupply = String(toolArgs.initialAmount);
          if (toolArgs.features) lastFeatures = toolArgs.features as Record<string, boolean>;
          if (toolArgs.precision !== undefined) lastDecimals = Number(toolArgs.precision);

          // Track intermediate errors but don't emit them yet - Claude may retry
          if (!result.success) {
            const errMsg = issueData.error || result.error || "Token issuance failed";
            const txUrl = issueData.txHash
              ? `${NETWORKS[networkName].explorerUrl}/tx/transactions/${issueData.txHash}`
              : undefined;
            lastError = { message: errMsg, txHash: issueData.txHash, explorerUrl: txUrl };
          } else {
            // Clear last error on success
            lastError = null;
          }
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolBlock.id,
          content: JSON.stringify(
            result.success ? result.data : { error: result.error }
          ),
        });
      }

      // Add tool results to history for next iteration
      messages.push({ role: "user", content: toolResults });
    }

    // Send success event if we have a denom, otherwise emit the last error
    if (lastDenom) {
      sendEvent("success", {
        denom: lastDenom,
        txHash: lastTxHash,
        explorerUrl: lastExplorerUrl,
        supply: lastSupply,
        features: lastFeatures,
        decimals: lastDecimals ?? 6,
        network: networkName,
        walletAddress: walletData.address,
      });
    } else if (lastError) {
      sendEvent("error", lastError);
    } else {
      sendEvent("error", { message: "Token creation did not produce a result. Please try again." });
    }
  } catch (err) {
    sendEvent("error", {
      message: `Token creation failed: ${(err as Error).message}`,
    });
  } finally {
    client.disconnect();
    sendEvent("done", {});
  }
}
