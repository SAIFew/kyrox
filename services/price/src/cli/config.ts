import { VERIFIED_FEEDS } from "../feeds/registry.js";

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

export interface IngestCliConfig {
  readonly rpcUrl: string;
  readonly databaseUrl: string;
  readonly assetSymbols: readonly string[];
  readonly maxSourceAgeSeconds: number;
  readonly manifestPath: string;
  /**
   * Defaults to false. Only an explicit true/1/yes/on enables preparation of
   * unsigned setPrice calls; ingestion itself remains enabled.
   */
  readonly pricePublicationEnabled: boolean;
}

const HTTP_URL = /^https?:\/\/[^\s]+$/;

/**
 * Validate CLI configuration from the environment.
 *
 * Fails closed: an incomplete configuration is never partially applied.
 */
export function parseIngestConfig(
  env: Readonly<Record<string, string | undefined>>,
): IngestCliConfig {
  const rpcUrl = env["BASE_MAINNET_RPC_URL"]?.trim() ?? "";
  if (rpcUrl.length === 0) {
    throw new ConfigError("BASE_MAINNET_RPC_URL is required for read-only feed ingestion.");
  }
  if (!HTTP_URL.test(rpcUrl)) {
    throw new ConfigError("BASE_MAINNET_RPC_URL must be an http(s) URL.");
  }

  const databaseUrl = env["DATABASE_URL"]?.trim() ?? "";
  if (databaseUrl.length === 0) {
    throw new ConfigError("DATABASE_URL is required for observation persistence.");
  }

  const tickers = (env["PRICE_ALLOWED_TICKERS"] ?? "")
    .split(",")
    .map((ticker) => ticker.trim())
    .filter((ticker) => ticker.length > 0);
  if (tickers.length === 0) {
    throw new ConfigError("PRICE_ALLOWED_TICKERS must list at least one approved asset.");
  }
  const known = new Set(
    VERIFIED_FEEDS.filter((feed) => feed.enabled).map((feed) => feed.assetSymbol),
  );
  for (const ticker of tickers) {
    if (!known.has(ticker)) {
      throw new ConfigError(`Unsupported or disabled asset in PRICE_ALLOWED_TICKERS: ${ticker}.`);
    }
  }

  const maxAgeRaw = env["PRICE_MAX_SOURCE_AGE_SECONDS"] ?? "600";
  const maxSourceAgeSeconds = Number(maxAgeRaw);
  if (!Number.isInteger(maxSourceAgeSeconds) || maxSourceAgeSeconds <= 0) {
    throw new ConfigError("PRICE_MAX_SOURCE_AGE_SECONDS must be a positive integer.");
  }

  const publicationRaw = env["PRICE_PUBLICATION_ENABLED"]?.trim().toLowerCase() ?? "";
  let pricePublicationEnabled = false;
  if (publicationRaw.length > 0) {
    if (["true", "1", "yes", "on"].includes(publicationRaw)) {
      pricePublicationEnabled = true;
    } else if (!["false", "0", "no", "off"].includes(publicationRaw)) {
      throw new ConfigError("PRICE_PUBLICATION_ENABLED must be an explicit boolean (true/false).");
    }
  }

  return {
    rpcUrl,
    databaseUrl,
    assetSymbols: [...new Set(tickers)],
    maxSourceAgeSeconds,
    pricePublicationEnabled,
    manifestPath: env["KYROX_DEPLOYMENT_MANIFEST"]?.trim() || "deployments/base-sepolia.json",
  };
}
