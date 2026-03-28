# TX Governance Proposal — Community Grant
# Format: On-chain governance vote (like Proposals #36-38)

---

## Proposal Title
**TXAI: Proof-of-Contribution Distribution Engine for TX Smart Token Ecosystems**

---

## Proposal Summary (what stakers see before voting)

TXAI Studio is a working platform (live on testnet) that lets anyone mint AI Agent NFTs — autonomous workers that execute on-chain, earn tokens, and build reputations. We're requesting community pool funding to deploy on mainnet.

**What's in it for every TX staker:**

1. **You earn more.** TXAI introduces a second reward layer for ALL TX delegators — not tied to any validator. Stake TX → qualify for TXAI rewards. Use the platform → earn significantly more. Your stake becomes the entry ticket to a larger economy.

2. **More fees for you.** Every agent running is constant transaction volume. 100 agents at 5-min intervals = 28,800 tx/day. Job payments, pass mints, subscription renewals — all TX fees distributed to stakers.

3. **Buy pressure on TX.** Creator Pass (50 TX), Pro Pass (200 TX), job payments, subscription renewals — all denominated in TX. Sustained demand, not one-time hype.

4. **TX becomes the smart chain.** This is the first project using `disable_sending`, `whitelisting`, and Smart Token metadata together. It proves TX can do things no other chain can. That attracts builders → more projects → more fees.

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

100 active agents at 5-min intervals = ~28,800 transactions/day. 1,000 agents = 288,000 tx/day. These fees go to stakers.

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
| On-chain job escrow | 20% | Trustless agent payments (more tx for stakers) |
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

**The flywheel:** Stake → Use → Deploy Agents → Earn → Reinvest → More activity → More fees for all stakers

### Requested Amount
[TO BE DETERMINED — research typical community pool grant sizes for TX governance]

### Why TX and Only TX

This platform literally cannot exist on Ethereum, Solana, or any other chain because:
- No other chain has `disable_sending` at the protocol level (soulbound by protocol, not by contract hack)
- No other chain has `whitelisting` for controlled transfers
- No other chain's NFT standard supports the metadata flexibility TX Smart Tokens provide
- TX's low fees make frequent agent execution economically viable

We don't use TX because it's convenient. We use TX because it's the only chain where this is possible.

### Team
Solo developer, active community member. Had funds personally recovered by Cosmo Rescue (TX validator), which inspired the fund-recovery agent template. Building on TX because I believe in the technology, not because of a grant.

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
- Reach out to Cosmo Rescue — they'd benefit from the fund-recovery agent template
- Ask 2-3 validators to publicly support before going on-chain
