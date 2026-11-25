import type { Metadata } from "next";
import { adminRoles, userEvents } from "@kyrox/db";
import { desc } from "drizzle-orm";
import Link from "next/link";
import { fromBaseUnits } from "@kyrox/core";

import { AdminFeedbackActions } from "../../components/admin-feedback-actions";
import { AdminPolicyForm } from "../../components/admin-policy-form";
import { AdminRoleManager } from "../../components/admin-role-manager";
import { AdminUserActions } from "../../components/admin-user-actions";
import { AdminError, getAdminContext, roleCan, type AdminContext } from "../../lib/server/admin";
import {
  analyticsCounts,
  getAdminOverview,
  getAdminUserDetail,
  listAdminAudit,
  listAdminClaims,
  listAdminErrors,
  listAdminFeedback,
  listAdminTrades,
  listAdminUsers,
  listSybilSignals,
} from "../../lib/server/admin-data";
import { readEffectivePolicy } from "../../lib/server/policy-store";

export const metadata: Metadata = {
  title: "Admin",
  description: "KYROX operator dashboard: users, trades, claims, growth, policy, and audit log.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const TABS = [
  ["overview", "Overview"],
  ["live", "Live feed"],
  ["users", "Users"],
  ["trades", "Trades"],
  ["claims", "Claims"],
  ["analytics", "Analytics"],
  ["feedback", "Feedback"],
  ["settings", "Settings"],
  ["audit", "Audit log"],
] as const;

type Tab = (typeof TABS)[number][0];

function param(
  searchParams: Record<string, string | string[] | undefined>,
  key: string,
): string | null {
  const value = searchParams[key];
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (Array.isArray(value) && value[0] !== undefined) return value[0];
  return null;
}

