import { decodeEventLog } from "viem";

import type { Address, MarketSession, AssetFreshnessConfig, PriceBounds } from "@kyrox/core";

import { exchangeAddress, assetAddress, type RuntimeEnvironment } from "./env.js";
import { createChainClient, TRADE_EVENT_ABI } from "./chain.js";

export class PolicyRpcPolicy {
  constructor(private readonly env: RuntimeEnvironment) {}

  nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
  }

  /** Daily notional from the exchange's own Trade events, never from client input. */
  async dailySpentUsdc(trader: Address): Promise<bigint> {
    const client = createChainClient(this.env);
    const latest = await client.getBlockNumber();
    const dayStartUtc = Math.floor(Date.now() / 86_400_000) * 86_400;
    const blockAge = Math.floor((Date.now() / 1000 - dayStartUtc) / 2);
    const fromBlock = latest > BigInt(blockAge) ? latest - BigInt(blockAge) : 0n;
    const logs = await client.getLogs({
      address: exchangeAddress(this.env),
      event: TRADE_EVENT_ABI[0],
      fromBlock,
      toBlock: "latest",
    });

    let total = 0n;
    for (const log of logs) {
      try {
        const decoded = decodeEventLog({
          abi: TRADE_EVENT_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName !== "Trade") continue;
        const args = decoded.args as unknown as { trader: Address; usdcAmount: bigint };
        if (args.trader.toLowerCase() === trader.toLowerCase()) {
          total += args.usdcAmount;
        }
      } catch {
        // Unrelated log from the exchange is ignored.
      }
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

  /**
   * Local simulated mode is always open. Production fails closed because no
   * exchange calendar is configured; there is no fabricated 24/7 assumption.
   */
  async marketSession(_symbol: string): Promise<MarketSession> {
    return this.env.mode === "local-anvil" ? "open" : "unknown";
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
