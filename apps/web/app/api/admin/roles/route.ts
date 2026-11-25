import { adminRoles } from "@kyrox/db";
import { eq, sql } from "drizzle-orm";

import { auditAdminAction, requireAdmin, type AdminRole } from "@/lib/server/admin";
import { adminErrorResponse } from "@/lib/server/admin-http";
import { error, evaluateSameOrigin, json, requestId } from "@/lib/server/http";
import { readJsonObject, stringField } from "@/lib/server/request";

export const dynamic = "force-dynamic";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ROLES: readonly AdminRole[] = ["owner", "admin", "analyst", "support"];

export async function GET() {
  const correlationId = requestId();
  try {
    const { db } = await requireAdmin("manage_admins");
    return json({ roles: await db.select().from(adminRoles) });
  } catch (err) {
    return adminErrorResponse(err, correlationId);
  }
}

export async function POST(req: Request) {
  const correlationId = requestId();
  try {
    if (!evaluateSameOrigin(req).allowed) {
      return error("Cross-origin request rejected.", 403, "origin", correlationId);
    }
    const { db, session } = await requireAdmin("manage_admins");
    const body = await readJsonObject(req);
    const wallet = stringField(body, "wallet", { maximumLength: 42 }).toLowerCase();
    const role = stringField(body, "role", { maximumLength: 16 }) as AdminRole;
    if (!ADDRESS.test(wallet))
      return error("Invalid wallet address.", 400, "wallet", correlationId);
    if (!ROLES.includes(role)) return error("Invalid admin role.", 400, "role", correlationId);
    const before =
      (await db.select().from(adminRoles).where(eq(adminRoles.wallet, wallet)))[0] ?? null;
    await db
      .insert(adminRoles)
      .values({ wallet, role, addedBy: session.address.toLowerCase(), createdAt: new Date() })
      .onConflictDoUpdate({
        target: adminRoles.wallet,
        set: { role, addedBy: session.address.toLowerCase() },
      });
    await auditAdminAction(db, {
      adminWallet: session.address,
      action: before === null ? "admin_add" : "admin_role_change",
      target: wallet,
      before,
      after: { wallet, role },
    });
    return json({ role: { wallet, role } });
  } catch (err) {
    return adminErrorResponse(err, correlationId);
  }
}

export async function DELETE(req: Request) {
  const correlationId = requestId();
  try {
    const { db, session } = await requireAdmin("manage_admins");
    const body = await readJsonObject(req);
    const wallet = stringField(body, "wallet", { maximumLength: 42 }).toLowerCase();
    if (!ADDRESS.test(wallet))
      return error("Invalid wallet address.", 400, "wallet", correlationId);
    const before =
      (await db.select().from(adminRoles).where(eq(adminRoles.wallet, wallet)))[0] ?? null;
    if (before === null) return error("Admin not found.", 404, "not_found", correlationId);
    if (before.role === "owner") {
      const owners = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(adminRoles)
        .where(eq(adminRoles.role, "owner"));
      if ((owners[0]?.count ?? 0) <= 1) {
        return error("At least one owner must remain.", 409, "last_owner", correlationId);
      }
    }
    await db.delete(adminRoles).where(eq(adminRoles.wallet, wallet));
    await auditAdminAction(db, {
      adminWallet: session.address,
      action: "admin_remove",
      target: wallet,
      before,
      after: null,
    });
    return json({ removed: wallet });
  } catch (err) {
    return adminErrorResponse(err, correlationId);
  }
}
