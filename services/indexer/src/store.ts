import type { PlatformDb } from "@kyrox/db";
import {
  clearCheckpoint,
  getCheckpoint as readCheckpoint,
  rewindIndexedLogs,
  saveCheckpoint as writeCheckpoint,
  upsertIndexedClaim,
  upsertIndexedTrade,
} from "@kyrox/db";

import { INDEXER_STREAM, type IndexerStore } from "./index.js";

export function createPostgresIndexerStore(db: PlatformDb): IndexerStore {
  return {
    async getCheckpoint(stream) {
      const row = await readCheckpoint(db, stream);
      if (row === null) return null;
      return {
        blockNumber: BigInt(row.blockNumber),
        blockHash: row.blockHash as `0x${string}`,
      };
    },
    async saveCheckpoint(input) {
      await writeCheckpoint(db, {
        stream: input.stream,
        chainId: input.chainId,
        blockNumber: input.blockNumber,
        blockHash: input.blockHash,
      });
    },
    async upsertTrade(input) {
      await upsertIndexedTrade(db, input);
    },
    async upsertClaim(input) {
      await upsertIndexedClaim(db, input);
    },
    async rewind(chainId, blockNumber) {
      await rewindIndexedLogs(db, chainId, blockNumber);
      await clearCheckpoint(db, INDEXER_STREAM);
    },
  };
}
