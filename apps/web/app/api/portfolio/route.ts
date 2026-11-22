import { environment } from "@/lib/server/store-singleton";
import { authStore } from "@/lib/server/store-singleton";
import { logEvent } from "@/lib/server/observability";
import { error, json, sessionFromCookies } from "@/lib/server/http";
import { portfolioFor } from "@/lib/server/portfolio";

export async function GET() {
  const session = await sessionFromCookies(authStore());
  if (session === null) return error("Authentication required.", 401, "auth");
  try {
    return json(await portfolioFor(environment(), session.address as `0x${string}`));
  } catch (err) {
    await logEvent("error", "portfolio_api", err instanceof Error ? err.message : "unavailable");
    return error(err instanceof Error ? err.message : "Portfolio unavailable.", 503, "unavailable");
  }
}
