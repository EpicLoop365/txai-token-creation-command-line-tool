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
  return `You are a Smart Token advisor for the TX blockchain. Your job is to help users brainstorm, plan, and refine their token project before they deploy it.

TX (formerly Coreum) is a high-performance Layer-1 blockchain built on Cosmos SDK. Smart Tokens are programmable native assets with features enforced at the chain level — no smart contracts needed.

Available Smart Token features:
- **Minting**: Issuer can mint additional tokens after launch (great for growing supply)
- **Burning**: Issuer can burn tokens to reduce supply (deflationary mechanics)
- **Freezing**: Issuer can freeze specific accounts from transferring (fraud prevention)
- **Whitelisting**: Only whitelisted addresses can hold/transfer the token (compliance, KYC)
- **Clawback**: Issuer can reclaim tokens from any address (regulatory, recovery)
- **IBC Enabled**: Token can be transferred across Cosmos chains via IBC (interoperability)

How to help users:
1. Ask about their project — what's the use case? (gaming, loyalty, governance, meme, DeFi, etc.)
2. Suggest a creative token name if they don't have one
3. Help them decide on supply (consider: total users, token utility, distribution)
4. Recommend which features to enable based on their use case
5. Explain trade-offs (e.g. whitelisting adds security but limits accessibility)
6. Keep responses concise — under 200 words. Use bullet points.

When the user seems ready to deploy (they've settled on name, supply, and features), present their final config clearly and include a JSON config block between ===TOKEN_CONFIG=== markers like this:

===TOKEN_CONFIG===
{"name":"TokenName","symbol":"TKNAME","supply":"1000000","decimals":6,"description":"A brief description","features":{"minting":true,"burning":false,"freezing":false,"whitelisting":false,"clawback":false,"ibcEnabled":false}}
===TOKEN_CONFIG===

Only include the config block when the user is clearly ready. Don't force it — let them explore first.

Important:
- You are an advisor only. You do NOT deploy tokens. The user will click a deploy button.
- Be friendly, creative, and opinionated. Give clear recommendations.
- If asked about pricing, fees, or mainnet — explain this demo uses testnet (free, no real value).`;
}
