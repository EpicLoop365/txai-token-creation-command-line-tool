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
/*
 * Duration options:
 *   0 = lifetime (never expires)
 *   N = days until expiry
 *
 * Renewal: pay again → mint new pass with fresh expiry. Old expired pass stays as history badge.
 */
const PASS_DURATIONS = [
  { days: 1,   label: '24 Hours', multiplier: 0.1 },     // 10% of monthly price
  { days: 7,   label: '7 Days',   multiplier: 0.3 },     // 30% of monthly price
  { days: 30,  label: '30 Days',  multiplier: 1 },        // base price
  { days: 90,  label: '90 Days',  multiplier: 2.7 },      // 10% off (3x * 0.9)
  { days: 365, label: '1 Year',   multiplier: 9 },        // 25% off (12x * 0.75)
  { days: 0,   label: 'Lifetime', multiplier: 25 },       // ~2 years worth, never expires
];

const PASS_TIERS = {
  scout:   { level: 1, name: 'Scout Pass',   icon: '\u{1F50D}', color: '#6b7280', price: 0,    transfer: 'soulbound',   duration: 0, autoMint: true, desc: 'Free identity pass — required for all tools. Auto-minted on first connect.' },
  creator: { level: 2, name: 'Creator Pass',  icon: '\u{1F3A8}', color: '#7c6dfa', price: 50,   transfer: 'soulbound',   duration: 30, desc: 'Create tokens, mint NFTs, basic airdrops, 3 agent templates' },
  pro:     { level: 3, name: 'Pro Pass',       icon: '\u{26A1}',  color: '#06d6a0', price: 200,  transfer: 'whitelisted', duration: 30, desc: 'All agents, custom scripts, unlimited airdrops, priority execution' },
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

let gateCache = null;   // { tier, level, ts, wallet, expiresAt, expired }
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
    return gateEvaluate(blockElementId, feature, gateCache);
  }

  // Query chain for user's passes (now returns full info including expiry)
  try {
    const result = await gateQueryTier(wallet);
    gateCache = { ...result, ts: Date.now(), wallet };
    return gateEvaluate(blockElementId, feature, gateCache);
  } catch {
    // Fail open on error
    return false;
  }
}

/* ── Evaluate access ── */
function gateEvaluate(blockElementId, feature, cacheEntry) {
  const requiredLevel = FEATURE_TIERS[feature] || 1;
  const userLevel = cacheEntry.level || 0;

  // Check if pass has expired
  if (cacheEntry.expired && userLevel >= requiredLevel) {
    tokenGateShowPrompt(blockElementId, 'expired', cacheEntry.tier);
    return true; // blocked — expired
  }

  if (userLevel >= requiredLevel) {
    return false; // allowed
  }

  // Blocked — show upgrade prompt
  const requiredTier = gateLevelToName(requiredLevel);
  tokenGateShowPrompt(blockElementId, 'upgrade', requiredTier);
  return true; // blocked
}

