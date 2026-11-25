import type { Metadata } from "next";
import Link from "next/link";

import { ArrowUpRight, ShieldIcon } from "../../components/icons";

export const metadata: Metadata = {
  title: "Privacy notice",
  description:
    "KYROX privacy notice: wallet address only, optional email when email sign-in exists, and no personal documents.",
};

export default function PrivacyPage() {
  return (
    <div className="page-width legal-layout">
      <header className="page-head">
        <div>
          <p className="eyebrow">Privacy</p>
          <h1>A short privacy notice.</h1>
          <p className="page-lead">
            KYROX is a non-custodial testnet preview. We collect as little as possible and never ask
            for identity documents.
          </p>
        </div>
      </header>

      <section className="panel prose-panel legal-prose">
        <h2>What we collect</h2>
        <ul className="check-list">
          <li>
            Your public wallet address, used to authenticate the session, read balances, and
            attribute your own activity.
          </li>
          <li>
            An optional email address, only if and when an email sign-in option is introduced. It
            would be used solely for that sign-in and essential account notices.
          </li>
          <li>
            Basic operational logs such as timestamps, route names, and error codes. For abuse
            review, a salted, non-reversible hash of the signup network address may be stored; the
            raw address is not kept or shown.
          </li>
        </ul>

        <h2>What we never collect</h2>
        <ul className="check-list">
          <li>Private keys, seed phrases, or wallet credentials.</li>
          <li>Passports, government IDs, utility bills, or other personal documents.</li>
          <li>Real funds, bank details, or payment card data.</li>
        </ul>

        <h2>How it is used</h2>
        <p>
          Wallet addresses and optional emails are used only to operate the preview: proving session
          ownership, serving your portfolio and activity, and preventing abuse. We do not sell
          personal data or use it for advertising.
        </p>

        <h2>Storage and retention</h2>
        <p>
          Demo sessions and their simulated balances live in a signed, HTTP-only browser cookie.
          Live testnet sessions are short-lived and server-verified. Operational logs are retained
          only as long as needed to run and secure the service. An operator can delete a wallet's
          account, events, points, referrals, feedback, indexed trades and claims on request; the
          security audit keeps the deletion action without retaining the wallet as its target.
        </p>

        <h2>Your choices</h2>
        <p>
          You can sign out at any time, clear the demo cookie from your browser, or use the demo
          preview without connecting a wallet. Questions can be raised through the project
          repository or the contact channel listed in the risk terms.
        </p>
      </section>

      <div className="legal-footer">
        <span>
          <ShieldIcon size={15} /> Wallet address · no personal documents · salted abuse hash only
        </span>
        <Link className="text-link" href="/legal">
          Risk &amp; terms <ArrowUpRight size={14} />
        </Link>
      </div>
    </div>
  );
}
