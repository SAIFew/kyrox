"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { ActivityItem, ActivityStatus } from "../lib/market-types";
import { activityAmountLabel, formatDate, formatPrice, timeAgo } from "../lib/format";
import { useAccount } from "./account-provider";
import {
  ActivityIcon,
  ArrowDownRight,
  ArrowUpRight,
  InfoIcon,
  SparkIcon,
  WalletIcon,
} from "./icons";

const STATUS_LABEL: Record<ActivityStatus, string> = {
  prepared: "Prepared",
  submitted: "Submitted",
  included: "Included",
  verified: "Verified",
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

export function ActivityList({
  items,
  compact = false,
  emptyLabel,
}: {
  items: readonly ActivityItem[];
  compact?: boolean;
  emptyLabel: string;
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
                {item.side === "buy" ? "Bought" : "Sold"} {item.symbol}
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
          </div>
          <div className="activity-price">
            <span>{item.priceUsdc === null ? "—" : `${formatPrice(item.priceUsdc)} tUSDC`}</span>
            {item.txHash === null ? (
              <small className="muted">off-chain</small>
            ) : (
              <a
                href={`https://sepolia.basescan.org/tx/${item.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-link small"
              >
                Basescan ↗
              </a>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ActivityView() {
  const { ready, session, activity, openAuth, environment, error: accountError } = useAccount();
  const [filter, setFilter] = useState<"all" | "buy" | "sell">("all");

  const filtered = useMemo(
    () => activity.filter((item) => (filter === "all" ? true : item.side === filter)),
    [activity, filter],
  );

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
          <p>Your preview account records simulated fills locally. No wallet is required.</p>
          <div className="empty-actions">
            <button className="button button-primary" onClick={openAuth}>
              Open preview account <ArrowUpRight size={15} />
            </button>
            <Link className="button button-ghost" href="/markets">
              Browse markets
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const buys = activity.filter((item) => item.side === "buy").length;
  const sells = activity.filter((item) => item.side === "sell").length;
  const notional = activity.reduce((total, item) => {
    if (item.amountOut === null) return total;
    return (
      total + (item.side === "buy" ? Number(item.amountIn) / 1e6 : Number(item.amountOut) / 1e6)
    );
  }, 0);

  return (
    <div className="page-width page-stack">
      <header className="page-head">
        <div>
          <p className="eyebrow">Activity</p>
          <h1>Order history</h1>
          <p className="page-lead">
            {environment?.simulated
              ? "Simulated fills are recorded in your signed preview session. No blockchain transaction exists."
              : "On-chain intents are tracked from submission through verification."}
          </p>
        </div>
        <div className="page-head-meta">
          <span className="sim-badge">{environment?.simulated ? "simulated" : "on-chain"}</span>
          <span className="muted small">{activity.length} records</span>
        </div>
      </header>

      {accountError.length > 0 && <div className="callout callout-danger">{accountError}</div>}

      <div className="stat-row">
        <div className="stat-tile">
          <span>Total records</span>
          <strong>{activity.length}</strong>
        </div>
        <div className="stat-tile">
          <span>Buys</span>
          <strong>{buys}</strong>
        </div>
        <div className="stat-tile">
          <span>Sells</span>
          <strong>{sells}</strong>
        </div>
        <div className="stat-tile">
          <span>Notional</span>
          <strong>{notional.toLocaleString("en-US", { maximumFractionDigits: 2 })} tUSDC</strong>
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
          emptyLabel={
            activity.length === 0
              ? "No fills yet. Open a market to prepare your first order."
              : "No records match this filter."
          }
        />
      </section>

      <div className="callout callout-warn">
        <InfoIcon size={16} />
        <p>
          A prepared order is not a trade. In preview mode a fill is recorded only after you confirm
          it, and it never leaves this application.{" "}
          <span className="muted">
            <SparkIcon size={12} /> Nothing here is financial advice.
          </span>
        </p>
      </div>
    </div>
  );
}
