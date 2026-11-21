/**
 * Price service placeholder.
 *
 * The service reads Chainlink Coinbase equity feeds on Base Mainnet and
 * publishes the reference price to Base Sepolia. It must persist both the
 * original `updatedAt` timestamp and the Chainlink round id, and must never
 * refresh a stale price by copying it with a new timestamp.
 *
 * Phase 0 defines the provenance fields only; no ingestion runs yet.
 */
export const PRICE_PROVENANCE_FIELDS = [
  "feedAddress",
  "sourceChainId",
  "roundId",
  "answer",
  "feedDecimals",
  "sourceUpdatedAt",
  "observedAt",
] as const;

export type PriceProvenanceField = (typeof PRICE_PROVENANCE_FIELDS)[number];

export const PRICE_SERVICE = {
  name: "kyrox-price",
  sourceChainEnv: "base-mainnet",
  publishChainEnv: "base-sepolia",
  status: "phase-0-scaffold",
} as const;
