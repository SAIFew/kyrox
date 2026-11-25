import type { PlatformDb } from "@kyrox/db";
import { policyConfig } from "@kyrox/db";
import {
  TESTNET_TRADE_POLICY,
  resolveEditablePolicy,
  type EditablePolicy,
  type TradePolicyConfig,
} from "@kyrox/core";
import { eq } from "drizzle-orm";

const POLICY_KEY = "testnet-policy";

interface StoredPolicy {
  readonly minTradeUsdc: string;
  readonly maxTradeUsdc: string;
  readonly dailyLimitUsdc: string;
  readonly allowedAssets: readonly string[];
  readonly tradingEnabled: boolean;
}

export const DEFAULT_EDITABLE_POLICY: EditablePolicy = resolveEditablePolicy({});

function parseStored(value: string): EditablePolicy {
  const parsed = JSON.parse(value) as Partial<StoredPolicy>;
  return resolveEditablePolicy({
    minTradeUsdc: BigInt(parsed.minTradeUsdc ?? TESTNET_TRADE_POLICY.minTradeUsdc.toString()),
    maxTradeUsdc: BigInt(parsed.maxTradeUsdc ?? TESTNET_TRADE_POLICY.maxTradeUsdc.toString()),
    dailyLimitUsdc: BigInt(parsed.dailyLimitUsdc ?? TESTNET_TRADE_POLICY.dailyLimitUsdc.toString()),
    allowedAssets: parsed.allowedAssets ?? DEFAULT_EDITABLE_POLICY.allowedAssets,
    tradingEnabled: parsed.tradingEnabled ?? true,
  });
}

/**
 * Read the effective testnet policy. A malformed stored value falls back to the
 * launch policy and is never allowed to silently widen limits.
 */
export async function readEffectivePolicy(db: PlatformDb): Promise<EditablePolicy> {
  const rows = await db
    .select()
    .from(policyConfig)
    .where(eq(policyConfig.key, POLICY_KEY))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return DEFAULT_EDITABLE_POLICY;
  try {
    return parseStored(row.value);
  } catch {
    return DEFAULT_EDITABLE_POLICY;
  }
}

export async function readPolicyForQuote(
  db: PlatformDb | null,
): Promise<{ readonly policy: TradePolicyConfig; readonly tradingEnabled: boolean }> {
  if (db === null) {
    return { policy: TESTNET_TRADE_POLICY, tradingEnabled: true };
  }
  const editable = await readEffectivePolicy(db);
  return {
    policy: {
      minTradeUsdc: editable.minTradeUsdc,
      maxTradeUsdc: editable.maxTradeUsdc,
      dailyLimitUsdc: editable.dailyLimitUsdc,
      allowedAssets: editable.allowedAssets,
    },
    tradingEnabled: editable.tradingEnabled,
  };
}

export async function writeEffectivePolicy(
  db: PlatformDb,
  input: Parameters<typeof resolveEditablePolicy>[0],
  updatedBy: string,
): Promise<EditablePolicy> {
  const resolved = resolveEditablePolicy(input);
  const value: StoredPolicy = {
    minTradeUsdc: resolved.minTradeUsdc.toString(),
    maxTradeUsdc: resolved.maxTradeUsdc.toString(),
    dailyLimitUsdc: resolved.dailyLimitUsdc.toString(),
    allowedAssets: resolved.allowedAssets,
    tradingEnabled: resolved.tradingEnabled,
  };
  await db
    .insert(policyConfig)
    .values({
      key: POLICY_KEY,
      value: JSON.stringify(value),
      updatedBy: updatedBy.toLowerCase(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: policyConfig.key,
      set: {
        value: JSON.stringify(value),
        updatedBy: updatedBy.toLowerCase(),
        updatedAt: new Date(),
      },
    });
  return resolved;
}
