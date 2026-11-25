"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { ChartRange, EnvironmentInfo, MarketDetail } from "../lib/market-types";
import { api } from "../lib/api";
import {
  assetDisplayName,
  contractsLabel,
  environmentDisclosure,
  environmentShortLabel,
  observationBadge,
  priceSourceLabel,
  settlementDisplayName,
} from "../lib/presentation";
import {
  formatCompact,
  formatPct,
  formatPrice,
  formatTokenAmount,
  formatUtc,
  pctDirectionLabel,
  pctTone,
  rangeLabel,
  timeAgo,
  toNumber,
} from "../lib/format";
import { useAccount } from "./account-provider";
import { PriceChart } from "./charts";
import { AssetMark } from "./live-markets";
import { MarketHoursBadge } from "./market-hours-badge";
import { TradePanel } from "./trade-panel";
import { ArrowUpRight, ChevronDown, InfoIcon, LayersIcon, ShieldIcon } from "./icons";

const RANGES: ChartRange[] = ["1D", "1W", "1M", "3M"];

export function MarketDetailView({ symbol }: { symbol: string }) {
  const [range, setRange] = useState<ChartRange>("1W");
  const [market, setMarket] = useState<MarketDetail | null>(null);
  const [marketEnvironment, setMarketEnvironment] = useState<EnvironmentInfo | null>(null);
  const [error, setError] = useState("");
  const { portfolio, session, environment: sessionEnvironment } = useAccount();
  const environment = marketEnvironment ?? sessionEnvironment;

  useEffect(() => {
    let active = true;
    setMarket(null);
    const load = async () => {
      try {
        const payload = await api<{ market: MarketDetail; environment?: EnvironmentInfo }>(
          `/api/markets/${encodeURIComponent(symbol)}?range=${range}`,
        );
        if (active) {
          setMarket(payload.market);
          setMarketEnvironment(payload.environment ?? null);
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
        <div className="callout callout-danger" role="alert" aria-live="assertive">
          {error}
        </div>
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
  const change24h = toNumber(market.change24hPct);
  const rangeChange = toNumber(market.changeRangePct);
  const tone = pctTone(rangeChange);
  const price = toNumber(market.priceUsdc);
  const available = market.fresh && price !== null;

  return (
    <div className="page-width page-stack">
      <div className="breadcrumb">
        <Link href="/markets">Markets</Link>
        <ChevronDown size={13} className="breadcrumb-sep" />
        <span>{assetDisplayName(asset.symbol)}</span>
      </div>

      <header className="asset-head">
        <div className="asset-head-main">
          <AssetMark asset={asset} size={52} />
          <div>
            <div className="asset-title">
              <h1>{assetDisplayName(asset.symbol)}</h1>
              <span className="sim-badge">{observationBadge(environment, market)}</span>
              <MarketHoursBadge />
              <span className="muted small">{environmentShortLabel(environment)}</span>
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
            <span className="price-unit">{settlementDisplayName()}</span>
          </div>
          <span className={`change ${pctTone(change24h)}`}>{formatPct(change24h)} · 24h</span>
        </div>
      </header>

      {!available && (
        <div className="callout callout-warn" role="status">
          {market.fresh
            ? "Reference price unavailable. Trade estimates and quotes are disabled."
            : "Reference price stale. Trade estimates and quotes are disabled until a fresh observation arrives."}
        </div>
      )}

      <div className="detail-grid">
        <section className="panel chart-panel">
          <div className="chart-head">
            <div>
              <h2>Reference price</h2>
              <p className="muted small">
                {rangeLabel(range)} ·{" "}
                {rangeChange === null
                  ? "change unavailable"
                  : `${pctDirectionLabel(rangeChange)} ${formatPct(rangeChange)}`}{" "}
                over the selected range
              </p>
            </div>
            <div className="segmented segmented-small" role="group" aria-label="Chart range">
              {RANGES.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={range === value}
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
              <strong>
                {formatCompact(market.volume24hUsdc)} {settlementDisplayName()}
              </strong>
            </div>
            <div>
              <span>Observation</span>
              <strong>{available ? timeAgo(market.sourceUpdatedAt) : "stale / unavailable"}</strong>
            </div>
          </div>
        </section>

        <div className="detail-side">
          {session !== null && (
            <section className="panel position-card">
              <div className="panel-head-inline">
                <span className="eyebrow">Your position</span>
                <span className={`freshness ${available ? "is-fresh" : "is-stale"}`}>
                  <span className="dot" /> {available ? "fresh" : "stale"}
                </span>
              </div>
              <div className="position-amount">
                <strong>{position === null ? "0" : formatTokenAmount(position.amount, 6)}</strong>
                <span>{assetDisplayName(asset.symbol)}</span>
              </div>
              <div className="position-value">
                <span>Value</span>
                <strong>
                  {position?.valueUsdc === null || position?.valueUsdc === undefined
                    ? "—"
                    : `${formatPrice(position.valueUsdc)} ${settlementDisplayName()}`}
                </strong>
              </div>
              <div className="position-value">
                <span>24h change</span>
                <strong className={pctTone(position?.change24hPct)}>
                  {position?.change24hUsdc === undefined || position?.change24hUsdc === null
                    ? "—"
                    : `${formatPrice(position.change24hUsdc)} ${settlementDisplayName()} (${formatPct(position.change24hPct)})`}
                </strong>
              </div>
              <div className="position-value">
                <span>
                  {position?.simulated && position.avgCostUsdc != null
                    ? "Simulated avg cost"
                    : "Average cost"}
                </span>
                <strong>
                  {position?.avgCostUsdc === undefined || position.avgCostUsdc === null
                    ? "unavailable"
                    : `${formatPrice(position.avgCostUsdc)} ${settlementDisplayName()}`}
                </strong>
              </div>
              <div className="position-value">
                <span>
                  {position?.simulated && position.unrealizedPnlUsdc != null
                    ? "Simulated P&L"
                    : "Average-cost P&L"}
                </span>
                <strong className={pctTone(position?.unrealizedPnlPct)}>
                  {position?.unrealizedPnlUsdc === undefined || position.unrealizedPnlUsdc === null
                    ? "unavailable"
                    : `${formatPrice(position.unrealizedPnlUsdc)} ${settlementDisplayName()} (${formatPct(position.unrealizedPnlPct)})`}
                </strong>
              </div>
            </section>
          )}
          <TradePanel asset={asset} snapshot={market} environmentOverride={environment} />
          <section className="panel side-note">
            <h3>Settlement rules</h3>
            <ul>
              {environment?.mode === "demo" ? (
                <li>Preview fills update off-chain balances at the reference price.</li>
              ) : (
                <li>Buys mint the stock token at the reference price.</li>
              )}
              {environment?.mode !== "demo" && <li>Sells burn it back for test settlement.</li>}
              <li>Policy checks run again at execution.</li>
              {environment?.mode === "demo" && <li>Preview fills never touch a blockchain.</li>}
              {environment?.mode === "local-anvil" && (
                <li>Transactions stay on the local Anvil testnet.</li>
              )}
              {environment?.mode === "base-sepolia" && (
                <li>Settlement is limited to Base Sepolia testnet contracts.</li>
              )}
            </ul>
          </section>
        </div>
      </div>

      <div className="detail-lower">
        <section className="panel prose-panel">
          <h2>About {assetDisplayName(asset.symbol)}</h2>
          <p>{asset.description}</p>
          <p>
            The token is a reference-price instrument for {asset.underlying}. It is not a share
            certificate, carries no voting rights, and has no real-world redemption value. Test
            tokens. No real value. Not real shares. Not investment advice.{" "}
            {environmentDisclosure(environment)}
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
              <dd>
                {market.simulated ? "simulated reference feed" : priceSourceLabel(environment)}
              </dd>
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
              <dd>
                {environment?.mode === "demo"
                  ? "Off-chain demo · no settlement chain"
                  : environment === null
                    ? "Checking…"
                    : `${environment.chainName} · ${environment.chainId}`}
              </dd>
            </div>
            <div>
              <dt>Contracts</dt>
              <dd>{contractsLabel(environment)}</dd>
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
            <li>1 test USDC unit minimum, 1,000 maximum per order</li>
            <li>5,000 test USDC units daily notional across all instruments</li>
            <li>Quotes are valid for 30 seconds and are recomputed at execution</li>
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
