import { environment } from "@/lib/server/store-singleton";
import { authStore } from "@/lib/server/store-singleton";
import { error, sessionFromCookies, json } from "@/lib/server/http";
import { quoteSimulationFlags } from "@/lib/server/labels";
import { quoteById } from "@/lib/server/quotes";
import { fromBaseUnits } from "@kyrox/core";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await sessionFromCookies(authStore());
  if (session === null) return error("Authentication required.", 401, "auth");
  const env = environment();
  const { id } = await params;
  const record = await quoteById(env, id);
  if (record === null) return error("Quote not found.", 404, "not_found");
  if (record.trader.toLowerCase() !== session.address.toLowerCase())
    return error("Quote belongs to another wallet.", 403, "forbidden");
  return json({
    ...record.quote,
    quoteId: record.id,
    amountIn: record.quote.amountIn.toString(),
    amountOut: record.quote.amountOut.toString(),
    minAmountOut: record.quote.minAmountOut.toString(),
    priceUsdcPerWholeToken: fromBaseUnits(record.quote.priceUsdcPerWholeToken, 6),
    ...quoteSimulationFlags(env.mode, record.observation),
  });
}
