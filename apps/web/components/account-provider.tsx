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
import { formatUnits, parseUnits } from "viem";

import type {
  ActivityItem,
  EnvironmentInfo,
  PortfolioPayload,
  SessionPayload,
} from "../lib/market-types";
import { api, ApiError, UNAUTHORIZED_EVENT } from "../lib/api";
import { shortAddress } from "../lib/format";
import { isDemoEnvironment } from "../lib/presentation";
import {
  assertActiveAccount,
  connectWallet,
  ensureChain,
  getChainId,
  isWalletNetwork,
  resolveWalletNetwork,
  revokeWalletPermissions,
  signMessage,
  walletErrorMessage,
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
  activityStale: boolean;
  wallet: { address: `0x${string}`; chainId: number } | null;
  walletOnBase: boolean;
  busy: string;
  error: string;
  connectionError: string;
  authOpen: boolean;
  openAuth: () => void;
  closeAuth: () => void;
  clearError: () => void;
  refreshAll: () => Promise<void>;
  switchNetwork: () => Promise<void>;
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
  const [activityStale, setActivityStale] = useState(false);
  const [wallet, setWallet] = useState<{ address: `0x${string}`; chainId: number } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const signingOut = useRef(false);
  const sessionRef = useRef<SessionPayload | null>(null);
  const accountEpoch = useRef(0);

  const applySession = useCallback((next: SessionPayload | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const clearAccountData = useCallback(() => {
    accountEpoch.current += 1;
    applySession(null);
    setPortfolio(null);
    setActivity([]);
    setActivityStale(false);
  }, [applySession]);

  const loadAccountData = useCallback(async (active: SessionPayload | null) => {
    if (active === null) {
      setPortfolio(null);
      setActivity([]);
      setActivityStale(false);
      return;
    }
    const epoch = accountEpoch.current;
    const address = active.address;
    const [portfolioResult, activityResult] = await Promise.allSettled([
      api<{ portfolio: PortfolioPayload }>("/api/portfolio"),
      api<{ activity: ActivityItem[]; stale?: boolean }>("/api/activity"),
    ]);
    if (accountEpoch.current !== epoch || sessionRef.current?.address !== address) return;

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
      setActivityStale(activityResult.value.stale === true);
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
      accountEpoch.current += 1;
      setEnvironment(response.environment);
      applySession(response.session);
      setError("");
      setConnectionError("");
      await loadAccountData(response.session);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setError(err instanceof Error ? err.message : "Could not reach the KYROX API.");
    } finally {
      setReady(true);
    }
  }, [applySession, loadAccountData]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    const onUnauthorized = () => {
      clearAccountData();
      setBusy("");
      setError("Your session expired or is no longer authorised. Sign in again.");
      setAuthOpen(true);
      setReady(true);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [clearAccountData]);

  const signOut = useCallback(async () => {
    if (signingOut.current || sessionRef.current === null) return;
    signingOut.current = true;
    setBusy("signout");
    setConnectionError("");
    try {
      const revoked = await api<{ ok?: boolean }>("/api/auth/session", { method: "DELETE" });
      if (revoked?.ok === false) throw new Error("The server did not revoke the session.");
      clearAccountData();
      await revokeWalletPermissions();
      setWallet(null);
    } catch (err) {
      if (sessionRef.current === null) {
        setError(err instanceof Error ? err.message : "Sign-out failed.");
      } else {
        const reason = err instanceof Error ? err.message : "the server did not revoke the session";
        setConnectionError(
          `Sign-out failed: ${reason}${/[.!?]$/.test(reason) ? "" : "."} Your session is still active.`,
        );
      }
    } finally {
      signingOut.current = false;
      setBusy("");
    }
  }, [clearAccountData]);

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
      if (!Number.isInteger(id) || id <= 0) {
        void syncWallet();
        return;
      }
      setWallet((current) => (current === null ? null : { ...current, chainId: id }));
    };
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [signOut, syncWallet]);

  const switchNetwork = useCallback(async () => {
    if (wallet === null) {
      setConnectionError("Connect a wallet before switching networks.");
      return;
    }
    setBusy("network");
    setConnectionError("");
    try {
      const chainId = await ensureChain(resolveWalletNetwork(environment));
      setWallet({ address: wallet.address, chainId });
    } catch (err) {
      setConnectionError(walletErrorMessage(err));
    } finally {
      setBusy("");
    }
  }, [environment, wallet]);

  const signInDemo = useCallback(async () => {
    if (!isDemoEnvironment(environment)) {
      setError("Preview accounts are only available in the demo environment.");
      return;
    }
    setBusy("demo");
    setError("");
    try {
      await api("/api/auth/demo", {
        method: "POST",
        body: JSON.stringify({}),
      });
      await refreshAll();
      setAuthOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the preview account.");
    } finally {
      setBusy("");
    }
  }, [environment, refreshAll]);

  const signInWallet = useCallback(async () => {
    setBusy("wallet");
    setError("");
    try {
      const connected = await connectWallet();
      const chainId = await ensureChain(resolveWalletNetwork(environment));
      await assertActiveAccount(connected.address);
      setWallet({ address: connected.address, chainId });

      const nonce = await api<{ message: string }>("/api/auth/nonce", {
        method: "POST",
        body: JSON.stringify({ address: connected.address }),
      });
      const signature = await signMessage(connected.address, nonce.message);
      await api("/api/auth/verify", {
        method: "POST",
        body: JSON.stringify({ message: nonce.message, signature }),
      });
      await refreshAll();
      setAuthOpen(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Wallet sign-in failed. Check your wallet and try again.",
      );
    } finally {
      setBusy("");
    }
  }, [environment, refreshAll]);

  const openAuth = useCallback(() => {
    setError("");
    setConnectionError("");
    setAuthOpen(true);
  }, []);

  const closeAuth = useCallback(() => setAuthOpen(false), []);

  const clearError = useCallback(() => {
    setError("");
    setConnectionError("");
  }, []);

  const value = useMemo<AccountContextValue>(
    () => ({
      ready,
      session,
      environment,
      portfolio,
      activity,
      activityStale,
      wallet,
      walletOnBase:
        wallet !== null && isWalletNetwork(wallet.chainId, resolveWalletNetwork(environment)),
      busy,
      error,
      connectionError,
      authOpen,
      openAuth,
      closeAuth,
      clearError,
      refreshAll,
      switchNetwork,
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
      activityStale,
      wallet,
      busy,
      error,
      connectionError,
      authOpen,
      openAuth,
      closeAuth,
      clearError,
      refreshAll,
      switchNetwork,
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
  const {
    authOpen,
    closeAuth,
    signInDemo,
    signInWallet,
    switchNetwork,
    busy,
    error,
    connectionError,
    environment,
    wallet,
  } = useAccount();
  const [hasWallet, setHasWallet] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const network = resolveWalletNetwork(environment);
  const walletOnNetwork = wallet !== null && isWalletNetwork(wallet.chainId, network);
  const demo = isDemoEnvironment(environment);

  useEffect(() => {
    if (authOpen) setHasWallet(ethereum() !== null);
  }, [authOpen]);

  useEffect(() => {
    if (!authOpen) return;
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const initialFocus =
      dialog?.querySelector<HTMLElement>("[data-auth-autofocus]") ??
      dialog?.querySelector<HTMLElement>("button:not([disabled])") ??
      dialog;
    initialFocus?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeAuth();
        return;
      }
      if (event.key !== "Tab" || dialog === null || dialog === undefined) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    };
  }, [authOpen, closeAuth, demo]);

  if (!authOpen) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={closeAuth}>
      <div
        ref={dialogRef}
        aria-labelledby="auth-title"
        aria-describedby="auth-description"
        aria-modal="true"
        className="modal auth-modal"
        role="dialog"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="icon-button modal-close" onClick={closeAuth} aria-label="Close">
          <CloseIcon size={16} />
        </button>
        <span className="modal-eyebrow">
          <ShieldIcon size={14} /> Non-custodial access
        </span>
        <h2 id="auth-title">Sign in to KYROX</h2>
        <p className="modal-lead" id="auth-description">
          KYROX never holds your keys. Access is proven with a wallet signature, and every
          transaction is authorised by you.
        </p>

        <div className="auth-network">
          <span
            className={`status-light ${wallet === null ? "off" : walletOnNetwork ? "ok" : "warn"}`}
          />
          <span>
            {wallet === null
              ? `Target network · ${network.chainName} (${network.chainId})`
              : walletOnNetwork
                ? `Wallet network · ${network.chainName} (${network.chainId})`
                : `Wallet network · chain ${wallet.chainId} — switch required`}
          </span>
          {wallet !== null && <code>{shortAddress(wallet.address)}</code>}
          {wallet !== null && !walletOnNetwork && (
            <button
              type="button"
              className="text-link small"
              onClick={() => void switchNetwork()}
              disabled={busy !== ""}
            >
              {busy === "network" ? "Switching…" : "Switch network"}
            </button>
          )}
        </div>

        {demo && (
          <div className="callout callout-warn">
            <SparkIcon size={16} />
            <p>
              This deployment is a <strong>simulated demo</strong>. The preview account has
              simulated balances; wallet sign-in verifies ownership but trades stay off-chain and
              are never broadcast.
            </p>
          </div>
        )}

        {demo && (
          <button
            className="auth-option primary"
            onClick={() => void signInDemo()}
            disabled={busy !== ""}
            data-auth-autofocus
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
        )}

        <button
          className="auth-option"
          onClick={() => void signInWallet()}
          disabled={busy !== ""}
          title={hasWallet ? undefined : "No injected wallet detected"}
          data-auth-autofocus={demo ? undefined : ""}
        >
          <span className="auth-option-icon">
            <WalletIcon size={20} />
          </span>
          <span>
            <strong>{busy === "wallet" ? "Waiting for wallet…" : "Connect wallet"}</strong>
            <small>
              {hasWallet
                ? wallet !== null && !walletOnNetwork
                  ? `Switch to ${network.chainName} and sign a message to prove ownership`
                  : `Sign a message to prove ownership · ${network.chainName} testnet`
                : "No injected wallet detected in this browser"}
            </small>
          </span>
          <ArrowUpRight size={16} />
        </button>

        {connectionError.length > 0 && (
          <p className="form-error" role="alert" aria-live="assertive">
            {connectionError}
          </p>
        )}
        {error.length > 0 && (
          <p className="form-error" role="alert" aria-live="assertive">
            {error}
          </p>
        )}

        <p className="modal-foot">
          By continuing you accept the <a href="/legal">terms and risk disclosure</a> and the{" "}
          <a href="/privacy">privacy notice</a>. KYROX stores only your wallet address for this
          session and never asks for personal documents. Test tokens. No real value. Not real
          shares. Not investment advice.
        </p>
      </div>
    </div>
  );
}

