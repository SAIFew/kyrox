import { appEvents, type Database } from "@kyrox/db";

import { appDatabase } from "./database.js";

function serializeContext(context: unknown): string | null {
  if (context === undefined) return null;
  try {
    return JSON.stringify(context, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
  } catch {
    return "[unserializable context]";
  }
}

export async function logEvent(
  level: "info" | "warn" | "error",
  event: string,
  message: string,
  context?: unknown,
  db?: Database["db"],
): Promise<void> {
  const serializedContext = serializeContext(context);
  console[level === "info" ? "log" : level](
    JSON.stringify({
      level,
      event,
      message,
      ...(serializedContext === null ? {} : { context: serializedContext }),
    }),
  );

  try {
    if (db === undefined) {
      const url = process.env["DATABASE_URL"];
      if (url === undefined || url.trim().length === 0) return;
      db = appDatabase(url).db;
    }
    await db.insert(appEvents).values({
      level,
      event,
      message,
      context: serializedContext,
      createdAt: new Date(),
    });
  } catch {
    // Logging must never take down the request.
  }
}
