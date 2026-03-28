/**
 * tx-sdk.ts — Self-contained TX blockchain SDK
 *
 * Inlines wallet management, smart token issuance, and chain queries
 * from @tx-agent/core so the API can deploy without the monorepo workspace.
 */

import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { stringToPath } from "@cosmjs/crypto";
import { Registry, GeneratedType } from "@cosmjs/proto-signing";
import {
  SigningStargateClient,
  StargateClient,
  GasPrice,
  calculateFee,
  DeliverTxResponse,
  isDeliverTxSuccess,
  defaultRegistryTypes,
} from "@cosmjs/stargate";
import { HttpBatchClient, Tendermint37Client } from "@cosmjs/tendermint-rpc";
import { coreumRegistry } from "coreum-js-nightly";

// ─── NETWORK CONFIG ──────────────────────────────────────────────────────────

export type NetworkName = "testnet" | "mainnet" | "devnet";

export interface NetworkConfig {
  chainId: string;
  rpcEndpoint: string;
  restEndpoint: string;
  denom: string;
  addressPrefix: string;
  explorerUrl: string;
  hdPath: string;
  faucetUrl?: string;
}

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  testnet: {
    chainId: "coreum-testnet-1",
    rpcEndpoint: "https://full-node.testnet-1.coreum.dev:26657",
    restEndpoint: "https://full-node.testnet-1.coreum.dev:1317",
    denom: "utestcore",
    addressPrefix: "testcore",
    explorerUrl: "https://explorer.testnet-1.tx.org",
    hdPath: "m/44'/990'/0'/0/0",
    faucetUrl: "https://api.testnet-1.coreum.dev/api/faucet/v1/fund",
  },
  mainnet: {
    chainId: "coreum-mainnet-1",
    rpcEndpoint: "https://full-node.mainnet-1.coreum.dev:26657",
    restEndpoint: "https://full-node.mainnet-1.coreum.dev:1317",
    denom: "ucore",
    addressPrefix: "core",
    explorerUrl: "https://explorer.tx.org",
    hdPath: "m/44'/990'/0'/0/0",
  },
  devnet: {
    chainId: "coreum-devnet-1",
    rpcEndpoint: "https://full-node.devnet-1.coreum.dev:26657",
    restEndpoint: "https://full-node.devnet-1.coreum.dev:1317",
    denom: "udevcore",
    addressPrefix: "devcore",
    explorerUrl: "https://devnet.explorer.tx.org",
    hdPath: "m/44'/990'/0'/0/0",
    faucetUrl: "https://api.devnet-1.coreum.dev/api/faucet/v1/fund",
  },
};

// ─── WALLET ──────────────────────────────────────────────────────────────────

export interface TxWallet {
  wallet: DirectSecp256k1HdWallet;
  address: string;
  network: NetworkConfig;
  networkName: NetworkName;
}

export async function createWallet(
  networkName: NetworkName = "testnet"
): Promise<TxWallet & { mnemonic: string }> {
  const network = NETWORKS[networkName];
  const wallet = await DirectSecp256k1HdWallet.generate(24, {
    prefix: network.addressPrefix,
    hdPaths: [stringToPath(network.hdPath)],
  });
  const [account] = await wallet.getAccounts();
  return {
    wallet,
    address: account.address,
    mnemonic: wallet.mnemonic,
    network,
    networkName,
  };
}

export async function importWallet(
  mnemonic: string,
  networkName: NetworkName = "testnet"
): Promise<TxWallet> {
  const network = NETWORKS[networkName];
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: network.addressPrefix,
    hdPaths: [stringToPath(network.hdPath)],
  });
  const [account] = await wallet.getAccounts();
  return { wallet, address: account.address, network, networkName };
}

// ─── REGISTRY ────────────────────────────────────────────────────────────────

function getTxRegistry(): Registry {
  return new Registry([
    ...defaultRegistryTypes,
    ...(coreumRegistry as ReadonlyArray<[string, GeneratedType]>),
  ]);
}

// ─── CLIENT ──────────────────────────────────────────────────────────────────

export interface TokenBalance {
  denom: string;
  amount: string;
  display: number;
}

export interface TransactionResult {
  success: boolean;
  txHash: string;
  height: number;
  gasUsed: number;
  explorerUrl: string;
  error?: string;
}

// ─── TX MUTEX (prevents sequence conflicts when sharing one wallet) ─────────

class TxMutex {
  private queue: Array<() => void> = [];
  private locked = false;
  private lockTime = 0;
  private readonly LOCK_TIMEOUT_MS = 90_000; // 90s max — auto-release if stuck

