/* ===== TXAI — Tiered NFT Access System ===== */
/*
 * Every feature requires an NFT pass. Three tiers:
 *
 *   SCOUT (free mint)  → Browse, view, exchange
 *   CREATOR (paid)     → Create tokens, mint NFTs, basic airdrops, 3 agent templates
 *   PRO (paid)         → All agents, script editor, unlimited airdrops, priority execution
 *
 * Upgrade = pay TX/CORE → mint next tier NFT → old tier stays in wallet as badge
 * All checks client-side (optimistic) + server-side (enforced)
 */

/*
 * Transfer modes (Coreum Smart NFT features):
 *   soulbound   → disable_sending   → can NEVER leave your wallet
 *   whitelisted → whitelisting       → can only transfer to approved addresses (controlled marketplace)
 *   open        → (no restriction)   → fully transferable to anyone
 */
const PASS_TIERS = {
  scout:   { level: 1, name: 'Scout Pass',   icon: '\u{1F50D}', color: '#6b7280', price: 0,    transfer: 'soulbound',   desc: 'Browse, view tokens & NFTs, use DEX' },
  creator: { level: 2, name: 'Creator Pass',  icon: '\u{1F3A8}', color: '#7c6dfa', price: 50,   transfer: 'soulbound',   desc: 'Create tokens, mint NFTs, basic airdrops, 3 agent templates' },
  pro:     { level: 3, name: 'Pro Pass',       icon: '\u{26A1}',  color: '#06d6a0', price: 200,  transfer: 'whitelisted', desc: 'All agents, custom scripts, unlimited airdrops, priority execution' },
};

// Which tier each feature requires
const FEATURE_TIERS = {
  // Scout (free) — level 1
  'view-tokens':      1,
  'view-nfts':        1,
  'exchange':         1,
  'browse-agents':    1,

  // Creator — level 2
  'create-token':     2,
  'mint-nft':         2,
  'basic-airdrop':    2,
  'agent-template':   2,  // prepackaged agents (up to 3)
  'subscriptions':    2,

  // Pro — level 3
  'custom-script':    3,
  'nft-airdrop':      3,  // unlimited airdrops
  'all-agents':       3,
  'agent-script':     3,
  'priority-exec':    3,
  'provider-tools':   3,
};

let gateCache = null;   // { tier, level, ts, wallet, nfts }
let gateChecking = false;

/* ── Get current wallet ── */
function gateGetWallet() {
  return (window.txaiWallet && window.txaiWallet.address)
    || (typeof connectedAddress !== 'undefined' && connectedAddress)
    || null;
}

/* ── Check if user has required tier for a feature ── */
async function tokenGateCheck(blockElementId, feature) {
  const wallet = gateGetWallet();

  if (!wallet) {
    tokenGateShowPrompt(blockElementId, 'connect');
    return true; // blocked
  }

  // Use cache if fresh (60s)
  if (gateCache && gateCache.wallet === wallet && (Date.now() - gateCache.ts < 60000)) {
    return gateEvaluate(blockElementId, feature, gateCache.level);
  }

  // Query chain for user's passes
  try {
    const level = await gateQueryTier(wallet);
    gateCache = { tier: gateLevelToName(level), level, ts: Date.now(), wallet };
    return gateEvaluate(blockElementId, feature, level);
  } catch {
    // Fail open on error
    return false;
  }
}

/* ── Evaluate access ── */
function gateEvaluate(blockElementId, feature, userLevel) {
  const requiredLevel = FEATURE_TIERS[feature] || 1;

  if (userLevel >= requiredLevel) {
    return false; // allowed
  }

  // Blocked — show upgrade prompt
  const requiredTier = gateLevelToName(requiredLevel);
  tokenGateShowPrompt(blockElementId, 'upgrade', requiredTier);
  return true; // blocked
}

