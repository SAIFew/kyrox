"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { formatUnits, parseUnits, toHex } from "viem";

import type {
  ActivityItem,
  EnvironmentInfo,
  PortfolioPayload,
  SessionPayload,
} from "../lib/market-types";
import { api, ApiError } from "../lib/api";
import { shortAddress } from "../lib/format";
import {
  BASE_SEPOLIA_CHAIN_ID,
  connectWallet,
  ensureChain,
  getChainId,
  isBaseSepolia,
  revokeWalletPermissions,
  type EthereumProvider,
} from "../lib/wallet";
import { ArrowUpRight, CheckIcon, CloseIcon, ShieldIcon, SparkIcon, WalletIcon } from "./icons";

interface SessionResponse {
  session: SessionPayload | null;
  environment: EnvironmentInfo;
}

interface AccountContextValue {
  ready: boolean;
  session: SessionPayload | null;
  environment: EnvironmentInfo | null;
  portfolio: PortfolioPayload | null;
  activity: ActivityItem[];
  wallet: { address: `0x${string}`; chainId: number } | null;
  walletOnBase: boolean;
  busy: string;
  error: string;
  authOpen: boolean;
  openAuth: () => void;
  closeAuth: () => void;
  clearError: () => void;
  refreshAll: () => Promise<void>;
  signInDemo: () => Promise<void>;
  signInWallet: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

export function useAccount(): AccountContextValue {
  const context = useContext(AccountContext);
  if (context === null) throw new Error("useAccount must be used inside AccountProvider.");
  return context;
}

function ethereum(): EthereumProvider | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { ethereum?: EthereumProvider }).ethereum ?? null;
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [environment, setEnvironment] = useState<EnvironmentInfo | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioPayload | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [wallet, setWallet] = useState<{ address: `0x${string}`; chainId: number } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const signingOut = useRef(false);
  const sessionRef = useRef<SessionPayload | null>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const loadAccountData = useCallback(async (active: boolean) => {
    if (!active) {
      setPortfolio(null);
      setActivity([]);
      return;
    }
    const [portfolioResult, activityResult] = await Promise.allSettled([
      api<{ portfolio: PortfolioPayload }>("/api/portfolio"),
      api<{ activity: ActivityItem[] }>("/api/activity"),
    ]);
    if (portfolioResult.status === "fulfilled") {
      setPortfolio(portfolioResult.value.portfolio);
    } else {
      setError(
        portfolioResult.reason instanceof Error
          ? portfolioResult.reason.message
          : "Portfolio is unavailable.",
      );
    }
    if (activityResult.status === "fulfilled") {
      setActivity(activityResult.value.activity);
    } else {
      setError(
        activityResult.reason instanceof Error
          ? activityResult.reason.message
          : "Activity is unavailable.",
      );
    }
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      const response = await api<SessionResponse>("/api/auth/session");
      setEnvironment(response.environment);
      setSession(response.session);
      setError("");
      await loadAccountData(response.session !== null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the KYROX API.");
    } finally {
      setReady(true);
    }
  }, [loadAccountData]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const signOut = useCallback(async () => {
    if (signingOut.current) return;
    signingOut.current = true;
    sessionRef.current = null;
    setBusy("signout");
    try {
      await revokeWalletPermissions();
      await fetch("/api/auth/session", { method: "DELETE" });
      setSession(null);
      setPortfolio(null);
      setActivity([]);
      setWallet(null);
    } finally {
      signingOut.current = false;
      setBusy("");
    }
  }, []);

  const syncWallet = useCallback(async () => {
    const eth = ethereum();
    if (eth === null) {
      setWallet(null);
      return;
    }
    try {
      const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
      const address = accounts[0];
      if (address === undefined) {
        setWallet(null);
        return;
      }
      const chainId = await getChainId(eth);
      setWallet({ address: address as `0x${string}`, chainId });
    } catch {
      setWallet(null);
    }
  }, []);

  useEffect(() => {
    void syncWallet();
  }, [syncWallet, session?.address]);

  useEffect(() => {
    const eth = ethereum();
    if (eth?.on === undefined) return;
    const onAccounts = (accounts: unknown) => {
      const list = Array.isArray(accounts) ? accounts.map(String) : [];
      if (list.length === 0) setWallet(null);
      void syncWallet();
      const current = sessionRef.current;
      if (
        current !== null &&
        !list.some((account) => account.toLowerCase() === current.address.toLowerCase())
      ) {
        void signOut();
      }
    };
    const onChain = (chainId: unknown) => {
      const id = Number(chainId);
      setWallet((current) => (current === null ? null : { ...current, chainId: id }));
    };
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [session, signOut, syncWallet]);

  const signInDemo = useCallback(async () => {
    setBusy("demo");
    setError("");
    try {
      await fetch("/api/auth/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? "Could not start the preview account.");
        }
      });
      await refreshAll();
      setAuthOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the preview account.");
    } finally {
      setBusy("");
    }
  }, [refreshAll]);

  const signInWallet = useCallback(async () => {
    setBusy("wallet");
    setError("");
    try {
      const eth = ethereum();
      if (eth === null) {
        throw new Error(
          "No injected wallet detected. Install a browser wallet, or continue with the preview account.",
        );
      }
      const connected = await connectWallet();
      const chainId = await ensureChain();
      const address = connected.address;
      setWallet({ address, chainId });

      const nonceResponse = await fetch("/api/auth/nonce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const noncePayload = (await nonceResponse.json()) as { message?: string; error?: string };
      if (!nonceResponse.ok || noncePayload.message === undefined) {
        throw new Error(noncePayload.error ?? "Could not start wallet authentication.");
      }
      const signature = (await eth.request({
        method: "personal_sign",
        params: [toHex(noncePayload.message), address],
      })) as string;
      const verifyResponse = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: noncePayload.message, signature }),
      });
      const verified = (await verifyResponse.json()) as { error?: string };
      if (!verifyResponse.ok) throw new Error(verified.error ?? "Signature was rejected.");
      await refreshAll();
      setAuthOpen(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Wallet sign-in failed. Continue with the preview account instead.",
      );
    } finally {
      setBusy("");
    }
  }, [refreshAll]);

  const value = useMemo<AccountContextValue>(
    () => ({
      ready,
      session,
      environment,
      portfolio,
      activity,
      wallet,
      walletOnBase: wallet !== null && isBaseSepolia(wallet.chainId),
      busy,
      error,
      authOpen,
      openAuth: () => {
        setError("");
        setAuthOpen(true);
      },
      closeAuth: () => setAuthOpen(false),
      clearError: () => setError(""),
      refreshAll,
      signInDemo,
      signInWallet,
      signOut,
    }),
    [
      ready,
      session,
      environment,
      portfolio,
      activity,
      wallet,
      busy,
      error,
      authOpen,
      refreshAll,
      signInDemo,
      signInWallet,
      signOut,
    ],
  );

  return (
    <AccountContext.Provider value={value}>
      {children}
      <AuthModal />
    </AccountContext.Provider>
  );
}