  async acquire(): Promise<void> {
    // Auto-release stale locks (prevents permanent deadlock if a request crashes)
    if (this.locked && Date.now() - this.lockTime > this.LOCK_TIMEOUT_MS) {
      console.warn("[TxMutex] Force-releasing stale lock after timeout");
      this.locked = false;
    }

    if (!this.locked) {
      this.locked = true;
      this.lockTime = Date.now();
      return;
    }

    // Wait in queue, but with a timeout so we don't hang forever
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove ourselves from queue
        const idx = this.queue.indexOf(resolve);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(new Error("Transaction queue timeout — the server is busy. Please try again."));
      }, this.LOCK_TIMEOUT_MS);

      this.queue.push(() => {
        clearTimeout(timer);
        this.lockTime = Date.now();
        resolve();
      });
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.locked = false;
    }
  }
}

// Global mutex — all TxClient instances sharing the same wallet go through this
const globalTxMutex = new TxMutex();

export class TxClient {
  private signingClient: SigningStargateClient;
  private queryClient: StargateClient;
  private txMutex: TxMutex;
  public readonly address: string;
  public readonly network: NetworkConfig;
  public readonly networkName: NetworkName;

  private constructor(
    signingClient: SigningStargateClient,
    queryClient: StargateClient,
    address: string,
    network: NetworkConfig,
    networkName: NetworkName,
    txMutex: TxMutex = globalTxMutex
  ) {
    this.signingClient = signingClient;
    this.queryClient = queryClient;
    this.address = address;
    this.network = network;
    this.networkName = networkName;
    this.txMutex = txMutex;
  }

  static async connectWithWallet(
    txWallet: TxWallet,
    options?: { isolatedMutex?: boolean }
  ): Promise<TxClient> {
    const { network, networkName, wallet, address } = txWallet;
    const gasPrice = GasPrice.fromString(`0.25${network.denom}`);

    // Force HTTP transport (not WebSocket) for cloud platforms like Railway
    const httpClient = new HttpBatchClient(network.rpcEndpoint);
    const tmClient = await Tendermint37Client.create(httpClient);

    const signingClient = await SigningStargateClient.createWithSigner(
      tmClient,
      wallet,
      { gasPrice, registry: getTxRegistry() }
    );
    const queryClient = await StargateClient.create(tmClient);
    const mutex = options?.isolatedMutex ? new TxMutex() : globalTxMutex;
    return new TxClient(signingClient, queryClient, address, network, networkName, mutex);
  }

  async getBalances(address: string): Promise<TokenBalance[]> {
    const balances = await this.queryClient.getAllBalances(address);
    return balances.map((b) => ({
      denom: b.denom,
      amount: b.amount,
      display: b.denom.startsWith("u") ? Number(b.amount) / 1_000_000 : Number(b.amount),
    }));
  }

  async getCoreBalance(address: string): Promise<number> {
    const balances = await this.getBalances(address);
    const core = balances.find((b) => b.denom === this.network.denom);
    return core ? core.display : 0;
  }

  async getBlockHeight(): Promise<number> {
    return this.queryClient.getHeight();
  }

  async signAndBroadcastMsg(
    msg: { typeUrl: string; value: unknown },
    gasLimit = 500000,
    memo = ""
  ): Promise<TransactionResult> {
    // Acquire the global mutex so only one transaction is in-flight at a time.
    // This prevents sequence number conflicts when multiple users share one wallet.
    await this.txMutex.acquire();

    try {
      const fee = calculateFee(
        gasLimit,
        GasPrice.fromString(`0.25${this.network.denom}`)
      );

      const broadcast = () =>
        this.signingClient.signAndBroadcast(
          this.address,
          [msg as Parameters<typeof this.signingClient.signAndBroadcast>[1][0]],
          fee,
          memo
        );

      // Retry up to 3 times on sequence mismatch
      let lastErr: Error | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (attempt > 0) {
            // Wait for the chain to process the previous tx, then reconnect
            // to get a fresh sequence number from the chain
            await new Promise((r) => setTimeout(r, 3000 * attempt));
          }
          const result: DeliverTxResponse = await broadcast();
          return this.formatTxResult(result);
        } catch (err) {
          const message = (err as Error).message ?? String(err);
          if (
            message.includes("account sequence mismatch") ||
            message.includes("incorrect account sequence")
          ) {
            lastErr = err as Error;
            console.log(`[TxClient] Sequence mismatch on attempt ${attempt + 1}, retrying...`);
            continue;
          }
          throw err;
        }
      }
      throw lastErr!;
    } finally {
      // Always release the mutex so the next queued transaction can proceed
      this.txMutex.release();
    }
  }

  private formatTxResult(result: DeliverTxResponse): TransactionResult {
    const success = isDeliverTxSuccess(result);
    return {
      success,
      txHash: result.transactionHash,
      height: result.height,
      gasUsed: Number(result.gasUsed),
      explorerUrl: `${this.network.explorerUrl}/tx/transactions/${result.transactionHash}`,
      error: success ? undefined : result.rawLog,
    };
  }

  disconnect(): void {
    this.queryClient.disconnect();
    this.signingClient.disconnect();
  }
}

