import { ALLOWED_USER_EVENTS, insertUserEvent } from "@kyrox/db";

import { isDemoMode } from "@/lib/demo/mode";
import { appDatabase } from "@/lib/server/database";
import { getSession } from "@/lib/server/session";
import {
  clientIp,
  error,
  evaluateSameOrigin,
  json,
  rateLimit,
  requestId,
  routeError,
} from "@/lib/server/http";
import { readJsonObject, stringField } from "@/lib/server/request";

export const dynamic = "force-dynamic";

function sanitizeProps(
  value: unknown,
): Record<string, string | number | boolean | null> | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("props must be a flat object.");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 20) throw new Error("props has too many keys.");
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(key)) continue;
    if (item === null || typeof item === "boolean" || typeof item === "number") {
      clean[key] = item;
    } else if (typeof item === "string") {
      clean[key] = item.slice(0, 200);
    }
  }
  return clean;
}

export async function POST(req: Request) {
  const correlationId = requestId();
  try {
    if (!evaluateSameOrigin(req).allowed) {
      return error("Cross-origin request rejected.", 403, "origin", correlationId);
    }
    if (!rateLimit(`events:${clientIp(req)}`, 120)) {
      return error("Too many events.", 429, "rate_limited", correlationId);
    }
    const body = await readJsonObject(req);
    const name = stringField(body, "name", { maximumLength: 64 });
    if (!ALLOWED_USER_EVENTS.has(name)) {
      return error("Unknown event name.", 400, "event", correlationId);
    }
    let props: ReturnType<typeof sanitizeProps>;
    try {
      props = sanitizeProps(body["props"]);
    } catch (err) {
      return error(
        err instanceof Error ? err.message : "Invalid props.",
        400,
        "props",
        correlationId,
      );
    }

    if (isDemoMode()) {
      return json({ recorded: false, mode: "demo" }, 202);
    }
    const session = await getSession();
    const db = appDatabase().db;
    await insertUserEvent(db, {
      name,
      props,
      ...(session === null ? {} : { address: session.address }),
    });
    return json({ recorded: true }, 202);
  } catch (err) {
    return routeError(err, "event_unavailable", correlationId);
  }
}
