import { createDatabase } from "@kyrox/db";

let pool: ReturnType<typeof createDatabase> | undefined;

export function db(): ReturnType<typeof createDatabase> {
  if (pool === undefined) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required.");
    pool = createDatabase(url);
  }
  return pool;
}