function AuthModal() {
  const { authOpen, closeAuth, signInDemo, signInWallet, busy, error, environment, wallet } =
    useAccount();
  const [hasWallet, setHasWallet] = useState(false);

  useEffect(() => {
    if (authOpen) setHasWallet(ethereum() !== null);
  }, [authOpen]);

  if (!authOpen) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={closeAuth}>
      <div
        aria-labelledby="auth-title"
        aria-modal="true"
        className="modal auth-modal"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="icon-button modal-close" onClick={closeAuth} aria-label="Close">
          <CloseIcon size={16} />
        </button>
        <span className="modal-eyebrow">
          <ShieldIcon size={14} /> Non-custodial access
        </span>
        <h2 id="auth-title">Sign in to KYROX</h2>
        <p className="modal-lead">
          KYROX never holds your keys. Access is proven with a wallet signature, and every
          transaction is authorised by you.
        </p>

        <div className="auth-network">
          <span
            className={`status-light ${
              wallet === null ? "off" : isBaseSepolia(wallet.chainId) ? "ok" : "warn"
            }`}
          />
          <span>
            {wallet === null
              ? "No wallet connected in this browser"
              : isBaseSepolia(wallet.chainId)
                ? `Wallet network · Base Sepolia (${BASE_SEPOLIA_CHAIN_ID})`
                : `Wallet network · chain ${wallet.chainId} — switch required`}
          </span>
          {wallet !== null && <code>{shortAddress(wallet.address)}</code>}
        </div>

        {environment?.mode === "demo" && (
          <div className="callout callout-warn">
            <SparkIcon size={16} />
            <p>
              This deployment is a <strong>simulated preview</strong>. The preview account has
              simulated balances; wallet sign-in verifies ownership but trades stay off-chain and
              are never broadcast.
            </p>
          </div>
        )}

        <button
          className="auth-option primary"
          onClick={() => void signInDemo()}
          disabled={busy !== ""}
        >
          <span className="auth-option-icon">
            <SparkIcon size={20} />
          </span>
          <span>
            <strong>
              {busy === "demo" ? "Opening preview…" : "Continue with preview account"}
            </strong>
            <small>Instant access · simulated portfolio · no wallet required</small>
          </span>
          <ArrowUpRight size={16} />
        </button>

        <button
          className="auth-option"
          onClick={() => void signInWallet()}
          disabled={busy !== ""}
          title={hasWallet ? undefined : "No injected wallet detected"}
        >
          <span className="auth-option-icon">
            <WalletIcon size={20} />
          </span>
          <span>
            <strong>{busy === "wallet" ? "Waiting for wallet…" : "Connect wallet"}</strong>
            <small>
              {hasWallet
                ? wallet !== null && !isBaseSepolia(wallet.chainId)
                  ? "Switch to Base Sepolia and sign a message to prove ownership"
                  : "Sign a message to prove ownership · Base Sepolia"
                : "No injected wallet detected in this browser"}
            </small>
          </span>
          <ArrowUpRight size={16} />
        </button>

        {error.length > 0 && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <p className="modal-foot">
          By continuing you accept the <a href="/legal">preview terms</a>. Testnet assets have no
          monetary value. Nothing here is investment advice.
        </p>
      </div>
    </div>
  );
}

