/**
 * swarm-launcher.ts — Multi-agent token launch swarm
 *
 * Three AI agents coordinate to create, list, and distribute a token:
 *  1. Creator — issues the Smart Token on-chain
 *  2. Liquidity — places initial DEX orders
 *  3. Distributor — handles token allocation sends
 *
 * Self-contained: reuses the existing tx-sdk.ts and tools.ts,
 * no external swarm SDK dependency needed for deployment.
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
import { DEMO_TOOLS, DemoToolExecutor } from "./tools";

const MODEL = "claude-sonnet-4-20250514";
const MAX_ITERATIONS = 10;

export type SendEventFn = (event: string, data: unknown) => void;

// ─── Agent Definition ───────────────────────────────────────────────────────

interface SwarmAgent {
  name: string;
  role: string;
  goal: string;
  color: string;
  client: TxClient;
  address: string;
  executor: DemoToolExecutor;
}

// ─── System Prompts ─────────────────────────────────────────────────────────

function getAgentPrompt(
  agent: SwarmAgent,
  otherAgents: SwarmAgent[],
  networkName: string,
  sharedState: Record<string, string>
): string {
  const othersDesc = otherAgents
    .map((a) => `- ${a.name} (${a.role}) — wallet: ${a.address}`)
    .join("\n");

  const stateDesc = Object.keys(sharedState).length > 0
    ? `\nCurrent shared state:\n${Object.entries(sharedState).map(([k, v]) => `  ${k}: ${v}`).join("\n")}`
    : "\nShared state: empty";

  return `You are ${agent.name}, an AI agent in a multi-agent swarm on the TX blockchain (${networkName}).

Your role: ${agent.role}
Your goal: ${agent.goal}
Your wallet: ${agent.address}

Other agents in the swarm:
${othersDesc}

${stateDesc}

IMPORTANT RULES:
- You are on ${networkName}, using testnet tokens (not real money)
- Be concise and efficient — execute your task with minimal steps
- Token subunits must be lowercase alphanumeric, 3-50 characters
- The token NAME should come from the user's description — NEVER default to "TOKEN"
- After completing your task, summarize what you did`;
}

// ─── Agentic Loop ───────────────────────────────────────────────────────────

async function runAgentTask(
  agent: SwarmAgent,
  task: string,
  systemPrompt: string,
  sendEvent: SendEventFn
): Promise<{ text: string; toolResults: Array<{ tool: string; data: unknown; success: boolean }> }> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: task }];
  const toolResults: Array<{ tool: string; data: unknown; success: boolean }> = [];
  let finalText = "";

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    sendEvent("agent_thinking", { agent: agent.name, step: i + 1, maxSteps: MAX_ITERATIONS });

    let response: Anthropic.Message;
    // Retry logic for overloaded API
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 4096,
          system: systemPrompt,
          tools: DEMO_TOOLS,
          messages,
        });
        break;
      } catch (err: unknown) {
        const status = (err as { status?: number }).status;
        if ((status === 429 || status === 529) && attempt < 2) {
          const delay = 2000 * Math.pow(2, attempt);
          sendEvent("agent_text", { agent: agent.name, content: `API busy, retrying in ${delay / 1000}s...` });
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }

    const toolUseBlocks: Anthropic.ToolUseBlock[] = [];

    for (const block of response!.content) {
      if (block.type === "text" && block.text) {
        sendEvent("agent_text", { agent: agent.name, content: block.text });
        finalText += block.text + "\n";
      } else if (block.type === "tool_use") {
        toolUseBlocks.push(block);
      }
    }

    if (response!.stop_reason === "end_turn" && toolUseBlocks.length === 0) break;
    if (toolUseBlocks.length === 0) break;

    messages.push({ role: "assistant", content: response!.content });

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const toolBlock of toolUseBlocks) {
      sendEvent("agent_tool_call", { agent: agent.name, tool: toolBlock.name, args: toolBlock.input });

      const result = await agent.executor.execute(toolBlock.name, toolBlock.input as Record<string, unknown>);

      sendEvent("agent_tool_result", {
        agent: agent.name,
        tool: toolBlock.name,
        result: result.success ? result.data : { error: result.error },
        success: result.success,
      });

      toolResults.push({ tool: toolBlock.name, data: result.data, success: result.success });

      results.push({
        type: "tool_result",
        tool_use_id: toolBlock.id,
        content: JSON.stringify(result.success ? result.data : { error: result.error }),
      });
    }

    messages.push({ role: "user", content: results });
  }

  return { text: finalText.trim(), toolResults };
}

// ─── Main Swarm Launch ──────────────────────────────────────────────────────

export async function launchTokenSwarm(
  description: string,
  sendEvent: SendEventFn
): Promise<void> {
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
  const network = NETWORKS[networkName];

  sendEvent("swarm_start", { agents: ["Creator", "Liquidity", "Distributor"] });

  // ── Phase 1: Setup wallets ──────────────────────────────────────────────

  sendEvent("status", { message: "Setting up agent wallets..." });

  let creatorWallet, liquidityWallet, distributorWallet;

  try {
    // Creator uses the main funded wallet
    if (process.env.AGENT_MNEMONIC) {
      creatorWallet = await importWallet(process.env.AGENT_MNEMONIC, networkName);
    } else {
      creatorWallet = await createWallet(networkName);
      if (network.faucetUrl) {
        await requestFaucet(creatorWallet.address, networkName);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }

    // Liquidity & Distributor get ephemeral wallets
    liquidityWallet = await createWallet(networkName);
    distributorWallet = await createWallet(networkName);

    // Fund them from faucet
    if (network.faucetUrl) {
      await Promise.all([
        requestFaucet(liquidityWallet.address, networkName),
        requestFaucet(distributorWallet.address, networkName),
      ]);
      await new Promise((r) => setTimeout(r, 3000));
    }
  } catch (err) {
    sendEvent("error", { message: `Wallet setup failed: ${(err as Error).message}` });
    sendEvent("done", {});
    return;
  }

  // ── Phase 2: Connect agents to chain ────────────────────────────────────

  sendEvent("status", { message: "Connecting agents to blockchain..." });

  let creatorClient: TxClient, liquidityClient: TxClient, distributorClient: TxClient;

  try {
    const timeout = (p: Promise<TxClient>) =>
      Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Connection timeout")), 30000))]);

    [creatorClient, liquidityClient, distributorClient] = await Promise.all([
      timeout(TxClient.connectWithWallet(creatorWallet)),
      timeout(TxClient.connectWithWallet(liquidityWallet)),
      timeout(TxClient.connectWithWallet(distributorWallet)),
    ]);
  } catch (err) {
    sendEvent("error", { message: `Chain connection failed: ${(err as Error).message}` });
    sendEvent("done", {});
    return;
  }

  // Build agent objects
  const agents: SwarmAgent[] = [
    {
      name: "Creator",
      role: "Token creator — issue the Smart Token on-chain",
      goal: "Parse the description, choose parameters, and issue the token",
      color: "#00ff88",
      client: creatorClient,
      address: creatorWallet.address,
      executor: new DemoToolExecutor(creatorClient, networkName),
    },
    {
      name: "Liquidity",
      role: "DEX liquidity provider — list the token on the DEX",
      goal: "Place initial buy/sell orders for the newly created token",
      color: "#00b4d8",
      client: liquidityClient,
      address: liquidityWallet.address,
      executor: new DemoToolExecutor(liquidityClient, networkName),
    },
    {
      name: "Distributor",
      role: "Token distributor — handle initial allocations",
      goal: "Send tokens to allocation addresses (community, treasury, etc.)",
      color: "#f72585",
      client: distributorClient,
      address: distributorWallet.address,
      executor: new DemoToolExecutor(distributorClient, networkName),
    },
  ];

  // Emit agent init events
  for (const agent of agents) {
    sendEvent("agent_init", { agent: agent.name, address: agent.address, color: agent.color });
  }

  // Check Creator balance
  const balance = await creatorClient.getCoreBalance(creatorWallet.address);
  if (balance < 11) {
    sendEvent("error", { message: `Creator has insufficient balance (${balance} CORE). Need at least 11.` });
    agents.forEach((a) => a.client.disconnect());
    sendEvent("done", {});
    return;
  }

  sendEvent("status", { message: "All agents connected. Starting swarm..." });

  // ── Phase 3: Creator creates the token ──────────────────────────────────

  const sharedState: Record<string, string> = {};

  sendEvent("agent_task_start", { agent: "Creator", task: "Create the Smart Token" });

  const creatorPrompt = getAgentPrompt(agents[0], agents.slice(1), networkName, sharedState);
  const creatorResult = await runAgentTask(
    agents[0],
    `Create this Smart Token on the TX blockchain: ${description}

After issuing the token, also check its info with tx_get_token_info to confirm it was created.
Report the full denom and tx hash.`,
    creatorPrompt,
    sendEvent
  );

  sendEvent("agent_task_complete", { agent: "Creator", result: creatorResult.text });

  // Extract token info from Creator's tool results
  let tokenDenom: string | undefined;
  let tokenTxHash: string | undefined;
  let tokenSupply: string | undefined;
  let tokenFeatures: Record<string, boolean> | undefined;
  let tokenDecimals: number | undefined;

  for (const tr of creatorResult.toolResults) {
    if (tr.tool === "tx_issue_smart_token" && tr.success) {
      const data = tr.data as { denom?: string; txHash?: string };
      if (data.denom) tokenDenom = data.denom;
      if (data.txHash) tokenTxHash = data.txHash;
    }
  }

  if (!tokenDenom) {
    sendEvent("error", { message: "Creator agent failed to issue the token." });
    agents.forEach((a) => a.client.disconnect());
    sendEvent("done", {});
    return;
  }

  // Update shared state
  sharedState["token_denom"] = tokenDenom;
  sharedState["token_tx_hash"] = tokenTxHash ?? "";
  sharedState["creator_address"] = creatorWallet.address;

  sendEvent("state_update", { key: "token_denom", value: tokenDenom, setter: "Creator" });
  sendEvent("agent_message", { from: "Creator", to: "Liquidity", type: "alert", payload: `Token created: ${tokenDenom}` });
  sendEvent("agent_message", { from: "Creator", to: "Distributor", type: "alert", payload: `Token created: ${tokenDenom}` });

  // ── Phase 4: Creator sends tokens to Liquidity and Distributor agents ───

  sendEvent("agent_task_start", { agent: "Creator", task: "Fund other agents with tokens" });

  // Get token info for supply
  const tokenInfoPrompt = getAgentPrompt(agents[0], agents.slice(1), networkName, sharedState);
  const fundResult = await runAgentTask(
    agents[0],
    `You just created the token ${tokenDenom}. Now send some tokens to the other agents so they can work:

1. Send 20% of supply to Liquidity agent at ${liquidityWallet.address} (for DEX orders)
2. Send 30% of supply to Distributor agent at ${distributorWallet.address} (for allocations)

Use the tx_send_tokens tool with the full denom "${tokenDenom}".
Keep 50% in your own wallet as the creator allocation.`,
    tokenInfoPrompt,
    sendEvent
  );

  sendEvent("agent_task_complete", { agent: "Creator", result: "Funded other agents" });
  sendEvent("agent_message", { from: "Creator", to: "Liquidity", type: "task", payload: "Tokens sent — ready to provide liquidity" });
  sendEvent("agent_message", { from: "Creator", to: "Distributor", type: "task", payload: "Tokens sent — ready to distribute" });

  // ── Phase 5: Liquidity & Distributor run in parallel ────────────────────

  const liquidityPromise = (async () => {
    sendEvent("agent_task_start", { agent: "Liquidity", task: "Place DEX orders" });

    const liqPrompt = getAgentPrompt(agents[1], [agents[0], agents[2]], networkName, sharedState);
    const liqResult = await runAgentTask(
      agents[1],
      `The token ${tokenDenom} has been created and you've received tokens.

Your job: List this token on the TX DEX by placing initial orders.
1. First check your balance to see how many tokens you have
2. Place a SELL limit order for some of your tokens at a reasonable price (e.g. 0.001 utestcore per token)
3. Use baseDenom="${tokenDenom}" and quoteDenom="utestcore"

This creates initial liquidity so others can trade the token.`,
      liqPrompt,
      sendEvent
    );

    sendEvent("agent_task_complete", { agent: "Liquidity", result: liqResult.text });
    return liqResult;
  })();

  const distributorPromise = (async () => {
    sendEvent("agent_task_start", { agent: "Distributor", task: "Allocate tokens" });

    const distPrompt = getAgentPrompt(agents[2], [agents[0], agents[1]], networkName, sharedState);
    const distResult = await runAgentTask(
      agents[2],
      `The token ${tokenDenom} has been created and you've received tokens for distribution.

Your job: Check your token balance, then report the allocation plan.
1. Check your balance of ${tokenDenom}
2. Report how many tokens you hold and the planned distribution:
   - Community: 50% of your allocation
   - Treasury: 30% of your allocation
   - Early supporters: 20% of your allocation

Note: Since this is a demo, just check balances and report the plan. Don't send tokens to random addresses.`,
      distPrompt,
      sendEvent
    );

    sendEvent("agent_task_complete", { agent: "Distributor", result: distResult.text });
    return distResult;
  })();

  // Wait for both to complete
  await Promise.all([liquidityPromise, distributorPromise]);

  // ── Phase 6: Success ────────────────────────────────────────────────────

  const explorerUrl = `${network.explorerUrl}/tx/transactions/${tokenTxHash}`;

  sendEvent("success", {
    denom: tokenDenom,
    txHash: tokenTxHash,
    explorerUrl,
    supply: tokenSupply,
    features: tokenFeatures,
    decimals: tokenDecimals ?? 6,
    network: networkName,
    agents: agents.map((a) => ({ name: a.name, address: a.address })),
    swarmMode: true,
  });

  // Cleanup
  agents.forEach((a) => a.client.disconnect());
  sendEvent("done", {});
}