// ─── SMART TOKEN FEATURES ────────────────────────────────────────────────────

export interface SmartTokenFeatures {
  minting?: boolean;
  burning?: boolean;
  freezing?: boolean;
  whitelisting?: boolean;
  ibcEnabled?: boolean;
  clawback?: boolean;
}

const FEATURE_MAP: Record<keyof SmartTokenFeatures, number> = {
  minting: 0,
  burning: 1,
  freezing: 2,
  whitelisting: 3,
  ibcEnabled: 4,
  clawback: 6,
};

// ─── SMART TOKEN OPERATIONS ──────────────────────────────────────────────────

export interface IssueSmartTokenParams {
  subunit: string;
  symbol?: string;
  name: string;
  description?: string;
  initialAmount: string;
  precision?: number;
  features?: SmartTokenFeatures;
  burnRate?: string;
  sendCommissionRate?: string;
  uri?: string;
  uriHash?: string;
}

export async function issueSmartToken(
  client: TxClient,
  params: IssueSmartTokenParams
): Promise<{ txHash: string; denom: string; explorerUrl: string; success: boolean; error?: string }> {
  const issuer = client.address;
  const precision = params.precision ?? 6;
  const rawAmount = String(
    Math.round(Number(params.initialAmount) * Math.pow(10, precision))
  );

  const features = params.features
    ? Object.entries(params.features)
        .filter(([, enabled]) => enabled)
        .map(([key]) => FEATURE_MAP[key as keyof SmartTokenFeatures])
    : [];

  // Convert percentage rate (e.g. "0.05" = 5%) to chain format.
  // Coreum expects burn_rate/send_commission_rate as integer strings
  // representing the value * 10^18 (e.g. 5% = "50000000000000000").
  // Returns undefined if rate is 0 or not set (field will be omitted).
  const toChainRate = (rate?: string): string | undefined => {
    if (!rate || rate === "0") return undefined;
    const num = parseFloat(rate);
    if (isNaN(num) || num <= 0 || num > 1) return undefined;
    // Coreum limits rate precision to 4 decimal places
    // Round to 4 decimals first, then scale to 10^18
    const rounded = Math.round(num * 10000) / 10000;
    const scaled = Math.round(rounded * 1e18);
    return scaled.toString();
  };

  const burnRateVal = toChainRate(params.burnRate);
  const commissionVal = toChainRate(params.sendCommissionRate);

  const msg = {
    typeUrl: "/coreum.asset.ft.v1.MsgIssue",
    value: {
      issuer,
      subunit: params.subunit.toLowerCase(),
      symbol: (params.symbol ?? params.subunit).toUpperCase(),
      precision,
      initialAmount: rawAmount,
      description: params.description ?? "",
      features,
      uri: params.uri ?? "",
      uriHash: params.uriHash ?? "",
      ...(burnRateVal ? { burnRate: burnRateVal } : {}),
      ...(commissionVal ? { sendCommissionRate: commissionVal } : {}),
    },
  };

  const denom = `${params.subunit.toLowerCase()}-${issuer}`;

  console.log(`[issueSmartToken] Issuing token: ${denom}`);
  console.log(`[issueSmartToken] Msg:`, JSON.stringify(msg, null, 2));

  const result = await client.signAndBroadcastMsg(msg, 500000);

  console.log(`[issueSmartToken] Result: success=${result.success}, txHash=${result.txHash}, error=${result.error}`);

  return {
    txHash: result.txHash,
    denom,
    explorerUrl: `${client.network.explorerUrl}/tx/transactions/${result.txHash}`,
    success: result.success,
    error: result.error,
  };
}

