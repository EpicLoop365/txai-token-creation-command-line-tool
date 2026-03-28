/**
 * @solomente/txai-sdk — Agent
 *
 * An Agent is an autonomous blockchain wallet that can trade, mint, and manage
 * tokens on the Coreum network. Each agent has its own keypair, balance, and
 * transaction mutex for independent operation.
 */

import {
  AgentConfig,
  NetworkName,
  TokenBalance,
  TransactionResult,
  PlaceOrderParams,
  DexOrder,
  OrderbookData,
  IssueSmartTokenParams,
  IssueNFTClassParams,
  MintNFTParams,
} from "./types.js";

// Core blockchain functions — bridged from the @solomente/txai-core package
import {
  createWallet,
  importWallet,
  requestFaucet,
  TxClient,
  placeOrder,
  cancelOrder,
  queryOrderbook,
  queryOrdersByCreator,
  issueSmartToken,
  mintTokens,
  burnTokens,
  issueNFTClass,
  mintNFT,
  type TxWallet,
} from "./tx-sdk-bridge.js";

export class Agent {
  readonly name: string;
  readonly role: string;
  readonly networkName: NetworkName;

  private _address = "";
  private _mnemonic = "";
  private _client: TxClient | null = null;
  private _isolatedMutex: boolean;

  constructor(config: AgentConfig) {
    this.name = config.name;
    this.role = config.role || "agent";
    this.networkName = config.network || "testnet";
    this._mnemonic = config.mnemonic || "";
    this._isolatedMutex = config.isolatedMutex ?? true;
  }

  /** The agent's blockchain address (available after init) */
  get address(): string {
    return this._address;
  }

  /** Whether the agent is connected to the chain */
  get connected(): boolean {
    return this._client !== null;
  }

  /** The underlying TxClient (for advanced usage) */
  get client(): TxClient | null {
    return this._client;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────

  /**
   * Initialize the agent — create or import a wallet and connect to the chain.
   */
  async init(): Promise<Agent> {
    let wallet: TxWallet;

    if (this._mnemonic) {
      wallet = await importWallet(this._mnemonic, this.networkName);
    } else {
      const newWallet = await createWallet(this.networkName);
      wallet = newWallet;
      this._mnemonic = newWallet.mnemonic;
    }

    this._address = wallet.address;
    this._client = await TxClient.connectWithWallet(wallet, {
      isolatedMutex: this._isolatedMutex,
    });

    return this;
  }

  /**
   * Disconnect from the chain and clean up.
   */
  disconnect(): void {
    if (this._client) {
      this._client.disconnect();
      this._client = null;
    }
    this._mnemonic = ""; // Security: clear mnemonic from memory
  }

  // ─── Funding ─────────────────────────────────────────────────────────

  /**
   * Request testnet tokens from the faucet.
   * @param requests Number of faucet requests (each ~200 TX)
   * @param delayMs Delay between requests in ms (default: 5000)
   */
  async fundFromFaucet(
    requests = 3,
    delayMs = 5000
  ): Promise<{ success: boolean; total: number }> {
    let successCount = 0;
    for (let i = 0; i < requests; i++) {
      const result = await requestFaucet(this._address, this.networkName);
      if (result.success) successCount++;
      if (i < requests - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    return { success: successCount > 0, total: successCount };
  }

  // ─── Balances ────────────────────────────────────────────────────────

  /**
   * Get all token balances for this agent.
   */
  async getBalances(): Promise<TokenBalance[]> {
    this._requireClient();
    return this._client!.getBalances(this._address);
  }

  /**
   * Get the native TX (utestcore) balance in display units.
   */
  async getCoreBalance(): Promise<number> {
    this._requireClient();
    return this._client!.getCoreBalance(this._address);
  }

  /**
   * Get the balance of a specific token denom in raw units.
   */
  async getTokenBalance(denom: string): Promise<number> {
    const balances = await this.getBalances();
    const bal = balances.find((b) => b.denom === denom);
    return bal ? parseInt(bal.amount) : 0;
  }

  // ─── Transfers ───────────────────────────────────────────────────────

  /**
   * Send tokens to another address.
   */
  async send(
    to: string,
    denom: string,
    amount: string
  ): Promise<TransactionResult> {
    this._requireClient();
    return this._client!.signAndBroadcastMsg(
      {
        typeUrl: "/cosmos.bank.v1beta1.MsgSend",
        value: {
          fromAddress: this._address,
          toAddress: to,
          amount: [{ denom, amount }],
        },
      },
      200000
    );
  }

  // ─── DEX Trading ─────────────────────────────────────────────────────

  /**
   * Place an order on the DEX.
   */
  async placeOrder(
    params: PlaceOrderParams
  ): Promise<TransactionResult & { orderId: string }> {
    this._requireClient();
    return placeOrder(this._client!, params);
  }

  /**
   * Place a limit order with simplified params.
   */
  async placeLimitOrder(params: {
    baseDenom: string;
    quoteDenom?: string;
    side: number;
    price: string;
    quantity: string;
  }): Promise<TransactionResult & { orderId: string }> {
    this._requireClient();
    return placeOrder(this._client!, {
      baseDenom: params.baseDenom,
      quoteDenom: params.quoteDenom || "utestcore",
      side: params.side,
      orderType: 1, // LIMIT
      price: params.price,
      quantity: params.quantity,
    });
  }

  /**
   * Cancel an order by ID.
   */
  async cancelOrder(orderId: string): Promise<TransactionResult> {
    this._requireClient();
    return cancelOrder(this._client!, orderId);
  }

  /**
   * Query this agent's open orders.
   */
  async getMyOrders(): Promise<DexOrder[]> {
    return queryOrdersByCreator(this._address, this.networkName);
  }

  // ─── Smart Tokens ───────────────────────────────────────────────────

  /**
   * Issue a new smart token.
   */
  async issueToken(params: IssueSmartTokenParams) {
    this._requireClient();
    return issueSmartToken(this._client!, params);
  }

  /**
   * Mint additional tokens (must be issuer with minting enabled).
   */
  async mintTokens(
    denom: string,
    amount: string,
    recipient?: string
  ): Promise<TransactionResult> {
    this._requireClient();
    return mintTokens(this._client!, denom, amount, recipient);
  }

  /**
   * Burn tokens.
   */
  async burnTokens(
    denom: string,
    amount: string
  ): Promise<TransactionResult> {
    this._requireClient();
    return burnTokens(this._client!, denom, amount);
  }

  // ─── NFTs ────────────────────────────────────────────────────────────

  /**
   * Issue a new NFT class/collection.
   */
  async issueNFTClass(params: IssueNFTClassParams) {
    this._requireClient();
    return issueNFTClass(this._client!, params);
  }

  /**
   * Mint an NFT in a class.
   */
  async mintNFT(params: MintNFTParams): Promise<TransactionResult> {
    this._requireClient();
    return mintNFT(this._client!, params);
  }

  // ─── Raw Transaction ────────────────────────────────────────────────

  /**
   * Sign and broadcast any Cosmos SDK message.
   */
  async broadcast(
    msg: { typeUrl: string; value: unknown },
    gasLimit?: number
  ): Promise<TransactionResult> {
    this._requireClient();
    return this._client!.signAndBroadcastMsg(msg, gasLimit);
  }

  // ─── Private Helpers ────────────────────────────────────────────────

  private _requireClient(): void {
    if (!this._client) {
      throw new Error(
        `Agent "${this.name}" is not initialized. Call agent.init() first.`
      );
    }
  }
}
