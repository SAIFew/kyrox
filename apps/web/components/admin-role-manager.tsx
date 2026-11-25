"use client";

import { useState } from "react";

interface RoleRow {
  wallet: string;
  role: "owner" | "admin" | "analyst" | "support";
  addedBy: string | null;
  createdAt: string | Date;
}

const ROLES = ["owner", "admin", "analyst", "support"] as const;

export function AdminRoleManager({ initial }: { initial: RoleRow[] }) {
  const [rows, setRows] = useState(initial);
  const [wallet, setWallet] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("analyst");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const add = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, role }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not add admin.");
      setRows((current) => {
        const rest = current.filter((entry) => entry.wallet.toLowerCase() !== wallet.toLowerCase());
        return [
          ...rest,
          { wallet: wallet.toLowerCase(), role, addedBy: null, createdAt: new Date() },
        ];
      });
      setWallet("");
      setMessage("Admin role saved and audited.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add admin.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (target: string) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/roles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: target }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not remove admin.");
      setRows((current) =>
        current.filter((entry) => entry.wallet.toLowerCase() !== target.toLowerCase()),
      );
      setMessage("Admin removed and audited.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove admin.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Admin roles</h2>
          <p className="muted small">
            Owner can manage admins. Admin can manage policy and reviews. Analyst is read-only.
            Support can review users and feedback.
          </p>
        </div>
      </div>
      <div className="status-table">
        {rows.map((entry) => (
          <div className="status-row" key={entry.wallet}>
            <div className="status-row-main">
              <strong className="mono">{entry.wallet}</strong>
              <span>
                {entry.addedBy === null ? "Bootstrap owner" : `Added by ${entry.addedBy}`}
              </span>
            </div>
            <span className="status-pill ok">{entry.role}</span>
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={() => void remove(entry.wallet)}
              disabled={busy}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className="admin-form-grid">
        <label className="field">
          <span className="field-label">Wallet</span>
          <input
            value={wallet}
            onChange={(event) => setWallet(event.target.value)}
            placeholder="0x…"
          />
        </label>
        <label className="field">
          <span className="field-label">Role</span>
          <select value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
            {ROLES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>
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
        onClick={() => void add()}
        disabled={busy}
      >
        {busy ? "Saving…" : "Add or update admin"}
      </button>
    </div>
  );
}
