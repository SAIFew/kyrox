import { toBaseUnits } from "@kyrox/core";

const ALIASES: Readonly<Record<string, string>> = {
  apple: "tAAPL",
  nvidia: "tNVDA",
  microsoft: "tMSFT",
  google: "tGOOGL",
  alphabet: "tGOOGL",
  amazon: "tAMZN",
  tesla: "tTSLA",
  meta: "tMETA",
  facebook: "tMETA",
};

const SYMBOLS = ["tAAPL", "tNVDA", "tMSFT", "tGOOGL", "tAMZN", "tTSLA", "tMETA"] as const;

export type AssistantIntent =
  | { kind: "trade"; side: "buy" | "sell"; symbol: string; amountUsdc: bigint }
  | { kind: "price"; symbol: string }
  | { kind: "portfolio" }
  | { kind: "basket"; symbols: readonly string[]; totalUsdc: bigint }
  | { kind: "help" };

export function resolveAssistantSymbol(text: string): string | null {
  const lower = text.toLowerCase();
  for (const symbol of SYMBOLS) {
    if (lower.includes(symbol.toLowerCase())) return symbol;
  }
  for (const [alias, symbol] of Object.entries(ALIASES)) {
    if (lower.includes(alias)) return symbol;
  }
  return null;
}

function amount(text: string): bigint | null {
  const match = text.match(/\$?([0-9]+(?:\.[0-9]{1,6})?)/);
  if (match?.[1] === undefined) return null;
  try {
    return toBaseUnits(match[1], 6);
  } catch {
    return null;
  }
}

/**
 * Small, deterministic grammar for the preview assistant. It is deliberately
 * narrow: an unknown sentence returns help rather than guessing at a trade.
 */
export function parseAssistantQuestion(question: string): AssistantIntent {
  const lower = question.toLowerCase();
  const symbol = resolveAssistantSymbol(question);
  const value = amount(question);
  const trade = lower.match(/(buy|sell)\s+\$?([0-9]+(?:\.[0-9]{1,6})?)/);

  if (trade !== null && symbol !== null) {
    const parsed = amount(trade[2] ?? "");
    if (parsed !== null) {
      return {
        kind: "trade",
        side: trade[1] === "sell" ? "sell" : "buy",
        symbol,
        amountUsdc: parsed,
      };
    }
  }

  if (/portfolio|what do i own|holdings/.test(lower) && !/build|basket|allocate/.test(lower)) {
    return { kind: "portfolio" };
  }

  if (/basket|build|allocate|tech portfolio|ai portfolio/.test(lower) && value !== null) {
    const symbols = /ai|tech|nvidia|microsoft|google|apple/.test(lower)
      ? ["tNVDA", "tMSFT", "tGOOGL", "tAAPL"]
      : ["tAAPL", "tNVDA", "tMSFT"];
    return { kind: "basket", symbols, totalUsdc: value };
  }

  if (symbol !== null) return { kind: "price", symbol };
  return { kind: "help" };
}