export async function mintTokens(
  client: TxClient,
  denom: string,
  amount: string,
  recipient?: string
): Promise<TransactionResult> {
  const msg = {
    typeUrl: "/coreum.asset.ft.v1.MsgMint",
    value: {
      sender: client.address,
      coin: { denom, amount },
      recipient: recipient ?? client.address,
    },
  };
  return client.signAndBroadcastMsg(msg, 500000);
}

export async function burnTokens(
  client: TxClient,
  denom: string,
  amount: string
): Promise<TransactionResult> {
  const msg = {
    typeUrl: "/coreum.asset.ft.v1.MsgBurn",
    value: {
      sender: client.address,
      coin: { denom, amount },
    },
  };
  return client.signAndBroadcastMsg(msg, 500000);
}

export async function freezeAccount(
  client: TxClient,
  denom: string,
  account: string,
  amount: string
): Promise<TransactionResult> {
  const msg = {
    typeUrl: "/coreum.asset.ft.v1.MsgFreeze",
    value: {
      sender: client.address,
      account,
      coin: { denom, amount },
    },
  };
  return client.signAndBroadcastMsg(msg, 500000);
}

export async function unfreezeAccount(
  client: TxClient,
  denom: string,
  account: string,
  amount: string
): Promise<TransactionResult> {
  const msg = {
    typeUrl: "/coreum.asset.ft.v1.MsgUnfreeze",
    value: {
      sender: client.address,
      account,
      coin: { denom, amount },
    },
  };
  return client.signAndBroadcastMsg(msg, 500000);
}

export async function globallyFreezeToken(
  client: TxClient,
  denom: string
): Promise<TransactionResult> {
  const msg = {
    typeUrl: "/coreum.asset.ft.v1.MsgGloballyFreeze",
    value: { sender: client.address, denom },
  };
  return client.signAndBroadcastMsg(msg, 500000);
}

export async function globallyUnfreezeToken(
  client: TxClient,
  denom: string
): Promise<TransactionResult> {
  const msg = {
    typeUrl: "/coreum.asset.ft.v1.MsgGloballyUnfreeze",
    value: { sender: client.address, denom },
  };
  return client.signAndBroadcastMsg(msg, 500000);
}

export async function clawbackTokens(
  client: TxClient,
  denom: string,
  account: string,
  amount: string
): Promise<TransactionResult> {
  const msg = {
    typeUrl: "/coreum.asset.ft.v1.MsgClawback",
    value: {
      sender: client.address,
      account,
      coin: { denom, amount },
    },
  };
  return client.signAndBroadcastMsg(msg, 500000);
}

export async function setWhitelistedLimit(
  client: TxClient,
  denom: string,
  account: string,
  amount: string
): Promise<TransactionResult> {
  const msg = {
    typeUrl: "/coreum.asset.ft.v1.MsgSetWhitelistedLimit",
    value: {
      sender: client.address,
      account,
      coin: { denom, amount },
    },
  };
  return client.signAndBroadcastMsg(msg, 500000);
}

export interface SmartTokenInfo {
  denom: string;
  issuer?: string;
  subunit?: string;
  precision?: number;
  description?: string;
  globallyFrozen?: boolean;
  features?: string[];
  type?: string;
  uri?: string;
  uri_hash?: string;
}

export async function getTokenInfo(
  denom: string,
  networkName: NetworkName = "testnet"
): Promise<SmartTokenInfo> {
  try {
    const network = NETWORKS[networkName];
    const url = `${network.restEndpoint}/coreum/asset/ft/v1/tokens/${denom}`;
    const response = await fetch(url);

    if (!response.ok) {
      return {
        denom,
        type: denom.startsWith("ibc/") ? "ibc" : "native",
      };
    }

    const data = (await response.json()) as { token?: SmartTokenInfo };
    return data.token ?? { denom, type: "unknown" };
  } catch {
    return { denom, type: "unknown" };
  }
}

export async function requestFaucet(
  address: string,
  networkName: NetworkName = "testnet"
): Promise<{ success: boolean; message: string }> {
  const network = NETWORKS[networkName];
  if (!network.faucetUrl) {
    return { success: false, message: `No faucet available for ${networkName}` };
  }
  try {
    const response = await fetch(network.faucetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });
    if (!response.ok) {
      return { success: false, message: `Faucet request failed (${response.status})` };
    }
    return { success: true, message: `Faucet tokens sent to ${address}` };
  } catch (err) {
    return { success: false, message: `Could not reach faucet: ${(err as Error).message}` };
  }
}

// ─── DEX ENUMS & CONSTANTS ──────────────────────────────────────────────────

export enum DexSide {
  BUY = 1,
  SELL = 2,
}

