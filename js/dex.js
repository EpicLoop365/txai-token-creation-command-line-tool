/* ===== TXAI - Order Book Exchange (DEX) ===== */

/* Wallet Order Placement & Cancellation */
async function dexPlaceOrderWallet(){
  const price = document.getElementById('dexPrice').value;
  const qty = document.getElementById('dexQty').value;
  if(!qty || !dexBaseDenom) return;
  if(dexOrderType === 'limit' && !price) return;

  const btn = document.getElementById('dexPlaceBtn');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Requesting Signature...';

  try {
    const orderId = `ord-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const quantityRaw = Math.round(parseFloat(qty) * Math.pow(10, DEX_DECIMALS)).toString();

    // Build the Coreum DEX MsgPlaceOrder
    const msg = {
      typeUrl: '/coreum.dex.v1.MsgPlaceOrder',
      value: {
        sender: connectedAddress,
        type: dexOrderType === 'market' ? 2 : 1,
        id: orderId,
        baseDenom: dexBaseDenom,
        quoteDenom: DEX_QUOTE_DENOM,
        price: price || '0',
        quantity: quantityRaw,
        side: dexSide === 'buy' ? 1 : 2,
        timeInForce: 1,
      }
    };

    // Track in session history
    dexSessionLog.unshift({
      type: dexOrderType, side: dexSide,
      price: price || 'market', qty: qty,
      status: 'signing', time: new Date()
    });
    dexRenderSessionHistory();

    const result = await dexBuildAndSignTx([msg], 500000);

    // Success!
    const txHash = result.txhash || result.hash || '';
    btn.textContent = 'Order Placed!';
    btn.style.background = 'var(--green)';

    dexSessionLog[0].status = 'placed';
    dexSessionLog[0].txHash = txHash;
    dexRenderSessionHistory();

    // Show tx link
    const stream = document.getElementById('dexProcStream');
    const panel = document.getElementById('dexProc');
    stream.innerHTML = `<span style="color:var(--green)">✓ Order placed successfully!</span>\n` +
      `Order ID: ${orderId}\n` +
      `TX: <a href="https://explorer.testnet-1.tx.org/tx/${txHash}" target="_blank" style="color:var(--purple)">${txHash.slice(0, 16)}...</a>`;
    panel.classList.add('show');
    setTimeout(() => panel.classList.remove('show'), 6000);

    // Refresh data
    setTimeout(() => {
      dexFetchOrderbook();
      dexFetchMyOrders();
      dexFetchBalances(connectedAddress);
    }, 3000);
  } catch(err){
    console.error('Wallet order error:', err);
    btn.textContent = 'Failed';
    btn.style.background = '#ef4444';
    dexSessionLog[0].status = 'failed';
    dexRenderSessionHistory();

    const stream = document.getElementById('dexProcStream');
    const panel = document.getElementById('dexProc');
    stream.textContent = 'Error: ' + (err.message || err);
    panel.classList.add('show');
    setTimeout(() => panel.classList.remove('show'), 8000);
  } finally {
    setTimeout(() => {
      btn.textContent = origText;
      btn.style.background = '';
      btn.disabled = false;
    }, 2000);
  }
}

async function dexCancelOrderWallet(orderId){
  if(!orderId) return;
  try {
    const msg = {
      typeUrl: '/coreum.dex.v1.MsgCancelOrder',
      value: {
        sender: connectedAddress,
        id: orderId,
      }
    };

    dexSessionLog.unshift({
      type: 'cancel', side: '--', price: '--', qty: '--',
      status: 'signing', time: new Date(), orderId: orderId
    });
    dexRenderSessionHistory();

    const result = await dexBuildAndSignTx([msg], 500000);

    dexSessionLog[0].status = 'cancelled';
    dexRenderSessionHistory();

    setTimeout(() => {
      dexFetchOrderbook();
      dexFetchMyOrders();
      dexFetchBalances(connectedAddress);
    }, 3000);
  } catch(err){
    console.error('Cancel error:', err);
    alert('Failed to cancel order: ' + (err.message || err));
    dexSessionLog[0].status = 'failed';
    dexRenderSessionHistory();
  }
}

/* ---- Create Tab Wallet Connection ---- */
/* Old per-tab wallet functions removed — now using globalConnectWallet/globalDisconnectWallet */

/* ---- Build token config directly from the Customize Panel ---- */

/* DEX UI Functions */
function dexSetSide(side){
  dexSide = side;
  document.querySelectorAll('.dex-side-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.dex-side-tab.${side}`).classList.add('active');
  const btn = document.getElementById('dexPlaceBtn');
  btn.className = `dex-place-btn ${side}`;
  btn.textContent = `Place ${side.charAt(0).toUpperCase() + side.slice(1)} Order`;
  dexUpdateTotal();
  dexUpdateBalanceDisplay();
}

