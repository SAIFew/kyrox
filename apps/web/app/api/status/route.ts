import { desc, inArray } from "drizzle-orm";
import { createPublicClient, http } from "viem";

import { createDatabase, pricePublications } from "@kyrox/db";
import { DrizzleObservationStore } from "@kyrox/price";

import { isDemoMode } from "@/lib/demo/mode";
import { environmentInfo } from "@/lib/server/session";
import {
  exchangeAddress,
  loadEnvironment,
  settlementToken,
  type RuntimeEnvironment,
} from "@/lib/server/env";
import { EXCHANGE_VIEWS_ABI } from "@/lib/server/chain";
import { json, routeError } from "@/lib/server/http";
import { isReadyForTraffic } from "./readiness.js";

export const dynamic = "force-dynamic";

type CheckStatus =
  | "operational"
  | "simulated"
  | "degraded"
  | "unavailable"
  | "not-configured"
  | "not-deployed"
  | "not-running";

interface StatusCheck {
  readonly id: string;
  readonly label: string;
  readonly status: CheckStatus;
  readonly detail: string;
}

interface DatabaseProbes {
  readonly database: StatusCheck;
  readonly markets: StatusCheck;
  readonly publication: StatusCheck;
}

function check(id: string, label: string, status: CheckStatus, detail: string): StatusCheck {
  return { id, label, status, detail };
}

function unavailableDatabaseProbes(): DatabaseProbes {
  return {
    database: check(
      "database",
      "Database & session store",
      "unavailable",
      "PostgreSQL could not complete a bounded SELECT 1 and observation read.",
    ),
    markets: check(
      "markets",
      "Reference market data",
      "unavailable",
      "Persisted observations could not be read.",
    ),
    publication: check(
      "publication",
      "Price publication",
      "unavailable",
      "Publication state could not be read.",
    ),
  };
}

const SECONDS_PER_DAY = 86_400;
const ZERO_FEED = "0x0000000000000000000000000000000000000000";

async function probeMarkets(
  handle: ReturnType<typeof createDatabase>,
  env: RuntimeEnvironment,
  now: number,
): Promise<StatusCheck> {
  try {
    const store = new DrizzleObservationStore(handle.db);
    const symbols = Object.keys(env.manifest.assets);
    const observations = await Promise.all(
      symbols.map(async (symbol) => ({
        symbol,
        observation: await store.latestValidObservation(symbol),
      })),
    );
    const freshCount = observations.filter(({ symbol, observation }) => {
      const maxAge = env.manifest.assets[symbol]?.maxSourceAgeSeconds;
      return (
        observation !== null &&
        observation.referencePriceUsdcPerWholeToken !== null &&
        observation.referencePriceUsdcPerWholeToken > 0n &&
        observation.sourceUpdatedAt <= now &&
        typeof maxAge === "number" &&
        Number.isInteger(maxAge) &&
        maxAge > 0 &&
        now - observation.sourceUpdatedAt <= maxAge
      );
    }).length;
    const allFresh = symbols.length > 0 && freshCount === symbols.length;
    const simulated =
      env.mode === "local-anvil" ||
      (observations.length > 0 &&
        observations.every(({ observation }) => observation?.feedAddress === ZERO_FEED));
    return check(
      "markets",
      "Reference market data",
      allFresh ? (simulated ? "simulated" : "operational") : "degraded",
      allFresh
        ? simulated
          ? `${freshCount}/${symbols.length} local observations are fresh and labelled simulated.`
          : `${freshCount}/${symbols.length} source observations are fresh.`
        : `${freshCount}/${symbols.length} source observations are fresh; missing or stale data fails closed.`,
    );
  } catch {
    return check(
      "markets",
      "Reference market data",
      "unavailable",
      "Persisted observations could not be read within the bounded probe.",
    );
  }
}

