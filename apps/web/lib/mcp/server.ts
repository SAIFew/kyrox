import {
  MAX_BASKET_LEGS,
  TESTNET_TRADE_POLICY,
  allocateBasketBudget,
  fromBaseUnits,
  toBaseUnits,
} from "@kyrox/core";

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
    name: "kyrox_quote_basket",
    description:
      "Split a tUSDC budget across up to four test stocks. Returns an allocation only; every leg still needs its own quote and user signature. Never executes.",
    inputSchema: {
      type: "object",
      properties: {
        symbols: {
          type: "array",
          items: { type: "string" },
          description: 'Distinct tickers, e.g. ["tAAPL", "tNVDA"]',
        },
        totalUsdc: { type: "string", description: "Human-readable tUSDC budget, e.g. 500" },
        weights: { type: "array", items: { type: "number" } },
      },
      required: ["symbols", "totalUsdc"],
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

const ALL_TOOL_NAMES = new Set(MCP_TOOLS.map((tool) => tool.name));
const LIVE_TOOL_NAMES = new Set(["kyrox_get_protocol_status"]);

/** Discovery must never advertise tools that only exist in the preview venue. */
export function mcpTools(): readonly McpTool[] {
  return isDemoMode() ? MCP_TOOLS : MCP_TOOLS.filter((tool) => LIVE_TOOL_NAMES.has(tool.name));
}

export function isMcpToolAvailable(name: string): boolean {
  return mcpTools().some((tool) => tool.name === name);
}

const SYNTHETIC_ADDRESS = "0x00000000000000000000000000000000000000a1" as const;

function syntheticSession(now: number): DemoSession {
  const base = defaultDemoLedger();
  const balances: Record<string, string> = {
    ...base.balances,
    tUSDC: toBaseUnits("1000000", 6).toString(),
  };
  for (const asset of DEMO_ASSETS) {
    balances[asset.symbol] = toBaseUnits("5000", asset.decimals).toString();
  }
  return {
    address: SYNTHETIC_ADDRESS,
    expiresAt: now + 600,
    demo: true,
    ledger: { balances, activity: [] },
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

function policySummary() {
  return {
    minTradeUsdc: fromBaseUnits(TESTNET_TRADE_POLICY.minTradeUsdc, 6),
    maxTradeUsdc: fromBaseUnits(TESTNET_TRADE_POLICY.maxTradeUsdc, 6),
    dailyLimitUsdc: fromBaseUnits(TESTNET_TRADE_POLICY.dailyLimitUsdc, 6),
    allowedAssets: TESTNET_TRADE_POLICY.allowedAssets,
  };
}

function protocolStatus() {
  try {
    const demo = isDemoMode();
    return {
      environment: environmentInfo(),
      policy: policySummary(),
      capabilities: {
        read: true,
        markets: demo,
        quote: demo,
        sign: false,
        send: false,
        transfer: false,
        arbitraryCalldata: false,
      },
      availableTools: mcpTools().map((tool) => tool.name),
      disclaimer: demo
        ? "Preview environment. No contracts are deployed on Base Sepolia and no value is transferable."
        : "Live configuration resolved. Only protocol status is exposed by this public MCP bridge; authenticated market and quote operations remain in the application API.",
    };
  } catch {
    return {
      error: "environment_unavailable",
      code: "LIVE_ENVIRONMENT_UNAVAILABLE",
      message: "The live runtime configuration could not be resolved.",
      capabilities: {
        read: false,
        markets: false,
        quote: false,
        sign: false,
        send: false,
        transfer: false,
        arbitraryCalldata: false,
      },
    };
  }
}

function invalidArguments(message: string) {
  return { error: "invalid_arguments", code: "INVALID_ARGUMENTS", message };
}

export function callTool(name: string, args: Record<string, unknown>): unknown {
  const now = Math.floor(Date.now() / 1_000);

  if (!ALL_TOOL_NAMES.has(name)) return { error: "unknown_tool", name };
  if (!isDemoMode()) {
    if (name !== "kyrox_get_protocol_status") {
      return {
        error: "tool_unavailable",
        code: "LIVE_TOOL_UNAVAILABLE",
        mode: "live",
        message: "This tool is not available in live mode.",
        availableTools: mcpTools().map((tool) => tool.name),
      };
    }
    return protocolStatus();
  }

  switch (name) {
    case "kyrox_list_markets":
      return { simulated: true, asOf: now, markets: marketSummary() };
    case "kyrox_get_market": {
      const symbol = args["symbol"];
      if (typeof symbol !== "string" || symbol.trim().length === 0) {
        return invalidArguments("symbol must be a non-empty ticker string.");
      }
      const rangeValue = "range" in args ? args["range"] : "1W";
      if (typeof rangeValue !== "string" || !isChartRange(rangeValue)) {
        return invalidArguments("range must be one of 1D, 1W, 1M, or 3M.");
      }
      const range: ChartRange = rangeValue;
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
    case "kyrox_quote_basket": {
      const symbols = args["symbols"];
      const total = args["totalUsdc"];
      if (!Array.isArray(symbols) || symbols.some((item) => typeof item !== "string")) {
        return invalidArguments("symbols must be an array of ticker strings.");
      }
      if (symbols.length === 0 || symbols.length > MAX_BASKET_LEGS) {
        return invalidArguments(`symbols must contain 1..${MAX_BASKET_LEGS} tickers.`);
      }
      if (typeof total !== "string" || total.trim().length === 0) {
        return invalidArguments("totalUsdc must be a decimal string.");
      }
      const weights = args["weights"];
      if (
        weights !== undefined &&
        (!Array.isArray(weights) ||
          weights.some((item) => typeof item !== "number" || !Number.isInteger(item) || item <= 0))
      ) {
        return invalidArguments("weights must be positive integers when supplied.");
      }
      const unknown = symbols.find(
        (symbol) => !DEMO_ASSETS.some((asset) => asset.symbol === symbol),
      );
      if (unknown !== undefined) return { error: "unknown_market", symbol: unknown };
      try {
        const legs = allocateBasketBudget(
          symbols as string[],
          toBaseUnits(total, 6),
          weights as number[] | undefined,
        );
        return {
          simulated: true,
          nonBinding: true,
          totalUsdc: total,
          legs: legs.map((leg) => ({
            symbol: leg.symbol,
            amountUsdc: fromBaseUnits(leg.amountInUsdc, 6),
          })),
          note: "Allocation only. Each leg needs a separate quote, policy check, and wallet signature.",
          canSign: false,
          canExecute: false,
        };
      } catch (error) {
        return invalidArguments(error instanceof Error ? error.message : "Invalid basket.");
      }
    }
    case "kyrox_preview_quote": {
      const symbol = args["symbol"];
      if (typeof symbol !== "string" || symbol.trim().length === 0) {
        return invalidArguments("symbol must be a non-empty ticker string.");
      }
      const side: TradeSide = args["side"] === "sell" ? "sell" : "buy";
      if (args["side"] !== "buy" && args["side"] !== "sell") {
        return invalidArguments("side must be buy or sell.");
      }
      const asset = DEMO_ASSETS.find((entry) => entry.symbol === symbol);
      if (asset === undefined) return { error: "unknown_market", symbol };
      const amount = args["amount"];
      const slippage = "slippageBps" in args ? args["slippageBps"] : 50;
      if (typeof amount !== "string") return invalidArguments("amount must be a decimal string.");
      if (
        typeof slippage !== "number" ||
        !Number.isInteger(slippage) ||
        slippage < 0 ||
        slippage > 1_000
      ) {
        return invalidArguments("slippageBps must be an integer 0..1000.");
      }
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
      return protocolStatus();
    default:
      return { error: "unknown_tool", name };
  }
}
