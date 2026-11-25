import { TESTNET_ASSETS, allocateBasketBudget, fromBaseUnits } from "@kyrox/core";
import { insertUserEvent } from "@kyrox/db";

import { isDemoMode } from "@/lib/demo/mode";
import { demoSnapshot } from "@/lib/demo/market";
import {
  defaultDemoGrowth,
  demoPortfolio,
  readDemoSession,
  writeDemoSession,
} from "@/lib/demo/session";
import { parseAssistantQuestion } from "@/lib/assistant";
import { appDatabase } from "@/lib/server/database";
import { environment, observationStore } from "@/lib/server/store-singleton";
import { getSession } from "@/lib/server/session";
import {
  clientIp,
  error,
  evaluateSameOrigin,
  json,
  rateLimit,
  requestId,
  routeError,
} from "@/lib/server/http";
import { readJsonObject, stringField } from "@/lib/server/request";
import { feedForAsset } from "@kyrox/price";

export const dynamic = "force-dynamic";

function symbolName(symbol: string): string {
  return TESTNET_ASSETS.find((asset) => asset.symbol === symbol)?.name ?? symbol;
}

function formatUsdc(value: bigint): string {
  return fromBaseUnits(value, 6);
}

async function livePrice(symbol: string): Promise<string | null> {
  const env = environment();
  const feedAddress =
    env.mode === "local-anvil"
      ? "0x0000000000000000000000000000000000000000"
      : feedForAsset(symbol).feedAddress;
  const observation = await observationStore().latestValidObservation(symbol, feedAddress);
  if (observation === null || observation.referencePriceUsdcPerWholeToken === null) return null;
  return fromBaseUnits(observation.referencePriceUsdcPerWholeToken, 6);
}

export async function POST(req: Request) {
  const correlationId = requestId();
  try {
    if (!evaluateSameOrigin(req).allowed) {
      return error("Cross-origin request rejected.", 403, "origin", correlationId);
    }
    if (!rateLimit(`assistant:${clientIp(req)}`, 40)) {
      return error("Too many assistant requests.", 429, "rate_limited", correlationId);
    }
    const session = await getSession();
    if (session === null) return error("Sign in to ask KYROX.", 401, "auth", correlationId);
    const body = await readJsonObject(req);
    const question = stringField(body, "question", { maximumLength: 500 }).trim();
    if (question.length < 2) return error("Ask a longer question.", 400, "question", correlationId);

    const intent = parseAssistantQuestion(question);
    let response: Record<string, unknown> & { kind: string; answer: string };

    if (intent.kind === "trade") {
      response = {
        kind: "quote",
        answer: `${intent.side === "buy" ? "Buy" : "Sell"} ${formatUsdc(intent.amountUsdc)} tUSDC of ${symbolName(intent.symbol)}. Review the exact quote before signing; KYROX cannot execute it.`,
        symbol: intent.symbol,
        side: intent.side,
        amountUsdc: intent.amountUsdc.toString(),
        href: `/markets/${intent.symbol}`,
      };
    } else if (intent.kind === "portfolio") {
      if (isDemoMode()) {
        const demo = await readDemoSession();
        if (demo === null) return error("Sign in to ask KYROX.", 401, "auth", correlationId);
        const portfolio = demoPortfolio(demo);
        response = {
          kind: "portfolio",
          answer: `Preview portfolio value is ${portfolio.totalUsdc ?? "unavailable"} tUSDC across ${portfolio.positions.filter((position) => Number(position.amount) > 0).length} test stocks.`,
          totalUsdc: portfolio.totalUsdc,
          href: "/portfolio",
        };
      } else {
        response = {
          kind: "portfolio",
          answer:
            "Your live portfolio is available on the portfolio page. Cost-basis P&L stays unavailable until the durable indexer has reconciled your fills.",
          href: "/portfolio",
        };
      }
    } else if (intent.kind === "basket") {
      const legs = allocateBasketBudget(intent.symbols.slice(0, 3), intent.totalUsdc);
      response = {
        kind: "basket",
        answer: `Proposed ${legs.length}-leg basket for ${formatUsdc(intent.totalUsdc)} tUSDC: ${legs
          .map((leg) => `${leg.symbol} ${formatUsdc(leg.amountInUsdc)}`)
          .join(", ")}. Each leg still needs its own quote and approval.`,
        legs: legs.map((leg) => ({
          symbol: leg.symbol,
          amountUsdc: leg.amountInUsdc.toString(),
        })),
        href: "/basket",
      };
    } else if (intent.kind === "price") {
      if (isDemoMode()) {
        const snapshot = demoSnapshot(intent.symbol, Math.floor(Date.now() / 1_000));
        response = {
          kind: "price",
          answer: `${symbolName(intent.symbol)} is ${snapshot.priceUsdc} tUSDC on the simulated reference feed, updated ${Math.max(0, Math.floor(Date.now() / 1_000) - snapshot.sourceUpdatedAt)}s ago.`,
          symbol: intent.symbol,
          priceUsdc: snapshot.priceUsdc,
          href: `/markets/${intent.symbol}`,
        };
      } else {
        const price = await livePrice(intent.symbol);
        response = {
          kind: "price",
          answer:
            price === null
              ? `${symbolName(intent.symbol)} has no fresh published reference price right now. Trading is disabled until one arrives.`
              : `${symbolName(intent.symbol)} reference price is ${price} tUSDC per test share.`,
          symbol: intent.symbol,
          priceUsdc: price,
          href: `/markets/${intent.symbol}`,
        };
      }
    } else {
      response = {
        kind: "help",
        answer:
          'Try "Buy $100 of Nvidia", "What is Tesla at?", "How is my portfolio?", or "Build me a tech portfolio with $500".',
        href: "/markets",
      };
    }

    if (isDemoMode()) {
      const demo = await readDemoSession();
      if (demo !== null) {
        await writeDemoSession({
          ...demo,
          growth: {
            ...(demo.growth ?? defaultDemoGrowth()),
            questions: (demo.growth?.questions ?? 0) + 1,
          },
        });
      }
    } else {
      await insertUserEvent(appDatabase().db, {
        address: session.address,
        name: "assistant_question",
        props: { kind: response.kind },
      });
    }

    return json({ ...response, mode: isDemoMode() ? "demo" : "live" });
  } catch (err) {
    return routeError(err, "assistant_unavailable", correlationId);
  }
}
