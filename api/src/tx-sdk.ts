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
  public readonly address: string;
  public readonly network: NetworkConfig;
  public readonly networkName: NetworkName;

  private constructor(
    signingClient: SigningStargateClient,
    queryClient: StargateClient,
    address: string,
    network: NetworkConfig,
    networkName: NetworkName
  ) {
    this.signingClient = signingClient;
    this.queryClient = queryClient;
    this.address = address;
    this.network = network;
    this.networkName = networkName;
  }

  static async connectWithWallet(txWallet: TxWallet): Promise<TxClient> {
    const { network, networkName, wallet, address } = txWallet;
    const gasPrice = GasPrice.fromString(`0.0625${network.denom}`);

    // Force HTTP transport (not WebSocket) for cloud platforms like Railway
    const httpClient = new HttpBatchClient(network.rpcEndpoint);
    const tmClient = await Tendermint37Client.create(httpClient);

    const signingClient = await SigningStargateClient.createWithSigner(
      tmClient,
      wallet,
      { gasPrice, registry: getTxRegistry() }
    );
    const queryClient = await StargateClient.create(tmClient);
    return new TxClient(signingClient, queryClient, address, network, networkName);
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
    gasLimit = 150000
  ): Promise<TransactionResult> {
    // Acquire the global mutex so only one transaction is in-flight at a time.
    // This prevents sequence number conflicts when multiple users share one wallet.
    await globalTxMutex.acquire();

    try {
      const fee = calculateFee(
        gasLimit,
        GasPrice.fromString(`0.0625${this.network.denom}`)
      );

      const broadcast = () =>
        this.signingClient.signAndBroadcast(
          this.address,
          [msg as Parameters<typeof this.signingClient.signAndBroadcast>[1][0]],
          fee
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
      globalTxMutex.release();
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
  clawback: 5,
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
    // Multiply by 10^18 and convert to integer string
    // Use string math to avoid floating point issues
    const scaled = Math.round(num * 1e18);
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
      uri: "",
      uriHash: "",
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
  return client.signAndBroadcastMsg(msg, 200000);
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
}

export async function getTokenInfo(
  denom: string,
  networkName: NetworkName = "testnet"
): Promise<SmartTokenInfo> {
  try {
    const network = NETWORKS[networkName];
    const url = `${network.restEndpoint}/coreum/assetft/v1/tokens/${denom}`;
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
