"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { EnvironmentInfo, MarketAsset, MarketSnapshot } from "../lib/market-types";
import { formatCompact, formatPct, formatPrice, pctTone, timeAgo, toNumber } from "../lib/format";
import { api } from "../lib/api";
import {
  assetDisplayName,
  environmentShortLabel,
  observationBadge,
  priceSourceLabel,
  settlementDisplayName,
} from "../lib/presentation";
import { Sparkline } from "./charts";
import { ArrowUpRight, MinusIcon, PlusIcon, SearchIcon } from "./icons";

export interface MarketRow {
  asset: MarketAsset;
  snapshot: MarketSnapshot;
  sparkline: number[];
}

interface MarketsResponse {
  environment: EnvironmentInfo;
  asOf: number;
  markets: MarketRow[];
}

export function useMarkets() {
  const [data, setData] = useState<MarketsResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const payload = await api<MarketsResponse>("/api/markets");
        if (active) {
          setData(payload);
          setError("");
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Market data is unavailable.");
      }
    };
    void load();
    const timer = setInterval(() => void load(), 20_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return { data, error };
}

export function AssetMark({ asset, size = 38 }: { asset: MarketAsset; size?: number }) {
  const initial = assetDisplayName(asset.symbol).slice(0, 1);
  return (
    <span
      className="asset-mark"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(145deg, ${asset.accent}26, ${asset.accent}0d)`,
        borderColor: `${asset.accent}40`,
        color: asset.accent,
      }}
      aria-hidden="true"
    >
      <svg className="asset-mark-glyph" viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <circle cx="20" cy="20" r="14.5" stroke="currentColor" strokeOpacity=".24" />
        <path
          d="M8 25.5 15 19l5 3 11-10"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity=".62"
        />
        <circle cx="31" cy="12" r="2" fill="currentColor" />
      </svg>
      <span className="asset-mark-letter">{initial}</span>
    </span>
  );
}

export function LandingMarkets() {
  const { data, error } = useMarkets();

  if (error.length > 0) {
    return (
      <p className="muted" role="alert" aria-live="assertive">
        Market data is temporarily unavailable. {error}
      </p>
    );
  }
  if (data === null) {
    return (
      <div className="market-cards">
        {[0, 1, 2].map((index) => (
          <div className="market-card skeleton-card" key={index}>
            <span className="skeleton skeleton-line short" />
            <span className="skeleton skeleton-line tall" />
            <span className="skeleton skeleton-line" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="market-cards">
      {data.markets.map((market, index) => (
        <Link
          className="market-card"
          href={`/markets/${market.asset.symbol}`}
          key={market.asset.symbol}
          style={{ animationDelay: `${index * 70}ms` }}
        >
          <div className="market-card-head">
            <div className="market-identity">
              <AssetMark asset={market.asset} />
              <div>
                <strong>{assetDisplayName(market.asset.symbol)}</strong>
                <span>{market.asset.name}</span>
              </div>
            </div>
            <span className="sim-badge">{observationBadge(data.environment, market.snapshot)}</span>
            {!market.snapshot.fresh && <span className="status-pill warn">stale</span>}
          </div>
          <div className="market-card-price">
            <span className="price-value">{formatPrice(market.snapshot.priceUsdc)}</span>
            <span className="price-unit">{settlementDisplayName()}</span>
          </div>
          <div className="market-card-foot">
            <span className={`change ${pctTone(toNumber(market.snapshot.change24hPct))}`}>
              {(toNumber(market.snapshot.change24hPct) ?? 0) > 0 && <PlusIcon size={12} />}
              {(toNumber(market.snapshot.change24hPct) ?? 0) < 0 && <MinusIcon size={12} />}
              {formatPct(toNumber(market.snapshot.change24hPct))} · 24h
            </span>
            <Sparkline
              points={market.sparkline}
              tone={pctTone(toNumber(market.snapshot.change24hPct))}
              width={112}
              height={36}
            />
          </div>
        </Link>
      ))}
    </div>
  );
}

type SortKey = "symbol" | "price" | "change" | "volume";

export function MarketsExplorer() {
  const { data, error } = useMarkets();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("volume");

  const rows = useMemo(() => {
    const list = [...(data?.markets ?? [])];
    const filtered = list.filter((row) => {
      const needle = query.trim().toLowerCase();
      if (needle.length === 0) return true;
      return (
        row.asset.symbol.toLowerCase().includes(needle) ||
        row.asset.name.toLowerCase().includes(needle) ||
        row.asset.underlying.toLowerCase().includes(needle)
      );
    });
    filtered.sort((a, b) => {
      switch (sort) {
        case "symbol":
          return a.asset.symbol.localeCompare(b.asset.symbol);
        case "price":
          return (
            (toNumber(b.snapshot.priceUsdc) ?? -Infinity) -
            (toNumber(a.snapshot.priceUsdc) ?? -Infinity)
          );
        case "change":
          return (
            (toNumber(b.snapshot.change24hPct) ?? -Infinity) -
            (toNumber(a.snapshot.change24hPct) ?? -Infinity)
          );
        default:
          return (
            (toNumber(b.snapshot.volume24hUsdc) ?? -Infinity) -
            (toNumber(a.snapshot.volume24hUsdc) ?? -Infinity)
          );
      }
    });
    return filtered;
  }, [data, query, sort]);

  return (
    <div className="explorer">
      <div className="explorer-toolbar">
        <label className="search-field">
          <SearchIcon size={16} />
          <input
            type="search"
            placeholder="Search markets"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search markets"
          />
        </label>
        <div className="segmented segmented-small" role="group" aria-label="Sort markets">
          {(
            [
              ["volume", "Volume"],
              ["change", "24h"],
              ["price", "Price"],
              ["symbol", "A–Z"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={sort === key}
              className={sort === key ? "is-active" : ""}
              onClick={() => setSort(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error.length > 0 && (
        <div className="callout callout-danger" role="alert" aria-live="assertive">
          {error}
        </div>
      )}

      <div className="market-table-wrap">
        <table className="market-table">
          <thead>
            <tr>
              <th>Market</th>
              <th className="align-right">Reference price</th>
              <th className="align-right">24h</th>
              <th className="hide-sm align-right">24h volume</th>
              <th className="hide-sm">Last observation</th>
              <th aria-label="Open" />
            </tr>
          </thead>
          <tbody>
            {data === null &&
              [0, 1, 2].map((index) => (
                <tr key={index} className="skeleton-row">
                  <td>
                    <span className="skeleton skeleton-line" />
                  </td>
                  <td colSpan={5}>
                    <span className="skeleton skeleton-line" />
                  </td>
                </tr>
              ))}
            {rows.map((row) => (
              <tr key={row.asset.symbol}>
                <td>
                  <Link className="market-cell" href={`/markets/${row.asset.symbol}`}>
                    <AssetMark asset={row.asset} size={34} />
                    <span>
                      <strong>{assetDisplayName(row.asset.symbol)}</strong>
                      <small>{row.asset.name}</small>
                    </span>
                  </Link>
                </td>
                <td className="align-right">
                  <div className="table-price">
                    <strong>{formatPrice(row.snapshot.priceUsdc)}</strong>
                    <small>{settlementDisplayName()}</small>
                  </div>
                </td>
                <td
                  className={`align-right change ${pctTone(toNumber(row.snapshot.change24hPct))}`}
                >
                  {formatPct(toNumber(row.snapshot.change24hPct))}
                </td>
                <td className="hide-sm align-right mono">
                  {formatCompact(row.snapshot.volume24hUsdc)} {settlementDisplayName()}
                </td>
                <td className="hide-sm">
                  <span className={`freshness ${row.snapshot.fresh ? "is-fresh" : "is-stale"}`}>
                    <span className="dot" />
                    {row.snapshot.fresh && toNumber(row.snapshot.sourceUpdatedAt) !== null
                      ? timeAgo(row.snapshot.sourceUpdatedAt)
                      : "stale · unavailable"}
                  </span>
                </td>
                <td className="align-right">
                  <Link className="row-action" href={`/markets/${row.asset.symbol}`}>
                    Trade <ArrowUpRight size={14} />
                  </Link>
                </td>
              </tr>
            ))}
            {data !== null && rows.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <p className="empty-cell">No markets match “{query}”.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="explorer-foot">
        <span className={`env-chip ${data?.environment.simulated ? "is-simulated" : "is-live"}`}>
          <span className="env-dot" />
          {environmentShortLabel(data?.environment)}
        </span>
        <span className="muted small">{priceSourceLabel(data?.environment)}</span>
        <span className="muted small">
          {data === null ? "Loading…" : `Updated ${timeAgo(data.asOf)} · prices refresh every 20s`}
        </span>
      </div>
    </div>
  );
}

export function HeroMarket() {
  const { data } = useMarkets();
  const market = data?.markets.find((row) => row.asset.symbol === "tAAPL") ?? data?.markets[0];

  return (
    <div className="hero-card">
      <div className="hero-card-top">
        <div className="market-identity">
          {market !== undefined && <AssetMark asset={market.asset} size={40} />}
          <div>
            <strong>{assetDisplayName(market?.asset.symbol ?? "tAAPL")}</strong>
            <span>{market?.asset.name ?? "Simulated test instrument"}</span>
          </div>
        </div>
        <span className="sim-badge">
          {market === undefined ? "checking" : observationBadge(data?.environment, market.snapshot)}
        </span>
        {market !== undefined && !market.snapshot.fresh && (
          <span className="status-pill warn">stale</span>
        )}
      </div>
      <div className="hero-card-price">
        <span>{market === undefined ? "—" : formatPrice(market.snapshot.priceUsdc)}</span>
        <small>{settlementDisplayName()}</small>
        <span className={`change ${pctTone(toNumber(market?.snapshot.change24hPct))}`}>
          {formatPct(toNumber(market?.snapshot.change24hPct))}
        </span>
      </div>
      <div className="hero-card-chart">
        {market !== undefined && (
          <Sparkline
            points={market.sparkline}
            tone={pctTone(toNumber(market.snapshot.change24hPct))}
            width={420}
            height={120}
          />
        )}
      </div>
      <div className="hero-card-stats">
        <div>
          <span>24h high</span>
          <strong>{formatPrice(market?.snapshot.high24hUsdc)}</strong>
        </div>
        <div>
          <span>24h low</span>
          <strong>{formatPrice(market?.snapshot.low24hUsdc)}</strong>
        </div>
        <div>
          <span>Volume</span>
          <strong>{formatCompact(market?.snapshot.volume24hUsdc)}</strong>
        </div>
      </div>
      <div className="hero-card-actions">
        <Link
          className="button button-primary button-small"
          href={market === undefined ? "/markets" : `/markets/${market.asset.symbol}`}
        >
          Open market
        </Link>
        <Link className="button button-ghost button-small" href="/markets">
          All markets
        </Link>
      </div>
      <span className="hero-card-glow" aria-hidden="true" />
    </div>
  );
}
