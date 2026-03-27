# @txai/agent-sdk

**Deploy AI agent swarms on Coreum blockchain.**

Autonomous wallets. Real on-chain trades. Coordinated strategies. Zero human intervention.

[![Live Demo](https://img.shields.io/badge/Live_Demo-solomentelabs.com-7c3aed?style=for-the-badge)](https://solomentelabs.com/#demo)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?style=for-the-badge)](https://www.typescriptlang.org/)

---

## What is this?

TXAI Agent SDK lets you spin up **coordinated AI agents** that operate autonomously on the [Coreum](https://www.coreum.com/) blockchain. Each agent has its own wallet, funds itself, and executes real transactions — trading on the DEX, issuing tokens, minting NFTs, and more.

Think of it as **infrastructure for autonomous blockchain agents**.

```
                    ┌─────────────────┐
                    │     Swarm       │
                    │  (Orchestrator) │
                    └──────┬──────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────▼─────┐ ┌───▼───────┐ ┌──▼──────┐
        │  Agent A   │ │  Agent B  │ │ Agent C │
        │  (Buyer)   │ │ (Seller)  │ │ (Taker) │
        │            │ │           │ │         │
        │ Own Wallet │ │ Own Wallet│ │Own Wallet│
        │ Own Mutex  │ │ Own Mutex │ │Own Mutex│
        └─────┬──────┘ └───┬───────┘ └──┬──────┘
              │            │            │
              └────────────┼────────────┘
                           │
                    ┌──────▼──────┐
                    │ Coreum DEX  │
                    │ (On-Chain)  │
                    └─────────────┘
```

## Quick Start

```typescript
import { Swarm, MarketMakerStrategy } from '@txai/agent-sdk';

// 1. Create a swarm
const swarm = new Swarm({ network: 'testnet' });
swarm.createAgent('MM-Buyer', 'buyer');
swarm.createAgent('MM-Seller', 'seller');
swarm.createAgent('Taker', 'taker');

// 2. Stream events in real-time
swarm.onEvent((event, data) => {
  console.log(`[${event}]`, JSON.stringify(data));
});

// 3. Initialize, fund, and execute
await swarm.initAll();    // Creates wallets, connects to chain
await swarm.fundAll();    // Funds from testnet faucet (~600 TX each)

const result = await swarm.execute(
  new MarketMakerStrategy({
    baseDenom: 'mytoken-testcore1abc...',
    basePrice: 0.001,
  })
);

console.log(`${result.ordersPlaced} orders, ${result.fills} fills`);
swarm.disconnectAll();
```

## Features

### Agent — Autonomous Blockchain Wallet

Each Agent is a self-contained blockchain entity:

```typescript
import { Agent, DexSide } from '@txai/agent-sdk';

const agent = new Agent({ name: 'Trader-1', role: 'buyer' });
await agent.init();
await agent.fundFromFaucet(3);  // ~600 TX

// Check balances
const balance = await agent.getCoreBalance();     // 587.42
const tokens = await agent.getTokenBalance(denom); // 50000000

// Trade on DEX
await agent.placeLimitOrder({
  baseDenom: 'mytoken-testcore1...',
  side: DexSide.BUY,
  price: '1e-3',
  quantity: '100000000',
});

// Issue tokens
await agent.issueToken({
  subunit: 'mytoken',
  name: 'My Token',
  initialAmount: '1000000000000',
  features: { minting: true, burning: true },
});

// Mint NFTs
await agent.issueNFTClass({
  symbol: 'MYNFT',
  name: 'My Collection',
  features: { burning: true, freezing: true },
});
await agent.mintNFT({ classId: 'mynft-testcore1...', id: 'nft-001' });

// Send tokens
await agent.send(recipientAddress, denom, '1000000');

// Raw transaction
await agent.broadcast({
  typeUrl: '/cosmos.bank.v1beta1.MsgSend',
  value: { fromAddress: agent.address, toAddress: to, amount: [{ denom, amount }] },
});

agent.disconnect();
```

### Swarm — Multi-Agent Orchestrator

The Swarm manages agent lifecycles and coordinates strategy execution:

```typescript
import { Swarm } from '@txai/agent-sdk';

const swarm = new Swarm({ network: 'testnet' });

// Create agents
const buyer = swarm.createAgent('Alpha', 'buyer');
const seller = swarm.createAgent('Beta', 'seller');
const taker = swarm.createAgent('Gamma', 'taker');

// Or add existing agents
import { Agent } from '@txai/agent-sdk';
const custom = new Agent({ name: 'Delta', role: 'buyer', mnemonic: '...' });
swarm.addAgent(custom);

// Query agents
swarm.getAgent('Alpha');           // by name
swarm.getAgentsByRole('buyer');    // by role
swarm.size;                        // 4
swarm.running;                     // false

// Lifecycle
await swarm.initAll();
await swarm.fundAll(3);            // 3 faucet requests per agent
swarm.disconnectAll();
```

### Strategies — Pluggable Trading Logic

Strategies are modular and composable:

```typescript
import { MarketMakerStrategy } from '@txai/agent-sdk';

const strategy = new MarketMakerStrategy({
  baseDenom: 'mytoken-testcore1abc...',
  basePrice: 0.001,        // Base price in TX
  buyOrders: 12,            // Number of buy limit orders
  sellOrders: 11,           // Number of sell limit orders
  overlapCount: 6,          // Orders that match (create fills)
  takerEnabled: true,       // Taker sweeps the book
  sellerTokenAmount: 5000,  // Tokens for the seller agent
  takerTokenAmount: 2000,   // Tokens for the taker agent
});

const result = await swarm.execute(strategy);
// { success: true, ordersPlaced: 25, fills: 6, errors: 0 }
```

#### Build Your Own Strategy

```typescript
import { Strategy, StrategyResult, Swarm } from '@txai/agent-sdk';

class MyStrategy implements Strategy {
  readonly name = 'My Custom Strategy';

  async run(swarm: Swarm, emit): Promise<StrategyResult> {
    const buyer = swarm.getAgentsByRole('buyer')[0];

    emit('phase', { message: 'Starting custom strategy...' });

    // Your logic here
    await buyer.placeLimitOrder({ ... });

    return { success: true, ordersPlaced: 1, fills: 0 };
  }
}

await swarm.execute(new MyStrategy());
```

### Real-Time Event Streaming

Every action emits structured events — perfect for UIs, logging, or monitoring:

```typescript
swarm.onEvent((event, data) => {
  switch (event) {
    case 'phase':    // Strategy phase change
    case 'wallet':   // Agent wallet created
    case 'funding':  // Faucet funding result
    case 'balance':  // Balance update
    case 'order':    // Order placed/failed
    case 'fill':     // Order matched
    case 'transfer': // Token transfer
    case 'done':     // Strategy complete
    case 'error':    // Error occurred
  }
});
```

Events are SSE-compatible — stream them directly to a browser:

```typescript
// Express SSE endpoint
app.get('/api/swarm/stream', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });

  swarm.onEvent((event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  });
});
```

## Built-In Strategies

| Strategy | Status | Description |
|----------|--------|-------------|
| **Market Maker** | ✅ Live | 3 agents populate an orderbook with buys, sells, overlapping fills, and taker sweeps |
| **Smart NFT** | 🔜 Coming | AI agents mint, list, and trade NFT collections autonomously |
| **Arbitrage** | 🔜 Coming | Cross-pair arbitrage monitoring and execution |
| **Sentiment Trader** | 🔜 Coming | AI-driven sentiment analysis for trading decisions |

## Architecture

```
@txai/agent-sdk
├── Agent              # Autonomous blockchain wallet
│   ├── Wallet         # Create/import keypairs
│   ├── Funding        # Faucet integration
│   ├── DEX            # Place/cancel orders, query orderbook
│   ├── Tokens         # Issue, mint, burn, freeze smart tokens
│   ├── NFTs           # Issue classes, mint, burn, freeze
│   └── Broadcast      # Sign & send any Cosmos SDK message
│
├── Swarm              # Multi-agent orchestrator
│   ├── Agent Mgmt     # Add, create, query agents
│   ├── Lifecycle      # Init, fund, disconnect all
│   ├── Execution      # Run strategies with event streaming
│   └── Events         # Real-time event emitter (SSE-compatible)
│
└── Strategies         # Pluggable trading/minting logic
    ├── MarketMaker    # Orderbook population strategy
    └── (interface)    # Build your own
```

## Coreum Blockchain

This SDK is built for [Coreum](https://www.coreum.com/) — a layer-1 blockchain with:

- **Native DEX** — On-chain orderbook, no AMM slippage
- **Smart Tokens** — Tokens with built-in features (minting, burning, freezing, whitelisting, clawback)
- **Smart NFTs** — NFTs with programmable behaviors
- **Sub-second finality** — Transactions confirm in ~1 second
- **Low fees** — Fraction of a cent per transaction

Supported networks: `testnet` | `mainnet` | `devnet`

## Requirements

- Node.js 18+
- TypeScript 5+

## Install

```bash
npm install @txai/agent-sdk
```

## Live Demo

See the SDK in action at **[solomentelabs.com](https://solomentelabs.com/#demo)**

The AI Agent Swarm tab on the live platform uses this exact SDK to deploy 3 trading agents that populate a real token orderbook on Coreum testnet — with live streaming, explorer links, and fills.

## License

MIT — [Solomente Labs](https://solomentelabs.com)
