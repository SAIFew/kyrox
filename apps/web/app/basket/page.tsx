import type { Metadata } from "next";

import { BasketBuilder } from "../../components/basket-builder";

export const metadata: Metadata = {
  title: "Basket builder",
  description:
    "Build a portfolio of up to four test stocks with one review. Each leg is constrained by the same policy and freshness checks.",
};

export default function BasketPage() {
  return (
    <div className="page-width page-stack">
      <header className="page-head">
        <div>
          <p className="eyebrow">Portfolio request</p>
          <h1>Build a basket.</h1>
          <p className="page-lead">
            Choose up to four test stocks and one budget. Quotes are independent, expire in 30
            seconds, and never bypass per-trade or daily limits.
          </p>
        </div>
      </header>
      <BasketBuilder />
    </div>
  );
}
