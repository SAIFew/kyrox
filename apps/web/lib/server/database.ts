import { createDatabase, type Database } from "@kyrox/db";

import { loadEnvironment } from "./env.js";

interface DatabaseState {
  readonly url: string;
  readonly database: Database;
}

const globalForDatabase = globalThis as typeof globalThis & {
  __kyroxWebDatabase?: DatabaseState;
};

/**
 * Process-scoped database ownership for the long-running Next.js server.
 *
 * One pool is reused across API requests and preserved on `globalThis` so
 * development reloads do not create duplicate pools. CLI scripts and tests that
 * need an isolated lifecycle call `createDatabase()` directly and close it.
 */
export function appDatabase(databaseUrl?: string): Database {
  const url = databaseUrl ?? loadEnvironment().databaseUrl;
  const existing = globalForDatabase.__kyroxWebDatabase;

  if (existing !== undefined) {
    if (existing.url !== url) {
      throw new Error("The process database is already bound to a different connection.");
    }
    return existing.database;
  }

  const database = createDatabase(url);
  globalForDatabase.__kyroxWebDatabase = { url, database };
  return database;
}

/** Close the shared pool. Intended for tests and graceful process shutdown. */
export async function closeAppDatabase(): Promise<void> {
  const existing = globalForDatabase.__kyroxWebDatabase;
  if (existing === undefined) return;
  delete globalForDatabase.__kyroxWebDatabase;
  await existing.database.pool.end();
}
