import { feedbackEntries } from "@kyrox/db";
import { eq } from "drizzle-orm";

import { auditAdminAction, requireAdmin } from "@/lib/server/admin";
import { adminErrorResponse } from "@/lib/server/admin-http";
import { listAdminFeedback } from "@/lib/server/admin-data";
import { error, evaluateSameOrigin, json, requestId } from "@/lib/server/http";
import { readJsonObject, stringField } from "@/lib/server/request";

export const dynamic = "force-dynamic";

export async function GET() {
  const correlationId = requestId();
  try {
    const { db } = await requireAdmin("manage_feedback");
    return json({ feedback: await listAdminFeedback(db) });
  } catch (err) {
    return adminErrorResponse(err, correlationId);
  }
}

export async function PATCH(req: Request) {
  const correlationId = requestId();
  try {
    if (!evaluateSameOrigin(req).allowed) {
      return error("Cross-origin request rejected.", 403, "origin", correlationId);
    }
    const { db, session } = await requireAdmin("manage_feedback");
    const body = await readJsonObject(req);
    const id = Number(stringField(body, "id", { maximumLength: 16 }));
    const status = stringField(body, "status", { maximumLength: 16 });
    if (!Number.isSafeInteger(id) || id <= 0)
      return error("Invalid feedback id.", 400, "id", correlationId);
    if (!["new", "reviewed", "closed"].includes(status)) {
      return error("Invalid feedback status.", 400, "status", correlationId);
    }
    const before = (await db.select().from(feedbackEntries).where(eq(feedbackEntries.id, id)))[0];
    if (before === undefined) return error("Feedback not found.", 404, "not_found", correlationId);
    const after = await db
      .update(feedbackEntries)
      .set({ status: status as "new" | "reviewed" | "closed" })
      .where(eq(feedbackEntries.id, id))
      .returning();
    await auditAdminAction(db, {
      adminWallet: session.address,
      action: "feedback_status",
      target: String(id),
      before: { status: before.status },
      after: { status: after[0]?.status },
    });
    return json({ feedback: after[0] });
  } catch (err) {
    return adminErrorResponse(err, correlationId);
  }
}
