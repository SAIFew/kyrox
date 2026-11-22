import { createDatabase } from "@kyrox/db";

export async function logEvent(
  level: "info" | "warn" | "error",
  event: string,
  message: string,
  context?: unknown,
): Promise<void> {
  console[level === "info" ? "log" : level](JSON.stringify({ level, event, message }));
  const url = process.env["DATABASE_URL"];
  if (url === undefined) return;
  const db = createDatabase(url);
  try {
    const { appEvents } = await import("@kyrox/db");
    await db.db.insert(appEvents).values({
      level,
      event,
      message,
      context: context === undefined ? null : JSON.stringify(context),
      createdAt: new Date(),
    });
  } catch {
    // Logging must never take down the request.
  } finally {
    await db.pool.end();
  }
}
