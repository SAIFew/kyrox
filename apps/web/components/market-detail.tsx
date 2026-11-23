"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { ChartRange, MarketDetail } from "../lib/market-types";
import { api } from "../lib/api";
import {
  formatCompact,
  formatPct,
  formatPrice,
  formatTokenAmount,
  pctTone,
  rangeLabel,
  timeAgo,
} from "../lib/format";
import { useAccount } from "./account-provider";
import { PriceChart } from "./charts";
import { AssetMark } from "./live-markets";
import { TradePanel } from "./trade-panel";
import { ArrowUpRight, ChevronDown, InfoIcon, LayersIcon, ShieldIcon } from "./icons";

const RANGES: ChartRange[] = ["1D", "1W", "1M", "3M"];

function formatUtc(seconds: number): string {
  return `${new Date(seconds * 1_000).toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

export function MarketDetailView({ symbol }: { symbol: string }) {
  const [range, setRange] = useState<ChartRange>("1W");
  const [market, setMarket] = useState<MarketDetail | null>(null);
  const [error, setError] = useState("");
  const { portfolio, session } = useAccount();

  useEffect(() => {
    let active = true;
    setMarket(null);
    const load = async () => {
      try {
        const payload = await api<{ market: MarketDetail }>(
          `/api/markets/${encodeURIComponent(symbol)}?range=${range}`,
        );
        if (active) {
          setMarket(payload.market);
          setError("");
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Market is unavailable.");
      }
    };
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [symbol, range]);

  if (error.length > 0) {
    return (
      <div className="page-width page-stack">
        <div className="callout callout-danger">{error}</div>
        <Link className="text-link" href="/markets">
          ← Back to markets
        </Link>
      </div>
    );
  }

  if (market === null) {
    return (
      <div className="page-width page-stack">
        <div className="detail-skeleton">
          <span className="skeleton skeleton-line short" />
          <span className="skeleton skeleton-line hero" />
          <span className="skeleton skeleton-block" />
        </div>
      </div>
    );
  }

  const asset = market.asset;
  const position = portfolio?.positions.find((entry) => entry.symbol === symbol) ?? null;
  const tone = pctTone(market.changeRangePct);

  return (
    <div className="page-width page-stack">
      <div className="breadcrumb">
        <Link href="/markets">Markets</Link>
        <ChevronDown size={13} className="breadcrumb-sep" />
        <span>{asset.symbol}</span>
      </div>

      <header className="asset-head">
        <div className="asset-head-main">
          <AssetMark asset={asset} size={52} />
          <div>
            <div className="asset-title">
              <h1>{asset.symbol}</h1>
              <span className="sim-badge">simulated</span>
            </div>
            <p>
              {asset.name} <span className="dot-sep">·</span> {asset.sector}{" "}
              <span className="dot-sep">·</span> {asset.decimals} decimals
            </p>
          </div>
        </div>
        <div className="asset-price">
          <div>
            <span className="price-value">{formatPrice(market.priceUsdc)}</span>
            <span className="price-unit">tUSDC</span>
          </div>
          <span className={`change ${pctTone(market.change24hPct)}`}>
            {formatPct(market.change24hPct)} · 24h
          </span>
        </div>
      </header>

      <div className="detail-grid">
        <section className="panel chart-panel">
          <div className="chart-head">
            <div>
              <h2>Reference price</h2>
              <p className="muted small">
                {rangeLabel(range)} · {market.changeRangePct >= 0 ? "up" : "down"}{" "}
                {Math.abs(market.changeRangePct).toFixed(2)}% over the selected range
              </p>
            </div>
            <div className="segmented segmented-small" role="group" aria-label="Chart range">
              {RANGES.map((value) => (
                <button
                  key={value}
                  className={range === value ? "is-active" : ""}
                  onClick={() => setRange(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          <PriceChart points={market.history} tone={tone} height={330} />
          <div className="chart-stats">
            <div>
              <span>Range high</span>
              <strong>{formatPrice(market.highRangeUsdc)}</strong>
            </div>
            <div>
              <span>Range low</span>
              <strong>{formatPrice(market.lowRangeUsdc)}</strong>
            </div>
            <div>
              <span>24h high</span>
              <strong>{formatPrice(market.high24hUsdc)}</strong>
            </div>
            <div>
              <span>24h low</span>
              <strong>{formatPrice(market.low24hUsdc)}</strong>
            </div>
            <div>
              <span>24h volume</span>
              <strong>{formatCompact(market.volume24hUsdc)} tUSDC</strong>
            </div>
            <div>
              <span>Observation</span>
              <strong>{timeAgo(market.sourceUpdatedAt)}</strong>
            </div>
          </div>
        </section>

        <div className="detail-side">
          {session !== null && (
            <section className="panel position-card">
              <div className="panel-head-inline">
                <span className="eyebrow">Your position</span>
                <span className={`freshness ${market.fresh ? "is-fresh" : "is-stale"}`}>
                  <span className="dot" /> {market.fresh ? "fresh" : "stale"}
                </span>
              </div>
              <div className="position-amount">
                <strong>{position === null ? "0" : formatTokenAmount(position.amount, 6)}</strong>
                <span>{asset.symbol}</span>
              </div>
              <div className="position-value">
                <span>Value</span>
                <strong>
                  {position?.valueUsdc === null || position?.valueUsdc === undefined
                    ? "—"
                    : `${formatPrice(position.valueUsdc)} tUSDC`}
                </strong>
              </div>
              <div className="position-value">
                <span>24h change</span>
                <strong className={pctTone(position?.change24hPct)}>
                  {position?.change24hUsdc === undefined || position?.change24hUsdc === null
                    ? "—"
                    : `${formatPrice(position.change24hUsdc)} tUSDC (${formatPct(position.change24hPct)})`}
                </strong>
              </div>
            </section>
          )}
          <TradePanel asset={asset} snapshot={market} />
          <section className="panel side-note">
            <h3>Settlement rules</h3>
            <ul>
              <li>Buys mint the stock token at the reference price.</li>
              <li>Sells burn it back for test settlement.</li>
              <li>Policy checks run again at execution.</li>
              <li>Preview fills never touch a blockchain.</li>
            </ul>
          </section>
        </div>
      </div>

      <div className="detail-lower">
        <section className="panel prose-panel">
          <h2>About {asset.symbol}</h2>
          <p>{asset.description}</p>
          <p>
            The token is a reference-price instrument for {asset.underlying}. It is not a share
            certificate, carries no voting rights, and in this preview it is not deployed to any
            chain. Holdings shown here are simulated.
          </p>
          <div className="pill-row">
            <span className="pill">Fixed reference price</span>
            <span className="pill">No AMM</span>
            <span className="pill">Floor rounding</span>
            <span className="pill">Allowlisted</span>
          </div>
        </section>

        <section className="panel provenance-panel">
          <h2>
            <LayersIcon size={17} /> Provenance
          </h2>
          <dl className="kv-list">
            <div>
              <dt>Source kind</dt>
              <dd>Simulated deterministic feed</dd>
            </div>
            <div>
              <dt>Source updated</dt>
              <dd>
                {formatUtc(market.sourceUpdatedAt)} ({timeAgo(market.sourceUpdatedAt)})
              </dd>
            </div>
            <div>
              <dt>Observed at</dt>
              <dd>{formatUtc(market.observedAt)}</dd>
            </div>
            <div>
              <dt>Chain</dt>
              <dd>Base Sepolia · 84532</dd>
            </div>
            <div>
              <dt>Contracts</dt>
              <dd>Not deployed in this preview</dd>
            </div>
          </dl>
          <div className="callout callout-warn compact">
            <InfoIcon size={15} />
            <p>
              The source timestamp is preserved separately from observation time. A stale value is
              never re-dated to look fresh.
            </p>
          </div>
        </section>

        <section className="panel prose-panel">
          <h2>
            <ShieldIcon size={17} /> Trade policy
          </h2>
          <ul className="check-list">
            <li>1 tUSDC minimum, 1,000 tUSDC maximum per order</li>
            <li>5,000 tUSDC daily notional across all instruments</li>
            <li>Quotes expire after 120 seconds and are recomputed at execution</li>
            <li>Price drift beyond tolerance fails closed</li>
            <li>Exact allowance only — no unlimited approvals</li>
          </ul>
          <Link className="text-link" href="/status">
            See full environment status <ArrowUpRight size={14} />
          </Link>
        </section>
      </div>
    </div>
  );
}