function dexSetOrderType(type){
  dexOrderType = type;
  document.querySelectorAll('.dex-type-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('dexPriceGroup').style.display = type === 'market' ? 'none' : '';
  dexUpdateTotal();
}

function dexSetCenterTab(tab){
  document.querySelectorAll('.dex-center-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  document.querySelectorAll('.dex-center-pane').forEach(p => p.classList.remove('active'));
  if(tab === 'depth'){
    document.getElementById('dexDepthPane').classList.add('active');
    dexDrawDepthChart();
  } else {
    document.getElementById('dexAdvisorPane').classList.add('active');
    document.getElementById('dexChatInput').focus();
  }
}

function dexSetOrdersTab(tab){
  document.querySelectorAll('.dex-orders-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  document.querySelectorAll('.dex-orders-pane').forEach(p => p.classList.remove('active'));
  if(tab === 'open') document.getElementById('dexOpenOrdersPane').classList.add('active');
  else document.getElementById('dexSessionPane').classList.add('active');
}

function dexSetPct(pct){
  const price = parseFloat(document.getElementById('dexPrice').value) || 0;
  if(!price && dexOrderType === 'limit') return;
  let avail = 0;
  if(dexSide === 'buy'){
    avail = parseFloat(dexBalances[DEX_QUOTE_DENOM]) || 0;
    avail = dexHuman(avail);
    if(price > 0){
      const maxQty = avail / price;
      document.getElementById('dexQty').value = (maxQty * pct / 100).toFixed(6);
    }
  } else {
    avail = parseFloat(dexBalances[dexBaseDenom]) || 0;
    avail = dexHuman(avail);
    document.getElementById('dexQty').value = (avail * pct / 100).toFixed(6);
  }
  dexUpdateTotal();
}

/* ---- Core Data ---- */
function dexUpdateTotal(){
  const price = parseFloat(document.getElementById('dexPrice').value) || 0;
  const qty = parseFloat(document.getElementById('dexQty').value) || 0;
  const total = dexOrderType === 'market' ? qty : price * qty;
  document.getElementById('dexTotalDisplay').textContent = total.toFixed(6) + ' ' + DEX_QUOTE_SYMBOL;
  const canPlace = qty > 0 && dexBaseDenom && (dexOrderType === 'market' || price > 0);
  document.getElementById('dexPlaceBtn').disabled = !canPlace;
}

function dexFetchWallet(){
  fetch(API_URL + '/api/orders').then(r => r.json()).then(data => {
    if(data.wallet){
      dexAgentWallet = data.wallet;
      // Update DEX order form agent address (only if not connected)
      if(walletMode === 'agent'){
        const el = document.getElementById('dexWalletAddr');
        if(el) el.textContent = dexAgentWallet;
        dexFetchBalances(dexAgentWallet);
      }
    }
  }).catch(() => {
    const el = document.getElementById('dexWalletAddr');
    if(el) el.textContent = 'Not connected';
  });
}

// Fetch agent wallet on page load so it's ready for all tabs
setTimeout(dexFetchWallet, 500);

async function dexFetchPairs(){
  try {
    const allDenoms = new Set();

    // 1. Fetch agent wallet pairs from server
    try {
      const res = await fetch(`${API_URL}/api/pairs`);
      const data = await res.json();
      (data.pairs || []).forEach(p => {
        if(p.baseDenom) allDenoms.add(p.baseDenom);
      });
    } catch(e){ console.warn('Agent pairs fetch:', e); }

    // 2. If wallet connected, also fetch their tokens from chain
    if(walletMode !== 'agent' && connectedAddress){
      try {
        const res = await fetch(`${COREUM_REST}/cosmos/bank/v1beta1/balances/${connectedAddress}`);
        const data = await res.json();
        (data.balances || []).forEach(b => {
          // Skip native denom (utestcore) — it's the quote currency
          if(b.denom !== 'utestcore' && b.denom !== DEX_QUOTE_DENOM){
            allDenoms.add(b.denom);
          }
        });
      } catch(e){ console.warn('Wallet balances fetch:', e); }
    }

    // 3. Build dropdown sorted alphabetically
    const sel = document.getElementById('dexPairSelect');
    sel.innerHTML = '<option value="">-- Select Pair --</option>';
    const pairs = Array.from(allDenoms).map(d => ({
      base: d, name: dexTokenName(d)
    })).sort((a, b) => a.name.localeCompare(b.name));
    pairs.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.base;
      opt.textContent = `${p.name} / ${DEX_QUOTE_SYMBOL}`;
      sel.appendChild(opt);
    });
  } catch(err){ console.error('DEX pairs fetch error:', err); }
}

function dexOnPairSelect(){
  const val = document.getElementById('dexPairSelect').value;
  if(val){
    document.getElementById('dexBaseDenom').value = val;
    dexLoadOrderbook();
  }
}

/* Auto-select a newly created token in the DEX dropdown */
function dexAutoSelectToken(denom){
  const sel = document.getElementById('dexPairSelect');
  // Check if already in dropdown
  let found = false;
  for(let i = 0; i < sel.options.length; i++){
    if(sel.options[i].value === denom){ sel.selectedIndex = i; found = true; break; }
  }
  // If not found, add it to the dropdown
  if(!found){
    const name = dexTokenName(denom);
    const opt = document.createElement('option');
    opt.value = denom;
    opt.textContent = `${name} / ${DEX_QUOTE_SYMBOL}`;
    sel.appendChild(opt);
    sel.value = denom;
  }
  // Set the base denom input too
  document.getElementById('dexBaseDenom').value = denom;
  dexBaseDenom = denom;
}

async function dexFetchBalances(address){
  if(!address) return;
  try {
    // When wallet is connected, fetch directly from chain REST (no server needed)
    if(walletMode !== 'agent'){
      const res = await fetch(`${COREUM_REST}/cosmos/bank/v1beta1/balances/${address}`);
      const data = await res.json();
      dexBalances = {};
      (data.balances || []).forEach(b => { dexBalances[b.denom] = b.amount; });
    } else {
      const res = await fetch(`${API_URL}/api/balances?address=${encodeURIComponent(address)}`);
      const data = await res.json();
      dexBalances = {};
      (data.balances || []).forEach(b => { dexBalances[b.denom] = b.amount; });
    }
    dexUpdateBalanceDisplay();
  } catch(err){ console.error('DEX balance fetch error:', err); }
}

function dexUpdateBalanceDisplay(){
  const el = document.getElementById('dexAvailBalance');
  if(dexSide === 'buy'){
    const raw = parseFloat(dexBalances[DEX_QUOTE_DENOM]) || 0;
    el.textContent = dexFmt(dexHuman(raw)) + ' ' + DEX_QUOTE_SYMBOL;
  } else {
    const raw = parseFloat(dexBalances[dexBaseDenom]) || 0;
    const name = dexTokenName(dexBaseDenom);
    el.textContent = dexFmt(dexHuman(raw)) + ' ' + name;
  }
}

function dexLoadOrderbook(){
  const denom = document.getElementById('dexBaseDenom').value.trim();
  if(!denom) return;
  dexBaseDenom = denom;
  // sync the select if it has this value
  const sel = document.getElementById('dexPairSelect');
  if(sel.querySelector(`option[value="${denom}"]`)) sel.value = denom;
  dexFetchOrderbook();
  dexFetchMyOrders();
  if(dexRefreshTimer) clearInterval(dexRefreshTimer);
  dexRefreshTimer = setInterval(() => {
    dexFetchOrderbook();
    dexFetchMyOrders();
    const addr = dexGetActiveAddress();
    if(addr) dexFetchBalances(addr);
  }, DEX_REFRESH_MS);
  document.getElementById('dexObStatus').innerHTML = '<span class="dex-status-dot live"></span> Live';
  document.getElementById('dexLiveDot').classList.add('on');
  document.getElementById('dexLiveText').textContent = 'Live';
  dexUpdateTotal();
  const addr = dexGetActiveAddress();
  if(addr) dexFetchBalances(addr);
  dexUpdateAddWalletBtn();
}

async function dexFetchOrderbook(){
  if(!dexBaseDenom) return;
  try {
    const res = await fetch(`${API_URL}/api/orderbook?baseDenom=${encodeURIComponent(dexBaseDenom)}&quoteDenom=${encodeURIComponent(DEX_QUOTE_DENOM)}`);
    const data = await res.json();
    dexPrevOrderbook = dexLastOrderbook;
    dexLastOrderbook = data;
    dexRenderOrderbook(data);
    dexUpdatePairStats(data);
    dexDrawDepthChart();
    dexDetectFills(data);
  } catch(err){ console.error('DEX orderbook fetch error:', err); }
}

function dexRenderOrderbook(data){
  const askC = document.getElementById('dexAskRows');
  const bidC = document.getElementById('dexBidRows');
  const spreadRow = document.getElementById('dexSpreadRow');
  const emptyMsg = document.getElementById('dexObEmpty');

  const asks = (data.asks || []).sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
  const bids = (data.bids || []).sort((a, b) => parseFloat(b.price) - parseFloat(a.price));

  if(!asks.length && !bids.length){
    askC.innerHTML = ''; bidC.innerHTML = '';
    spreadRow.style.display = 'none';
    emptyMsg.style.display = 'block';
    emptyMsg.textContent = 'No orders in the book for this pair.';
    return;
  }
  emptyMsg.style.display = 'none';
  spreadRow.style.display = 'flex';

  const bDec = DEX_DECIMALS;

  // Cumulative depth for asks (from lowest to highest for depth bars)
  const asksSorted = [...asks].reverse(); // lowest price first
  let askCumul = 0;
  const askCumuls = asksSorted.map(o => {
    askCumul += parseFloat(o.quantity || o.remainingQuantity || o.amount || 0);
    return askCumul;
  });
  const maxAskCum = askCumul || 1;

  // Cumulative depth for bids (highest price first)
  let bidCumul = 0;
  const bidCumuls = bids.map(o => {
    bidCumul += parseFloat(o.quantity || o.remainingQuantity || o.amount || 0);
    return bidCumul;
  });
  const maxBidCum = bidCumul || 1;
  const maxCum = Math.max(maxAskCum, maxBidCum);

  // Render asks (display highest at top, lowest near spread)
  let askHTML = '';
  asks.forEach(o => {
    const rawP = parseFloat(o.price) || 0;
    const rawQ = parseFloat(o.quantity || o.remainingQuantity || o.amount || 0);
    const humanP = rawP;
    const humanQ = rawQ / Math.pow(10, bDec);
    const humanTotal = humanP * humanQ;
    // Find cumulative for this row
    const idx = asksSorted.findIndex(a => a === o);
    const cum = idx >= 0 ? askCumuls[idx] : rawQ;
    const pct = (cum / maxCum) * 100;
    askHTML += `<div class="dex-ob-row ask" onclick="dexFillPrice(${humanP})">
      <span class="price">${dexFmt(humanP)}</span><span>${dexFmt(humanQ)}</span><span>${dexFmt(humanTotal)}</span>
      <div class="dbar" style="width:${pct}%"></div></div>`;
  });
  askC.innerHTML = askHTML;

  const lowestAsk = asks.length ? parseFloat(asks[asks.length - 1].price) : null;
  const highestBid = bids.length ? parseFloat(bids[0].price) : null;
  if(lowestAsk !== null && highestBid !== null){
    const spread = lowestAsk - highestBid;
    const spreadPct = ((spread / lowestAsk) * 100).toFixed(2);
    document.getElementById('dexSpreadVal').textContent = dexFmt(spread);
    document.getElementById('dexSpreadPct').textContent = `(${spreadPct}%)`;
  } else {
    document.getElementById('dexSpreadVal').textContent = '--';
    document.getElementById('dexSpreadPct').textContent = '';
  }

  // Render bids (highest near spread)
  let bidHTML = '';
  bids.forEach((o, i) => {
    const rawP = parseFloat(o.price) || 0;
    const rawQ = parseFloat(o.quantity || o.remainingQuantity || o.amount || 0);
    const humanP = rawP;
    const humanQ = rawQ / Math.pow(10, bDec);
    const humanTotal = humanP * humanQ;
    const pct = (bidCumuls[i] / maxCum) * 100;
    bidHTML += `<div class="dex-ob-row bid" onclick="dexFillPrice(${humanP})">
      <span class="price">${dexFmt(humanP)}</span><span>${dexFmt(humanQ)}</span><span>${dexFmt(humanTotal)}</span>
      <div class="dbar" style="width:${pct}%"></div></div>`;
  });
  bidC.innerHTML = bidHTML;
}

function dexUpdatePairStats(data){
  const asks = (data.asks || []).sort((a,b) => parseFloat(a.price) - parseFloat(b.price));
  const bids = (data.bids || []).sort((a,b) => parseFloat(b.price) - parseFloat(a.price));
  const bestAsk = asks.length ? parseFloat(asks[0].price) : null;
  const bestBid = bids.length ? parseFloat(bids[0].price) : null;

  document.getElementById('dexStatAsk').textContent = bestAsk !== null ? dexFmt(bestAsk) : '--';
  document.getElementById('dexStatBid').textContent = bestBid !== null ? dexFmt(bestBid) : '--';

  if(bestAsk !== null && bestBid !== null){
    const mid = (bestAsk + bestBid) / 2;
    const spread = bestAsk - bestBid;
    document.getElementById('dexStatLast').textContent = dexFmt(mid);
    document.getElementById('dexStatSpread').textContent = dexFmt(spread);
  } else if(bestBid !== null){
    document.getElementById('dexStatLast').textContent = dexFmt(bestBid);
    document.getElementById('dexStatSpread').textContent = '--';
  } else if(bestAsk !== null){
    document.getElementById('dexStatLast').textContent = dexFmt(bestAsk);
    document.getElementById('dexStatSpread').textContent = '--';
  }
  const totalOrders = (data.asks || []).length + (data.bids || []).length;
  document.getElementById('dexStatCount').textContent = totalOrders;
}

function dexFillPrice(price){
  document.getElementById('dexPrice').value = price;
  dexUpdateTotal();
}

/* ---- Depth Chart (Canvas) ---- */
function dexDrawDepthChart(){
  const canvas = document.getElementById('dexDepthCanvas');
  if(!canvas || !dexLastOrderbook) return;
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const W = rect.width;
  const H = rect.height;
  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = '#0d0f14';
  ctx.fillRect(0, 0, W, H);

  const asks = (dexLastOrderbook.asks || []).sort((a,b) => parseFloat(a.price) - parseFloat(b.price));
  const bids = (dexLastOrderbook.bids || []).sort((a,b) => parseFloat(b.price) - parseFloat(a.price));

  if(!asks.length && !bids.length){
    ctx.fillStyle = '#6b7280';
    ctx.font = '12px "Space Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('No orderbook data', W/2, H/2);
    return;
  }

  const bDec = DEX_DECIMALS;

  // Build cumulative arrays
  let bidPoints = [];
  let cumBid = 0;
  bids.forEach(o => {
    const p = parseFloat(o.price) || 0;
    const q = (parseFloat(o.quantity || o.remainingQuantity || o.amount || 0)) / Math.pow(10, bDec);
    cumBid += q;
    bidPoints.push({ price: p, cumQty: cumBid });
  });

  let askPoints = [];
  let cumAsk = 0;
  asks.forEach(o => {
    const p = parseFloat(o.price) || 0;
    const q = (parseFloat(o.quantity || o.remainingQuantity || o.amount || 0)) / Math.pow(10, bDec);
    cumAsk += q;
    askPoints.push({ price: p, cumQty: cumAsk });
  });

  const allPrices = [...bidPoints.map(p=>p.price), ...askPoints.map(p=>p.price)];
  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const priceRange = maxPrice - minPrice || 1;
  const maxQty = Math.max(cumBid, cumAsk, 1);

  const pad = { top: 20, bottom: 24, left: 10, right: 10 };
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top - pad.bottom;

  function px(price){ return pad.left + ((price - minPrice) / priceRange) * cW; }
  function py(qty){ return pad.top + cH - (qty / maxQty) * cH; }

  // Grid lines
  ctx.strokeStyle = '#1e2130';
  ctx.lineWidth = 0.5;
  for(let i = 0; i <= 4; i++){
    const y = pad.top + (cH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
  }

  // Draw bid area (green, left side)
  if(bidPoints.length){
    ctx.beginPath();
    ctx.moveTo(px(bidPoints[0].price), py(0));
    bidPoints.forEach(p => {
      ctx.lineTo(px(p.price), py(p.cumQty));
    });
    ctx.lineTo(px(bidPoints[bidPoints.length-1].price), py(0));
    ctx.closePath();
    const gBid = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
    gBid.addColorStop(0, 'rgba(6,214,160,0.25)');
    gBid.addColorStop(1, 'rgba(6,214,160,0.02)');
    ctx.fillStyle = gBid;
    ctx.fill();

    // Bid line
    ctx.beginPath();
    ctx.moveTo(px(bidPoints[0].price), py(bidPoints[0].cumQty));
    bidPoints.forEach(p => ctx.lineTo(px(p.price), py(p.cumQty)));
    ctx.strokeStyle = '#06d6a0';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Draw ask area (red, right side)
  if(askPoints.length){
    ctx.beginPath();
    ctx.moveTo(px(askPoints[0].price), py(0));
    askPoints.forEach(p => {
      ctx.lineTo(px(p.price), py(p.cumQty));
    });
    ctx.lineTo(px(askPoints[askPoints.length-1].price), py(0));
    ctx.closePath();
    const gAsk = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
    gAsk.addColorStop(0, 'rgba(239,68,68,0.25)');
    gAsk.addColorStop(1, 'rgba(239,68,68,0.02)');
    ctx.fillStyle = gAsk;
    ctx.fill();

    // Ask line
    ctx.beginPath();
    ctx.moveTo(px(askPoints[0].price), py(askPoints[0].cumQty));
    askPoints.forEach(p => ctx.lineTo(px(p.price), py(p.cumQty)));
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Mid price label
  if(bidPoints.length && askPoints.length){
    const midP = (bidPoints[0].price + askPoints[0].price) / 2;
    const midX = px(midP);
    ctx.setLineDash([4,4]);
    ctx.strokeStyle = '#7c6dfa';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(midX, pad.top); ctx.lineTo(midX, H - pad.bottom); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#7c6dfa';
    ctx.font = '10px "Space Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(dexFmt(midP), midX, pad.top - 6);
  }

  // X-axis price labels
  ctx.fillStyle = '#6b7280';
  ctx.font = '9px "Space Mono", monospace';
  ctx.textAlign = 'center';
  for(let i = 0; i <= 4; i++){
    const p = minPrice + (priceRange / 4) * i;
    ctx.fillText(dexFmt(p), px(p), H - 6);
  }
}

/* ---- Trade Detection ---- */
function dexDetectFills(newData){
  if(!dexPrevOrderbook) return;
  const prevAll = [...(dexPrevOrderbook.bids||[]), ...(dexPrevOrderbook.asks||[])];
  const newAll = [...(newData.bids||[]), ...(newData.asks||[])];
  const newIds = new Set(newAll.map(o => o.id));
  const bDec = DEX_DECIMALS;

  prevAll.forEach(o => {
    if(!newIds.has(o.id)){
      // Order disappeared - likely filled
      const rawP = parseFloat(o.price) || 0;
      const rawQ = parseFloat(o.quantity || o.remainingQuantity || o.amount || 0);
      const humanP = rawP;
      const humanQ = rawQ / Math.pow(10, bDec);
      let side = (o.side || '').toLowerCase().replace('side_','');
      if(side !== 'buy' && side !== 'sell') side = 'buy';
      dexTradeLog.unshift({
        price: humanP,
        amount: humanQ,
        side: side,
        time: new Date()
      });
    }
  });

  // Also detect partial fills (quantity decreased)
  const prevMap = {};
  prevAll.forEach(o => { prevMap[o.id] = o; });
  newAll.forEach(o => {
    if(prevMap[o.id]){
      const prevQ = parseFloat(prevMap[o.id].quantity || prevMap[o.id].remainingQuantity || 0);
      const newQ = parseFloat(o.quantity || o.remainingQuantity || 0);
      if(newQ < prevQ){
        const rawP = parseFloat(o.price) || 0;
        const diffQ = (prevQ - newQ) / Math.pow(10, bDec);
        let side = (o.side || '').toLowerCase().replace('side_','');
        if(side !== 'buy' && side !== 'sell') side = 'buy';
        dexTradeLog.unshift({
          price: rawP,
          amount: diffQ,
          side: side,
          time: new Date()
        });
      }
    }
  });

  if(dexTradeLog.length > 50) dexTradeLog = dexTradeLog.slice(0, 50);
  dexRenderTradeHistory();
}

function dexRenderTradeHistory(){
  const el = document.getElementById('dexTradeHistory');
  if(!dexTradeLog.length){
    el.innerHTML = '<div class="dex-trade-empty">Monitoring for trades...</div>';
    return;
  }
  let html = '';
  dexTradeLog.slice(0, 20).forEach(t => {
    const color = t.side === 'buy' ? 'var(--green)' : '#ef4444';
    const timeStr = t.time.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
    html += `<div class="dex-trade-row">
      <span style="color:${color}">${dexFmt(t.price)}</span>
      <span class="t-amt">${dexFmt(t.amount)}</span>
      <span class="t-time">${timeStr}</span>
    </div>`;
  });
  el.innerHTML = html;
}

/* ---- My Orders ---- */
async function dexFetchMyOrders(){
  try {
    const addr = dexGetActiveAddress();
    const url = addr
      ? `${API_URL}/api/orders?creator=${encodeURIComponent(addr)}`
      : `${API_URL}/api/orders`;
    const res = await fetch(url);
    const data = await res.json();
    dexRenderMyOrders(data.orders || data || []);
    if(data.wallet && walletMode === 'agent'){
      dexAgentWallet = data.wallet;
      document.getElementById('dexWalletAddr').textContent = dexAgentWallet;
    }
  } catch(err){ console.error('DEX orders fetch error:', err); }
}

function dexRenderMyOrders(orders){
  const body = document.getElementById('dexMyOrdersBody');
  if(!orders.length){ body.innerHTML = '<div class="dex-no-orders">No open orders</div>'; return; }
  let html = '';
  orders.forEach(o => {
    let side = (o.side || o.direction || '').toLowerCase().replace('side_','');
    if(side !== 'buy' && side !== 'sell') side = side.includes('buy') ? 'buy' : 'sell';
    const sc = side === 'sell' ? 'sell' : 'buy';
    const rawPrice = parseFloat(o.price) || 0;
    const rawQty = parseFloat(o.quantity || o.remainingQuantity || o.amount || 0);
    const humanPrice = rawPrice;
    const humanQty = rawQty / Math.pow(10, DEX_DECIMALS);
    const id = o.id || o.order_id || '';
    const tokenName = dexTokenName(o.baseDenom || dexBaseDenom);
    html += `<div class="dex-order-row">
      <span class="dex-order-side ${sc}">${side}</span>
      <div class="dex-order-det">
        <span class="dex-order-price">${dexFmt(humanPrice)} ${DEX_QUOTE_SYMBOL}/${tokenName}</span>
        <span class="dex-order-qty">Qty: ${dexFmt(humanQty)} ${tokenName}</span>
      </div>
      <button class="dex-cancel-btn" onclick="dexCancelOrder('${id}')">Cancel</button>
    </div>`;
  });
  body.innerHTML = html;
}

/* ---- Place / Execute / Cancel ---- */
async function dexPlaceOrder(){
  // Route to wallet-signed tx if connected
  if(walletMode !== 'agent'){
    return dexPlaceOrderWallet();
  }

  const price = document.getElementById('dexPrice').value;
  const qty = document.getElementById('dexQty').value;
  if(!qty || !dexBaseDenom) return;
  if(dexOrderType === 'limit' && !price) return;

  let instruction;
  if(dexOrderType === 'market'){
    instruction = `Place a market ${dexSide} order for ${qty} tokens of ${dexBaseDenom} on the DEX orderbook.`;
  } else {
    instruction = `Place a limit ${dexSide} order for ${qty} tokens of ${dexBaseDenom} at a price of ${price} ${DEX_QUOTE_SYMBOL} per token on the DEX orderbook.`;
  }

  // Track in session history
  dexSessionLog.unshift({
    type: dexOrderType,
    side: dexSide,
    price: price || 'market',
    qty: qty,
    status: 'pending',
    time: new Date()
  });
  dexRenderSessionHistory();

  await dexExecuteTrade(instruction);

  // Update status to placed
  if(dexSessionLog.length){
    dexSessionLog[0].status = 'placed';
    dexRenderSessionHistory();
  }
}

async function dexExecuteTrade(instruction){
  const panel = document.getElementById('dexProc');
  const stream = document.getElementById('dexProcStream');
  panel.classList.add('show');
  stream.textContent = '';
  document.getElementById('dexPlaceBtn').disabled = true;

  try {
    const res = await fetch(`${API_URL}/api/trade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction })
    });

    if(res.headers.get('content-type')?.includes('text/event-stream')){
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while(true){
        const { value, done } = await reader.read();
        if(done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for(const line of lines){
          if(line.startsWith('data: ')){
            const payload = line.slice(6);
            if(payload === '[DONE]') continue;
            try {
              const parsed = JSON.parse(payload);
              if(parsed.message){ stream.textContent += parsed.message + '\n'; stream.scrollTop = stream.scrollHeight; }
              if(parsed.status === 'complete' || parsed.done){
                setTimeout(() => { dexFetchOrderbook(); dexFetchMyOrders(); }, 2000);
              }
            } catch{ stream.textContent += payload + '\n'; stream.scrollTop = stream.scrollHeight; }
          }
        }
      }
    } else {
      const data = await res.json();
      stream.textContent = data.message || data.result || JSON.stringify(data, null, 2);
      setTimeout(() => { dexFetchOrderbook(); dexFetchMyOrders(); }, 2000);
    }
  } catch(err){
    stream.textContent = 'Error: ' + err.message;
  } finally {
    document.getElementById('dexPlaceBtn').disabled = false;
    setTimeout(() => panel.classList.remove('show'), 8000);
  }
}

async function dexCancelOrder(orderId){
  if(!orderId) return;

  // Route to wallet-signed cancel if connected
  if(walletMode !== 'agent'){
    return dexCancelOrderWallet(orderId);
  }

  dexSessionLog.unshift({
    type: 'cancel',
    side: '--',
    price: '--',
    qty: '--',
    status: 'cancelled',
    time: new Date(),
    orderId: orderId
  });
  dexRenderSessionHistory();
  await dexExecuteTrade(`Cancel order ${orderId} on the DEX orderbook.`);
}

function dexRenderSessionHistory(){
  const el = document.getElementById('dexSessionHistory');
  if(!dexSessionLog.length){
    el.innerHTML = '<div class="dex-no-orders">No orders placed this session</div>';
    return;
  }
  let html = '';
  dexSessionLog.forEach(o => {
    const statusClass = o.status === 'placed' ? 'placed' : o.status === 'cancelled' ? 'cancelled' : 'pending';
    const timeStr = o.time.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const sideColor = o.side === 'buy' ? 'var(--green)' : o.side === 'sell' ? '#ef4444' : 'var(--text-muted)';
    html += `<div class="dex-session-row">
      <span class="dex-session-status ${statusClass}">${o.status}</span>
      <span style="color:${sideColor};text-transform:uppercase;font-weight:600">${o.side}</span>
      <span style="color:var(--text)">${o.price}</span>
      <span style="color:var(--text-dim)">${o.qty}</span>
      <span style="color:var(--text-muted)">${timeStr}</span>
    </div>`;
  });
  el.innerHTML = html;
}

/* ---- DEX Chat (AI Advisor) ---- */
async function dexSendChat(){
  const input = document.getElementById('dexChatInput');
  const msg = input.value.trim();
  if(!msg) return;
  input.value = '';
  dexChatHistory.push({ role: 'user', content: msg });
  dexAppendMsg('user', msg);
  document.getElementById('dexChatSendBtn').disabled = true;

  const container = document.getElementById('dexChatMessages');
  const typingEl = document.createElement('div');
  typingEl.className = 'dex-chat-msg';
  typingEl.id = 'dexChatTyping';
  typingEl.innerHTML = '<div class="dex-chat-avatar ai">AI</div><div class="dex-chat-bubble ai" style="opacity:.6">Thinking...</div>';
  container.appendChild(typingEl);
  container.scrollTop = container.scrollHeight;

  try {
    const res = await fetch(`${API_URL}/api/dex-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: dexChatHistory })
    });
    const data = await res.json();
    const reply = data.message || data.reply || data.response || '';
    dexChatHistory.push({ role: 'assistant', content: reply });

    const t = document.getElementById('dexChatTyping'); if(t) t.remove();
    dexAppendMsg('assistant', reply);

    const configMatch = reply.match(/===ORDER_CONFIG===\s*(\{[\s\S]*?\})\s*===ORDER_CONFIG===/);
    if(configMatch){
      try {
        const cfg = JSON.parse(configMatch[1]);
        if(cfg.side) dexSetSide(cfg.side);
        if(cfg.price) document.getElementById('dexPrice').value = cfg.price;
        if(cfg.quantity) document.getElementById('dexQty').value = cfg.quantity;
        if(cfg.baseDenom && !dexBaseDenom){
          document.getElementById('dexBaseDenom').value = cfg.baseDenom;
          dexBaseDenom = cfg.baseDenom;
        }
        dexUpdateTotal();
      } catch(e){}
    }
  } catch(err){
    const t = document.getElementById('dexChatTyping'); if(t) t.remove();
    dexAppendMsg('assistant', 'Connection error. Please try again.');
  }
  document.getElementById('dexChatSendBtn').disabled = false;
}

function dexAppendMsg(role, text){
  const container = document.getElementById('dexChatMessages');
  let displayText = text.replace(/===ORDER_CONFIG===[\s\S]*?===ORDER_CONFIG===/g, '').trim();
  const cls = role === 'user' ? 'user' : '';
  const avatarCls = role === 'user' ? 'user' : 'ai';
  const avatarText = role === 'user' ? 'You' : 'AI';
  const bubbleCls = role === 'user' ? 'user' : 'ai';
  const html = `<div class="dex-chat-msg ${cls}">
    <div class="dex-chat-avatar ${avatarCls}">${avatarText}</div>
    <div class="dex-chat-bubble ${bubbleCls}">${escapeHtml(displayText)}</div>
  </div>`;
  container.insertAdjacentHTML('beforeend', html);
  container.scrollTop = container.scrollHeight;
}

/* ---- Utility ---- */
function dexFmt(n){
  if(isNaN(n) || n === null || n === undefined) return '--';
  if(n === 0) return '0';
  if(Math.abs(n) >= 1) return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  return n.toPrecision(6);
}

function dexHuman(raw, decimals){
  decimals = decimals || DEX_DECIMALS;
  const n = parseFloat(raw) || 0;
  return n / Math.pow(10, decimals);
}

function dexTokenName(denom){
  if(!denom) return '?';
  const parts = denom.split('-');
  return parts[0].toUpperCase();
}

/* Auto-populate DEX after token creation */
function populateDexFromToken(denom){
  if(denom){
    dexAutoSelectToken(denom);
  }
}

/* Resize depth chart when window resizes */
window.addEventListener('resize', () => {
  if(dexLastOrderbook) dexDrawDepthChart();
});

/* ===== LIVE DEX DEMO — AI Agent Swarm ===== */

let dexDemoEventSource = null;
let dexDemoStartTime = null;
let dexDemoTimerInterval = null;
let dexDemoOrderCounts = { A: 0, B: 0, Taker: 0 };
const EXPLORER_TX_URL = 'https://explorer.testnet-1.tx.org/tx/transactions/';
const EXPLORER_ACCT_URL = 'https://explorer.testnet-1.tx.org/tx/accounts/';

function txLink(hash) {
  if (!hash) return '';
  return ` <a href="${EXPLORER_TX_URL}${hash}" target="_blank" class="demo-tx-link" title="View on Explorer">${hash.slice(0, 8)}...</a>`;
}
function addrLink(addr) {
  if (!addr) return '';
  return `<a href="${EXPLORER_ACCT_URL}${addr}" target="_blank" class="demo-addr-link" title="View on Explorer">${addr.slice(0, 14)}...</a>`;
}

// Track deposit state for the modal
let dexDepositBaseDenom = '';

async function dexStartDemo() {
  // Must have a token loaded
  if (!dexBaseDenom) {
    alert('Please load a token in the DEX first, then click Populate Orderbook.');
    return;
  }

  // Step 1: Check if agent already has enough tokens
  try {
    const checkRes = await fetch(`${API_URL}/api/dex/check-demo-ready`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseDenom: dexBaseDenom }),
    });
    const checkData = await checkRes.json();

    if (checkData.ready) {
      // Agent has tokens — launch demo directly
      dexLaunchDemoOverlay();
    } else {
      // Agent doesn't have tokens — show deposit modal
      dexDepositBaseDenom = dexBaseDenom;
      document.getElementById('dexDepositAmount').textContent = checkData.tokensNeeded.toLocaleString();
      document.getElementById('dexDepositSymbol').textContent = checkData.symbol;
      document.getElementById('dexDepositAddress').textContent = checkData.agentAddress;
      document.getElementById('dexDepositStatus').textContent = '';
      document.getElementById('dexDepositStatus').className = 'dex-deposit-status';
      document.getElementById('dexDepositCheckBtn').disabled = false;
      document.getElementById('dexDepositModal').style.display = 'flex';
    }
  } catch (err) {
    alert('Could not check demo readiness: ' + err.message);
  }
}

