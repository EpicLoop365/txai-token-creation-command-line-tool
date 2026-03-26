/**
 * dex-agent.ts — Agentic trading loop using Claude AI + DEX tools
 */

import Anthropic from "@anthropic-ai/sdk";
import { importWallet, TxClient, NetworkName } from "./tx-sdk";
import { DEX_TOOLS, DexToolExecutor, getDexAgentSystemPrompt } from "./dex-tools";

const MODEL = "claude-sonnet-4-20250514";
const MAX_ITERATIONS = 10;

type SendEventFn = (event: string, data: Record<string, unknown>) => void;

// ─── RETRY WRAPPER ───────────────────────────────────────────────────────────

async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { status?: number }).status;
      if ((status === 529 || status === 503 || status === 429 || status === 500) && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 2000 + Math.random() * 1000;
        console.log(`[dex-agent] API error ${status}, retry ${attempt + 1}/${maxRetries} in ${Math.round(delay)}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Max retries exceeded");
}

// ─── MAIN AGENT FUNCTION ────────────────────────────────────────────────────

export async function executeTrade(
  instruction: string,
  sendEvent: SendEventFn
): Promise<void> {
  sendEvent("status", { message: "Initializing trading agent..." });

  // Setup wallet
  const mnemonic = process.env.AGENT_MNEMONIC;
  if (!mnemonic) throw new Error("AGENT_MNEMONIC not set");

  const networkName = (process.env.TX_NETWORK ?? "testnet") as NetworkName;
  const txWallet = await importWallet(mnemonic, networkName);
  sendEvent("status", { message: `Agent wallet: ${txWallet.address}` });

  // Connect to chain
  const client = await TxClient.connectWithWallet(txWallet);
  const coreBalance = await client.getCoreBalance(client.address);
  sendEvent("status", { message: `Balance: ${coreBalance.toFixed(2)} CORE` });

  if (coreBalance < 0.5) {
    sendEvent("error", { message: "Insufficient CORE balance. Need at least 0.5 CORE for gas." });
    client.disconnect();
    return;
  }

  // Setup AI
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const executor = new DexToolExecutor(client, networkName);
  const systemPrompt = getDexAgentSystemPrompt(client.address, networkName);

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: instruction },
  ];

  sendEvent("status", { message: "AI agent is thinking..." });

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await callWithRetry(() =>
        anthropic.messages.create({
          model: MODEL,
          max_tokens: 2048,
          system: systemPrompt,
          tools: DEX_TOOLS as Anthropic.Tool[],
          messages,
        })
      );

      // Process response blocks
      const assistantContent: Anthropic.ContentBlock[] = [];

      for (const block of response.content) {
        assistantContent.push(block);

        if (block.type === "text") {
          sendEvent("text", { content: block.text });
        } else if (block.type === "tool_use") {
          sendEvent("tool_call", {
            tool: block.name,
            args: block.input,
          });

          const result = await executor.execute(block.name, block.input as Record<string, unknown>);

          sendEvent("tool_result", {
            tool: block.name,
            success: result.success,
            data: result.data ?? result.error,
          });

          // Add assistant message + tool result to history
          messages.push({ role: "assistant", content: assistantContent.splice(0) });
          messages.push({
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify(result),
              },
            ],
          });
        }
      }

      // If there are remaining non-tool blocks, add them
      if (assistantContent.length > 0) {
        messages.push({ role: "assistant", content: assistantContent });
      }

      if (response.stop_reason === "end_turn") {
        sendEvent("done", { message: "Trade execution complete." });
        break;
      }

      if (i === MAX_ITERATIONS - 1) {
        sendEvent("done", { message: "Reached maximum iterations." });
      }
    }
  } catch (err) {
    sendEvent("error", { message: (err as Error).message });
  } finally {
    client.disconnect();
  }
}
