/**
 * tx-sdk-bridge.ts — Re-exports from the @solomente/txai-core package.
 *
 * For monorepo development, this imports from the core package.
 * For standalone npm publishing, this resolves via node_modules.
 */

export {
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
  type TransactionResult,
  type TokenBalance,
} from "@solomente/txai-core";
