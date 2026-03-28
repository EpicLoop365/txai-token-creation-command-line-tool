# TXAI: Proof-of-Contribution Distribution Engine for TX Smart Token Ecosystems

---

## Proposal Summary (what stakers see before voting)

TXAI Studio is a working platform (live on testnet) that lets anyone mint AI Agent NFTs — autonomous workers that execute on-chain, earn tokens, and build reputations. We're requesting community pool funding to deploy on mainnet.

**What's in it for every TX staker:**

1. **You earn more.** TXAI introduces a second reward layer for ALL TX delegators — not tied to any validator. Stake TX → qualify for TXAI rewards. Use the platform → earn significantly more. Your stake becomes the entry ticket to a larger economy.

2. **More network activity.** Every agent that triggers an action — a trade, a job payment, a pass mint, a subscription renewal — is real on-chain usage. More agents = more adoption = a stronger, more active network.

3. **Buy pressure on TX.** Creator Pass (50 TX), Pro Pass (200 TX), job payments, subscription renewals — all denominated in TX. Sustained demand, not one-time hype.

4. **TX becomes the smart chain.** This is the first project using `disable_sending`, `whitelisting`, and Smart Token metadata together. It proves TX can do things no other chain can. That attracts builders → more projects → stronger ecosystem.

**This isn't an idea.** Token creator, NFT minter, airdrop wizard, 7 agent templates, script editor, job board, soulbound passes, runtime engine — all built, all testable right now.

---

## Full Description

### The Problem
NFTs on most chains are static — you buy a JPEG and hope someone buys it for more. There's no utility, no revenue, no reason to hold long-term. This hurts chains because NFT activity dies after the initial mint hype.

### The Solution: NFTs are careers
TXAI Studio turns NFTs into autonomous workers. Each Agent NFT has:

- **A script** — Custom logic that runs on a schedule (monitor wallets, alert on whale moves, execute trades)
- **A resume** — Track record of completed jobs, earnings, reputation
- **A job board** — Agents get hired by other users, earn TX for their owners
- **Subcontracting** — Lead agents hire specialist agents for complex tasks

### Why This Benefits TX Stakers

**1. Transaction volume**
Every agent creates recurring transactions:
- Script execution checks (every 30s-5min per agent)
- Job payments between wallets
- Pass mints and renewals
- Airdrop distributions
- Social feed updates

More agents running = more real on-chain usage, proving TX is the chain where autonomous economies get built.

**2. Token demand**
- Creator Pass costs 50 TX (soulbound — burned from circulation)
- Pro Pass costs 200 TX (whitelisted — controlled supply)
- Job payments in TX
- Subscription renewals in TX
- All of this creates sustained buy pressure

**3. Ecosystem showcase**
TXAI Studio is the first project to use ALL of these Smart Token features together:
- `disable_sending` → Soulbound identity passes
- `whitelisting` → Controlled-transfer premium passes
- NFT metadata → Agent script storage with SHA-256 integrity
- Duration-based expiry → Subscription model enforced on-chain

This proves TX Smart Tokens are more powerful than any other chain's NFT standard. That attracts developers.

**4. Open source**
Everything is open source. Other builders can fork it, extend it, build on top of it. One grant funds an entire ecosystem of agent-powered dApps.

### What's Already Built

| Feature | Status |
|---------|--------|
| Token Creator (mint, burn, freeze) | ✅ Live on testnet |
| NFT Minter + Airdrop Wizard | ✅ Live on testnet |
| 7 Agent NFT templates | ✅ Live on testnet |
| Script Editor + Sandbox | ✅ Live on testnet |
| Agent Runtime Engine | ✅ Live on testnet |
| Job Board + Reputation | ✅ Live on testnet |
| Soulbound + Whitelisted Passes | ✅ Live on testnet |
| Duration Pricing (24h → lifetime) | ✅ Live on testnet |
| Auto-mint Scout Pass | ✅ Live on testnet |
| Agent Social Feed | ✅ Live on testnet |
| Smoke Test Suite (18 tests) | ✅ Passing |

**Demo:** https://solomentelabs.com
**App:** https://solomentelabs.com/app.html
**GitHub:** https://github.com/EpicLoop365/txai-studio

### What The Grant Funds

| Item | % | What It Does |
|------|---|-------------|
| Mainnet deployment | 30% | Move from testnet to production mainnet |
| On-chain job escrow | 20% | Trustless agent payments with escrow |
| Twitter API integration | 15% | Agents tweet autonomously, bringing attention to TX |
| Security audit | 15% | Professional audit before mainnet launch |
| Cross-chain agents | 10% | Monitor other chains, bring activity back to TX |
| Documentation + onboarding | 10% | Help other builders create agents |

### Milestones (Accountability)

| Milestone | Deliverable | Timeline |
|-----------|------------|----------|
| M1 | Mainnet deployment + first 10 live agents | 30 days |
| M2 | On-chain job escrow + autonomous Twitter agents | 60 days |
| M3 | Security audit complete + SDK for third-party agents | 90 days |
| M4 | Cross-chain monitoring + 100 active agents | 120 days |

### Proof-of-Contribution Distribution

This is not a traditional airdrop. TXAI distributes ownership based on three layers of contribution:

**1. Capital Score — Stakers (30% of distribution)**
- Every TX delegator qualifies — not tied to any validator
- Score = Staked Amount × Time Multiplier
- Longer commitment = larger share

**2. Usage Score — Builders & Traders (30% of distribution)**
- Token creation, trades, liquidity provision, smart token interactions
- Higher-value activity weighted more heavily

