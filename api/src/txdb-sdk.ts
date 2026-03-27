/**
 * txdb SDK — On-Chain Key-Value Storage via Transaction Memos
 *
 * Stores structured data on the TX (Coreum) blockchain by encoding JSON
 * into the memo field of minimal self-transfer transactions.
 *
 * The blockchain becomes the database:
 *   write(collection, data) → sends 1 utestcore self-transfer with memo → returns txHash
 *   read(txHash)            → fetches tx from chain → parses memo → returns data
 *   scan(address)           → scans tx history for all txdb entries
 *
 * Memo format (max 256 chars):
 *   txdb:v1:{collection}:{compactJSON}
 *
 * Usage:
 *   const db = new TxDBOnChain(client, networkName);
 *   const { txHash } = await db.write("tokens", { symbol: "GEMS", supply: "1000000" });
 *   const record = await db.read(txHash);
 *   const allTokens = await db.scan(address, "tokens");
 */

import { TxClient, NetworkName, NETWORKS } from "./tx-sdk";

// ─── Constants ──────────────────────────────────────────────────────────────

const TXDB_PREFIX = "txdb:v1";
const MEMO_MAX = 256;
const SELF_SEND_AMOUNT = "1"; // 1 utestcore — minimum possible

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TxDBRecord {
  collection: string;
  data: Record<string, unknown>;
  txHash: string;
  height: number;
  timestamp?: string;
  sender: string;
}

export interface TxDBWriteResult {
  success: boolean;
  txHash: string;
  height: number;
  collection: string;
  bytesUsed: number;
}

export interface TxDBIndex {
  entries: TxDBRecord[];
  address: string;
  scannedAt: string;
  totalFound: number;
}

// ─── SDK Class ──────────────────────────────────────────────────────────────

export class TxDBOnChain {
  private client: TxClient;
  private networkName: NetworkName;
  private denom: string;
  private restEndpoint: string;

  constructor(client: TxClient, networkName: NetworkName = "testnet") {
    this.client = client;
    this.networkName = networkName;
    const network = NETWORKS[networkName];
    this.denom = network.denom;
    this.restEndpoint = network.restEndpoint;
  }

  /**
   * Write data to the blockchain via a self-transfer memo.
   *
   * @param collection - Category name (e.g. "tokens", "swarms", "config")
   * @param data - JSON-serializable object to store
   * @returns Write result with txHash for future reads
   */
  async write(
    collection: string,
    data: Record<string, unknown>
  ): Promise<TxDBWriteResult> {
    const json = JSON.stringify(data);
    const memo = `${TXDB_PREFIX}:${collection}:${json}`;

    if (memo.length > MEMO_MAX) {
      throw new Error(
        `txdb: memo exceeds ${MEMO_MAX} chars (${memo.length}). ` +
        `Shorten data or use writeChunked() for large records. ` +
        `Available for data: ${MEMO_MAX - TXDB_PREFIX.length - collection.length - 2} chars`
      );
    }

    // Self-transfer: send 1 utestcore to yourself with the memo
    const msg = {
      typeUrl: "/cosmos.bank.v1beta1.MsgSend",
      value: {
        fromAddress: this.client.address,
        toAddress: this.client.address,
        amount: [{ denom: this.denom, amount: SELF_SEND_AMOUNT }],
      },
    };

    const result = await this.client.signAndBroadcastMsg(msg, 100000, memo);

    if (!result.success) {
      throw new Error(`txdb: write failed — ${result.error}`);
    }

    console.log(
      `[txdb] Wrote ${memo.length}/${MEMO_MAX} chars to ${collection} → ${result.txHash}`
    );

    return {
      success: true,
      txHash: result.txHash,
      height: result.height,
      collection,
      bytesUsed: memo.length,
    };
  }

  /**
   * Write large data across multiple transactions (chunked).
   * First tx is the header with chunk count, subsequent txs are data chunks.
   *
   * @param collection - Category name
   * @param data - JSON-serializable object (can exceed 256 chars)
   * @returns Array of write results; first txHash is the entry point
   */
  async writeChunked(
    collection: string,
    data: Record<string, unknown>
  ): Promise<TxDBWriteResult[]> {
    const json = JSON.stringify(data);
    const overhead = `${TXDB_PREFIX}:${collection}:`.length;
    const chunkSize = MEMO_MAX - overhead - 20; // leave room for chunk metadata

    // If it fits in one memo, just use write()
    if (json.length <= MEMO_MAX - overhead) {
      return [await this.write(collection, data)];
    }

    // Split into chunks
    const chunks: string[] = [];
    for (let i = 0; i < json.length; i += chunkSize) {
      chunks.push(json.slice(i, i + chunkSize));
    }

    const results: TxDBWriteResult[] = [];

    // Write chunks in reverse so we have their hashes for the header
    const chunkHashes: string[] = [];
    for (let i = chunks.length - 1; i >= 0; i--) {
      const chunkMemo = `${TXDB_PREFIX}:${collection}:chunk:${i}:${chunks[i]}`;
      const msg = {
        typeUrl: "/cosmos.bank.v1beta1.MsgSend",
        value: {
          fromAddress: this.client.address,
          toAddress: this.client.address,
          amount: [{ denom: this.denom, amount: SELF_SEND_AMOUNT }],
        },
      };
      const r = await this.client.signAndBroadcastMsg(msg, 100000, chunkMemo);
      chunkHashes.unshift(r.txHash);
      results.unshift({
        success: r.success,
        txHash: r.txHash,
        height: r.height,
        collection,
        bytesUsed: chunkMemo.length,
      });
    }

    // Write header pointing to all chunks
    const header = await this.write(collection, {
      _chunked: true,
      _chunks: chunkHashes,
      _total: chunks.length,
    });
    results.unshift(header);

    console.log(
      `[txdb] Wrote chunked record: ${chunks.length} chunks for ${collection}`
    );

    return results;
  }

