import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineConfig } from "@playwright/test";

const appURL = process.env["APP_URL"] ?? "http://127.0.0.1:3200";
const demoURL = process.env["DEMO_URL"] ?? appURL;
const outputDir =
  process.env["PLAYWRIGHT_OUTPUT_DIR"] ??
  join(tmpdir(), `kyrox-playwright-${process.pid}-${Date.now()}`);

export default defineConfig({
  testDir: "./e2e",
  outputDir,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  workers: 2,
  reporter: "list",
  use: {
    headless: true,
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "demo",
      testMatch: ["consumer.spec.ts", "responsive.spec.ts"],
      use: { baseURL: demoURL },
    },
    {
      name: "local-anvil",
      testMatch: ["wallet.spec.ts"],
      use: { baseURL: appURL },
    },
  ],
});
