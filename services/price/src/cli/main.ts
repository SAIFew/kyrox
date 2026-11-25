import { pathToFileURL } from "node:url";

import { createDatabase } from "@kyrox/db";
import { loadDeploymentManifest, type DeploymentManifest } from "@kyrox/protocol";

import { ChainlinkFeedReader } from "../feeds/chainlink.js";
import { ChainlinkSequencerUptimeReader } from "../feeds/sequencer.js";
import { createBaseMainnetReadClient } from "../feeds/viem-client.js";
import { DrizzleObservationStore } from "../persistence/drizzle-store.js";
import { ConfigError, parseIngestConfig } from "./config.js";
import { exitCodeFor, runIngestOnce } from "./run.js";

/**
 * One-shot price ingestion entrypoint.
 *
 * Reads Base Mainnet only, writes PostgreSQL and (only when
 * PRICE_PUBLICATION_ENABLED is explicitly true) prepares unsigned Sepolia
 * calldata. It never signs or broadcasts.
 */
export async function main(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> {
  let config;
  try {
    config = parseIngestConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`Configuration error: ${error.message}`);
      return 2;
    }
    throw error;
  }

  let handle: ReturnType<typeof createDatabase>;
  try {
    handle = createDatabase(config.databaseUrl);
    await handle.pool.query("SELECT 1");
  } catch (error) {
    console.error(
      `Database initialisation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }

  try {
    const store = new DrizzleObservationStore(handle.db);
    const client = createBaseMainnetReadClient(config.rpcUrl);
    const reader = new ChainlinkFeedReader(client);
    const sequencer = new ChainlinkSequencerUptimeReader(client);

    const report = await runIngestOnce(config, {
      reader,
      sequencer,
      store,
      loadManifest: (path: string): DeploymentManifest | null => {
        try {
          return loadDeploymentManifest(path);
        } catch {
          return null;
        }
      },
      logger: (line) => console.error(line),
    });

    console.log(JSON.stringify(report, null, 2));
    return exitCodeFor(report);
  } catch (error) {
    console.error(`Ingestion failed: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  } finally {
    await handle.pool.end();
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
