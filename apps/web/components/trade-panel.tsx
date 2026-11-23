"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { encodeFunctionData, parseUnits } from "viem";

import type {
  MarketAsset,
  MarketSnapshot,
  PreparedIntentPayload,
  QuotePayload,
  TradeSide,
} from "../lib/market-types";
import { api, ApiError } from "../lib/api";
import {
  activityAmountLabel,
  formatPrice,
  formatTokenAmount,
  shortAddress,
  timeAgo,
} from "../lib/format";
import { exactApprovalAmount } from "../lib/approvals";
import { sendTransaction } from "../lib/wallet";
import { useAccount } from "./account-provider";
import { ArrowRight, CheckIcon, InfoIcon, LockIcon, WalletIcon } from "./icons";

const ERC20_APPROVE = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "boolean" }],
  },
] as const;

interface AssetsPayload {
  settlement: string;
  exchange: string;
  assets: Array<{ symbol: string; stockToken: string; stockDecimals: number }>;
}

interface FillResult {
  reference: string;
  side: TradeSide;
  amountIn: string;
  amountOut: string;
}

export function TradePanel({ asset, snapshot }: { asset: MarketAsset; snapshot: MarketSnapshot }) {
  const {
    session,
    environment,
    portfolio,
    refreshAll,
    openAuth,
    error: accountError,
  } = useAccount();
  const [side, setSide] = useState<TradeSide>("buy");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [stage, setStage] = useState<"input" | "review" | "done">("input");
  const [quote, setQuote] = useState<QuotePayload | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [fill, setFill] = useState<FillResult | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));

  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => clearInterval(timer);
  }, []);

  const position = portfolio?.positions.find((entry) => entry.symbol === asset.symbol) ?? null;
  const available = side === "buy" ? portfolio?.cash.amount : position?.amount;
  const decimalsIn = side === "buy" ? 6 : asset.decimals;
  const incomingSymbol = side === "buy" ? asset.symbol : "tUSDC";
  const outgoingSymbol = side === "buy" ? "tUSDC" : asset.symbol;

  const estimate = useMemo(() => {
    const price = Number(snapshot.priceUsdc);
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(price) || price <= 0) {
      return null;
    }
    return side === "buy" ? value / price : value * price;
  }, [amount, side, snapshot.priceUsdc]);

  const expired = quote !== null && quote.expiresAt <= now;
  const secondsLeft = quote === null ? 0 : Math.max(0, quote.expiresAt - now);

  function resetFlow() {
    setStage("input");
    setQuote(null);
    setFill(null);
    setTxHash(null);
    setError("");
  }

  function changeSide(next: TradeSide) {
    setSide(next);
    setAmount("");
    resetFlow();
  }

  async function requestQuote() {
    setError("");
    if (amount.trim().length === 0) {
      setError("Enter an amount first.");
      return;
    }
    let amountIn: string;
    try {
      amountIn = parseUnits(amount.trim(), decimalsIn).toString();
    } catch {
      setError(`Enter a valid amount with up to ${decimalsIn} decimal places.`);
      return;
    }
    if (BigInt(amountIn) <= 0n) {
      setError("Amount must be greater than zero.");
      return;
    }
    setBusy("quote");
    try {
      const response = await api<{ quote: QuotePayload }>("/api/quotes", {
        method: "POST",
        body: JSON.stringify({ symbol: asset.symbol, side, amountIn, slippageBps }),
      });
      setQuote(response.quote);
      setStage("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not prepare a quote.");
    } finally {
      setBusy("");
    }
  }

  const refresh = useCallback(async () => {
    await refreshAll();
  }, [refreshAll]);

  async function executeSimulated() {
    if (quote === null) return;
    setBusy("execute");
    setError("");
    try {
      const response = await api<{ fill: FillResult & { id: string; reference: string } }>(
        "/api/trades/execute",
        {
          method: "POST",
          body: JSON.stringify({ quoteId: quote.quoteId, quoteToken: quote.quoteToken }),
        },
      );
      setFill(response.fill);
      setStage("done");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulated execution failed.");
      if (err instanceof ApiError && err.code === "quote_expired") {
        setStage("input");
        setQuote(null);
      }
    } finally {
      setBusy("");
    }
  }

  async function executeWallet() {
    if (quote === null) return;
    if (session === null) {
      openAuth();
      return;
    }
    setBusy("wallet");
    setError("");
    try {
      const prepared = await api<PreparedIntentPayload>("/api/trades/prepare", {
        method: "POST",
        body: JSON.stringify({ quoteId: quote.quoteId, quoteToken: quote.quoteToken }),
      });
      const assets = await api<AssetsPayload>("/api/assets");
      const token =
        quote.side === "sell"
          ? assets.assets.find((entry) => entry.symbol === asset.symbol)?.stockToken
          : assets.settlement;
      if (token === undefined) throw new Error("Asset addresses are unavailable.");
      await sendTransaction({
        from: session.address as `0x${string}`,
        to: token as `0x${string}`,
        data: encodeFunctionData({
          abi: ERC20_APPROVE,
          functionName: "approve",
          args: [assets.exchange as `0x${string}`, exactApprovalAmount(prepared.amountIn)],
        }),
      });
      const hash = await sendTransaction({
        from: session.address as `0x${string}`,
        to: prepared.to as `0x${string}`,
        data: prepared.data as `0x${string}`,
      });
      await api("/api/trades/submitted", {
        method: "POST",
        body: JSON.stringify({ intentId: prepared.intentId, txHash: hash }),
      });
      setTxHash(hash);
      setFill({
        reference: hash,
        side: quote.side,
        amountIn: quote.amountIn,
        amountOut: quote.amountOut,
      });
      setStage("done");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The wallet rejected the transaction.");
    } finally {
      setBusy("");
    }
  }

  const preview = environment?.mode === "demo";
  const canExecuteOnChain =
    environment !== null &&
    environment.mode !== "demo" &&
    (environment.contracts === "deployed" || environment.contracts === "local");
  const venueLabel = preview
    ? "simulated venue"
    : environment?.mode === "local-anvil"
      ? "local Anvil"
      : "on-chain";

  if (session === null) {
    return (
      <aside className="trade-panel panel">
        <div className="trade-head">
          <h2>Trade {asset.symbol}</h2>
          <span className="sim-badge">simulated</span>
        </div>
        <div className="trade-locked">
          <span className="trade-lock-icon">
            <LockIcon size={22} />
          </span>
          <h3>Sign in to prepare an order</h3>
          <p>
            Use the preview account for instant simulated balances, or verify a wallet to prove
            ownership. KYROX never holds keys.
          </p>
          <button className="button button-primary wide" onClick={openAuth}>
            <WalletIcon size={16} /> Sign in
          </button>
          <p className="muted small">
            Preview trading is off-chain. No transaction is signed or broadcast.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="trade-panel panel" id="trade">
      <div className="trade-head">
        <h2>Trade {asset.symbol}</h2>
        <span className={preview ? "sim-badge" : "sim-badge live"}>{venueLabel}</span>
      </div>

      {stage !== "done" && (
        <>
          <div className="segmented" role="tablist" aria-label="Order side">
            <button
              role="tab"
              aria-selected={side === "buy"}
              className={side === "buy" ? "is-active buy" : ""}
              onClick={() => changeSide("buy")}
            >
              Buy
            </button>
            <button
              role="tab"
              aria-selected={side === "sell"}
              className={side === "sell" ? "is-active sell" : ""}
              onClick={() => changeSide("sell")}
            >
              Sell
            </button>
          </div>

          {stage === "input" && (
            <>
              <label className="field">
                <span className="field-label">
                  <span>You pay</span>
                  <span className="muted small">
                    Available {available === undefined ? "—" : formatTokenAmount(available, 4)}{" "}
                    {outgoingSymbol}
                  </span>
                </span>
                <div className="amount-input">
                  <input
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amount}
                    onChange={(event) => {
                      setAmount(event.target.value);
                      setError("");
                    }}
                    aria-label={`Amount in ${outgoingSymbol}`}
                  />
                  <button
                    type="button"
                    className="max-button"
                    onClick={() => {
                      if (available !== undefined) setAmount(available);
                    }}
                  >
                    MAX
                  </button>
                  <span className="amount-unit">{outgoingSymbol}</span>
                </div>
              </label>

              <div className="estimate-row">
                <span>You receive (estimated)</span>
                <strong>
                  {estimate === null ? "—" : `≈ ${formatTokenAmount(estimate, 4)}`} {incomingSymbol}
                </strong>
              </div>

              <div className="slip-row">
                <span>Slippage tolerance</span>
                <div className="pill-group">
                  {[10, 50, 100].map((value) => (
                    <button
                      key={value}
                      className={slippageBps === value ? "is-active" : ""}
                      onClick={() => setSlippageBps(value)}
                    >
                      {(value / 100).toFixed(2)}%
                    </button>
                  ))}
                </div>
              </div>

              <div className="trade-meta">
                <span>Reference price</span>
                <strong>{formatPrice(snapshot.priceUsdc)} tUSDC</strong>
              </div>
              <div className="trade-meta">
                <span>Source observation</span>
                <span className="freshness is-fresh">
                  <span className="dot" /> {timeAgo(snapshot.sourceUpdatedAt)}
                </span>
              </div>

              {error.length > 0 && <p className="form-error">{error}</p>}
              {accountError.length > 0 && error.length === 0 && (
                <p className="form-error">{accountError}</p>
              )}

              <button
                className="button button-primary wide"
                onClick={() => void requestQuote()}
                disabled={busy !== "" || amount.trim().length === 0}
              >
                {busy === "quote" ? "Preparing quote…" : "Review order"} <ArrowRight size={16} />
              </button>
              <p className="trade-foot">
                <InfoIcon size={13} /> Quotes use integer-only maths and expire after 120 seconds.
              </p>
            </>
          )}

          {stage === "review" && quote !== null && (
            <div className="review-box">
              <div className="review-head">
                <span>Review {quote.side === "buy" ? "buy" : "sell"}</span>
                <span className={`review-timer ${expired ? "is-expired" : ""}`}>
                  {expired ? "expired" : `${secondsLeft}s`}
                </span>
              </div>
              <dl className="review-list">
                <div>
                  <dt>You pay</dt>
                  <dd>
                    {quote.amountInLabel} {outgoingSymbol}
                  </dd>
                </div>
                <div>
                  <dt>You receive (estimated)</dt>
                  <dd>
                    {quote.amountOutLabel} {incomingSymbol}
                  </dd>
                </div>
                <div>
                  <dt>Minimum received</dt>
                  <dd>
                    {quote.minAmountOutLabel} {incomingSymbol}
                  </dd>
                </div>
                <div>
                  <dt>Reference price</dt>
                  <dd>{formatPrice(quote.priceUsdc)} tUSDC</dd>
                </div>
                <div>
                  <dt>Observation age</dt>
                  <dd>{timeAgo(quote.sourceUpdatedAt)}</dd>
                </div>
                <div>
                  <dt>Daily limit remaining</dt>
                  <dd>{formatTokenAmount(quote.limits.remainingUsdc, 2)} tUSDC</dd>
                </div>
              </dl>

              {preview ? (
                <div className="callout callout-warn compact">
                  <InfoIcon size={15} />
                  <p>
                    Simulated fill: balances update in this preview only. No transaction is signed
                    or broadcast.
                  </p>
                </div>
              ) : (
                <div className="callout compact">
                  <LockIcon size={15} />
                  <p>
                    On-chain intent: you approve exactly {quote.amountInLabel} {outgoingSymbol},
                    then sign the exchange call in your wallet.
                  </p>
                </div>
              )}

              {error.length > 0 && <p className="form-error">{error}</p>}

              <div className="review-actions">
                <button className="button button-ghost" onClick={resetFlow} disabled={busy !== ""}>
                  Back
                </button>
                {preview ? (
                  <button
                    className="button button-primary"
                    onClick={() => void executeSimulated()}
                    disabled={busy !== "" || expired}
                  >
                    {busy === "execute" ? "Recording fill…" : "Confirm simulated fill"}
                  </button>
                ) : (
                  <button
                    className="button button-primary"
                    onClick={() => void executeWallet()}
                    disabled={busy !== "" || expired || !canExecuteOnChain}
                    title={
                      canExecuteOnChain
                        ? undefined
                        : "On-chain settlement is not deployed in this environment."
                    }
                  >
                    {busy === "wallet"
                      ? "Waiting for wallet…"
                      : canExecuteOnChain
                        ? "Approve in wallet"
                        : "Settlement not deployed"}
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {stage === "done" && fill !== null && (
        <div className="trade-success">
          <span className="success-icon">
            <CheckIcon size={24} />
          </span>
          <h3>{txHash === null ? "Simulated fill recorded" : "Transaction submitted"}</h3>
          <p>
            {txHash === null
              ? "Your preview balances and activity were updated. Nothing was broadcast to a blockchain."
              : `Wallet transaction ${shortAddress(txHash)} was submitted. Confirmation status is tracked in activity.`}
          </p>
          <div className="success-summary">
            {activityAmountLabel({
              side: fill.side,
              amountIn: fill.amountIn,
              amountOut: fill.amountOut,
              symbol: asset.symbol,
            })}
          </div>
          <div className="success-actions">
            <Link className="button button-primary" href="/portfolio">
              View portfolio
            </Link>
            <button className="button button-ghost" onClick={resetFlow}>
              Trade again
            </button>
          </div>
          <span className="muted small">
            {txHash === null ? `Reference ${fill.reference}` : "Tracked on Base Sepolia"}
          </span>
        </div>
      )}
    </aside>
  );
}
