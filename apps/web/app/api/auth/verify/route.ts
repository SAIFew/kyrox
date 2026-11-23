import { cookies } from "next/headers";
import { isHex, verifyMessage } from "viem";

import {
  DEMO_NONCE_COOKIE,
  DEMO_SESSION_TTL_SECONDS,
  defaultDemoLedger,
  encodeDemoSession,
  readDemoSession,
  unseal,
  DEMO_COOKIE,
  type DemoSession,
} from "@/lib/demo/session";
import { isDemoMode } from "@/lib/demo/mode";
import { parseAuthenticationMessage, AuthError, verifyAuthentication } from "@/lib/server/auth";
import { clientIp, error, json, rateLimit, sameOrigin } from "@/lib/server/http";
import { authStore } from "@/lib/server/store-singleton";

interface DemoNonce {
  n: string;
  a: string;
  exp: number;
}

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

  if (isDemoMode()) {
    const store = await cookies();
    const nonce = unseal<DemoNonce>(store.get(DEMO_NONCE_COOKIE)?.value);
    if (nonce === null) {
      return error("Sign-in challenge expired. Start again.", 401, "NONCE_EXPIRED");
    }
    if (nonce.exp < Math.floor(Date.now() / 1_000)) {
      return error("Sign-in challenge expired. Start again.", 401, "NONCE_EXPIRED");
    }
    let parsed;
    try {
      parsed = parseAuthenticationMessage(body.message);
    } catch (err) {
      return error(err instanceof Error ? err.message : "Invalid message.", 401, "INVALID_MESSAGE");
    }
    if (parsed.nonce !== nonce.n || parsed.address.toLowerCase() !== nonce.a) {
      return error("Challenge does not match this wallet.", 401, "ADDRESS_MISMATCH");
    }
    const valid = await verifyMessage({
      address: parsed.address,
      message: body.message,
      signature: body.signature,
    }).catch(() => false);
    if (!valid) return error("Signature verification failed.", 401, "SIGNATURE_INVALID");

    const existing = await readDemoSession();
    const session: DemoSession = {
      address: parsed.address,
      expiresAt: Math.floor(Date.now() / 1_000) + DEMO_SESSION_TTL_SECONDS,
      demo: true,
      ledger: existing?.ledger ?? defaultDemoLedger(),
    };
    const response = json({
      authenticated: true,
      address: session.address,
      demo: true,
      simulatedPortfolio: true,
    });
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    response.headers.append(
      "Set-Cookie",
      `${DEMO_COOKIE}=${encodeDemoSession(session)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DEMO_SESSION_TTL_SECONDS}${secure}`,
    );
    response.headers.append(
      "Set-Cookie",
      `${DEMO_NONCE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`,
    );
    return response;
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
