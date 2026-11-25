import { cookies } from "next/headers";
import { verifyMessage } from "viem";

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
import {
  assertAuthenticationOrigin,
  parseAuthenticationMessage,
  AuthError,
  verifyAuthentication,
} from "@/lib/server/auth";
import {
  clientIp,
  error,
  evaluateSameOrigin,
  json,
  rateLimit,
  requestId,
  routeError,
} from "@/lib/server/http";
import { authStore } from "@/lib/server/store-singleton";
import { appDatabase } from "@/lib/server/database";
import {
  readJsonObject,
  optionalStringField,
  signatureField,
  stringField,
} from "@/lib/server/request";
import { hashIpAddress, insertUserEvent, upsertAppUser } from "@kyrox/db";

interface DemoNonce {
  n: string;
  a: string;
  exp: number;
}

export async function POST(req: Request) {
  const correlationId = requestId();
  try {
    const { origin, allowed } = evaluateSameOrigin(req);
    if (!allowed) {
      return error("Cross-origin request rejected.", 403, "origin", correlationId);
    }
    if (!rateLimit(`verify:${clientIp(req)}`, 10)) {
      return error("Too many authentication attempts.", 429, "rate_limited", correlationId);
    }
    const body = await readJsonObject(req);
    const message = stringField(body, "message", { maximumLength: 4_096 });
    const signature = signatureField(body);

    if (isDemoMode()) {
      const store = await cookies();
      const nonce = unseal<DemoNonce>(store.get(DEMO_NONCE_COOKIE)?.value);
      if (nonce === null || nonce.exp < Math.floor(Date.now() / 1_000)) {
        return error(
          "Sign-in challenge expired. Start again.",
          401,
          "NONCE_EXPIRED",
          correlationId,
        );
      }
      let parsed: ReturnType<typeof parseAuthenticationMessage>;
      try {
        parsed = parseAuthenticationMessage(message);
        assertAuthenticationOrigin(parsed, origin);
      } catch (err) {
        return error(
          err instanceof Error ? err.message : "Invalid message.",
          401,
          err instanceof AuthError ? err.code : "INVALID_MESSAGE",
          correlationId,
        );
      }
      if (parsed.nonce !== nonce.n || parsed.address.toLowerCase() !== nonce.a) {
        return error(
          "Challenge does not match this wallet.",
          401,
          "ADDRESS_MISMATCH",
          correlationId,
        );
      }
      const valid = await verifyMessage({
        address: parsed.address,
        message,
        signature,
      }).catch(() => false);
      if (!valid) {
        return error("Signature verification failed.", 401, "SIGNATURE_INVALID", correlationId);
      }

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
        message,
        signature,
        new Date(),
        origin,
      );
      const store = await cookies();
      const referralCode = store.get("kyrox_ref")?.value ?? null;
      const signupSource = optionalStringField(body, "source", { maximumLength: 64 }) ?? null;
      const db = appDatabase().db;
      const user = await upsertAppUser(db, {
        address: result.address,
        referredByCode: referralCode,
        signupSource,
        signupIpHash: hashIpAddress(clientIp(req), process.env["AUTH_SECRET"] ?? "kyrox"),
      });
      await insertUserEvent(db, {
        userId: user.id,
        address: result.address,
        name: "signup",
        props: { source: signupSource, referredBy: user.referredBy },
      }).catch(async () => {
        const { logEvent } = await import("@/lib/server/observability");
        await logEvent("warn", "signup_event_failed", "Could not record signup event.");
      });
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
        return error(errorValue.message, 401, errorValue.code, correlationId);
      }
      throw errorValue;
    }
  } catch (err) {
    return routeError(err, "verification_unavailable", correlationId);
  }
}
