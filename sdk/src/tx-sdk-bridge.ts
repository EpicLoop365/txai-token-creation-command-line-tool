/**
 * tx-sdk-bridge.ts — Re-exports from the core tx-sdk module.
 *
 * For local monorepo development, this imports from the api/src/tx-sdk path.
 * For standalone npm publishing, replace this file's import with the vendored
 * tx-sdk or a published @txai/tx-sdk package.
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
} from "../../api/src/tx-sdk";
