import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MarketDetailView } from "../../../components/market-detail";
import { demoAsset } from "../../../lib/demo/market";
import { assetDisplayName } from "../../../lib/presentation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ symbol: string }>;
}): Promise<Metadata> {
  const { symbol } = await params;
  const asset = demoAsset(symbol);
  if (asset === null) return { title: "Market not found" };
  const displayName = assetDisplayName(asset.symbol);
  return {
    title: `${displayName} · ${asset.underlying}`,
    description: `${displayName} reference market on the KYROX testnet. Transparent freshness, explicit simulation labels, and policy-constrained quotes.`,
  };
}

export default async function AssetPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  if (demoAsset(symbol) === null) notFound();
  return <MarketDetailView symbol={symbol} />;
}
