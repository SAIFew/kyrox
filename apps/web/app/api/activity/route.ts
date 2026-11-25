import { isDemoMode } from "@/lib/demo/mode";
import { demoActivity, readDemoSession } from "@/lib/demo/session";
import { environment } from "@/lib/server/store-singleton";
import { activityPageFor } from "@/lib/server/activity";
import { getSession } from "@/lib/server/session";
import { clientIp, error, json, rateLimit, routeError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (session === null) return error("Authentication required.", 401, "auth");

    if (isDemoMode()) {
      const demo = await readDemoSession();
      if (demo === null) return error("Session expired. Start again.", 401, "auth");
      return json({ activity: demoActivity(demo), simulated: true, stale: false });
    }

    if (!rateLimit(`activity:${session.address}:${clientIp(req)}`, 12)) {
      return error("Too many activity requests.", 429, "rate_limited");
    }
    const env = environment();
    const result = await activityPageFor(env, session.address);
    return json({
      activity: result.activity,
      simulated: env.mode === "local-anvil",
      stale: result.stale,
    });
  } catch (err) {
    return routeError(err, "activity_unavailable");
  }
}
