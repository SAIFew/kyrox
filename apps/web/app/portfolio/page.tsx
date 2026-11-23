import type { Metadata } from "next";

import { PortfolioView } from "../../components/portfolio-view";

export const metadata: Metadata = {
  title: "Portfolio",
  description:
    "Inspect balances, allocation, and simulated 24h movement in the KYROX public preview.",
};

export default function PortfolioPage() {
  return <PortfolioView />;
}
