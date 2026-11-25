"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    const digest = error instanceof Error && "digest" in error ? String(error.digest) : "no-digest";
    console.error("KYROX runtime error", digest);
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "client_error", props: { digest } }),
      keepalive: true,
    }).catch(() => undefined);
  }, [error]);

  return (
    <div className="page-width not-found">
      <p className="eyebrow">System notice</p>
      <h1>Something interrupted this view.</h1>
      <p className="page-lead" role="alert">
        The interface hit an unexpected error. Retry this view, or return to the market list. Your
        current session state remains visible in the navigation.
      </p>
      <div className="hero-ctas">
        <button className="button button-primary" onClick={retry}>
          Try again
        </button>
        <Link className="button button-ghost" href="/markets">
          Back to markets
        </Link>
      </div>
    </div>
  );
}
