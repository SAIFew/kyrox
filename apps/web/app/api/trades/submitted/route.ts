import { isHex } from "viem";

import { environment } from "@/lib/server/store-singleton";
import { authStore } from "@/lib/server/store-singleton";
import { error, json, sameOrigin, sessionFromCookies } from "@/lib/server/http";
import { recordSubmitted } from "@/lib/server/activity";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return error("Cross-origin request rejected.", 403, "origin");
  const session = await sessionFromCookies(authStore());
  if (session === null) return error("Authentication required.", 401, "auth");
  const body = (await req.json()) as { intentId?: string; txHash?: string };
  if (typeof body.intentId !== "string" || !isHex(body.txHash)) {
    return error("intentId and a transaction hash are required.", 400, "fields");
  }
  try {
    await recordSubmitted(
      environment(),
      body.intentId,
      body.txHash as `0x${string}`,
      session.address as `0x${string}`,
    );
    return json({ ok: true });
  } catch (err) {
    return error(
      err instanceof Error ? err.message : "Submission could not be verified.",
      400,
      "submitted",
    );
  }
}