/* ── Query chain for highest pass tier ── */
async function gateQueryTier(wallet) {
  try {
    const network = (window.txaiWallet && window.txaiWallet.chainId === 'coreum-mainnet-1') ? 'mainnet' : 'testnet';
    const restBase = network === 'mainnet'
      ? 'https://full-node.mainnet-1.coreum.dev:1317'
      : 'https://full-node.testnet-1.coreum.dev:1317';

    const res = await fetch(`${restBase}/coreum/nft/v1beta1/nfts?owner=${wallet}`);
    const data = await res.json();
    const nfts = data.nfts || [];

    let highestLevel = 0;

    for (const nft of nfts) {
      const classId = (nft.class_id || '').toLowerCase();

      // Check for Pro pass
      if (classId.includes('propass') || classId.includes('pro-pass') || classId.includes('txaipro')) {
        highestLevel = Math.max(highestLevel, 3);
      }
      // Check for Creator pass
      else if (classId.includes('creatorpass') || classId.includes('creator-pass') || classId.includes('txaicreator')) {
        highestLevel = Math.max(highestLevel, 2);
      }
      // Check for Scout pass
      else if (classId.includes('scoutpass') || classId.includes('scout-pass') || classId.includes('txaiscout')) {
        highestLevel = Math.max(highestLevel, 1);
      }
    }

    return highestLevel;
  } catch {
    return 0; // no pass
  }
}

/* ── Level to tier name ── */
function gateLevelToName(level) {
  if (level >= 3) return 'pro';
  if (level >= 2) return 'creator';
  if (level >= 1) return 'scout';
  return 'none';
}

/* ── Get current user tier (from cache) ── */
function gateGetCurrentTier() {
  if (!gateCache) return { level: 0, name: 'none' };
  return { level: gateCache.level, name: gateCache.tier };
}

/* ── Show gate prompt ── */
function tokenGateShowPrompt(nearElementId, reason, requiredTier) {
  const existing = document.getElementById('tokenGatePrompt');
  if (existing) existing.remove();

  const el = document.getElementById(nearElementId);
  if (!el) return;

  const prompt = document.createElement('div');
  prompt.id = 'tokenGatePrompt';
  prompt.className = 'token-gate-prompt';

  if (reason === 'connect') {
    prompt.innerHTML = `
      <div class="token-gate-icon">\u{1F510}</div>
      <div class="token-gate-text">
        <strong>Connect your wallet</strong>
        <span>All tools require a connected wallet + NFT pass.</span>
      </div>
      <button class="token-gate-btn" onclick="globalShowWalletOptions()">Connect Wallet</button>
    `;
  } else if (reason === 'upgrade') {
    const tier = PASS_TIERS[requiredTier] || PASS_TIERS.creator;
    const current = gateGetCurrentTier();
    const currentLabel = current.level > 0
      ? `You have: <strong>${PASS_TIERS[current.name]?.name || 'No Pass'}</strong>`
      : 'You have: <strong>No Pass</strong>';

    prompt.innerHTML = `
      <div class="token-gate-icon">${tier.icon}</div>
      <div class="token-gate-text">
        <strong>${tier.name} required</strong>
        <span>${tier.desc}</span>
        <span class="token-gate-current">${currentLabel}</span>
      </div>
      <button class="token-gate-btn" onclick="tokenGateShowUpgrade('${requiredTier}')">${tier.price > 0 ? 'Upgrade — ' + tier.price + ' TX' : 'Mint Free Pass'}</button>
      <button class="token-gate-dismiss" onclick="this.parentElement.remove()">\u2715</button>
    `;
  } else {
    // Legacy fallback
    prompt.innerHTML = `
      <div class="token-gate-icon">\u{1F3AB}</div>
      <div class="token-gate-text">
        <strong>NFT Pass required</strong>
        <span>Mint a pass to unlock this tool.</span>
      </div>
      <button class="token-gate-btn" onclick="tokenGateShowUpgrade('scout')">Get Access</button>
      <button class="token-gate-dismiss" onclick="this.parentElement.remove()">\u2715</button>
    `;
  }

  el.parentElement.insertBefore(prompt, el);
  setTimeout(() => { if (prompt.parentElement) prompt.remove(); }, 15000);
}

