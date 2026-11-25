import { describe, expect, it } from "vitest";

import {
  AssetRegistry,
  CoreError,
  SUPPORTED_STOCK_DECIMALS,
  TESTNET_ASSETS,
  assertAssetDefinition,
  isSupportedStockDecimals,
  testnetAssetRegistry,
  type AssetDefinition,
} from "../src/index.js";

const baseAsset: AssetDefinition = {
  symbol: "tTEST",
  name: "Test Asset",
  stockToken: null,
  stockDecimals: 18,
  priceSourceKind: "simulated",
  listed: true,
};

describe("asset definitions", () => {
  it("ships the seven Phase 0 testnet assets with 18 decimals and no invented addresses", () => {
    expect(TESTNET_ASSETS.map((asset) => asset.symbol)).toEqual([
      "tAAPL",
      "tNVDA",
      "tMSFT",
      "tGOOGL",
      "tAMZN",
      "tTSLA",
      "tMETA",
    ]);
    for (const asset of TESTNET_ASSETS) {
      expect(asset.stockDecimals).toBe(18);
      expect(asset.stockToken).toBeNull();
      expect(asset.priceSourceKind).toBe("simulated");
      expect(asset.listed).toBe(true);
      expect(asset.name.startsWith("Test ")).toBe(true);
    }
  });

  it("accepts 6, 8 and 18 decimals only", () => {
    expect(SUPPORTED_STOCK_DECIMALS).toEqual([6, 8, 18]);
    for (const decimals of [6, 8, 18]) {
      expect(isSupportedStockDecimals(decimals)).toBe(true);
    }
    for (const decimals of [0, 1, 12, 19, 77]) {
      expect(isSupportedStockDecimals(decimals)).toBe(false);
    }
  });

  it("rejects a malformed symbol or unsupported decimals", () => {
    expect(() => assertAssetDefinition({ ...baseAsset, symbol: "1AAPL" })).toThrow(CoreError);
    expect(() => assertAssetDefinition({ ...baseAsset, symbol: "t-AAPL" })).toThrow(CoreError);
    expect(() => assertAssetDefinition({ ...baseAsset, symbol: "" })).toThrow(CoreError);
    expect(() => assertAssetDefinition({ ...baseAsset, symbol: "A".repeat(11) })).toThrow(
      CoreError,
    );
    expect(() => assertAssetDefinition({ ...baseAsset, stockDecimals: 12 as never })).toThrow(
      CoreError,
    );
    expect(() =>
      assertAssetDefinition({ ...baseAsset, priceSourceKind: "unknown" as never }),
    ).toThrow(CoreError);
  });

  it("rejects duplicate symbols", () => {
    expect(() => new AssetRegistry([baseAsset, { ...baseAsset }])).toThrow(CoreError);
  });

  it("fails closed for unknown symbols", () => {
    expect(testnetAssetRegistry.has("tAAPL")).toBe(true);
    expect(testnetAssetRegistry.has("tMSFT")).toBe(true);
    expect(testnetAssetRegistry.has("tDOGE")).toBe(false);
    expect(() => testnetAssetRegistry.get("tDOGE")).toThrow(CoreError);
    try {
      testnetAssetRegistry.get("tDOGE");
    } catch (error) {
      expect((error as CoreError).code).toBe("UNSUPPORTED_ASSET");
    }
  });

  it("never lists delisted assets as tradable", () => {
    const registry = new AssetRegistry([
      baseAsset,
      { ...baseAsset, symbol: "tOLD", listed: false },
    ]);
    expect(registry.get("tOLD").listed).toBe(false);
    expect(registry.listTradable().map((asset) => asset.symbol)).toEqual(["tTEST"]);
  });
});
