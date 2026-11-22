import { describe, expect, it } from "vitest";

import { isObservationFresh } from "../lib/server/freshness.js";

describe("per-asset observation freshness", () => {
  it("uses the supplied per-asset bound, including the boundary", () => {
    expect(isObservationFresh(1_000, 700, 300)).toBe(true);
    expect(isObservationFresh(1_001, 700, 300)).toBe(false);
  });

  it("fails closed when the timestamp or bound is missing or invalid", () => {
    expect(isObservationFresh(1_000, null, 300)).toBe(false);
    expect(isObservationFresh(1_000, undefined, 300)).toBe(false);
    expect(isObservationFresh(1_000, 900, null)).toBe(false);
    expect(isObservationFresh(1_000, 900, 0)).toBe(false);
    expect(isObservationFresh(1_000, 900, -1)).toBe(false);
  });
});
