"use client";

import Link from "next/link";
import { useState } from "react";
import { encodeFunctionData } from "viem";

import { api } from "../lib/api";
import {
  formatPct,
  formatPrice,
  formatTokenAmount,
  pctTone,
  shortAddress,
  timeAgo,
} from "../lib/format";
import { sendTransaction } from "../lib/wallet";
import { useAccount } from "./account-provider";
import { ActivityList } from "./activity-view";
import {
  ArrowRight,
  ArrowUpRight,
  InfoIcon,
  PlusIcon,
  RefreshIcon,
  ShieldIcon,
  SparkIcon,
  WalletIcon,
} from "./icons";

const CLAIM_ABI = [
  {
    type: "function",
    name: "claimWelcome",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const;

function Donut({
  slices,
}: {
  slices: Array<{ symbol: string; sharePct: number; accent: string }>;
}) {
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 150 150" className="donut" role="img" aria-label="Portfolio allocation">
        <circle
          cx="75"
          cy="75"
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.05)"
          strokeWidth="16"
        />
        {slices.map((slice) => {
          const length = (slice.sharePct / 100) * circumference;
          const dash = `${Math.max(0, length - 2)} ${circumference}`;
          const element = (
            <circle
              key={slice.symbol}
              cx="75"
              cy="75"
              r={radius}
              fill="none"
              stroke={slice.accent}
              strokeWidth="16"
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              strokeLinecap="round"
              transform="rotate(-90 75 75)"
            />
          );
          offset += length;
          return element;
        })}
      </svg>
      <div className="donut-center">
        <span>Assets</span>
        <strong>{slices.length}</strong>
      </div>
    </div>
  );
}

