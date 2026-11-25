import { decodeEventLog } from "viem";

import {
  BASE_SEPOLIA_CHAIN_ID,
  type Address,
  type MarketSession,
  type AssetFreshnessConfig,
  type PriceBounds,
} from "@kyrox/core";

import { exchangeAddress, assetAddress, type RuntimeEnvironment } from "./env.js";
import { createChainClient, TRADE_EVENT_ABI, type ChainClient } from "./chain.js";

const SECONDS_PER_UTC_DAY = 86_400;
const MILLISECONDS_PER_UTC_DAY = SECONDS_PER_UTC_DAY * 1_000;
const LOG_CHUNK_BLOCKS = 2_000n;
const MAX_LOG_CHUNKS = 512;
const MAX_BLOCK_PROBES = 64;
const MAX_LOG_SPLIT_DEPTH = 20;

/**
 * Base Sepolia has no production exchange calendar. It therefore defaults to
 * `unknown`, which freshness policy rejects. The only override is the exact,
 * explicitly named testnet policy `KYROX_MARKET_SESSION_MODE=always-open-testnet`;
 * values such as `open` or `always-open` never enable trading implicitly.
 */
export function resolveMarketSession(
  mode: RuntimeEnvironment["mode"],
  configuredMode: string | undefined,
): MarketSession {
  if (mode === "local-anvil") return "open";
  if (configuredMode?.trim() === "always-open-testnet") return "open";
  return "unknown";
}

function incompleteCoverage(message: string): never {
  throw new Error(`Daily spend log coverage is incomplete: ${message}`);
}

/** Find the first canonical block at or after the UTC-day boundary. */
async function firstBlockAtOrAfter(
  client: ChainClient,
  dayStartSeconds: number,
  latest: NonNullable<Awaited<ReturnType<ChainClient["getBlock"]>>>,
): Promise<bigint | null> {
  const latestTimestamp = Number(latest.timestamp);
  if (!Number.isSafeInteger(latestTimestamp))
    incompleteCoverage("latest block timestamp is unsafe");
  if (latestTimestamp < dayStartSeconds) return null;
  if (typeof latest.number !== "bigint" || latest.number < 0n) {
    incompleteCoverage("latest block number is invalid");
  }
  if (latest.number === 0n) return 0n;

  const boundary = BigInt(dayStartSeconds);
  let before: bigint | null = null;
  let after: bigint = latest.number;
  let step = 1n;
  let probes = 0;

  // Exponential walk backwards avoids a fixed block-age estimate while keeping
  // the subsequent binary search bounded even if the chain has no blocks near
  // the requested day.
  while (after > 0n) {
    if (probes >= MAX_BLOCK_PROBES) incompleteCoverage("block boundary probe limit exceeded");
    probes += 1;
    const candidate = after > step ? after - step : 0n;
    const block = await client.getBlock({ blockNumber: candidate });
    if (block === null) incompleteCoverage("historical boundary block is unavailable");
    const timestamp = Number(block.timestamp);
    if (!Number.isSafeInteger(timestamp)) incompleteCoverage("block timestamp is unsafe");
    if (timestamp < boundary) {
      before = candidate;
      break;
    }
    after = candidate;
    if (candidate === 0n) return 0n;
    step *= 2n;
  }

  if (before === null) incompleteCoverage("could not establish the day boundary");
  while (after - before > 1n) {
    if (probes >= MAX_BLOCK_PROBES) incompleteCoverage("block boundary probe limit exceeded");
    probes += 1;
    const middle: bigint = before + (after - before) / 2n;
    const block = await client.getBlock({ blockNumber: middle });
    if (block === null) incompleteCoverage("historical boundary block is unavailable");
    const timestamp = Number(block.timestamp);
    if (!Number.isSafeInteger(timestamp)) incompleteCoverage("block timestamp is unsafe");
    if (timestamp >= boundary) after = middle;
    else before = middle;
  }
  return after;
}

export class PolicyRpcPolicy {
  constructor(private readonly env: RuntimeEnvironment) {}

  nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
  }

  /** Daily notional from the exchange's own Trade events, never from client input. */
  async dailySpentUsdc(trader: Address): Promise<bigint> {
    const client = createChainClient(this.env);
    const chainId = await client.getChainId();
    if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
      throw new Error(`Daily spend RPC is on chain ${chainId}, expected 84532.`);
    }

    const nowMs = Date.now();
    const dayStartUtcSeconds = Math.floor(nowMs / MILLISECONDS_PER_UTC_DAY) * SECONDS_PER_UTC_DAY;
    const latest = await client.getBlock({ blockTag: "latest" });
    if (latest === null) incompleteCoverage("latest block is unavailable");
    const fromBlock = await firstBlockAtOrAfter(client, dayStartUtcSeconds, latest);
    if (fromBlock === null) return 0n;

    let chunks = 0;
    const collectRange = async (
      from: bigint,
      to: bigint,
      depth: number,
    ): Promise<Awaited<ReturnType<ChainClient["getLogs"]>>> => {
      chunks += 1;
      if (chunks > MAX_LOG_CHUNKS) incompleteCoverage("log range limit exceeded");
      try {
        const logs = await client.getLogs({
          address: exchangeAddress(this.env),
          event: TRADE_EVENT_ABI[0],
          args: { trader },
          fromBlock: from,
          toBlock: to,
          strict: true,
        });
        for (const log of logs) {
          if (
            log.blockNumber === null ||
            log.blockNumber < from ||
            log.blockNumber > to ||
            log.address.toLowerCase() !== exchangeAddress(this.env).toLowerCase()
          ) {
            incompleteCoverage("RPC returned a log outside the requested canonical range");
          }
        }
        return logs;
      } catch (error) {
        if (from >= to || depth >= MAX_LOG_SPLIT_DEPTH) {
          incompleteCoverage(error instanceof Error ? error.message : String(error));
        }
        const middle = from + (to - from) / 2n;
        const [left, right] = await Promise.all([
          collectRange(from, middle, depth + 1),
          collectRange(middle + 1n, to, depth + 1),
        ]);
        return [...left, ...right];
      }
    };

    const logs = [];
    for (let from = fromBlock; from <= latest.number; from += LOG_CHUNK_BLOCKS) {
      const to = from + LOG_CHUNK_BLOCKS - 1n;
      logs.push(...(await collectRange(from, to > latest.number ? latest.number : to, 0)));
    }

    // Fail closed if the snapshot block changed while logs were being read.
    const finalHead = await client.getBlock({ blockNumber: latest.number });
    if (finalHead === null) incompleteCoverage("canonical head block is unavailable");
    if (finalHead.hash !== latest.hash || finalHead.timestamp !== latest.timestamp) {
      incompleteCoverage("canonical head changed during the log query");
    }

    let total = 0n;
    const seen = new Set<string>();
    for (const log of logs) {
      const key = `${log.transactionHash}:${log.logIndex}`;
      if (seen.has(key)) incompleteCoverage("RPC returned duplicate log evidence");
      seen.add(key);
      let decoded;
      try {
        decoded = decodeEventLog({
          abi: TRADE_EVENT_ABI,
          data: log.data,
          topics: log.topics,
        });
      } catch (error) {
        incompleteCoverage(error instanceof Error ? error.message : String(error));
      }
      if (decoded.eventName !== "Trade") incompleteCoverage("unexpected exchange event");
      const args = decoded.args as unknown as { trader: Address; usdcAmount: bigint };
      if (args.trader.toLowerCase() !== trader.toLowerCase()) {
        incompleteCoverage("RPC returned a Trade event for a different trader");
      }
      if (args.usdcAmount <= 0n) incompleteCoverage("Trade event has a non-positive USDC amount");
      total += args.usdcAmount;
    }
    return total;
  }

  async isExchangePaused(): Promise<boolean> {
    const client = createChainClient(this.env);
    return client.readContract({
      address: exchangeAddress(this.env),
      abi: [
        {
          type: "function",
          name: "paused",
          stateMutability: "view",
          inputs: [],
          outputs: [{ type: "bool" }],
        },
      ],
      functionName: "paused",
    });
  }

  async isAssetEnabled(symbol: string): Promise<boolean> {
    const token = assetAddress(this.env, symbol);
    const client = createChainClient(this.env);
    const abi = [
      {
        type: "function",
        name: "assetSettings",
        stateMutability: "view",
        inputs: [{ name: "stockToken", type: "address" }],
        outputs: [
          { type: "bool" },
          { type: "uint8" },
          { type: "uint32" },
          { type: "uint16" },
          { type: "uint256" },
          { type: "uint256" },
        ],
      },
    ] as const;
    const [listed] = await client.readContract({
      address: exchangeAddress(this.env),
      abi,
      functionName: "assetSettings",
      args: [token],
    });
    return listed;
  }

  async marketSession(_symbol: string): Promise<MarketSession> {
    return resolveMarketSession(this.env.mode, process.env["KYROX_MARKET_SESSION_MODE"]);
  }

  freshnessFor(symbol: string): AssetFreshnessConfig {
    const asset = this.env.manifest.assets[symbol];
    if (asset?.maxSourceAgeSeconds === undefined) {
      throw new Error(`No freshness configuration for ${symbol}.`);
    }
    return {
      assetSymbol: symbol,
      maxSourceAgeSeconds: asset.maxSourceAgeSeconds,
      requireOpenMarket: this.env.mode === "base-sepolia",
    };
  }

  priceBoundsFor(symbol: string): PriceBounds {
    const asset = this.env.manifest.assets[symbol];
    if (
      asset?.minPriceUsdcPerWholeToken === undefined ||
      asset.maxPriceUsdcPerWholeToken === undefined
    ) {
      throw new Error(`No price bounds for ${symbol}.`);
    }
    return {
      minPriceUsdcPerWholeToken: BigInt(asset.minPriceUsdcPerWholeToken),
      maxPriceUsdcPerWholeToken: BigInt(asset.maxPriceUsdcPerWholeToken),
    };
  }
}
