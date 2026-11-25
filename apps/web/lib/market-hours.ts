/**
 * US equity regular-session clock (America/New_York).
 *
 * KYROX testnet trading is always available because the Sepolia exchange does
 * not have a market calendar. The *reference* market does close, though, and the
 * Testnet MVP plan asks for an explicit "US market closed" badge so users never
 * mistake a weekend or holiday quote for a live session. This module computes
 * only that label; it never blocks a trade.
 */

export type UsEquitySession = "open" | "closed";

export interface UsEquityMarketState {
  readonly session: UsEquitySession;
  /** Short label suitable for a badge. */
  readonly label: "US market open" | "US market closed";
  /** Why the session is closed; empty when open. */
  readonly reason: string;
}

const NEW_YORK = "America/New_York";

/** NYSE full-day closures. Early-close days are handled separately. */
const FULL_HOLIDAYS: ReadonlySet<string> = new Set([
  // 2025
  "2025-01-01",
  "2025-01-20",
  "2025-02-17",
  "2025-04-18",
  "2025-05-26",
  "2025-06-19",
  "2025-07-04",
  "2025-09-01",
  "2025-11-27",
  "2025-12-25",
  // 2026
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
  // 2027
  "2027-01-01",
  "2027-01-18",
  "2027-02-15",
  "2027-03-26",
  "2027-05-31",
  "2027-06-18",
  "2027-07-05",
  "2027-09-06",
  "2027-11-25",
  "2027-12-24",
]);

/** NYSE 13:00 ET early closes. */
const EARLY_CLOSES: ReadonlySet<string> = new Set([
  "2025-07-03",
  "2025-11-28",
  "2025-12-24",
  "2026-11-27",
  "2026-12-24",
  "2027-11-26",
]);

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

interface NewYorkClock {
  readonly dateKey: string;
  readonly weekday: number;
  readonly minutesSinceMidnight: number;
}

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NEW_YORK,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Read the wall clock in New York without relying on the host time zone. */
export function newYorkClock(now: Date): NewYorkClock {
  const parts = formatter.formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  const year = value("year");
  const month = value("month");
  const day = value("day");
  const weekdayName = value("weekday");
  const hour = Number(value("hour"));
  const minute = Number(value("minute"));

  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) {
    throw new Error("Could not resolve the America/New_York calendar date.");
  }
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error("Could not resolve the America/New_York wall clock.");
  }

  const weekday = WEEKDAY_INDEX[weekdayName];
  if (weekday === undefined) {
    throw new Error(`Unexpected weekday label: ${weekdayName}.`);
  }

  return {
    dateKey: `${year}-${month}-${day}`,
    weekday,
    minutesSinceMidnight: hour * 60 + minute,
  };
}

/**
 * Decide whether the US regular session is open.
 *
 * Regular hours are 09:30–16:00 ET, Monday–Friday, excluding full holidays.
 * Early-close days end at 13:00 ET. Outside hours the result is "closed" with a
 * plain reason. Invalid dates fail closed.
 */
export function usEquityMarketState(now: Date = new Date()): UsEquityMarketState {
  if (!Number.isFinite(now.getTime())) {
    return { session: "closed", label: "US market closed", reason: "Clock unavailable" };
  }

  let clock: NewYorkClock;
  try {
    clock = newYorkClock(now);
  } catch {
    return { session: "closed", label: "US market closed", reason: "Clock unavailable" };
  }

  if (FULL_HOLIDAYS.has(clock.dateKey)) {
    return { session: "closed", label: "US market closed", reason: "US market holiday" };
  }
  if (clock.weekday === 0 || clock.weekday === 6) {
    return { session: "closed", label: "US market closed", reason: "Weekend" };
  }

  const openMinutes = 9 * 60 + 30;
  const closeMinutes = EARLY_CLOSES.has(clock.dateKey) ? 13 * 60 : 16 * 60;

  if (clock.minutesSinceMidnight < openMinutes) {
    return { session: "closed", label: "US market closed", reason: "Before the US open" };
  }
  if (clock.minutesSinceMidnight >= closeMinutes) {
    return { session: "closed", label: "US market closed", reason: "After the US close" };
  }
  return { session: "open", label: "US market open", reason: "" };
}