export function PortfolioView() {
  const { ready, session, environment, portfolio, activity, openAuth, refreshAll } = useAccount();
  const [localBusy, setLocalBusy] = useState("");
  const [error, setError] = useState("");

  async function resetPreview() {
    setLocalBusy("reset");
    setError("");
    try {
      const response = await fetch("/api/auth/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      if (!response.ok) throw new Error("Could not reset the preview account.");
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset the preview account.");
    } finally {
      setLocalBusy("");
    }
  }

  async function claimFaucet() {
    if (session === null) return;
    setLocalBusy("faucet");
    setError("");
    try {
      const assets = await api<{ settlement: string }>("/api/assets");
      await sendTransaction({
        from: session.address as `0x${string}`,
        to: assets.settlement as `0x${string}`,
        data: encodeFunctionData({ abi: CLAIM_ABI, functionName: "claimWelcome" }),
      });
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Faucet request failed.");
    } finally {
      setLocalBusy("");
    }
  }

  if (!ready) {
    return (
      <div className="page-width page-stack">
        <span className="skeleton skeleton-line short" />
        <span className="skeleton skeleton-line hero" />
        <span className="skeleton skeleton-block" />
      </div>
    );
  }

  if (session === null) {
    return (
      <div className="page-width page-stack">
        <header className="page-head">
          <div>
            <p className="eyebrow">Portfolio</p>
            <h1>Your positions, without the fog.</h1>
            <p className="page-lead">
              Sign in to see balances, allocation, and 24h movement. The preview account starts with
              25,000 simulated tUSDC.
            </p>
          </div>
        </header>
        <div className="empty-state panel">
          <span className="empty-icon">
            <WalletIcon size={26} />
          </span>
          <h2>No active session</h2>
          <p>
            Continue with the simulated preview account, or prove ownership of a wallet. KYROX never
            holds keys, and preview balances are off-chain.
          </p>
          <div className="empty-actions">
            <button className="button button-primary" onClick={openAuth}>
              Open preview account <ArrowRight size={16} />
            </button>
            <Link className="button button-ghost" href="/markets">
              Browse markets
            </Link>
          </div>
        </div>
        <div className="info-grid">
          <article className="info-card">
            <span className="pillar-icon">
              <SparkIcon size={17} />
            </span>
            <h3>Simulated, clearly labelled</h3>
            <p>Every balance in this environment is a preview value. No funds exist on-chain.</p>
          </article>
          <article className="info-card">
            <span className="pillar-icon">
              <ShieldIcon size={17} />
            </span>
            <h3>Wallet-held authority</h3>
            <p>The user signs; KYROX prepares. There is no custodial service key.</p>
          </article>
          <article className="info-card">
            <span className="pillar-icon">
              <InfoIcon size={17} />
            </span>
            <h3>Honest failure states</h3>
            <p>
              Stale prices, missing deployment, and policy rejections surface instead of hiding.
            </p>
          </article>
        </div>
      </div>
    );
  }

  const stale = portfolio?.stale ?? false;
  const change = portfolio?.change24hUsdc ?? null;
  const changePct = portfolio?.change24hPct ?? null;

  return (
    <div className="page-width page-stack">
      <header className="page-head">
        <div>
          <p className="eyebrow">Portfolio</p>
          <h1>Your portfolio</h1>
          <p className="page-lead">
            {session.demo ? "Preview account" : "Verified wallet"} {shortAddress(session.address)} ·{" "}
            {environment?.simulated
              ? "simulated balances, no on-chain funds"
              : "Base Sepolia balances"}
          </p>
        </div>
        <div className="page-head-actions">
          {session.demo ? (
            <button
              className="button button-ghost button-small"
              onClick={() => void resetPreview()}
              disabled={localBusy !== ""}
            >
              <RefreshIcon size={15} />
              {localBusy === "reset" ? "Resetting…" : "Reset preview"}
            </button>
          ) : (
            <button
              className="button button-ghost button-small"
              onClick={() => void claimFaucet()}
              disabled={localBusy !== ""}
            >
              <PlusIcon size={15} />
              {localBusy === "faucet" ? "Claiming…" : "Claim test tUSDC"}
            </button>
          )}
          <Link className="button button-primary button-small" href="/markets">
            Trade <ArrowUpRight size={14} />
          </Link>
        </div>
      </header>

      {error.length > 0 && <div className="callout callout-danger">{error}</div>}

      <section className="portfolio-hero">
        <div className="portfolio-value">
          <span className="eyebrow">Total value</span>
          <div className="portfolio-total">
            <strong>{formatPrice(portfolio?.totalUsdc ?? null)}</strong>
            <span>tUSDC</span>
          </div>
          <div className={`change large ${pctTone(changePct)}`}>
            {change === null
              ? "—"
              : `${change.startsWith("-") ? "" : "+"}${formatPrice(change)} tUSDC`}{" "}
            ({formatPct(changePct)}) <span className="muted small">24h simulated</span>
          </div>
          {stale && (
            <p className="form-error">One or more positions have no fresh reference price.</p>
          )}
          <div className="portfolio-split">
            <div>
              <span>Settlement cash</span>
              <strong>{formatTokenAmount(portfolio?.cash.amount ?? null, 2)} tUSDC</strong>
            </div>
            <div>
              <span>Equity exposure</span>
              <strong>
                {formatPrice(
                  (portfolio?.positions ?? []).reduce(
                    (total, position) => total + Number(position.valueUsdc ?? 0),
                    0,
                  ),
                )}{" "}
                tUSDC
              </strong>
            </div>
            <div>
              <span>As of</span>
              <strong>{portfolio === null ? "—" : timeAgo(portfolio.asOf)}</strong>
            </div>
          </div>
        </div>
        <div className="allocation-card">
          <div className="panel-head-inline">
            <span className="eyebrow">Allocation</span>
            <span className="sim-badge">simulated</span>
          </div>
          <Donut slices={[...(portfolio?.allocation ?? [])]} />
          <ul className="allocation-legend">
            {portfolio?.allocation.map((slice) => (
              <li key={slice.symbol}>
                <span className="legend-dot" style={{ background: slice.accent }} />
                <span>{slice.symbol}</span>
                <span className="muted">{slice.sharePct.toFixed(1)}%</span>
                <strong>{formatPrice(slice.valueUsdc)}</strong>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Positions</h2>
            <p className="muted small">Reference valuations, not executable bids.</p>
          </div>
          <Link className="text-link" href="/markets">
            All markets <ArrowUpRight size={14} />
          </Link>
        </div>
        <div className="position-table-wrap">
          <table className="market-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th className="align-right">Holdings</th>
                <th className="align-right">Price</th>
                <th className="align-right">Value</th>
                <th className="align-right">24h</th>
                <th aria-label="Trade" />
              </tr>
            </thead>
            <tbody>
              {portfolio?.positions.map((position) => (
                <tr key={position.symbol}>
                  <td>
                    <Link className="market-cell" href={`/markets/${position.symbol}`}>
                      <span className="asset-mark small" aria-hidden="true">
                        {position.symbol.replace("t", "").slice(0, 2)}
                      </span>
                      <span>
                        <strong>{position.symbol}</strong>
                        <small>{position.name}</small>
                      </span>
                    </Link>
                  </td>
                  <td className="align-right mono">{formatTokenAmount(position.amount, 6)}</td>
                  <td className="align-right mono">
                    {formatPrice(position.priceUsdc)} <span className="muted small">tUSDC</span>
                  </td>
                  <td className="align-right mono">
                    {formatPrice(position.valueUsdc)} <span className="muted small">tUSDC</span>
                  </td>
                  <td className={`align-right change ${pctTone(position.change24hPct)}`}>
                    {formatPct(position.change24hPct)}
                  </td>
                  <td className="align-right">
                    <Link className="row-action" href={`/markets/${position.symbol}`}>
                      Trade <ArrowUpRight size={14} />
                    </Link>
                  </td>
                </tr>
              ))}
              <tr className="cash-row">
                <td>
                  <span className="market-cell">
                    <span className="asset-mark small cash" aria-hidden="true">
                      $
                    </span>
                    <span>
                      <strong>tUSDC</strong>
                      <small>Test settlement token</small>
                    </span>
                  </span>
                </td>
                <td className="align-right mono">
                  {formatTokenAmount(portfolio?.cash.amount ?? null, 2)}
                </td>
                <td className="align-right mono">1.00</td>
                <td className="align-right mono">
                  {formatPrice(portfolio?.cash.valueUsdc ?? null)}
                </td>
                <td className="align-right muted">—</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Recent activity</h2>
            <p className="muted small">Simulated fills are recorded locally and labelled.</p>
          </div>
          <Link className="text-link" href="/activity">
            Full activity <ArrowUpRight size={14} />
          </Link>
        </div>
        <ActivityList
          items={activity.slice(0, 5)}
          compact
          emptyLabel="No fills yet. Open a market to prepare your first order."
        />
      </section>

      <div className="callout callout-warn">
        <InfoIcon size={16} />
        <p>
          <strong>Preview accounting.</strong> Values are simulated reference valuations and do not
          represent an offer, a NAV, or a redeemable balance. No blockchain transaction is created
          by preview fills.
        </p>
      </div>
    </div>
  );
}
