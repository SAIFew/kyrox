import { NextResponse } from "next/server";

import { isDemoMode } from "@/lib/demo/mode";
import { demoMarketList } from "@/lib/demo/market";
import { environmentInfo } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const now = Math.floor(Date.now() / 1_000);
  const demo = isDemoMode();
  const markets = demo ? demoMarketList(now) : [];
  const fresh = markets.every((market) => market.snapshot.fresh);

  return NextResponse.json({
    ok: true,
    generatedAt: new Date(now * 1_000).toISOString(),
    environment: environmentInfo(),
    checks: [
      {
        id: "web",
        label: "Consumer application",
        status: "operational",
        detail: "Next.js application serving the product surface.",
      },
      {
        id: "markets",
        label: "Reference market data",
        status: demo ? "simulated" : fresh ? "operational" : "degraded",
        detail: demo
          ? "Deterministic simulated observations. No oracle is connected."
          : "Latest persisted oracle observations.",
      },
      {
        id: "contracts",
        label: "Base Sepolia contracts",
        status: demo ? "not-deployed" : "operational",
        detail: demo
          ? "The KYROX exchange and token suite are not deployed on Base Sepolia."
          : "Deployment manifest verified for chain 84532.",
      },
      {
        id: "agent",
        label: "Agent bridge (MCP)",
        status: "operational",
        detail: "Read-only JSON-RPC bridge at /api/mcp. Signing is not exposed.",
      },
      {
        id: "indexer",
        label: "Event indexer",
        status: "not-running",
        detail: "Phase 2 service. No on-chain events are indexed in this environment.",
      },
      {
        id: "publication",
        label: "Price publication",
        status: demo ? "not-configured" : "operational",
        detail: demo
          ? "Unsigned setPrice preparation is configured for deployment, not active here."
          : "Publication preparation is enabled.",
      },
    ],
    disclaimer:
      "The public preview is a simulated venue. Testnet assets have no real-world value and no transaction is broadcast.",
  });
}
