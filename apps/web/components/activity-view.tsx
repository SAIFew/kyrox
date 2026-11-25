"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { ActivityItem, ActivityStatus, EnvironmentInfo } from "../lib/market-types";
import { activityAmountLabel, formatDate, formatPrice, timeAgo, toNumber } from "../lib/format";
import {
  assetDisplayName,
  environmentDisclosure,
  environmentShortLabel,
  settlementDisplayName,
  transactionExplorerUrl,
} from "../lib/presentation";
import { useAccount } from "./account-provider";
import {
  ActivityIcon,
  ArrowDownRight,
  ArrowUpRight,
  CheckIcon,
  CopyIcon,
  InfoIcon,
  SparkIcon,
  WalletIcon,
} from "./icons";

const STATUS_LABEL: Record<ActivityStatus, string> = {
  prepared: "Prepared",
  submitted: "Submitted",
  included: "Included",
  verified: "Verified fill",
  failed: "Failed",
  reorged: "Reorged",
  simulated: "Simulated fill",
};

function statusTone(status: ActivityStatus): string {
  switch (status) {
    case "verified":
    case "simulated":
      return "ok";
    case "failed":
    case "reorged":
      return "danger";
    case "submitted":
    case "included":
      return "warn";
    default:
      return "neutral";
  }
}

function activityTitle(item: ActivityItem): string {
  const side = item.side === "buy" ? "buy" : "sell";
  switch (item.status) {
    case "prepared":
      return `Prepared ${side}`;
    case "submitted":
      return `Submitted ${side}`;
    case "included":
      return `Included ${side}`;
    case "verified":
      return `Verified ${side} fill`;
    case "failed":
      return `Failed ${side}`;
    case "reorged":
      return `Reorged ${side}`;
    case "simulated":
      return `Simulated ${side} fill`;
  }
}

function isCompletedFill(item: ActivityItem): boolean {
  return item.status === "verified" || item.status === "simulated";
}

function CopyTransactionHash({ value, local }: { value: string; local: boolean }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      className="text-link"
      style={{ fontSize: 12 }}
      title={value}
      aria-label={`${local ? "Local Anvil" : "Transaction"} hash ${value}`}
      onClick={async () => {
        setFailed(false);
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1_600);
        } catch {
          setCopied(false);
          setFailed(true);
        }
      }}
    >
      {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
      {failed ? "Copy failed" : copied ? "Copied" : local ? "Copy local tx" : "Copy tx"}
    </button>
  );
}

