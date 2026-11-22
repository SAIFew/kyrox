import { environment } from "@/lib/server/store-singleton";
import { authStore } from "@/lib/server/store-singleton";
import { error, json, sessionFromCookies } from "@/lib/server/http";
import { activityFor } from "@/lib/server/activity";

export async function GET() {
  const session = await sessionFromCookies(authStore());
  if (session === null) return error("Authentication required.", 401, "auth");
  return json({ activity: await activityFor(environment(), session.address as `0x${string}`) });
}
