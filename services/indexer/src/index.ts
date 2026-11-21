/**
 * Indexer service placeholder.
 *
 * The indexer will consume Base Sepolia logs for the exchange, faucet, and
 * token contracts. It must be idempotent, store checkpoints, and roll back
 * state on reorgs. No event handlers exist in Phase 0.
 */
export const INDEXER_SERVICE = {
  name: "kyrox-indexer",
  chainEnv: "base-sepolia",
  status: "phase-0-scaffold",
} as const;
