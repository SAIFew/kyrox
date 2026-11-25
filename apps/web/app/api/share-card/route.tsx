import { ImageResponse } from "next/og";
import { referralCodeForAddress } from "@kyrox/core";
import { findUserByAddress } from "@kyrox/db";

import { isDemoMode } from "@/lib/demo/mode";
import { demoPortfolio, readDemoSession } from "@/lib/demo/session";
import { appDatabase } from "@/lib/server/database";
import { getSession } from "@/lib/server/session";
import { error } from "@/lib/server/http";
import { portfolioFor, portfolioPayload } from "@/lib/server/portfolio";
import { environment } from "@/lib/server/store-singleton";
import type { PortfolioPayload } from "@/lib/market-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function baseUrl(): string {
  const configured =
    process.env["APP_ORIGIN"]?.trim() || process.env["NEXT_PUBLIC_APP_URL"]?.trim();
  return (configured && configured.length > 0 ? configured : "https://kyrox.example").replace(
    /\/$/,
    "",
  );
}

async function loadPortfolio(): Promise<{ portfolio: PortfolioPayload; code: string } | null> {
  const session = await getSession();
  if (session === null) return null;
  if (isDemoMode()) {
    const demo = await readDemoSession();
    if (demo === null) return null;
    return { portfolio: demoPortfolio(demo), code: referralCodeForAddress(demo.address) };
  }
  const db = appDatabase().db;
  const user = await findUserByAddress(db, session.address);
  if (user === null) return null;
  const env = environment();
  const portfolio = portfolioPayload(env, await portfolioFor(env, session.address));
  return { portfolio, code: user.referralCode };
}

export async function GET() {
  try {
    const loaded = await loadPortfolio();
    if (loaded === null) return error("Sign in to create a share card.", 401, "auth");
    const { portfolio, code } = loaded;
    const positions = portfolio.positions
      .filter((position) => Number(position.valueUsdc ?? 0) > 0)
      .sort((a, b) => Number(b.valueUsdc ?? 0) - Number(a.valueUsdc ?? 0))
      .slice(0, 3);
    const referral = `${baseUrl()}/?ref=${code}`;

    return new ImageResponse(
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#080b10",
          color: "#f4f7fb",
          padding: "64px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
          <div
            style={{
              width: "54px",
              height: "54px",
              borderRadius: "14px",
              background: "#7cf0c1",
              color: "#06120c",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "30px",
              fontWeight: 800,
            }}
          >
            K
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: "30px", fontWeight: 800 }}>KYROX</span>
            <span style={{ fontSize: "16px", color: "#8ea0b8" }}>Base Sepolia testnet</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <span style={{ fontSize: "20px", color: "#7cf0c1", letterSpacing: "2px" }}>
            MY TEST PORTFOLIO
          </span>
          <span style={{ fontSize: "82px", fontWeight: 800, lineHeight: 1.05 }}>
            {portfolio.totalUsdc ?? "—"} tUSDC
          </span>
          <div style={{ display: "flex", gap: "18px", marginTop: "8px" }}>
            {positions.length === 0 ? (
              <span style={{ fontSize: "24px", color: "#8ea0b8" }}>No open positions yet</span>
            ) : (
              positions.map((position) => (
                <div
                  key={position.symbol}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    background: "#111823",
                    border: "1px solid #223044",
                    borderRadius: "14px",
                    padding: "14px 18px",
                    minWidth: "210px",
                  }}
                >
                  <span style={{ fontSize: "15px", color: "#8ea0b8" }}>{position.symbol}</span>
                  <span style={{ fontSize: "24px", fontWeight: 700 }}>
                    {position.valueUsdc ?? "—"} tUSDC
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <span style={{ fontSize: "17px", color: "#8ea0b8" }}>
              Test tokens. No real value. Not real shares. Not investment advice.
            </span>
            <span style={{ fontSize: "20px", color: "#7cf0c1" }}>{referral}</span>
          </div>
          <span style={{ fontSize: "16px", color: "#8ea0b8" }}>Invite code {code}</span>
        </div>
      </div>,
      {
        width: 1200,
        height: 630,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch {
    return error("Share card is unavailable right now.", 503, "share_unavailable");
  }
}
