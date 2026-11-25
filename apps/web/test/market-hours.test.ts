import { describe, expect, it } from "vitest";

import { newYorkClock, usEquityMarketState } from "../lib/market-hours.js";

describe("US equity market clock", () => {
  it("reads New York wall time independently of the host time zone", () => {
    expect(newYorkClock(new Date("2026-11-25T15:00:00Z"))).toEqual({
      dateKey: "2026-11-25",
      weekday: 3,
      minutesSinceMidnight: 10 * 60,
    });
    expect(newYorkClock(new Date("2026-06-22T14:00:00Z"))).toEqual({
      dateKey: "2026-06-22",
      weekday: 1,
      minutesSinceMidnight: 10 * 60,
    });
  });

  it("opens at 09:30 ET and closes at 16:00 ET", () => {
    expect(usEquityMarketState(new Date("2026-11-25T14:29:00Z")).session).toBe("closed");
    expect(usEquityMarketState(new Date("2026-11-25T14:29:00Z")).reason).toBe("Before the US open");
    expect(usEquityMarketState(new Date("2026-11-25T14:30:00Z")).session).toBe("open");
    expect(usEquityMarketState(new Date("2026-11-25T20:59:00Z")).session).toBe("open");
    expect(usEquityMarketState(new Date("2026-11-25T21:00:00Z")).session).toBe("closed");
    expect(usEquityMarketState(new Date("2026-11-25T21:00:00Z")).reason).toBe("After the US close");
  });

  it("handles daylight-saving time through the New York time zone", () => {
    // 10:00 EDT (UTC-4) is open; the same UTC clock would be 09:00 in winter.
    expect(usEquityMarketState(new Date("2026-06-22T14:00:00Z")).session).toBe("open");
    expect(usEquityMarketState(new Date("2026-06-22T13:29:00Z")).session).toBe("closed");
  });

  it("closes on weekends and NYSE holidays", () => {
    expect(usEquityMarketState(new Date("2026-11-28T15:00:00Z"))).toMatchObject({
      session: "closed",
      reason: "Weekend",
    });
    expect(usEquityMarketState(new Date("2026-11-26T15:00:00Z"))).toMatchObject({
      session: "closed",
      reason: "US market holiday",
    });
    expect(usEquityMarketState(new Date("2026-12-25T15:00:00Z")).reason).toBe("US market holiday");
  });

  it("honours 13:00 ET early closes", () => {
    expect(usEquityMarketState(new Date("2026-11-27T17:59:00Z")).session).toBe("open");
    expect(usEquityMarketState(new Date("2026-11-27T18:00:00Z"))).toMatchObject({
      session: "closed",
      reason: "After the US close",
    });
  });

  it("fails closed when the clock is unusable", () => {
    expect(usEquityMarketState(new Date(Number.NaN))).toMatchObject({
      session: "closed",
      reason: "Clock unavailable",
    });
  });
});