async function probePublication(
  handle: ReturnType<typeof createDatabase>,
  env: RuntimeEnvironment,
  now: number,
): Promise<StatusCheck> {
  try {
    const symbols = Object.keys(env.manifest.assets);
    const publicationRows =
      symbols.length === 0
        ? []
        : await handle.db
            .select({
              assetSymbol: pricePublications.assetSymbol,
              status: pricePublications.status,
              simulated: pricePublications.simulated,
              preparedAt: pricePublications.preparedAt,
            })
            .from(pricePublications)
            .where(inArray(pricePublications.assetSymbol, symbols))
            .orderBy(desc(pricePublications.preparedAt))
            .limit(50);
    const latestByAsset = new Map<string, (typeof publicationRows)[number]>();
    for (const row of publicationRows) {
      if (!latestByAsset.has(row.assetSymbol)) latestByAsset.set(row.assetSymbol, row);
    }
    if (latestByAsset.size === 0) {
      return check(
        "publication",
        "Price publication",
        "not-configured",
        "No persisted publication was found. No worker heartbeat is inferred from observations.",
      );
    }
    const recentVerified =
      latestByAsset.size === symbols.length &&
      [...latestByAsset.values()].every(
        (row) =>
          (row.status === "verified" || row.status === "confirmed") &&
          row.preparedAt.getTime() <= now * 1_000 &&
          now - Math.floor(row.preparedAt.getTime() / 1_000) <= SECONDS_PER_DAY,
      );
    const simulatedPublication =
      env.mode === "local-anvil" ||
      [...latestByAsset.values()].every((row) => row.simulated === true);
    return check(
      "publication",
      "Price publication",
      recentVerified ? (simulatedPublication ? "simulated" : "operational") : "degraded",
      recentVerified
        ? simulatedPublication
          ? "Every configured asset has a fresh, verified simulated publication."
          : "Every configured asset has a verified publication prepared within the last 24 hours."
        : "Latest persisted publications are missing, old, or not verified; worker liveness is not assumed.",
    );
  } catch {
    return check(
      "publication",
      "Price publication",
      "unavailable",
      "Publication state could not be read within the bounded probe.",
    );
  }
}

async function probeDatabase(env: RuntimeEnvironment, now: number): Promise<DatabaseProbes> {
  let handle: ReturnType<typeof createDatabase> | undefined;
  try {
    handle = createDatabase(env.databaseUrl, {
      max: 1,
      min: 0,
      connectionTimeoutMillis: 1_200,
      queryTimeoutMs: 1_200,
      statementTimeoutMs: 1_200,
    });
    await handle.pool.query("SELECT 1");
    const database = check(
      "database",
      "Database & session store",
      "operational",
      "PostgreSQL completed a bounded SELECT 1.",
    );
    return {
      database,
      markets: await probeMarkets(handle, env, now),
      publication: await probePublication(handle, env, now),
    };
  } catch {
    return unavailableDatabaseProbes();
  } finally {
    if (handle !== undefined) await handle.pool.end().catch(() => undefined);
  }
}

