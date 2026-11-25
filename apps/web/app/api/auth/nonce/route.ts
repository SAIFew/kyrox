import { randomBytes } from "node:crypto";

import { isAddress } from "viem";

import { authenticationMessage, issueNonce } from "@/lib/server/auth";
import { DEMO_NONCE_COOKIE, seal } from "@/lib/demo/session";
import { isDemoMode } from "@/lib/demo/mode";
import {
  clientIp,
  error,
  evaluateSameOrigin,
  json,
  rateLimit,
  requestId,
  routeError,
} from "@/lib/server/http";
import { siweOriginValues } from "@/lib/server/origin";
import { readJsonObject, stringField } from "@/lib/server/request";
import { authStore } from "@/lib/server/store-singleton";

export async function POST(req: Request) {
  const correlationId = requestId();
  try {
    const { origin, allowed } = evaluateSameOrigin(req);
    if (!allowed) {
      return error("Cross-origin request rejected.", 403, "origin", correlationId);
    }
    if (!rateLimit(`nonce:${clientIp(req)}`, 8)) {
      return error("Too many authentication attempts.", 429, "rate_limited", correlationId);
    }
    const body = await readJsonObject(req);
    const address = stringField(body, "address", { maximumLength: 42 });
    if (!isAddress(address)) {
      return error("A valid wallet address is required.", 400, "address", correlationId);
    }
    const wallet = address as `0x${string}`;

    if (isDemoMode()) {
      const nonce = randomBytes(16).toString("hex");
      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + 300_000);
      const siwe = siweOriginValues(origin);
      const message = authenticationMessage({
        address: wallet,
        nonce,
        issuedAt: issuedAt.toISOString(),
        expirationTime: expiresAt.toISOString(),
        host: siwe.host,
        uri: siwe.uri,
      });
      const response = json({ message, demo: true });
      response.headers.append(
        "Set-Cookie",
        `${DEMO_NONCE_COOKIE}=${seal({ n: nonce, a: wallet.toLowerCase(), exp: Math.floor(expiresAt.getTime() / 1_000) })}; HttpOnly; SameSite=Lax; Path=/; Max-Age=300${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
      );
      return response;
    }

    const message = await issueNonce(authStore(), wallet.toLowerCase(), new Date(), origin);
    return json({ message });
  } catch (err) {
    return routeError(err, "nonce_unavailable", correlationId);
  }
}
