"use client";

import Link from "next/link";
import { useState } from "react";
import { encodeFunctionData, isAddress, zeroAddress } from "viem";

import { api } from "../lib/api";
import { FAUCET_CLAIMS, faucetClaim, faucetEligibility, type FaucetClaimKind } from "../lib/faucet";
import {
  assetDisplayName,
  balanceQualification,
  environmentDisclosure,
  environmentLabel,
  isDemoEnvironment,
  settlementDisplayName,
} from "../lib/presentation";
import {
  formatNumber,
  formatPct,
  formatPrice,
  formatTokenAmount,
  pctTone,
  shortAddress,
  timeAgo,
  toNumber,
} from "../lib/format";
import {
  resolveWalletNetwork,
  sendTransaction,
  waitForTransactionReceipt,
  walletErrorMessage,
} from "../lib/wallet";
import { useAccount } from "./account-provider";
import { ShareCardActions } from "./share-card-actions";
import { ActivityList } from "./activity-view";
import {
  ArrowRight,
  ArrowUpRight,
  InfoIcon,
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
  {
    type: "function",
    name: "claimDaily",
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
  const validSlices = slices.filter(
    (slice) => Number.isFinite(slice.sharePct) && slice.sharePct >= 0,
  );
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
        {validSlices.map((slice) => {
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
        <strong>{validSlices.length}</strong>
      </div>
    </div>
  );
}

export function PortfolioView() {
  const {
    ready,
    session,
    environment,
    portfolio,
    activity,
    activityStale,
    openAuth,
    refreshAll,
    error: accountError,
  } = useAccount();
  const [localBusy, setLocalBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [faucetHash, setFaucetHash] = useState<string | null>(null);
  const demo = isDemoEnvironment(environment);
  const claimEligibility = faucetEligibility(environment, session);
  const canClaim = claimEligibility.allowed;

  async function resetPreview() {
    if (session === null || !isDemoEnvironment(environment)) return;
    setLocalBusy("reset");
    setError("");
    setNotice("");
    try {
      await api("/api/auth/demo", {
        method: "POST",
        body: JSON.stringify({ reset: true }),
      });
      await refreshAll();
      setNotice("Preview balances and activity were reset.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset the preview account.");
    } finally {
      setLocalBusy("");
    }
  }

  async function claimFaucet(kind: FaucetClaimKind) {
    const claim = faucetClaim(kind);
    if (session === null || environment === null) return;
    const eligibility = faucetEligibility(environment, session);
    if (!eligibility.allowed) {
      setError(eligibility.reason ?? "The faucet is unavailable in this environment.");
      return;
    }
    const busyPrefix = `faucet-${kind}`;
    let phase: "assets" | "wallet" | "receipt" | "refresh" = "assets";
    let submittedHash: `0x${string}` | null = null;
    setLocalBusy(`${busyPrefix}-assets`);
    setError("");
    setNotice("");
    setFaucetHash(null);
    try {
      const assets = await api<{ settlement: string }>("/api/assets");
      if (!isAddress(assets.settlement) || assets.settlement.toLowerCase() === zeroAddress) {
        throw new Error("The test settlement token address is unavailable.");
      }
      const network = resolveWalletNetwork(environment);
      phase = "wallet";
      setLocalBusy(`${busyPrefix}-wallet`);
      const hash = await sendTransaction({
        from: session.address as `0x${string}`,
        to: assets.settlement as `0x${string}`,
        data: encodeFunctionData({ abi: CLAIM_ABI, functionName: claim.functionName }),
        value: "0x0",
        network,
      });
      submittedHash = hash;
      setFaucetHash(hash);
      phase = "receipt";
      setLocalBusy(`${busyPrefix}-receipt`);
      await waitForTransactionReceipt(hash);
      setNotice(
        `${claim.title} confirmed: ${claim.amountLabel} on ${environmentLabel(environment)}.`,
      );
      phase = "refresh";
      await refreshAll();
    } catch (err) {
      const message = walletErrorMessage(err);
      setError(
        submittedHash === null
          ? `${phase === "wallet" ? `${claim.title} transaction failed` : `${claim.title} preparation failed`}: ${message}`
          : phase === "refresh"
            ? `${claim.title} transaction ${shortAddress(submittedHash)} was confirmed, but account data could not refresh. Do not resend. ${message}`
            : `${claim.title} transaction ${shortAddress(submittedHash)} was submitted, but its receipt could not be verified. Do not resend until the wallet confirms it. ${message}`,
      );
    } finally {
      setLocalBusy("");
    }
  }

  function faucetBusyLabel(kind: FaucetClaimKind): string {
    if (!localBusy.startsWith(`faucet-${kind}`)) return "Claim";
    if (localBusy.endsWith("-assets")) return "Preparing…";
    if (localBusy.endsWith("-wallet")) return "Waiting for wallet…";
    if (localBusy.endsWith("-receipt")) return "Confirming…";
    return "Refreshing…";
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
              {demo
                ? "Sign in to see balances, allocation, and 24h movement. The preview account starts with 25,000 simulated USDC units."
                : `Sign in to see testnet balances, allocation, and reference-price movement on ${environmentLabel(environment)}.`}
            </p>
          </div>
        </header>
        <div className="empty-state panel">
          <span className="empty-icon">
            <WalletIcon size={26} />
          </span>
          <h2>No active session</h2>
          <p>
            {demo
              ? "Continue with the simulated preview account, or prove ownership of a wallet. KYROX never holds keys, and preview balances are off-chain."
              : `Prove ownership of a wallet on ${environmentLabel(environment)}. KYROX never holds keys, and all assets are testnet-only.`}
          </p>
          <div className="empty-actions">
            <button className="button button-primary" onClick={openAuth}>
              {demo ? "Open preview account" : "Connect wallet"} <ArrowRight size={16} />
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
            <h3>Environment, clearly labelled</h3>
            <p>{environmentDisclosure(environment)}</p>
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
  const changeValue = toNumber(change);
  const changePct = portfolio?.change24hPct ?? null;
  const simulatedBalances = portfolio?.simulated ?? environment?.simulated ?? false;
  const positionValues = (portfolio?.positions ?? []).map((position) =>
    toNumber(position.valueUsdc),
  );
  const equityExposure =
    positionValues.length === 0
      ? 0
      : positionValues.some((value) => value === null)
        ? null
        : positionValues.reduce<number>((total, value) => total + (value ?? 0), 0);
  const pnlValues = (portfolio?.positions ?? []).map((position) =>
    toNumber(position.unrealizedPnlUsdc),
  );
  const basisValues = (portfolio?.positions ?? []).map((position) =>
    toNumber(position.costBasisUsdc),
  );
  const pnlTotal =
    pnlValues.length > 0 && pnlValues.every((value) => value !== null)
      ? pnlValues.reduce<number>((total, value) => total + (value ?? 0), 0)
      : null;
  const basisTotal =
    basisValues.length > 0 && basisValues.every((value) => value !== null)
      ? basisValues.reduce<number>((total, value) => total + (value ?? 0), 0)
      : null;
  const pnlPct =
    pnlTotal === null || basisTotal === null || basisTotal <= 0
      ? null
      : (pnlTotal / basisTotal) * 100;
  const hasAnyCostBasis = (portfolio?.positions ?? []).some(
    (position) => position.avgCostUsdc !== undefined && position.avgCostUsdc !== null,
  );

  return (
    <div className="page-width page-stack">
      <header className="page-head">
        <div>
          <p className="eyebrow">Portfolio</p>
          <h1>Your portfolio</h1>
          <p className="page-lead">
            {session.demo ? "Preview account" : "Verified wallet"} {shortAddress(session.address)} ·{" "}
            {balanceQualification(environment)} · {environmentLabel(environment)}
          </p>
        </div>
        <div className="page-head-actions">
          {demo && session.demo && (
            <button
              className="button button-ghost button-small"
              onClick={() => void resetPreview()}
              disabled={localBusy !== ""}
            >
              <RefreshIcon size={15} />
              {localBusy === "reset" ? "Resetting…" : "Reset preview"}
            </button>
          )}
          <ShareCardActions />
          <Link className="button button-primary button-small" href="/markets">
            Trade <ArrowUpRight size={14} />
          </Link>
        </div>
      </header>

      {(error.length > 0 || accountError.length > 0) && (
        <div className="callout callout-danger" role="alert" aria-live="assertive">
          {error || accountError}
        </div>
      )}
      {notice.length > 0 && (
        <div className="callout callout-safe" role="status" aria-live="polite">
          {notice}
          {faucetHash !== null && <span className="mono small"> · {shortAddress(faucetHash)}</span>}
        </div>
      )}

      {canClaim && (
        <section className="panel faucet-panel">
          <div className="panel-head">
            <div>
              <h2>Test faucet</h2>
              <p className="muted small">
                Free test settlement tokens, minted directly to your wallet. The contract enforces
                one welcome grant per wallet and one daily claim per rolling 24 hours.
              </p>
            </div>
            <span className="sim-badge">testnet</span>
          </div>
          <div className="info-grid">
            {FAUCET_CLAIMS.map((claim) => (
              <article className="info-card" key={claim.kind}>
                <h3>
                  {claim.title} · {claim.amountLabel}
                </h3>
                <p>{claim.description}</p>
                <button
                  type="button"
                  className="button button-ghost button-small"
                  onClick={() => void claimFaucet(claim.kind)}
                  disabled={localBusy !== ""}
                >
                  {faucetBusyLabel(claim.kind)}
                </button>
              </article>
            ))}
          </div>
          <p className="muted small">
            No payment is collected for the tokens. On a public testnet your wallet may show a
            testnet gas estimate; KYROX never holds keys or signs on your behalf.
          </p>
        </section>
      )}

      <section className="portfolio-hero">
        <div className="portfolio-value">
          <span className="eyebrow">Total value</span>
          <div className="portfolio-total">
            <strong>{formatPrice(portfolio?.totalUsdc ?? null)}</strong>
            <span>{settlementDisplayName()}</span>
          </div>
          <div className={`change large ${pctTone(changePct)}`}>
            {changeValue === null
              ? "—"
              : `${changeValue > 0 ? "+" : ""}${formatPrice(changeValue)} ${settlementDisplayName()}`}{" "}
            ({formatPct(changePct)}){" "}
            <span className="muted small">24h {simulatedBalances ? "simulated" : "reference"}</span>
          </div>
          {stale && (
            <p className="form-error">One or more positions have no fresh reference price.</p>
          )}
          <div className="portfolio-split">
            <div>
              <span>Settlement cash</span>
              <strong>
                {formatTokenAmount(portfolio?.cash.amount ?? null, 2)} {settlementDisplayName()}
              </strong>
            </div>
            <div>
              <span>Equity exposure</span>
              <strong>
                {equityExposure === null ? "—" : formatPrice(equityExposure)}{" "}
                {settlementDisplayName()}
              </strong>
            </div>
            <div>
              <span>
                {simulatedBalances && hasAnyCostBasis ? "Simulated P&L" : "Average-cost P&L"}
              </span>
              <strong className={pctTone(pnlPct)}>
                {pnlTotal === null
                  ? "unavailable"
                  : `${pnlTotal > 0 ? "+" : ""}${formatPrice(pnlTotal)} ${settlementDisplayName()} (${formatPct(pnlPct)})`}
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
            <span className="sim-badge">{simulatedBalances ? "simulated" : "testnet"}</span>
          </div>
          <Donut slices={[...(portfolio?.allocation ?? [])]} />
          <ul className="allocation-legend">
            {portfolio?.allocation.map((slice) => (
              <li key={slice.symbol}>
                <span className="legend-dot" style={{ background: slice.accent }} />
                <span>{assetDisplayName(slice.symbol)}</span>
                <span className="muted">{formatNumber(slice.sharePct, { min: 1, max: 1 })}%</span>
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
            <p className="muted small">
              Reference valuations, not executable bids. Average cost and P&L are{" "}
              {simulatedBalances && hasAnyCostBasis
                ? "simulated bookkeeping"
                : "shown only when a reconciled indexer provides cost basis"}
              .
            </p>
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
                <th className="align-right">
                  Avg cost{" "}
                  {simulatedBalances && hasAnyCostBasis && <span className="muted small">sim</span>}
                </th>
                <th className="align-right">
                  P&L{" "}
                  {simulatedBalances && hasAnyCostBasis && <span className="muted small">sim</span>}
                </th>
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
                        {assetDisplayName(position.symbol).slice(0, 1)}
                      </span>
                      <span>
                        <strong>{assetDisplayName(position.symbol)}</strong>
                        <small>{position.name}</small>
                        {position.stale && <span className="status-pill warn">stale</span>}
                      </span>
                    </Link>
                  </td>
                  <td className="align-right mono">{formatTokenAmount(position.amount, 6)}</td>
                  <td className="align-right mono">
                    {formatPrice(position.priceUsdc)}{" "}
                    <span className="muted small">{settlementDisplayName()}</span>
                  </td>
                  <td className="align-right mono">
                    {formatPrice(position.valueUsdc)}{" "}
                    <span className="muted small">{settlementDisplayName()}</span>
                  </td>
                  <td className="align-right mono">
                    {position.avgCostUsdc === null || position.avgCostUsdc === undefined
                      ? "—"
                      : `${formatPrice(position.avgCostUsdc)} ${settlementDisplayName()}`}
                  </td>
                  <td className={`align-right change ${pctTone(position.unrealizedPnlPct)}`}>
                    {position.unrealizedPnlUsdc === null ||
                    position.unrealizedPnlUsdc === undefined ? (
                      <span className="muted">unavailable</span>
                    ) : (
                      <>
                        <span>
                          {(toNumber(position.unrealizedPnlUsdc) ?? 0) > 0 ? "+" : ""}
                          {formatPrice(position.unrealizedPnlUsdc)} {settlementDisplayName()}
                        </span>
                        <small className="muted"> {formatPct(position.unrealizedPnlPct)}</small>
                      </>
                    )}
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
                      <strong>{settlementDisplayName()}</strong>
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
                <td className="align-right muted">—</td>
                <td className="align-right muted">—</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        {!hasAnyCostBasis && (
          <p className="muted small">
            Average cost and P&L are unavailable because no durable, reconciled cost-basis indexer
            is configured. KYROX does not estimate or backfill them.
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Recent activity</h2>
            <p className="muted small">
              {demo
                ? "Simulated fills are recorded off-chain and labelled."
                : environment?.mode === "local-anvil"
                  ? "Local transactions use simulated economics and local testnet contracts."
                  : "Testnet intents are tracked from submission through verification."}
            </p>
          </div>
          <Link className="text-link" href="/activity">
            Full activity <ArrowUpRight size={14} />
          </Link>
        </div>
        <ActivityList
          items={activity.slice(0, 5)}
          environment={environment}
          compact
          emptyLabel="No fills yet. Open a market to prepare your first order."
        />
        {activityStale && (
          <p className="form-error" role="status">
            On-chain activity reconciliation is unavailable; persisted statuses may be stale.
          </p>
        )}
      </section>

      <div className="callout callout-warn">
        <InfoIcon size={16} />
        <p>
          <strong>{demo ? "Preview accounting." : "Testnet accounting."}</strong>{" "}
          {environmentDisclosure(environment)} Values and any average cost or P&L shown are
          reference valuations, not an offer, a NAV, or a redeemable real-world balance. Test
          tokens. No real value. Not real shares. Not investment advice.
        </p>
      </div>
    </div>
  );
}
