/**
 * dex-tools.ts — Claude AI tool schemas and executor for DEX operations
 */

import {
  TxClient,
  NetworkName,
  DexSide,
  DexOrderType,
  DexTimeInForce,
  placeOrder,
  cancelOrder,
  queryOrderbook,
  queryOrdersByCreator,
  getTokenInfo,
} from "./tx-sdk";

// ─── TOOL SCHEMAS ────────────────────────────────────────────────────────────

interface ClaudeTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

const PLACE_ORDER_TOOL: ClaudeTool = {
  name: "dex_place_order",
  description:
    "Place a limit or market order on the TX on-chain DEX orderbook. Returns the order ID and transaction hash.",
  input_schema: {
    type: "object",
    properties: {
      baseDenom: {
        type: "string",
        description: "The full denom of the token to trade (e.g. 'mytoken-testcore1abc...'). This is the token being bought/sold.",
      },
      quoteDenom: {
        type: "string",
        description: "The quote denom to price against. Usually 'utestcore' for testnet CORE. Defaults to the network's native denom.",
      },
      side: {
        type: "string",
        enum: ["buy", "sell"],
        description: "Order side: 'buy' to purchase baseDenom, 'sell' to sell baseDenom.",
      },
      price: {
        type: "string",
        description: "Price per 1 base unit in quote units (e.g. '0.5' means 0.5 CORE per token). Required for limit orders.",
      },
      quantity: {
        type: "string",
        description: "Amount of base token in smallest units (e.g. '1000000' for 1 token with 6 decimals).",
      },
      orderType: {
        type: "string",
        enum: ["limit", "market"],
        description: "Order type. Default is 'limit'. Market orders fill at best available price.",
      },
    },
    required: ["baseDenom", "side", "quantity"],
  },
};

const CANCEL_ORDER_TOOL: ClaudeTool = {
  name: "dex_cancel_order",
  description: "Cancel an existing open order on the DEX by its order ID.",
  input_schema: {
    type: "object",
    properties: {
      orderId: {
        type: "string",
        description: "The order ID to cancel (e.g. 'ord-1234567890-a1b2').",
      },
    },
    required: ["orderId"],
  },
};

const GET_ORDERBOOK_TOOL: ClaudeTool = {
  name: "dex_get_orderbook",
  description:
    "Fetch the current orderbook (bids and asks) for a trading pair on the DEX.",
  input_schema: {
    type: "object",
    properties: {
      baseDenom: {
        type: "string",
        description: "The base token denom.",
      },
      quoteDenom: {
        type: "string",
        description: "The quote denom. Defaults to network native denom (utestcore).",
      },
    },
    required: ["baseDenom"],
  },
};

const GET_MY_ORDERS_TOOL: ClaudeTool = {
  name: "dex_get_my_orders",
  description: "List all open orders placed by the agent's wallet on the DEX.",
  input_schema: {
    type: "object",
    properties: {},
  },
};

const GET_BALANCE_TOOL: ClaudeTool = {
  name: "dex_get_balance",
  description: "Get all token balances for the agent's wallet.",
  input_schema: {
    type: "object",
    properties: {},
  },
};

const GET_TOKEN_INFO_TOOL: ClaudeTool = {
  name: "dex_get_token_info",
  description: "Get metadata about a specific token (name, symbol, precision, features).",
  input_schema: {
    type: "object",
    properties: {
      denom: {
        type: "string",
        description: "Full token denom to look up.",
      },
    },
    required: ["denom"],
  },
};

export const DEX_TOOLS: ClaudeTool[] = [
  PLACE_ORDER_TOOL,
  CANCEL_ORDER_TOOL,
  GET_ORDERBOOK_TOOL,
  GET_MY_ORDERS_TOOL,
  GET_BALANCE_TOOL,
  GET_TOKEN_INFO_TOOL,
];

// ─── TOOL EXECUTOR ───────────────────────────────────────────────────────────