function dexCloseDeposit() {
  document.getElementById('dexDepositModal').style.display = 'none';
}

function dexCopyDepositAddr() {
  const addr = document.getElementById('dexDepositAddress').textContent;
  navigator.clipboard.writeText(addr).then(() => {
    const btn = document.querySelector('.dex-deposit-copy');
    const orig = btn.textContent;
    btn.textContent = '✅ Copied!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });
}

async function dexCheckAndStart() {
  const btn = document.getElementById('dexDepositCheckBtn');
  const status = document.getElementById('dexDepositStatus');
  btn.disabled = true;
  status.textContent = 'Checking balance...';
  status.className = 'dex-deposit-status';

  try {
    const res = await fetch(`${API_URL}/api/dex/check-demo-ready`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseDenom: dexDepositBaseDenom }),
    });
    const data = await res.json();

    if (data.ready) {
      status.textContent = 'Tokens received! Launching demo...';
      status.className = 'dex-deposit-status success';
      document.getElementById('dexDepositModal').style.display = 'none';
      dexLaunchDemoOverlay();
    } else {
      const held = data.tokensHeld || 0;
      const needed = data.tokensNeeded || 7000;
      status.textContent = `Received ${held.toLocaleString()} of ${needed.toLocaleString()} ${data.symbol} needed. Please send more tokens.`;
      status.className = 'dex-deposit-status error';
      btn.disabled = false;
    }
  } catch (err) {
    status.textContent = 'Error checking: ' + err.message;
    status.className = 'dex-deposit-status error';
    btn.disabled = false;
  }
}

