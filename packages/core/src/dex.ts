/**
 * dex.ts — DEX operations for TX blockchain
 */

import { TxClient, TransactionResult } from "./client.js";
import { NETWORKS, NetworkName } from "./networks.js";
import {
  encodeString,
  extractRepeatedMessages,
  parseOrderFromProto,
  abciQuery,
} from "./proto.js";

// ─── ENUMS & CONSTANTS ──────────────────────────────────────────────────────

export enum DexSide {
  BUY = 1,
  SELL = 2,
}

export enum DexOrderType {
  LIMIT = 1,
  MARKET = 2,
}

export enum DexTimeInForce {
  GTC = 1,
  IOC = 2,
  FOK = 3,
}

export const DEX_MODULE_ADDRESS_TESTNET = "testcore1n58mly6f7er0zs6swtetqgfqs36jaarq7y4dx0";
export const DEX_MODULE_ADDRESS_MAINNET = "core1n58mly6f7er0zs6swtetqgfqs36jaarqgswsfe";

export function getDexModuleAddress(networkName: NetworkName): string {
  return networkName === "mainnet" ? DEX_MODULE_ADDRESS_MAINNET : DEX_MODULE_ADDRESS_TESTNET;
}

// ─── TYPES ──────────────────────────────────────────────────────────────────

export interface GoodTil {
  goodTilBlockHeight?: number;
  goodTilBlockTime?: string;
}

export interface PlaceOrderParams {
  baseDenom: string;
  quoteDenom: string;
  side: DexSide;
  orderType: DexOrderType;
  price?: string;
  quantity: string;
  timeInForce?: DexTimeInForce;
  goodTil?: GoodTil;
}

export interface DexOrder {
  id: string;
  creator: string;
  type: string;
  baseDenom: string;
  quoteDenom: string;
  price: string;
  quantity: string;
  side: string;
  remainingQuantity: string;
  remainingBalance: string;
}

export interface OrderbookData {
  bids: DexOrder[];
  asks: DexOrder[];
}

// ─── OPERATIONS ─────────────────────────────────────────────────────────────

export async function placeOrder(
  client: TxClient,
  params: PlaceOrderParams
): Promise<TransactionResult & { orderId: string }> {
  const orderId = `ord-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
  const value: Record<string, unknown> = {
    sender: client.address,
    type: params.orderType,
    id: orderId,
    baseDenom: params.baseDenom,
    quoteDenom: params.quoteDenom,
    price: params.price ?? "",
    quantity: params.quantity,
    side: params.side,
    timeInForce: params.timeInForce ?? DexTimeInForce.GTC,
  };

  if (params.goodTil) {
    const gt: Record<string, unknown> = {};
    if (params.goodTil.goodTilBlockHeight) gt.goodTilBlockHeight = params.goodTil.goodTilBlockHeight;
    if (params.goodTil.goodTilBlockTime) gt.goodTilBlockTime = params.goodTil.goodTilBlockTime;
    value.goodTil = gt;
  }

  const msg = { typeUrl: "/coreum.dex.v1.MsgPlaceOrder", value };
  const tif = DexTimeInForce[params.timeInForce ?? DexTimeInForce.GTC] || "GTC";
  console.log(`[placeOrder] ${DexSide[params.side]} ${tif} order: ${orderId}, price=${params.price}, qty=${params.quantity}`);
  const result = await client.signAndBroadcastMsg(msg, 500000);
  return { ...result, orderId };
}

export async function cancelOrder(
  client: TxClient,
  orderId: string
): Promise<TransactionResult> {
  const msg = {
    typeUrl: "/coreum.dex.v1.MsgCancelOrder",
    value: { sender: client.address, id: orderId },
  };
  return client.signAndBroadcastMsg(msg, 500000);
}

// ─── QUERIES ────────────────────────────────────────────────────────────────

export async function queryOrderbook(
  baseDenom: string,
  quoteDenom: string,
  networkName: NetworkName = "testnet"
): Promise<OrderbookData> {
  const network = NETWORKS[networkName];

  // Try REST first
  try {
    const baseUrl = `${network.restEndpoint}/coreum/dex/v1/order-book-orders`;
    const resp = await fetch(`${baseUrl}?base_denom=${encodeURIComponent(baseDenom)}&quote_denom=${encodeURIComponent(quoteDenom)}&side=SIDE_BUY`);
    if (resp.ok) {
      const data = await resp.json() as { orders?: DexOrder[] };
      if (data.orders && data.orders.length >= 0) {
        const asksResp = await fetch(`${baseUrl}?base_denom=${encodeURIComponent(baseDenom)}&quote_denom=${encodeURIComponent(quoteDenom)}&side=SIDE_SELL`);
        const asksData = asksResp.ok ? (await asksResp.json() as { orders?: DexOrder[] }) : { orders: [] };
        return { bids: data.orders ?? [], asks: asksData.orders ?? [] };
      }
    }
  } catch { /* REST not available, fall through to ABCI */ }

  // Use ABCI query
  const bids: DexOrder[] = [];
  const asks: DexOrder[] = [];

  for (const [sideEnum, list] of [[1, bids], [2, asks]] as [number, DexOrder[]][]) {
    const reqData = Buffer.concat([
      encodeString(1, baseDenom),
      encodeString(2, quoteDenom),
      Buffer.from([0x18, sideEnum]),
    ]);
    const result = await abciQuery(network.rpcEndpoint, "/coreum.dex.v1.Query/OrderBookOrders", reqData);
    if (result) {
      const orderBufs = extractRepeatedMessages(result, 1);
      for (const ob of orderBufs) {
        const order = parseOrderFromProto(ob);
        list.push(order);
      }
    }
  }

  return { bids, asks };
}

export async function queryOrdersByCreator(
  creator: string,
  networkName: NetworkName = "testnet"
): Promise<DexOrder[]> {
  const network = NETWORKS[networkName];

  // Try REST first
  try {
    const resp = await fetch(`${network.restEndpoint}/coreum/dex/v1/orders?creator=${encodeURIComponent(creator)}`);
    if (resp.ok) {
      const data = await resp.json() as { orders?: DexOrder[] };
      if (data.orders) return data.orders;
    }
  } catch { /* fall through */ }

  // ABCI query
  const reqData = encodeString(1, creator);
  const result = await abciQuery(network.rpcEndpoint, "/coreum.dex.v1.Query/Orders", reqData);
  if (!result) return [];

  const orderBufs = extractRepeatedMessages(result, 1);
  return orderBufs.map(parseOrderFromProto);
}

export async function queryOrderBooks(
  networkName: NetworkName = "testnet"
): Promise<Array<{ baseDenom: string; quoteDenom: string }>> {
  const network = NETWORKS[networkName];
  try {
    const resp = await fetch(`${network.restEndpoint}/coreum/dex/v1/order-books`);
    if (!resp.ok) return [];
    const data = await resp.json() as { order_books?: Array<{ base_denom: string; quote_denom: string }> };
    return (data.order_books ?? []).map(ob => ({
      baseDenom: ob.base_denom,
      quoteDenom: ob.quote_denom,
    }));
  } catch { return []; }
}
