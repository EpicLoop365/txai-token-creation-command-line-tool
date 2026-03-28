/**
 * wallet.ts — Wallet creation and import for TX blockchain
 */

import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { stringToPath } from "@cosmjs/crypto";
import { NETWORKS, NetworkName, NetworkConfig } from "./networks.js";

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
