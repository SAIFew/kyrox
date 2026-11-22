import { describe, expect, it } from "vitest";

import { quoteSimulationFlags } from "../lib/server/labels.js";

const chainlink = {
  feedAddress: "0x1111111111111111111111111111111111111111" as const,
  sourceKind: "chainlink-coinbase" as const,
};

const simulated = {
  feedAddress: null,
  sourceKind: "simulated" as const,
};

describe("quote simulation labels", () => {
  it("labels every local-anvil quote as simulated", () => {
    expect(quoteSimulationFlags("local-anvil", chainlink)).toEqual({
      simulated: true,
      simulatedPrice: true,
    });
  });

  it("does not mislabel a production Chainlink quote", () => {
    expect(quoteSimulationFlags("base-sepolia", chainlink)).toEqual({
      simulated: false,
      simulatedPrice: false,
    });
  });

  it("labels a feedless observation as simulated even in production", () => {
    expect(quoteSimulationFlags("base-sepolia", simulated)).toEqual({
      simulated: false,
      simulatedPrice: true,
    });
  });
});
