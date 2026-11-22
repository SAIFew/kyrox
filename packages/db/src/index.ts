import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.js";

export type Database = ReturnType<typeof createDatabase>;

/**
 * Create a PostgreSQL connection pool and Drizzle client.
 *
 * Callers own the returned pool and must close it during shutdown. The
 * connection string must come from the server-side environment, never from a
 * `NEXT_PUBLIC_` variable.
 */
export function createDatabase(connectionString: string) {
  if (!connectionString.trim()) {
    throw new Error("DATABASE_URL is required to create a database connection.");
  }

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  return { db, pool };
}

export { schema };
export {
  appEvents,
  authNonces,
  authSessions,
  issuedQuotes,
  priceIngestionEvents,
  priceObservations,
  pricePublicationTransitions,
  pricePublications,
  tradeIntents,
} from "./schema.js";
export type {
  NewPriceIngestionEventRow,
  NewPriceObservationRow,
  NewPricePublicationRow,
  NewPricePublicationTransitionRow,
  PriceIngestionEventRow,
  PriceObservationRow,
  PricePublicationRow,
  PricePublicationTransitionRow,
} from "./schema.js";
