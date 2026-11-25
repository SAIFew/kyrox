import { appUsers, deleteUserData } from "@kyrox/db";
import { eq } from "drizzle-orm";

import { auditAdminAction, requireAdmin } from "@/lib/server/admin";
import { adminErrorResponse } from "@/lib/server/admin-http";
import { getAdminUserDetail } from "@/lib/server/admin-data";
import { error, evaluateSameOrigin, json, requestId } from "@/lib/server/http";
import { optionalStringField, readJsonObject } from "@/lib/server/request";

export const dynamic = "force-dynamic";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export async function GET(_req: Request, { params }: { params: Promise<{ address: string }> }) {
  const correlationId = requestId();
  try {
    const { db } = await requireAdmin("view_users");
    const { address } = await params;
    if (!ADDRESS.test(address))
      return error("Invalid wallet address.", 400, "address", correlationId);
    const detail = await getAdminUserDetail(db, address);
    if (detail === null) return error("User not found.", 404, "not_found", correlationId);
    return json(detail);
  } catch (err) {
    return adminErrorResponse(err, correlationId);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ address: string }> }) {
  const correlationId = requestId();
  try {
    if (!evaluateSameOrigin(req).allowed) {
      return error("Cross-origin request rejected.", 403, "origin", correlationId);
    }
    const { db, session } = await requireAdmin("manage_flags");
    const { address } = await params;
    if (!ADDRESS.test(address))
      return error("Invalid wallet address.", 400, "address", correlationId);
    const body = await readJsonObject(req);
    const status = optionalStringField(body, "status", { maximumLength: 16 });
    const notes = optionalStringField(body, "notes", { maximumLength: 2_000 });
    if (status !== undefined && !["active", "flagged", "banned"].includes(status)) {
      return error("status must be active, flagged, or banned.", 400, "status", correlationId);
    }
    const before = (
      await db.select().from(appUsers).where(eq(appUsers.address, address.toLowerCase())).limit(1)
    )[0];
    if (before === undefined) return error("User not found.", 404, "not_found", correlationId);
    const after = await db
      .update(appUsers)
      .set({
        ...(status === undefined ? {} : { status: status as "active" | "flagged" | "banned" }),
        ...(notes === undefined ? {} : { notes }),
        lastActiveAt: before.lastActiveAt,
      })
      .where(eq(appUsers.id, before.id))
      .returning();
    await auditAdminAction(db, {
      adminWallet: session.address,
      action: status === "flagged" ? "user_flag" : "user_update",
      target: address.toLowerCase(),
      before: { status: before.status, notes: before.notes },
      after: { status: after[0]?.status, notes: after[0]?.notes },
    });
    return json({ user: after[0] });
  } catch (err) {
    return adminErrorResponse(err, correlationId);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ address: string }> }) {
  const correlationId = requestId();
  try {
    if (!evaluateSameOrigin(req).allowed) {
      return error("Cross-origin request rejected.", 403, "origin", correlationId);
    }
    const { db, session } = await requireAdmin("manage_admins");
    const { address } = await params;
    if (!ADDRESS.test(address))
      return error("Invalid wallet address.", 400, "address", correlationId);
    const body = await readJsonObject(req);
    const confirm = optionalStringField(body, "confirm", { maximumLength: 42 });
    if (confirm?.toLowerCase() !== address.toLowerCase()) {
      return error("Type the wallet address to confirm deletion.", 400, "confirm", correlationId);
    }
    await deleteUserData(db, address);
    await auditAdminAction(db, {
      adminWallet: session.address,
      action: "user_delete",
      target: "redacted-user",
      before: { address: "[redacted]" },
      after: null,
    });
    return json({ deleted: true });
  } catch (err) {
    return adminErrorResponse(err, correlationId);
  }
}
