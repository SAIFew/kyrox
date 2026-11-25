import { isDemoMode } from "@/lib/demo/mode";
import { environmentInfo } from "@/lib/server/session";
import { json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Liveness only: configuration and dependency probes belong to /api/status. */
export async function GET() {
  const demo = isDemoMode();
  let environment: ReturnType<typeof environmentInfo> | null = null;
  if (demo) {
    environment = environmentInfo();
  } else {
    try {
      environment = environmentInfo();
    } catch {
      // A broken deployment must not make the web process fail its liveness check.
    }
  }
  return json({
    ok: true,
    service: "kyrox-web",
    mode: demo ? "demo" : "live",
    environment,
    configuration: environment === null ? "unavailable" : "resolved",
    now: new Date().toISOString(),
  });
}
