/* ===== TXAI - Token Creation Tab ===== */

/* Tab Switching */
function switchTab(tab){
  const tabCreate = document.getElementById('tabCreate');
  const tabChat = document.getElementById('tabChat');
  const tabDex = document.getElementById('tabDex');
  const tabSwarm = document.getElementById('tabSwarm');
  const tabNft = document.getElementById('tabNft');
  const tabManage = document.getElementById('tabManage');
  const tabAuth = document.getElementById('tabAuth');
  const createWrap = document.getElementById('createModeWrap');
  const chatWrap = document.getElementById('chatWrap');
  const dexWrap = document.getElementById('dexWrap');
  const swarmWrap = document.getElementById('swarmWrap');
  const nftWrap = document.getElementById('nftWrap');
  const manageWrap = document.getElementById('manageWrap');
  const authWrap = document.getElementById('authWrap');

  // Reset all tabs
  tabCreate.classList.remove('active');
  tabChat.classList.remove('active');
  tabDex.classList.remove('active');
  tabSwarm.classList.remove('active');
  tabNft.classList.remove('active');
  tabManage.classList.remove('active');
  tabAuth.classList.remove('active');
  createWrap.style.display = 'none';
  chatWrap.classList.remove('show');
  dexWrap.classList.remove('show');
  swarmWrap.classList.remove('show');
  nftWrap.classList.remove('show');
  manageWrap.classList.remove('show');
  authWrap.classList.remove('show');
  // Reset container width when leaving DEX/Swarm
  dexWrap.closest('.container').style.maxWidth = '';
  chatMode = false;

  if(tab === 'chat'){
    chatMode = true;
    tabChat.classList.add('active');
    chatWrap.classList.add('show');
    document.getElementById('chatInput').focus();
  } else if(tab === 'dex'){
    tabDex.classList.add('active');
    dexWrap.classList.add('show');
    // Expand container for trading terminal
    dexWrap.closest('.container').style.maxWidth = '1440px';
    // Auto-fetch wallet and pairs on first load
    if(!dexAgentWallet) dexFetchWallet();
    if(!document.getElementById('dexPairSelect').options.length || document.getElementById('dexPairSelect').options.length <= 1) dexFetchPairs();
    setTimeout(() => dexDrawDepthChart(), 100);
  } else if(tab === 'swarm'){
    tabSwarm.classList.add('active');
    swarmWrap.classList.add('show');
    swarmWrap.closest('.container').style.maxWidth = '1440px';
  } else if(tab === 'nft'){
    tabNft.classList.add('active');
    nftWrap.classList.add('show');
  } else if(tab === 'manage'){
    tabManage.classList.add('active');
    manageWrap.classList.add('show');
    document.getElementById('manageTokenDenom').focus();
  } else if(tab === 'auth'){
    tabAuth.classList.add('active');
    authWrap.classList.add('show');
    authLoadGrants();
  } else {
    tabCreate.classList.add('active');
    createWrap.style.display = '';
  }
}


/* Reset deploy buttons */
function resetDeployBtns(){
  resetDeployBtns();
  const cb = document.getElementById('demoBtnCustom');
  if(cb) cb.disabled = false;
}

/* Create Mode Toggle: Quick (AI) vs Custom (manual) */
let createMode = 'quick';
function setCreateMode(mode){
  createMode = mode;
  document.getElementById('createModeQuick').classList.toggle('active', mode === 'quick');
  document.getElementById('createModeCustom').classList.toggle('active', mode === 'custom');
  document.getElementById('quickCreateWrap').style.display = mode === 'quick' ? '' : 'none';
  document.getElementById('customCreateWrap').style.display = mode === 'custom' ? '' : 'none';
  if(mode === 'quick') document.getElementById('demoInput').focus();
  if(mode === 'custom') document.getElementById('cpName').focus();
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
  // Consonant-vowel syllable generator for pronounceable symbols
  consonants: 'BCDFGHJKLMNPRSTVWXZ',
  vowels: 'AEIOU',
  _syl(){ return this.consonants[Math.floor(Math.random()*this.consonants.length)]
              + this.vowels[Math.floor(Math.random()*this.vowels.length)]; },
  symbol(){
    const len = Math.random() < 0.5 ? 2 : 3; // 4 or 6 letter symbols
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
    // Pick 1-2 random features
    const shuffled = all.sort(()=>Math.random()-0.5);
    const count = Math.random() < 0.4 ? 1 : 2;
    return shuffled.slice(0,count);
  },
  generate(){
    const cat = this.categories[Math.floor(Math.random()*this.categories.length)];
    const sym = this.symbol();
    const sup = this.supply();
    const feats = this.features();
    const article = /^[aeiou]/i.test(cat) ? 'an' : 'a';
    return `${article} ${cat} token called ${sym} with ${sup} supply, ${feats.join(' and ')}`;
  }
};

function setRandomPlaceholder(){
  const input = document.getElementById('demoInput');
  if(!input) return;
  input.setAttribute('placeholder', 'e.g. "' + _TSG.generate() + '"');
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

  document.getElementById('tcIcon').textContent = displayName.slice(0,2);
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
    // Build a small picker overlay
    const overlay = document.getElementById('walletChoiceOverlay');
    overlay.style.display = 'flex';
    overlay.classList.add('show');
    const modal = overlay.querySelector('.wallet-choice-modal');
    modal.innerHTML = `
      <div class="wallet-choice-title">Connect Your Wallet</div>
      <div class="wallet-choice-subtitle">Choose a wallet provider to sign the token creation transaction</div>
      <div class="wallet-choice-cards">
        <div class="wallet-choice-card" id="wcKeplr" style="cursor:pointer">
          <div class="wc-icon"><img src="https://raw.githubusercontent.com/nicolaracco/kepler-ui/main/packages/icons/src/icons/keplr-logo.svg" alt="Keplr" style="width:48px;height:48px" onerror="this.parentElement.textContent='K'"></div>
          <div class="wc-label">Keplr Wallet</div>
          <div class="wc-desc">Most popular Cosmos wallet. Browser extension required.</div>
        </div>
        <div class="wallet-choice-card" id="wcLeap" style="cursor:pointer">
          <div class="wc-icon"><img src="https://assets.leapwallet.io/logos/leap-cosmos-logo.svg" alt="Leap" style="width:48px;height:48px" onerror="this.parentElement.textContent='L'"></div>
          <div class="wc-label">Leap Wallet</div>
          <div class="wc-desc">Fast Cosmos wallet with clean UI. Browser extension required.</div>
        </div>
      </div>
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
  // Restore original modal content
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
        <div class="wc-icon">&#128273;</div>
        <div class="wc-label">Your Wallet</div>
        <div class="wc-desc">Connect Keplr or Leap &mdash; you are the issuer. You can mint, burn, freeze &amp; manage the token.</div>
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
    uri: cpConfig.uri || '',
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

