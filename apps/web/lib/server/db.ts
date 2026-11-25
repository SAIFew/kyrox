import { appDatabase } from "./database.js";

/** Shared process pool for the web application. */
export function db() {
  return appDatabase();
}
