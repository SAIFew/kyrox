import { insertUserEvent } from "@kyrox/db";

import { isDemoMode } from "../demo/mode.js";
import { appDatabase } from "./database.js";

/**
 * Best-effort product analytics. A logging failure must never break a quote or
 * a trade, so errors are swallowed after being logged to the process stream.
 */
export async function recordProductEvent(
  address: string | null,
  name: string,
  props?: Record<string, string | number | boolean | null>,
): Promise<void> {
  if (isDemoMode()) return;
  try {
    await insertUserEvent(appDatabase().db, {
      name,
      props,
      ...(address === null ? {} : { address }),
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "analytics_write_failed",
        name,
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
  }
}
