import { DrizzleObservationStore } from "@kyrox/price";

import { appDatabase } from "./database.js";
import { DrizzleAuthStore, DrizzleIntentStore } from "./stores.js";
import { loadEnvironment, type RuntimeEnvironment } from "./env.js";

let currentEnv: RuntimeEnvironment | undefined;

export function environment(): RuntimeEnvironment {
  if (currentEnv === undefined) currentEnv = loadEnvironment();
  return currentEnv;
}

function database() {
  return appDatabase(environment().databaseUrl);
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
