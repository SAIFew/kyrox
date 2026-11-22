import type { PriceObservation } from "@kyrox/core";

import type { RuntimeEnvironment } from "./env.js";

/**
 * Simulation labels are derived from the runtime environment and the persisted
 * observation, never hardcoded per response. A production Chainlink quote must
 * stay unlabelled; a feedless local observation must stay visibly simulated.
 */
export function quoteSimulationFlags(
  mode: RuntimeEnvironment["mode"],
  observation: Pick<PriceObservation, "feedAddress" | "sourceKind">,
): { simulated: boolean; simulatedPrice: boolean } {
  const simulatedPrice =
    mode === "local-anvil" ||
    observation.feedAddress === null ||
    observation.sourceKind === "simulated";
  return {
    simulated: mode === "local-anvil",
    simulatedPrice,
  };
}
