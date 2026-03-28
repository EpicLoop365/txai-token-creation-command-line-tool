/**
 * client.ts — TxClient and TxMutex for signing and broadcasting transactions
 */

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
import { NetworkConfig, NetworkName } from "./networks.js";
import { TxWallet } from "./wallet.js";

// ─── TYPES ──────────────────────────────────────────────────────────────────

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

// ─── REGISTRY ────────────────────────────────────────────────────────────────

function getTxRegistry(): Registry {
  return new Registry([
    ...defaultRegistryTypes,
    ...(coreumRegistry as ReadonlyArray<[string, GeneratedType]>),
  ]);
}

// ─── TX MUTEX ────────────────────────────────────────────────────────────────

export class TxMutex {
  private queue: Array<() => void> = [];
  private locked = false;
  private lockTime = 0;
  private readonly LOCK_TIMEOUT_MS = 90_000;

  async acquire(): Promise<void> {
    if (this.locked && Date.now() - this.lockTime > this.LOCK_TIMEOUT_MS) {
      console.warn("[TxMutex] Force-releasing stale lock after timeout");
      this.locked = false;
    }

    if (!this.locked) {
      this.locked = true;
      this.lockTime = Date.now();
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
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

// ─── TX CLIENT ───────────────────────────────────────────────────────────────

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

      let lastErr: Error | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (attempt > 0) {
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