function short(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function usdc(value: string): string {
  try {
    return fromBaseUnits(BigInt(value), 6);
  } catch {
    return "—";
  }
}

function Money({ value }: { value: string }) {
  return <span className="mono">{usdc(value)}</span>;
}

function AdminUnavailable({ error }: { error: unknown }) {
  const message =
    error instanceof AdminError
      ? error.message
      : "Admin tools are not available. Check the deployment configuration.";
  return (
    <div className="page-width page-stack">
      <header className="page-head">
        <div>
          <p className="eyebrow">Operator</p>
          <h1>Admin access</h1>
          <p className="page-lead">{message}</p>
        </div>
      </header>
      <div className="panel">
        <h2>How access works</h2>
        <p className="muted">
          Admin access requires a live PostgreSQL deployment, a signed wallet session, and a wallet
          present in the <code>admin_roles</code> table. Preview mode intentionally has no admin
          identity and cannot grant itself one.
        </p>
        <p className="muted">
          Bootstrap the first owner with <code>pnpm admin:grant</code>, then add other roles from
          Settings. Every privileged change is written to the audit log.
        </p>
        <Link className="button button-ghost" href="/">
          Back to app
        </Link>
      </div>
    </div>
  );
}

async function OverviewTab({ context }: { context: AdminContext }) {
  const [overview, sybil] = await Promise.all([
    getAdminOverview(context.db),
    listSybilSignals(context.db),
  ]);
  return (
    <div className="page-stack">
      <div className="stat-row">
        <div className="stat-tile">
          <span>Registered</span>
          <strong>{overview.registered}</strong>
        </div>
        <div className="stat-tile">
          <span>Traders</span>
          <strong>{overview.traders}</strong>
        </div>
        <div className="stat-tile">
          <span>Returning</span>
          <strong>{overview.returningTraders}</strong>
        </div>
        <div className="stat-tile">
          <span>Volume</span>
          <strong>
            <Money value={overview.volumeUsdc} /> tUSDC
          </strong>
        </div>
        <div className="stat-tile">
          <span>Trades</span>
          <strong>{overview.trades}</strong>
        </div>
        <div className="stat-tile">
          <span>Claims</span>
          <strong>{overview.claims}</strong>
        </div>
        <div className="stat-tile">
          <span>Refusals</span>
          <strong>{overview.refusals}</strong>
        </div>
        <div className="stat-tile">
          <span>Flagged</span>
          <strong>{overview.flagged}</strong>
        </div>
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>Top test stocks</h2>
        </div>
        {overview.topStocks.length === 0 ? (
          <p className="muted">No indexed trades yet.</p>
        ) : (
          <div className="status-table">
            {overview.topStocks.map((stock) => (
              <div className="status-row" key={stock.symbol}>
                <div className="status-row-main">
                  <strong>{stock.symbol}</strong>
                  <span>{stock.trades} indexed trades</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Sybil review</h2>
            <p className="muted small">
              Automatic suggestions only. Review before flagging; flagged wallets keep access but
              leave public ranks.
            </p>
          </div>
        </div>
        {sybil.length === 0 ? (
          <p className="muted">No suspicious patterns detected.</p>
        ) : (
          <div className="status-table">
            {sybil.slice(0, 20).map((signal) => (
              <div className="status-row" key={signal.address}>
                <div className="status-row-main">
                  <strong className="mono">
                    <Link
                      href={{
                        pathname: "/admin",
                        query: { tab: "users", address: signal.address },
                      }}
                    >
                      {short(signal.address)}
                    </Link>
                  </strong>
                  <span>{signal.reasons.join(" · ")}</span>
                </div>
                <span className="status-pill warn">{signal.reasons.length}</span>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Funnel</h2>
        </div>
        <div className="status-table">
          <div className="status-row">
            <div className="status-row-main">
              <strong>Registered</strong>
              <span>Wallets with a signed-in account</span>
            </div>
            <strong>{overview.registered}</strong>
          </div>
          <div className="status-row">
            <div className="status-row-main">
              <strong>Claimed tUSDC</strong>
              <span>Indexed welcome or daily claim</span>
            </div>
            <strong>{overview.claims}</strong>
          </div>
          <div className="status-row">
            <div className="status-row-main">
              <strong>First trade</strong>
              <span>At least one indexed trade</span>
            </div>
            <strong>{overview.traders}</strong>
          </div>
          <div className="status-row">
            <div className="status-row-main">
              <strong>Returning trader</strong>
              <span>Trades on two or more UTC days</span>
            </div>
            <strong>{overview.returningTraders}</strong>
          </div>
        </div>
      </section>
    </div>
  );
}

async function LiveTab({ context }: { context: AdminContext }) {
  const [events, trades] = await Promise.all([
    context.db.select().from(userEvents).orderBy(desc(userEvents.createdAt)).limit(40),
    listAdminTrades(context.db, 20),
  ]);
  const feed = [
    ...events.map((event) => ({
      id: `event-${event.id}`,
      at: event.createdAt,
      label: event.name,
      detail: event.address === null ? "" : short(event.address),
    })),
    ...trades.map((trade) => ({
      id: `trade-${trade.txHash}-${trade.logIndex}`,
      at: trade.blockTime,
      label: `${trade.side} ${trade.assetSymbol}`,
      detail: `${short(trade.userAddress)} · ${usdc(trade.usdcAmount)} tUSDC`,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 50);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Live feed</h2>
          <p className="muted small">
            Recent product events and indexed trades. Full chat text is never stored.
          </p>
        </div>
      </div>
      {feed.length === 0 ? (
        <p className="muted">No activity yet.</p>
      ) : (
        <div className="status-table">
          {feed.map((item) => (
            <div className="status-row" key={item.id}>
              <div className="status-row-main">
                <strong>{item.label}</strong>
                <span>
                  {item.at.toISOString()} {item.detail.length > 0 ? `· ${item.detail}` : ""}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

async function UsersTab({ context, address }: { context: AdminContext; address: string | null }) {
  if (address !== null) {
    const detail = await getAdminUserDetail(context.db, address);
    if (detail === null) return <p className="muted">User not found.</p>;
    return (
      <div className="page-stack">
        <Link className="text-link" href={{ pathname: "/admin", query: { tab: "users" } }}>
          ← All users
        </Link>
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2 className="mono">{detail.user.address}</h2>
              <p className="muted small">
                Joined {detail.user.createdAt.toISOString()} · code {detail.user.referralCode} ·
                source {detail.user.signupSource ?? "unknown"} ·{" "}
                {roleCan(context.role, "view_emails")
                  ? (detail.user.email ?? "no email")
                  : "email hidden for this role"}
              </p>
            </div>
            <span className="status-pill ok">{detail.user.status}</span>
          </div>
          <p className="muted">
            Referred by {detail.user.referredBy ?? "nobody"} · {detail.trades.length} trades ·{" "}
            {detail.claims.length} claims ·{" "}
            {detail.points.reduce((total, row) => total + row.points, 0)} points
          </p>
        </section>
        <div className="detail-grid">
          <section className="panel">
            <div className="panel-head">
              <h2>Timeline</h2>
            </div>
            <div className="status-table">
              {detail.events.length === 0 ? (
                <p className="muted">No product events recorded.</p>
              ) : (
                detail.events.map((event) => (
                  <div className="status-row" key={event.id}>
                    <div className="status-row-main">
                      <strong>{event.name}</strong>
                      <span>{event.createdAt.toISOString()}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
          {roleCan(context.role, "manage_flags") && (
            <AdminUserActions
              address={detail.user.address}
              status={detail.user.status}
              notes={detail.user.notes}
              canDelete={roleCan(context.role, "manage_admins")}
            />
          )}
        </div>
        <section className="panel">
          <div className="panel-head">
            <h2>Trades</h2>
          </div>
          {detail.trades.length === 0 ? (
            <p className="muted">No indexed trades.</p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Asset</th>
                  <th>Side</th>
                  <th>tUSDC</th>
                  <th>Shares</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {detail.trades.map((trade) => (
                  <tr key={`${trade.txHash}-${trade.logIndex}`}>
                    <td>{trade.blockTime.toISOString()}</td>
                    <td>{trade.assetSymbol}</td>
                    <td>{trade.side}</td>
                    <td>
                      <Money value={trade.usdcAmount} />
                    </td>
                    <td className="mono">{trade.stockAmount}</td>
                    <td className="mono">{short(trade.txHash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    );
  }

  const users = await listAdminUsers(context.db);
  return (
    <div className="page-stack">
      <form className="admin-search" action="/admin" method="get">
        <input type="hidden" name="tab" value="users" />
        <input name="q" placeholder="Search wallet or referral code" />
        <select name="status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="flagged">Flagged</option>
          <option value="banned">Banned</option>
        </select>
        <button className="button button-ghost button-small" type="submit">
          Filter
        </button>
      </form>
      <section className="panel">
        <div className="panel-head">
          <h2>Users</h2>
          {roleCan(context.role, "export_csv") || roleCan(context.role, "export_without_emails") ? (
            <a className="text-link" href="/api/admin/export?type=users">
              Export CSV
            </a>
          ) : null}
        </div>
        {users.length === 0 ? (
          <p className="muted">No users match this filter.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Wallet</th>
                <th>Source</th>
                <th>Trades</th>
                <th>Points</th>
                <th>Status</th>
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <Link
                      className="text-link mono"
                      href={{ pathname: "/admin", query: { tab: "users", address: user.address } }}
                    >
                      {short(user.address)}
                    </Link>
                  </td>
                  <td>{user.signupSource ?? "—"}</td>
                  <td>{user.trades}</td>
                  <td>{user.points}</td>
                  <td>
                    <span className={`status-pill ${user.status === "active" ? "ok" : "danger"}`}>
                      {user.status}
                    </span>
                  </td>
                  <td>{user.lastActiveAt.toISOString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

async function TradesTab({ context }: { context: AdminContext }) {
  const trades = await listAdminTrades(context.db);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Trades</h2>
        <a className="text-link" href="/api/admin/export?type=trades">
          Export CSV
        </a>
      </div>
      {trades.length === 0 ? (
        <p className="muted">No indexed trades yet. Run the indexer after deployment.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Wallet</th>
              <th>Asset</th>
              <th>Side</th>
              <th>tUSDC</th>
              <th>Price</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => (
              <tr key={`${trade.txHash}-${trade.logIndex}`}>
                <td>{trade.blockTime.toISOString()}</td>
                <td className="mono">{short(trade.userAddress)}</td>
                <td>{trade.assetSymbol}</td>
                <td>{trade.side}</td>
                <td>
                  <Money value={trade.usdcAmount} />
                </td>
                <td className="mono">{usdc(trade.priceUsdcPerWholeToken)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

async function ClaimsTab({ context }: { context: AdminContext }) {
  const claims = await listAdminClaims(context.db);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Faucet claims</h2>
      </div>
      {claims.length === 0 ? (
        <p className="muted">No indexed claims yet.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Wallet</th>
              <th>Kind</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {claims.map((claim) => (
              <tr key={`${claim.txHash}-${claim.logIndex}`}>
                <td>{claim.blockTime.toISOString()}</td>
                <td className="mono">{short(claim.userAddress)}</td>
                <td>{claim.kind}</td>
                <td>
                  <Money value={claim.amount} /> tUSDC
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

async function AnalyticsTab({ context }: { context: AdminContext }) {
  const since = new Date(Date.now() - 7 * 24 * 3_600_000);
  const [events, errors] = await Promise.all([
    analyticsCounts(context.db, since),
    listAdminErrors(context.db),
  ]);
  return (
    <div className="detail-grid">
      <section className="panel">
        <div className="panel-head">
          <h2>Events · last 7 days</h2>
        </div>
        {events.length === 0 ? (
          <p className="muted">No product events recorded.</p>
        ) : (
          <div className="status-table">
            {events.map((event) => (
              <div className="status-row" key={event.name}>
                <div className="status-row-main">
                  <strong>{event.name}</strong>
                </div>
                <strong>{event.count}</strong>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Warnings & errors</h2>
        </div>
        {errors.length === 0 ? (
          <p className="muted">No warnings or errors recorded.</p>
        ) : (
          <div className="status-table">
            {errors.map((event) => (
              <div className="status-row" key={event.id}>
                <div className="status-row-main">
                  <strong>{event.event}</strong>
                  <span>{event.message}</span>
                </div>
                <span className={`status-pill ${event.level === "error" ? "danger" : "warn"}`}>
                  {event.level}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

async function FeedbackTab({ context }: { context: AdminContext }) {
  if (!roleCan(context.role, "manage_feedback")) {
    return <p className="muted">Your role cannot read feedback.</p>;
  }
  const feedback = await listAdminFeedback(context.db);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Feedback</h2>
      </div>
      {feedback.length === 0 ? (
        <p className="muted">No feedback yet.</p>
      ) : (
        <div className="status-table">
          {feedback.map((entry) => (
            <div className="status-row" key={entry.id}>
              <div className="status-row-main">
                <strong>
                  [{entry.topic}] {entry.message}
                </strong>
                <span>
                  {entry.address === null ? "anonymous" : short(entry.address)} ·{" "}
                  {entry.createdAt.toISOString()}
                </span>
              </div>
              <AdminFeedbackActions id={entry.id} status={entry.status} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

async function SettingsTab({ context }: { context: AdminContext }) {
  if (!roleCan(context.role, "manage_policy") && !roleCan(context.role, "manage_admins")) {
    return <p className="muted">Your role cannot open Settings.</p>;
  }
  const [policy, roles] = await Promise.all([
    readEffectivePolicy(context.db),
    roleCan(context.role, "manage_admins")
      ? context.db.select().from(adminRoles)
      : Promise.resolve([]),
  ]);
  return (
    <div className="page-stack">
      {roleCan(context.role, "manage_policy") ? (
        <AdminPolicyForm
          initial={{
            minTradeUsdc: policy.minTradeUsdc.toString(),
            maxTradeUsdc: policy.maxTradeUsdc.toString(),
            dailyLimitUsdc: policy.dailyLimitUsdc.toString(),
            allowedAssets: [...policy.allowedAssets],
            tradingEnabled: policy.tradingEnabled,
          }}
        />
      ) : (
        <p className="muted">Your role cannot change policy.</p>
      )}
      {roleCan(context.role, "manage_admins") ? (
        <AdminRoleManager
          initial={roles.map((row) => ({
            wallet: row.wallet,
            role: row.role,
            addedBy: row.addedBy,
            createdAt: row.createdAt,
          }))}
        />
      ) : null}
      <section className="panel">
        <div className="panel-head">
          <h2>Faucet amounts</h2>
        </div>
        <div className="status-table">
          <div className="status-row">
            <div className="status-row-main">
              <strong>Welcome grant</strong>
              <span>Once per wallet</span>
            </div>
            <strong>1,000 tUSDC</strong>
          </div>
          <div className="status-row">
            <div className="status-row-main">
              <strong>Daily claim</strong>
              <span>Per rolling 24 hours</span>
            </div>
            <strong>100 tUSDC</strong>
          </div>
        </div>
        <p className="muted small">
          Faucet amounts are contract constants. Changing them requires a reviewed contract change
          and redeployment, not a dashboard edit.
        </p>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Exports</h2>
        </div>
        <p className="muted">
          CSV exports never include wallet private data. Emails are included only for roles allowed
          to view them.
        </p>
        <div className="page-head-actions">
          <a className="button button-ghost button-small" href="/api/admin/export?type=users">
            Users CSV
          </a>
          <a className="button button-ghost button-small" href="/api/admin/export?type=trades">
            Trades CSV
          </a>
        </div>
      </section>
    </div>
  );
}

async function AuditTab({ context }: { context: AdminContext }) {
  const rows = await listAdminAudit(context.db);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Audit log</h2>
      </div>
      {rows.length === 0 ? (
        <p className="muted">No privileged actions recorded.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Admin</th>
              <th>Action</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.createdAt.toISOString()}</td>
                <td className="mono">{short(row.adminWallet)}</td>
                <td>{row.action}</td>
                <td className="mono">{row.target ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tab = (param(params, "tab") ?? "overview") as Tab;
  const address = param(params, "address");

  let context: AdminContext;
  try {
    context = await getAdminContext();
  } catch (error) {
    return <AdminUnavailable error={error} />;
  }

  const visibleTabs = TABS.filter(([id]) => {
    if (id === "settings") {
      return roleCan(context.role, "manage_policy") || roleCan(context.role, "manage_admins");
    }
    if (id === "audit") return roleCan(context.role, "view_audit");
    if (id === "feedback") return roleCan(context.role, "manage_feedback");
    return true;
  });
  const activeTab = visibleTabs.some(([id]) => id === tab) ? tab : "overview";

  return (
    <div className="page-width page-stack">
      <header className="page-head">
        <div>
          <p className="eyebrow">Operator · {context.role}</p>
          <h1>Admin dashboard</h1>
          <p className="page-lead">
            Read-only views and privileged actions are both checked server-side on every request.
          </p>
        </div>
        <div className="page-head-actions">
          <Link className="button button-ghost button-small" href="/">
            Back to app
          </Link>
        </div>
      </header>

      <nav className="admin-tabs" aria-label="Admin sections">
        {visibleTabs.map(([id, label]) => (
          <Link
            key={id}
            href={{ pathname: "/admin", query: { tab: id } }}
            className={activeTab === id ? "is-active" : ""}
            aria-current={activeTab === id ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>

      {activeTab === "overview" && <OverviewTab context={context} />}
      {activeTab === "live" && <LiveTab context={context} />}
      {activeTab === "users" && <UsersTab context={context} address={address} />}
      {activeTab === "trades" && <TradesTab context={context} />}
      {activeTab === "claims" && <ClaimsTab context={context} />}
      {activeTab === "analytics" && <AnalyticsTab context={context} />}
      {activeTab === "feedback" && <FeedbackTab context={context} />}
      {activeTab === "settings" && <SettingsTab context={context} />}
      {activeTab === "audit" &&
        (roleCan(context.role, "view_audit") ? (
          <AuditTab context={context} />
        ) : (
          <p className="muted">Your role cannot read the audit log.</p>
        ))}
    </div>
  );
}
