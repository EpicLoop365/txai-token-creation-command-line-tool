/**
 * nft.ts — NFT operations for TX blockchain
 */

import { TxClient, TransactionResult } from "./client.js";
import { NETWORKS, NetworkName } from "./networks.js";

// ─── TYPES ──────────────────────────────────────────────────────────────────

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

export interface IssueNFTClassParams {
  symbol: string;
  name: string;
  description?: string;
  uri?: string;
  uriHash?: string;
  features?: NFTClassFeatures;
  royaltyRate?: string;
}

export interface MintNFTParams {
  classId: string;
  id: string;
  uri?: string;
  uriHash?: string;
  data?: string;
  recipient?: string;
}

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

// ─── OPERATIONS ─────────────────────────────────────────────────────────────

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

// ─── QUERIES ────────────────────────────────────────────────────────────────

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
