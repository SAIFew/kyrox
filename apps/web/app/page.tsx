"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { encodeFunctionData, formatUnits, parseUnits } from "viem";

import { exactApprovalAmount } from "../lib/approvals";
import { connectWallet, ensureChain, provider, sendTransaction, signMessage } from "../lib/wallet";

interface AssetView {
  symbol: string;
  name: string;
  stockToken: string;
  stockDecimals: number;
  priceUsdc: string | null;
  sourceUpdatedAt: number | null;
  observedAt: number | null;
  fresh: boolean;
  simulated: boolean;
}

interface AssetsPayload {
  assets: AssetView[];
  settlement: string;
  exchange: string;
  mode: "local-anvil" | "base-sepolia";
  simulated: boolean;
  walletNetwork: { chainId: number; rpcUrl: string; name: string } | null;
}

interface PortfolioPayload {
  settlement: { amount: string; valueUsdc: string | null };
  positions: Array<{ symbol: string; amount: string; valueUsdc: string | null; stale: boolean }>;
  totalUsdc: string | null;
  simulated: boolean;
  stale: boolean;
}

interface ActivityItem {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  amountIn: string;
  minAmountOut: string;
  status: "prepared" | "submitted" | "included" | "verified" | "failed" | "reorged";
  txHash: string | null;
  createdAt: string;
}

interface QuoteView {
  quoteId: string;
  quoteToken: string;
  symbol: string;
  side: "buy" | "sell";
  priceUsdc: string;
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  sourceUpdatedAt: number;
  expiresAt: number;
  simulatedPrice: boolean;
  limits: { minUsdc: string; maxUsdc: string; dailyUsdc: string };
}

interface IntentView {
  intentId: string;
  amountIn: string;
  to: `0x${string}`;
  data: `0x${string}`;
  hash: `0x${string}`;
  deadline: number;
}