**3. Agent Score — Autonomous Activity (20% of distribution)**
- Agents earn based on tasks executed, uptime, and results
- Agent owners earn passively from their agent's work
- This is the differentiator — no other project rewards autonomous on-chain work

**Remaining: 10% Ecosystem/Grants + 10% Team (vested)**

**Rollout Phases:**
- **Phase 1 — Bootstrap:** Heavy weight on stakers. Goal: attract capital and attention
- **Phase 2 — Activation:** Increase usage rewards. Goal: drive real platform engagement
- **Phase 3 — Autonomy:** Emphasize agent rewards. Goal: let the system scale itself

**Anti-gaming:** Soulbound Scout Pass (auto-minted on wallet connect) = one identity per wallet, enforced at protocol level via `disable_sending`. Minimum thresholds prevent dust spam. Agent reputation scores prevent farming empty bots.

**The flywheel:** Stake → Use → Deploy Agents → Earn → Reinvest → More adoption → Stronger network

### Infrastructure Plan & Cost Justification

**Current Stack (covers 0–1,000 users):**

| Service | Cost | Handles |
|---------|------|---------|
| Railway (API hosting) | $5/mo | Single instance, auto-deploy from GitHub |
| GitHub Pages (frontend) | Free | Static site hosting, custom domain |
| Coreum testnet | Free | All chain interactions during development |
| Domain (solomentelabs.com) | $12/yr | Professional web presence |
| **Current monthly burn** | **~$6/mo** | **Fully functional, live today** |

This is intentional. We built lean to prove the concept before asking for money. Every feature works on $6/month.

**Phase 2 — Mainnet + Growth (1,000–10,000 users):**

| Service | Cost | Why |
|---------|------|-----|
| Railway Pro or Fly.io | $20-50/mo | Multiple instances, persistent runtime |
| PostgreSQL (managed) | $15-30/mo | Replace in-memory storage for analytics, agent logs, job history |
| Coreum mainnet | Gas costs | Real CORE for agent execution, pass minting |
| Redis (caching) | $10/mo | Agent state, session cache, rate limiting |
| **Monthly burn** | **$50-100/mo** | **Scales to 10K users** |

**Phase 3 — Scale (10,000+ users):**

| Service | Cost | Why |
|---------|------|-----|
| Dedicated cloud (AWS/GCP or Akash) | $200-500/mo | Horizontal scaling, load balancing |
| Production database cluster | $100-200/mo | High-availability, backups |
| Monitoring (Datadog/Grafana) | $50/mo | Uptime, error tracking, performance |
| CDN for frontend | $20/mo | Global performance |
| **Monthly burn** | **$400-1,000/mo** | **Scales to 100K+ users** |

**Why this matters for voters:** We're not asking for money to figure out if this works. We already proved it works on $6/month. The grant funds the transition from "working testnet demo" to "production mainnet product" — with clear, accountable infrastructure costs at every stage.

**12-month infrastructure budget: $3,000–$6,000** (less than 10% of the grant). The rest goes to development, audit, and ecosystem growth.

### Requested Amount

**50,000 CORE** (~$15,000–$25,000 USD depending on market price)

| Category | Amount | % |
|----------|--------|---|
| Development (6 months full-time) | 20,000 CORE | 40% |
| Security audit (pre-mainnet) | 10,000 CORE | 20% |
| Mainnet deployment + infrastructure (12 months) | 5,000 CORE | 10% |
| On-chain job escrow development | 5,000 CORE | 10% |
| Twitter API + agent social integration | 3,000 CORE | 6% |
| Documentation + developer onboarding | 3,000 CORE | 6% |
| Cross-chain agent monitoring | 2,000 CORE | 4% |
| Community bounties + ecosystem grants | 2,000 CORE | 4% |

**Accountability:** Funds drawn in milestone-based tranches. Each milestone has a deliverable + demo. Community can verify progress at any time at https://solomentelabs.com.

### Why TX and Only TX

This platform literally cannot exist on Ethereum, Solana, or any other chain because:
- No other chain has `disable_sending` at the protocol level (soulbound by protocol, not by contract hack)
- No other chain has `whitelisting` for controlled transfers
- No other chain's NFT standard supports the metadata flexibility TX Smart Tokens provide
- TX's low fees make frequent agent execution economically viable

We don't use TX because it's convenient. We use TX because it's the only chain where this is possible.

### Team
CS degree, object-oriented background (C++, Java, Linux). Former build engineer at a top software company. Previously built production-scale web scraping and data pipeline systems. Open-source advocate. Active TX community member with hundreds of posts on X covering Smart Tokens, AI agents, and blockchain architecture.

---

## Vote
- **YES** — Fund TXAI Studio to bring agent NFTs to TX mainnet, increasing transaction volume and showcasing Smart Token capabilities
- **NO** — Do not fund this project
- **ABSTAIN** — No opinion
- **NO WITH VETO** — This proposal should not have been submitted

---

## Notes for Submitting

1. You'll need to submit via `tx gov submit-proposal` CLI command or through a governance UI
2. There's usually a deposit required (check current params — typically 1000+ CORE)
3. The deposit is returned if the proposal passes or fails normally
4. The deposit is burned only if >33% vote NO WITH VETO
5. Consider reaching out to validators BEFORE submitting — get informal support first
6. SHΣA and other validators you know could champion the proposal
7. Share the demo video with validators during the deposit period

### Pre-Vote Strategy
- DM SHΣA with demo video + proposal draft
- Post in TX Discord / Telegram governance channels
- Reach out to Cosmo Rescue — potential partnership for agent templates
- Ask 2-3 validators to publicly support before going on-chain
