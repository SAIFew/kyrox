import { clearDemoSession } from "@/lib/demo/session";
import { isDemoMode } from "@/lib/demo/mode";
import { environmentInfo, getSession, toSessionPayload } from "@/lib/server/session";
import { authStore } from "@/lib/server/store-singleton";
import { hashSessionToken } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  return Response.json({
    session: toSessionPayload(session),
    environment: environmentInfo(),
  });
}

export async function DELETE() {
  const storeCookies = await import("next/headers").then((module) => module.cookies());

  if (isDemoMode()) {
    await clearDemoSession();
  } else {
    const token = storeCookies.get("kyrox_session")?.value;
    if (token !== undefined) {
      await authStore().deleteSession(hashSessionToken(token));
    }
  }
  storeCookies.set("kyrox_session", "", { httpOnly: true, path: "/", maxAge: 0 });
  return Response.json({ ok: true });
}
