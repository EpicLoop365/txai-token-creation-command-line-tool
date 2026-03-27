/**
 * ws-server.ts — WebSocket real-time orderbook + trade + ticker streaming
 *
 * Architecture (mirrors CoreDEX):
 *   - Server polls Coreum REST every 1 second per active pair
 *   - Broadcasts full orderbook snapshots to all subscribers
 *   - Detects fills by comparing snapshots (order disappears = trade)
 *   - Pushes ticker updates (24h change, vol, high, low)
 *
 * Client protocol:
 *   → { action: "subscribe", pair: { baseDenom, quoteDenom } }
 *   → { action: "unsubscribe" }
 *   ← { type: "orderbook", data: { bids, asks } }
 *   ← { type: "trade", data: { price, amount, side, time } }
 *   ← { type: "ticker", data: { last, change24h, vol24h, high24h, low24h, spread, bestBid, bestAsk, orderCount } }
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import { queryOrderbook } from "./tx-sdk";
import type { NetworkName } from "./tx-sdk";

/* ---- Types ---- */
interface DexOrder {
  id: string;
  price: string;
  quantity?: string;
  remainingQuantity?: string;
  amount?: string;
  side?: string;
}
interface OrderbookData {
  bids: DexOrder[];
  asks: DexOrder[];
}
interface Subscriber {
  ws: WebSocket;
  baseDenom: string;
  quoteDenom: string;
}
interface PairState {
  baseDenom: string;
  quoteDenom: string;
  subscribers: Set<WebSocket>;
  lastOrderbook: OrderbookData | null;
  ticker: {
    firstPrice: number | null;
    lastPrice: number;
    high: number;
    low: number;
    volume: number;
    tradeCount: number;
  };
  interval: ReturnType<typeof setInterval> | null;
}

/* ---- State ---- */
const POLL_INTERVAL = 1000; // 1 second, same as CoreDEX
const pairStates = new Map<string, PairState>();

function pairKey(base: string, quote: string) {
  return `${base}__${quote}`;
}

/* ---- Broadcast helpers ---- */
function sendJson(ws: WebSocket, data: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(data));
    } catch {}
  }
}

function broadcast(subs: Set<WebSocket>, data: unknown) {
  const msg = JSON.stringify(data);
  subs.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(msg);
      } catch {}
    }
  });
}

/* ---- Trade detection (compare snapshots) ---- */
function detectTrades(
  prev: OrderbookData | null,
  curr: OrderbookData,
  decimals: number
): Array<{ price: number; amount: number; side: string; time: string }> {
  if (!prev) return [];
  const trades: Array<{ price: number; amount: number; side: string; time: string }> = [];
  const prevAll = [...(prev.bids || []), ...(prev.asks || [])];
  const currAll = [...(curr.bids || []), ...(curr.asks || [])];
  const currIds = new Set(currAll.map((o) => o.id));
  const prevMap = new Map<string, DexOrder>();
  prevAll.forEach((o) => prevMap.set(o.id, o));

  // Full fills (order disappeared)
  prevAll.forEach((o) => {
    if (!currIds.has(o.id)) {
      const p = parseFloat(o.price) || 0;
      const q = parseFloat(o.quantity || o.remainingQuantity || o.amount || "0") / Math.pow(10, decimals);
      let side = (o.side || "").toLowerCase().replace("side_", "");
      if (side !== "buy" && side !== "sell") side = "buy";
      if (p > 0 && q > 0) {
        trades.push({ price: p, amount: q, side, time: new Date().toISOString() });
      }
    }
  });

  // Partial fills (quantity decreased)
  currAll.forEach((o) => {
    const prev = prevMap.get(o.id);
    if (prev) {
      const prevQ = parseFloat(prev.quantity || prev.remainingQuantity || "0");
      const currQ = parseFloat(o.quantity || o.remainingQuantity || "0");
      if (currQ < prevQ) {
        const p = parseFloat(o.price) || 0;
        const diffQ = (prevQ - currQ) / Math.pow(10, decimals);
        let side = (o.side || "").toLowerCase().replace("side_", "");
        if (side !== "buy" && side !== "sell") side = "buy";
        if (p > 0 && diffQ > 0) {
          trades.push({ price: p, amount: diffQ, side, time: new Date().toISOString() });
        }
      }
    }
  });

  return trades;
}

