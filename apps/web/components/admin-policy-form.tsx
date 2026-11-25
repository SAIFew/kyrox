"use client";

import { useState } from "react";
import { fromBaseUnits, toBaseUnits } from "@kyrox/core";

interface PolicyPayload {
  minTradeUsdc: string;
  maxTradeUsdc: string;
  dailyLimitUsdc: string;
  allowedAssets: string[];
  tradingEnabled: boolean;
}

const ASSETS = ["tAAPL", "tNVDA", "tMSFT", "tGOOGL", "tAMZN", "tTSLA", "tMETA"] as const;

export function AdminPolicyForm({ initial }: { initial: PolicyPayload }) {
  const [min, setMin] = useState(fromBaseUnits(BigInt(initial.minTradeUsdc), 6));
  const [max, setMax] = useState(fromBaseUnits(BigInt(initial.maxTradeUsdc), 6));
  const [daily, setDaily] = useState(fromBaseUnits(BigInt(initial.dailyLimitUsdc), 6));
  const [assets, setAssets] = useState<string[]>(initial.allowedAssets);
  const [enabled, setEnabled] = useState(initial.tradingEnabled);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const save = async () => {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minTradeUsdc: toBaseUnits(min, 6).toString(),
          maxTradeUsdc: toBaseUnits(max, 6).toString(),
          dailyLimitUsdc: toBaseUnits(daily, 6).toString(),
          allowedAssets: assets,
          tradingEnabled: enabled,
        }),
      });
      const payload = (await response.json()) as { error?: string; policy?: PolicyPayload };
      if (!response.ok) throw new Error(payload.error ?? "Could not save policy.");
      setMessage("Policy saved and audited. Limits can only tighten within the launch ceiling.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save policy.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Testnet policy</h2>
          <p className="muted small">
            Admins may tighten limits or remove assets. They cannot widen beyond $1 / $1,000 /
            $5,000 or add an unlisted asset.
          </p>
        </div>
        <span className={enabled ? "status-pill ok" : "status-pill danger"}>
          {enabled ? "Trading open" : "Quotes paused"}
        </span>
      </div>
      <div className="admin-form-grid">
        <label className="field">
          <span className="field-label">Minimum trade (tUSDC)</span>
          <input value={min} onChange={(event) => setMin(event.target.value)} inputMode="decimal" />
        </label>
        <label className="field">
          <span className="field-label">Maximum trade (tUSDC)</span>
          <input value={max} onChange={(event) => setMax(event.target.value)} inputMode="decimal" />
        </label>
        <label className="field">
          <span className="field-label">Daily limit (tUSDC)</span>
          <input
            value={daily}
            onChange={(event) => setDaily(event.target.value)}
            inputMode="decimal"
          />
        </label>
      </div>
      <fieldset className="field">
        <legend className="field-label">Enabled assets</legend>
        <div className="admin-check-grid">
          {ASSETS.map((symbol) => (
            <label key={symbol} className="admin-check">
              <input
                type="checkbox"
                checked={assets.includes(symbol)}
                onChange={(event) =>
                  setAssets((current) =>
                    event.target.checked
                      ? [...current, symbol]
                      : current.filter((item) => item !== symbol),
                  )
                }
              />
              <span>{symbol}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="admin-check">
        <input
          type="checkbox"
          checked={!enabled}
          onChange={(event) => setEnabled(!event.target.checked)}
        />
        <span>Kill switch: pause all new quotes and preparations</span>
      </label>
      {message.length > 0 && (
        <p className="callout callout-safe" role="status">
          {message}
        </p>
      )}
      {error.length > 0 && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="button button-primary"
        type="button"
        onClick={() => void save()}
        disabled={busy}
      >
        {busy ? "Saving…" : "Save policy"}
      </button>
    </div>
  );
}
