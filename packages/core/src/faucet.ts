/**
 * faucet.ts — Testnet faucet request
 */

import { NETWORKS, NetworkName } from "./networks.js";

export async function requestFaucet(
  address: string,
  networkName: NetworkName = "testnet"
): Promise<{ success: boolean; message: string }> {
  const network = NETWORKS[networkName];
  if (!network.faucetUrl) {
    return { success: false, message: `No faucet available for ${networkName}` };
  }
  try {
    const response = await fetch(network.faucetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });
    if (!response.ok) {
      return { success: false, message: `Faucet request failed (${response.status})` };
    }
    return { success: true, message: `Faucet tokens sent to ${address}` };
  } catch (err) {
    return { success: false, message: `Could not reach faucet: ${(err as Error).message}` };
  }
}
