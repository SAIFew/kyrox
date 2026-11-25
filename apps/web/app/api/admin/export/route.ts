import { appUsers, indexedTrades } from "@kyrox/db";
import { desc, sql } from "drizzle-orm";

import { getAdminContext, roleCan } from "@/lib/server/admin";
import { adminErrorResponse, queryParam } from "@/lib/server/admin-http";
import { error, requestId } from "@/lib/server/http";

export const dynamic = "force-dynamic";

function csvValue(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [headers, ...rows].map((row) => row.map(csvValue).join(",")).join("\n") + "\n";
}

export async function GET(req: Request) {
  const correlationId = requestId();
  try {
    const { db, role } = await getAdminContext();
    if (!roleCan(role, "export_csv") && !roleCan(role, "export_without_emails")) {
      return error("Your admin role cannot export data.", 403, "ADMIN_FORBIDDEN", correlationId);
    }
    const kind = queryParam(req, "type") ?? "users";
    const includeEmail = roleCan(role, "view_emails") && roleCan(role, "export_csv");

    if (kind === "trades") {
      const trades = await db.select().from(indexedTrades).orderBy(desc(indexedTrades.blockTime));
      const csv = toCsv(
        [
          "tx_hash",
          "block_time",
          "wallet",
          "asset",
          "side",
          "usdc_amount",
          "stock_amount",
          "price",
        ],
        trades.map((trade) => [
          trade.txHash,
          trade.blockTime.toISOString(),
          trade.userAddress,
          trade.assetSymbol,
          trade.side,
          trade.usdcAmount,
          trade.stockAmount,
          trade.priceUsdcPerWholeToken,
        ]),
      );
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="kyrox-trades.csv"',
          "Cache-Control": "no-store",
        },
      });
    }

    if (kind !== "users") return error("type must be users or trades.", 400, "type", correlationId);

    const users = await db
      .select({
        id: appUsers.id,
        address: appUsers.address,
        email: appUsers.email,
        referralCode: appUsers.referralCode,
        referredBy: appUsers.referredBy,
        signupSource: appUsers.signupSource,
        status: appUsers.status,
        createdAt: appUsers.createdAt,
        lastActiveAt: appUsers.lastActiveAt,
        trades: sql<number>`(select count(*)::int from ${indexedTrades} where ${indexedTrades.userAddress} = ${appUsers.address})`,
      })
      .from(appUsers)
      .orderBy(desc(appUsers.createdAt));

    const csv = toCsv(
      [
        "id",
        "wallet",
        "email",
        "referral_code",
        "referred_by",
        "source",
        "status",
        "trades",
        "created_at",
        "last_active",
      ],
      users.map((user) => [
        user.id,
        user.address,
        includeEmail ? user.email : "",
        user.referralCode,
        user.referredBy,
        user.signupSource,
        user.status,
        user.trades,
        user.createdAt.toISOString(),
        user.lastActiveAt.toISOString(),
      ]),
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="kyrox-users.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return adminErrorResponse(err, correlationId);
  }
}
