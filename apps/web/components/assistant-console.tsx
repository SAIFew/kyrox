"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";

import { ArrowUpRight, SparkIcon } from "./icons";

const SUGGESTIONS = [
  "Buy $100 of Nvidia",
  "What is Tesla at?",
  "How is my portfolio?",
  "Build me a tech portfolio with $500",
] as const;

interface Answer {
  kind: "quote" | "price" | "portfolio" | "basket" | "help";
  answer: string;
  href?: string;
  symbol?: string;
  priceUsdc?: string | null;
}

export function AssistantConsole() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const ask = async (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const payload = (await response.json()) as Answer & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "The assistant could not answer.");
      setAnswer(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The assistant could not answer.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Ask KYROX</h2>
          <p className="muted small">
            Deterministic preview grammar. It can explain prices, propose quotes, and describe a
            portfolio. It cannot sign, execute, or change policy.
          </p>
        </div>
        <span className="sim-badge">
          <SparkIcon size={13} /> Read + quote
        </span>
      </div>

      <form
        className="field"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
      >
        <label className="field-label" htmlFor="assistant-question">
          <span>Your question</span>
          <span className="muted small">No real advice</span>
        </label>
        <div className="amount-input">
          <input
            id="assistant-question"
            value={question}
            maxLength={500}
            placeholder="Buy $100 of Nvidia"
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button className="button button-primary button-small" type="submit" disabled={busy}>
            {busy ? "Thinking…" : "Ask"}
          </button>
        </div>
      </form>

      <div className="page-head-actions" aria-label="Example questions">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="button button-ghost button-small"
            onClick={() => {
              setQuestion(suggestion);
              void ask(suggestion);
            }}
            disabled={busy}
          >
            {suggestion}
          </button>
        ))}
      </div>

      {error.length > 0 && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {answer !== null && (
        <div className="callout callout-safe" role="status" aria-live="polite">
          <p>{answer.answer}</p>
          {answer.href !== undefined && (
            <Link className="text-link" href={answer.href as Route}>
              Open {answer.kind === "basket" ? "basket builder" : "market"}{" "}
              <ArrowUpRight size={13} />
            </Link>
          )}
        </div>
      )}

      <p className="muted small">
        Test tokens. No real value. Not real shares. Not investment advice. Questions are stored as
        counts and topic categories only, never as full text.
      </p>
    </div>
  );
}
