import { isDemoMode } from "@/lib/demo/mode";
import { DemoQuoteError, executeDemoQuote } from "@/lib/demo/quote";
import { demoActivity, demoPortfolio, readDemoSession, writeDemoSession } from "@/lib/demo/session";
import { getSession } from "@/lib/server/session";
import { clientIp, error, json, rateLimit, sameOrigin } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return error("Cross-origin request rejected.", 403, "origin");
  const session = await getSession();
  if (session === null) return error("Authentication required.", 401, "auth");
  if (!isDemoMode()) {
    return error(
      "On-chain execution is authorised in your wallet, not by this endpoint.",
      400,
      "wallet_required",
    );
  }
  if (!rateLimit(`execute:${clientIp(req)}`, 20))
    return error("Too many simulated executions.", 429, "rate_limited");

  let body: { quoteId?: string; quoteToken?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return error("Malformed JSON body.", 400, "bad_json");
  }
  if (typeof body.quoteId !== "string" || typeof body.quoteToken !== "string") {
    return error("quoteId and quoteToken are required.", 400, "fields");
  }

  const demo = await readDemoSession();
  if (demo === null) return error("Session expired. Start again.", 401, "auth");
  try {
    const result = executeDemoQuote({
      session: demo,
      quoteId: body.quoteId,
      quoteToken: body.quoteToken,
    });
    await writeDemoSession(result.session);
    const activity = demoActivity(result.session);
    const first = activity[0];
    return json({
      fill: first === undefined ? null : { ...first, reference: result.fill.reference },
      portfolio: demoPortfolio(result.session),
      activity,
      simulated: true,
      message: "Simulated fill recorded. No blockchain transaction was created.",
    });
  } catch (err) {
    if (err instanceof DemoQuoteError) return error(err.message, err.status, err.code);
    return error(
      err instanceof Error ? err.message : "Simulated execution failed.",
      400,
      "execute",
    );
  }
}
