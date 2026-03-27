/* ===== TXAI DEX WebSocket Client ===== */
/* Real-time orderbook, trade, and ticker streaming (1s updates like CoreDEX) */

let dexWs = null;
let dexWsReconnectTimer = null;
let dexWsReconnectDelay = 1000;
let dexWsSubscribedPair = null;
let dexWsConnected = false;

const DEX_WS_MAX_RECONNECT_DELAY = 10000;

/* ---- Connect to WebSocket ---- */
function dexWsConnect() {
  if (dexWs && (dexWs.readyState === WebSocket.OPEN || dexWs.readyState === WebSocket.CONNECTING)) return;

  // Build WS URL from API URL
  const wsUrl = API_URL.replace(/^http/, 'ws') + '/ws';
  console.log('[ws] Connecting to', wsUrl);

  try {
    dexWs = new WebSocket(wsUrl);
  } catch (e) {
    console.warn('[ws] WebSocket constructor failed:', e);
    dexWsScheduleReconnect();
    return;
  }

  dexWs.onopen = () => {
    console.log('[ws] Connected');
    dexWsConnected = true;
    dexWsReconnectDelay = 1000; // Reset backoff

    // Re-subscribe to current pair if any
    if (dexWsSubscribedPair) {
      dexWsSend({ action: 'subscribe', pair: dexWsSubscribedPair });
    }

    // Update UI indicator
    dexWsUpdateStatus(true);
  };

  dexWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      dexWsHandleMessage(msg);
    } catch (e) {
      console.warn('[ws] Parse error:', e);
    }
  };

  dexWs.onclose = () => {
    console.log('[ws] Disconnected');
    dexWsConnected = false;
    dexWsUpdateStatus(false);
    dexWsScheduleReconnect();
  };

  dexWs.onerror = (err) => {
    console.warn('[ws] Error:', err);
    // onclose will fire after this
  };
}

/* ---- Send message ---- */
function dexWsSend(msg) {
  if (dexWs && dexWs.readyState === WebSocket.OPEN) {
    dexWs.send(JSON.stringify(msg));
  }
}

/* ---- Subscribe to a pair ---- */
function dexWsSubscribe(baseDenom, quoteDenom) {
  dexWsSubscribedPair = { baseDenom, quoteDenom: quoteDenom || DEX_QUOTE_DENOM };
  if (dexWsConnected) {
    dexWsSend({ action: 'subscribe', pair: dexWsSubscribedPair });
  } else {
    // Connect first — will auto-subscribe on open
    dexWsConnect();
  }
}

/* ---- Unsubscribe ---- */
function dexWsUnsubscribe() {
  dexWsSubscribedPair = null;
  dexWsSend({ action: 'unsubscribe' });
}

/* ---- Reconnect with exponential backoff ---- */
function dexWsScheduleReconnect() {
  if (dexWsReconnectTimer) return;
  console.log(`[ws] Reconnecting in ${dexWsReconnectDelay}ms...`);
  dexWsReconnectTimer = setTimeout(() => {
    dexWsReconnectTimer = null;
    dexWsConnect();
    // Exponential backoff
    dexWsReconnectDelay = Math.min(dexWsReconnectDelay * 1.5, DEX_WS_MAX_RECONNECT_DELAY);
  }, dexWsReconnectDelay);
}

/* ---- Handle incoming messages ---- */
function dexWsHandleMessage(msg) {
  switch (msg.type) {
    case 'orderbook':
      dexWsOnOrderbook(msg.data);
      break;
    case 'trade':
      dexWsOnTrade(msg.data);
      break;
    case 'ticker':
      dexWsOnTicker(msg.data);
      break;
    case 'subscribed':
      console.log('[ws] Subscribed to', msg.pair?.baseDenom);
      break;
    case 'connected':
      console.log('[ws]', msg.message);
      break;
  }
}

/* ---- Orderbook update ---- */
function dexWsOnOrderbook(data) {
  if (!data) return;
  dexPrevOrderbook = dexLastOrderbook;
  dexLastOrderbook = data;
  dexRenderOrderbook(data);
  // Don't call dexDetectFills — server already sends trades
}

/* ---- Trade update ---- */
function dexWsOnTrade(trade) {
  if (!trade) return;
  dexTradeLog.unshift({
    price: trade.price,
    amount: trade.amount,
    side: trade.side,
    time: new Date(trade.time)
  });
  if (dexTradeLog.length > 50) dexTradeLog = dexTradeLog.slice(0, 50);
  dexRenderTradeHistory();

  // Update chart
  dexAddFillToChart(trade.price, trade.amount);

  // Update ticker stats locally too
  dexUpdateTickerFromTrade(trade.price, trade.amount);
}

/* ---- Ticker update ---- */
function dexWsOnTicker(ticker) {
  if (!ticker) return;

  const lastEl = document.getElementById('dexStatLast');
  if (lastEl && ticker.last) lastEl.textContent = dexFmt(ticker.last);

  const changeEl = document.getElementById('dexStat24hChange');
  if (changeEl) {
    const c = ticker.change24h || 0;
    changeEl.textContent = (c >= 0 ? '+' : '') + c.toFixed(2) + '%';
    changeEl.className = 'dex-stat-value ' + (c >= 0 ? 'positive' : 'negative');
  }

  const volEl = document.getElementById('dexStatVol');
  if (volEl) volEl.textContent = ticker.vol24h != null ? ticker.vol24h.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '--';

  const highEl = document.getElementById('dexStatHigh');
  if (highEl) highEl.textContent = ticker.high24h ? dexFmt(ticker.high24h) : '--';

  const lowEl = document.getElementById('dexStatLow');
  if (lowEl) lowEl.textContent = ticker.low24h ? dexFmt(ticker.low24h) : '--';

  const spreadEl = document.getElementById('dexStatSpread');
  if (spreadEl) spreadEl.textContent = ticker.spread ? dexFmt(ticker.spread) : '--';

  const bidEl = document.getElementById('dexStatBid');
  if (bidEl) bidEl.textContent = ticker.bestBid ? dexFmt(ticker.bestBid) : '--';

  const askEl = document.getElementById('dexStatAsk');
  if (askEl) askEl.textContent = ticker.bestAsk ? dexFmt(ticker.bestAsk) : '--';

  const countEl = document.getElementById('dexStatCount');
  if (countEl) countEl.textContent = ticker.orderCount || 0;
}

/* ---- UI status indicator ---- */
function dexWsUpdateStatus(connected) {
  const dotEl = document.getElementById('dexLiveDot');
  const textEl = document.getElementById('dexLiveText');
  const obDot = document.querySelector('#dexObStatus .dex-status-dot');

  if (connected) {
    if (dotEl) { dotEl.classList.add('on'); }
    if (textEl) textEl.textContent = 'Live';
    if (obDot) { obDot.className = 'dex-status-dot live'; }
    const obText = document.querySelector('#dexObStatus');
    if (obText) obText.innerHTML = '<span class="dex-status-dot live"></span> Live (1s)';
  } else {
    if (dotEl) { dotEl.classList.remove('on'); }
    if (textEl) textEl.textContent = 'Reconnecting...';
  }
}

/* ---- Disconnect ---- */
function dexWsDisconnect() {
  if (dexWsReconnectTimer) {
    clearTimeout(dexWsReconnectTimer);
    dexWsReconnectTimer = null;
  }
  dexWsSubscribedPair = null;
  if (dexWs) {
    dexWs.onclose = null; // Prevent reconnect
    dexWs.close();
    dexWs = null;
  }
  dexWsConnected = false;
}
