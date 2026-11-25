import { demoSecret } from "@/lib/demo/session";
import { isDemoMode } from "@/lib/demo/mode";
import { appDatabase } from "@/lib/server/database";
import { error, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const READINESS_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("readiness timeout")), timeoutMs);
    timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause: unknown) => {
        clearTimeout(timer);
        reject(cause);
      },
    );
  });
}

/**
 * Readiness: preview mode needs only a valid signed-session secret and no
 * database/RPC. Live mode requires the process pool to complete a bounded
 * `SELECT 1`. Failures are generic and never echo configuration or driver text.
 */
export async function GET() {
  try {
    if (isDemoMode()) {
      demoSecret();
    } else {
      const database = appDatabase();
      await withTimeout(database.pool.query("SELECT 1"), READINESS_TIMEOUT_MS);
    }
    const response = json({ status: "ready" });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return error("Service is not ready.", 503, "unavailable");
  }
}
