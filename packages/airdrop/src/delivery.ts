/**
 * delivery.ts — Airdrop review delivery (email / Telegram formatting)
 */

import { ResolvedAirdrop } from "./types.js";

export async function sendAirdropReview(
  resolved: ResolvedAirdrop,
  delivery: { type: "email" | "telegram"; target: string },
  tokenDenom: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (delivery.type === "email") {
      const html = formatEmailHTML(resolved, tokenDenom);
      const text = formatEmailText(resolved, tokenDenom);

      console.log(`[smart-airdrop] Email review for ${delivery.target}:`);
      console.log(`[smart-airdrop] Subject: Airdrop Review — ${tokenDenom}`);
      console.log(`[smart-airdrop] Text preview:\n${text}`);

      return { ok: true };
    }

    if (delivery.type === "telegram") {
      const message = formatTelegramMessage(resolved, tokenDenom);

      console.log(`[smart-airdrop] Telegram review for ${delivery.target}:`);
      console.log(message);

      return { ok: true };
    }

    return { ok: false, error: `Unknown delivery type: ${delivery.type}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function formatEmailHTML(resolved: ResolvedAirdrop, tokenDenom: string): string {
  const rows = resolved.recipients
    .slice(0, 100)
    .map(
      (r) =>
        `<tr><td style="padding:4px 8px;border:1px solid #ddd;font-family:monospace;font-size:12px">${r.address}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right">${r.amount}</td></tr>`
    )
    .join("\n");

  const sourceLines = Object.entries(resolved.sourceBreakdown)
    .map(([k, v]) => `<li>${k}: ${v} addresses</li>`)
    .join("\n");

  return `
<h2>Airdrop Review — ${tokenDenom}</h2>
<table style="border-collapse:collapse;margin:8px 0">
  <tr><td><strong>Total recipients:</strong></td><td>${resolved.recipients.length}</td></tr>
  <tr><td><strong>Total amount:</strong></td><td>${resolved.totalAmount} ${tokenDenom}</td></tr>
  <tr><td><strong>Duplicates removed:</strong></td><td>${resolved.duplicatesRemoved}</td></tr>
  <tr><td><strong>Invalid addresses:</strong></td><td>${resolved.invalidAddresses.length}</td></tr>
</table>

<h3>Source breakdown</h3>
<ul>${sourceLines}</ul>

<h3>Recipients${resolved.recipients.length > 100 ? " (first 100)" : ""}</h3>
<table style="border-collapse:collapse">
  <tr><th style="padding:4px 8px;border:1px solid #ddd;background:#f5f5f5">Address</th><th style="padding:4px 8px;border:1px solid #ddd;background:#f5f5f5">Amount</th></tr>
  ${rows}
</table>
`.trim();
}

function formatEmailText(resolved: ResolvedAirdrop, tokenDenom: string): string {
  const lines = [
    `Airdrop Review — ${tokenDenom}`,
    ``,
    `Total recipients: ${resolved.recipients.length}`,
    `Total amount: ${resolved.totalAmount} ${tokenDenom}`,
    `Duplicates removed: ${resolved.duplicatesRemoved}`,
    `Invalid addresses: ${resolved.invalidAddresses.length}`,
    ``,
    `Source breakdown:`,
    ...Object.entries(resolved.sourceBreakdown).map(([k, v]) => `  ${k}: ${v} addresses`),
    ``,
    `Recipients${resolved.recipients.length > 100 ? " (first 100)" : ""}:`,
    ...resolved.recipients.slice(0, 100).map((r) => `  ${r.address}  ${r.amount}`),
  ];
  return lines.join("\n");
}

function formatTelegramMessage(resolved: ResolvedAirdrop, tokenDenom: string): string {
  const sourceLines = Object.entries(resolved.sourceBreakdown)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join("\n");

  const addrList = resolved.recipients
    .slice(0, 20)
    .map((r) => `<code>${r.address}</code> — ${r.amount}`)
    .join("\n");

  const moreText =
    resolved.recipients.length > 20
      ? `\n... and ${resolved.recipients.length - 20} more`
      : "";

  return [
    `<b>Airdrop Review — ${tokenDenom}</b>`,
    ``,
    `Recipients: ${resolved.recipients.length}`,
    `Total: ${resolved.totalAmount} ${tokenDenom}`,
    `Duplicates removed: ${resolved.duplicatesRemoved}`,
    `Invalid: ${resolved.invalidAddresses.length}`,
    ``,
    `<b>Sources:</b>`,
    sourceLines,
    ``,
    `<b>Recipients:</b>`,
    addrList,
    moreText,
  ].join("\n");
}
