"use client";

import { useState } from "react";
import { toBaseUnits } from "@kyrox/core";

import type { QuotePayload } from "../lib/market-types";
import { api } from "../lib/api";
import { resolveWalletNetwork, sendTransaction, walletErrorMessage } from "../lib/wallet";
import { useAccount } from "./account-provider";
import { ArrowUpRight, MinusIcon, PlusIcon } from "./icons";

interface Leg {
  symbol: string;
  amount: string;
}

const SYMBOLS = ["tAAPL", "tNVDA", "tMSFT", "tGOOGL", "tAMZN", "tTSLA", "tMETA"] as const;

interface BasketResponse {
  mode: "demo" | "live";
  quotes: QuotePayload[];
  totalUsdc: string;
  executionNote: string;
  disclaimer: string;
}

interface PrepareResponse {
  intentId: string;
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  amountIn: string;
}

export function BasketBuilder() {
  const { session, environment, openAuth, refreshAll } = useAccount();
  const [legs, setLegs] = useState<Leg[]>([{ symbol: "tAAPL", amount: "100" }]);
  const [basket, setBasket] = useState<BasketResponse | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const updateLeg = (index: number, patch: Partial<Leg>) => {
    setLegs((current) => current.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)));
    setBasket(null);
    setNotice("");
  };

  const quote = async () => {
    if (session === null) {
      openAuth();
      return;
    }
    setBusy("quote");
    setError("");
    setNotice("");
    try {
      const payload = await api<BasketResponse>("/api/quotes/basket", {
        method: "POST",
        body: JSON.stringify({
          legs: legs.map((leg) => ({
            symbol: leg.symbol,
            amountUsdc: toBaseUnits(leg.amount, 6).toString(),
          })),
        }),
      });
      setBasket(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not quote this basket.");
    } finally {
      setBusy("");
    }
  };

  const execute = async () => {
    if (basket === null || session === null) return;
    setBusy("execute");
    setError("");
    try {
      if (basket.mode === "demo") {
        const payload = await api<{ message: string }>("/api/trades/basket", {
          method: "POST",
          body: JSON.stringify({
            quotes: basket.quotes.map((entry) => ({
              quoteId: entry.quoteId,
              quoteToken: entry.quoteToken,
            })),
          }),
        });
        setNotice(payload.message);
      } else {
        if (environment === null) throw new Error("Environment is still loading.");
        const network = resolveWalletNetwork(environment);
        for (const entry of basket.quotes) {
          const prepared = await api<PrepareResponse>("/api/trades/prepare", {
            method: "POST",
            body: JSON.stringify({ quoteId: entry.quoteId, quoteToken: entry.quoteToken }),
          });
          try {
            const hash = await sendTransaction({
              from: session.address as `0x${string}`,
              to: prepared.to,
              data: prepared.data,
              value: prepared.value,
              network,
            });
            await api("/api/trades/submitted", {
              method: "POST",
              body: JSON.stringify({ intentId: prepared.intentId, txHash: hash }),
            });
          } catch (err) {
            throw new Error(`Leg ${entry.symbol} failed: ${walletErrorMessage(err)}`, {
              cause: err,
            });
          }
        }
        setNotice("All prepared legs were submitted by your wallet. Check activity for status.");
      }
      await refreshAll();
      setBasket(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Basket execution failed.");
    } finally {
      setBusy("");
    }
  };

  if (session === null) {
    return (
      <div className="panel">
        <h2>Sign in to build a basket</h2>
        <p className="muted">
          A basket combines up to four test-stock legs. Each leg is still constrained by the same
          per-trade and daily limits.
        </p>
        <button className="button button-primary" onClick={openAuth}>
          Sign in <ArrowUpRight size={15} />
        </button>
      </div>
    );
  }

  return (
    <div className="page-stack">
      {error.length > 0 && (
        <div className="callout callout-danger" role="alert">
          {error}
        </div>
      )}
      {notice.length > 0 && (
        <div className="callout callout-safe" role="status">
          {notice}
        </div>
      )}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Basket builder</h2>
            <p className="muted small">
              Up to four buys. Quotes are independent and expire in 30 seconds.
            </p>
          </div>
          <span className="sim-badge">Simulated preview</span>
        </div>

        {legs.map((leg, index) => (
          <div className="basket-leg" key={`${leg.symbol}-${index}`}>
            <label className="field">
              <span className="field-label">
                <span>Asset</span>
              </span>
              <select
                value={leg.symbol}
                onChange={(event) => updateLeg(index, { symbol: event.target.value })}
              >
                {SYMBOLS.map((symbol) => (
                  <option key={symbol} value={symbol}>
                    {symbol}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">
                <span>Amount</span>
                <span className="muted small">tUSDC</span>
              </span>
              <input
                inputMode="decimal"
                value={leg.amount}
                onChange={(event) => updateLeg(index, { amount: event.target.value })}
                placeholder="100"
              />
            </label>
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={() => {
                setLegs((current) => current.filter((_, i) => i !== index));
                setBasket(null);
              }}
              disabled={legs.length === 1}
              aria-label="Remove leg"
            >
              <MinusIcon size={14} />
            </button>
          </div>
        ))}

        <div className="page-head-actions">
          <button
            type="button"
            className="button button-ghost button-small"
            onClick={() =>
              setLegs((current) =>
                current.length >= 4 ? current : [...current, { symbol: "tNVDA", amount: "100" }],
              )
            }
            disabled={legs.length >= 4}
          >
            <PlusIcon size={14} /> Add leg
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => void quote()}
            disabled={busy !== "" || legs.some((leg) => Number(leg.amount) <= 0)}
          >
            {busy === "quote" ? "Quoting…" : "Get basket quote"}
          </button>
        </div>
      </section>

      {basket !== null && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Review {basket.quotes.length} legs</h2>
              <p className="muted small">
                Total {Number(basket.totalUsdc) / 1_000_000} tUSDC · {basket.executionNote}
              </p>
            </div>
          </div>
          <div className="status-table">
            {basket.quotes.map((entry) => (
              <div className="status-row" key={entry.quoteId}>
                <div className="status-row-main">
                  <strong>{entry.symbol}</strong>
                  <span>
                    Pay {entry.amountInLabel} tUSDC · receive ≈ {entry.amountOutLabel} shares
                  </span>
                </div>
                <span className="muted small">{entry.priceUsdc} tUSDC</span>
              </div>
            ))}
          </div>
          <div className="page-head-actions">
            <button
              className="button button-primary"
              type="button"
              onClick={() => void execute()}
              disabled={busy !== ""}
            >
              {busy === "execute"
                ? "Executing…"
                : basket.mode === "demo"
                  ? "Execute in preview"
                  : "Prepare and sign each leg"}
            </button>
          </div>
          <p className="muted small">{basket.disclaimer}</p>
        </section>
      )}
    </div>
  );
}
