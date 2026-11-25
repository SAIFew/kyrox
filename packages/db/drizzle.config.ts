import { defineConfig } from "drizzle-kit";

/**
 * Drizzle configuration.
 *
 * Migrations are generated from `src/schema.ts`. Phase 0 contains no tables;
 * trading, price, audit, and growth tables are added only with a migration
 * review and an ADR where behaviour changes.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
  dbCredentials: {
    // Migrations must bypass transaction-poolers and use a direct connection.
    url: process.env["DIRECT_DATABASE_URL"]?.trim() || process.env["DATABASE_URL"]?.trim() || "",
  },
});