/* ── Query chain for highest pass tier + check expiry ── */
async function gateQueryTier(wallet) {
  try {
    const network = (window.txaiWallet && window.txaiWallet.chainId === 'coreum-mainnet-1') ? 'mainnet' : 'testnet';
    const restBase = network === 'mainnet'
      ? 'https://full-node.mainnet-1.coreum.dev:1317'
      : 'https://full-node.testnet-1.coreum.dev:1317';

    const res = await fetch(`${restBase}/coreum/nft/v1beta1/nfts?owner=${wallet}`);
    const data = await res.json();
    const nfts = data.nfts || [];

    let best = { level: 0, tier: 'none', expired: false, expiresAt: null, daysLeft: null };

    for (const nft of nfts) {
      const classId = (nft.class_id || '').toLowerCase();

      // Determine tier from class ID
      let nftLevel = 0;
      let nftTier = 'none';
      if (classId.includes('propass') || classId.includes('pro-pass') || classId.includes('txaipro')) {
        nftLevel = 3; nftTier = 'pro';
      } else if (classId.includes('creatorpass') || classId.includes('creator-pass') || classId.includes('txaicreator')) {
        nftLevel = 2; nftTier = 'creator';
      } else if (classId.includes('scoutpass') || classId.includes('scout-pass') || classId.includes('txaiscout')) {
        nftLevel = 1; nftTier = 'scout';
      }

      if (nftLevel === 0) continue;

      // Try to parse metadata from URI for expiry check
      let expiresAt = null;
      let expired = false;
      let daysLeft = null;

      try {
        const uri = nft.uri || nft.data?.uri || '';
        if (uri.startsWith('data:application/json;base64,')) {
          const json = JSON.parse(atob(uri.split(',')[1]));
          if (json.expiresAt) {
            expiresAt = json.expiresAt;
            const expiryDate = new Date(json.expiresAt);
            expired = expiryDate <= new Date();
            daysLeft = expired ? 0 : Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
          }
          // Lifetime pass (duration: 0) never expires
          if (json.duration === 0) {
            expired = false;
            daysLeft = null;
            expiresAt = null;
          }
        }
      } catch {
        // Can't parse metadata — assume valid (fail open)
        expired = false;
      }

      // Prefer highest non-expired tier, but track expired highest too
      if (!expired && nftLevel > best.level) {
        best = { level: nftLevel, tier: nftTier, expired: false, expiresAt, daysLeft };
      } else if (expired && nftLevel > best.level && best.level === 0) {
        // Only use expired pass if we have nothing better
        best = { level: nftLevel, tier: nftTier, expired: true, expiresAt, daysLeft: 0 };
      }
    }

    return best;
  } catch {
    return { level: 0, tier: 'none', expired: false, expiresAt: null, daysLeft: null };
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
  if (!gateCache) return { level: 0, name: 'none', expired: false, daysLeft: null, expiresAt: null };
  return {
    level: gateCache.level,
    name: gateCache.tier,
    expired: gateCache.expired || false,
    daysLeft: gateCache.daysLeft,
    expiresAt: gateCache.expiresAt,
  };
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
  } else if (reason === 'expired') {
    const tier = PASS_TIERS[requiredTier] || PASS_TIERS.creator;
    const current = gateGetCurrentTier();
    prompt.innerHTML = `
      <div class="token-gate-icon">\u{23F0}</div>
      <div class="token-gate-text">
        <strong>${tier.name} expired</strong>
        <span>Your ${tier.name} expired${current.expiresAt ? ' on ' + new Date(current.expiresAt).toLocaleDateString() : ''}. Renew to continue using these tools.</span>
      </div>
      <button class="token-gate-btn" onclick="tokenGateShowUpgrade('${requiredTier}')">Renew ${tier.name}</button>
      <button class="token-gate-dismiss" onclick="this.parentElement.remove()">\u2715</button>
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

    // Check if current pass is expired (show renew instead of owned)
    const currentInfo = gateGetCurrentTier();
    const isExpired = isOwned && isCurrent && currentInfo.expired;

    let btnHtml = '';
    if (isOwned && !isExpired) {
      // Show days remaining if applicable
      const daysLeft = currentInfo.daysLeft;
      const expiryNote = (isCurrent && daysLeft !== null && daysLeft > 0)
        ? `<div class="gate-tier-expiry">${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining</div>`
        : (isCurrent && daysLeft === null) ? '<div class="gate-tier-expiry">Lifetime access</div>' : '';
      btnHtml = `<div class="gate-tier-owned">\u2713 Owned</div>${expiryNote}`;
    } else if (isExpired) {
      // Expired — show duration picker + renew
      btnHtml = gateRenderDurationPicker(key, tier);
    } else if (tier.price === 0) {
      btnHtml = `<button class="gate-tier-buy-btn" onclick="tokenGateMintPass('${key}', 0)">Mint Free</button>`;
    } else if (canUpgrade || isTarget) {
      // Paid tier — show duration picker
      btnHtml = gateRenderDurationPicker(key, tier);
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

/* ── Render duration picker for a tier ── */
function gateRenderDurationPicker(tierKey, tier) {
  let html = '<div class="gate-duration-picker">';
  html += '<div class="gate-duration-label">Choose duration:</div>';
  html += '<div class="gate-duration-options">';

  for (const dur of PASS_DURATIONS) {
    if (tier.price === 0 && dur.days !== 0) continue; // Scout is always free lifetime

    const price = dur.days === 0
      ? Math.round(tier.price * dur.multiplier)
      : Math.round(tier.price * dur.multiplier);
    const isDefault = dur.days === 30;
    const perDay = dur.days > 0 ? (price / dur.days).toFixed(1) : '';
    const savingPct = dur.multiplier < dur.days / 30
      ? Math.round((1 - (dur.multiplier / (dur.days / 30))) * 100) + '% off'
      : '';

    html += `
      <button class="gate-dur-btn ${isDefault ? 'default' : ''}"
        onclick="tokenGateMintPass('${tierKey}', ${dur.days})"
        title="${dur.days > 0 ? perDay + ' TX/day' : 'One-time purchase'}">
        <span class="gate-dur-period">${dur.label}</span>
        <span class="gate-dur-price">${price > 0 ? price + ' TX' : 'Free'}</span>
        ${savingPct ? '<span class="gate-dur-save">' + savingPct + '</span>' : ''}
      </button>`;
  }

  html += '</div></div>';
  return html;
}

/* ── Calculate price for tier + duration ── */
function gateCalcPrice(tierKey, durationDays) {
  const tier = PASS_TIERS[tierKey];
  if (!tier || tier.price === 0) return 0;

  const dur = PASS_DURATIONS.find(d => d.days === durationDays);
  if (!dur) return tier.price; // fallback to base

  return Math.round(tier.price * dur.multiplier);
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

/* ── Mint / Upgrade / Renew Pass ── */
async function tokenGateMintPass(tierKey, durationDays) {
  const tier = PASS_TIERS[tierKey];
  if (!tier) return;

  // Default duration
  if (durationDays === undefined) durationDays = tier.duration;

  const wallet = gateGetWallet();
  if (!wallet) {
    alert('Connect your wallet first.');
    return;
  }

  const actualPrice = gateCalcPrice(tierKey, durationDays);

  // Find the buy button and show loading
  const btns = document.querySelectorAll('.gate-tier-buy-btn, .gate-dur-btn');
  btns.forEach(b => { b.disabled = true; });
  const clickedBtn = event && event.target ? event.target.closest('button') : null;
  if (clickedBtn) clickedBtn.textContent = 'Minting...';

  try {
    // For paid tiers, we need to send payment first, then mint
    if (actualPrice > 0) {
      // Send payment to platform wallet
      const payRes = await fetch(`${API_URL}/api/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'testcore15s5gdh74x5fwwyyt2wspahdqmhf0x5nzvlelcf', // Platform wallet
          amount: actualPrice,
          denom: 'utestcore',
          memo: `TXAI Pass: ${tierKey} / ${durationDays}d`,
        }),
      });
      const payData = await payRes.json();
      if (!payRes.ok || payData.error) {
        throw new Error(payData.error || 'Payment failed');
      }
    }

    // Calculate expiry date
    const now = new Date();
    let expiresAt = null;
    if (durationDays > 0) {
      const expiry = new Date(now.getTime() + (durationDays * 24 * 60 * 60 * 1000));
      expiresAt = expiry.toISOString();
    }
    // durationDays === 0 means lifetime (no expiry)

    const durLabel = PASS_DURATIONS.find(d => d.days === durationDays)?.label || durationDays + ' Days';

    // Mint the pass NFT
    const passName = tier.name;
    const passSymbol = tierKey.toUpperCase() + 'PASS';
    const metadata = {
      type: 'access-pass',
      tier: tierKey,
      level: tier.level,
      name: passName,
      transfer: tier.transfer,
      duration: durationDays,
      durationLabel: durLabel,
      expiresAt: expiresAt,          // null = lifetime
      price: actualPrice,
      features: Object.entries(FEATURE_TIERS)
        .filter(([, lvl]) => lvl <= tier.level)
        .map(([feat]) => feat),
      issuedAt: now.toISOString(),
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
    const daysLeft = durationDays > 0 ? durationDays : null;
    gateCache = { tier: tierKey, level: tier.level, ts: Date.now(), wallet, expired: false, expiresAt, daysLeft };

    // Update nav badge
    tokenGateRenderBadge();

    // Update modal
    const expiryMsg = expiresAt
      ? `Expires: ${new Date(expiresAt).toLocaleDateString()} (${durationDays} days)`
      : 'Lifetime access — never expires';

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
            <div class="gate-success-expiry">\u{23F0} ${expiryMsg}</div>
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
  } else if (current.expired) {
    const tier = PASS_TIERS[current.name];
    el.innerHTML = `<span class="gate-badge expired" onclick="tokenGateShowUpgrade('${current.name}')" title="Click to renew">\u{23F0} ${tier.name} (Expired)</span>`;
  } else {
    const tier = PASS_TIERS[current.name];
    const expiryHint = (current.daysLeft !== null && current.daysLeft <= 7)
      ? ` (${current.daysLeft}d left)` : '';
    const warnClass = (current.daysLeft !== null && current.daysLeft <= 3) ? ' expiring-soon' : '';
    el.innerHTML = `<span class="gate-badge ${current.name}${warnClass}" onclick="tokenGateShowUpgrade('${current.name}')" style="border-color:${tier.color}">${tier.icon} ${tier.name}${expiryHint}</span>`;
  }
}

