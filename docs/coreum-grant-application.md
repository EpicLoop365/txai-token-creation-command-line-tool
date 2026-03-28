# Coreum / TX Ecosystem Grant Application — Wave 4
# Apply at: https://coreum.typeform.com/grants

---

## Project Name
**TXAI Studio** — Autonomous Agent NFT Platform

## One-Liner
Mint AI agents as Smart NFTs that run scripts, earn tokens, build reputations, and hire each other — all enforced on-chain with Coreum Smart Tokens.

---

## Project Description

TXAI Studio is an open-source platform that turns NFTs into autonomous digital workers.

Instead of minting static JPEGs, users mint **Agent NFTs** — Smart NFTs with embedded scripts, permissions, and execution schedules. These agents monitor chains, alert on whale movements, execute trades, post to social media, and earn TX tokens for completed jobs.

### Core Innovation: "NFTs are careers"

Each Agent NFT has:
- **A script** — custom logic stored as base64 in NFT metadata, integrity-verified via SHA-256 hash
- **A resume** — skills, job history, earnings, reputation score
- **A schedule** — cron-based execution engine runs agents autonomously
- **A social presence** — agents auto-compose tweets about their work
- **A job board** — agents get hired, subcontract to specialists, earn passive income for owners

### Built on Coreum Smart Token Features

We leverage Coreum's unique protocol-level features extensively:

| Feature | How We Use It |
|---------|--------------|
| `disable_sending` | **Soulbound identity passes** — Scout Pass NFTs locked to wallet, can't be transferred |
| `whitelisting` | **Controlled transfer** — Pro Passes tradeable only to whitelisted addresses |
| Smart Tokens | **Subscription passes** with on-chain expiration metadata (24h/7d/30d/90d/1yr/lifetime) |
| NFT metadata | **Agent config storage** — scripts, permissions, schedules, reputation all in URI field |
| Token minting | **Job payments** — agents earn TESTCORE/TX for completed tasks |

### Three-Tier Access System (All NFT-Gated)

- **Scout Pass** (Free, soulbound) — Auto-minted on first wallet connect. Basic access.
- **Creator Pass** (50 TX, soulbound) — Unlock agent creation, script editor, job posting.
- **Pro Pass** (200 TX, whitelisted) — Full access + transferable pass, subcontracting, analytics.

---

## What's Already Built (Live on Testnet)

✅ **Token Creator** — Mint fungible Smart Tokens with supply, precision, burn/freeze features
✅ **NFT Minter** — Create NFT classes and mint individual NFTs with metadata
✅ **NFT Airdrop Wizard** — Bulk airdrop NFTs to multiple wallets (live on-chain)
✅ **Agent NFT System** — 7 agent templates (Whale Watcher, Chain Scout, Watchdog, etc.)
✅ **Script Editor** — Write custom agent logic with sandboxed dry-run execution
✅ **Agent Runtime Engine** — Cron scheduler executes agent scripts on interval
✅ **Job Board + Resumes** — Agents list skills, get hired, subcontract to each other
✅ **Reputation Leaderboard** — On-chain track record with star ratings
✅ **Social Feed** — Agents auto-compose tweets with 5 personality types
✅ **Soulbound + Whitelisted Passes** — Three-tier NFT access with expiration
✅ **Duration Pricing** — Subscription passes from 24h to lifetime
✅ **Visitor Analytics** — sendBeacon tracking + dashboard
✅ **Smoke Test Suite** — 18 automated tests covering full platform

### Tech Stack
- **Frontend:** Vanilla JS, single-page app, no framework dependencies
- **Backend:** Node.js + Express on Railway
- **Chain:** Coreum Testnet via CosmJS + Keplr wallet
- **Hosting:** GitHub Pages (frontend) + Railway (API)

---

## Wave 4 Alignment: AI + Blockchain

TXAI Studio directly addresses Wave 4's focus areas:

| Wave 4 Priority | TXAI Studio Feature |
|-----------------|-------------------|
| **AI Agent Marketplaces** | Job board where agents are hired, earn, and subcontract |
| **Real-time Analytics** | Visitor tracking, agent execution logs, reputation leaderboard |
| **Decentralized ID** | Soulbound Scout Pass = on-chain identity NFT |
| **Enterprise dApps** | Subscription pass system with duration pricing for SaaS model |

---

## Roadmap

### Phase 1 — DONE ✅
- Token/NFT creation tools
- Agent NFT minting with scripts
- Soulbound/whitelisted pass system
- Job board + reputation

### Phase 2 — In Progress (Q2 2026)
- Agent runtime connected to live chain data (real whale alerts, real balances)
- Twitter API integration (agents tweet autonomously)
- On-chain job escrow (trustless payments)
- Mainnet deployment

### Phase 3 — Planned (Q3 2026)
- Agent-to-agent marketplace (fully autonomous hiring)
- Cross-chain agents (monitor multiple chains)
- Mobile-friendly PWA
- SDK for third-party agent development

### Phase 4 — Vision (Q4 2026)
- Agent DAOs (agents collectively govern protocols)
- Revenue-sharing NFTs (hold an agent, earn its income)
- Agent training marketplace (fine-tune agent behavior)

---

## Team

**Solo developer** — Full-stack builder, active on Coreum testnet since early 2026. Previously had funds recovered by Cosmo Rescue (a Coreum validator), which inspired the fund-recovery agent template. Deeply embedded in the Coreum community.

---

## Links

- **Live Demo:** https://epicloop365.github.io/txai-studio
- **App:** https://epicloop365.github.io/txai-studio/app.html
- **GitHub:** https://github.com/EpicLoop365/txai-studio
- **API:** https://txai-token-creation-production.up.railway.app
- **Demo Video:** [Attach the 60-second walkthrough you recorded]

---

## Grant Usage

| Allocation | % | Purpose |
|-----------|---|---------|
| Development | 60% | Mainnet deployment, Twitter API, on-chain escrow, cross-chain support |
| Infrastructure | 15% | Railway scaling, RPC nodes, monitoring |
| Security | 10% | Smart contract audit, penetration testing |
| Community | 10% | Documentation, tutorials, developer onboarding |
| Marketing | 5% | Agent NFT launch event, community contests |

---

## Why Coreum?

TXAI Studio couldn't exist on any other chain. We need:
- **`disable_sending`** for soulbound identity (no other chain has this at protocol level)
- **`whitelisting`** for controlled transfer of premium passes
- **Smart Token features** for subscription expiration metadata
- **Low fees** for frequent agent execution transactions
- **Fast finality** for real-time agent responses

Coreum's Smart Tokens ARE the product. We're not building on Coreum — we're building WITH Coreum's unique features as the core value proposition.

---

## Contact
[Your name / email / Twitter / Telegram — fill in before submitting]
