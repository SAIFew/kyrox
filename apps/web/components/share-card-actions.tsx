"use client";

import { useState } from "react";

import { useAccount } from "./account-provider";
import { ArrowUpRight } from "./icons";

export function ShareCardActions() {
  const { session } = useAccount();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  if (session === null) return null;

  const share = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/rewards");
      const payload = (await response.json()) as { referralUrl?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not load your referral link.");
      const url = payload.referralUrl ?? window.location.origin;
      const title = "My KYROX test portfolio";
      if (navigator.share !== undefined) {
        await navigator.share({ title, text: "Test tokens, no real value.", url });
      } else {
        await navigator.clipboard.writeText(url);
        setNotice("Referral link copied.");
      }
      await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "share_created", props: { surface: "portfolio" } }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not share.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="admin-inline">
      <a
        className="button button-ghost button-small"
        href="/api/share-card"
        target="_blank"
        rel="noreferrer"
        onClick={() => {
          void fetch("/api/events", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "share_created", props: { surface: "image" } }),
          });
        }}
      >
        Share card <ArrowUpRight size={13} />
      </a>
      <button
        className="button button-ghost button-small"
        type="button"
        onClick={() => void share()}
        disabled={busy}
      >
        {busy ? "Sharing…" : "Referral link"}
      </button>
      {notice.length > 0 && <span className="muted small">{notice}</span>}
      {error.length > 0 && (
        <span className="form-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
