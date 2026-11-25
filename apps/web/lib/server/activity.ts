import { decodeEventLog, type Address, type Hex } from "viem";

import { fromBaseUnits } from "@kyrox/core";

import type { ActivityItem, ActivityStatus } from "../market-types.js";
import { appDatabase } from "./database.js";
import type { RuntimeEnvironment } from "./env.js";
import { assetAddress, exchangeAddress } from "./env.js";
import { createChainClient, TRADE_EVENT_ABI, type ChainClient } from "./chain.js";
import { logEvent } from "./observability.js";
import { ApiError, isTransactionHash } from "./request.js";
import {
  DrizzleIntentStore,
  classifyTransactionAssociation,
  type TradeIntentRecord,
} from "./stores.js";

export type IntentStatus = Exclude<ActivityStatus, "simulated">;

export interface ActivityResult {
  readonly activity: ActivityItem[];
  /** True when on-chain reconciliation was unavailable for at least one row. */
  readonly stale: boolean;
}

export interface ActivityRefresh {
  readonly status: IntentStatus;
  readonly amountOut: string | null;
  readonly priceUsdc: string | null;
}

const MAX_ACTIVITY_ROWS = 50;
const MAX_RECONCILE_PER_REQUEST = 8;
const MAX_REFRESH_CONCURRENCY = 3;
const RECENT_INTENT_WINDOW_MS = 24 * 60 * 60 * 1_000;
const RECONCILABLE_STATUSES: ReadonlySet<string> = new Set(["submitted", "included", "verified"]);
const STATUS_RANK: Readonly<Record<IntentStatus, number>> = {
  prepared: 0,
  submitted: 1,
  included: 2,
  verified: 3,
  failed: 4,
  reorged: 4,
};

/** Confirmation refreshes are monotonic; terminal and verified rows never regress. */
export function statusAfterConfirmations(
  current: IntentStatus,
  confirmations: number,
): IntentStatus {
  if (current === "failed" || current === "reorged" || !Number.isFinite(confirmations)) {
    return current;
  }
  const candidate: IntentStatus =
    confirmations < 1 ? "submitted" : confirmations < 3 ? "included" : "verified";
  return STATUS_RANK[candidate] < STATUS_RANK[current] ? current : candidate;
}