interface ToolCallResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export class DexToolExecutor {
  constructor(
    private readonly client: TxClient,
    private readonly networkName: NetworkName
  ) {}

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    try {
      switch (toolName) {
        case "dex_place_order": {
          const side = (args.side as string) === "buy" ? DexSide.BUY : DexSide.SELL;
          const orderType = (args.orderType as string) === "market" ? DexOrderType.MARKET : DexOrderType.LIMIT;
          const quoteDenom = (args.quoteDenom as string) || this.client.network.denom;

          if (orderType === DexOrderType.LIMIT && !args.price) {
            return { success: false, error: "Price is required for limit orders." };
          }

          const result = await placeOrder(this.client, {
            baseDenom: args.baseDenom as string,
            quoteDenom,
            side,
            orderType,
            price: args.price as string | undefined,
            quantity: args.quantity as string,
            timeInForce: DexTimeInForce.GTC,
          });

          return { success: result.success, data: result };
        }

        case "dex_cancel_order": {
          const result = await cancelOrder(this.client, args.orderId as string);
          return { success: result.success, data: result };
        }

        case "dex_get_orderbook": {
          const quoteDenom = (args.quoteDenom as string) || this.client.network.denom;
          const book = await queryOrderbook(
            args.baseDenom as string,
            quoteDenom,
            this.networkName
          );
          return {
            success: true,
            data: {
              pair: `${args.baseDenom} / ${quoteDenom}`,
              bidCount: book.bids.length,
              askCount: book.asks.length,
              topBid: book.bids[0] ?? null,
              topAsk: book.asks[0] ?? null,
              bids: book.bids,
              asks: book.asks,
            },
          };
        }

        case "dex_get_my_orders": {
          const orders = await queryOrdersByCreator(this.client.address, this.networkName);
          return {
            success: true,
            data: { address: this.client.address, openOrders: orders.length, orders },
          };
        }

        case "dex_get_balance": {
          const balances = await this.client.getBalances(this.client.address);
          return { success: true, data: { address: this.client.address, balances } };
        }

        case "dex_get_token_info": {
          const info = await getTokenInfo(args.denom as string, this.networkName);
          return { success: true, data: info };
        }

        default:
          return { success: false, error: `Unknown tool: ${toolName}` };
      }
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}

// ─── SYSTEM PROMPTS ──────────────────────────────────────────────────────────

export function getDexAgentSystemPrompt(walletAddress: string, network: string): string {
  return `You are an AI trading agent on the TX blockchain DEX (${network}).
Your agent wallet address: ${walletAddress}

TX has a native on-chain orderbook DEX — no AMMs or liquidity pools. It's a real order book with limit and market orders.

Your capabilities:
1. Place buy/sell limit orders on any trading pair
2. Cancel open orders
3. Query the orderbook for any pair
4. Check your wallet balances and open orders
5. Look up token information

When placing orders:
- baseDenom is the token being traded (e.g. 'mytoken-testcore1abc...')
- quoteDenom is usually 'utestcore' (testnet CORE) — the currency you price against
- price is in quote units per 1 base unit (e.g. '500000' means 0.5 CORE per token if quote is utestcore with 6 decimals)
- quantity is in the base token's smallest units (multiply human amount by 10^precision)
- For a token with precision 6: 1 token = 1000000 smallest units

Important:
- Always check your balance before placing orders
- Confirm the order details with the user before placing
- Be clear about what side (buy/sell), price, and quantity you're using
- All trades are on testnet — no real money at risk
- If the user gives you a human-readable amount (e.g. "100 tokens"), convert to smallest units`;
}

export function getDexChatSystemPrompt(): string {
  return `You are a DEX trading advisor for the TX blockchain orderbook.

TX has a native on-chain orderbook DEX built into the chain. Unlike AMM DEXes (Uniswap, etc.), it uses a real order book with limit orders and market orders. No liquidity pools needed.

Key concepts:
- **Limit Order**: Set your price, order sits in the book until filled or cancelled
- **Market Order**: Fills immediately at the best available price
- **Bid (Buy)**: An offer to buy tokens at a certain price
- **Ask (Sell)**: An offer to sell tokens at a certain price
- **Spread**: The gap between the best bid and best ask
- **Trading Pair**: baseDenom / quoteDenom (e.g. MYTOKEN / CORE)
- All prices are in quote units per 1 base unit

How to help users:
1. Explain how the orderbook works
2. Help them understand bid/ask, spread, depth
3. Suggest trading strategies (e.g. where to set limit prices)
4. Help them figure out the right quantity and price
5. Explain that this is testnet — free to experiment
6. Keep responses concise — under 200 words

When the user is ready to trade, include a JSON config between ===ORDER_CONFIG=== markers:

===ORDER_CONFIG===
{"baseDenom":"token-denom","side":"buy","price":"0.5","quantity":"1000000","orderType":"limit"}
===ORDER_CONFIG===

Only include the config when the user has specified what they want to trade. Don't force it.`;
}