  /**
   * Read a txdb record by transaction hash.
   *
   * @param txHash - The transaction hash from a previous write
   * @returns Parsed record or null if not a txdb transaction
   */
  async read(txHash: string): Promise<TxDBRecord | null> {
    try {
      const url = `${this.restEndpoint}/cosmos/tx/v1beta1/txs/${txHash}`;
      const response = await fetch(url);
      if (!response.ok) return null;

      const result = await response.json() as {
        tx?: { body?: { memo?: string } };
        tx_response?: {
          height?: string;
          timestamp?: string;
          txhash?: string;
        };
      };

      const memo = result.tx?.body?.memo || "";
      const txResponse = result.tx_response;

      return this.parseMemo(memo, {
        txHash: txResponse?.txhash || txHash,
        height: parseInt(txResponse?.height || "0"),
        timestamp: txResponse?.timestamp,
        sender: this.client.address,
      });
    } catch (err) {
      console.error(`[txdb] Read failed for ${txHash}:`, (err as Error).message);
      return null;
    }
  }

  /**
   * Read a chunked record by reading the header and assembling chunks.
   */
  async readChunked(txHash: string): Promise<TxDBRecord | null> {
    const header = await this.read(txHash);
    if (!header || !header.data._chunked) return header;

    const chunkHashes = header.data._chunks as string[];
    const chunks: string[] = new Array(chunkHashes.length);

    for (let i = 0; i < chunkHashes.length; i++) {
      const url = `${this.restEndpoint}/cosmos/tx/v1beta1/txs/${chunkHashes[i]}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`txdb: chunk ${i} not found`);
      const result = await response.json() as {
        tx?: { body?: { memo?: string } };
      };
      const memo = result.tx?.body?.memo || "";
      // Extract chunk data after "chunk:N:" prefix
      const chunkMatch = memo.match(/chunk:\d+:(.*)/);
      if (chunkMatch) chunks[i] = chunkMatch[1];
    }

    const fullJson = chunks.join("");
    try {
      const data = JSON.parse(fullJson);
      return {
        collection: header.collection,
        data,
        txHash,
        height: header.height,
        timestamp: header.timestamp,
        sender: header.sender,
      };
    } catch {
      return null;
    }
  }

  /**
   * Scan an address's transaction history for all txdb entries.
   * Optionally filter by collection.
   *
   * @param address - Wallet address to scan
   * @param collection - Optional collection filter
   * @param limit - Max transactions to scan (default 100)
   * @returns Index of all found txdb records
   */
  async scan(
    address: string,
    collection?: string,
    limit = 100
  ): Promise<TxDBIndex> {
    const entries: TxDBRecord[] = [];

    try {
      // Query sent transactions for this address
      const url =
        `${this.restEndpoint}/cosmos/tx/v1beta1/txs?events=message.sender='${address}'` +
        `&order_by=ORDER_BY_DESC&pagination.limit=${limit}`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`REST query failed: ${response.status}`);
      }

      const result = await response.json() as {
        txs?: Array<{ body?: { memo?: string } }>;
        tx_responses?: Array<{
          txhash?: string;
          height?: string;
          timestamp?: string;
        }>;
      };

      const txs = result.txs || [];
      const responses = result.tx_responses || [];

      for (let i = 0; i < txs.length; i++) {
        const memo = txs[i]?.body?.memo || "";
        if (!memo.startsWith(TXDB_PREFIX)) continue;

        const record = this.parseMemo(memo, {
          txHash: responses[i]?.txhash || "",
          height: parseInt(responses[i]?.height || "0"),
          timestamp: responses[i]?.timestamp,
          sender: address,
        });

        if (record && (!collection || record.collection === collection)) {
          entries.push(record);
        }
      }
    } catch (err) {
      console.error(`[txdb] Scan failed:`, (err as Error).message);
    }

    return {
      entries,
      address,
      scannedAt: new Date().toISOString(),
      totalFound: entries.length,
    };
  }

  /**
   * Get remaining space available for data in a given collection.
   */
  available(collection: string): number {
    return MEMO_MAX - `${TXDB_PREFIX}:${collection}:`.length;
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private parseMemo(
    memo: string,
    meta: { txHash: string; height: number; timestamp?: string; sender: string }
  ): TxDBRecord | null {
    if (!memo.startsWith(TXDB_PREFIX + ":")) return null;

    // Format: txdb:v1:collection:jsonData
    const afterPrefix = memo.slice(TXDB_PREFIX.length + 1);
    const colonIdx = afterPrefix.indexOf(":");
    if (colonIdx === -1) return null;

    const col = afterPrefix.slice(0, colonIdx);
    const jsonStr = afterPrefix.slice(colonIdx + 1);

    try {
      const data = JSON.parse(jsonStr);
      return {
        collection: col,
        data,
        txHash: meta.txHash,
        height: meta.height,
        timestamp: meta.timestamp,
        sender: meta.sender,
      };
    } catch {
      // Not valid JSON — might be a chunk or malformed
      return null;
    }
  }
}

// ─── Convenience Factory ────────────────────────────────────────────────────

/**
 * Create a TxDBOnChain instance from a mnemonic.
 *
 * @example
 *   const db = await createTxDB(mnemonic, "testnet");
 *   await db.write("tokens", { symbol: "GEMS" });
 */
export async function createTxDB(
  client: TxClient,
  networkName: NetworkName = "testnet"
): Promise<TxDBOnChain> {
  return new TxDBOnChain(client, networkName);
}
