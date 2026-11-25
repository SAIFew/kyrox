import { isDemoMode } from "@/lib/demo/mode";
import { demoPortfolio, readDemoSession } from "@/lib/demo/session";
import { environment } from "@/lib/server/store-singleton";
import { portfolioFor, portfolioPayload } from "@/lib/server/portfolio";
import { environmentInfo, getSession } from "@/lib/server/session";
import { clientIp, error, json, rateLimit, routeError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
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

    if (!rateLimit(`portfolio:${session.address}:${clientIp(req)}`, 30)) {
      return error("Too many portfolio requests.", 429, "rate_limited");
    }
    const env = environment();
    const portfolio = await portfolioFor(env, session.address);
    const payload = portfolioPayload(env, portfolio);
    return json({
      portfolio: payload,
      environment: environmentInfo(env),
      simulated: payload.simulated,
    });
  } catch (err) {
    return routeError(err, "portfolio_unavailable");
  }
}