export enum DexOrderType {
  LIMIT = 1,
  MARKET = 2,
}

export enum DexTimeInForce {
  GTC = 1,   // Good Till Cancel — sits on book until filled or cancelled
  IOC = 2,   // Immediate or Cancel — fill what you can, cancel the rest
  FOK = 3,   // Fill or Kill — fill entire order or nothing
}

// Coreum DEX module address (escrows tokens for sell orders)
// Derived: sha256("dex")[:20] → bech32
export const DEX_MODULE_ADDRESS_TESTNET = "testcore1n58mly6f7er0zs6swtetqgfqs36jaarq7y4dx0";
export const DEX_MODULE_ADDRESS_MAINNET = "core1n58mly6f7er0zs6swtetqgfqs36jaarqgswsfe";

export function getDexModuleAddress(networkName: NetworkName): string {
  return networkName === "mainnet" ? DEX_MODULE_ADDRESS_MAINNET : DEX_MODULE_ADDRESS_TESTNET;
}

// ─── DEX OPERATIONS ──────────────────────────────────────────────────────────

export interface GoodTil {
  goodTilBlockHeight?: number;   // expire at this block height
  goodTilBlockTime?: string;     // expire at this timestamp (RFC3339)
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

  // Add goodTil if specified (for GTC orders with expiry)
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

// ─── DEX QUERIES (ABCI + REST) ──────────────────────────────────────────────

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

// ── Minimal protobuf helpers (no external deps) ─────────────────────────────

function encodeString(fieldNum: number, value: string): Buffer {
  const tag = Buffer.from([(fieldNum << 3) | 2]);
  const strBuf = Buffer.from(value, "utf-8");
  const lenBuf = encodeVarint(strBuf.length);
  return Buffer.concat([tag, lenBuf, strBuf]);
}

function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];
  while (value > 0x7f) { bytes.push((value & 0x7f) | 0x80); value >>>= 7; }
  bytes.push(value & 0x7f);
  return Buffer.from(bytes);
}

function decodeVarint(buf: Buffer, pos: number): [number, number] {
  let result = 0, shift = 0;
  while (pos < buf.length) {
    const b = buf[pos++];
    result |= (b & 0x7f) << shift;
    shift += 7;
    if (!(b & 0x80)) break;
  }
  return [result, pos];
}

interface ProtoFields { [fieldNum: number]: string | number | Buffer }

function decodeMessage(buf: Buffer): ProtoFields {
  const fields: ProtoFields = {};
  let pos = 0;
  while (pos < buf.length) {
    const [tag, newPos] = decodeVarint(buf, pos);
    pos = newPos;
    const fieldNum = tag >>> 3;
    const wireType = tag & 0x07;
    if (wireType === 2) { // length-delimited
      const [len, lenPos] = decodeVarint(buf, pos);
      pos = lenPos;
      const data = buf.subarray(pos, pos + len);
      pos += len;
      // Try to decode as UTF-8 string
      try { fields[fieldNum] = data.toString("utf-8"); } catch { fields[fieldNum] = data; }
    } else if (wireType === 0) { // varint
      const [val, valPos] = decodeVarint(buf, pos);
      pos = valPos;
      fields[fieldNum] = val;
    } else if (wireType === 5) { // 32-bit
      pos += 4;
    } else if (wireType === 1) { // 64-bit
      pos += 8;
    } else {
      break;
    }
  }
  return fields;
}

function extractRepeatedMessages(buf: Buffer, fieldNum: number): Buffer[] {
  const messages: Buffer[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const [tag, newPos] = decodeVarint(buf, pos);
    pos = newPos;
    const fNum = tag >>> 3;
    const wireType = tag & 0x07;
    if (wireType === 2) {
      const [len, lenPos] = decodeVarint(buf, pos);
      pos = lenPos;
      const data = buf.subarray(pos, pos + len);
      pos += len;
      if (fNum === fieldNum) messages.push(data);
    } else if (wireType === 0) {
      const [, valPos] = decodeVarint(buf, pos);
      pos = valPos;
    } else if (wireType === 5) { pos += 4; }
    else if (wireType === 1) { pos += 8; }
    else { break; }
  }
  return messages;
}

