import { isDemoMode } from "@/lib/demo/mode";
import { demoPortfolio, readDemoSession } from "@/lib/demo/session";
import { environmentInfo, getSession } from "@/lib/server/session";
import { error, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (session === null) return error("Authentication required.", 401, "auth");

  if (isDemoMode()) {
    const demo = await readDemoSession();
    if (demo === null) return error("Session expired. Start again.", 401, "auth");
    return json({
      portfolio: demoPortfolio(demo),
      environment: environmentInfo(),
      simulated: true,
    });
  }

  const { environment } = await import("@/lib/server/store-singleton");
  const { portfolioFor } = await import("@/lib/server/portfolio");
  try {
    return json({
      portfolio: await portfolioFor(environment(), session.address),
      environment: environmentInfo(),
      simulated: false,
    });
  } catch (err) {
    const { logEvent } = await import("@/lib/server/observability");
    await logEvent("error", "portfolio_api", err instanceof Error ? err.message : "unavailable");
    return error(err instanceof Error ? err.message : "Portfolio unavailable.", 503, "unavailable");
  }
}