function TransactionReference({
  item,
  environment,
}: {
  item: ActivityItem;
  environment: EnvironmentInfo | null | undefined;
}) {
  if (item.txHash === null) {
    return (
      <small className="muted" style={{ fontSize: 11 }}>
        {environment?.mode === "demo" || item.simulated ? "simulated · off-chain" : "not submitted"}
      </small>
    );
  }
  const explorerUrl = transactionExplorerUrl(environment, item.txHash);
  if (explorerUrl !== null) {
    return (
      <a
        href={explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-link"
        style={{ fontSize: 12 }}
      >
        Basescan ↗
      </a>
    );
  }
  return <CopyTransactionHash value={item.txHash} local={environment?.mode === "local-anvil"} />;
}

export function ActivityList({
  items,
  compact = false,
  emptyLabel,
  environment,
}: {
  items: readonly ActivityItem[];
  compact?: boolean;
  emptyLabel: string;
  environment?: EnvironmentInfo | null;
}) {
  if (items.length === 0) {
    return (
      <div className="empty-row">
        <ActivityIcon size={20} />
        <p>{emptyLabel}</p>
      </div>
    );
  }

  return (
    <ul className={`activity-list ${compact ? "is-compact" : ""}`}>
      {items.map((item) => (
        <li key={item.id} className="activity-item">
          <span className={`activity-icon ${item.side}`}>
            {item.side === "buy" ? <ArrowDownRight size={16} /> : <ArrowUpRight size={16} />}
          </span>
          <div className="activity-main">
            <div className="activity-title">
              <strong>
                {activityTitle(item)} · {assetDisplayName(item.symbol)}
              </strong>
              <span className={`side-badge ${item.side}`}>{item.side}</span>
              {item.simulated && <span className="sim-badge">simulated</span>}
            </div>
            <span className="activity-amount">{activityAmountLabel(item)}</span>
          </div>
          <div className="activity-meta">
            <span className={`status-pill ${statusTone(item.status)}`}>
              {STATUS_LABEL[item.status]}
            </span>
            <span className="muted small" title={formatDate(item.createdAt)}>
              {timeAgo(item.createdAt)}
            </span>
            <TransactionReference item={item} environment={environment} />
          </div>
          <div className="activity-price">
            <span>
              {item.priceUsdc === null
                ? "—"
                : `${formatPrice(item.priceUsdc)} ${settlementDisplayName()}`}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ActivityView() {
  const {
    ready,
    session,
    activity,
    activityStale,
    openAuth,
    environment,
    error: accountError,
  } = useAccount();
  const [filter, setFilter] = useState<"all" | "buy" | "sell">("all");

  const filtered = useMemo(
    () => activity.filter((item) => (filter === "all" ? true : item.side === filter)),
    [activity, filter],
  );
  const completed = activity.filter(isCompletedFill);
  const buys = completed.filter((item) => item.side === "buy").length;
  const sells = completed.filter((item) => item.side === "sell").length;
  const notionalValues = completed.map((item) => {
    const raw = item.side === "buy" ? item.amountIn : item.amountOut;
    const value = toNumber(raw);
    return value === null ? null : value / 1e6;
  });
  const notional =
    notionalValues.length === 0
      ? 0
      : notionalValues.some((value) => value === null)
        ? null
        : notionalValues.reduce<number>((total, value) => total + (value ?? 0), 0);

  if (!ready) {
    return (
      <div className="page-width page-stack">
        <span className="skeleton skeleton-line short" />
        <span className="skeleton skeleton-block" />
      </div>
    );
  }

  if (session === null) {
    return (
      <div className="page-width page-stack">
        <header className="page-head">
          <div>
            <p className="eyebrow">Activity</p>
            <h1>Every action, accounted for.</h1>
            <p className="page-lead">
              Prepared intents, submitted transactions, verified inclusions, and simulated fills are
              kept distinct. Nothing is counted as executed until it is verified.
            </p>
          </div>
        </header>
        <div className="empty-state panel">
          <span className="empty-icon">
            <WalletIcon size={26} />
          </span>
          <h2>Sign in to view activity</h2>
          <p>
            {environment?.mode === "demo"
              ? "Your preview account records simulated fills off-chain. No wallet is required."
              : `Your testnet account tracks prepared intents and on-chain transaction status on ${environmentShortLabel(environment)}.`}
          </p>
          <div className="empty-actions">
            <button className="button button-primary" onClick={openAuth}>
              {environment?.mode === "demo" ? "Open preview account" : "Connect wallet"}{" "}
              <ArrowUpRight size={15} />
            </button>
            <Link className="button button-ghost" href="/markets">
              Browse markets
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-width page-stack">
      <header className="page-head">
        <div>
          <p className="eyebrow">Activity</p>
          <h1>Order history</h1>
          <p className="page-lead">
            {environment?.mode === "demo"
              ? "Demo fills are simulated and recorded off-chain. No blockchain transaction exists."
              : environment?.mode === "local-anvil"
                ? "Local Anvil transactions use local testnet contracts; prices and balances are simulated."
                : "Base Sepolia testnet intents are tracked from submission through verification."}
          </p>
        </div>
        <div className="page-head-meta">
          <span className="sim-badge">{environmentShortLabel(environment)}</span>
          <span className="muted small">{activity.length} records</span>
        </div>
      </header>

      {accountError.length > 0 && (
        <div className="callout callout-danger" role="alert" aria-live="assertive">
          {accountError}
        </div>
      )}
      {activityStale && (
        <div className="callout callout-warn" role="status" aria-live="polite">
          On-chain reconciliation is unavailable. Persisted transaction statuses may be stale.
        </div>
      )}

      <div className="stat-row">
        <div className="stat-tile">
          <span>Total records</span>
          <strong>{activity.length}</strong>
        </div>
        <div className="stat-tile">
          <span>Completed buys</span>
          <strong>{buys}</strong>
        </div>
        <div className="stat-tile">
          <span>Completed sells</span>
          <strong>{sells}</strong>
        </div>
        <div className="stat-tile">
          <span>Completed notional</span>
          <strong>
            {notional === null
              ? "—"
              : `${notional.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${settlementDisplayName()}`}
          </strong>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>All activity</h2>
            <p className="muted small">Newest first. Times are shown in your local timezone.</p>
          </div>
          <div className="segmented segmented-small" role="group" aria-label="Filter activity">
            {(
              [
                ["all", "All"],
                ["buy", "Buys"],
                ["sell", "Sells"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                className={filter === key ? "is-active" : ""}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <ActivityList
          items={filtered}
          environment={environment}
          emptyLabel={
            activity.length === 0
              ? "No activity yet. Open a market to prepare your first order."
              : "No records match this filter."
          }
        />
      </section>

      <div className="callout callout-warn">
        <InfoIcon size={16} />
        <p>
          A prepared order is not a trade. Only verified fills and confirmed simulated fills count
          toward completed totals.{" "}
          {environment?.mode === "demo"
            ? "Demo fills never leave this application."
            : environmentDisclosure(environment)}{" "}
          <span className="muted">
            <SparkIcon size={12} /> Nothing here is financial advice.
          </span>
        </p>
      </div>
    </div>
  );
}
