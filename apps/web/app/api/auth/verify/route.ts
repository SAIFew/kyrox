import { isHex } from "viem";

import { authStore } from "@/lib/server/store-singleton";
import { AuthError, verifyAuthentication } from "@/lib/server/auth";
import { clientIp, error, json, rateLimit, sameOrigin } from "@/lib/server/http";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return error("Cross-origin request rejected.", 403, "origin");
  if (!rateLimit(`verify:${clientIp(req)}`, 10))
    return error("Too many authentication attempts.", 429, "rate_limited");

  let body: { message?: string; signature?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return error("Malformed JSON body.", 400, "bad_json");
  }
  if (typeof body.message !== "string" || !isHex(body.signature)) {
    return error("Message and hex signature are required.", 400, "fields");
  }

  try {
    const result = await verifyAuthentication(
      authStore(),
      body.message,
      body.signature as `0x${string}`,
    );
    const response = json({ authenticated: true, address: result.address });
    response.headers.append(
      "Set-Cookie",
      `kyrox_session=${result.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
    );
    return response;
  } catch (errorValue) {
    if (errorValue instanceof AuthError) {
      const { logEvent } = await import("@/lib/server/observability");
      await logEvent("warn", "auth_failure", errorValue.code);
      return error(errorValue.message, 401, errorValue.code);
    }
    throw errorValue;
  }
}
