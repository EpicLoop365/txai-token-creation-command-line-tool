/* ===== TXAI - Token Creation Tab ===== */

/* Tab Switching */
function switchTab(tab){
  const tabs = ['create','manage','dex','subs','ai'];
  const wraps = {
    create: document.getElementById('createModeWrap'),
    manage: document.getElementById('manageWrap'),
    dex: document.getElementById('dexWrap'),
    subs: document.getElementById('subsWrap'),
    ai: document.getElementById('aiModeWrap'),
  };

  // Reset all
  tabs.forEach(t => {
    const btn = document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1));
    if(btn) btn.classList.remove('active');
    const w = wraps[t];
    if(!w) return;
    if(t === 'create' || t === 'ai') { w.style.display = 'none'; }
    else w.classList.remove('show');
  });

  // Reset container width when leaving DEX
  const container = wraps.dex?.closest('.container');
  if(container) container.style.maxWidth = '';
  chatMode = false;

  // Activate selected tab
  const btn = document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1));
  if(btn) btn.classList.add('active');

  if(tab === 'dex'){
    wraps.dex.classList.add('show');
    if(!dexAgentWallet) dexFetchWallet();
    if(!document.getElementById('dexPairSelect').options.length || document.getElementById('dexPairSelect').options.length <= 1) dexFetchPairs();
    setTimeout(() => dexDrawDepthChart(), 100);
  } else if(tab === 'manage'){
    wraps.manage.classList.add('show');
    const manageInput = document.getElementById('manageTokenDenom');
    if(manageInput && !manageInput.value.trim()){
      const tokens = typeof txdbGetTokens === 'function' ? txdbGetTokens() : [];
      if(tokens.length > 0){
        manageInput.value = tokens[0].denom;
        if(typeof loadManageToken === 'function') setTimeout(() => loadManageToken(), 200);
      }
    }
    if(manageInput) manageInput.focus();
    if(typeof authLoadGrants === 'function') authLoadGrants();
  } else if(tab === 'subs'){
    wraps.subs.classList.add('show');
    if(typeof subsInit === 'function') subsInit();
  } else if(tab === 'ai'){
    wraps.ai.style.display = '';
  } else {
    wraps.create.style.display = '';
  }
  const activeTab = document.querySelector('.chat-tab.active');
  if(activeTab) activeTab.scrollIntoView({behavior:'smooth',block:'nearest',inline:'nearest'});
  if(typeof showAgentBar === 'function') showAgentBar(tab);
}

/* AI sub-tab toggle: Advisor / Use Cases / Agent Swarm */
let aiMode = 'advisor';
function setAiMode(mode){
  aiMode = mode;
  document.getElementById('aiModeAdvisor').classList.toggle('active', mode === 'advisor');
  const ucBtn = document.getElementById('aiModeUsecases');
  if(ucBtn) ucBtn.classList.toggle('active', mode === 'usecases');
  document.getElementById('aiModeSwarm').classList.toggle('active', mode === 'swarm');
  document.getElementById('aiAdvisorPane').style.display = mode === 'advisor' ? '' : 'none';
  const ucPane = document.getElementById('aiUsecasesPane');
  if(ucPane) ucPane.style.display = mode === 'usecases' ? '' : 'none';
  document.getElementById('aiSwarmPane').style.display = mode === 'swarm' ? '' : 'none';
}

/* ── Use Case Launcher ── */
const ucConfigs = {
  subscription: {
    tab: 'subs',
    msg: 'Switched to Subscriptions — create a pass token with built-in payment splitting.',
  },
  loyalty: {
    tab: 'create', mode: 'custom',
    prefill: { name: 'LoyaltyPoints', symbol: 'LOYAL', supply: '1000000', decimals: '0', desc: 'Loyalty reward tokens — earn on purchase, burn on redemption' },
    features: ['minting', 'burning'],
    msg: 'Pre-filled a loyalty token. Enable Mintable + Burnable, then deploy.',
  },
  apikey: {
    tab: 'create', mode: 'custom',
    prefill: { name: 'APIAccess', symbol: 'APIKEY', supply: '1000', decimals: '0', desc: 'On-chain API access key — hold to authenticate, freeze to revoke' },
    features: ['freezing', 'whitelisting'],
    msg: 'Pre-filled an API access token. Freezable lets you revoke access instantly.',
  },
  governance: {
    tab: 'create', mode: 'custom',
    prefill: { name: 'GovToken', symbol: 'GOV', supply: '10000000', decimals: '6', desc: 'DAO governance token — 1 token = 1 vote' },
    features: ['governance', 'ibcEnabled'],
    msg: 'Pre-filled a governance token. Airdrop to members after deploying.',
  },
  deflationary: {
    tab: 'create', mode: 'custom',
    prefill: { name: 'BurnCoin', symbol: 'BURN', supply: '100000000', decimals: '6', desc: 'Deflationary token — auto-burns on every transfer' },
    features: ['burning'],
    sliders: { cpBurnRate: '5' },
    msg: 'Pre-filled a deflationary token with 5% burn rate. Adjust and deploy.',
  },
  revenue: {
    tab: 'create', mode: 'custom',
    prefill: { name: 'RevShare', symbol: 'REV', supply: '50000000', decimals: '6', desc: 'Revenue token — transfer fee creates passive income for issuer' },
    features: ['minting'],
    sliders: { cpFeeRate: '3' },
    msg: 'Pre-filled a revenue token with 3% transfer fee to issuer.',
  },
  nft: {
    tab: 'create', mode: 'nft',
    msg: 'Switched to NFT mode — create a collection with royalties and batch minting.',
  },
  tickets: {
    tab: 'create', mode: 'nft',
    msg: 'Switched to NFT mode — create burnable/soulbound tickets for your event.',
  },
  marketmaker: {
    tab: 'ai', aiMode: 'swarm',
    msg: 'Switched to Agent Swarm — select a token and deploy 3 AI market makers.',
  },
};

function ucLaunch(key){
  const cfg = ucConfigs[key];
  if(!cfg) return;

  // Switch to the right tab
  if(cfg.tab === 'ai' && cfg.aiMode){
    switchTab('ai');
    setAiMode(cfg.aiMode);
  } else {
    switchTab(cfg.tab);
  }

  // Set create mode if needed
  if(cfg.mode && typeof setCreateMode === 'function'){
    setCreateMode(cfg.mode);
  }

  // Pre-fill form fields
  if(cfg.prefill){
    const map = { name:'cpName', symbol:'cpSymbol', supply:'cpSupply', decimals:'cpDecimals', desc:'cpDesc' };
    for(const [k,v] of Object.entries(cfg.prefill)){
      const el = document.getElementById(map[k]);
      if(el) el.value = v;
    }
  }

  // Set features
  if(cfg.features){
    // Reset all features first
    document.querySelectorAll('#cpFeatures .cp-feature.active').forEach(el => el.classList.remove('active'));
    // Activate specified features
    cfg.features.forEach(f => {
      const el = document.querySelector(`#cpFeatures .cp-feature[data-feature="${f}"]`);
      if(el) el.classList.add('active');
    });
  }

  // Set sliders
  if(cfg.sliders){
    for(const [id, val] of Object.entries(cfg.sliders)){
      const slider = document.getElementById(id);
      if(slider){
        slider.value = val;
        // Trigger the display update
        const valId = id === 'cpBurnRate' ? 'cpBurnVal' : 'cpFeeVal';
        if(typeof updateSlider === 'function') updateSlider(id, valId);
      }
    }
  }

  // Show confirmation toast
  if(cfg.msg) ucToast(cfg.msg);
}

