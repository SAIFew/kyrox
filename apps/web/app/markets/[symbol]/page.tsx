import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MarketDetailView } from "../../../components/market-detail";
import { demoAsset } from "../../../lib/demo/market";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ symbol: string }>;
}): Promise<Metadata> {
  const { symbol } = await params;
  const asset = demoAsset(symbol);
  if (asset === null) return { title: "Market not found" };
  return {
    title: `${asset.symbol} · ${asset.name}`,
    description: `${asset.symbol} reference market on KYROX. Simulated price, transparent freshness, and policy-constrained quotes.`,
  };
}

export default async function AssetPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  if (demoAsset(symbol) === null) notFound();
  return <MarketDetailView symbol={symbol} />;
}
