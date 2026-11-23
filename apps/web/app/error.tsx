"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("KYROX runtime error", error.digest ?? "no-digest");
  }, [error]);

  return (
    <div className="page-width not-found">
      <p className="eyebrow">System notice</p>
      <h1>Something interrupted this view.</h1>
      <p className="page-lead">
        The interface hit an unexpected error. Your signed preview session is unaffected. Retry, or
        return to the market list.
      </p>
      <div className="hero-ctas">
        <button className="button button-primary" onClick={reset}>
          Try again
        </button>
        <Link className="button button-ghost" href="/markets">
          Back to markets
        </Link>
      </div>
    </div>
  );
}
