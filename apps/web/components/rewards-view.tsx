"use client";

import { useCallback, useEffect, useState } from "react";

import { useAccount } from "./account-provider";
import { ArrowUpRight, SparkIcon } from "./icons";

interface QuestProgress {
  quest: { id: string; title: string; description: string; points: number };
  completed: number;
  target: number;
  earnedPoints: number;
  complete: boolean;
}

interface LeaderboardEntry {
  address: string;
  points: number;
  trades: number;
  rank: number;
  isSelf?: boolean;
  realizedPnlUsdc?: string;
}

interface RewardsPayload {
  mode: "demo" | "live";
  points: number;
  quests: QuestProgress[];
  referralCode: string;
  referralUrl: string;
  leaderboard: LeaderboardEntry[];
  weeklyLeaderboard?: LeaderboardEntry[];
  leagueWeekStart?: string;
  leaderboardNote: string;
  disclosure: string;
  activity: {
    hasClaimedUsdc: boolean;
    tradeCount: number;
    distinctTradeDays: number;
    distinctAssetsHeld: number;
    questionsAsked: number;
    qualifiedReferrals: number;
    hasFeedback: boolean;
  };
}

const TOPICS = ["bug", "ux", "trading", "documentation", "other"] as const;

export function RewardsView() {
  const { session, openAuth, ready } = useAccount();
  const [data, setData] = useState<RewardsPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedbackTopic, setFeedbackTopic] = useState<(typeof TOPICS)[number]>("ux");
  const [feedback, setFeedback] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/rewards");
      if (response.status === 401) {
        setData(null);
        return;
      }
      const payload = (await response.json()) as RewardsPayload & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Rewards are unavailable.");
      setData(payload);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rewards are unavailable.");
    }
  }, []);

  useEffect(() => {
    if (ready && session !== null) void load();
  }, [ready, session, load]);

  if (!ready) return <p className="muted">Loading account…</p>;
  if (session === null) {
    return (
      <div className="panel">
        <h2>Sign in to view quests</h2>
        <p className="muted">
          Quests and points are tied to your wallet. No email, document, or personal profile is
          required.
        </p>
        <button className="button button-primary" onClick={openAuth}>
          Sign in <ArrowUpRight size={15} />
        </button>
      </div>
    );
  }

  const submitFeedback = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: feedbackTopic, message: feedback }),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Feedback could not be sent.");
      setFeedback("");
      setNotice("Feedback recorded. Thank you.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Feedback could not be sent.");
    } finally {
      setBusy(false);
    }
  };

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

      <div className="stat-row">
        <div className="stat-tile">
          <span>Points</span>
          <strong>{data?.points ?? "—"}</strong>
        </div>
        <div className="stat-tile">
          <span>Trades</span>
          <strong>{data?.activity.tradeCount ?? "—"}</strong>
        </div>
        <div className="stat-tile">
          <span>Active days</span>
          <strong>{data?.activity.distinctTradeDays ?? "—"}</strong>
        </div>
        <div className="stat-tile">
          <span>Referrals</span>
          <strong>{data?.activity.qualifiedReferrals ?? "—"}</strong>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Quests</h2>
            <p className="muted small">Each quest is awarded once, from recorded activity.</p>
          </div>
          <span className="sim-badge">
            <SparkIcon size={13} /> No cash value
          </span>
        </div>
        <div className="status-table">
          {(data?.quests ?? []).map((item) => (
            <div className="status-row" key={item.quest.id}>
              <div className="status-row-main">
                <strong>{item.quest.title}</strong>
                <span>{item.quest.description}</span>
              </div>
              <span className="muted small">
                {item.quest.id === "invite_friend"
                  ? `${item.completed}/${item.target}`
                  : item.complete
                    ? "Complete"
                    : "Open"}
              </span>
              <span className="status-pill ok">+{item.quest.points}</span>
            </div>
          ))}
        </div>
        <p className="muted small">{data?.disclosure}</p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Invite a trader</h2>
            <p className="muted small">
              A referral qualifies after the invited wallet claims test USDC and completes its first
              indexed trade. Max 10 qualifying referrals.
            </p>
          </div>
        </div>
        <label className="field">
          <span className="field-label">
            <span>Your referral link</span>
            <span className="muted small">Code {data?.referralCode ?? "—"}</span>
          </span>
          <div className="amount-input">
            <input readOnly value={data?.referralUrl ?? ""} aria-label="Referral link" />
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={() => {
                if (data === null) return;
                void navigator.clipboard.writeText(data.referralUrl);
                setNotice("Referral link copied.");
              }}
            >
              Copy
            </button>
          </div>
        </label>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Trading League · this week</h2>
            <p className="muted small">
              Weekly league starting Monday 00:00 UTC
              {data?.leagueWeekStart === undefined
                ? ""
                : ` · ${new Date(data.leagueWeekStart).toISOString().slice(0, 10)}`}
              . Minimum three indexed trades. Ranked by realised P&L on closed trades; unrealised
              positions are not marked to market.
            </p>
          </div>
        </div>
        {data === null || (data.weeklyLeaderboard ?? []).length === 0 ? (
          <p className="muted">No ranked traders this week yet.</p>
        ) : (
          <div className="status-table">
            {(data.weeklyLeaderboard ?? []).map((entry) => (
              <div className="status-row" key={entry.address}>
                <span className="status-pill ok">#{entry.rank}</span>
                <div className="status-row-main">
                  <strong className="mono">
                    {entry.address.slice(0, 6)}…{entry.address.slice(-4)}
                    {entry.isSelf === true ? " (you)" : ""}
                  </strong>
                  <span>
                    {entry.trades} indexed trades this week · {entry.points} pts
                  </span>
                </div>
                <strong>{entry.realizedPnlUsdc ?? "0"} tUSDC</strong>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>All-time leaderboard</h2>
            <p className="muted small">{data?.leaderboardNote}</p>
          </div>
        </div>
        {data === null || data.leaderboard.length === 0 ? (
          <p className="muted">
            No ranked traders yet. A wallet needs at least three indexed trades; flagged wallets are
            excluded until reviewed.
          </p>
        ) : (
          <div className="status-table">
            {data.leaderboard.map((entry) => (
              <div className="status-row" key={entry.address}>
                <span className="status-pill ok">#{entry.rank}</span>
                <div className="status-row-main">
                  <strong className="mono">
                    {entry.address.slice(0, 6)}…{entry.address.slice(-4)}
                    {entry.isSelf === true ? " (you)" : ""}
                  </strong>
                  <span>{entry.trades} indexed trades</span>
                </div>
                <strong>{entry.points} pts</strong>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Send feedback</h2>
            <p className="muted small">
              Feedback is stored separately from chat. Do not include private keys or personal
              documents.
            </p>
          </div>
        </div>
        <label className="field">
          <span className="field-label">
            <span>Topic</span>
          </span>
          <select
            value={feedbackTopic}
            onChange={(event) => setFeedbackTopic(event.target.value as (typeof TOPICS)[number])}
          >
            {TOPICS.map((topic) => (
              <option key={topic} value={topic}>
                {topic}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">
            <span>Feedback</span>
            <span className="muted small">{feedback.length}/2000</span>
          </span>
          <textarea
            rows={4}
            maxLength={2_000}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="What was confusing or broken?"
          />
        </label>
        <button
          className="button button-primary"
          type="button"
          disabled={busy || feedback.trim().length < 10}
          onClick={() => void submitFeedback()}
        >
          {busy ? "Sending…" : "Send feedback"}
        </button>
      </section>
    </div>
  );
}
