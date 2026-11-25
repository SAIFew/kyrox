import { afterEach, describe, expect, it, vi } from "vitest";

import { callTool, mcpTools } from "../lib/mcp/server.js";

afterEach(() => vi.unstubAllEnvs());

describe("MCP basket tool", () => {
  it("is advertised in preview mode and returns a non-executing allocation", () => {
    vi.stubEnv("KYROX_DEMO_MODE", "1");
    expect(mcpTools().some((tool) => tool.name === "kyrox_quote_basket")).toBe(true);
    const result = callTool("kyrox_quote_basket", {
      symbols: ["tAAPL", "tNVDA"],
      totalUsdc: "500",
    }) as { legs: Array<{ symbol: string; amountUsdc: string }>; canExecute: boolean };
    expect(result.canExecute).toBe(false);
    expect(result.legs).toHaveLength(2);
    expect(Number(result.legs[0]?.amountUsdc) + Number(result.legs[1]?.amountUsdc)).toBe(500);
  });

  it("rejects too many or unknown symbols", () => {
    vi.stubEnv("KYROX_DEMO_MODE", "1");
    expect(
      callTool("kyrox_quote_basket", {
        symbols: ["tAAPL", "tNVDA", "tMSFT", "tGOOGL", "tAMZN"],
        totalUsdc: "500",
      }),
    ).toMatchObject({ error: "invalid_arguments" });
    expect(callTool("kyrox_quote_basket", { symbols: ["tFAKE"], totalUsdc: "500" })).toMatchObject({
      error: "unknown_market",
    });
  });
});
