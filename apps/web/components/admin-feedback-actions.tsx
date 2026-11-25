"use client";

import { useState } from "react";

export function AdminFeedbackActions({ id, status }: { id: number; status: string }) {
  const [value, setValue] = useState(status);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/feedback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: value }),
      });
      if (response.ok) setDone(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="admin-inline">
      <select value={value} onChange={(event) => setValue(event.target.value)} disabled={busy}>
        <option value="new">new</option>
        <option value="reviewed">reviewed</option>
        <option value="closed">closed</option>
      </select>
      <button
        type="button"
        className="button button-ghost button-small"
        onClick={() => void save()}
        disabled={busy || done}
      >
        {done ? "Saved" : "Save"}
      </button>
    </span>
  );
}
