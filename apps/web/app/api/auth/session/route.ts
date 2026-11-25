import { clearDemoSession } from "@/lib/demo/session";
import { isDemoMode } from "@/lib/demo/mode";
import { environmentInfo, getSession, toSessionPayload } from "@/lib/server/session";
import { authStore } from "@/lib/server/store-singleton";
import { hashSessionToken } from "@/lib/server/auth";
import { error, evaluateSameOrigin, json, requestId, routeError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const correlationId = requestId();
  try {
    const session = await getSession();
    return json({
      session: toSessionPayload(session),
      environment: environmentInfo(),
    });
  } catch (err) {
    return routeError(err, "session_unavailable", correlationId);
  }
}

export async function DELETE(req: Request) {
  const correlationId = requestId();
  try {
    if (!evaluateSameOrigin(req).allowed) {
      return error("Cross-origin request rejected.", 403, "origin", correlationId);
    }
    const storeCookies = await import("next/headers").then((module) => module.cookies());
    if (isDemoMode()) {
      await clearDemoSession();
    } else {
      const token = storeCookies.get("kyrox_session")?.value;
      if (token !== undefined) await authStore().deleteSession(hashSessionToken(token));
    }
    storeCookies.set("kyrox_session", "", { httpOnly: true, path: "/", maxAge: 0 });
    return json({ ok: true });
  } catch (err) {
    return routeError(err, "session_unavailable", correlationId);
  }
}
