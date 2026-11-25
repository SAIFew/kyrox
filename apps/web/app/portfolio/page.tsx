import type { Metadata } from "next";

import { PortfolioView } from "../../components/portfolio-view";

export const metadata: Metadata = {
  title: "Portfolio",
  description:
    "Inspect testnet balances, allocation, reference-price movement, and explicitly labelled simulated average cost and P&L in KYROX.",
};

export default function PortfolioPage() {
  return <PortfolioView />;
}
