import type { Metadata } from "next";
import Link from "next/link";

import { TESTNET_ASSETS } from "@kyrox/core";

import { ArrowUpRight } from "../components/icons";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  const assetNames = TESTNET_ASSETS.map((asset) => asset.name).join(", ");
  return (
    <div className="page-width not-found">
      <p className="eyebrow">404</p>
      <h1>That market is not listed.</h1>
      <p className="page-lead">
        The page you requested does not exist. KYROX currently lists {assetNames}.
      </p>
      <div className="hero-ctas">
        <Link className="button button-primary" href="/markets">
          Browse markets <ArrowUpRight size={15} />
        </Link>
        <Link className="button button-ghost" href="/">
          Back home
        </Link>
      </div>
    </div>
  );
}
