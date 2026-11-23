import { ImageResponse } from "next/og";

import { DEMO_ASSETS } from "../lib/demo/market";

export const alt = "KYROX — Tokenized equities with proof";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "flex-start",
        background: "linear-gradient(135deg, #06070a 0%, #08110f 58%, #0a1020 100%)",
        color: "#e9edf4",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        justifyContent: "space-between",
        padding: "64px 72px",
        position: "relative",
        width: "100%",
      }}
    >
      <div style={{ alignItems: "center", display: "flex", gap: 16 }}>
        <div
          style={{
            alignItems: "center",
            background: "rgba(124,240,193,0.12)",
            border: "1px solid rgba(124,240,193,0.35)",
            borderRadius: 16,
            color: "#7cf0c1",
            display: "flex",
            fontSize: 30,
            fontWeight: 700,
            height: 58,
            justifyContent: "center",
            width: 58,
          }}
        >
          K
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: 8 }}>KYROX</div>
          <div style={{ color: "#7d8899", fontSize: 13, letterSpacing: 3 }}>
            TOKENIZED EQUITIES · BASE
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ color: "#7cf0c1", fontSize: 17, letterSpacing: 4 }}>
          PUBLIC PREVIEW · SIMULATED VENUE
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 76,
            fontWeight: 600,
            letterSpacing: -3,
            lineHeight: 1.02,
          }}
        >
          <span>Access the market.</span>
          <span style={{ color: "#7cf0c1" }}>Keep the proof.</span>
        </div>
        <div style={{ color: "#94a0b2", fontSize: 22, maxWidth: 820 }}>
          Source-timestamped prices, deterministic quotes, policy-constrained review, and a wallet
          that never leaves your hands.
        </div>
      </div>

      <div style={{ display: "flex", gap: 14 }}>
        {DEMO_ASSETS.map((asset) => (
          <div
            key={asset.symbol}
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 12,
              display: "flex",
              fontSize: 18,
              gap: 10,
              padding: "10px 18px",
            }}
          >
            <span style={{ color: asset.accent }}>{asset.symbol}</span>
            <span style={{ color: "#677386" }}>reference market</span>
          </div>
        ))}
        <div
          style={{
            color: "#677386",
            display: "flex",
            fontSize: 16,
            marginLeft: "auto",
            alignItems: "center",
          }}
        >
          No real funds · not investment advice
        </div>
      </div>
    </div>,
    size,
  );
}
