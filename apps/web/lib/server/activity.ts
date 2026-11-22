import type { Address, Hex } from "viem";

import type { RuntimeEnvironment } from "./env.js";
import { createChainClient, TRADE_EVENT_ABI } from "./chain.js";
import { DrizzleIntentStore } from "./stores.js";
import { exchangeAddress } from "./env.js";

export type IntentStatus =
  "prepared" | "submitted" | "included" | "verified" | "failed" | "reorged";

export interface ActivityItem {
  readonly id: string;
  readonly quoteId: string;
  readonly symbol: string;
  readonly side: "buy" | "sell";
  readonly amountIn: string;
  readonly minAmountOut: string;
  readonly status: IntentStatus;
  readonly txHash: string | null;
  readonly createdAt: string;
  readonly simulation: boolean;
}

async function refresh(env: RuntimeEnvironment, id: string): Promise<void> {
  const store = new DrizzleIntentStore(
    (await import("@kyrox/db")).createDatabase(env.databaseUrl).db,
  );
  const intent = await store.get(id);
  if (intent?.txHash === null || intent?.txHash === undefined) return;

  const client = createChainClient(env);
  const transaction = await client.getTransaction({ hash: intent.txHash as Hex });
  if (
    transaction.from.toLowerCase() !== intent.trader.toLowerCase() ||
    transaction.input.toLowerCase() !== intent.calldata.toLowerCase() ||
    transaction.to?.toLowerCase() !== exchangeAddress(env).toLowerCase() ||
    transaction.chainId !== 84_532
  ) {
    await store.markStatus(id, "failed", { txHash: intent.txHash });
    return;
  }
  const receipt = await client.getTransactionReceipt({ hash: intent.txHash as Hex });
  const latest = await client.getBlockNumber();
  const confirmations = Number(latest - receipt.blockNumber) + 1;
  const previousBlockHash = intent.blockHash;

  if (previousBlockHash !== null && previousBlockHash !== receipt.blockHash) {
    await store.markStatus(id, "reorged");
    const { logEvent } = await import("./observability.js");
    await logEvent("error", "transaction_reorged", `Intent ${id} inclusion was reorged.`);
    return;
  }
  if (receipt.status === "reverted") {
    await store.markStatus(id, "failed");
    return;
  }
  if (receipt.to?.toLowerCase() !== exchangeAddress(env).toLowerCase()) {
    await store.markStatus(id, "failed");
    return;
  }
  if (confirmations < 3) {
    await store.markStatus(id, "submitted", { blockHash: receipt.blockHash });
    return;
  }
  if (receipt.contractAddress !== null) return;
  await store.markStatus(id, "verified", { blockHash: receipt.blockHash });
}

export async function activityFor(
  env: RuntimeEnvironment,
  trader: Address,
): Promise<ActivityItem[]> {
  const store = new DrizzleIntentStore(
    (await import("@kyrox/db")).createDatabase(env.databaseUrl).db,
  );
  const rows = await store.list(trader);
  const result: ActivityItem[] = [];
  for (const row of rows) {
    if (row.txHash !== null) {
      try {
        await refresh(env, row.id);
      } catch {
        // A temporary RPC error must not turn a prepared intent into a failure.
      }
    }
    const current = await store.get(row.id);
    if (current === undefined) continue;
    result.push({
      id: current.id,
      quoteId: current.quoteId,
      symbol: current.assetSymbol,
      side: current.side,
      amountIn: current.amountIn.toString(),
      minAmountOut: current.minAmountOut.toString(),
      status: current.status,
      txHash: current.txHash,
      createdAt: current.createdAt.toISOString(),
      simulation: env.mode === "local-anvil",
    });
  }
  return result;
}

export async function recordSubmitted(
  env: RuntimeEnvironment,
  intentId: string,
  txHash: Hex,
  owner: Address,
): Promise<void> {
  const db = (await import("@kyrox/db")).createDatabase(env.databaseUrl);
  try {
    const store = new DrizzleIntentStore(db.db);
    const intent = await store.get(intentId);
    if (intent === undefined) throw new Error("Intent was not found.");
    if (intent.trader.toLowerCase() !== owner.toLowerCase()) {
      throw new Error("Intent belongs to a different wallet.");
    }
    const client = createChainClient(env);
    const tx = await client.getTransaction({ hash: txHash });
    if (tx.chainId !== 84_532) throw new Error("Transaction is on the wrong chain.");
    if (tx.to?.toLowerCase() !== exchangeAddress(env).toLowerCase()) {
      throw new Error("Transaction destination is not the exchange.");
    }
    if (tx.from.toLowerCase() !== owner.toLowerCase()) {
      throw new Error("Transaction sender is not the authenticated wallet.");
    }
    if (tx.input.toLowerCase() !== intent.calldata.toLowerCase()) {
      throw new Error("Transaction calldata does not match the prepared intent.");
    }
    await store.markStatus(intentId, "submitted", { txHash });
  } finally {
    await db.pool.end();
  }
}

export { TRADE_EVENT_ABI };