export function ConnectButton() {
  const { session, openAuth, signOut, switchNetwork, busy, connectionError, environment, wallet } =
    useAccount();
  const network = resolveWalletNetwork(environment);

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
    <div
      className={`account-chip ${networkMatch ? "has-network" : ""}`}
      style={{ position: "relative" }}
    >
      <span className={`account-dot ${session.demo ? "demo" : "live"}`} />
      <span className="account-address">{shortAddress(session.address)}</span>
      {session.demo && <span className="account-tag">demo</span>}
      {networkMatch &&
        (isWalletNetwork(wallet.chainId, network) ? (
          <span className="account-network ok" title={`${network.chainName} · ${network.chainId}`}>
            {environment?.mode === "local-anvil" ? "Anvil" : "Base"}
          </span>
        ) : (
          <button
            className="account-network warn"
            onClick={() => void switchNetwork()}
            disabled={busy === "network"}
            title={`Wallet on chain ${wallet.chainId}. Switch to ${network.chainName} (${network.chainId}).`}
          >
            {busy === "network" ? "Switching…" : "Switch"}
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
      {connectionError.length > 0 && (
        <span
          className="form-error"
          role="alert"
          aria-live="assertive"
          style={{
            background: "#120b0e",
            border: "1px solid rgba(255, 143, 143, 0.35)",
            borderRadius: 8,
            maxWidth: "min(320px, calc(100vw - 28px))",
            padding: "8px 10px",
            position: "absolute",
            right: 0,
            top: "calc(100% + 8px)",
            width: "max-content",
            zIndex: 120,
          }}
        >
          {connectionError}
        </span>
      )}
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
