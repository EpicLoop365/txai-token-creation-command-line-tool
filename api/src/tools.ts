/**
 * tools.ts — Claude tool schemas and executor for token creation
 *
 * Defines the subset of TX tools needed for the demo API and maps
 * Claude tool_use calls to actual blockchain operations.
 */

import {
  TxClient,
  NetworkName,
  issueSmartToken,
  mintTokens,
  getTokenInfo,
  SmartTokenFeatures,
} from "./tx-sdk";

// ─── TOOL SCHEMAS (Anthropic format) ─────────────────────────────────────────

export interface ClaudeTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const ISSUE_SMART_TOKEN_TOOL: ClaudeTool = {
  name: "tx_issue_smart_token",
  description:
    "Issue a new Smart Token on the TX blockchain. Smart Tokens are programmable native assets with built-in business logic enforced at the chain level — no smart contract needed. Returns the full denom and transaction hash of the new token.",
  input_schema: {
    type: "object",
    properties: {
      subunit: {
        type: "string",
        description:
          "Short lowercase identifier for the token (e.g. 'mytoken'). The full denom will be '{subunit}-{issuerAddress}'. Must be 3-50 chars, lowercase alphanumeric only.",
      },
      name: {
        type: "string",
        description: "Human-readable display name of the token (e.g. 'My Agent Token')",
      },
      description: {
        type: "string",
        description: "Brief description of the token's purpose",
      },
      initialAmount: {
        type: "string",
        description:
          "Initial token supply in human-readable units (e.g. '1000000' for 1 million tokens). Will be multiplied by 10^precision internally.",
      },
      precision: {
        type: "number",
        description: "Number of decimal places (default: 6, like CORE)",
      },
      features: {
        type: "object",
        description: "Feature flags to enable on this token",
        properties: {
          minting: {
            type: "boolean",
            description: "Allow issuer to mint additional tokens after issuance",
          },
          burning: {
            type: "boolean",
            description: "Allow issuer to burn tokens to reduce supply",
          },
          freezing: {
            type: "boolean",
            description: "Allow issuer to freeze specific accounts from transferring",
          },
          whitelisting: {
            type: "boolean",
            description: "Restrict transfers to whitelisted addresses only",
          },
          clawback: {
            type: "boolean",
            description: "Allow issuer to reclaim tokens from any address",
          },
          ibcEnabled: {
            type: "boolean",
            description: "Allow token to be transferred via IBC to other Cosmos chains",
          },
        },
      },
      burnRate: {
        type: "string",
        description:
          "Percentage of tokens burned on every transfer (e.g. '0.01' = 1%, '0.05' = 5%). Set to '0' or omit for no burn. Max '1' (100%). This creates a deflationary mechanism.",
      },
      sendCommissionRate: {
        type: "string",
        description:
          "Percentage of tokens sent to the issuer on every transfer as a commission (e.g. '0.02' = 2%). Set to '0' or omit for no commission. Max '1' (100%).",
      },
      uri: {
        type: "string",
        description:
          "URL pointing to token metadata, logo image, or project page (e.g. 'https://myproject.com/logo.png'). Optional.",
      },
      uriHash: {
        type: "string",
        description:
          "SHA256 hash of the content at the URI for integrity verification. Optional — will be left empty if not provided.",
      },
    },
    required: ["subunit", "name", "initialAmount"],
  },
};

const GET_TOKEN_INFO_TOOL: ClaudeTool = {
  name: "tx_get_token_info",
  description:
    "Get detailed information about a token on the TX blockchain, including its supply, issuer, precision, and enabled features. Use this to verify a token was issued correctly.",
  input_schema: {
    type: "object",
    properties: {
      denom: {
        type: "string",
        description:
          "Full token denom to look up (e.g. 'mytoken-testcore1abc...' for Smart Tokens)",
      },
    },
    required: ["denom"],
  },
};

const GET_BALANCE_TOOL: ClaudeTool = {
  name: "tx_get_balance",
  description:
    "Get the token balances for the agent's TX wallet address. Returns all token balances including CORE and any Smart Tokens.",
  input_schema: {
    type: "object",
    properties: {
      address: {
        type: "string",
        description: "The TX wallet address to check. Use the agent's own address.",
      },
    },
    required: ["address"],
  },
};

