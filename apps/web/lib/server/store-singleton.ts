import { createDatabase } from "@kyrox/db";
import { DrizzleObservationStore } from "@kyrox/price";

import { DrizzleAuthStore, DrizzleIntentStore } from "./stores.js";
import { loadEnvironment, type RuntimeEnvironment } from "./env.js";

let currentEnv: RuntimeEnvironment | undefined;
let currentDb: ReturnType<typeof createDatabase> | undefined;

export function environment(): RuntimeEnvironment {
  if (currentEnv === undefined) currentEnv = loadEnvironment();
  return currentEnv;
}

function database(): ReturnType<typeof createDatabase> {
  if (currentDb === undefined) currentDb = createDatabase(environment().databaseUrl);
  return currentDb;
}

export function authStore(): DrizzleAuthStore {
  return new DrizzleAuthStore(database().db);
}

export function intentStore(): DrizzleIntentStore {
  return new DrizzleIntentStore(database().db);
}

export function observationStore(): DrizzleObservationStore {
  return new DrizzleObservationStore(database().db);
}
