/**
 * check-ids.ts — Solomente TXAI Preflight Compliance Engine
 *
 * Canonical registry of every preflight check ID.
 * Each ID is a unique, machine-readable constant so the frontend can
 * match on specific failures and the backend stays typo-free.
 */

export const CheckId = {
  // ─── Balance ────────────────────────────────────────────────────────────
  BALANCE_INSUFFICIENT:       "BALANCE_INSUFFICIENT",
  BALANCE_QUERY_FAILED:       "BALANCE_QUERY_FAILED",
  BALANCE_OK:                 "BALANCE_OK",

  // ─── Gas / Fees ─────────────────────────────────────────────────────────
  GAS_INSUFFICIENT:           "GAS_INSUFFICIENT",
  GAS_ESTIMATION_FAILED:      "GAS_ESTIMATION_FAILED",
  GAS_OK:                     "GAS_OK",

  // ─── Freeze ─────────────────────────────────────────────────────────────
  TOKEN_GLOBALLY_FROZEN:      "TOKEN_GLOBALLY_FROZEN",
  SENDER_FROZEN:              "SENDER_FROZEN",
  SENDER_FROZEN_PARTIAL:      "SENDER_FROZEN_PARTIAL",
  FREEZE_CHECK_OK:            "FREEZE_CHECK_OK",

  // ─── Whitelist ──────────────────────────────────────────────────────────
  RECIPIENT_NOT_WHITELISTED:  "RECIPIENT_NOT_WHITELISTED",
  WHITELIST_LIMIT_LOW:        "WHITELIST_LIMIT_LOW",
  WHITELIST_OK:               "WHITELIST_OK",

  // ─── Address Validation ────────────────────────────────────────────────
  INVALID_SENDER_ADDRESS:     "INVALID_SENDER_ADDRESS",
  INVALID_RECIPIENT_ADDRESS:  "INVALID_RECIPIENT_ADDRESS",
  ADDRESS_VALIDATION_OK:      "ADDRESS_VALIDATION_OK",

  // ─── Parameter Validation ──────────────────────────────────────────────
  INVALID_AMOUNT:             "INVALID_AMOUNT",
  INVALID_DENOM:              "INVALID_DENOM",
  INVALID_SYMBOL:             "INVALID_SYMBOL",
  SYMBOL_TOO_LONG:            "SYMBOL_TOO_LONG",
  BURN_RATE_PRECISION:        "BURN_RATE_PRECISION",
  COMMISSION_RATE_PRECISION:  "COMMISSION_RATE_PRECISION",
  BURN_RATE_OUT_OF_RANGE:     "BURN_RATE_OUT_OF_RANGE",
  COMMISSION_RATE_OUT_OF_RANGE: "COMMISSION_RATE_OUT_OF_RANGE",
  PARAMETER_OK:               "PARAMETER_OK",
  INVALID_PRICE:              "INVALID_PRICE",

  // ─── NFT ────────────────────────────────────────────────────────────────
  NFT_CLASS_NOT_FOUND:        "NFT_CLASS_NOT_FOUND",
  NOT_NFT_ISSUER:             "NOT_NFT_ISSUER",
  NOT_NFT_OWNER:              "NOT_NFT_OWNER",
  NFT_SOULBOUND:              "NFT_SOULBOUND",
  NFT_FROZEN:                 "NFT_FROZEN",
  NFT_RECIPIENT_NOT_WHITELISTED: "NFT_RECIPIENT_NOT_WHITELISTED",
  URI_TOO_LONG:               "URI_TOO_LONG",
  NFT_CHECK_OK:               "NFT_CHECK_OK",

  // ─── Airdrop ────────────────────────────────────────────────────────────
  AIRDROP_TOTAL_EXCEEDS_BALANCE: "AIRDROP_TOTAL_EXCEEDS_BALANCE",
  AIRDROP_DUPLICATE_RECIPIENTS:  "AIRDROP_DUPLICATE_RECIPIENTS",
  AIRDROP_BATCH_TOO_LARGE:       "AIRDROP_BATCH_TOO_LARGE",
  AIRDROP_EMPTY_RECIPIENTS:      "AIRDROP_EMPTY_RECIPIENTS",
  AIRDROP_OK:                    "AIRDROP_OK",

  // ─── DEX ────────────────────────────────────────────────────────────────
  DEX_INVALID_PAIR:           "DEX_INVALID_PAIR",
  DEX_INSUFFICIENT_BALANCE:   "DEX_INSUFFICIENT_BALANCE",
  DEX_ORDER_OK:               "DEX_ORDER_OK",

  // ─── Compliance ─────────────────────────────────────────────────────────
  COMPLIANCE_JURISDICTION_BLOCKED: "COMPLIANCE_JURISDICTION_BLOCKED",
  COMPLIANCE_KYC_REQUIRED:         "COMPLIANCE_KYC_REQUIRED",
  COMPLIANCE_SANCTIONED:           "COMPLIANCE_SANCTIONED",
  COMPLIANCE_NFT_EXPIRED:          "COMPLIANCE_NFT_EXPIRED",
  COMPLIANCE_NFT_MISSING:          "COMPLIANCE_NFT_MISSING",
  COMPLIANCE_OK:                   "COMPLIANCE_OK",

  // ─── Effective Amount (info) ────────────────────────────────────────────
  EFFECTIVE_AMOUNT_INFO:      "EFFECTIVE_AMOUNT_INFO",
  ISSUANCE_FEE_INFO:          "ISSUANCE_FEE_INFO",
} as const;

export type CheckIdType = (typeof CheckId)[keyof typeof CheckId];