/* ── Auto-check tier on load ── */
async function tokenGateInit() {
  const wallet = gateGetWallet();
  if (!wallet) return;

  const result = await gateQueryTier(wallet);
  gateCache = { ...result, ts: Date.now(), wallet };
  tokenGateRenderBadge();

  // Auto-mint Scout Pass if user has no pass at all
  if (result.level === 0 && PASS_TIERS.scout.autoMint) {
    console.log('[TXAI] No pass found — auto-minting Scout Pass...');
    try {
      await tokenGateAutoMintScout(wallet);
    } catch (err) {
      console.warn('[TXAI] Scout auto-mint failed:', err.message);
    }
  }
}

/* ── Auto-mint free Scout Pass (identity NFT) ── */
async function tokenGateAutoMintScout(wallet) {
  const tier = PASS_TIERS.scout;
  const metadata = {
    type: 'access-pass',
    tier: 'scout',
    level: 1,
    name: tier.name,
    transfer: 'soulbound',
    duration: 0,           // lifetime
    expiresAt: null,        // never expires
    autoMinted: true,
    features: Object.entries(FEATURE_TIERS)
      .filter(([, lvl]) => lvl <= 1)
      .map(([feat]) => feat),
    issuedAt: new Date().toISOString(),
    wallet: wallet,
  };

  const res = await fetch(`${API_URL}/api/nft-airdrop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: tier.name,
      symbol: 'SCOUTPASS',
      description: tier.desc,
      uri: 'data:application/json;base64,' + btoa(JSON.stringify(metadata)),
      recipients: [wallet],
      features: ['disable_sending'],  // Soulbound
    }),
  });

  const data = await res.json();
  if (res.ok && !data.error) {
    console.log('%c\u{1F50D} Scout Pass auto-minted! Class: ' + data.classId, 'color:#6b7280;font-weight:bold');
    gateCache = { tier: 'scout', level: 1, ts: Date.now(), wallet, expired: false, expiresAt: null, daysLeft: null };
    tokenGateRenderBadge();
  }
}
