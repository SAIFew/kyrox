import type { Metadata } from "next";

import { RewardsView } from "../../components/rewards-view";

export const metadata: Metadata = {
  title: "Quests & rewards",
  description:
    "KYROX testnet quests, points, referral links, and the Trading League leaderboard. Points have no cash value and never convert to tokens.",
};

export default function RewardsPage() {
  return (
    <div className="page-width page-stack">
      <header className="page-head">
        <div>
          <p className="eyebrow">Testnet programme</p>
          <h1>Quests, points, and referrals.</h1>
          <p className="page-lead">
            Points recognise real testnet activity. They have no cash value, are not a token, and
            never imply an airdrop.
          </p>
        </div>
      </header>
      <RewardsView />
    </div>
  );
}
