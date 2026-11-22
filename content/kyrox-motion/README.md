# KYROX — Inside One MCP Tool Call

A 22-second Remotion explainer showing the repository's local `get_stock_info("tAAPL")` execution path. The project is a standalone workspace under `content/kyrox-motion/` alongside `services/mcp-server/`; it does not modify the Python backend.

## Verified flow represented

1. The AI client invokes `get_stock_info` with the exact ticker `tAAPL`.
2. `@mcp.tool()` exposes the function through FastMCP.
3. `server.py` trims the input, calls `find_stock(normalized_ticker)`, and returns the matching dictionary.
4. `find_stock` calls `load_stocks()`, then compares stored and input tickers after `strip().lower()`.
5. `load_stocks` reads UTF-8 JSON from `data/stocks.json`, parses a list, and validates each record with `_validate_stock_record`.
6. The `tAAPL` record is returned unchanged; FastMCP serializes the result for the client.

The sample response uses `ticker`, `stock`, `reference_value`, and `token_address` as stored. The value `230.0` is explicitly local demo data, never a live market price.

## Run the browser preview

Requires Node.js 20+ and npm.

```powershell
npm install
npm run dev
```

Remotion Studio opens in a browser. Select **KyroxInsideOneToolCall** to preview or scrub the animation.

## Render the final H.264 MP4

```powershell
npm run render
```

Output: `out/kyrox-inside-one-mcp-tool-call.mp4` (1920×1080, 30 fps, 660 frames / 22 seconds, H.264).

For a single still preview:

```powershell
npm run still
```

## Contents

- `src/KyroxMotion.tsx` — Remotion composition and timeline.
- `src/styles.css` — developer-interface styling; uses local system font fallbacks, no generated imagery or remote assets.
- `src/Root.tsx` — 1920×1080, 30 fps, 22-second composition registration.
- `remotion.config.ts` — PNG frame format and overwrite setting.

The developer windows are a motion-graphics representation of the verified source, not a live application capture.
