import { requireAdmin } from "@/lib/server/admin";
import { adminErrorResponse } from "@/lib/server/admin-http";
import { analyticsCounts, listAdminErrors } from "@/lib/server/admin-data";
import { json, requestId } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const correlationId = requestId();
  try {
    const { db } = await requireAdmin("view_metrics");
    const since = new Date(Date.now() - 7 * 24 * 3_600_000);
    const [events, errors] = await Promise.all([analyticsCounts(db, since), listAdminErrors(db)]);
    return json({ events, errors });
  } catch (err) {
    return adminErrorResponse(err, correlationId);
  }
}
