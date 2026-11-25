"use client";

import {
  contractsLabel,
  environmentDisclosure,
  environmentShortLabel,
  priceSourceLabel,
} from "../lib/presentation";
import { useAccount } from "./account-provider";
import { InfoIcon } from "./icons";

export function LandingEnvironmentDisclosure() {
  const { environment } = useAccount();
  return (
    <div className="hero-disclosure" role="status" aria-live="polite">
      <span className="pulse-dot" />
      <span>
        <strong>{environmentShortLabel(environment)}.</strong> {environmentDisclosure(environment)}
      </span>
    </div>
  );
}

export function LandingNetworkLabel() {
  const { environment } = useAccount();
  return (
    <span>
      {environment?.mode === "demo"
        ? "Demo workflow · Base Sepolia labels"
        : environment === null
          ? "Built for testnet"
          : `Built for ${environment.chainName} testnet`}
    </span>
  );
}

export function LandingStatusGrid() {
  const { environment } = useAccount();
  const contractTone =
    environment?.contracts === "deployed"
      ? "ok"
      : environment?.contracts === "local"
        ? "sim"
        : "off";
  const rows: Array<[string, string, string]> = [
    [
      "Consumer application",
      environment === null ? "Checking…" : "Available",
      environment === null ? "off" : "ok",
    ],
    [
      "Reference market data",
      priceSourceLabel(environment),
      environment?.simulated === true ? "sim" : environment === null ? "off" : "ok",
    ],
    ["Deterministic quote engine", "Implemented", "ok"],
    ["Agent bridge (MCP)", "Read-only", "ok"],
    [`${environment?.chainName ?? "Testnet"} contracts`, contractsLabel(environment), contractTone],
    ["Mainnet trading", "Not available", "off"],
  ];
  return (
    <div className="status-grid">
      {rows.map(([label, value, tone]) => (
        <div className="status-tile" key={label}>
          <span className={`status-light ${tone}`} />
          <div>
            <strong>{label}</strong>
            <span>{value}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function MarketsEnvironmentMeta() {
  const { environment } = useAccount();
  return (
    <div className="page-head-meta" role="status" aria-live="polite">
      <span className="sim-badge">{priceSourceLabel(environment)}</span>
      <span className="muted small">
        {environment === null
          ? "Checking network…"
          : `${environment.chainName} · chain ${environment.chainId}`}
      </span>
    </div>
  );
}

export function MarketsEnvironmentNotice() {
  const { environment } = useAccount();
  return (
    <div className="notice-strip" role="status" aria-live="polite">
      <InfoIcon size={15} />
      <span>
        {environmentDisclosure(environment)} Each observation carries its own simulation and
        freshness label.
      </span>
    </div>
  );
}

export function DevelopersEnvironmentMeta() {
  const { environment } = useAccount();
  return (
    <div className="page-head-meta" role="status" aria-live="polite">
      <span className="sim-badge live">read-only bridge</span>
      <span className="muted small">MCP 2025-06-18 · Streamable HTTP</span>
      <span className="muted small">{environmentShortLabel(environment)}</span>
    </div>
  );
}

export function DevelopersDataBadge() {
  const { environment } = useAccount();
  return <span className="sim-badge">{priceSourceLabel(environment)}</span>;
}

export function DevelopersEnvironmentNote() {
  const { environment } = useAccount();
  return (
    <span role="status" aria-live="polite">
      {environmentDisclosure(environment)} Tool responses retain per-observation simulation flags;
      the bridge itself never signs or sends.
    </span>
  );
}
