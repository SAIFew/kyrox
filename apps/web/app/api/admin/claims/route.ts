import { requireAdmin } from "@/lib/server/admin";
import { adminErrorResponse } from "@/lib/server/admin-http";
import { listAdminClaims } from "@/lib/server/admin-data";
import { json, requestId } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const correlationId = requestId();
  try {
    const { db } = await requireAdmin("view_metrics");
    return json({ claims: await listAdminClaims(db) });
  } catch (err) {
    return adminErrorResponse(err, correlationId);
  }
}
