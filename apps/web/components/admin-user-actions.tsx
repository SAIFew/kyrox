"use client";

import { useState } from "react";

export function AdminUserActions({
  address,
  status,
  notes,
  canDelete = false,
}: {
  address: string;
  status: "active" | "flagged" | "banned";
  notes: string | null;
  canDelete?: boolean;
}) {
  const [nextStatus, setNextStatus] = useState(status);
  const [nextNotes, setNextNotes] = useState(notes ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState("");

  const save = async () => {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/admin/users/${address}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, notes: nextNotes }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not update user.");
      setMessage("User updated and audited.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update user.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Review status</h2>
      </div>
      <label className="field">
        <span className="field-label">Status</span>
        <select
          value={nextStatus}
          onChange={(event) => setNextStatus(event.target.value as typeof nextStatus)}
        >
          <option value="active">Active</option>
          <option value="flagged">Flagged (excluded from public leaderboard)</option>
          <option value="banned">Banned</option>
        </select>
      </label>
      <label className="field">
        <span className="field-label">Admin notes</span>
        <textarea
          rows={4}
          maxLength={2_000}
          value={nextNotes}
          onChange={(event) => setNextNotes(event.target.value)}
        />
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
        {busy ? "Saving…" : "Save review"}
      </button>
      {canDelete && (
        <div className="callout callout-danger" style={{ marginTop: 18 }}>
          <strong>Delete personal data</strong>
          <p className="muted small">
            Removes the account, events, points, referrals, feedback, trades, and claims. The audit
            log records the action without the wallet address.
          </p>
          <label className="field">
            <span className="field-label">Type the wallet to confirm</span>
            <input value={confirm} onChange={(event) => setConfirm(event.target.value)} />
          </label>
          <button
            className="button button-ghost button-small"
            type="button"
            disabled={busy || confirm.toLowerCase() !== address.toLowerCase()}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const response = await fetch(`/api/admin/users/${address}`, {
                  method: "DELETE",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ confirm }),
                });
                const payload = (await response.json()) as { error?: string };
                if (!response.ok) throw new Error(payload.error ?? "Could not delete user.");
                setMessage("Personal data deleted.");
                setConfirm("");
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not delete user.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete personal data
          </button>
        </div>
      )}
    </div>
  );
}