const MINT_TOKENS_TOOL: ClaudeTool = {
  name: "tx_mint_tokens",
  description:
    "Mint additional units of a Smart Token. Requires the token to have the 'minting' feature enabled. Only the token issuer can mint.",
  input_schema: {
    type: "object",
    properties: {
      denom: {
        type: "string",
        description: "Full denom of the Smart Token (e.g. 'mytoken-testcore1abc...')",
      },
      amount: {
        type: "string",
        description: "Amount to mint in the smallest unit (raw token units)",
      },
      recipient: {
        type: "string",
        description: "Address to receive the minted tokens (defaults to issuer)",
      },
    },
    required: ["denom", "amount"],
  },
};

export const DEMO_TOOLS: ClaudeTool[] = [
  ISSUE_SMART_TOKEN_TOOL,
  GET_TOKEN_INFO_TOOL,
  GET_BALANCE_TOOL,
  MINT_TOKENS_TOOL,
];

// ─── TOOL EXECUTOR ───────────────────────────────────────────────────────────

export interface ToolCallResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export class DemoToolExecutor {
  constructor(
    private readonly client: TxClient,
    private readonly networkName: NetworkName
  ) {}

  async execute(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolCallResult> {
    try {
      switch (toolName) {
        case "tx_issue_smart_token": {
          // Validate initialAmount — catch bad values before hitting the chain
          const rawAmount = Number(args.initialAmount);
          if (!args.initialAmount || isNaN(rawAmount)) {
            return {
              success: false,
              error: `Invalid initialAmount "${args.initialAmount}". Must be a valid number.`,
            };
          }
          if (rawAmount <= 0) {
            return {
              success: false,
              error: `initialAmount must be greater than 0 (got "${args.initialAmount}"). The minimum supply is 1. Suggest using "1" with minting enabled so more can be minted later.`,
            };
          }
          // Guard against JS precision loss and absurdly large supplies.
          // After multiplying by 10^precision the raw integer must stay safe.
          const precision = (args.precision as number) ?? 6;
          const maxSafe = Number.MAX_SAFE_INTEGER / Math.pow(10, precision);
          if (rawAmount > maxSafe) {
            return {
              success: false,
              error: `initialAmount "${args.initialAmount}" is too large (max ~${Math.floor(maxSafe).toLocaleString()} with precision ${precision}). Use a smaller supply — tokens can always be minted later if minting is enabled.`,
            };
          }

          try {
            const result = await issueSmartToken(this.client, {
              subunit: args.subunit as string,
              name: args.name as string,
              description: args.description as string | undefined,
              initialAmount: args.initialAmount as string,
              precision: args.precision as number | undefined,
              features: args.features as SmartTokenFeatures | undefined,
              burnRate: args.burnRate as string | undefined,
              sendCommissionRate: args.sendCommissionRate as string | undefined,
              uri: args.uri as string | undefined,
              uriHash: args.uriHash as string | undefined,
            });
            return { success: result.success, data: result };
          } catch (issueErr) {
            return { success: false, error: `Token issuance failed: ${(issueErr as Error).message}` };
          }
        }

        case "tx_get_token_info": {
          const info = await getTokenInfo(
            args.denom as string,
            this.networkName
          );
          return { success: true, data: info };
        }

        case "tx_get_balance": {
          const address = (args.address as string) || this.client.address;
          const balances = await this.client.getBalances(address);
          return {
            success: true,
            data: {
              address,
              balances,
              summary:
                balances
                  .map((b) => `${b.display} ${b.denom}`)
                  .join(", ") || "No tokens found",
            },
          };
        }

        case "tx_mint_tokens": {
          const result = await mintTokens(
            this.client,
            args.denom as string,
            args.amount as string,
            args.recipient as string | undefined
          );
          return { success: result.success, data: result };
        }

        default:
          return {
            success: false,
            error: `Unknown tool: ${toolName}`,
          };
      }
    } catch (err) {
      return {
        success: false,
        error: `Tool execution failed: ${(err as Error).message}`,
      };
    }
  }
}

// ─── SYSTEM PROMPT ───────────────────────────────────────────────────────────

export function getSystemPrompt(walletAddress: string, network: string): string {
  return `You are an AI agent operating on the TX blockchain (${network}).
Your agent wallet address: ${walletAddress}

TX (formerly Coreum) is a high-performance Layer-1 blockchain built on Cosmos SDK with:
- Native Smart Tokens: programmable assets with built-in business logic (minting, burning, freezing, whitelisting, clawback, IBC). No smart contract needed — features are enforced at the chain level.
- An on-chain order book DEX with deterministic gas
- IBC interoperability with the broader Cosmos ecosystem

Your job is to create Smart Tokens based on natural language descriptions from users.

When creating a token:
1. Parse the user's description to determine token properties (name, symbol/subunit, supply, features)
   - The token NAME is typically the first distinct word/phrase in the description (e.g. "FatFinger, 1000 supply, burnable" → name is "FatFinger")
   - NEVER use generic words like "Token", "Coin", "Asset" as the name. The word "token" in phrases like "no new tokens", "gaming token", or "my token" is descriptive — not the name.
   - If no clear name is given, ask the user or invent a creative name — never default to "TOKEN"
2. Choose sensible defaults for anything not specified:
   - subunit: derive a short lowercase alphanumeric identifier from the name (3-50 chars, no spaces/special chars)
   - initialAmount: default to "1000000" (1 million) if not specified. IMPORTANT: initialAmount must be at least "1" — the chain rejects 0 supply. If the user says "0 supply", explain that the minimum is 1 and suggest using minting feature so they can mint more later.
   - precision: default to 6 decimal places
   - features: enable minting by default so supply can grow; enable other features only if the user asks
   - burnRate: set to "0" by default. If the user wants a deflationary token or mentions "burn on transfer", set a rate (e.g. "0.01" = 1% burned per transfer)
   - sendCommissionRate: set to "0" by default. If the user wants the issuer to earn a commission on transfers, set a rate (e.g. "0.02" = 2% commission per transfer)
3. Use the tx_issue_smart_token tool to create the token on-chain
4. After issuing, use tx_get_token_info to verify it was created successfully
5. Summarize what was created including the full denom and explorer link

Important rules:
- Token subunits must be lowercase alphanumeric, 3-50 characters
- All transactions are final once confirmed — double-check parameters
- You are on ${network}, using testnet tokens (not real money)
- Always be concise and clear in your responses
- If the user's description is vague, make reasonable choices and explain what you chose`;
}

// ─── CHAT SYSTEM PROMPT ─────────────────────────────────────────────────────

export function getChatSystemPrompt(): string {
  return `You are the AI advisor built into TXAI — the Smart Token Utility Platform. You are an expert on everything this platform can do, the underlying TX (Coreum) blockchain, tokenomics, compliance, and real-world utility token design. You are the smartest person in the room on these topics.

═══ ABOUT TXAI ═══
TXAI is not just a token launcher — it's a **Utility Issuance Layer**. Think "Stripe for Smart Tokens." Users come here to create programmable utility tokens (access passes, AI permissions, API keys, compliance wrappers, subscriptions) that are enforced at the protocol level — no smart contracts needed.

The platform has 6 tabs the user can access:
1. **🚀 Create** — AI-powered token creation. Two modes:
   - Quick Create: Describe your project in plain English, AI designs the token config
   - Custom Build: Set every field manually — full control over name, supply, features, economics
2. **⚙️ Manage** — Post-creation token management: mint more supply, burn tokens, freeze/unfreeze accounts, set whitelisted limits, clawback tokens, globally freeze a token
3. **📊 Exchange** — Full orderbook DEX interface. Users can:
   - Trade any token pair against TX (the native currency)
   - View live orderbook depth charts
   - Place limit and market orders
   - Use the AI trading advisor for strategy
4. **🤖 Swarm** — AI Agent Swarm: launches 3 autonomous trading agents (2 market makers + 1 taker) that populate an empty orderbook with real on-chain orders and fills. Creates instant liquidity for newly minted tokens.
5. **🔐 Auth** — AuthZ grants: delegate specific permissions (send, stake, trade) from one wallet to another using Cosmos AuthZ module
6. **🎨 NFT** — Create Smart NFTs with on-chain metadata, freezable, burnable

═══ TX (COREUM) BLOCKCHAIN ═══
TX is a high-performance Layer-1 built on Cosmos SDK + Tendermint BFT consensus. Key facts:
- ~7,000 TPS with ~1.2s block finality
- Smart Tokens are **native chain primitives**, not smart contracts — features are enforced by validators at the protocol level, making them faster, cheaper, and more secure than ERC-20s
- Native DEX built into the chain (not a smart contract DEX)
- IBC-enabled: tokens can move across 50+ Cosmos chains
- WASM smart contract support for advanced use cases
- The native currency is CORE (testnet: utestcore/TX)

═══ SMART TOKEN FEATURES ═══
All features are set at token creation and enforced at the chain level:

**Minting** — Issuer can mint additional tokens post-launch. Use for: growing supply, reward distribution, dynamic issuance.
**Burning** — Issuer can burn tokens to reduce supply. Use for: deflationary mechanics, redemption (burn-to-redeem loyalty points), usage metering.
**Freezing** — Issuer can freeze specific accounts from transferring. Use for: fraud prevention, dispute resolution, regulatory holds.
**Whitelisting** — Only whitelisted addresses can hold/receive the token. Use for: KYC-gated assets, accredited investor tokens, compliance wrappers, private offerings.
**Clawback** — Issuer can reclaim tokens from any address. Use for: regulatory recovery, revocable permissions, corporate compliance.
**IBC Enabled** — Token can be transferred across Cosmos chains via Inter-Blockchain Communication protocol.

**Token Economics (immutable after creation):**
- **Burn Rate** (0-100%): Percentage of tokens auto-burned on every transfer. Creates deflationary pressure. Example: 1% burn on a meme token.
- **Send Commission Rate** (0-100%): Percentage of every transfer sent to the issuer as a fee. Creates passive revenue. Example: 0.5% commission on a marketplace token.
Note: Commission always goes to the issuer wallet — cannot be redirected.

═══ REAL-WORLD USE CASES ═══
Go beyond "just tokens." Help users think about utility:
- **Subscription Passes**: Mint a 30-day access token. Freeze when expired. Burn on cancellation.
- **AI Agent Permissions**: Issue a token that grants an AI agent permission to act. Revocable via clawback.
- **API Keys On-Chain**: Replace traditional API keys with tokens. Burn per API call (usage metering).
- **KYC Compliance Wrappers**: Whitelisted token that only KYC-verified addresses can hold. On-chain audit trail.
- **Loyalty Programs**: Mint on purchase, burn to redeem. Issuer controls supply, can freeze fraudulent accounts.
- **Event Tickets**: Non-transferable (whitelisted to buyer only), or transferable with commission (secondary market royalties).
- **Gaming Currency**: Mintable (reward players), freezable (ban cheaters), burn-to-craft mechanics.
- **DAO Governance**: Fixed supply, IBC-enabled for cross-chain voting.
- **Regulated Assets**: Whitelisting + freezing + clawback = jurisdiction-aware transfer controls.

═══ AI AGENT SWARM (HOW IT WORKS) ═══
The Swarm tab launches 3 AI trading agents that populate an orderbook:
1. **Market Maker A (Buyer)**: Places layered buy orders below mid-price
2. **Market Maker B (Seller)**: Places layered sell orders above mid-price
3. **Taker Bot**: Sweeps both sides to generate fills and price action
- Agents use sub-wallets funded from the server's agent wallet
- All orders are real on-chain transactions on Coreum testnet
- The demo streams events via SSE (Server-Sent Events) in real-time
- After the demo, the user can keep the orderbook live or reclaim tokens

═══ HOW TO RESPOND ═══
- You live in the sidebar of TXAI. Be context-aware — if the user is on Create tab, help with token design. If they mention trading, guide them to Exchange. If they ask about compliance, explain how whitelisting + freezing enables it.
- Be concise: under 200 words. Use bullet points and bold for key terms.
- Be opinionated and creative. Don't just list options — give a clear recommendation.
- When a user describes their project, suggest: token name, supply, which features to enable, and why.
- Explain trade-offs (e.g. "Whitelisting adds compliance but limits accessibility — good for regulated use cases, not for viral distribution").
- When the user is ready to deploy, present their final config and include a JSON config block:

===TOKEN_CONFIG===
{"name":"TokenName","symbol":"TKNAME","supply":"1000000","decimals":6,"description":"A brief description","features":{"minting":true,"burning":false,"freezing":false,"whitelisting":false,"clawback":false,"ibcEnabled":false},"burnRate":"0","sendCommissionRate":"0"}
===TOKEN_CONFIG===

Only include the config block when the user has clearly decided. Don't force it.

- This is a testnet demo — all tokens are free, no real monetary value. If asked about mainnet, pricing, or production — explain it's coming.
- If asked something you don't know, say so honestly rather than guessing.
- You are NOT the deployer. The user clicks the deploy button. You advise.`;
}
