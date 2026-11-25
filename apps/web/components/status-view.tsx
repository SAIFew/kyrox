"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { EnvironmentInfo } from "../lib/market-types";
import { api } from "../lib/api";
import { timeAgo } from "../lib/format";
import {
  contractsLabel,
  environmentDisclosure,
  environmentLabel,
  priceSourceLabel,
} from "../lib/presentation";
import {
  ArrowUpRight,
  ChartIcon,
  CodeIcon,
  GlobeIcon,
  InfoIcon,
  LayersIcon,
  LockIcon,
  ShieldIcon,
  SparkIcon,
} from "./icons";

interface StatusPayload {
  ok: boolean;
  generatedAt: string;
  environment: EnvironmentInfo;
  checks: Array<{
    id: string;
    label: string;
    status: string;
    detail: string;
  }>;
  disclaimer: string;
}

const TONE: Record<string, string> = {
  operational: "ok",
  simulated: "sim",
  degraded: "warn",
  "not-deployed": "off",
  "not-running": "off",
  "not-configured": "off",
};

export function StatusView() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const payload = await api<StatusPayload>("/api/status");
        if (active) {
          setData(payload);
          setError("");
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Status is unavailable.");
      }
    };
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const environment = data?.environment;
  const summaryTone =
    environment === undefined
      ? "off"
      : environment.simulated
        ? "sim"
        : environment.contracts === "deployed"
          ? "ok"
          : "warn";

  return (
    <div className="page-width page-stack">
      <header className="page-head">
        <div>
          <p className="eyebrow">System status</p>
          <h1>No ambiguity about what is live.</h1>
          <p className="page-lead">
            KYROX separates the application, market data, contracts, publication, and indexing.
            Every layer reports its real state, including the ones that are not deployed.
          </p>
        </div>
        <div className="status-summary" role="status" aria-live="polite">
          <span className={`status-light ${summaryTone}`} />
          <div>
            <strong>{environmentLabel(environment)}</strong>
            <span>{data === null ? "Checking…" : `Updated ${timeAgo(data.generatedAt)}`}</span>
          </div>
        </div>
      </header>

      {error.length > 0 && (
        <div className="callout callout-danger" role="alert" aria-live="assertive">
          {error}
        </div>
      )}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Service checks</h2>
            <p className="muted small">Polled every 30 seconds from the running application.</p>
          </div>
          <span className="sim-badge">30s check</span>
        </div>
        <div className="status-table">
          {(data?.checks ?? []).map((check) => (
            <div className="status-row" key={check.id}>
              <span className={`status-light ${TONE[check.status] ?? "off"}`} />
              <div className="status-row-main">
                <strong>{check.label}</strong>
                <span>{check.detail}</span>
              </div>
              <span className={`status-pill ${TONE[check.status] ?? "off"}`}>
                {check.status.replaceAll("-", " ")}
              </span>
            </div>
          ))}
          {data === null && <div className="status-row skeleton-row" />}
        </div>
      </section>

      <div className="status-grid two">
        <div className="status-tile large">
          <GlobeIcon size={18} />
          <div>
            <strong>Network</strong>
            <span>
              {environment === undefined
                ? "Checking…"
                : `${environment.chainName} · chain ${environment.chainId}`}
            </span>
          </div>
        </div>
        <div className="status-tile large">
          <LockIcon size={18} />
          <div>
            <strong>Contracts</strong>
            <span>{contractsLabel(environment)}</span>
          </div>
        </div>
        <div className="status-tile large">
          <LayersIcon size={18} />
          <div>
            <strong>Price publication</strong>
            <span>{priceSourceLabel(environment)}</span>
          </div>
        </div>
        <div className="status-tile large">
          <CodeIcon size={18} />
          <div>
            <strong>Agent bridge</strong>
            <span>Read-only MCP · operational</span>
          </div>
        </div>
      </div>

      <section className="panel" id="architecture">
        <div className="panel-head">
          <div>
            <h2>Architecture</h2>
            <p className="muted small">
              One monorepo: application, deterministic core, services, contracts, and agent tools.
            </p>
          </div>
        </div>
        <div className="architecture">
          <div className="arch-layer">
            <span className="arch-label">Experience</span>
            <div className="arch-nodes">
              <span>Markets</span>
              <span>Portfolio</span>
              <span>Trade review</span>
              <span>Activity</span>
            </div>
          </div>
          <div className="arch-arrow">↓</div>
          <div className="arch-layer">
            <span className="arch-label">Application</span>
            <div className="arch-nodes">
              <span>Next.js App Router</span>
              <span>Session auth</span>
              <span>Quote API</span>
              <span>MCP bridge</span>
            </div>
          </div>
          <div className="arch-arrow">↓</div>
          <div className="arch-layer">
            <span className="arch-label">Deterministic core</span>
            <div className="arch-nodes accent">
              <span>@kyrox/core</span>
              <span>Quote maths</span>
              <span>Policy engine</span>
              <span>Freshness</span>
            </div>
          </div>
          <div className="arch-arrow">↓</div>
          <div className="arch-layer">
            <span className="arch-label">Settlement ({contractsLabel(environment)})</span>
            <div className="arch-nodes dim">
              <span>KyroxExchange</span>
              <span>Test USDC</span>
              <span>Stock tokens</span>
              <span>{environment?.chainName ?? "Checking network"}</span>
            </div>
          </div>
        </div>
        <div className="callout callout-warn compact">
          <InfoIcon size={15} />
          <p>
            {environmentDisclosure(environment)} The quote and policy engine is the same
            deterministic implementation used by the contract tests.
          </p>
        </div>
      </section>

      <div className="dev-grid">
        <section className="panel dev-card">
          <h2>
            <ShieldIcon size={17} /> Safety invariants
          </h2>
          <ul className="check-list">
            <li>The user's wallet is the only signer; no service key exists.</li>
            <li>No agent tool can sign, send, transfer, or build arbitrary calldata.</li>
            <li>Stale prices are never re-dated to look fresh.</li>
            <li>Quotes and policy are recomputed before execution.</li>
            <li>Simulated balances and fills are labelled everywhere they appear.</li>
          </ul>
        </section>
        <section className="panel dev-card">
          <h2>
            <ChartIcon size={17} /> Known gaps
          </h2>
          <ul className="check-list">
            <li>
              {environment?.contracts === "deployed"
                ? "The running environment reports a deployed testnet manifest."
                : environment?.contracts === "local"
                  ? "Only a local Anvil manifest is active; it is not a public deployment."
                  : "No deployed contract manifest is active in this environment."}
            </li>
            <li>
              {environment?.pricePublication === "simulated"
                ? "No live price publication worker is attached to this host."
                : "Price publication is configured; worker health is reported in the service checks."}
            </li>
            <li>The durable event indexer is a Phase 2 scaffold.</li>
            <li>Mainnet trading is not available and is not planned in this phase.</li>
          </ul>
          <Link className="text-link" href="/legal">
            Read the full disclosure <ArrowUpRight size={14} />
          </Link>
        </section>
      </div>

      <div className="inline-cta">
        <div>
          <strong>
            <SparkIcon size={14} /> Verification, not vibes.
          </strong>
          <span>{environmentDisclosure(environment)}</span>
        </div>
        <Link className="button button-primary" href="/markets">
          Explore markets <ArrowUpRight size={15} />
        </Link>
      </div>
    </div>
  );
}
