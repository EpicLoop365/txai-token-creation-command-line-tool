/**
 * tokens.ts — Smart token operations for TX blockchain
 */

import { TxClient, TransactionResult } from "./client.js";
import { NETWORKS, NetworkName } from "./networks.js";

// ─── TYPES ──────────────────────────────────────────────────────────────────

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
  clawback: 6,
};

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
  uri?: string;
  uriHash?: string;
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
  uri?: string;
  uri_hash?: string;
}

// ─── OPERATIONS ─────────────────────────────────────────────────────────────

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

  const toChainRate = (rate?: string): string | undefined => {
    if (!rate || rate === "0") return undefined;
    const num = parseFloat(rate);
    if (isNaN(num) || num <= 0 || num > 1) return undefined;
    const rounded = Math.round(num * 10000) / 10000;
    const scaled = Math.round(rounded * 1e18);
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
      uri: params.uri ?? "",
      uriHash: params.uriHash ?? "",
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
  return client.signAndBroadcastMsg(msg, 500000);
}

export async function burnTokens(
  client: TxClient,
  denom: string,
  amount: string
): Promise<TransactionResult> {
  const msg = {
    typeUrl: "/coreum.asset.ft.v1.MsgBurn",
    value: {
      sender: client.address,
      coin: { denom, amount },
    },
  };
  return client.signAndBroadcastMsg(msg, 500000);
}

export async function freezeAccount(
  client: TxClient,
  denom: string,
  account: string,
  amount: string
): Promise<TransactionResult> {
  const msg = {
    typeUrl: "/coreum.asset.ft.v1.MsgFreeze",
    value: {
      sender: client.address,
      account,
      coin: { denom, amount },
    },
  };
  return client.signAndBroadcastMsg(msg, 500000);
}

export async function unfreezeAccount(
  client: TxClient,
  denom: string,
  account: string,
  amount: string
): Promise<TransactionResult> {
  const msg = {
    typeUrl: "/coreum.asset.ft.v1.MsgUnfreeze",
    value: {
      sender: client.address,
      account,
      coin: { denom, amount },
    },
  };
  return client.signAndBroadcastMsg(msg, 500000);
}

export async function globallyFreezeToken(
  client: TxClient,
  denom: string
): Promise<TransactionResult> {
  const msg = {
    typeUrl: "/coreum.asset.ft.v1.MsgGloballyFreeze",
    value: { sender: client.address, denom },
  };
  return client.signAndBroadcastMsg(msg, 500000);
}

export async function globallyUnfreezeToken(
  client: TxClient,
  denom: string
): Promise<TransactionResult> {
  const msg = {
    typeUrl: "/coreum.asset.ft.v1.MsgGloballyUnfreeze",
    value: { sender: client.address, denom },
  };
  return client.signAndBroadcastMsg(msg, 500000);
}

export async function clawbackTokens(
  client: TxClient,
  denom: string,
  account: string,
  amount: string
): Promise<TransactionResult> {
  const msg = {
    typeUrl: "/coreum.asset.ft.v1.MsgClawback",
    value: {
      sender: client.address,
      account,
      coin: { denom, amount },
    },
  };
  return client.signAndBroadcastMsg(msg, 500000);
}

export async function setWhitelistedLimit(
  client: TxClient,
  denom: string,
  account: string,
  amount: string
): Promise<TransactionResult> {
  const msg = {
    typeUrl: "/coreum.asset.ft.v1.MsgSetWhitelistedLimit",
    value: {
      sender: client.address,
      account,
      coin: { denom, amount },
    },
  };
  return client.signAndBroadcastMsg(msg, 500000);
}

export async function getTokenInfo(
  denom: string,
  networkName: NetworkName = "testnet"
): Promise<SmartTokenInfo> {
  try {
    const network = NETWORKS[networkName];
    const url = `${network.restEndpoint}/coreum/asset/ft/v1/tokens/${denom}`;
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
