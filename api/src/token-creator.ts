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

export type SendEventFn = (event: string, data: unknown) => void;

export async function createToken(
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

  if (balance < 0.1) {
    sendEvent("error", {
      message: `Insufficient balance (${balance} CORE). The agent wallet needs at least 0.1 CORE to issue a token. Please fund the wallet at: ${walletData.address}`,
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
  let iteration = 0;

  try {
    while (iteration < MAX_ITERATIONS) {
      iteration++;

      sendEvent("status", {
        message: `AI reasoning... (step ${iteration}/${MAX_ITERATIONS})`,
      });

      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        tools: DEMO_TOOLS,
        messages,
      });

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

        // Track the denom if a token was issued (check data even if success=false, tx might have gone through)
        if (toolBlock.name === "tx_issue_smart_token" && result.data) {
          const issueData = result.data as {
            denom?: string;
            txHash?: string;
            explorerUrl?: string;
            success?: boolean;
          };
          if (issueData.denom) lastDenom = issueData.denom;
          if (issueData.txHash) lastTxHash = issueData.txHash;
          if (issueData.explorerUrl) lastExplorerUrl = issueData.explorerUrl;
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

    // Send success event if we have a denom
    if (lastDenom) {
      sendEvent("success", {
        denom: lastDenom,
        txHash: lastTxHash,
        explorerUrl: lastExplorerUrl,
        network: networkName,
        walletAddress: walletData.address,
      });
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
