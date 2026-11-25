import { assetDisplayName, settlementDisplayName } from "./presentation";

export function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim().length === 0) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatNumber(
  value: string | number | null | undefined,
  options: { min?: number; max?: number } = {},
): string {
  const parsed = toNumber(value);
  if (parsed === null) return "—";
  return parsed.toLocaleString("en-US", {
    minimumFractionDigits: options.min ?? 2,
    maximumFractionDigits: options.max ?? 2,
  });
}

export function formatPrice(value: string | number | null | undefined): string {
  const parsed = toNumber(value);
  if (parsed === null) return "—";
  return parsed.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatTokenAmount(value: string | number | null | undefined, max = 4): string {
  const parsed = toNumber(value);
  if (parsed === null) return "—";
  return parsed.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: max,
  });
}

export function formatCompact(value: string | number | null | undefined): string {
  const parsed = toNumber(value);
  if (parsed === null) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(parsed);
}

export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function pctTone(value: number | null | undefined): "up" | "down" | "flat" {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0)
    return "flat";
  return value > 0 ? "up" : "down";
}

export function pctDirectionLabel(value: number | null | undefined): string {
  const tone = pctTone(value);
  if (tone === "flat") {
    return value === 0 ? "unchanged" : "unavailable";
  }
  return tone;
}

export function formatDurationSeconds(value: number | null | undefined): string | null {
  const seconds = toNumber(value);
  if (seconds === null || seconds <= 0) return null;
  return `${seconds.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${
    seconds === 1 ? "second" : "seconds"
  }`;
}

export function shortAddress(address: string | null | undefined): string {
  if (address === null || address === undefined || address.length < 10) return "—";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function timeAgo(secondsOrIso: number | string | null | undefined): string {
  if (secondsOrIso === null || secondsOrIso === undefined) return "—";
  const timestamp =
    typeof secondsOrIso === "number"
      ? secondsOrIso * (secondsOrIso > 10_000_000_000 ? 1 : 1_000)
      : Date.parse(secondsOrIso);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "—";
  const diff = Math.max(0, Date.now() - timestamp);
  const seconds = Math.floor(diff / 1_000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export function formatDate(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso.trim().length === 0) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(seconds: number | null | undefined): string {
  const timestamp = toNumber(seconds);
  if (timestamp === null || timestamp <= 0) return "—";
  return new Date(timestamp * 1_000).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatUtc(seconds: number | null | undefined): string {
  const timestamp = toNumber(seconds);
  if (timestamp === null || timestamp <= 0) return "—";
  const date = new Date(timestamp * 1_000);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

export function rangeLabel(range: string): string {
  switch (range) {
    case "1D":
      return "24 hours";
    case "1W":
      return "7 days";
    case "1M":
      return "30 days";
    case "3M":
      return "90 days";
    default:
      return range;
  }
}

export function activityAmountLabel(item: {
  side: "buy" | "sell";
  amountIn: string;
  amountOut: string | null | undefined;
  symbol: string;
}): string {
  const decimalsIn = item.side === "buy" ? 6 : 18;
  const decimalsOut = item.side === "buy" ? 18 : 6;
  const rawInput = toNumber(item.amountIn);
  const rawOutput = toNumber(item.amountOut);
  const input = rawInput === null ? null : rawInput / 10 ** decimalsIn;
  const output = rawOutput === null ? null : rawOutput / 10 ** decimalsOut;
  if (input === null) return "Amount unavailable";
  if (output === null)
    return `${formatTokenAmount(input, 4)} ${item.side === "buy" ? settlementDisplayName() : assetDisplayName(item.symbol)}`;
  return item.side === "buy"
    ? `${formatTokenAmount(input, 2)} ${settlementDisplayName()} → ${formatTokenAmount(output, 4)} ${assetDisplayName(item.symbol)}`
    : `${formatTokenAmount(input, 4)} ${assetDisplayName(item.symbol)} → ${formatTokenAmount(output, 2)} ${settlementDisplayName()}`;
}