/* ---- Ticker computation ---- */
function computeTicker(state: PairState, book: OrderbookData) {
  const asks = (book.asks || []).sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
  const bids = (book.bids || []).sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
  const bestAsk = asks.length ? parseFloat(asks[0].price) : 0;
  const bestBid = bids.length ? parseFloat(bids[0].price) : 0;
  const last = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk;
  const spread = bestAsk && bestBid ? bestAsk - bestBid : 0;
  const orderCount = (book.asks || []).length + (book.bids || []).length;

  const t = state.ticker;
  const change24h = t.firstPrice && t.firstPrice > 0 ? ((last - t.firstPrice) / t.firstPrice) * 100 : 0;

  return {
    last,
    change24h: +change24h.toFixed(2),
    vol24h: +t.volume.toFixed(2),
    high24h: t.high > 0 ? t.high : last,
    low24h: t.low < Infinity && t.low > 0 ? t.low : last,
    spread,
    bestBid,
    bestAsk,
    orderCount,
  };
}

/* ---- Poll loop for a pair ---- */
function startPairPolling(key: string, state: PairState) {
  if (state.interval) return;
  const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";

  console.log(`[ws] Starting 1s poll for ${state.baseDenom} / ${state.quoteDenom}`);

  state.interval = setInterval(async () => {
    if (state.subscribers.size === 0) {
      // No subscribers — stop polling
      if (state.interval) clearInterval(state.interval);
      state.interval = null;
      pairStates.delete(key);
      console.log(`[ws] Stopped polling for ${key} (no subscribers)`);
      return;
    }

    try {
      const book = await queryOrderbook(state.baseDenom, state.quoteDenom, networkName);

      // Detect trades
      const trades = detectTrades(state.lastOrderbook, book, 6);

      // Update ticker from trades
      trades.forEach((t) => {
        if (!state.ticker.firstPrice) state.ticker.firstPrice = t.price;
        state.ticker.lastPrice = t.price;
        if (t.price > state.ticker.high) state.ticker.high = t.price;
        if (t.price < state.ticker.low) state.ticker.low = t.price;
        state.ticker.volume += t.amount;
        state.ticker.tradeCount++;
      });

      state.lastOrderbook = book;

      // Broadcast orderbook
      broadcast(state.subscribers, { type: "orderbook", data: book });

      // Broadcast trades
      trades.forEach((t) => {
        broadcast(state.subscribers, { type: "trade", data: t });
      });

      // Broadcast ticker
      const ticker = computeTicker(state, book);
      broadcast(state.subscribers, { type: "ticker", data: ticker });
    } catch (err) {
      // Silently retry next interval
    }
  }, POLL_INTERVAL);
}

/* ---- Public: attach WS server to HTTP server ---- */
export function attachWebSocket(server: HttpServer) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  console.log("[ws] WebSocket server attached at /ws");

  wss.on("connection", (ws) => {
    let currentPairKey: string | null = null;

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.action === "subscribe" && msg.pair?.baseDenom) {
          const base = msg.pair.baseDenom;
          const networkName = (process.env.TX_NETWORK as NetworkName) || "testnet";
          const quote = msg.pair.quoteDenom || (
            networkName === "testnet" ? "utestcore" :
            networkName === "devnet" ? "udevcore" : "ucore"
          );
          const key = pairKey(base, quote);

          // Unsubscribe from previous pair
          if (currentPairKey && currentPairKey !== key) {
            const oldState = pairStates.get(currentPairKey);
            if (oldState) oldState.subscribers.delete(ws);
          }

          // Get or create pair state
          if (!pairStates.has(key)) {
            pairStates.set(key, {
              baseDenom: base,
              quoteDenom: quote,
              subscribers: new Set(),
              lastOrderbook: null,
              ticker: {
                firstPrice: null,
                lastPrice: 0,
                high: 0,
                low: Infinity,
                volume: 0,
                tradeCount: 0,
              },
              interval: null,
            });
          }

          const state = pairStates.get(key)!;
          state.subscribers.add(ws);
          currentPairKey = key;

          // Send current orderbook immediately if available
          if (state.lastOrderbook) {
            sendJson(ws, { type: "orderbook", data: state.lastOrderbook });
            const ticker = computeTicker(state, state.lastOrderbook);
            sendJson(ws, { type: "ticker", data: ticker });
          }

          // Start polling if not already
          startPairPolling(key, state);

          sendJson(ws, { type: "subscribed", pair: { baseDenom: base, quoteDenom: quote } });
        }

        if (msg.action === "unsubscribe") {
          if (currentPairKey) {
            const state = pairStates.get(currentPairKey);
            if (state) state.subscribers.delete(ws);
            currentPairKey = null;
          }
        }
      } catch {}
    });

    ws.on("close", () => {
      if (currentPairKey) {
        const state = pairStates.get(currentPairKey);
        if (state) state.subscribers.delete(ws);
      }
    });

    ws.on("error", () => {
      if (currentPairKey) {
        const state = pairStates.get(currentPairKey);
        if (state) state.subscribers.delete(ws);
      }
    });

    // Welcome message
    sendJson(ws, { type: "connected", message: "TXAI DEX WebSocket" });
  });

  return wss;
}
