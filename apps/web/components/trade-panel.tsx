"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { encodeFunctionData, formatUnits, isAddress, parseUnits, zeroAddress } from "viem";

import type {
  EnvironmentInfo,
  MarketAsset,
  MarketSnapshot,
  PreparedIntentPayload,
  QuotePayload,
  TradeSide,
} from "../lib/market-types";
import { api, ApiError } from "../lib/api";
import {
  assetDisplayName,
  environmentLabel,
  observationBadge,
  isDemoEnvironment,
  settlementDisplayName,
} from "../lib/presentation";
import {
  activityAmountLabel,
  formatDurationSeconds,
  formatPrice,
  formatTokenAmount,
  shortAddress,
  timeAgo,
  toNumber,
} from "../lib/format";
import { exactApprovalAmount } from "../lib/approvals";
import {
  readErc20Allowance,
  resolveWalletNetwork,
  sendTransaction,
  verifyTransactionContext,
  waitForTransactionReceipt,
  walletErrorMessage,
} from "../lib/wallet";
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

type RuntimeQuote = QuotePayload & { readonly ttlSeconds?: number | null };

type ExecutionPhase =
  | "prepare"
  | "wallet"
  | "allowance"
  | "approval"
  | "approval-receipt"
  | "exchange-check"
  | "exchange"
  | "record"
  | "refresh";

const BUSY_LABEL: Readonly<Record<string, string>> = {
  quote: "Preparing quote…",
  execute: "Recording simulated fill…",
  prepare: "Preparing intent…",
  wallet: "Checking wallet account and network…",
  allowance: "Checking token allowance…",
  approval: "Waiting for approval in wallet…",
  "approval-receipt": "Waiting for approval receipt…",
  "exchange-check": "Rechecking wallet account and network…",
  exchange: "Waiting for exchange signature…",
  record: "Recording submitted transaction…",
};

function amountLabel(label: unknown, raw: unknown, decimals: number): string {
  if (typeof label === "string" && label.trim().length > 0) return label;
  try {
    return formatUnits(BigInt(String(raw)), decimals);
  } catch {
    return "—";
  }
}

