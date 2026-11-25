/**
 * Realised P&L from indexed trades, using weighted-average cost per asset.
 *
 * This is deliberately narrow: it counts only closed (sell) results. Unrealised
 * positions are not marked to market because the indexer does not yet store a
 * reconciled current reference price per wallet. The UI states this.
 */

export interface LeagueTrade {
  readonly userAddress: string;
  readonly assetSymbol: string;
  readonly side: "buy" | "sell";
  readonly usdcAmount: bigint;
  readonly stockAmount: bigint;
  readonly blockTime: Date;
}

export function realizedPnlByWallet(
  trades: readonly LeagueTrade[],
  since: Date,
): ReadonlyMap<string, bigint> {
  const ordered = [...trades].sort((a, b) => a.blockTime.getTime() - b.blockTime.getTime());
  const positions = new Map<string, Map<string, { quantity: bigint; cost: bigint }>>();
  const realized = new Map<string, bigint>();

  for (const trade of ordered) {
    const wallet = trade.userAddress.toLowerCase();
    const assets = positions.get(wallet) ?? new Map<string, { quantity: bigint; cost: bigint }>();
    const current = assets.get(trade.assetSymbol) ?? { quantity: 0n, cost: 0n };
    if (trade.side === "buy") {
      current.quantity += trade.stockAmount;
      current.cost += trade.usdcAmount;
    } else {
      const sold = trade.stockAmount > current.quantity ? current.quantity : trade.stockAmount;
      const costSold = current.quantity > 0n ? (current.cost * sold) / current.quantity : 0n;
      current.quantity -= sold;
      current.cost -= costSold;
      if (trade.blockTime.getTime() >= since.getTime()) {
        realized.set(wallet, (realized.get(wallet) ?? 0n) + trade.usdcAmount - costSold);
      }
    }
    assets.set(trade.assetSymbol, current);
    positions.set(wallet, assets);
  }
  return realized;
}