// Coreum DEX Order proto fields (from chain protobuf):
// 1=creator(string), 2=type(enum), 3=id(string), 4=sequence(uint64),
// 5=base_denom(string), 6=quote_denom(string), 7=price(string),
// 8=quantity(string), 9=side(enum), 10=remaining_quantity(string),
// 11=remaining_balance(string), 13=time_in_force(enum), 14=reserve(message)
function protoToDexOrder(buf: Buffer): DexOrder {
  const f = decodeMessage(buf);
  const sideVal = f[9] as number || 0;
  const typeVal = f[2] as number || 0;
  // Price from chain is in scientific notation like "1e1" = 10, "1e7" = 10000000
  const rawPrice = (f[7] as string) || "0";
  const price = String(parseFloat(rawPrice) || 0);
  return {
    creator: (f[1] as string) || "",
    type: typeVal === 1 ? "ORDER_TYPE_LIMIT" : typeVal === 2 ? "ORDER_TYPE_MARKET" : String(typeVal),
    id: (f[3] as string) || "",
    baseDenom: (f[5] as string) || "",
    quoteDenom: (f[6] as string) || "",
    price,
    quantity: (f[8] as string) || "0",
    side: sideVal === 1 ? "buy" : sideVal === 2 ? "sell" : String(sideVal),
    remainingQuantity: (f[10] as string) || "0",
    remainingBalance: (f[11] as string) || "0",
  };
}

// Hmm, the field numbering needs to match the actual proto. Let me use a more robust approach
// by extracting fields and mapping by position based on what we know works.
function parseOrderFromProto(buf: Buffer): DexOrder {
  // Extract all string and varint fields in order
  const strings: string[] = [];
  const varints: number[] = [];
  let pos = 0;
  const fieldMap: { [key: number]: { type: string; value: string | number } } = {};

  while (pos < buf.length) {
    const [tag, newPos] = decodeVarint(buf, pos);
    pos = newPos;
    const fieldNum = tag >>> 3;
    const wireType = tag & 0x07;
    if (wireType === 2) {
      const [len, lenPos] = decodeVarint(buf, pos);
      pos = lenPos;
      const data = buf.subarray(pos, pos + len);
      pos += len;
      const str = data.toString("utf-8");
      fieldMap[fieldNum] = { type: "string", value: str };
      strings.push(str);
    } else if (wireType === 0) {
      const [val, valPos] = decodeVarint(buf, pos);
      pos = valPos;
      fieldMap[fieldNum] = { type: "varint", value: val };
      varints.push(val);
    } else if (wireType === 5) { pos += 4; }
    else if (wireType === 1) { pos += 8; }
    else { break; }
  }

  // Based on the coreum proto definition:
  // message Order {
  //   string creator = 1;
  //   OrderType type = 2;  (enum/varint)
  //   string id = 3;
  //   uint32 sequence = 4; (varint)
  //   string base_denom = 5;
  //   string quote_denom = 6;
  //   string price = 7;
  //   string quantity = 8;
  //   Side side = 9; (enum/varint)
  //   string remaining_quantity = 10;
  //   string remaining_balance = 11;
  //   GoodTil good_til = 12;
  //   TimeInForce time_in_force = 13;
  //   cosmos.base.v1beta1.Coin reserve = 14; (message)
  // }

  const creator = (fieldMap[1]?.value as string) || "";
  const orderType = (fieldMap[2]?.value as number) || 0;
  const id = (fieldMap[3]?.value as string) || "";
  const baseDenom = (fieldMap[5]?.value as string) || "";
  const quoteDenom = (fieldMap[6]?.value as string) || "";
  // Price from chain is in scientific notation like "1e1" = 10, "1e7" = 10000000
  const rawPrice = (fieldMap[7]?.value as string) || "0";
  const price = String(parseFloat(rawPrice) || 0);
  const quantity = (fieldMap[8]?.value as string) || "0";
  const side = (fieldMap[9]?.value as number) || 0;
  const remainingQuantity = (fieldMap[10]?.value as string) || "0";
  const remainingBalance = (fieldMap[11]?.value as string) || "0";

  return {
    creator,
    type: orderType === 1 ? "limit" : orderType === 2 ? "market" : String(orderType),
    id,
    baseDenom,
    quoteDenom,
    price,
    quantity,
    side: side === 1 ? "buy" : side === 2 ? "sell" : String(side),
    remainingQuantity,
    remainingBalance,
  };
}

