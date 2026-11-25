import { auditAdminAction, requireAdmin } from "@/lib/server/admin";
import { adminErrorResponse } from "@/lib/server/admin-http";
import { readEffectivePolicy, writeEffectivePolicy } from "@/lib/server/policy-store";
import { error, evaluateSameOrigin, json, requestId } from "@/lib/server/http";
import { readJsonObject } from "@/lib/server/request";

export const dynamic = "force-dynamic";

function bigintField(body: Record<string, unknown>, name: string): bigint | undefined {
  const raw = body[name];
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    throw new Error(`${name} must be a decimal string of base units.`);
  }
  return BigInt(raw);
}

export async function GET() {
  const correlationId = requestId();
  try {
    const { db } = await requireAdmin("view_metrics");
    const policy = await readEffectivePolicy(db);
    return json({
      policy: {
        minTradeUsdc: policy.minTradeUsdc.toString(),
        maxTradeUsdc: policy.maxTradeUsdc.toString(),
        dailyLimitUsdc: policy.dailyLimitUsdc.toString(),
        allowedAssets: policy.allowedAssets,
        tradingEnabled: policy.tradingEnabled,
      },
    });
  } catch (err) {
    return adminErrorResponse(err, correlationId);
  }
}

export async function PUT(req: Request) {
  const correlationId = requestId();
  try {
    if (!evaluateSameOrigin(req).allowed) {
      return error("Cross-origin request rejected.", 403, "origin", correlationId);
    }
    const { db, session } = await requireAdmin("manage_policy");
    const body = await readJsonObject(req);
    const allowed = body["allowedAssets"];
    if (
      allowed !== undefined &&
      (!Array.isArray(allowed) || allowed.some((item) => typeof item !== "string"))
    ) {
      return error(
        "allowedAssets must be an array of ticker strings.",
        400,
        "fields",
        correlationId,
      );
    }
    if (body["tradingEnabled"] !== undefined && typeof body["tradingEnabled"] !== "boolean") {
      return error("tradingEnabled must be a boolean.", 400, "fields", correlationId);
    }
    const before = await readEffectivePolicy(db);
    const minTradeUsdc = bigintField(body, "minTradeUsdc");
    const maxTradeUsdc = bigintField(body, "maxTradeUsdc");
    const dailyLimitUsdc = bigintField(body, "dailyLimitUsdc");
    const after = await writeEffectivePolicy(
      db,
      {
        ...(minTradeUsdc === undefined ? {} : { minTradeUsdc }),
        ...(maxTradeUsdc === undefined ? {} : { maxTradeUsdc }),
        ...(dailyLimitUsdc === undefined ? {} : { dailyLimitUsdc }),
        ...(allowed === undefined ? {} : { allowedAssets: allowed as string[] }),
        ...(body["tradingEnabled"] === undefined
          ? {}
          : { tradingEnabled: body["tradingEnabled"] as boolean }),
      },
      session.address,
    );
    await auditAdminAction(db, {
      adminWallet: session.address,
      action: "policy_update",
      target: "testnet-policy",
      before: {
        minTradeUsdc: before.minTradeUsdc.toString(),
        maxTradeUsdc: before.maxTradeUsdc.toString(),
        dailyLimitUsdc: before.dailyLimitUsdc.toString(),
        allowedAssets: before.allowedAssets,
        tradingEnabled: before.tradingEnabled,
      },
      after: {
        minTradeUsdc: after.minTradeUsdc.toString(),
        maxTradeUsdc: after.maxTradeUsdc.toString(),
        dailyLimitUsdc: after.dailyLimitUsdc.toString(),
        allowedAssets: after.allowedAssets,
        tradingEnabled: after.tradingEnabled,
      },
    });
    return json({
      policy: {
        minTradeUsdc: after.minTradeUsdc.toString(),
        maxTradeUsdc: after.maxTradeUsdc.toString(),
        dailyLimitUsdc: after.dailyLimitUsdc.toString(),
        allowedAssets: after.allowedAssets,
        tradingEnabled: after.tradingEnabled,
      },
    });
  } catch (err) {
    if (err instanceof Error && /must|allowlist|limit|minimum|maximum|asset/i.test(err.message)) {
      return error(err.message, 400, "invalid_policy", correlationId);
    }
    return adminErrorResponse(err, correlationId);
  }
}