async function applyStatus(
  store: DrizzleIntentStore,
  intent: TradeIntentRecord,
  status: Exclude<IntentStatus, "prepared">,
  evidence?: { txHash?: string; blockNumber?: bigint; blockHash?: string },
): Promise<IntentStatus> {
  const updated = await store.markStatus(intent.id, status, evidence);
  if (updated !== null) return updated.status;
  // A concurrent compare-and-swap won; report the persisted state, not the
  // status this stale refresh attempted to write.
  const current = await store.get(intent.id);
  return (current?.status ?? intent.status) as IntentStatus;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

async function refresh(
  env: RuntimeEnvironment,
  store: DrizzleIntentStore,
  intent: TradeIntentRecord,
  client: ChainClient,
  latestBlock: bigint,
): Promise<ActivityRefresh> {
  if (intent.txHash === null || !isTransactionHash(intent.txHash)) {
    throw new Error("Stored intent has no valid transaction hash.");
  }
  const txHash = intent.txHash;
  const transaction = await client.getTransaction({ hash: txHash });
  if (
    !sameAddress(transaction.from, intent.trader) ||
    transaction.input.toLowerCase() !== intent.calldata.toLowerCase() ||
    transaction.to === null ||
    !sameAddress(transaction.to, exchangeAddress(env)) ||
    transaction.chainId !== env.manifest.chainId
  ) {
    const status = await applyStatus(store, intent, "failed", { txHash });
    return { status, amountOut: null, priceUsdc: null };
  }

  const receipt = await client.getTransactionReceipt({ hash: txHash });
  const previousBlockHash = intent.blockHash;
  if (
    previousBlockHash !== null &&
    previousBlockHash.toLowerCase() !== receipt.blockHash.toLowerCase()
  ) {
    const status = await applyStatus(store, intent, "reorged");
    if (status === "reorged") {
      await logEvent(
        "error",
        "transaction_reorged",
        `Intent ${intent.id} inclusion was reorged.`,
        { intentId: intent.id, txHash },
        store.db,
      );
    }
    return { status, amountOut: null, priceUsdc: null };
  }
  if (receipt.status === "reverted") {
    const status = await applyStatus(store, intent, "failed");
    return { status, amountOut: null, priceUsdc: null };
  }
  if (receipt.to === null || !sameAddress(receipt.to, exchangeAddress(env))) {
    const status = await applyStatus(store, intent, "failed");
    return { status, amountOut: null, priceUsdc: null };
  }

  const stockToken = assetAddress(env, intent.assetSymbol);
  const isBuy = intent.side === "buy";
  const amountIn = BigInt(intent.amountIn);
  const events = receipt.logs.flatMap((log) => {
    try {
      const event = decodeEventLog({
        abi: TRADE_EVENT_ABI,
        eventName: "Trade",
        data: log.data,
        topics: log.topics,
      });
      return event.eventName === "Trade" ? [event] : [];
    } catch {
      return [];
    }
  });
  const fill = events.find((event) => {
    const args = event.args;
    return (
      sameAddress(args.trader, intent.trader) &&
      sameAddress(args.stockToken, stockToken) &&
      args.isBuy === isBuy &&
      (isBuy ? args.usdcAmount === amountIn : args.stockAmount === amountIn)
    );
  });
  const amountOut =
    fill === undefined
      ? null
      : isBuy
        ? fill.args.stockAmount.toString()
        : fill.args.usdcAmount.toString();
  const priceUsdc = fill === undefined ? null : fromBaseUnits(fill.args.priceUsdcPerWholeToken, 6);
  const confirmations = Number(latestBlock - receipt.blockNumber) + 1;
  const evidence = {
    txHash,
    blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash,
  };
  if (receipt.contractAddress !== null) {
    return { status: intent.status as IntentStatus, amountOut, priceUsdc };
  }
  const currentStatus = intent.status as IntentStatus;
  const nextStatus = statusAfterConfirmations(currentStatus, confirmations);
  const status =
    nextStatus === "prepared" || nextStatus === currentStatus
      ? currentStatus
      : await applyStatus(store, intent, nextStatus, evidence);
  return { status, amountOut, priceUsdc };
}

export function toActivityItem(
  row: TradeIntentRecord,
  env: RuntimeEnvironment,
  refreshed?: ActivityRefresh,
): ActivityItem {
  return {
    id: row.id,
    symbol: row.assetSymbol,
    side: row.side,
    amountIn: row.amountIn.toString(),
    amountOut: refreshed?.amountOut ?? null,
    priceUsdc: refreshed?.priceUsdc ?? null,
    status: refreshed?.status ?? (row.status as IntentStatus),
    txHash: row.txHash,
    simulated: env.mode === "local-anvil",
    createdAt: row.createdAt.toISOString(),
  };
}

export async function activityPageFor(
  env: RuntimeEnvironment,
  trader: Address,
): Promise<ActivityResult> {
  const database = appDatabase(env.databaseUrl);
  const store = new DrizzleIntentStore(database.db);
  const rows = await store.list(trader, MAX_ACTIVITY_ROWS);
  const cutoff = Date.now() - RECENT_INTENT_WINDOW_MS;
  const candidates = rows
    .filter(
      (row) =>
        row.txHash !== null &&
        RECONCILABLE_STATUSES.has(row.status) &&
        row.createdAt.getTime() >= cutoff,
    )
    .slice(0, MAX_RECONCILE_PER_REQUEST);
  const refreshed = new Map<string, ActivityRefresh>();
  let stale = false;

  if (candidates.length > 0) {
    const client = createChainClient(env);
    let latestBlock: bigint;
    try {
      latestBlock = await client.getBlockNumber();
    } catch (err) {
      stale = true;
      await logEvent(
        "warn",
        "activity_refresh_failed",
        "Could not read the latest block while reconciling activity.",
        { error: err instanceof Error ? err.name : "unknown_error" },
        database.db,
      );
      latestBlock = 0n;
    }

    if (latestBlock > 0n) {
      let cursor = 0;
      const worker = async () => {
        while (cursor < candidates.length) {
          const intent = candidates[cursor];
          cursor += 1;
          if (intent === undefined) continue;
          try {
            refreshed.set(intent.id, await refresh(env, store, intent, client, latestBlock));
          } catch (err) {
            stale = true;
            await logEvent(
              "warn",
              "activity_refresh_failed",
              "On-chain activity reconciliation failed; the persisted status was retained.",
              { intentId: intent.id, error: err instanceof Error ? err.name : "unknown_error" },
              database.db,
            );
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(MAX_REFRESH_CONCURRENCY, candidates.length) }, () =>
          worker(),
        ),
      );
    }
  }

  return {
    activity: rows.map((row) => toActivityItem(row, env, refreshed.get(row.id))),
    stale,
  };
}

/** Backwards-compatible array accessor; routes use activityPageFor for staleness. */
export async function activityFor(
  env: RuntimeEnvironment,
  trader: Address,
): Promise<ActivityItem[]> {
  return (await activityPageFor(env, trader)).activity;
}

export async function recordSubmitted(
  env: RuntimeEnvironment,
  intentId: string,
  txHash: Hex,
  owner: Address,
): Promise<void> {
  const database = appDatabase(env.databaseUrl);
  const store = new DrizzleIntentStore(database.db);
  const intent = await store.get(intentId);
  if (intent === undefined) throw new ApiError(404, "intent_not_found", "Intent was not found.");
  if (!sameAddress(intent.trader, owner)) {
    throw new ApiError(403, "forbidden", "Intent belongs to a different wallet.");
  }
  if (!isTransactionHash(txHash)) {
    throw new ApiError(400, "fields", "txHash must be an exact 32-byte hex transaction hash.");
  }
  if (intent.txHash !== null || intent.status !== "prepared") {
    if (classifyTransactionAssociation(intent, txHash) === "already-associated") return;
    throw new ApiError(
      409,
      "transaction_already_associated",
      "A different or terminal transaction is already associated with this intent.",
    );
  }
  const client = createChainClient(env);
  const tx = await client.getTransaction({ hash: txHash });
  if (tx.chainId !== env.manifest.chainId) {
    throw new ApiError(409, "wrong_chain", "Transaction is on the wrong chain.");
  }
  if (tx.to === null || !sameAddress(tx.to, exchangeAddress(env))) {
    throw new ApiError(409, "transaction_mismatch", "Transaction destination is not the exchange.");
  }
  if (!sameAddress(tx.from, owner)) {
    throw new ApiError(
      409,
      "transaction_mismatch",
      "Transaction sender is not the authenticated wallet.",
    );
  }
  if (tx.input.toLowerCase() !== intent.calldata.toLowerCase()) {
    throw new ApiError(
      409,
      "transaction_mismatch",
      "Transaction calldata does not match the prepared intent.",
    );
  }
  const association = await store.associateTransaction(intentId, txHash);
  if (association === "associated" || association === "already-associated") return;
  if (association === "not-found") {
    throw new ApiError(404, "intent_not_found", "Intent was not found.");
  }
  throw new ApiError(
    409,
    "transaction_already_associated",
    "A different or terminal transaction is already associated with this intent.",
  );
}

export { TRADE_EVENT_ABI };