async function abciQuery(rpcEndpoint: string, path: string, data: Buffer): Promise<Buffer | null> {
  const hexData = data.toString("hex");
  const url = `${rpcEndpoint}/abci_query?path=%22${encodeURIComponent(path)}%22&data=0x${hexData}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const json = await resp.json() as { result?: { response?: { value?: string; code?: number } } };
    const value = json.result?.response?.value;
    if (!value || json.result?.response?.code) return null;
    return Buffer.from(value, "base64");
  } catch { return null; }
}

export async function queryOrderbook(
  baseDenom: string,
  quoteDenom: string,
  networkName: NetworkName = "testnet"
): Promise<OrderbookData> {
  const network = NETWORKS[networkName];

  // Try REST first (in case it gets implemented)
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

  // Use ABCI query: /coreum.dex.v1.Query/OrderBookOrders
  // QueryOrderBookOrdersRequest: base_denom(1), quote_denom(2), side(3=enum), pagination(4)
  const bids: DexOrder[] = [];
  const asks: DexOrder[] = [];

  for (const [sideEnum, list] of [[1, bids], [2, asks]] as [number, DexOrder[]][]) {
    const reqData = Buffer.concat([
      encodeString(1, baseDenom),
      encodeString(2, quoteDenom),
      Buffer.from([0x18, sideEnum]), // field 3, varint, side enum
    ]);
    const result = await abciQuery(network.rpcEndpoint, "/coreum.dex.v1.Query/OrderBookOrders", reqData);
    if (result) {
      const orderBufs = extractRepeatedMessages(result, 1); // field 1 = repeated Order
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

  // ABCI query: /coreum.dex.v1.Query/Orders
  // QueryOrdersRequest: creator(1=string)
  const reqData = encodeString(1, creator);
  const result = await abciQuery(network.rpcEndpoint, "/coreum.dex.v1.Query/Orders", reqData);
  if (!result) return [];

  const orderBufs = extractRepeatedMessages(result, 1); // field 1 = repeated Order
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
    // Chain returns snake_case
    return (data.order_books ?? []).map(ob => ({
      baseDenom: ob.base_denom,
      quoteDenom: ob.quote_denom,
    }));
  } catch { return []; }
}

// ─── NFT FEATURES ───────────────────────────────────────────────────────────

export interface NFTClassFeatures {
  burning?: boolean;
  freezing?: boolean;
  whitelisting?: boolean;
  disableSending?: boolean;
  soulbound?: boolean;
}

const NFT_FEATURE_MAP: Record<keyof NFTClassFeatures, number> = {
  burning: 0,
  freezing: 1,
  whitelisting: 2,
  disableSending: 3,
  soulbound: 4,
};

// ─── NFT OPERATIONS ─────────────────────────────────────────────────────────

export interface IssueNFTClassParams {
  symbol: string;
  name: string;
  description?: string;
  uri?: string;
  uriHash?: string;
  features?: NFTClassFeatures;
  royaltyRate?: string; // decimal like "0.05" for 5%
}

export async function issueNFTClass(
  client: TxClient,
  params: IssueNFTClassParams
): Promise<{ txHash: string; classId: string; explorerUrl: string; success: boolean; error?: string }> {
  const issuer = client.address;

  const features = params.features
    ? Object.entries(params.features)
        .filter(([, enabled]) => enabled)
        .map(([key]) => NFT_FEATURE_MAP[key as keyof NFTClassFeatures])
    : [];

  // Convert percentage rate to chain format (×10^18)
  const toChainRate = (rate?: string): string | undefined => {
    if (!rate || rate === "0") return undefined;
    const num = parseFloat(rate);
    if (isNaN(num) || num <= 0 || num > 1) return undefined;
    return Math.round(num * 1e18).toString();
  };

  const royaltyVal = toChainRate(params.royaltyRate);

  const msg = {
    typeUrl: "/coreum.asset.nft.v1.MsgIssueClass",
    value: {
      issuer,
      symbol: params.symbol.toUpperCase(),
      name: params.name,
      description: params.description ?? "",
      uri: params.uri ?? "",
      uriHash: params.uriHash ?? "",
      features,
      ...(royaltyVal ? { royaltyRate: royaltyVal } : {}),
    },
  };

  // classId format: symbol-issuerAddress (lowercased)
  const classId = `${params.symbol.toLowerCase()}-${issuer}`;

  console.log(`[issueNFTClass] Issuing class: ${classId}`);
  console.log(`[issueNFTClass] Msg:`, JSON.stringify(msg, null, 2));

  const result = await client.signAndBroadcastMsg(msg, 500000);

  return {
    txHash: result.txHash,
    classId,
    explorerUrl: `${client.network.explorerUrl}/tx/transactions/${result.txHash}`,
    success: result.success,
    error: result.error,
  };
}

export interface MintNFTParams {
  classId: string;
  id: string; // unique NFT ID within the class
  uri?: string;
  uriHash?: string;
  data?: string; // JSON string for dynamic data
  recipient?: string;
}

export async function mintNFT(
  client: TxClient,
  params: MintNFTParams
): Promise<TransactionResult> {
  const msg = {
    typeUrl: "/coreum.asset.nft.v1.MsgMint",
    value: {
      sender: client.address,
      classId: params.classId,
      id: params.id,
      uri: params.uri ?? "",
      uriHash: params.uriHash ?? "",
      recipient: params.recipient ?? client.address,
    },
  };
  console.log(`[mintNFT] Minting NFT ${params.id} in class ${params.classId}`);
  return client.signAndBroadcastMsg(msg, 500000);
}

export async function burnNFT(
  client: TxClient,
  classId: string,
  nftId: string
): Promise<TransactionResult> {
  const msg = {
    typeUrl: "/coreum.asset.nft.v1.MsgBurn",
    value: {
      sender: client.address,
      classId,
      id: nftId,
    },
  };
  return client.signAndBroadcastMsg(msg, 500000);
}

export async function freezeNFT(
  client: TxClient,
  classId: string,
  nftId: string
): Promise<TransactionResult> {
  const msg = {
    typeUrl: "/coreum.asset.nft.v1.MsgFreeze",
    value: {
      sender: client.address,
      classId,
      id: nftId,
    },
  };
  return client.signAndBroadcastMsg(msg, 500000);
}

export async function unfreezeNFT(
  client: TxClient,
  classId: string,
  nftId: string
): Promise<TransactionResult> {
  const msg = {
    typeUrl: "/coreum.asset.nft.v1.MsgUnfreeze",
    value: {
      sender: client.address,
      classId,
      id: nftId,
    },
  };
  return client.signAndBroadcastMsg(msg, 500000);
}

export async function classWhitelistNFT(
  client: TxClient,
  classId: string,
  nftId: string,
  account: string
): Promise<TransactionResult> {
  const msg = {
    typeUrl: "/coreum.asset.nft.v1.MsgAddToClassWhitelist",
    value: {
      sender: client.address,
      classId,
      id: nftId,
      account,
    },
  };
  return client.signAndBroadcastMsg(msg, 500000);
}

// ─── NFT QUERIES ────────────────────────────────────────────────────────────

export interface NFTClassInfo {
  id: string;
  issuer: string;
  name: string;
  symbol: string;
  description: string;
  uri: string;
  uriHash: string;
  features: string[];
  royaltyRate: string;
}

export interface NFTInfo {
  classId: string;
  id: string;
  uri: string;
  uriHash: string;
  owner?: string;
}

export async function queryNFTClass(
  classId: string,
  networkName: NetworkName = "testnet"
): Promise<NFTClassInfo | null> {
  const network = NETWORKS[networkName];
  try {
    const resp = await fetch(`${network.restEndpoint}/coreum/asset/nft/v1/classes/${classId}`);
    if (!resp.ok) return null;
    const data = await resp.json() as { class?: NFTClassInfo };
    return data.class ?? null;
  } catch { return null; }
}

export async function queryNFTsByClass(
  classId: string,
  networkName: NetworkName = "testnet"
): Promise<NFTInfo[]> {
  const network = NETWORKS[networkName];
  try {
    const resp = await fetch(`${network.restEndpoint}/cosmos/nft/v1beta1/nfts?class_id=${encodeURIComponent(classId)}`);
    if (!resp.ok) return [];
    const data = await resp.json() as { nfts?: NFTInfo[] };
    return data.nfts ?? [];
  } catch { return []; }
}

export async function queryNFTsByOwner(
  owner: string,
  networkName: NetworkName = "testnet"
): Promise<NFTInfo[]> {
  const network = NETWORKS[networkName];
  try {
    const resp = await fetch(`${network.restEndpoint}/cosmos/nft/v1beta1/nfts?owner=${encodeURIComponent(owner)}`);
    if (!resp.ok) return [];
    const data = await resp.json() as { nfts?: NFTInfo[] };
    return data.nfts ?? [];
  } catch { return []; }
}

export async function queryNFTOwner(
  classId: string,
  nftId: string,
  networkName: NetworkName = "testnet"
): Promise<string | null> {
  const network = NETWORKS[networkName];
  try {
    const resp = await fetch(`${network.restEndpoint}/cosmos/nft/v1beta1/owner/${encodeURIComponent(classId)}/${encodeURIComponent(nftId)}`);
    if (!resp.ok) return null;
    const data = await resp.json() as { owner?: string };
    return data.owner ?? null;
  } catch { return null; }
}