async function probeContracts(env: RuntimeEnvironment): Promise<StatusCheck> {
  try {
    const client = createPublicClient({
      chain: {
        id: env.manifest.chainId,
        name: env.mode === "local-anvil" ? "Base Sepolia (local Anvil)" : "Base Sepolia",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [env.rpcUrl] } },
      },
      transport: http(env.rpcUrl, { timeout: 1_800, retryCount: 0 }),
    });
    const contracts = [
      { name: "KyroxExchange", address: exchangeAddress(env) },
      { name: "TestUSDC", address: settlementToken(env) },
      ...Object.entries(env.manifest.assets).map(([name, asset]) => ({
        name,
        address: asset.address,
      })),
    ];
    const [chainId, codes, paused] = await Promise.all([
      client.getChainId(),
      Promise.all(contracts.map((contract) => client.getCode({ address: contract.address }))),
      client.readContract({
        address: exchangeAddress(env),
        abi: EXCHANGE_VIEWS_ABI,
        functionName: "paused",
      }),
    ]);
    if (chainId !== env.manifest.chainId) {
      return check(
        "contracts",
        "Base Sepolia contracts",
        "unavailable",
        `RPC chain ${chainId} does not match manifest chain ${env.manifest.chainId}.`,
      );
    }
    const missing = contracts.filter(
      (_contract, index) => codes[index] === undefined || codes[index] === "0x",
    );
    if (missing.length > 0) {
      return check(
        "contracts",
        "Base Sepolia contracts",
        "unavailable",
        `No runtime bytecode was found for: ${missing.map((contract) => contract.name).join(", ")}.`,
      );
    }
    return check(
      "contracts",
      "Base Sepolia contracts",
      paused ? "degraded" : "operational",
      paused
        ? "Chain, bytecode, and pause state were read; the exchange is paused."
        : `Chain ${chainId}, runtime bytecode, and unpaused exchange state were verified.`,
    );
  } catch {
    return check(
      "contracts",
      "Base Sepolia contracts",
      "unavailable",
      "Bounded RPC chain, bytecode, or pause probe failed.",
    );
  }
}

export async function GET() {
  const now = Math.floor(Date.now() / 1_000);
  try {
    const demo = isDemoMode();
    if (demo) {
      return json({
        ok: true,
        generatedAt: new Date(now * 1_000).toISOString(),
        environment: environmentInfo(),
        checks: [
          check(
            "web",
            "Consumer application",
            "operational",
            "Next.js application is serving the product surface.",
          ),
          check(
            "markets",
            "Reference market data",
            "simulated",
            "Deterministic simulated observations. No oracle is connected.",
          ),
          check(
            "database",
            "Database & session store",
            "not-configured",
            "Preview accounts use signed HttpOnly cookies. No PostgreSQL is attached.",
          ),
          check(
            "contracts",
            "Base Sepolia contracts",
            "not-deployed",
            "The KYROX exchange and token suite are not deployed on Base Sepolia.",
          ),
          check(
            "agent",
            "Agent bridge (MCP)",
            "operational",
            "Read-only preview market, quote, and status tools are advertised.",
          ),
          check(
            "indexer",
            "Event indexer",
            "not-running",
            "No durable event indexer runs in this environment.",
          ),
          check(
            "publication",
            "Price publication",
            "not-configured",
            "Unsigned setPrice preparation is configured for deployment, not active here.",
          ),
        ],
        disclaimer: "The public preview is a simulated venue. No transaction is broadcast.",
      });
    }

    const env = loadEnvironment();
    const info = environmentInfo(env);
    const [database, contracts] = await Promise.all([probeDatabase(env, now), probeContracts(env)]);
    const checks: StatusCheck[] = [
      check(
        "web",
        "Consumer application",
        "operational",
        "Next.js application is serving the product surface.",
      ),
      check(
        "manifest",
        "Deployment manifest",
        "operational",
        `Validated ${env.mode} manifest for chain ${env.manifest.chainId}.`,
      ),
      database.database,
      database.markets,
      contracts,
      check(
        "agent",
        "Agent bridge (MCP)",
        "operational",
        "Only the genuinely available protocol-status tool is advertised in live mode.",
      ),
      check(
        "indexer",
        "Event indexer",
        "not-running",
        "No durable event indexer runs in this environment.",
      ),
      database.publication,
    ];
    const criticalIds = new Set(["manifest", "database", "markets", "contracts"]);
    const ok = isReadyForTraffic(checks, criticalIds);
    return json(
      {
        ok,
        generatedAt: new Date(now * 1_000).toISOString(),
        environment: info,
        checks,
        disclaimer:
          env.mode === "local-anvil"
            ? "Local Anvil rehearsal. Balances, prices, and fills are simulated; no public testnet transaction is broadcast."
            : "Base Sepolia testnet environment. The user's wallet remains the sole signer and broadcaster.",
      },
      ok ? 200 : 503,
    );
  } catch (err) {
    return routeError(err, "status_unavailable");
  }
}