/* ── Show Upgrade Modal ── */
function tokenGateShowUpgrade(targetTier) {
  // Remove any existing prompt
  const existing = document.getElementById('tokenGatePrompt');
  if (existing) existing.remove();

  // Remove any existing modal
  const oldModal = document.getElementById('tokenGateUpgradeModal');
  if (oldModal) oldModal.remove();

  const current = gateGetCurrentTier();

  const modal = document.createElement('div');
  modal.id = 'tokenGateUpgradeModal';
  modal.className = 'gate-modal-overlay';

  let tiersHtml = '';
  for (const [key, tier] of Object.entries(PASS_TIERS)) {
    const isCurrent = current.name === key;
    const isTarget = key === targetTier;
    const isLocked = tier.level > current.level;
    const canUpgrade = tier.level === current.level + 1 || (current.level === 0 && tier.level === 1);
    const isOwned = tier.level <= current.level;

    let btnHtml = '';
    if (isOwned) {
      btnHtml = '<div class="gate-tier-owned">\u2713 Owned</div>';
    } else if (canUpgrade || isTarget) {
      btnHtml = `<button class="gate-tier-buy-btn" onclick="tokenGateMintPass('${key}')">${tier.price === 0 ? 'Mint Free' : 'Upgrade — ' + tier.price + ' TX'}</button>`;
    } else {
      btnHtml = `<div class="gate-tier-locked">\u{1F512} Unlock ${PASS_TIERS[gateLevelToName(tier.level - 1)]?.name || 'previous tier'} first</div>`;
    }

    const transferTags = {
      soulbound:   '<span class="gate-soul-badge soulbound">\u{1F512} Soulbound</span>',
      whitelisted: '<span class="gate-soul-badge whitelisted">\u{1F6E1} Whitelist-Gated</span>',
      open:        '<span class="gate-soul-badge tradeable">\u{1F4B1} Fully Tradeable</span>',
    };
    const soulboundTag = transferTags[tier.transfer] || transferTags.open;

    tiersHtml += `
      <div class="gate-tier-card ${isCurrent ? 'current' : ''} ${isTarget ? 'target' : ''} ${isOwned ? 'owned' : ''}">
        <div class="gate-tier-icon" style="color:${tier.color}">${tier.icon}</div>
        <div class="gate-tier-name">${tier.name}</div>
        ${soulboundTag}
        <div class="gate-tier-price">${tier.price === 0 ? 'Free' : tier.price + ' TX'}</div>
        <div class="gate-tier-desc">${tier.desc}</div>
        <div class="gate-tier-features">
          ${gateGetFeatureList(key)}
        </div>
        ${btnHtml}
      </div>`;
  }

  modal.innerHTML = `
    <div class="gate-modal">
      <div class="gate-modal-header">
        <div class="gate-modal-title">\u{1F680} Upgrade Your Access</div>
        <button class="gate-modal-close" onclick="document.getElementById('tokenGateUpgradeModal').remove()">\u2715</button>
      </div>
      <div class="gate-modal-subtitle">Every tool on TXAI is powered by NFT passes. Upgrade to unlock more.</div>
      <div class="gate-tiers-grid">${tiersHtml}</div>
      <div class="gate-modal-footer">
        <strong>\u{1F512} Soulbound</strong> = locked to your wallet forever &nbsp;|&nbsp;
        <strong>\u{1F6E1} Whitelist-Gated</strong> = transfer to approved addresses via Manage tab &nbsp;|&nbsp;
        All passes enforced at the Coreum protocol level.
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

/* ── Feature lists per tier ── */
function gateGetFeatureList(tierKey) {
  const features = {
    scout: [
      'Browse all tokens & NFTs',
      'Use DEX / Exchange',
      'View agent marketplace',
      'Connect Keplr wallet',
    ],
    creator: [
      'Everything in Scout +',
      'Create Smart Tokens',
      'Mint & airdrop NFTs',
      '3 pre-built agent templates',
      'Create subscription passes',
    ],
    pro: [
      'Everything in Creator +',
      'All agent templates',
      'Custom script editor',
      'Unlimited batch airdrops',
      'Priority agent execution',
      'Provider tools access',
    ],
  };

  const list = features[tierKey] || [];
  return list.map(f => `<div class="gate-feature-item">\u2713 ${f}</div>`).join('');
}

/* ── Mint / Upgrade Pass ── */
async function tokenGateMintPass(tierKey) {
  const tier = PASS_TIERS[tierKey];
  if (!tier) return;

  const wallet = gateGetWallet();
  if (!wallet) {
    alert('Connect your wallet first.');
    return;
  }

  // Find the buy button and show loading
  const btns = document.querySelectorAll('.gate-tier-buy-btn');
  btns.forEach(b => { b.disabled = true; b.textContent = 'Minting...'; });

  try {
    // For paid tiers, we need to send payment first, then mint
    if (tier.price > 0) {
      // Send payment to platform wallet
      const payRes = await fetch(`${API_URL}/api/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'testcore15s5gdh74x5fwwyyt2wspahdqmhf0x5nzvlelcf', // Platform wallet
          amount: tier.price,
          denom: 'utestcore',
          memo: `TXAI Pass Upgrade: ${tierKey}`,
        }),
      });
      const payData = await payRes.json();
      if (!payRes.ok || payData.error) {
        throw new Error(payData.error || 'Payment failed');
      }
    }

    // Mint the pass NFT
    const passName = tier.name;
    const passSymbol = tierKey.toUpperCase() + 'PASS';
    const metadata = {
      type: 'access-pass',
      tier: tierKey,
      level: tier.level,
      name: passName,
      transfer: tier.transfer,  // soulbound | whitelisted | open
      features: Object.entries(FEATURE_TIERS)
        .filter(([, lvl]) => lvl <= tier.level)
        .map(([feat]) => feat),
      issuedAt: new Date().toISOString(),
      wallet: wallet,
    };

    // Build Coreum Smart NFT features based on transfer mode
    const nftFeatures = [];
    if (tier.transfer === 'soulbound') {
      nftFeatures.push('disable_sending');   // Protocol-level: NFT can never be transferred
    } else if (tier.transfer === 'whitelisted') {
      nftFeatures.push('whitelisting');      // Protocol-level: only whitelisted addresses can receive
    }
    // 'open' = no features added, fully transferable

    const res = await fetch(`${API_URL}/api/nft-airdrop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: passName,
        symbol: passSymbol,
        description: tier.desc,
        uri: 'data:application/json;base64,' + btoa(JSON.stringify(metadata)),
        recipients: [wallet],
        features: nftFeatures,
      }),
    });

    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Mint failed');

    // Success — update cache
    gateCache = { tier: tierKey, level: tier.level, ts: Date.now(), wallet };

    // Update modal
    const modal = document.getElementById('tokenGateUpgradeModal');
    if (modal) {
      const modalContent = modal.querySelector('.gate-modal');
      if (modalContent) {
        modalContent.innerHTML = `
          <div class="gate-upgrade-success">
            <div class="gate-success-icon">\u{1F389}</div>
            <div class="gate-success-title">${tier.name} Activated!</div>
            <div class="gate-success-desc">Your ${tier.name} NFT has been minted to your wallet. New tools are now unlocked.</div>
            <div class="gate-success-class">Class: ${data.classId || 'N/A'}</div>
            <button class="gate-tier-buy-btn" onclick="document.getElementById('tokenGateUpgradeModal').remove()">Start Building</button>
          </div>
        `;
      }
    }

    // Also trigger dev mode check (in case they got a pro pass)
    if (typeof agentNftAutoCheckDev === 'function') agentNftAutoCheckDev();

  } catch (err) {
    alert('Upgrade failed: ' + err.message);
    btns.forEach(b => { b.disabled = false; b.textContent = 'Try Again'; });
  }
}

/* ── Clear cache (call on wallet change) ── */
function tokenGateClearCache() {
  gateCache = null;
}

/* ── Handle gated API responses ── */
function tokenGateHandleResponse(data) {
  if (data && data.gated === true) {
    if (gateCache) gateCache.ts = 0; // invalidate
    return true;
  }
  return false;
}

/* ── Render pass status badge in nav ── */
function tokenGateRenderBadge() {
  const el = document.getElementById('gatePassBadge');
  if (!el) return;

  const current = gateGetCurrentTier();
  if (current.level === 0) {
    el.innerHTML = '<span class="gate-badge none" onclick="tokenGateShowUpgrade(\'scout\')">No Pass</span>';
  } else {
    const tier = PASS_TIERS[current.name];
    el.innerHTML = `<span class="gate-badge ${current.name}" onclick="tokenGateShowUpgrade('${current.name}')" style="border-color:${tier.color}">${tier.icon} ${tier.name}</span>`;
  }
}

/* ── Auto-check tier on load ── */
async function tokenGateInit() {
  const wallet = gateGetWallet();
  if (!wallet) return;

  const level = await gateQueryTier(wallet);
  gateCache = { tier: gateLevelToName(level), level, ts: Date.now(), wallet };
  tokenGateRenderBadge();
}