function dexLaunchDemoOverlay() {
  const overlay = document.getElementById('dexDemoOverlay');
  if (!overlay) return;

  const tokenSymbol = dexBaseDenom.split('-')[0].toUpperCase();
  // Determine returnAddress: if user has a connected wallet, return tokens to them
  const returnAddr = (typeof walletMode !== 'undefined' && walletMode !== 'agent' && typeof connectedAddress !== 'undefined' && connectedAddress)
    ? connectedAddress
    : undefined;

  // Reset UI
  overlay.style.display = 'flex';
  document.getElementById('dexDemoTokenName').textContent = tokenSymbol;
  document.getElementById('dexDemoTimeline').innerHTML =
    `<div class="demo-log-entry info">Populating ${tokenSymbol} orderbook with 3 AI agents...</div>`;
  document.getElementById('dexDemoSummary').style.display = 'none';
  document.getElementById('dexDemoPhase').textContent = 'Initializing...';
  document.getElementById('dexDemoBar').style.width = '0%';
  document.getElementById('demoAddrA').textContent = 'Creating wallet...';
  document.getElementById('demoAddrB').textContent = 'Creating wallet...';
  document.getElementById('demoAddrTaker').textContent = 'Creating wallet...';
  document.getElementById('demoBalA').textContent = '--';
  document.getElementById('demoBalB').textContent = '--';
  document.getElementById('demoBalTaker').textContent = '--';
  document.getElementById('demoOrdersA').textContent = '0';
  document.getElementById('demoOrdersB').textContent = '0';
  document.getElementById('demoOrdersTaker').textContent = '0';
  dexDemoOrderCounts = { A: 0, B: 0, Taker: 0 };

  // Start timer
  dexDemoStartTime = Date.now();
  dexDemoTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - dexDemoStartTime) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    document.getElementById('dexDemoTimer').textContent = `${m}:${s}`;
  }, 1000);

  // Use fetch-based SSE
  dexDemoFetchSSE(dexBaseDenom, returnAddr);
}

