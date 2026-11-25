import { requireAdmin } from "@/lib/server/admin";
import { adminErrorResponse, queryParam } from "@/lib/server/admin-http";
import { listAdminUsers } from "@/lib/server/admin-data";
import { json, requestId } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const correlationId = requestId();
  try {
    const { db } = await requireAdmin("view_users");
    const query = queryParam(req, "q");
    const status = queryParam(req, "status");
    const users = await listAdminUsers(db, {
      ...(query === null ? {} : { query }),
      ...(status === null ? {} : { status }),
    });
    return json({ users });
  } catch (err) {
    return adminErrorResponse(err, correlationId);
  }
}
