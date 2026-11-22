import { authStore } from "@/lib/server/store-singleton";
import { sessionFromCookies } from "@/lib/server/http";

export async function GET() {
  const session = await sessionFromCookies(authStore());
  return Response.json({
    session: session ? { address: session.address, expiresAt: session.expiresAt } : null,
  });
}

export async function DELETE() {
  const store = authStore();
  const cookieStore = await import("next/headers").then((m) => m.cookies());
  const token = cookieStore.get("kyrox_session")?.value;
  if (token !== undefined) {
    const { hashSessionToken } = await import("../../../../lib/server/auth.js");
    await store.deleteSession(hashSessionToken(token));
  }
  const response = Response.json({ ok: true });
  response.headers.append(
    "Set-Cookie",
    "kyrox_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
  );
  return response;
}
