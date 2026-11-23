import { isDemoMode } from "@/lib/demo/mode";
import { demoActivity, readDemoSession } from "@/lib/demo/session";
import { getSession } from "@/lib/server/session";
import { error, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (session === null) return error("Authentication required.", 401, "auth");

  if (isDemoMode()) {
    const demo = await readDemoSession();
    if (demo === null) return error("Session expired. Start again.", 401, "auth");
    return json({ activity: demoActivity(demo), simulated: true });
  }

  const { environment } = await import("@/lib/server/store-singleton");
  const { activityFor } = await import("@/lib/server/activity");
  return json({
    activity: await activityFor(environment(), session.address as `0x${string}`),
    simulated: false,
  });
}
