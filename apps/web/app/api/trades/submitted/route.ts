import { isHex } from "viem";

import { isDemoMode } from "@/lib/demo/mode";
import { getSession } from "@/lib/server/session";
import { error, json, sameOrigin } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return error("Cross-origin request rejected.", 403, "origin");
  const session = await getSession();
  if (session === null) return error("Authentication required.", 401, "auth");
  if (isDemoMode()) {
    return error("Simulated fills never carry a transaction hash.", 400, "simulated_venue");
  }
  const body = (await req.json()) as { intentId?: string; txHash?: string };
  if (typeof body.intentId !== "string" || !isHex(body.txHash)) {
    return error("intentId and a transaction hash are required.", 400, "fields");
  }
  const { environment } = await import("@/lib/server/store-singleton");
  const { recordSubmitted } = await import("@/lib/server/activity");
  try {
    await recordSubmitted(
      environment(),
      body.intentId,
      body.txHash as `0x${string}`,
      session.address,
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
