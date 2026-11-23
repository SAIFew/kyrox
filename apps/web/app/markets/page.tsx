import type { Metadata } from "next";
import Link from "next/link";

import { MarketsExplorer } from "../../components/live-markets";
import { ArrowUpRight, InfoIcon, LayersIcon, ShieldIcon } from "../../components/icons";

export const metadata: Metadata = {
  title: "Markets",
  description:
    "Explore KYROX reference markets: tokenized-equity instruments with transparent simulated reference prices, freshness, and policy-constrained quotes.",
};

export default function MarketsPage() {
  return (
    <div className="page-width page-stack">
      <header className="page-head">
        <div>
          <p className="eyebrow">Markets</p>
          <h1>Reference venues, not speculation.</h1>
          <p className="page-lead">
            Each instrument trades against a published reference price. Limits, freshness, and
            simulation status are visible before any order is prepared.
          </p>
        </div>
        <div className="page-head-meta">
          <span className="sim-badge">simulated feed</span>
          <span className="muted small">Chain ID 84532 · Base Sepolia</span>
        </div>
      </header>

      <div className="notice-strip">
        <InfoIcon size={15} />
        <span>
          Public preview: prices are deterministic simulations and the exchange is not deployed.
          Quotes and fills happen in a clearly labelled simulated venue.
        </span>
      </div>

      <MarketsExplorer />

      <section className="info-grid">
        <article className="info-card">
          <span className="pillar-icon">
            <LayersIcon size={17} />
          </span>
          <h3>Fixed-reference mint / burn</h3>
          <p>
            No order book, no AMM, no routing. Buys mint stock tokens against the reference price;
            sells burn them back to settlement.
          </p>
        </article>
        <article className="info-card">
          <span className="pillar-icon">
            <ShieldIcon size={17} />
          </span>
          <h3>Bounded by policy</h3>
          <p>
            1 tUSDC minimum, 1,000 tUSDC maximum per order, 5,000 tUSDC daily notional, and an
            explicit asset allowlist.
          </p>
        </article>
        <article className="info-card">
          <span className="pillar-icon">
            <InfoIcon size={17} />
          </span>
          <h3>Honest provenance</h3>
          <p>
            The source timestamp is preserved. The observation time is separate. A stale value is
            never rewritten with a fresher-looking clock.
          </p>
        </article>
      </section>

      <div className="inline-cta">
        <div>
          <strong>Ready to inspect a quote?</strong>
          <span>Open any market, choose a side, and walk through the review flow.</span>
        </div>
        <Link className="button button-primary" href="/markets/tAAPL">
          Open tAAPL <ArrowUpRight size={15} />
        </Link>
      </div>
    </div>
  );
}