export function TradePanel({
  asset,
  snapshot,
  environmentOverride,
}: {
  asset: MarketAsset;
  snapshot: MarketSnapshot;
  environmentOverride?: EnvironmentInfo | null;
}) {
  const account = useAccount();
  const environment = environmentOverride ?? account.environment;
  const { session, portfolio, refreshAll, openAuth, error: accountError } = account;
  const [side, setSide] = useState<TradeSide>("buy");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [stage, setStage] = useState<"input" | "review" | "done">("input");
  const [quote, setQuote] = useState<RuntimeQuote | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [fill, setFill] = useState<FillResult | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1_000));

  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1_000)), 1_000);
    return () => clearInterval(timer);
  }, []);

  const position = portfolio?.positions.find((entry) => entry.symbol === asset.symbol) ?? null;
  const available = side === "buy" ? portfolio?.cash.amount : position?.amount;
  const availableValue = toNumber(available);
  const decimalsIn = side === "buy" ? 6 : asset.decimals;
  const incomingSymbol = side === "buy" ? assetDisplayName(asset.symbol) : settlementDisplayName();
  const outgoingSymbol = side === "buy" ? settlementDisplayName() : assetDisplayName(asset.symbol);
  const referencePrice = toNumber(snapshot.priceUsdc);
  const hasFreshPrice = snapshot.fresh && referencePrice !== null && referencePrice > 0;

  const estimate = useMemo(() => {
    const price = toNumber(snapshot.priceUsdc);
    const value = toNumber(amount);
    if (!snapshot.fresh || price === null || price <= 0 || value === null || value <= 0) {
      return null;
    }
    return side === "buy" ? value / price : value * price;
  }, [amount, side, snapshot.fresh, snapshot.priceUsdc]);

  const expired = quote !== null && (toNumber(quote.expiresAt) ?? 0) <= now;
  const secondsLeft = quote === null ? 0 : Math.max(0, (toNumber(quote.expiresAt) ?? 0) - now);
  const ttlLabel = formatDurationSeconds(toNumber((quote as RuntimeQuote | null)?.ttlSeconds));
  const preview = environment?.mode === "demo";
  const canExecuteOnChain =
    environment !== null &&
    environment.mode !== "demo" &&
    (environment.contracts === "deployed" || environment.contracts === "local");
  const venueLabel = preview
    ? "simulated venue"
    : environment?.mode === "local-anvil"
      ? "local Anvil"
      : "on-chain testnet";
  const executionBlocked = expired || !hasFreshPrice || environment === null;

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
    if (environment === null) {
      setError("The environment is still loading. Try again in a moment.");
      return;
    }
    if (!snapshot.fresh) {
      setError(
        "The reference price is stale. Quotes are disabled until a fresh observation is available.",
      );
      return;
    }
    if (referencePrice === null || referencePrice <= 0) {
      setError("No valid reference price is available. Quotes are disabled.");
      return;
    }
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
      const response = await api<{ quote: RuntimeQuote }>("/api/quotes", {
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
    if (quote === null || environment?.mode !== "demo" || expired || !hasFreshPrice) return;
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
    if (quote === null || session === null || environment === null || !canExecuteOnChain) return;
    if (isDemoEnvironment(environment) || session.demo) {
      setError("Demo mode never sends wallet transactions.");
      return;
    }
    if (expired || !hasFreshPrice) {
      setError(
        "This quote cannot be executed because its reference price is stale or the quote expired.",
      );
      return;
    }

    let phase: ExecutionPhase = "prepare";
    let submittedHash: `0x${string}` | null = null;
    let approvalSent = false;
    setBusy("prepare");
    setError("");
    try {
      const network = resolveWalletNetwork(environment);
      const prepared = await api<PreparedIntentPayload>("/api/trades/prepare", {
        method: "POST",
        body: JSON.stringify({ quoteId: quote.quoteId, quoteToken: quote.quoteToken }),
      });
      if (prepared.mode === "simulated") {
        throw new Error("The server prepared a simulated intent. No wallet transaction was sent.");
      }
      if (prepared.amountIn !== quote.amountIn) {
        throw new Error("The prepared amount changed. Request a new quote before sending.");
      }

      const assets = await api<AssetsPayload>("/api/assets");
      const token =
        quote.side === "sell"
          ? assets.assets.find((entry) => entry.symbol === asset.symbol)?.stockToken
          : assets.settlement;
      if (token === undefined || !isAddress(token) || token.toLowerCase() === zeroAddress) {
        throw new Error("Asset addresses are unavailable.");
      }
      if (!isAddress(assets.exchange) || assets.exchange.toLowerCase() === zeroAddress) {
        throw new Error("The exchange address is unavailable.");
      }
      if (!isAddress(prepared.to) || prepared.to.toLowerCase() !== assets.exchange.toLowerCase()) {
        throw new Error("The prepared exchange does not match the asset catalogue.");
      }

      const requiredAllowance = exactApprovalAmount(prepared.amountIn);
      phase = "wallet";
      setBusy("wallet");
      await verifyTransactionContext(session.address as `0x${string}`, network);

      phase = "allowance";
      setBusy("allowance");
      let allowance = await readErc20Allowance({
        token: token as `0x${string}`,
        owner: session.address as `0x${string}`,
        spender: assets.exchange as `0x${string}`,
      });

      if (allowance < requiredAllowance) {
        phase = "approval";
        setBusy("approval");
        const approvalHash = await sendTransaction({
          from: session.address as `0x${string}`,
          to: token as `0x${string}`,
          data: encodeFunctionData({
            abi: ERC20_APPROVE,
            functionName: "approve",
            args: [assets.exchange as `0x${string}`, requiredAllowance],
          }),
          value: "0x0",
          network,
        });
        approvalSent = true;

        phase = "approval-receipt";
        setBusy("approval-receipt");
        await waitForTransactionReceipt(approvalHash);
      }

      phase = "wallet";
      setBusy("wallet");
      await verifyTransactionContext(session.address as `0x${string}`, network);
      phase = "allowance";
      setBusy("allowance");
      allowance = await readErc20Allowance({
        token: token as `0x${string}`,
        owner: session.address as `0x${string}`,
        spender: assets.exchange as `0x${string}`,
      });
      if (allowance < requiredAllowance) {
        throw new Error("The confirmed approval did not provide enough allowance.");
      }

      phase = "exchange-check";
      setBusy("exchange-check");
      await verifyTransactionContext(session.address as `0x${string}`, network);
      phase = "exchange";
      setBusy("exchange");
      const hash = await sendTransaction({
        from: session.address as `0x${string}`,
        to: prepared.to as `0x${string}`,
        data: prepared.data as `0x${string}`,
        value: prepared.value,
        network,
      });
      submittedHash = hash;
      setTxHash(hash);
      setFill({
        reference: hash,
        side: quote.side,
        amountIn: quote.amountIn,
        amountOut: quote.amountOut,
      });
      setStage("done");

      phase = "record";
      setBusy("record");
      await api("/api/trades/submitted", {
        method: "POST",
        body: JSON.stringify({ intentId: prepared.intentId, txHash: hash }),
      });
      phase = "refresh";
      await refresh();
    } catch (err) {
      const message = walletErrorMessage(err);
      if (submittedHash !== null) {
        setError(
          phase === "refresh"
            ? `Transaction ${shortAddress(submittedHash)} was submitted and recorded, but account data could not refresh. Do not resend. ${message}`
            : `Transaction ${shortAddress(submittedHash)} was submitted, but KYROX could not record it. Do not resend; check activity or system status. ${message}`,
        );
      } else if (
        phase === "approval" ||
        phase === "approval-receipt" ||
        phase === "allowance" ||
        phase === "exchange-check"
      ) {
        setError(
          `Approval or allowance check failed: ${message} No exchange transaction was sent.`,
        );
      } else if (phase === "exchange") {
        setError(`Exchange transaction failed: ${message}`);
      } else if (phase === "wallet") {
        setError(
          `Wallet verification failed: ${message} ${approvalSent ? "No exchange transaction was sent." : "No transaction was sent."}`,
        );
      } else {
        setError(`Intent preparation failed: ${message}`);
      }
    } finally {
      setBusy("");
    }
  }

  if (session === null) {
    return (
      <aside className="trade-panel panel">
        <div className="trade-head">
          <h2>Trade {assetDisplayName(asset.symbol)}</h2>
          <span className="sim-badge">{observationBadge(environment, snapshot)}</span>
        </div>
        <div className="trade-locked">
          <span className="trade-lock-icon">
            <LockIcon size={22} />
          </span>
          <h3>Sign in to prepare an order</h3>
          <p>
            {preview
              ? "Use the preview account for instant simulated balances, or verify a wallet to prove ownership. KYROX never holds keys."
              : `Verify a wallet on ${environmentLabel(environment)} to prepare an order. KYROX never holds keys.`}
          </p>
          <button className="button button-primary wide" onClick={openAuth}>
            <WalletIcon size={16} /> Sign in
          </button>
          <p className="muted small">
            {preview
              ? "Preview trading is off-chain. No transaction is signed or broadcast."
              : "Testnet trading only. Every transaction is reviewed and authorised in your wallet."}{" "}
            Test tokens. No real value. Not real shares. Not investment advice.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="trade-panel panel" id="trade">
      <div className="trade-head">
        <h2>Trade {assetDisplayName(asset.symbol)}</h2>
        <span className={preview ? "sim-badge" : "sim-badge live"}>{venueLabel}</span>
      </div>

      {stage !== "done" && (
        <>
          <div className="segmented" role="group" aria-label="Order side">
            <button
              type="button"
              aria-pressed={side === "buy"}
              className={side === "buy" ? "is-active buy" : ""}
              onClick={() => changeSide("buy")}
              disabled={busy !== ""}
            >
              Buy
            </button>
            <button
              type="button"
              aria-pressed={side === "sell"}
              className={side === "sell" ? "is-active sell" : ""}
              onClick={() => changeSide("sell")}
              disabled={busy !== ""}
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
                    disabled={availableValue === null || availableValue <= 0}
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
              {!hasFreshPrice && (
                <p className="form-error" role="status">
                  {snapshot.fresh
                    ? "Reference price unavailable. Trade estimates and quotes are disabled."
                    : "Reference price stale. Trade estimates and quotes are disabled."}
                </p>
              )}

              <div className="slip-row">
                <span>Slippage tolerance</span>
                <div className="pill-group" role="group" aria-label="Slippage tolerance">
                  {[10, 50, 100].map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={slippageBps === value}
                      className={slippageBps === value ? "is-active" : ""}
                      onClick={() => setSlippageBps(value)}
                      disabled={busy !== ""}
                    >
                      {(value / 100).toFixed(2)}%
                    </button>
                  ))}
                </div>
              </div>

              <div className="trade-meta">
                <span>Reference price</span>
                <strong>
                  {formatPrice(snapshot.priceUsdc)} {settlementDisplayName()}
                </strong>
              </div>
              <div className="trade-meta">
                <span>Source observation</span>
                <span
                  className={`freshness ${
                    !snapshot.fresh || referencePrice === null ? "is-stale" : "is-fresh"
                  }`}
                >
                  <span className="dot" />{" "}
                  {!snapshot.fresh ? "stale" : referencePrice === null ? "unavailable" : "fresh"} ·{" "}
                  {timeAgo(snapshot.sourceUpdatedAt)}
                </span>
              </div>

              {error.length > 0 && (
                <p className="form-error" role="alert" aria-live="assertive">
                  {error}
                </p>
              )}
              {accountError.length > 0 && error.length === 0 && (
                <p className="form-error" role="alert" aria-live="assertive">
                  {accountError}
                </p>
              )}

              <button
                className="button button-primary wide"
                onClick={() => void requestQuote()}
                disabled={
                  busy !== "" ||
                  amount.trim().length === 0 ||
                  !hasFreshPrice ||
                  environment === null
                }
              >
                {busy === "quote" ? "Preparing quote…" : "Review order"} <ArrowRight size={16} />
              </button>
              <p className="trade-foot">
                <InfoIcon size={13} /> Quotes use integer-only maths and are valid for 30 seconds.
                Test tokens. No real value. Not real shares. Not investment advice.
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
                  <dt>Stock</dt>
                  <dd>
                    {assetDisplayName(asset.symbol)} · {asset.symbol}
                  </dd>
                </div>
                <div>
                  <dt>Amount</dt>
                  <dd>
                    {amountLabel(quote.amountInLabel, quote.amountIn, decimalsIn)} {outgoingSymbol}
                  </dd>
                </div>
                <div>
                  <dt>Shares</dt>
                  <dd>
                    {quote.side === "buy"
                      ? `${amountLabel(quote.amountOutLabel, quote.amountOut, asset.decimals)} ${assetDisplayName(asset.symbol)}`
                      : `${amountLabel(quote.amountInLabel, quote.amountIn, asset.decimals)} ${assetDisplayName(asset.symbol)}`}
                  </dd>
                </div>
                <div>
                  <dt>You receive (estimated)</dt>
                  <dd>
                    {amountLabel(
                      quote.amountOutLabel,
                      quote.amountOut,
                      quote.side === "buy" ? asset.decimals : 6,
                    )}{" "}
                    {incomingSymbol}
                  </dd>
                </div>
                <div>
                  <dt>Minimum received</dt>
                  <dd>
                    {amountLabel(
                      quote.minAmountOutLabel,
                      quote.minAmountOut,
                      quote.side === "buy" ? asset.decimals : 6,
                    )}{" "}
                    {incomingSymbol}
                  </dd>
                </div>
                <div>
                  <dt>Reference price</dt>
                  <dd>
                    {formatPrice(quote.priceUsdc)} {settlementDisplayName()}
                  </dd>
                </div>
                <div>
                  <dt>Price age</dt>
                  <dd>{timeAgo(quote.sourceUpdatedAt)}</dd>
                </div>
                <div>
                  <dt>Quote validity (TTL)</dt>
                  <dd>{ttlLabel ?? "Until the countdown expires"}</dd>
                </div>
                <div>
                  <dt>Order limits</dt>
                  <dd>
                    Min {formatTokenAmount(quote.limits.minUsdc, 2)} · Max{" "}
                    {formatTokenAmount(quote.limits.maxUsdc, 2)} {settlementDisplayName()}
                  </dd>
                </div>
                <div>
                  <dt>Daily limit remaining</dt>
                  <dd>
                    {formatTokenAmount(quote.limits.remainingUsdc, 2)} {settlementDisplayName()}
                  </dd>
                </div>
              </dl>

              <div className="callout callout-warn compact">
                <InfoIcon size={15} />
                <p>
                  <strong>
                    Test tokens. No real value. Not real shares. Not investment advice.
                  </strong>{" "}
                  {preview
                    ? "This quote belongs to the simulated venue and never touches a blockchain."
                    : "This quote is a testnet instruction, not an offer or recommendation."}
                </p>
              </div>

              {quote.simulatedPrice && !preview && (
                <div className="callout callout-warn compact">
                  <InfoIcon size={15} />
                  <p>
                    Simulated reference price with testnet settlement. The price is not a live
                    market quote.
                  </p>
                </div>
              )}

              {preview ? (
                <div className="callout callout-warn compact">
                  <InfoIcon size={15} />
                  <p>
                    Simulated fill: balances update in this demo only. No transaction is signed or
                    broadcast.
                  </p>
                </div>
              ) : (
                <div className="callout compact">
                  <LockIcon size={15} />
                  <p>
                    KYROX verifies your account and network, checks exact allowance, waits for any
                    approval receipt, then rechecks before the exchange call. No unlimited approval.
                  </p>
                </div>
              )}

              {executionBlocked && (
                <p className="form-error" role="status">
                  {environment === null
                    ? "Environment unavailable. Return and try again."
                    : !hasFreshPrice
                      ? "Reference price is stale or unavailable. Return and request a fresh quote."
                      : "This quote expired. Return and request a new quote."}
                </p>
              )}
              {error.length > 0 && (
                <p className="form-error" role="alert" aria-live="assertive">
                  {error}
                </p>
              )}
              {accountError.length > 0 && error.length === 0 && (
                <p className="form-error" role="alert" aria-live="assertive">
                  {accountError}
                </p>
              )}
              {busy.length > 0 && (
                <p className="muted small" role="status" aria-live="polite">
                  {BUSY_LABEL[busy] ?? busy}
                </p>
              )}

              <div className="review-actions">
                <button className="button button-ghost" onClick={resetFlow} disabled={busy !== ""}>
                  Back
                </button>
                {preview ? (
                  <button
                    className="button button-primary"
                    onClick={() => void executeSimulated()}
                    disabled={busy !== "" || executionBlocked}
                  >
                    {busy === "execute" ? "Recording fill…" : "Confirm simulated fill"}
                  </button>
                ) : (
                  <button
                    className="button button-primary"
                    onClick={() => void executeWallet()}
                    disabled={busy !== "" || executionBlocked || !canExecuteOnChain}
                    title={
                      canExecuteOnChain
                        ? undefined
                        : "On-chain settlement is not deployed in this environment."
                    }
                  >
                    {busy.length > 0
                      ? (BUSY_LABEL[busy] ?? "Working…")
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
              ? "Your demo balances and activity were updated. Nothing was broadcast to a blockchain."
              : `Wallet transaction ${shortAddress(txHash)} was submitted to ${environmentLabel(environment)}. Confirmation status is tracked in activity.`}
          </p>
          {error.length > 0 && (
            <p className="form-error" role="alert" aria-live="assertive">
              {error}
            </p>
          )}
          {busy.length > 0 && (
            <p className="muted small" role="status" aria-live="polite">
              {BUSY_LABEL[busy] ?? busy}
            </p>
          )}
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
            {txHash === null
              ? `Reference ${fill.reference}`
              : `Tracked on ${environmentLabel(environment)}`}
          </span>
        </div>
      )}
    </aside>
  );
}
