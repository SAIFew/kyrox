import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type * as ChartModule from "../components/charts.js";

let charts: typeof ChartModule;
let vite: ViteDevServer;
let cacheDir: string;

beforeAll(async () => {
  cacheDir = mkdtempSync(join(tmpdir(), "kyrox-chart-test-"));
  // The repo Vitest config preserves JSX for Next.js. A tiny isolated Vite
  // server lets this node-only suite render the real client component without
  // jsdom or a source-tree build/cache directory.
  vite = await createServer({
    root: process.cwd(),
    configFile: false,
    cacheDir,
    logLevel: "silent",
    server: { middlewareMode: true },
    appType: "custom",
    esbuild: { jsx: "automatic" },
  });
  charts = (await vite.ssrLoadModule("/apps/web/components/charts.tsx")) as typeof charts;
}, 30_000);

afterAll(async () => {
  await vite?.close();
  if (cacheDir !== undefined) rmSync(cacheDir, { recursive: true, force: true });
});

describe("chart empty and degenerate paths", () => {
  it("does not emit malformed area paths for an empty sparkline", () => {
    const markup = renderToStaticMarkup(createElement(charts.Sparkline, { points: [] }));
    expect(markup).not.toContain("<path");
    expect(markup).not.toContain('d=" L');
  });

  it("does not draw a line or area from a single sparkline point", () => {
    const markup = renderToStaticMarkup(createElement(charts.Sparkline, { points: [230] }));
    expect(markup).not.toContain("<path");
    expect(markup).toContain("<circle");
    expect(markup).not.toContain('d=" L');
  });

  it("draws a finite line for two or more points, including a flat series", () => {
    const markup = renderToStaticMarkup(createElement(charts.Sparkline, { points: [230, 230] }));
    expect(markup).toMatch(/<path d="M0\.00,38\.00 L132\.00,38\.00"/);
    expect(markup).not.toMatch(/NaN|Infinity/);
  });

  it("renders the explicit empty state instead of SVG paths for short price history", () => {
    for (const points of [[], [{ t: 1, p: 230 }]]) {
      const markup = renderToStaticMarkup(createElement(charts.PriceChart, { points }));
      expect(markup).toContain("No price history is available for this market.");
      expect(markup).not.toContain("<svg");
      expect(markup).not.toContain("<path");
    }
  });
});
