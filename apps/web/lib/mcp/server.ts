import { TESTNET_TRADE_POLICY, fromBaseUnits, toBaseUnits } from "@kyrox/core";

import type { ChartRange, TradeSide } from "../market-types.js";
import {
  DEMO_ASSETS,
  demoDetail,
  demoHistory,
  demoMarketList,
  isChartRange,
} from "../demo/market.js";
import { createDemoQuote } from "../demo/quote.js";
import { defaultDemoLedger, type DemoSession } from "../demo/session.js";
import { environmentInfo } from "../server/session.js";
import { isDemoMode } from "../demo/mode.js";

export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: "object";
    readonly properties: Record<string, unknown>;
    readonly required?: readonly string[];
    readonly additionalProperties: false;
  };
}

export const MCP_TOOLS: readonly McpTool[] = [
  {
    name: "kyrox_list_markets",
    description:
      "List every KYROX reference market with price, 24h change, volume, freshness and a demonstration flag. Read-only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "kyrox_get_market",
    description:
      "Read one market: metadata, latest reference price, ranges and a downsampled price history. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Ticker, e.g. tAAPL" },
        range: { type: "string", enum: ["1D", "1W", "1M", "3M"] },
      },
      required: ["symbol"],
      additionalProperties: false,
    },
  },
  {
    name: "kyrox_preview_quote",
    description:
      "Compute a non-binding quote through the same deterministic engine the app uses. Never builds calldata, never signs, never sends. Amount is a human-readable decimal string.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Ticker, e.g. tAAPL" },
        side: { type: "string", enum: ["buy", "sell"] },
        amount: { type: "string", description: "Human-readable input amount, e.g. 250.00" },
        slippageBps: { type: "number", description: "0..1000, default 50" },
      },
      required: ["symbol", "side", "amount"],
      additionalProperties: false,
    },
  },
  {
    name: "kyrox_get_protocol_status",
    description:
      "Read the honest environment status: simulation labels, contract deployment state, and policy limits.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
] as const;

const SYNTHETIC_ADDRESS = "0x00000000000000000000000000000000000000a1" as const;

function syntheticSession(now: number): DemoSession {
  const base = defaultDemoLedger();
  return {
    address: SYNTHETIC_ADDRESS,
    expiresAt: now + 600,
    demo: true,
    ledger: {
      balances: {
        ...base.balances,
        tUSDC: toBaseUnits("1000000", 6).toString(),
        tAAPL: toBaseUnits("5000", 18).toString(),
        tTSLA: toBaseUnits("5000", 18).toString(),
        tNVDA: toBaseUnits("5000", 18).toString(),
      },
      activity: [],
    },
  };
}

function marketSummary() {
  return demoMarketList().map(({ asset, snapshot }) => ({
    symbol: asset.symbol,
    name: asset.name,
    underlying: asset.underlying,
    priceUsdc: snapshot.priceUsdc,
    change24hPct: snapshot.change24hPct,
    volume24hUsdc: snapshot.volume24hUsdc,
    fresh: snapshot.fresh,
    simulated: snapshot.simulated,
  }));
}

export function callTool(name: string, args: Record<string, unknown>): unknown {
  const now = Math.floor(Date.now() / 1_000);

  if (!isDemoMode()) {
    return {
      error: "live_mode_read_only",
      message:
        "This endpoint is the public preview bridge. A deployed KYROX instance serves live observations from its own host.",
      environment: environmentInfo(),
    };
  }

  switch (name) {
    case "kyrox_list_markets":
      return { simulated: true, asOf: now, markets: marketSummary() };
    case "kyrox_get_market": {
      const symbol = typeof args["symbol"] === "string" ? args["symbol"] : "";
      const rangeValue = typeof args["range"] === "string" ? args["range"] : "1W";
      const range: ChartRange = isChartRange(rangeValue) ? rangeValue : "1W";
      const detail = demoDetail(symbol, range, now);
      if (detail === null) return { error: "unknown_market", symbol };
      return {
        simulated: true,
        asOf: now,
        asset: detail.asset,
        priceUsdc: detail.priceUsdc,
        change24hPct: detail.change24hPct,
        high24hUsdc: detail.high24hUsdc,
        low24hUsdc: detail.low24hUsdc,
        volume24hUsdc: detail.volume24hUsdc,
        sourceUpdatedAt: detail.sourceUpdatedAt,
        highRangeUsdc: detail.highRangeUsdc,
        lowRangeUsdc: detail.lowRangeUsdc,
        changeRangePct: detail.changeRangePct,
        history: demoHistory(symbol, range, now).filter((_point, index) => index % 3 === 0),
        disclaimer: "Simulated reference observations. No oracle feed is connected.",
      };
    }
    case "kyrox_preview_quote": {
      const symbol = typeof args["symbol"] === "string" ? args["symbol"] : "";
      const side: TradeSide = args["side"] === "sell" ? "sell" : "buy";
      const asset = DEMO_ASSETS.find((entry) => entry.symbol === symbol);
      if (asset === undefined) return { error: "unknown_market", symbol };
      const amount = typeof args["amount"] === "string" ? args["amount"] : "0";
      const slippage = typeof args["slippageBps"] === "number" ? args["slippageBps"] : 50;
      try {
        const amountIn = toBaseUnits(amount, side === "buy" ? 6 : asset.decimals);
        const quote = createDemoQuote({
          session: syntheticSession(now),
          symbol,
          side,
          amountIn,
          slippageBps: slippage,
        });
        return {
          simulated: true,
          nonBinding: true,
          symbol: quote.symbol,
          side: quote.side,
          priceUsdc: quote.priceUsdc,
          amountIn: quote.amountInLabel,
          amountOut: quote.amountOutLabel,
          minAmountOut: quote.minAmountOutLabel,
          expiresAt: quote.expiresAt,
          sourceUpdatedAt: quote.sourceUpdatedAt,
          limits: quote.limits,
          canSign: false,
          canExecute: false,
        };
      } catch (error) {
        return {
          error: "quote_rejected",
          message: error instanceof Error ? error.message : "Quote rejected.",
        };
      }
    }
    case "kyrox_get_protocol_status":
      return {
        environment: environmentInfo(),
        policy: {
          minTradeUsdc: fromBaseUnits(TESTNET_TRADE_POLICY.minTradeUsdc, 6),
          maxTradeUsdc: fromBaseUnits(TESTNET_TRADE_POLICY.maxTradeUsdc, 6),
          dailyLimitUsdc: fromBaseUnits(TESTNET_TRADE_POLICY.dailyLimitUsdc, 6),
          allowedAssets: TESTNET_TRADE_POLICY.allowedAssets,
        },
        capabilities: {
          read: true,
          quote: true,
          sign: false,
          send: false,
          transfer: false,
          arbitraryCalldata: false,
        },
        disclaimer:
          "Preview environment. No contracts are deployed on Base Sepolia and no value is transferable.",
      };
    default:
      return { error: "unknown_tool", name };
  }
}