function ucToast(msg){
  let toast = document.getElementById('ucToast');
  if(!toast){
    toast = document.createElement('div');
    toast.id = 'ucToast';
    toast.className = 'uc-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3500);
}


/* Toggle Chat Sidebar */
function toggleChatSidebar(){
  const sidebar = document.getElementById('chatSidebar');
  if(sidebar) sidebar.classList.toggle('collapsed');
}

/* Update chat starters based on active tab */
const chatStarterPool = {
  create: [
    { icon: '🚀', label: 'What can I build?', prompt: 'What can I build with TXAI?' },
    { icon: '🪙', label: 'Design a token', prompt: 'Help me design a token for my project' },
    { icon: '⚙️', label: 'Which features?', prompt: 'What smart token features should I enable?' },
    { icon: '💡', label: 'Use case ideas', prompt: 'Give me creative utility token ideas' },
    { icon: '☕', label: 'Loyalty program', prompt: 'How would I create a loyalty token for a coffee shop?' },
    { icon: '🎫', label: 'Event tickets', prompt: 'Can I tokenize event tickets with Smart Tokens?' },
    { icon: '🤖', label: 'AI permissions', prompt: 'How do I create a permission token for AI agents?' },
    { icon: '🔑', label: 'Access passes', prompt: 'How do I mint a 30-day access pass on-chain?' },
    { icon: '🏛️', label: 'DAO governance', prompt: 'Help me design a governance token for a DAO' },
    { icon: '🎮', label: 'Gaming currency', prompt: 'What features should a gaming token have?' },
    { icon: '🌐', label: 'API keys on-chain', prompt: 'Can I replace API keys with on-chain tokens?' },
    { icon: '💎', label: 'Deflationary token', prompt: 'How do burn rates create deflationary pressure?' },
  ],
  manage: [
    { icon: '🔥', label: 'Burn tokens', prompt: 'How do I burn tokens to reduce supply?' },
    { icon: '❄️', label: 'Freeze accounts', prompt: 'How does freezing work and when should I use it?' },
    { icon: '📈', label: 'Mint more supply', prompt: 'When should I mint additional tokens?' },
    { icon: '🔒', label: 'Whitelist setup', prompt: 'How do I set up whitelisting for compliance?' },
    { icon: '🔄', label: 'Clawback tokens', prompt: 'When would I use clawback to recover tokens?' },
    { icon: '🌍', label: 'Global freeze', prompt: 'What does globally freezing a token do?' },
    { icon: '📋', label: 'Check token info', prompt: 'How do I view my token features and supply?' },
    { icon: '⚖️', label: 'Compliance tools', prompt: 'Which management features help with regulatory compliance?' },
  ],
  dex: [
    { icon: '📊', label: 'Trading strategies', prompt: 'What trading strategies work on the TX DEX?' },
    { icon: '💧', label: 'Add liquidity', prompt: 'How do I add liquidity to my token on the DEX?' },
    { icon: '🤖', label: 'AI swarm demo', prompt: 'How does the AI agent swarm populate my orderbook?' },
    { icon: '📈', label: 'Read the chart', prompt: 'How do I read candlestick and depth charts?' },
    { icon: '🔄', label: 'Limit vs market', prompt: 'What is the difference between limit and market orders?' },
    { icon: '📉', label: 'Spread explained', prompt: 'What is the bid-ask spread and why does it matter?' },
    { icon: '⚡', label: 'Order matching', prompt: 'How does the on-chain order matching engine work?' },
    { icon: '🏦', label: 'Native DEX', prompt: 'What makes the TX native DEX different from Uniswap?' },
  ],
  swarm: [
    { icon: '🤖', label: 'How it works', prompt: 'How does the AI agent swarm work step by step?' },
    { icon: '⚡', label: 'What are fills?', prompt: 'What are order fills and how do they generate?' },
    { icon: '📊', label: 'Market making', prompt: 'Explain market making — what do the agents do?' },
    { icon: '🔄', label: 'After the demo', prompt: 'What happens to the tokens after the demo finishes?' },
    { icon: '💰', label: 'Agent wallets', prompt: 'How are the sub-wallets funded during the demo?' },
    { icon: '📈', label: 'Price discovery', prompt: 'How does the swarm create price discovery?' },
    { icon: '🎯', label: 'Overlap orders', prompt: 'What are overlapping orders and why do they fill?' },
    { icon: '⏱️', label: 'Demo timing', prompt: 'How long does the swarm take and what are the phases?' },
  ],
  auth: [
    { icon: '🔐', label: 'What is AuthZ?', prompt: 'What is Cosmos AuthZ and how do grants work?' },
    { icon: '🤝', label: 'Delegate trading', prompt: 'Can I let someone else trade on my behalf?' },
    { icon: '⏳', label: 'Grant expiry', prompt: 'How do grant expirations work?' },
    { icon: '🛡️', label: 'Security tips', prompt: 'What are best practices for permission grants?' },
    { icon: '💼', label: 'Team access', prompt: 'How do I grant my team access to manage tokens?' },
    { icon: '🔑', label: 'Revoke a grant', prompt: 'How do I revoke a permission grant?' },
    { icon: '🏗️', label: 'Grant types', prompt: 'What types of grants are available on TX?' },
    { icon: '🤖', label: 'Agent grants', prompt: 'Can I authorize an AI agent to act on my behalf?' },
  ],
  nft: [
    { icon: '🎨', label: 'Create an NFT', prompt: 'How do I create a Smart NFT on TX?' },
    { icon: '❄️', label: 'Freezable NFTs', prompt: 'What are freezable NFTs used for?' },
    { icon: '🎫', label: 'NFT tickets', prompt: 'Can I use NFTs for event tickets or access passes?' },
    { icon: '🔥', label: 'Burnable NFTs', prompt: 'How do burnable NFTs work for one-time-use items?' },
    { icon: '🖼️', label: 'On-chain metadata', prompt: 'How does on-chain NFT metadata work on TX?' },
    { icon: '🎮', label: 'Gaming NFTs', prompt: 'How can I use Smart NFTs for in-game items?' },
    { icon: '📜', label: 'NFT vs FT', prompt: 'When should I use an NFT instead of a fungible token?' },
    { icon: '🏷️', label: 'NFT collections', prompt: 'How do NFT classes and collections work?' },
  ],
};

function updateChatStarters(tab) {
  let pool = chatStarterPool[tab] || chatStarterPool.create;

  // Context-aware starters: inject token-specific questions on manage/dex tabs
  if (tab === 'manage' || tab === 'dex') {
    const tokens = typeof txdbGetTokens === 'function' ? txdbGetTokens() : [];
    if (tokens.length > 0) {
      const t = tokens[0]; // most recently created token
      const sym = (t.symbol || t.name || 'token').toUpperCase();
      const feat = t.features || {};
      const contextStarters = [];

      if (tab === 'manage') {
        contextStarters.push({ icon: '📋', label: `Manage ${sym}`, prompt: `How do I manage my ${sym} token? What operations are available?` });
        if (feat.burning) contextStarters.push({ icon: '🔥', label: `Burn ${sym}`, prompt: `How do I burn some ${sym} tokens to reduce supply?` });
        if (feat.minting) contextStarters.push({ icon: '📈', label: `Mint more ${sym}`, prompt: `When should I mint more ${sym} tokens?` });
        if (feat.freezing) contextStarters.push({ icon: '❄️', label: `Freeze ${sym}`, prompt: `How does freezing work for ${sym}? When would I freeze an account?` });
        if (feat.whitelisting) contextStarters.push({ icon: '🔒', label: `${sym} whitelist`, prompt: `How do I manage the whitelist for ${sym}? Who should I whitelist?` });
        if (feat.clawback) contextStarters.push({ icon: '🔄', label: `Clawback ${sym}`, prompt: `How does clawback work for ${sym}? When would I recover tokens?` });
      } else if (tab === 'dex') {
        contextStarters.push({ icon: '📊', label: `Trade ${sym}`, prompt: `How do I trade ${sym} on the DEX?` });
        contextStarters.push({ icon: '💧', label: `${sym} liquidity`, prompt: `How do I add liquidity for ${sym} on the DEX?` });
      }

      if (contextStarters.length > 0) {
        // Mix context-specific starters with generic ones
        pool = [...contextStarters, ...pool];
      }
    }
  }

  // Pick 4 random starters from the pool (prioritize first items = context-aware)
  const picked = pool.length <= 4 ? pool : pool.slice(0, Math.min(6, pool.length)).sort(() => Math.random() - 0.5).slice(0, 4);
  const container = document.querySelector('.chat-sidebar .chat-starters');
  if (!container) return;
  container.innerHTML = picked.map(s =>
    `<button class="chat-starter" onclick="chatFromStarter('${s.prompt.replace(/'/g, "\\'")}')">${s.icon} ${s.label}</button>`
  ).join('');
}

/* Reset deploy buttons */
function resetDeployBtns(){
  resetDeployBtns();
  const cb = document.getElementById('demoBtnCustom');
  if(cb) cb.disabled = false;
}

/* Create Mode Toggle: Utility Assets */
let createMode = 'custom';
function setCreateMode(mode){
  createMode = mode;
  const modes = ['custom','nft','agent','quick'];
  const ids = {custom:'createModeCustom',nft:'createModeNft',agent:'createModeAgent',quick:'createModeQuick'};
  const wraps = {custom:'customCreateWrap',nft:'nftCreateWrap',agent:'agentNftWrap',quick:'quickCreateWrap'};
  modes.forEach(m => {
    const btn = document.getElementById(ids[m]);
    if(btn) btn.classList.toggle('active', m === mode);
    const wrap = document.getElementById(wraps[m]);
    if(wrap) wrap.style.display = m === mode ? '' : 'none';
  });
  if(mode === 'quick') document.getElementById('demoInput').focus();
  if(mode === 'custom') document.getElementById('cpName').focus();
  if(mode === 'nft') { const el = document.getElementById('nftSymbol'); if(el) el.focus(); }
  if(mode === 'airdrop' && typeof nftAirdropInit === 'function') nftAirdropInit();
  if(mode === 'agent' && typeof agentNftInit === 'function') agentNftInit();
}

/* Customize Panel (legacy toggle — kept for compatibility) */
function toggleCustomize(){
  customizeOpen = !customizeOpen;
  const panel = document.getElementById('customizePanel');
  const arrow = document.getElementById('cpArrow');
  if(customizeOpen){
    panel.classList.add('show');
    arrow.classList.add('open');
  } else {
    panel.classList.remove('show');
    arrow.classList.remove('open');
  }
}

function toggleFeature(el){
  el.classList.toggle('active');
}

function updateSlider(sliderId, valId){
  const val = document.getElementById(sliderId).value;
  document.getElementById(valId).textContent = val + '%';
}

/* ---- Random Token Suggestion Generator ---- */
const _TSG = {
  categories: [
    'gaming','loyalty','community','governance','meme','music','real estate',
    'carbon credit','sports','DeFi','art','social','AI','travel','food',
    'fitness','streaming','pet care','education','space','fashion','health',
    'energy','charity','esports','photography','robotics','maritime','weather',
    'farming','dating','meditation','podcast','coding','dance','adventure',
  ],
  // Use-case templates keyed by category, with feature-aware variants
  useCases: {
    'gaming':       { base:'In-game currency for purchasing items, upgrades, and rewards', mint:'New tokens minted as play-to-earn rewards', burn:'Spent tokens are burned to create deflationary pressure', freeze:'Freeze accounts involved in cheating or exploits', whitelist:'Restrict trading to verified players only' },
    'loyalty':      { base:'Reward points for repeat customers, redeemable for discounts and perks', mint:'Issue new points with every purchase', burn:'Points burned on redemption to maintain scarcity', freeze:'Pause accounts under review for abuse', whitelist:'Only partnered merchants and verified customers can hold' },
    'community':    { base:'Unite your community with a shared token for voting, tipping, and access', mint:'Grow supply as the community grows', burn:'Members burn tokens to unlock exclusive content', freeze:'Temporarily suspend bad actors', whitelist:'Gate access to verified community members' },
    'governance':   { base:'Voting power for DAO proposals — 1 token = 1 vote on treasury and roadmap', mint:'Mint new voting power for new stakeholders', burn:'Burn tokens after votes to prevent re-use', freeze:'Lock tokens during active voting periods', whitelist:'Only KYC-verified members can participate in governance' },
    'meme':         { base:'Community-driven fun token — tip creators, flex holdings, ride the vibes', mint:'Infinite minting for maximum meme energy', burn:'Deflationary burns on every transfer', freeze:'Pause trading during coordinated events', whitelist:'Early access for OG holders' },
    'music':        { base:'Royalty shares for artists — holders earn a cut of streaming revenue', mint:'New tokens issued per album or single release', burn:'Burn to claim royalty payouts', freeze:'Freeze during royalty distribution periods', whitelist:'Only verified fans and investors can hold' },
    'real estate':  { base:'Fractional property ownership — each token represents a share of real assets', mint:'Issue new shares for additional properties', burn:'Burn on property sale to distribute proceeds', freeze:'Lock transfers during closing periods', whitelist:'Accredited investors only via KYC whitelist' },
    'carbon credit':{ base:'Tradeable carbon offsets — each token = 1 verified ton of CO2 offset', mint:'Mint when new offsets are certified', burn:'Retire credits by burning them permanently', freeze:'Suspend credits under audit', whitelist:'Only verified environmental projects can issue' },
    'sports':       { base:'Fan engagement token — vote on team decisions, unlock VIP experiences', mint:'Release new tokens each season', burn:'Burn to redeem match tickets and merch', freeze:'Lock during playoff voting windows', whitelist:'Season ticket holders get priority access' },
    'DeFi':         { base:'Utility token powering swaps, lending, and liquidity pool rewards', mint:'Elastic supply adjusts to protocol demand', burn:'Fee burns create buy pressure over time', freeze:'Emergency pause for smart contract upgrades', whitelist:'Whitelisted protocols only for composability' },
    'art':          { base:'Fractional ownership of digital and physical art collections', mint:'New tokens per artwork acquisition', burn:'Burn to claim physical piece delivery', freeze:'Lock during auction and bidding periods', whitelist:'Gallery-verified collectors only' },
    'social':       { base:'Tip your favorite creators, unlock premium content, build reputation', mint:'Earn tokens for engagement and content creation', burn:'Spend tokens to boost posts or unlock features', freeze:'Pause accounts flagged for spam', whitelist:'Verified creators get enhanced earning rates' },
    'AI':           { base:'Pay for AI compute, API calls, and model training on decentralized infra', mint:'Mint rewards for contributing GPU resources', burn:'Burned per API call — usage = deflation', freeze:'Pause during model safety reviews', whitelist:'Verified compute providers and enterprise users' },
    'travel':       { base:'Earn miles across airlines and hotels, redeem for flights and upgrades', mint:'Miles issued per booking or loyalty tier', burn:'Redeem miles by burning for travel perks', freeze:'Freeze expired or disputed miles', whitelist:'Partner airlines and travel agencies only' },
    'food':         { base:'Order and earn — every meal earns tokens, redeemable at partner restaurants', mint:'Tokens minted per delivery order', burn:'Burn to pay for meals at a discount', freeze:'Suspend fraudulent accounts instantly', whitelist:'Verified restaurant partners only' },
    'fitness':      { base:'Move-to-earn rewards — track workouts, earn tokens, compete with friends', mint:'Daily mint based on verified activity', burn:'Burn to enter premium challenges', freeze:'Pause accounts with suspicious activity data', whitelist:'Verified fitness app users only' },
    'streaming':    { base:'Subscribe, tip, and unlock content — the token of your streaming platform', mint:'Creators earn freshly minted tokens from views', burn:'Subscription payments are burned', freeze:'Content under review gets tokens frozen', whitelist:'Partnered creators and subscribers' },
    'pet care':     { base:'Rewards for pet owners — earn at vet visits, redeem for pet supplies', mint:'Tokens issued per vet checkup or adoption', burn:'Burn to redeem for pet food and toys', freeze:'Freeze tokens tied to disputed transactions', whitelist:'Verified pet stores and vet clinics' },
    'education':    { base:'Learn-to-earn — complete courses, earn credentials, trade knowledge tokens', mint:'Mint on course completion and certifications', burn:'Burn to access premium courses and mentors', freeze:'Freeze during exam and grading periods', whitelist:'Accredited institutions and verified students' },
    'space':        { base:'Fund space missions — each token is a micro-share in exploration ventures', mint:'New tokens issued per mission milestone', burn:'Burn to vote on mission priorities', freeze:'Lock during launch windows and critical phases', whitelist:'Space agency partners and accredited backers' },
    'fashion':      { base:'Authenticity tokens for luxury goods — prove provenance, trade rare items', mint:'Mint per verified luxury item registration', burn:'Burn counterfeit-linked tokens', freeze:'Freeze tokens under authenticity dispute', whitelist:'Authorized retailers and verified buyers' },
    'health':       { base:'Health data marketplace — earn by sharing anonymized data for research', mint:'Mint tokens for each data contribution', burn:'Burn to access premium health insights', freeze:'Emergency freeze for data breach response', whitelist:'HIPAA-compliant researchers and providers' },
    'energy':       { base:'Peer-to-peer energy trading — sell surplus solar, buy clean power', mint:'Mint based on verified energy production', burn:'Burn on energy consumption settlement', freeze:'Grid emergency pause capability', whitelist:'Licensed energy producers and consumers' },
    'charity':      { base:'Transparent donations — every token tracks from donor to impact', mint:'Donors receive tokens as proof of giving', burn:'Burn to release funds to verified causes', freeze:'Freeze during audit periods', whitelist:'Verified nonprofits and vetted donors' },
    'esports':      { base:'Bet, cheer, and earn across tournaments — the token of competitive gaming', mint:'Prize pool tokens minted per tournament', burn:'Entry fees burned to fund prize pools', freeze:'Freeze during match-fixing investigations', whitelist:'Verified teams and tournament organizers' },
    'photography':  { base:'License and sell photo rights — each token grants usage permissions', mint:'Mint per new photo upload and licensing', burn:'Burn expired licenses automatically', freeze:'Freeze during copyright disputes', whitelist:'Verified photographers and media buyers' },
    'robotics':     { base:'Fund and govern robotics R&D — token holders vote on research direction', mint:'Milestone-based minting for R&D progress', burn:'Burn to claim IP licensing rights', freeze:'Lock during patent filing periods', whitelist:'Research institutions and accredited investors' },
    'maritime':     { base:'Shipping and logistics token — track cargo, settle freight, insure voyages', mint:'Tokens issued per shipment booking', burn:'Burn on delivery confirmation', freeze:'Freeze cargo tokens during customs holds', whitelist:'Licensed carriers and verified importers' },
    'weather':      { base:'Decentralized weather data marketplace — earn by running weather stations', mint:'Mint for verified weather data contributions', burn:'Burn to access hyperlocal forecasts', freeze:'Pause during sensor calibration periods', whitelist:'Verified station operators and data buyers' },
    'farming':      { base:'Farm-to-table traceability — each token tracks produce from seed to shelf', mint:'Mint at each supply chain checkpoint', burn:'Consumer burns to verify origin story', freeze:'Freeze batches during food safety recalls', whitelist:'Certified farms and authorized distributors' },
    'dating':       { base:'Premium dating features — earn through engagement, spend on boosts and gifts', mint:'Earn tokens for profile verification and activity', burn:'Burn to send super-likes and gifts', freeze:'Freeze accounts under safety review', whitelist:'Verified users with identity confirmation' },
    'meditation':   { base:'Mindfulness rewards — meditate daily, earn tokens, unlock guided sessions', mint:'Daily mint for completing meditation sessions', burn:'Burn to access master classes and retreats', freeze:'Pause during content curation reviews', whitelist:'Certified instructors and wellness partners' },
    'podcast':      { base:'Support podcasters directly — tip episodes, unlock bonus content', mint:'Listeners earn tokens for engagement', burn:'Burn to access ad-free and exclusive episodes', freeze:'Freeze during content moderation reviews', whitelist:'Verified podcasters and premium subscribers' },
    'coding':       { base:'Bounty and reputation token for open-source contributors', mint:'Mint on merged pull requests and bug fixes', burn:'Burn to post bounties and job listings', freeze:'Freeze during code audit periods', whitelist:'Verified developers with contribution history' },
    'dance':        { base:'Dance-to-earn and event token — perform, compete, and earn', mint:'Judges mint rewards for competition winners', burn:'Burn to enter dance battles and workshops', freeze:'Freeze during judging deliberation', whitelist:'Verified dance studios and competition organizers' },
    'adventure':    { base:'Explore the world and earn — check in at landmarks, complete quests', mint:'Mint on verified location check-ins', burn:'Burn to unlock premium adventure routes', freeze:'Freeze during seasonal trail closures', whitelist:'Partnered parks and verified explorers' },
  },
  consonants: 'BCDFGHJKLMNPRSTVWXZ',
  vowels: 'AEIOU',
  _syl(){ return this.consonants[Math.floor(Math.random()*this.consonants.length)]
              + this.vowels[Math.floor(Math.random()*this.vowels.length)]; },
  symbol(){
    const len = Math.random() < 0.5 ? 2 : 3;
    let s = '';
    for(let i=0;i<len;i++) s += this._syl();
    return s;
  },
  supply(){
    const amounts = ['100K','250K','500K','1M','2M','5M','10M','20M','50M','100M','500M','1B'];
    return amounts[Math.floor(Math.random()*amounts.length)];
  },
  features(){
    const all = ['mintable','burnable','freezable','whitelisting'];
    const shuffled = all.sort(()=>Math.random()-0.5);
    const count = Math.random() < 0.4 ? 1 : 2;
    return shuffled.slice(0,count);
  },
  buildUseCase(cat, feats){
    const uc = this.useCases[cat];
    if(!uc) return '';
    let desc = uc.base + '.';
    const featMap = { mintable:'mint', burnable:'burn', freezable:'freeze', whitelisting:'whitelist' };
    const extras = feats.map(f => uc[featMap[f]]).filter(Boolean);
    if(extras.length) desc += ' ' + extras.join('. ') + '.';
    return desc;
  },
  generate(){
    const cat = this.categories[Math.floor(Math.random()*this.categories.length)];
    const sym = this.symbol();
    const sup = this.supply();
    const feats = this.features();
    const article = /^[aeiou]/i.test(cat) ? 'an' : 'a';
    const prompt = `${article} ${cat} token called ${sym} with ${sup} supply, ${feats.join(' and ')}`;
    const useCase = this.buildUseCase(cat, feats);
    return { prompt, useCase, symbol: sym, category: cat, features: feats };
  }
};

let _currentSuggestion = null;

function setRandomPlaceholder(){
  const input = document.getElementById('demoInput');
  if(!input) return;
  _currentSuggestion = _TSG.generate();
  input.setAttribute('placeholder', 'Describe your token or just hit Deploy \u2192');
  // Show full suggestion + use case in hint box
  const hint = document.getElementById('suggestionHint');
  if(hint){
    hint.innerHTML = '<span class="suggestion-prompt" onclick="useSuggestion()" title="Click to use this suggestion">\u26A1 ' + _currentSuggestion.prompt + '</span>'
      + '<span class="suggestion-usecase"><strong>' + _currentSuggestion.symbol + ':</strong> ' + _currentSuggestion.useCase + '</span>'
      + '<button class="suggestion-shuffle" onclick="setRandomPlaceholder()" title="New suggestion">&#8635; New idea</button>';
    hint.style.display = '';
  }
}

/* Fill input with the current suggestion */
function useSuggestion(){
  const input = document.getElementById('demoInput');
  if(input && _currentSuggestion){
    input.value = _currentSuggestion.prompt;
    input.focus();
  }
}

/* Auto-fill placeholder into input when deploying with empty field */
function useSuggestionIfEmpty(){
  const input = document.getElementById('demoInput');
  if(input && !input.value.trim() && _currentSuggestion){
    input.value = _currentSuggestion.prompt;
  }
}

/* ---- Logo URL Preview ---- */
document.addEventListener('DOMContentLoaded', () => {
  setRandomPlaceholder();
  const cpUri = document.getElementById('cpUri');
  if(cpUri) cpUri.addEventListener('input', () => {
    const url = cpUri.value.trim();
    const wrap = document.getElementById('logoPreviewWrap');
    const img = document.getElementById('logoPreview');
    if(url && (url.endsWith('.png') || url.endsWith('.jpg') || url.endsWith('.jpeg') || url.endsWith('.gif') || url.endsWith('.svg') || url.endsWith('.webp'))){
      img.src = url;
      img.onerror = () => { wrap.style.display = 'none'; };
      img.onload = () => { wrap.style.display = 'inline-block'; };
    } else {
      wrap.style.display = 'none';
    }
  });
});

function removeLogoPreview(){
  document.getElementById('cpUri').value = '';
  document.getElementById('logoPreviewWrap').style.display = 'none';
  document.getElementById('logoPreview').src = '';
  document.getElementById('cpLogoFile').value = '';
}

/* ---- Logo File Upload (imgbb) ---- */
async function handleLogoUpload(input){
  const file = input.files && input.files[0];
  if(!file) return;

  // Validate
  if(!file.type.startsWith('image/')){
    showLogoStatus('Only image files are supported.', true);
    return;
  }
  if(file.size > 10 * 1024 * 1024){
    showLogoStatus('File too large (max 10 MB).', true);
    return;
  }

  // Show local preview immediately
  const localUrl = URL.createObjectURL(file);
  const wrap = document.getElementById('logoPreviewWrap');
  const img = document.getElementById('logoPreview');
  img.src = localUrl;
  wrap.style.display = 'inline-block';

  showLogoStatus('Uploading...', false);

  try {
    // Convert to base64
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    // Upload to imgbb via our API proxy
    const res = await fetch(`${API_URL}/api/upload-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64, name: file.name }),
    });
    const data = await res.json();

    if(data.url){
      document.getElementById('cpUri').value = data.url;
      img.src = data.url;
      showLogoStatus('Uploaded!', false);
      setTimeout(() => hideLogoStatus(), 2000);
    } else {
      throw new Error(data.error || 'Upload failed');
    }
  } catch(err){
    // Keep local preview, just show error
    showLogoStatus(`Upload failed: ${err.message}. You can paste a URL instead.`, true);
  }
}

function showLogoStatus(msg, isError){
  const el = document.getElementById('logoUploadStatus');
  el.textContent = msg;
  el.style.display = 'block';
  el.style.color = isError ? '#ff7386' : 'var(--green)';
}
function hideLogoStatus(){
  document.getElementById('logoUploadStatus').style.display = 'none';
}

function getCustomizeConfig(){
  const name = document.getElementById('cpName').value.trim();
  const symbol = document.getElementById('cpSymbol').value.trim();
  const supply = document.getElementById('cpSupply').value.trim();
  const decimals = document.getElementById('cpDecimals').value.trim();
  const desc = document.getElementById('cpDesc').value.trim();
  const burnRate = document.getElementById('cpBurnRate').value;
  const feeRate = document.getElementById('cpFeeRate').value;
  const uri = document.getElementById('cpUri').value.trim();

  // Gather features
  const featureEls = document.querySelectorAll('.cp-feature.active');
  const features = [];
  featureEls.forEach(el => features.push(el.dataset.feature));

  // Only return values that are filled in
  const config = {};
  if(name) config.name = name;
  if(symbol) config.symbol = symbol;
  if(supply) config.supply = supply;
  if(decimals && decimals !== '6') config.decimals = decimals;
  if(desc) config.description = desc;
  if(features.length > 0) config.features = features;
  if(parseFloat(burnRate) > 0) config.burnRate = burnRate;
  if(parseFloat(feeRate) > 0) config.feeRate = feeRate;
  if(uri) config.uri = uri;

  return config;
}

function buildPromptFromCustomize(config){
  const parts = [];
  if(config.name) parts.push(config.name);
  if(config.supply) parts.push(config.supply + ' supply');
  if(config.features && config.features.length) parts.push(config.features.join(', '));
  if(config.burnRate) parts.push(config.burnRate + '% burn rate');
  if(config.feeRate) parts.push(config.feeRate + '% transfer fee');
  if(config.decimals) parts.push(config.decimals + ' decimals');
  if(config.description) parts.push(config.description);
  if(config.uri) parts.push('URI: ' + config.uri);
  return parts.join(', ');
}

// When user clicks Deploy, merge the text input + customize panel
const _origRunDemo = typeof runDemo === 'function' ? runDemo : null;

// Intercept the deploy to include customize settings
function mergeCustomizeIntoInput(){
  const cpConfig = getCustomizeConfig();
  const input = document.getElementById('demoInput');
  const textVal = input.value.trim();

  // If customize panel has values, merge them into the prompt
  if(Object.keys(cpConfig).length > 0){
    const cpPrompt = buildPromptFromCustomize(cpConfig);
    if(textVal){
      // Append customize settings to what user typed
      input.value = textVal + ', ' + cpPrompt;
    } else {
      // Use just the customize settings
      input.value = cpPrompt;
    }
  }
}



/* Scroll Reveal */
const observer=new IntersectionObserver((entries)=>{
  entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');observer.unobserve(e.target)}});
},{threshold:.15});
document.querySelectorAll('.reveal').forEach(el=>observer.observe(el));


/* Mode Toggle */
function toggleMode(){
  liveMode = !liveMode;
  const slider = document.getElementById('modeSlider');
  const optSim = document.getElementById('optSim');
  const optLive = document.getElementById('optLive');
  const badge = document.getElementById('testnetBadge');
  const disclaimer = document.getElementById('demoDisclaimer');
  const inputWrap = document.getElementById('demoInputWrap');
  const btn = document.getElementById('demoBtn');

  if(liveMode){
    slider.className = 'mode-toggle-slider live';
    optSim.classList.remove('active');
    optLive.classList.add('active');
    badge.classList.add('visible');
    disclaimer.classList.add('visible');
    inputWrap.classList.add('live-glow');
    btn.textContent = 'Deploy Token (Testnet)';
  } else {
    slider.className = 'mode-toggle-slider sim';
    optSim.classList.add('active');
    optLive.classList.remove('active');
    badge.classList.remove('visible');
    disclaimer.classList.remove('visible');
    inputWrap.classList.remove('live-glow');
    btn.textContent = 'Create Token';
  }
  // Hide any previous error
  document.getElementById('demoError').classList.remove('show');
}


/* Presets */
const PRESETS={
  gaming:{
    input:'a gaming token called GEMS with 50M supply, mintable and burnable with IBC',
    name:'GEMS',symbol:'gems',supply:50000000,decimals:6,
    features:{minting:true,burning:true,ibcEnabled:true,freezing:false,whitelisting:false,clawback:false,globalFreeze:false,governance:false}
  },
  loyalty:{
    input:'a loyalty points token called POINTS with 1B supply, mintable with whitelisting',
    name:'POINTS',symbol:'points',supply:1000000000,decimals:6,
    features:{minting:true,burning:true,ibcEnabled:false,freezing:false,whitelisting:true,clawback:false,globalFreeze:false,governance:false}
  },
  governance:{
    input:'a governance token called VOTE with 10M supply, burnable with governance',
    name:'VOTE',symbol:'vote',supply:10000000,decimals:6,
    features:{minting:false,burning:true,ibcEnabled:false,freezing:false,whitelisting:false,clawback:false,globalFreeze:false,governance:true}
  }
};

function usePreset(key){
  document.getElementById('demoInput').value=PRESETS[key].input;
  runDemo(PRESETS[key]);
}


/* Client-Side Parsing */
function parseInput(rawText){
  const text=rawText.toLowerCase();

  // ── Extract name ──
  // Skip known noise words — these describe tokens, not name them
  const noise = new Set(['a','an','the','token','tokens','coin','coins','asset','with','and','for',
    'my','create','make','deploy','supply','called','named','mint','mintable','minting',
    'burn','burnable','burning','freeze','freezable','freezing','whitelist','whitelistable',
    'whitelisting','clawback','ibc','governance','dao','voting','global','enabled',
    'k','m','b','t','million','billion','thousand','trillion','no','new','i','want']);

  let name = '';
  // First try "called X" or "named X"
  const calledMatch = text.match(/(?:called|named)\s+([a-z0-9_]+)/i);
  if(calledMatch){
    name = calledMatch[1].toUpperCase();
  } else {
    // Otherwise pick the first word that isn't a noise word or a number
    const words = rawText.split(/[\s,;|]+/).filter(Boolean);
    for(const w of words){
      const clean = w.replace(/[^a-zA-Z0-9]/g,'');
      if(!clean) continue;
      if(/^\d/.test(clean)) continue; // skip numbers like "100", "5M"
      if(noise.has(clean.toLowerCase())) continue;
      name = clean.toUpperCase();
      break;
    }
  }
  if(!name) name = 'MYTOKEN';

  // ── Extract supply ──
  let supply=1000000;
  // Try explicit "N supply" or "N tokens" first, then fall back to number with suffix
  const supExplicit=text.match(/([\d,.]+)\s*(k|m|b|t|thousand|million|billion|trillion)?\s*(?:supply|tokens?|coins?)/i);
  const supWithSuffix=text.match(/([\d,.]+)\s*(k|m|b|t|thousand|million|billion|trillion)\b/i);
  // Skip numbers followed by % (e.g. "1% burn rate")
  const supPlain=text.match(/([\d,.]+)(?!\s*%)/);
  const supMatch=supExplicit||supWithSuffix||(supPlain && parseFloat(supPlain[1].replace(/,/g,''))>=10 ? supPlain : null);
  if(supMatch){
    let n=parseFloat(supMatch[1].replace(/,/g,''));
    const suffix=(supMatch[2]||'').toLowerCase();
    if(suffix==='k'||suffix==='thousand')n*=1e3;
    else if(suffix==='m'||suffix==='million')n*=1e6;
    else if(suffix==='b'||suffix==='billion')n*=1e9;
    else if(suffix==='t'||suffix==='trillion')n*=1e12;
    supply=Math.floor(n);
  }
  if(supply<=0) supply=1;

  // ── Extract features ──
  const features={
    minting:/mint/i.test(text),
    burning:/burn/i.test(text),
    ibcEnabled:/ibc/i.test(text),
    freezing:/freez(?:e|able|ing)\b/i.test(text)&&!/global/i.test(text),
    whitelisting:/whitelist/i.test(text),
    clawback:/clawback/i.test(text),
    globalFreeze:/global.?freeze/i.test(text),
    governance:/governance|dao|voting/i.test(text)
  };
  return{name,symbol:name.toLowerCase(),supply,decimals:6,features};
}


/* SSE Parsing */
function parseSSEChunk(chunk){
  const events = [];
  const lines = chunk.split('\n');
  let currentEvent = null;
  let currentData = '';

  for(const line of lines){
    if(line.startsWith('event: ')){
      if(currentEvent && currentData){
        try{ events.push({event:currentEvent, data:JSON.parse(currentData)}); }
        catch(e){ events.push({event:currentEvent, data:currentData}); }
      }
      currentEvent = line.slice(7).trim();
      currentData = '';
    } else if(line.startsWith('data: ')){
      currentData += line.slice(6);
    } else if(line === '' && currentEvent){
      if(currentData){
        try{ events.push({event:currentEvent, data:JSON.parse(currentData)}); }
        catch(e){ events.push({event:currentEvent, data:currentData}); }
      }
      currentEvent = null;
      currentData = '';
    }
  }
  // Handle trailing event without final newline
  if(currentEvent && currentData){
    try{ events.push({event:currentEvent, data:JSON.parse(currentData)}); }
    catch(e){ events.push({event:currentEvent, data:currentData}); }
  }
  return events;
}


/* Error Display */
function showDemoError(msg, txUrl){
  const el = document.getElementById('demoError');
  if(txUrl){
    el.innerHTML = escapeHtml(msg) + '<br><a href="' + escapeHtml(txUrl) + '" target="_blank" rel="noopener" style="color:var(--purple);text-decoration:underline">View transaction on Explorer &#8599;</a>';
  } else {
    el.textContent = msg;
  }
  el.classList.add('show');
}
function hideDemoError(){
  document.getElementById('demoError').classList.remove('show');
}


/* Live Mode Demo */
async function runLiveDemo(inputText){
  const proc = document.getElementById('demoProcessing');
  const card = document.getElementById('tokenCard');
  const stream = document.getElementById('demoStream');
  const btn = document.getElementById('demoBtn');

  card.classList.remove('show'); card.style.display='none';
  hideDemoError();
  proc.classList.add('show');
  stream.innerHTML = '';

  // Change button to loading
  btn.textContent = 'Deploying...';
  btn.disabled = true;

  // Add a status line container and thinking container
  function addStatus(msg){
    const el = document.createElement('div');
    el.className = 'processing-status';
    el.innerHTML = '<span class="dot-g"></span> ' + escapeHtml(msg);
    stream.appendChild(el);
    stream.scrollTop = stream.scrollHeight;
  }
  function addThinking(msg){
    const el = document.createElement('div');
    el.className = 'processing-thinking';
    el.textContent = msg;
    stream.appendChild(el);
    stream.scrollTop = stream.scrollHeight;
  }
  function addStreamLine(msg, cls){
    const el = document.createElement('div');
    el.style.fontFamily = 'var(--mono)';
    el.style.fontSize = '.78rem';
    el.style.color = cls === 'tool' ? 'var(--purple)' : cls === 'result' ? 'var(--green)' : 'var(--text-dim)';
    el.style.marginBottom = '4px';
    el.textContent = msg;
    stream.appendChild(el);
    stream.scrollTop = stream.scrollHeight;
  }

  let successData = null;
  let errorTxUrl = null;

  try {
    // Use sync endpoint — more reliable through Railway's proxy
    addStatus('Sending to Claude AI...');

    const response = await fetch(API_URL + '/api/create-token-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: inputText })
    });

    if(!response.ok){
      if(response.status === 429){
        throw new Error('RATE_LIMIT');
      }
      throw new Error('HTTP_' + response.status);
    }

    const result = await response.json();

    // Replay the collected events in the UI
    let lastError = null;
    if(result.events && Array.isArray(result.events)){
      for(const evt of result.events){
        await new Promise(r => setTimeout(r, 150)); // Small delay for animation effect
        switch(evt.event){
          case 'status':
            addStatus(evt.data.message || evt.data);
            break;
          case 'thinking':
            addThinking(typeof evt.data === 'string' ? evt.data : evt.data.text || JSON.stringify(evt.data));
            break;
          case 'tool_call':
            addStreamLine('Calling ' + (evt.data.tool || 'tx_issue_smart_token') + '...', 'tool');
            if(evt.data.args){
              addStreamLine('  Args: ' + JSON.stringify(evt.data.args).slice(0,200), 'text');
            }
            break;
          case 'tool_result':
            if(evt.data.result && evt.data.result.denom) addStreamLine('  Denom: ' + evt.data.result.denom, 'result');
            if(evt.data.result && evt.data.result.txHash) addStreamLine('  TX Hash: ' + evt.data.result.txHash, 'result');
            if(evt.data.result && evt.data.result.explorerUrl) addStreamLine('  Explorer: ' + evt.data.result.explorerUrl, 'result');
            break;
          case 'text':
            addStreamLine(typeof evt.data === 'string' ? evt.data : evt.data.content || '', 'text');
            break;
          case 'success':
            successData = evt.data;
            addStreamLine('Token deployed successfully!', 'result');
            break;
          case 'error':
            // Collect error but don't throw yet - Claude may retry and succeed
            const errData = typeof evt.data === 'string' ? {message: evt.data} : evt.data;
            const errMsg = errData.message || 'Unknown error';
            if(errData.explorerUrl) errorTxUrl = errData.explorerUrl;
            else if(errData.txHash) errorTxUrl = 'https://explorer.testnet-1.tx.org/tx/transactions/' + errData.txHash;
            lastError = errMsg;
            break;
        }
      }
    }

    // Use result directly if no events
    if(!successData && result.success && result.result){
      successData = result.result;
    }
    // Only throw if there was NO success and there was an error
    if(!successData) {
      if(result.error || lastError){
        const finalErr = result.error || lastError;
        if(result.explorerUrl) errorTxUrl = result.explorerUrl;
        else if(result.txHash) errorTxUrl = 'https://explorer.testnet-1.tx.org/tx/transactions/' + result.txHash;
        throw new Error('SERVER_ERROR:' + finalErr);
      }
      if(!result.success){
        throw new Error('SERVER_ERROR:Token creation did not produce a result. Please try again.');
      }
    }

  } catch(err){
    proc.classList.remove('show');
    btn.textContent = 'Deploy Token (Testnet)';
    btn.disabled = false;
    demoRunning = false;

    if(err.message === 'RATE_LIMIT'){
      showDemoError('Please wait 60 seconds between token creations.');
    } else if(err.message.startsWith('SERVER_ERROR:')){
      showDemoError(err.message.slice(13), errorTxUrl);
    } else if(err.name === 'TypeError' || err.message.includes('fetch') || err.message.includes('network') || err.message.includes('Failed')){
      showDemoError('Live demo unavailable. Try simulated mode.');
    } else {
      showDemoError('Connection error. Check your internet connection.');
    }
    return;
  }

  await sleep(300);
  proc.classList.remove('show');

  // Build card with real data if we got success
  if(successData){
    buildLiveTokenCard(successData, inputText);
  } else {
    // Fallback: parse input client-side for card display
    const cfg = parseInput(inputText);
    buildTokenCard(cfg, inputText);
  }

  card.style.display='block';
  requestAnimationFrame(()=>card.classList.add('show'));

  btn.textContent = 'Deploy Token (Testnet)';
  btn.disabled = false;
  demoRunning = false;
}


/* Build Live Token Card */
function buildLiveTokenCard(data, desc){
  const denom = data.denom || 'unknown';
  const txHash = data.txHash || '';
  // Always build explorer URL from txHash to ensure correct format
  const explorerUrl = txHash ? ('https://explorer.testnet-1.tx.org/tx/transactions/' + txHash) : (data.explorerUrl || '#');
  const features = data.features || {};

  // Extract name from denom (e.g. "gems-testcore1abc..." -> "GEMS")
  const denomName = denom.split('-')[0] || denom;
  const displayName = denomName.toUpperCase();

  // Show Multiavatar logo if available, otherwise initials
  const tcIconEl = document.getElementById('tcIcon');
  const tokenUri = data.uri || `https://api.multiavatar.com/${encodeURIComponent(denomName)}.svg`;
  tcIconEl.innerHTML = `<img src="${tokenUri}" alt="${displayName}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" onerror="this.parentElement.textContent='${displayName.slice(0,2)}'">`;
  document.getElementById('tcName').textContent = displayName;
  document.getElementById('tcSym').textContent = '$' + displayName;

  // Update the deployed badge to show LIVE ON TESTNET
  const deployedBadge = document.querySelector('.tc-deployed');
  deployedBadge.innerHTML = '<span class="dot-live"></span> <span class="tc-live-badge"><span class="dot-g"></span> LIVE ON TESTNET</span>';

  // Stats
  const stats = document.getElementById('tcStats');
  stats.innerHTML = '';
  let supply = data.supply || data.initialSupply || 'N/A';
  // Guard against NaN or invalid values
  if(supply === 'NaN' || supply === 'undefined' || supply === 'null' || (typeof supply === 'number' && isNaN(supply))) supply = 'N/A';
  const statData = [
    {val: typeof supply === 'number' ? supply.toLocaleString() : (isNaN(Number(supply)) ? supply : Number(supply).toLocaleString()), label:'Total Supply'},
    {val: data.decimals || 6, label:'Decimals'},
    {val:'TX Testnet', label:'Network'},
    {val: txHash ? txHash.slice(0,8) + '...' : 'N/A', label:'TX Hash'}
  ];
  statData.forEach(s=>{
    const d = document.createElement('div'); d.className = 'tc-stat';
    d.innerHTML = '<div class="tc-stat-val">' + s.val + '</div><div class="tc-stat-label">' + s.label + '</div>';
    stats.appendChild(d);
  });

  // Features
  const feats = document.getElementById('tcFeatures'); feats.innerHTML = '';
  const fLabels = {minting:'Mintable',burning:'Burnable',ibcEnabled:'IBC Enabled',freezing:'Freezable',whitelisting:'Whitelistable',clawback:'Clawback',globalFreeze:'Global Freeze',governance:'Governance'};
  if(features && typeof features === 'object'){
    Object.entries(fLabels).forEach(([k, label])=>{
      const v = features[k] || false;
      const s = document.createElement('span');
      s.className = 'tc-feat ' + (v ? 'on' : 'off');
      s.textContent = label;
      feats.appendChild(s);
    });
  }

  // CLI command
  const cmd = 'npx txai-create "' + desc + '"';
  document.getElementById('tcCmd').textContent = cmd;

  // JSON with real data
  const json = {
    token:{ denom: denom, txHash: txHash, network:'coreum-testnet-1' },
    features: features,
    explorerUrl: explorerUrl,
    cli: 'txai create "' + desc + '"'
  };
  document.getElementById('tcJson').innerHTML = syntaxHL(JSON.stringify(json, null, 2));
  window._lastCmd = cmd;
  window._lastJson = JSON.stringify(json, null, 2);

  // Explorer link - make it real and clickable
  const explorerDiv = document.querySelector('.tc-explorer');
  explorerDiv.className = 'tc-explorer tc-explorer-live';
  explorerDiv.innerHTML = '<div class="tc-explorer-icon">&#9889;</div>' +
    '<div class="tc-explorer-text">' +
    'Token deployed on Testnet!<br>' +
    '<a href="' + escapeHtml(explorerUrl) + '" target="_blank" rel="noopener">View on TX Explorer &#8599;</a>' +
    '</div>';

  // Show "What's Next?" popup after a brief pause
  if(denom){
    setTimeout(() => showPostCreateModal(denom, displayName), 1500);
  }

  // Auto-populate DEX and Manage tabs with newly created token
  if(denom){
    populateDexFromToken(denom);
    populateManageFromToken(denom);
    // Register token with connected wallet (Leap/Keplr) so it shows up
    registerTokenWithWallet(denom, displayName, data.decimals || 6);
    // Persist to txdb
    txdbAddToken({
      denom: denom,
      symbol: displayName,
      name: data.name || displayName,
      txHash: txHash,
      supply: data.supply || data.initialAmount || '',
      decimals: data.decimals || 6,
      features: features,
      walletAddress: dexGetActiveAddress(),
      network: 'testnet',
    });
  }
}


/* Post-Create "What's Next?" Modal */
function showPostCreateModal(denom, symbol){
  const existing = document.getElementById('postCreateModal');
  if(existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'postCreateModal';
  modal.className = 'dex-deposit-overlay';
  modal.onclick = (e) => { if(e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="dex-deposit-panel" style="max-width:460px">
      <div class="dex-deposit-header">
        <h3>Your token is live!</h3>
        <button class="dex-demo-close" onclick="document.getElementById('postCreateModal').remove()">&#10005;</button>
      </div>
      <div class="dex-deposit-body" style="text-align:center">
        <div style="font-size:2.5rem;margin-bottom:8px">&#127881;</div>
        <p style="color:var(--text);font-size:1.05rem;font-weight:600;margin-bottom:6px">${symbol} is on-chain</p>
        <p style="color:var(--text-muted);font-size:.85rem;margin-bottom:24px">What would you like to do next?</p>

        <div style="display:flex;flex-direction:column;gap:12px">
          <button class="tc-next-btn tc-next-primary" onclick="postCreateLaunchSwarm('${denom}','${symbol}')">
            <span class="tc-next-icon">&#129302;</span>
            <div class="tc-next-info">
              <span class="tc-next-title">Launch Agent Swarm</span>
              <span class="tc-next-desc">AI agents populate the orderbook with 25+ orders &amp; stress-test your token</span>
            </div>
          </button>

          <button class="tc-next-btn" onclick="document.getElementById('postCreateModal').remove();switchTab('dex')">
            <span class="tc-next-icon">&#128200;</span>
            <div class="tc-next-info">
              <span class="tc-next-title">Go to DEX</span>
              <span class="tc-next-desc">View the orderbook and trade manually</span>
            </div>
          </button>

          <button class="tc-next-btn" onclick="document.getElementById('postCreateModal').remove();switchTab('manage')">
            <span class="tc-next-icon">&#9881;&#65039;</span>
            <div class="tc-next-info">
              <span class="tc-next-title">Manage Token</span>
              <span class="tc-next-desc">Mint, burn, freeze, whitelist &amp; more</span>
            </div>
          </button>

          <button class="tc-next-dismiss" onclick="document.getElementById('postCreateModal').remove()">
            Maybe later
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function postCreateLaunchSwarm(denom, symbol){
  document.getElementById('postCreateModal').remove();
  switchTab('dex');
  // Pre-fill the denom and trigger the demo
  dexBaseDenom = denom;
  const select = document.getElementById('dexPairSelect');
  if(select){
    // Ensure the option exists
    let found = false;
    for(let i = 0; i < select.options.length; i++){
      if(select.options[i].value === denom){ select.selectedIndex = i; found = true; break; }
    }
    if(!found){
      const opt = new Option(symbol + ' / TX', denom);
      select.add(opt);
      select.value = denom;
    }
  }
  // Small delay to let the tab render, then launch demo
  setTimeout(() => dexStartDemo(), 300);
}

/* Wallet Choice Modal */
function showWalletChoice(preset){
  _pendingPreset = preset || null;
  // If wallet already connected, show a streamlined modal
  if(walletMode !== 'agent' && connectedAddress){
    const overlay = document.getElementById('walletChoiceOverlay');
    const modal = overlay.querySelector('.wallet-choice-modal');
    const shortAddr = connectedAddress.slice(0,10) + '...' + connectedAddress.slice(-4);
    const provName = walletMode === 'keplr' ? 'Keplr' : 'Leap';
    modal.innerHTML = `
      <div class="wallet-choice-title">Create with which wallet?</div>
      <div class="wallet-choice-subtitle">You have ${provName} connected (${shortAddr})</div>
      <div class="wallet-choice-cards">
        <div class="wallet-choice-card" onclick="chooseWalletMode('agent')">
          <div class="wc-icon">&#129302;</div>
          <div class="wc-label">AI Agent Wallet</div>
          <div class="wc-desc">Quick demo &mdash; AI creates the token. You won't be the issuer.</div>
          <span class="wc-badge free">No signing needed</span>
        </div>
        <div class="wallet-choice-card recommended" onclick="chooseWalletMode('existing')">
          <div class="wc-icon">&#128273;</div>
          <div class="wc-label">Your Wallet (${provName})</div>
          <div class="wc-desc">You sign the transaction &mdash; you own and control the token.</div>
          <span class="wc-badge own">${shortAddr}</span>
        </div>
      </div>
      <button class="wallet-choice-dismiss" onclick="closeWalletChoice()">Cancel</button>
    `;
    overlay.style.display = 'flex';
    overlay.classList.add('show');
    return;
  }
  const ov = document.getElementById('walletChoiceOverlay');
  ov.style.display = 'flex';
  ov.classList.add('show');
}
function closeWalletChoice(){
  const overlay = document.getElementById('walletChoiceOverlay');
  overlay.classList.remove('show');
  overlay.style.display = 'none';
  _pendingPreset = null;
  demoRunning = false;
  resetDeployBtns();
}
async function chooseWalletMode(mode){
  const overlay = document.getElementById('walletChoiceOverlay');
  overlay.classList.remove('show');
  overlay.style.display = 'none';
  resetWalletChoiceModal();
  if(mode === 'agent'){
    // Temporarily switch to agent mode for this creation
    // (don't disconnect — just route through agent)
    const savedMode = walletMode;
    const savedAddr = connectedAddress;
    const savedSigner = connectedOfflineSigner;
    walletMode = 'agent';
    connectedAddress = '';
    connectedOfflineSigner = null;
    await _runDemoInternal(_pendingPreset);
    // Restore wallet state
    walletMode = savedMode;
    connectedAddress = savedAddr;
    connectedOfflineSigner = savedSigner;
    _pendingPreset = null;
    return;
  }
  if(mode === 'connect'){
    // Need to connect wallet first
    const ok = await connectWalletForChoice();
    if(!ok){
      demoRunning = false;
      resetDeployBtns();
      _pendingPreset = null;
      return;
    }
  }
  // mode === 'connect' (now connected) or 'existing' (already connected)
  _runDemoInternal(_pendingPreset);
  _pendingPreset = null;
}

async function connectWalletForChoice(){
  // Show inline wallet picker in the modal
  return new Promise((resolve) => {
    const overlay = document.getElementById('walletChoiceOverlay');
    overlay.style.display = 'flex';
    overlay.classList.add('show');
    const modal = overlay.querySelector('.wallet-choice-modal');
    const keplrInstalled = keplrAvailable();
    modal.innerHTML = `
      <div class="wallet-choice-title">Connect Your Wallet</div>
      <div class="wallet-choice-subtitle">Choose a wallet provider to sign the token creation transaction</div>
      <div class="wallet-choice-cards wallet-choice-cards--nav">
        <div class="wallet-choice-card wallet-choice-card--primary recommended" id="wcKeplr" style="cursor:pointer">
          <div class="wc-icon"><svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" rx="8" fill="#7B6FE8"/><path d="M11 29V11H15.5V18.2L22.1 11H28L20.5 19.1L28.5 29H22.3L16.8 21.5L15.5 22.9V29H11Z" fill="white"/></svg></div>
          <div class="wc-label">Keplr Wallet</div>
          <div class="wc-desc">Most popular Cosmos wallet. Browser extension required.</div>
          <span class="wc-badge own">Full control</span>
        </div>
        <div class="wallet-choice-card wallet-choice-card--secondary" id="wcLeap" style="cursor:pointer">
          <div class="wc-icon"><img src="https://assets.leapwallet.io/logos/leap-cosmos-logo.svg" alt="Leap" style="width:36px;height:36px" onerror="this.parentElement.textContent='L'"></div>
          <div class="wc-label">Leap Wallet</div>
          <div class="wc-desc">Alternative Cosmos wallet.</div>
        </div>
      </div>
      ${!keplrInstalled ? '<div class="wallet-choice-install-hint"><span>Keplr not detected.</span><a href="https://www.keplr.app/download" target="_blank" rel="noopener">Install Keplr Extension</a></div>' : ''}
      <button class="wallet-choice-dismiss" id="wcCancel">Cancel</button>
    `;
    document.getElementById('wcCancel').onclick = () => {
      overlay.classList.remove('show');
      overlay.style.display = 'none';
      resetWalletChoiceModal();
      resolve(false);
    };
    overlay.onclick = (e) => {
      if(e.target === overlay){
        overlay.classList.remove('show');
        overlay.style.display = 'none';
        resetWalletChoiceModal();
        resolve(false);
      }
    };
    document.getElementById('wcKeplr').onclick = async () => {
      if(!keplrAvailable()){
        alert('Keplr wallet extension not found.\n\nPlease install it from:\nhttps://www.keplr.app/download');
        return;
      }
      overlay.classList.remove('show');
      overlay.style.display = 'none';
      await globalConnectWallet('keplr');
      resetWalletChoiceModal();
      resolve(walletMode !== 'agent' && !!connectedAddress);
    };
    document.getElementById('wcLeap').onclick = async () => {
      overlay.classList.remove('show');
      overlay.style.display = 'none';
      await globalConnectWallet('leap');
      resetWalletChoiceModal();
      resolve(walletMode !== 'agent' && !!connectedAddress);
    };
  });
}

function resetWalletChoiceModal(){
  // Restore original modal content (token creation choice)
  const overlay = document.getElementById('walletChoiceOverlay');
  const modal = overlay.querySelector('.wallet-choice-modal');
  modal.innerHTML = `
    <div class="wallet-choice-title">How do you want to create this token?</div>
    <div class="wallet-choice-subtitle">Choose who owns and controls the token after creation</div>
    <div class="wallet-choice-cards">
      <div class="wallet-choice-card" onclick="chooseWalletMode('agent')">
        <div class="wc-icon">&#129302;</div>
        <div class="wc-label">AI Agent Wallet</div>
        <div class="wc-desc">Quick demo &mdash; the AI agent creates and owns the token. Great for testing and exploring.</div>
        <span class="wc-badge free">No wallet needed</span>
      </div>
      <div class="wallet-choice-card recommended" onclick="chooseWalletMode('connect')">
        <div class="wc-icon"><svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" rx="8" fill="#7B6FE8"/><path d="M11 29V11H15.5V18.2L22.1 11H28L20.5 19.1L28.5 29H22.3L16.8 21.5L15.5 22.9V29H11Z" fill="white"/></svg></div>
        <div class="wc-label">Your Wallet (Keplr)</div>
        <div class="wc-desc">Connect Keplr &mdash; you are the issuer. You can mint, burn, freeze &amp; manage the token.</div>
        <span class="wc-badge own">You own the token</span>
      </div>
    </div>
    <button class="wallet-choice-dismiss" onclick="closeWalletChoice()">Cancel</button>
  `;
}


/* Demo Runner */
async function _runDemoInternal(preset){
  // Called after wallet choice is made — now actually execute
  if(!preset) mergeCustomizeIntoInput();
  const input = document.getElementById('demoInput').value.trim();
  const desc = preset ? preset.input : input;
  demoRunning = true;
  document.getElementById('demoBtn').disabled = true;
  hideDemoError();

  if(walletMode !== 'agent' && connectedAddress){
    await runWalletTokenCreation(desc);
  } else {
    await runLiveDemo(desc);
  }
}

async function runDemo(preset){
  if(demoRunning)return;

  // In custom mode, check that at least name or symbol is filled
  if(createMode === 'custom' && !preset){
    const cpConfig = getCustomizeConfig();
    if(!cpConfig.name && !cpConfig.symbol){
      showDemoError('Enter at least a token name or symbol.');
      return;
    }
  }

  // In quick mode, merge customize settings and require text input
  if(createMode === 'quick' && !preset) mergeCustomizeIntoInput();
  const input=document.getElementById('demoInput').value.trim();
  if(!input && !preset && createMode === 'quick')return;

  // For custom mode with no text input, build a synthetic prompt from fields
  if(createMode === 'custom' && !input && !preset){
    const cpConfig = getCustomizeConfig();
    document.getElementById('demoInput').value = buildPromptFromCustomize(cpConfig);
  }

  demoRunning=true;
  document.getElementById('demoBtn').disabled=true;
  if(document.getElementById('demoBtnCustom')) document.getElementById('demoBtnCustom').disabled=true;
  hideDemoError();

  // If live mode, always show wallet choice modal
  if(liveMode){
    showWalletChoice(preset);
    return;
  }

  // Simulated mode — fall through
  const cfg=preset||parseInput(input);
  const desc=preset?preset.input:input;

  // Reset
  const proc=document.getElementById('demoProcessing');
  const card=document.getElementById('tokenCard');
  card.classList.remove('show');card.style.display='none';
  proc.classList.add('show');
  const stream=document.getElementById('demoStream');
  stream.textContent='';

  // Reset deployed badge for simulated mode
  const deployedBadge = document.querySelector('.tc-deployed');
  deployedBadge.innerHTML = '<span class="dot-live"></span> Simulated';

  // Reset explorer link for simulated mode (no real tx, so no explorer link)
  const explorerDiv = document.querySelector('.tc-explorer');
  explorerDiv.className = 'tc-explorer';
  explorerDiv.innerHTML = '<div class="tc-explorer-icon">&#9889;</div>' +
    '<div class="tc-explorer-text">Token deployed successfully! <em style="color:var(--text-muted);font-size:.8rem">(Simulated)</em></div>';

  // Streaming text
  const lines=[
    'Analyzing natural language input...',
    'Extracting token parameters...',
    '  > Name: '+cfg.name,
    '  > Symbol: $'+cfg.symbol.toUpperCase(),
    '  > Supply: '+cfg.supply.toLocaleString(),
    '  > Decimals: '+cfg.decimals,
    'Detecting requested features...',
    ...Object.entries(cfg.features).filter(([,v])=>v).map(([k])=>'  > '+k+': enabled'),
    'Finalizing token configuration...',
    '  > Creator: 20% | Community: 35% | Treasury: 25% | Liquidity: 20%',
    'Building transaction payload...',
    'Submitting to TX blockchain...',
    'Waiting for confirmation...',
    'Block confirmed! Token deployed.'
  ];

  for(const line of lines){
    await streamLine(stream,line);
    stream.textContent+='\n';
    await sleep(80);
  }
  await sleep(300);
  proc.classList.remove('show');

  buildTokenCard(cfg,desc);
  card.style.display='block';
  requestAnimationFrame(()=>card.classList.add('show'));

  demoRunning=false;
  document.getElementById('demoBtn').disabled=false;
}


/* Build Token Card (Simulated) */
function buildTokenCard(cfg,desc){
  document.getElementById('tcIcon').textContent=cfg.name.slice(0,2);
  document.getElementById('tcName').textContent=cfg.name;
  document.getElementById('tcSym').textContent='$'+cfg.symbol.toUpperCase();

  const stats=document.getElementById('tcStats');
  stats.innerHTML='';
  const statData=[
    {val:cfg.supply.toLocaleString(),label:'Total Supply'},
    {val:cfg.decimals,label:'Decimals'},
    {val:'TX Testnet',label:'Network'},
    {val:Object.values(cfg.features).filter(Boolean).length,label:'Features'}
  ];
  statData.forEach((s,i)=>{
    const d=document.createElement('div');d.className='tc-stat';
    d.innerHTML='<div class="tc-stat-val" data-target="'+s.val+'">'+s.val+'</div><div class="tc-stat-label">'+s.label+'</div>';
    stats.appendChild(d);
  });

  const feats=document.getElementById('tcFeatures');feats.innerHTML='';
  const fLabels={minting:'Mintable',burning:'Burnable',ibcEnabled:'IBC Enabled',freezing:'Freezable',whitelisting:'Whitelistable',clawback:'Clawback',globalFreeze:'Global Freeze',governance:'Governance'};
  Object.entries(cfg.features).forEach(([k,v])=>{
    const s=document.createElement('span');
    s.className='tc-feat '+(v?'on':'off');
    s.textContent=(v?'':'')+(fLabels[k]||k);
    feats.appendChild(s);
  });

  const cmd='npx txai-create "'+desc+'"';
  document.getElementById('tcCmd').textContent=cmd;

  const json={
    token:{name:cfg.name,symbol:cfg.symbol,initialSupply:String(cfg.supply),decimals:cfg.decimals,network:'coreum-mainnet-1'},
    features:cfg.features,
    cli:'txai create "'+desc+'"'
  };
  document.getElementById('tcJson').innerHTML=syntaxHL(JSON.stringify(json,null,2));
  window._lastCmd=cmd;window._lastJson=JSON.stringify(json,null,2);
}

function syntaxHL(json){
  return json
    .replace(/("(?:\\.|[^"\\])*")\s*:/g,'<span class="jk">$1</span>:')
    .replace(/:\s*("(?:\\.|[^"\\])*")/g,': <span class="js">$1</span>')
    .replace(/:\s*(\d+)/g,': <span class="jn">$1</span>')
    .replace(/:\s*(true|false)/g,': <span class="jb">$1</span>');
}

function copyCmd(){
  navigator.clipboard.writeText(window._lastCmd||'');
  event.target.textContent='Copied!';setTimeout(()=>event.target.textContent='Copy',1500);
}
function copyJson(){
  navigator.clipboard.writeText(window._lastJson||'');
  event.target.textContent='Copied!';setTimeout(()=>event.target.textContent='Copy JSON',1500);
}

/* Enter key */
document.getElementById('demoInput').addEventListener('keydown',e=>{if(e.key==='Enter')runDemo()});


/* Direct Token Config & Wallet Creation */
function getDirectTokenConfig(){
  const cpConfig = getCustomizeConfig();
  // If the customize panel has at least a name or symbol, use it directly
  if(!cpConfig.name && !cpConfig.symbol && !cpConfig.supply) return null;

  const name = cpConfig.name || cpConfig.symbol || 'MyToken';
  const symbol = cpConfig.symbol || cpConfig.name || name;
  const subunit = symbol.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Build features object from the feature names list
  const featObj = {};
  if(cpConfig.features){
    cpConfig.features.forEach(f => { featObj[f] = true; });
  }

  // Burn rate: slider is 0-20 (percent), chain wants decimal fraction
  const burnRate = cpConfig.burnRate ? String(parseFloat(cpConfig.burnRate) / 100) : '0';
  // Fee rate: slider is 0-20 (percent), chain wants decimal fraction
  const feeRate = cpConfig.feeRate ? String(parseFloat(cpConfig.feeRate) / 100) : '0';

  return {
    name: name,
    subunit: subunit.length >= 3 ? subunit : subunit + 'token',
    initialAmount: cpConfig.supply || '1000000',
    precision: cpConfig.decimals ? parseInt(cpConfig.decimals) : 6,
    description: cpConfig.description || '',
    features: featObj,
    burnRate: burnRate,
    sendCommissionRate: feeRate,
    uri: cpConfig.uri || `https://api.multiavatar.com/${encodeURIComponent(subunit)}.svg`,
  };
}

/* ---- Quick local text parser (no AI needed) ---- */
function quickParseInput(inputText){
  const words = inputText.split(/[\s,]+/).filter(w => w.length > 0);
  const skipWords = ['a','an','the','my','create','make','with','and','supply','token','coin','mint','burn','mintable','burnable','freezable','minting','burning','freezing','clawback','ibc','whitelist','whitelisting','governance','deflationary','of','for'];

  // Extract name: first non-skip, non-number word
  let name = '';
  let supply = '1000000';
  const featObj = {};

  for(const w of words){
    const lw = w.toLowerCase();
    // Check for supply number
    if(/^\d+[kmbt]?$/i.test(w)){
      let num = parseFloat(w);
      const suffix = w.slice(-1).toLowerCase();
      if(suffix === 'k') num *= 1000;
      else if(suffix === 'm') num *= 1000000;
      else if(suffix === 'b') num *= 1000000000;
      else if(suffix === 't') num *= 1000000000000;
      supply = String(Math.round(num));
      continue;
    }
    // Check for features
    if(lw === 'mint' || lw === 'mintable' || lw === 'minting'){ featObj.minting = true; continue; }
    if(lw === 'burn' || lw === 'burnable' || lw === 'burning'){ featObj.burning = true; continue; }
    if(lw === 'freeze' || lw === 'freezable' || lw === 'freezing'){ featObj.freezing = true; continue; }
    if(lw === 'clawback'){ featObj.clawback = true; continue; }
    if(lw === 'ibc'){ featObj.ibcEnabled = true; continue; }
    if(lw === 'whitelist' || lw === 'whitelisting'){ featObj.whitelisting = true; continue; }
    // Skip filler words
    if(skipWords.includes(lw)) continue;
    // First real word = name
    if(!name) name = w.charAt(0).toUpperCase() + w.slice(1);
  }

  if(!name) name = 'Token';
  const subunit = name.toLowerCase().replace(/[^a-z0-9]/g, '');

  return {
    name,
    subunit: subunit.length >= 3 ? subunit : subunit + 'token',
    initialAmount: supply,
    precision: 6,
    description: '',
    features: featObj,
    burnRate: '0',
    sendCommissionRate: '0',
    uri: '',
  };
}

/* ---- Wallet-Signed Token Creation ---- */
async function runWalletTokenCreation(inputText){
  const proc = document.getElementById('demoProcessing');
  const card = document.getElementById('tokenCard');
  const stream = document.getElementById('demoStream');
  const btn = document.getElementById('demoBtn');

  card.classList.remove('show'); card.style.display = 'none';
  hideDemoError();

  btn.textContent = 'Sign in Wallet...';
  btn.disabled = true;

  function addStatus(msg){
    const el = document.createElement('div');
    el.className = 'processing-status';
    el.innerHTML = '<span class="dot-g"></span> ' + escapeHtml(msg);
    stream.appendChild(el);
    stream.scrollTop = stream.scrollHeight;
  }
  function addStreamLine(msg, cls){
    const el = document.createElement('div');
    el.style.fontFamily = 'var(--mono)';
    el.style.fontSize = '.78rem';
    el.style.color = cls === 'tool' ? 'var(--purple)' : cls === 'result' ? 'var(--green)' : 'var(--text-dim)';
    el.style.marginBottom = '4px';
    el.textContent = msg;
    stream.appendChild(el);
    stream.scrollTop = stream.scrollHeight;
  }

  try {
    // Step 1: Get config INSTANTLY — customize panel first, then quick local parse (NO AI call)
    let tokenConfig = getDirectTokenConfig();
    if(!tokenConfig){
      tokenConfig = quickParseInput(inputText);
    }

    const precision = tokenConfig.precision || 6;
    const rawAmount = (BigInt(Math.round(parseFloat(tokenConfig.initialAmount || '1000000'))) * BigInt(Math.pow(10, precision))).toString();

    // Build features array
    const featureMap = { minting: 0, burning: 1, freezing: 2, whitelisting: 3, ibcEnabled: 4, ibc: 4, clawback: 6 };
    const features = [];
    if(tokenConfig.features){
      for(const [key, val] of Object.entries(tokenConfig.features)){
        if(val && featureMap[key] !== undefined) features.push(featureMap[key]);
      }
    }

    function toChainRate(rate){
      if(!rate || rate === '0') return '0';
      const num = parseFloat(rate);
      if(isNaN(num) || num <= 0 || num > 1) return '0';
      return Math.round(num * 1e18).toString();
    }
    const burnRate = toChainRate(tokenConfig.burnRate);
    const sendCommissionRate = toChainRate(tokenConfig.sendCommissionRate);

    const msg = {
      typeUrl: '/coreum.asset.ft.v1.MsgIssue',
      value: {
        issuer: connectedAddress,
        symbol: (tokenConfig.subunit || 'token').toUpperCase(),
        subunit: (tokenConfig.subunit || 'token').toLowerCase(),
        precision: precision,
        initialAmount: rawAmount,
        description: tokenConfig.description || inputText,
        features: features,
        burnRate: burnRate,
        sendCommissionRate: sendCommissionRate,
        uri: tokenConfig.uri || '',
        uriHash: tokenConfig.uriHash || '',
      }
    };

    // Step 2: IMMEDIATELY send to wallet for signing — wallet popup appears right away
    // The wallet approve IS the user's confirmation. Nothing happens until they click approve.
    const result = await dexBuildAndSignTx([msg], 500000);

    // Step 3: User approved — now show progress
    proc.classList.add('show');
    stream.innerHTML = '';

    const txHash = result.txhash || result.hash || '';
    addStatus('Token created successfully!');
    addStreamLine('  Name: ' + (tokenConfig.name || 'N/A'), 'tool');
    addStreamLine('  Symbol: ' + (tokenConfig.subunit || 'N/A').toUpperCase(), 'tool');
    addStreamLine('  Supply: ' + (tokenConfig.initialAmount || 'N/A'), 'tool');
    addStreamLine('  TX Hash: ' + txHash, 'result');

    const denom = (tokenConfig.subunit || 'token').toLowerCase() + '-' + connectedAddress;
    addStreamLine('  Denom: ' + denom, 'result');

    await sleep(500);
    proc.classList.remove('show');

    // Build the live token card
    buildLiveTokenCard({
      denom: denom,
      txHash: txHash,
      supply: tokenConfig.initialAmount,
      decimals: precision,
      features: tokenConfig.features || {},
      explorerUrl: 'https://explorer.testnet-1.tx.org/tx/transactions/' + txHash,
    }, inputText);

    card.style.display = 'block';
    requestAnimationFrame(() => card.classList.add('show'));

    // Auto-populate manage tab
    populateManageFromToken(denom);

    // Auto-select in DEX dropdown
    dexAutoSelectToken(denom);

    // Register token with connected wallet (Leap/Keplr) so it shows up
    const symbol = (tokenConfig.subunit || 'token').toUpperCase();
    registerTokenWithWallet(denom, symbol, precision);

  } catch(err){
    proc.classList.remove('show');

    if(err.message === 'RATE_LIMIT'){
      showDemoError('Please wait 60 seconds between token creations.');
    } else if(err.message.startsWith('SERVER_ERROR:')){
      showDemoError(err.message.slice(13));
    } else if(err.message.includes('Request rejected') || err.message.includes('User rejected')){
      showDemoError('Transaction was rejected in your wallet.');
    } else {
      showDemoError('Token creation failed: ' + (err.message || 'Unknown error'));
    }
  } finally {
    btn.textContent = 'Deploy Token (Testnet)';
    btn.disabled = false;
    demoRunning = false;
  }
}

/* ---- Side / Order Type / Tab Switching ---- */

