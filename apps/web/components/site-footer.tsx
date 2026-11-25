"use client";

import Link from "next/link";

import { environmentDisclosure, environmentShortLabel } from "../lib/presentation";
import { useAccount } from "./account-provider";
import { Logo } from "./logo";

export function SiteFooter() {
  const { environment } = useAccount();
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Logo />
          <p>
            Onchain intelligence, transparent quotes, and user-held signing. Built in public on
            Base.
          </p>
          <a href="https://x.com/Kyrox_io" target="_blank" rel="noopener noreferrer">
            @Kyrox_io <span aria-hidden="true">↗</span>
          </a>
        </div>
        <div className="footer-columns">
          <div>
            <h4>Product</h4>
            <Link href="/markets">Markets</Link>
            <Link href="/portfolio">Portfolio</Link>
            <Link href="/basket">Basket</Link>
            <Link href="/rewards">Rewards</Link>
            <Link href="/assistant">Ask KYROX</Link>
            <Link href="/activity">Activity</Link>
            <Link href="/developers">Developers</Link>
          </div>
          <div>
            <h4>Protocol</h4>
            <Link href="/status">System status</Link>
            <Link href="/developers#tools">Agent tools</Link>
            <Link href="/status#architecture">Architecture</Link>
            <Link href="/legal">Risk & terms</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/admin">Operator dashboard</Link>
          </div>
          <div>
            <h4>Community</h4>
            <a href="https://x.com/Kyrox_io" target="_blank" rel="noopener noreferrer">
              X / Twitter
            </a>
            <a href="https://github.com/SAIFew/kyrox" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            <a href="/api/health">Health check</a>
          </div>
        </div>
      </div>
      <div className="footer-legal">
        <p role="status" aria-live="polite">
          <strong>{environmentShortLabel(environment)}.</strong>{" "}
          {environmentDisclosure(environment)} Testnet assets have no real-world or cash value.
          Nothing on this site is investment advice, an offer, or a solicitation.
        </p>
        <span>© {new Date().getFullYear()} KYROX · No real funds</span>
      </div>
    </footer>
  );
}