const ERC20_APPROVE = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const ERC20_CLAIM = [
  {
    type: "function",
    name: "claimWelcome",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const;

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function age(seconds: number | null): string {
  if (seconds === null) return "—";
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - seconds);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

const STATUS_LABEL: Record<ActivityItem["status"], string> = {
  prepared: "Prepared · not executed",
  submitted: "Submitted",
  included: "Included · confirming",
  verified: "Verified",
  failed: "Failed",
  reorged: "Reorged",
};

export default function HomePage() {
  const [assets, setAssets] = useState<AssetsPayload | null>(null);
  const [session, setSession] = useState<{ address: string } | null>(null);
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioPayload | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [selected, setSelected] = useState("tAAPL");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [intent, setIntent] = useState<IntentView | null>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState<string>("");
  const [authBusy, setAuthBusy] = useState(false);

  const loadAssets = useCallback(async () => {
    const response = await fetch("/api/assets", { cache: "no-store" });
    if (!response.ok) throw new Error("Assets are unavailable.");
    setAssets((await response.json()) as AssetsPayload);
  }, []);

  const loadSession = useCallback(async () => {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    const payload = (await response.json()) as { session: { address: string } | null };
    setSession(payload.session);
    return payload.session;
  }, []);

  const loadAccountData = useCallback(async () => {
    const [portfolioResponse, activityResponse] = await Promise.all([
      fetch("/api/portfolio", { cache: "no-store" }),
      fetch("/api/activity", { cache: "no-store" }),
    ]);
    if (portfolioResponse.ok) setPortfolio((await portfolioResponse.json()) as PortfolioPayload);
    if (activityResponse.ok) {
      const payload = (await activityResponse.json()) as { activity: ActivityItem[] };
      setActivity(payload.activity);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await loadAssets();
        const active = await loadSession();
        if (active !== null) await loadAccountData();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Application is not configured.");
      }
    })();
  }, [loadAssets, loadSession, loadAccountData]);

  useEffect(() => {
    if (session === null) return;
    const timer = setInterval(() => {
      void loadAccountData();
    }, 8_000);
    return () => clearInterval(timer);
  }, [session, loadAccountData]);

  const asset = useMemo(
    () => assets?.assets.find((entry) => entry.symbol === selected) ?? null,
    [assets, selected],
  );
  const position = portfolio?.positions.find((entry) => entry.symbol === selected) ?? null;

  async function authenticate() {
    setError("");
    setAuthBusy(true);
    try {
      const connected = await connectWallet();
      setAccount(connected.address);
      if (assets?.walletNetwork) await ensureChain(assets.walletNetwork.rpcUrl);
      const chainId = Number(await provider().request({ method: "eth_chainId" }));
      if (chainId !== 84_532) {
        throw new Error("Wallet is on the wrong network. Switch to Base Sepolia (84532).");
      }

      const nonceResponse = await fetch("/api/auth/nonce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: connected.address }),
      });
      const noncePayload = (await nonceResponse.json()) as { message?: string; error?: string };
      if (!nonceResponse.ok || noncePayload.message === undefined) {
        throw new Error(noncePayload.error ?? "Could not start authentication.");
      }
      const signature = await signMessage(connected.address, noncePayload.message);
      const verifyResponse = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: noncePayload.message, signature }),
      });
      const verified = (await verifyResponse.json()) as { error?: string; address?: string };
      if (!verifyResponse.ok) throw new Error(verified.error ?? "Signature was rejected.");
      setSession({ address: verified.address ?? connected.address });
      await loadAccountData();
      setStatus("Wallet ownership verified.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet authentication failed.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/session", { method: "DELETE" });
    setSession(null);
    setPortfolio(null);
    setActivity([]);
    setQuote(null);
    setIntent(null);
    setStatus("");
  }

  async function requestQuote() {
    setError("");
    setQuote(null);
    setIntent(null);
    if (amount.trim().length === 0) {
      setError("Enter an amount.");
      return;
    }
    setBusy("quote");
    try {
      const decimals = side === "buy" ? 6 : (asset?.stockDecimals ?? 18);
      const amountIn = parseUnits(amount.trim(), decimals).toString();
      const response = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: selected, side, amountIn, slippageBps }),
      });
      const payload = (await response.json()) as QuoteView & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Quote failed.");
      setQuote(payload);
      setStatus("Quote prepared by KYROX. Review before preparing a transaction.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Quote failed.");
    } finally {
      setBusy("");
    }
  }

  async function prepareTrade() {
    if (quote === null) return;
    setError("");
    setBusy("prepare");
    try {
      const response = await fetch("/api/trades/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId: quote.quoteId, quoteToken: quote.quoteToken }),
      });
      const payload = (await response.json()) as IntentView & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not prepare the transaction.");
      setIntent(payload);
      setStatus("Unsigned transaction prepared. Nothing has been submitted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preparation failed.");
    } finally {
      setBusy("");
    }
  }

  async function approveIntent() {
    if (intent === null || account === null) return;
    setError("");
    setBusy("wallet");
    setStatus("Awaiting wallet approval…");
    try {
      if (assets === null) throw new Error("Deployment information is unavailable.");
      const approvalToken = quote?.side === "sell" ? asset?.stockToken : assets.settlement;
      if (approvalToken !== undefined) {
        const approvalAmount = exactApprovalAmount(intent.amountIn);
        const approvalDecimals = quote?.side === "sell" ? (asset?.stockDecimals ?? 18) : 6;
        setStatus(
          `Awaiting wallet approval for exactly ${formatUnits(approvalAmount, approvalDecimals)} ${
            quote?.side === "sell" ? quote.symbol : "tUSDC"
          }…`,
        );
        await sendTransaction({
          from: account,
          to: approvalToken as `0x${string}`,
          data: encodeFunctionData({
            abi: ERC20_APPROVE,
            functionName: "approve",
            args: [assets.exchange as `0x${string}`, approvalAmount],
          }),
        });
      }
      const hash = await sendTransaction({
        from: account,
        to: intent.to,
        data: intent.data,
      });
      setStatus(`Submitted ${short(hash)}. Waiting for inclusion.`);
      const response = await fetch("/api/trades/submitted", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intentId: intent.intentId, txHash: hash }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Submitted transaction could not be recorded.");
      }
      setIntent(null);
      setQuote(null);
      await loadAccountData();
      setStatus(
        "Transaction submitted. Status updates below; an unsigned intent is never counted as executed.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "The wallet rejected the transaction.");
      setStatus("");
    } finally {
      setBusy("");
    }
  }

  async function faucet() {
    if (assets === null || account === null) return;
    setError("");
    setBusy("faucet");
    try {
      const hash = await sendTransaction({
        from: account,
        to: assets.settlement as `0x${string}`,
        data: encodeFunctionData({ abi: ERC20_CLAIM, functionName: "claimWelcome" }),
      });
      setStatus(`Faucet transaction ${short(hash)} submitted.`);
      await loadAccountData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Faucet request failed.");
    } finally {
      setBusy("");
    }
  }

  const totalLabel =
    portfolio === null
      ? "—"
      : portfolio.totalUsdc === null
        ? "Unpriced"
        : `${Number(portfolio.totalUsdc).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })} tUSDC`;

  const maxAmountLabel = side === "buy" ? "tUSDC" : selected;
  const available = side === "buy" ? portfolio?.settlement.amount : position?.amount;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="mark">K</span>
          <div>
            <p className="brand-name">KYROX</p>
            <p className="brand-sub">Tokenized equities · testnet</p>
          </div>
        </div>
        <div className="topbar-right">
          <span className={`env-chip ${assets?.mode === "local-anvil" ? "local" : ""}`}>
            {assets?.mode === "local-anvil" ? "LOCAL ANVIL · SIMULATED" : "BASE SEPOLIA"}
          </span>
          {session === null ? (
            <button className="button primary" onClick={authenticate} disabled={authBusy}>
              {authBusy ? "Connecting…" : account ? "Sign in" : "Connect wallet"}
            </button>
          ) : (
            <div className="wallet-chip">
              <span className="dot" /> {short(session.address)}
              <button className="link" onClick={logout}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      {assets?.mode === "local-anvil" && (
        <div className="notice">
          Local development environment. Prices are simulated observations, not Chainlink mainnet
          events. Balances and trades exist only on a disposable Anvil chain.
        </div>
      )}

      {error.length > 0 && (
        <div className="alert" role="alert">
          {error}
          <button className="link" onClick={() => setError("")}>
            Dismiss
          </button>
        </div>
      )}

      <section className="hero">
        <div>
          <p className="eyebrow">Portfolio</p>
          <h1 className="value">{totalLabel}</h1>
          <p className="muted">
            {session === null
              ? "Connect and verify your wallet to view balances."
              : portfolio?.stale
                ? "One or more positions have no fresh reference price."
                : "Valued at the latest verified reference observation."}
          </p>
        </div>
        <div className="hero-actions">
          <button
            className="button ghost"
            onClick={faucet}
            disabled={session === null || busy === "faucet"}
          >
            {busy === "faucet" ? "Requesting…" : "Claim 1,000 test tUSDC"}
          </button>
          <button
            className="button ghost"
            onClick={() => void loadAccountData()}
            disabled={session === null}
          >
            Refresh
          </button>
        </div>
      </section>

      <div className="grid">
        <section className="panel portfolio-panel">
          <div className="panel-head">
            <h2>Balances</h2>
            <span className="muted small">{assets?.simulated ? "simulated data" : "onchain"}</span>
          </div>
          <div className="balance-row">
            <span>tUSDC</span>
            <strong>{portfolio?.settlement.amount ?? "—"}</strong>
          </div>
          {assets?.assets.map((entry) => {
            const holding = portfolio?.positions.find(
              (position) => position.symbol === entry.symbol,
            );
            return (
              <button
                key={entry.symbol}
                className={`asset-row ${selected === entry.symbol ? "selected" : ""}`}
                onClick={() => {
                  setSelected(entry.symbol);
                  setQuote(null);
                  setIntent(null);
                  setStatus("");
                }}
              >
                <span className="asset-id">
                  <span className="asset-symbol">{entry.symbol}</span>
                  <span className="muted small">{entry.name}</span>
                </span>
                <span className="asset-numbers">
                  <span>{holding?.amount ?? "0"}</span>
                  <span className="muted small">
                    {entry.priceUsdc === null
                      ? "no price"
                      : `${Number(entry.priceUsdc).toFixed(2)} tUSDC`}
                  </span>
                </span>
              </button>
            );
          })}
          <div className="freshness">
            <span className={`dot ${asset?.fresh ? "ok" : "warn"}`} />
            <span>
              {selected} reference price {asset?.fresh ? "fresh" : "stale or missing"} ·{" "}
              {age(asset?.sourceUpdatedAt ?? null)}
              {asset?.simulated ? " · simulated" : ""}
            </span>
          </div>
        </section>

        <section className="panel trade-panel">
          <div className="panel-head">
            <h2>Trade</h2>
            <span className="muted small">Reference-price mint / burn</span>
          </div>
          <div className="segmented" role="tablist" aria-label="Trade side">
            <button
              className={side === "buy" ? "active" : ""}
              onClick={() => {
                setSide("buy");
                setQuote(null);
                setIntent(null);
              }}
            >
              Buy
            </button>
            <button
              className={side === "sell" ? "active" : ""}
              onClick={() => {
                setSide("sell");
                setQuote(null);
                setIntent(null);
              }}
            >
              Sell
            </button>
          </div>
          <label className="field">
            <span>Amount</span>
            <div className="input-wrap">
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setQuote(null);
                  setIntent(null);
                }}
              />
              <span className="unit">{maxAmountLabel}</span>
            </div>
            <span className="muted small">Available: {available ?? "—"}</span>
          </label>
          <label className="field">
            <span>Slippage tolerance</span>
            <select
              value={slippageBps}
              onChange={(event) => setSlippageBps(Number(event.target.value))}
            >
              <option value={10}>0.10%</option>
              <option value={50}>0.50%</option>
              <option value={100}>1.00%</option>
            </select>
          </label>
          <button
            className="button primary wide"
            onClick={requestQuote}
            disabled={session === null || busy !== "" || amount.length === 0}
          >
            {busy === "quote" ? "Preparing quote…" : "Get quote"}
          </button>

          {quote !== null && (
            <div className="quote-card">
              <div className="quote-head">
                <span>Quote</span>
                <span className="muted small">
                  expires {new Date(quote.expiresAt * 1000).toLocaleTimeString()}
                </span>
              </div>
              <dl>
                <div>
                  <dt>Reference price</dt>
                  <dd>{Number(quote.priceUsdc).toFixed(2)} tUSDC</dd>
                </div>
                <div>
                  <dt>{side === "buy" ? "Estimated stock" : "Estimated tUSDC"}</dt>
                  <dd>{quote.amountOut}</dd>
                </div>
                <div>
                  <dt>Minimum received</dt>
                  <dd>{quote.minAmountOut}</dd>
                </div>
                <div>
                  <dt>Limits</dt>
                  <dd>
                    {quote.limits.minUsdc}–{quote.limits.maxUsdc} tUSDC
                  </dd>
                </div>
              </dl>
              {quote.simulatedPrice && <p className="tag">Simulated reference price</p>}
              {intent === null ? (
                <button
                  className="button primary wide"
                  onClick={prepareTrade}
                  disabled={busy !== ""}
                >
                  {busy === "prepare" ? "Preparing transaction…" : "Prepare transaction"}
                </button>
              ) : (
                <div className="intent-box">
                  <p className="muted small">Unsigned transaction — review in your wallet.</p>
                  <dl>
                    <div>
                      <dt>To</dt>
                      <dd className="mono">{short(intent.to)}</dd>
                    </div>
                    <div>
                      <dt>Intent hash</dt>
                      <dd className="mono">{short(intent.hash)}</dd>
                    </div>
                    <div>
                      <dt>Approval</dt>
                      <dd>
                        {formatUnits(
                          BigInt(intent.amountIn),
                          quote.side === "sell" ? (asset?.stockDecimals ?? 18) : 6,
                        )}{" "}
                        {quote.side === "sell" ? quote.symbol : "tUSDC"}
                      </dd>
                    </div>
                    <div>
                      <dt>Deadline</dt>
                      <dd>{new Date(intent.deadline * 1000).toLocaleTimeString()}</dd>
                    </div>
                  </dl>
                  <button
                    className="button primary wide"
                    onClick={approveIntent}
                    disabled={busy !== ""}
                  >
                    {busy === "wallet" ? "Waiting for wallet…" : "Approve in wallet"}
                  </button>
                </div>
              )}
            </div>
          )}
          {status.length > 0 && (
            <p className="status" role="status">
              {status}
            </p>
          )}
        </section>
      </div>

      <section className="panel activity-panel">
        <div className="panel-head">
          <h2>Activity</h2>
          <span className="muted small">Prepared intents are not executed trades</span>
        </div>
        {activity.length === 0 ? (
          <p className="empty">
            {session === null
              ? "Sign in to see activity."
              : "No activity yet. Prepare a quote and approve it in your wallet."}
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Asset</th>
                  <th>Side</th>
                  <th>Amount in</th>
                  <th>Status</th>
                  <th>Transaction</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((item) => (
                  <tr key={item.id}>
                    <td>{new Date(item.createdAt).toLocaleTimeString()}</td>
                    <td>{item.symbol}</td>
                    <td className={item.side === "buy" ? "buy" : "sell"}>{item.side}</td>
                    <td className="mono">
                      {formatUnits(BigInt(item.amountIn), item.side === "buy" ? 6 : 18)}
                    </td>
                    <td>
                      <span className={`status-pill s-${item.status}`}>
                        {STATUS_LABEL[item.status]}
                      </span>
                    </td>
                    <td className="mono">{item.txHash === null ? "—" : short(item.txHash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="footer">
        <span>KYROX · testnet prototype</span>
        <span>No real funds · no investment advice</span>
        <span>
          {assets?.mode === "local-anvil" ? "Local Anvil chain 84532" : "Base Sepolia 84532"}
        </span>
      </footer>
    </main>
  );
}