async function dexDemoFetchSSE(baseDenom, returnAddress) {
  try {
    const body = { baseDenom };
    if (returnAddress) body.returnAddress = returnAddress;
    const res = await fetch(`${API_URL}/api/dex/live-demo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      dexDemoLog('error', err.error || `HTTP ${res.status}`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events from buffer
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // keep incomplete line

      let currentEvent = '';
      let currentData = '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          currentData = line.slice(6).trim();
        } else if (line === '' && currentEvent && currentData) {
          // End of event
          try {
            const data = JSON.parse(currentData);
            dexDemoProcessEvent(currentEvent, data);
          } catch { /* ignore parse errors */ }
          currentEvent = '';
          currentData = '';
        }
      }
    }
  } catch (err) {
    dexDemoLog('error', `Connection error: ${err.message}`);
  }
}

function dexDemoProcessEvent(event, data) {
  const phases = {
    wallets: 5, funding: 15, connecting: 20, token: 25,
    transfer: 30, orders: 40, fills: 70, taker: 85, summary: 95,
  };

  switch (event) {
    case 'phase':
      document.getElementById('dexDemoPhase').textContent = data.message;
      if (phases[data.phase]) {
        document.getElementById('dexDemoBar').style.width = phases[data.phase] + '%';
      }
      dexDemoLog('info', data.message);
      break;

    case 'wallet':
      dexDemoLog('success', `${data.agent} (${data.role}): ${addrLink(data.address)}`);
      if (data.agent.includes('Maker A')) {
        document.getElementById('demoAddrA').innerHTML = addrLink(data.address);
      } else if (data.agent.includes('Maker B')) {
        document.getElementById('demoAddrB').innerHTML = addrLink(data.address);
      } else if (data.agent.includes('Taker')) {
        document.getElementById('demoAddrTaker').innerHTML = addrLink(data.address);
      }
      break;

    case 'funding':
      const icon = data.success ? '💰' : '⚠️';
      dexDemoLog(data.success ? 'info' : 'warn',
        `${icon} ${data.agent} faucet ${data.request}/${data.total}: ${data.success ? 'funded' : data.message}`);
      break;

    case 'balance':
      if (data.tokenBalance) {
        dexDemoLog('success', `${data.agent}: ${data.txBalance} | ${data.tokenBalance}`);
      } else {
        dexDemoLog('success', `${data.agent}: ${data.display}`);
      }
      if (data.agent?.includes('Maker A')) {
        document.getElementById('demoBalA').textContent = data.display || data.txBalance || '--';
      } else if (data.agent?.includes('Maker B')) {
        document.getElementById('demoBalB').textContent = data.display || data.txBalance || '--';
      } else if (data.agent?.includes('Taker')) {
        document.getElementById('demoBalTaker').textContent = data.display || data.txBalance || '--';
      }
      break;

    case 'token':
      dexDemoLog('success', `Target token: <b>${data.symbol}</b>`);
      break;

    case 'transfer':
      dexDemoLog('transfer', `💰 ${data.from} → ${data.to}: <b>${data.amount.toLocaleString()} ${data.symbol}</b>${txLink(data.txHash)}`);
      break;

    case 'order': {
      const sideIcon = data.side === 'buy' ? '🟢' : '🔴';
      const statusIcon = data.status === 'placed' ? '✅' : data.status === 'error' ? '❌' : '⚠️';
      const overlap = data.overlap ? ' <span class="demo-overlap-badge">MATCH</span>' : '';
      const tx = data.txHash ? txLink(data.txHash) : '';
      dexDemoLog(data.status === 'error' ? 'error' : 'order',
        `${sideIcon} ${statusIcon} ${data.agent?.split(' ')[0] || '?'}: ${data.side?.toUpperCase()} <b>${data.quantity || '?'} ${data.symbol || ''}</b> @ ${data.priceDisplay || data.price} TX${overlap}${tx}`);

      // Update order count
      if (data.agent?.includes('Maker A')) {
        dexDemoOrderCounts.A++;
        document.getElementById('demoOrdersA').textContent = dexDemoOrderCounts.A;
      } else if (data.agent?.includes('Maker B')) {
        dexDemoOrderCounts.B++;
        document.getElementById('demoOrdersB').textContent = dexDemoOrderCounts.B;
      }

      // Update progress bar incrementally
      const totalOrders = 23; // 12 buy + 11 sell
      const totalPlaced = dexDemoOrderCounts.A + dexDemoOrderCounts.B;
      const orderProgress = 40 + (totalPlaced / totalOrders) * 45;
      document.getElementById('dexDemoBar').style.width = Math.min(orderProgress, 85) + '%';
      break;
    }

    case 'fill':
      dexDemoLog('fill', `⚡ FILL: <b>${data.buyQty || data.quantity} ${data.symbol}</b> @ ${data.priceDisplay} TX — ${data.buyer} ↔ ${data.seller}${txLink(data.txHash)}`);
      break;

    case 'taker':
      const takerIcon = data.action === 'buy' ? '🟢' : '🔴';
      dexDemoLog('taker', `${takerIcon} Taker ${data.action?.toUpperCase()}: <b>${data.quantity || '?'}</b> @ ${data.price}${txLink(data.txHash)}`);
      dexDemoOrderCounts.Taker++;
      document.getElementById('demoOrdersTaker').textContent = dexDemoOrderCounts.Taker;
      break;

    case 'summary':
      document.getElementById('dexDemoBar').style.width = '100%';
      document.getElementById('dexDemoPhase').textContent = 'Demo complete!';
      document.getElementById('dexDemoSummary').style.display = 'block';
      document.getElementById('demoSummaryGrid').innerHTML = `
        <div class="demo-stat"><span class="demo-stat-label">Token</span><span class="demo-stat-value">${data.token?.symbol || '?'}</span></div>
        <div class="demo-stat"><span class="demo-stat-label">Orders Placed</span><span class="demo-stat-value">${data.totals?.placed || 0}</span></div>
        <div class="demo-stat"><span class="demo-stat-label">Fills</span><span class="demo-stat-value">${data.totals?.fills || 0}</span></div>
        <div class="demo-stat"><span class="demo-stat-label">Errors</span><span class="demo-stat-value">${data.totals?.errors || 0}</span></div>
        <div class="demo-stat"><span class="demo-stat-label">Final Bids</span><span class="demo-stat-value green">${data.orderbook?.bids || 0}</span></div>
        <div class="demo-stat"><span class="demo-stat-label">Final Asks</span><span class="demo-stat-value red">${data.orderbook?.asks || 0}</span></div>
      `;

      // Load the demo token's orderbook in the main DEX view
      if (data.token?.denom) {
        document.getElementById('dexBaseDenom').value = data.token.denom;
        dexLoadOrderbook();
      }
      break;

    case 'return':
      if (data.step === 'sweep') {
        dexDemoLog('transfer', `🔄 Sweeping: ${data.from} → Agent: ${(data.amount || 0).toLocaleString()} ${data.symbol}`);
      } else if (data.step === 'refund') {
        dexDemoLog('success', `💰 Returned <b>${(data.amount || 0).toLocaleString()} ${data.symbol}</b> to your wallet${txLink(data.txHash)}`);
      } else if (data.step === 'error') {
        dexDemoLog('warn', `⚠️ ${data.message}`);
      }
      break;

    case 'done':
      dexDemoLog('success', '🏁 Demo complete! The orderbook is now populated.');
      if (dexDemoTimerInterval) clearInterval(dexDemoTimerInterval);
      break;

    case 'error':
      dexDemoLog('error', `💀 ${data.message}`);
      if (dexDemoTimerInterval) clearInterval(dexDemoTimerInterval);
      break;
  }
}

function dexDemoLog(type, message) {
  const timeline = document.getElementById('dexDemoTimeline');
  if (!timeline) return;
  const entry = document.createElement('div');
  entry.className = `demo-log-entry ${type}`;
  const time = new Date().toLocaleTimeString();
  entry.innerHTML = `<span class="demo-log-time">${time}</span> ${message}`;
  timeline.appendChild(entry);
  timeline.scrollTop = timeline.scrollHeight;
}

function dexStopDemo() {
  const overlay = document.getElementById('dexDemoOverlay');
  if (overlay) overlay.style.display = 'none';
  if (dexDemoTimerInterval) {
    clearInterval(dexDemoTimerInterval);
    dexDemoTimerInterval = null;
  }
  // Note: the fetch-based SSE doesn't have a clean abort mechanism
  // The server will detect the closed connection via req.on('close')
}

/* ---- Add Token to Wallet (Leap/Keplr) ---- */
function dexUpdateAddWalletBtn() {
  const btn = document.getElementById('dexAddWalletBtn');
  if (!btn) return;
  // Show when a token is loaded (useful even without wallet — shows copy instructions)
  btn.style.display = dexBaseDenom ? '' : 'none';
}

async function dexAddTokenToWallet() {
  if (!dexBaseDenom) { alert('Load a token first.'); return; }

  const symbol = dexBaseDenom.split('-')[0].toUpperCase();

  // Try the programmatic approach first (may work on some wallet versions)
  if (walletMode !== 'agent' && connectedAddress) {
    try { await registerTokenWithWallet(dexBaseDenom, symbol, 6); } catch {}
  }

  // Always show the helper modal with manual instructions + copy button
  dexShowAddTokenModal(symbol);
}

function dexShowAddTokenModal(symbol) {
  // Remove existing modal if any
  const existing = document.getElementById('dexAddTokenModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'dexAddTokenModal';
  modal.className = 'dex-deposit-overlay';
  modal.innerHTML = `
    <div class="dex-deposit-panel">
      <div class="dex-deposit-header">
        <h3>➕ Add ${symbol} to Your Wallet</h3>
        <button class="dex-demo-close" onclick="document.getElementById('dexAddTokenModal').remove()">✕</button>
      </div>
      <div class="dex-deposit-body">
        <p class="dex-deposit-desc">
          Custom tokens on Coreum need to be added manually in Leap/Keplr.
        </p>
        <p class="dex-deposit-instruction">
          <b>In Leap:</b> Home → scroll down → click the ⚙️ filter icon next to "Your tokens" → search for your token or toggle it on.
        </p>
        <p class="dex-deposit-instruction" style="margin-top:8px">
          <b>Token denom</b> (copy this):
        </p>
        <div class="dex-deposit-address-row">
          <code id="dexAddTokenDenom">${dexBaseDenom}</code>
          <button class="dex-deposit-copy" onclick="navigator.clipboard.writeText('${dexBaseDenom}').then(()=>{this.textContent='✅ Copied!';setTimeout(()=>this.textContent='📋 Copy',2000)})">📋 Copy</button>
        </div>
        <p class="dex-deposit-note">
          Your ${symbol} tokens are on-chain and safe. This is just a wallet display issue — Leap doesn't auto-detect custom Coreum tokens yet.
        </p>
        <div class="dex-deposit-actions">
          <button class="dex-deposit-check-btn" onclick="document.getElementById('dexAddTokenModal').remove()" style="background:linear-gradient(135deg,#22c55e,#16a34a)">Got it</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

