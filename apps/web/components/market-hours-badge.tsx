"use client";

import { useEffect, useState } from "react";

import { usEquityMarketState, type UsEquityMarketState } from "../lib/market-hours";

/**
 * Reference-market session badge.
 *
 * Testnet trading never pauses, so this badge is informational: it warns that the
 * underlying US reference market is closed. It is intentionally rendered only
 * after mount so server and client clocks cannot disagree during hydration.
 */
export function MarketHoursBadge() {
  const [state, setState] = useState<UsEquityMarketState | null>(null);

  useEffect(() => {
    const update = () => setState(usEquityMarketState());
    update();
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, []);

  if (state === null || state.session === "open") return null;

  return (
    <span
      className="sim-badge market-hours-badge"
      title="The US reference market is closed. KYROX testnet trading remains open."
    >
      {state.label}
    </span>
  );
}
