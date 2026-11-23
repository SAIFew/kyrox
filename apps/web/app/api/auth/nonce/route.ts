import { randomBytes } from "node:crypto";

import { isAddress } from "viem";

import { authenticationMessage } from "@/lib/server/auth";
import { clientIp, error, json, rateLimit, sameOrigin } from "@/lib/server/http";
import { DEMO_NONCE_COOKIE, seal } from "@/lib/demo/session";
import { isDemoMode } from "@/lib/demo/mode";
import { authStore } from "@/lib/server/store-singleton";
import { issueNonce } from "@/lib/server/auth";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return error("Cross-origin request rejected.", 403, "origin");
  if (!rateLimit(`nonce:${clientIp(req)}`, 8))
    return error("Too many authentication attempts.", 429, "rate_limited");

  let address: string | undefined;
  try {
    const body = (await req.json()) as { address?: string };
    address = body.address;
  } catch {
    return error("Malformed JSON body.", 400, "bad_json");
  }
  if (!isAddress(address ?? ""))
    return error("A valid wallet address is required.", 400, "address");
  const wallet = address as `0x${string}`;

  if (isDemoMode()) {
    const nonce = randomBytes(16).toString("hex");
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 300_000);
    const origin = new URL(req.url);
    const message = authenticationMessage({
      address: wallet,
      nonce,
      issuedAt: issuedAt.toISOString(),
      expirationTime: expiresAt.toISOString(),
      host: origin.host,
      uri: `${origin.origin}/auth`,
    });
    const response = json({ message, demo: true });
    response.headers.append(
      "Set-Cookie",
      `${DEMO_NONCE_COOKIE}=${seal({ n: nonce, a: wallet.toLowerCase(), exp: Math.floor(expiresAt.getTime() / 1_000) })}; HttpOnly; SameSite=Lax; Path=/; Max-Age=300${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
    );
    return response;
  }

  const message = await issueNonce(authStore(), wallet.toLowerCase());
  return json({ message });
}
