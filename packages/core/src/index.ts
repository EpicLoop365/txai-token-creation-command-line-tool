/**
 * @solomente/txai-core — Barrel export
 *
 * Core TX blockchain SDK: wallet, client, smart tokens, NFTs, DEX, and faucet.
 */

// ─── Networks ────────────────────────────────────────────────────────────────
export {
  NETWORKS,
  type NetworkName,
  type NetworkConfig,
} from "./networks.js";

// ─── Wallet ──────────────────────────────────────────────────────────────────
export {
  createWallet,
  importWallet,
  type TxWallet,
} from "./wallet.js";

// ─── Client ──────────────────────────────────────────────────────────────────
export {
  TxClient,
  TxMutex,
  type TokenBalance,
  type TransactionResult,
} from "./client.js";

// ─── Smart Tokens ────────────────────────────────────────────────────────────
export {
  issueSmartToken,
  mintTokens,
  burnTokens,
  freezeAccount,
  unfreezeAccount,
  globallyFreezeToken,
  globallyUnfreezeToken,
  clawbackTokens,
  setWhitelistedLimit,
  getTokenInfo,
  type SmartTokenFeatures,
  type IssueSmartTokenParams,
  type SmartTokenInfo,
} from "./tokens.js";

// ─── NFTs ────────────────────────────────────────────────────────────────────
export {
  issueNFTClass,
  mintNFT,
  burnNFT,
  freezeNFT,
  unfreezeNFT,
  classWhitelistNFT,
  queryNFTClass,
  queryNFTsByClass,
  queryNFTsByOwner,
  queryNFTOwner,
  type NFTClassFeatures,
  type IssueNFTClassParams,
  type MintNFTParams,
  type NFTClassInfo,
  type NFTInfo,
} from "./nft.js";

// ─── DEX ─────────────────────────────────────────────────────────────────────
export {
  placeOrder,
  cancelOrder,
  queryOrderbook,
  queryOrdersByCreator,
  queryOrderBooks,
  getDexModuleAddress,
  DexSide,
  DexOrderType,
  DexTimeInForce,
  DEX_MODULE_ADDRESS_TESTNET,
  DEX_MODULE_ADDRESS_MAINNET,
  type PlaceOrderParams,
  type GoodTil,
  type DexOrder,
  type OrderbookData,
} from "./dex.js";

// ─── Faucet ──────────────────────────────────────────────────────────────────
export { requestFaucet } from "./faucet.js";