export function ConnectButton() {
  const { session, openAuth, signOut, busy, wallet } = useAccount();

  if (session === null) {
    return (
      <button className="button button-primary button-small" onClick={openAuth}>
        <WalletIcon size={15} />
        Connect
      </button>
    );
  }

  const networkMatch =
    wallet !== null && wallet.address.toLowerCase() === session.address.toLowerCase();

  return (
    <div className={`account-chip ${networkMatch ? "has-network" : ""}`}>
      <span className={`account-dot ${session.demo ? "demo" : "live"}`} />
      <span className="account-address">{shortAddress(session.address)}</span>
      {session.demo && <span className="account-tag">demo</span>}
      {networkMatch &&
        (isBaseSepolia(wallet.chainId) ? (
          <span className="account-network ok" title="Base Sepolia · 84532">
            Base
          </span>
        ) : (
          <button
            className="account-network warn"
            onClick={() => void ensureChain()}
            title={`Wallet on chain ${wallet.chainId}. Switch to Base Sepolia (84532).`}
          >
            Switch
          </button>
        ))}
      <button
        className="account-signout"
        onClick={() => void signOut()}
        disabled={busy === "signout"}
        aria-label="Sign out"
      >
        <CloseIcon size={13} />
      </button>
    </div>
  );
}

export function parseHumanUnits(value: string, decimals: number): bigint {
  return parseUnits(value, decimals);
}

export function formatBaseUnits(value: bigint, decimals: number): string {
  return formatUnits(value, decimals);
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function CheckedBadge() {
  return (
    <span className="checked-badge">
      <CheckIcon size={12} /> verified
    </span>
  );
}
