/**
 * networks.ts — Network configuration for TX (Coreum) blockchain
 */

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
