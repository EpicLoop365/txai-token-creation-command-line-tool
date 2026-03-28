/**
 * eligibility.ts — On-chain eligibility verification for DAO voting
 */

import { DAOProposal, EligibilityResult } from "./types.js";

export async function checkEligibility(
  voter: string,
  proposal: DAOProposal,
  _network: string,
  restUrl: string
): Promise<EligibilityResult> {
  try {
    // any_wallet gate: always eligible, power = 1
    if (proposal.gateType === "any_wallet") {
      return { eligible: true, power: 1 };
    }

    // NFT gate: check if voter owns an NFT in the required class + verify metadata
    if (proposal.gateType === "nft") {
      if (!proposal.nftClassId) {
        return { eligible: false, power: 0, reason: "Proposal has no NFT class configured." };
      }

      const nftsUrl = `${restUrl}/coreum/asset/nft/v1/nfts?class_id=${encodeURIComponent(proposal.nftClassId)}&owner=${encodeURIComponent(voter)}`;
      const nftsRes = await fetch(nftsUrl);
      const nftsData: any = await nftsRes.json();

      const nfts: any[] = nftsData.nfts || nftsData.items || [];

      if (nfts.length === 0) {
        return {
          eligible: false,
          power: 0,
          reason: `You do not hold any NFTs from class ${proposal.nftClassId}.`,
        };
      }

      // If metadata requirements are set, verify against NFT data
      const requirements = proposal.nftMetadataRequirements;
      if (requirements && requirements.length > 0) {
        const qualifyingNfts = [];

        for (const nft of nfts) {
          // Fetch full NFT data including metadata
          const nftId = nft.id || nft.nft_id || nft.Id;
          let metadata: Record<string, any> = {};

          try {
            // Try to get NFT data from the chain
            const nftDataUrl = `${restUrl}/cosmos/nft/v1beta1/nfts/${encodeURIComponent(proposal.nftClassId)}/${encodeURIComponent(nftId)}`;
            const nftDataRes = await fetch(nftDataUrl);
            const nftDataJson: any = await nftDataRes.json();
            const nftObj = nftDataJson.nft || nftDataJson;

            // Parse metadata from data field (base64 encoded JSON) or URI
            if (nftObj.data) {
              try {
                // data may be a protobuf Any with a value field
                const raw = nftObj.data.value || nftObj.data;
                if (typeof raw === "string") {
                  const decoded = Buffer.from(raw, "base64").toString("utf-8");
                  metadata = JSON.parse(decoded);
                } else if (typeof raw === "object") {
                  metadata = raw;
                }
              } catch {
                // data might be plain JSON object already
                if (typeof nftObj.data === "object") metadata = nftObj.data;
              }
            }

            // Also check uri_hash or uri for metadata
            if (nftObj.uri && Object.keys(metadata).length === 0) {
              try {
                const uriRes = await fetch(nftObj.uri);
                if (uriRes.ok) metadata = (await uriRes.json()) as Record<string, any>;
              } catch { /* URI fetch optional */ }
            }
          } catch {
            // If we can't fetch NFT data, skip this NFT
            continue;
          }

          // Check all requirements against this NFT's metadata
          const meetsAll = requirements.every((req) => {
            const val = metadata[req.field];
            const op = req.operator || "eq";

            switch (op) {
              case "eq":
                return String(val).toLowerCase() === String(req.value).toLowerCase();
              case "neq":
                return String(val).toLowerCase() !== String(req.value).toLowerCase();
              case "exists":
                return val !== undefined && val !== null && val !== "";
              case "gt":
                return parseFloat(val) > parseFloat(req.value);
              case "lt":
                return parseFloat(val) < parseFloat(req.value);
              default:
                return String(val).toLowerCase() === String(req.value).toLowerCase();
            }
          });

          if (meetsAll) {
            qualifyingNfts.push(nft);
          }
        }

        if (qualifyingNfts.length === 0) {
          const reqDesc = requirements.map((r) => `${r.field} ${r.operator || "eq"} "${r.value}"`).join(", ");
          return {
            eligible: false,
            power: 0,
            reason: `You hold NFTs from this class but none match the required metadata: ${reqDesc}`,
          };
        }

        // Use qualifying NFTs for power calculation
        let power = 1;
        if (proposal.votingPower === "nft_count") {
          power = qualifyingNfts.length;
        }

        const qNftId = qualifyingNfts[0].id || qualifyingNfts[0].nft_id || qualifyingNfts[0].Id || "unknown";
        return { eligible: true, power, nftId: qNftId };
      }

      // No metadata requirements — just check ownership
      let power = 1;
      if (proposal.votingPower === "nft_count") {
        power = nfts.length;
      }

      return {
        eligible: true,
        power,
        nftId: nfts[0].id || nfts[0].nft_id || nfts[0].Id || "unknown",
      };
    }

    // Token gate: check balance
    if (proposal.gateType === "token") {
      if (!proposal.tokenDenom) {
        return { eligible: false, power: 0, reason: "Proposal has no token denom configured." };
      }

      const balUrl = `${restUrl}/cosmos/bank/v1beta1/balances/${encodeURIComponent(voter)}/by_denom?denom=${encodeURIComponent(proposal.tokenDenom)}`;
      const balRes = await fetch(balUrl);
      const balData: any = await balRes.json();
      const balance = balData?.balance?.amount || "0";
      const balNum = parseInt(balance, 10);

      const minBalance = parseInt(proposal.minTokenBalance || "1", 10);

      if (balNum < minBalance) {
        return {
          eligible: false,
          power: 0,
          reason: `Insufficient balance. You hold ${balance} but need at least ${proposal.minTokenBalance || "1"} of ${proposal.tokenDenom}.`,
          tokenBalance: balance,
        };
      }

      // Determine power
      let power = 1;
      if (proposal.votingPower === "token_weighted") {
        power = balNum;
      }

      return {
        eligible: true,
        power,
        tokenBalance: balance,
      };
    }

    return { eligible: false, power: 0, reason: "Unknown gate type." };
  } catch (err) {
    return {
      eligible: false,
      power: 0,
      reason: `Chain query failed: ${(err as Error).message}`,
    };
  }
}
