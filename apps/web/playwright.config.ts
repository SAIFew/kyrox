import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env["APP_URL"] ?? "http://127.0.0.1:3200",
    headless: true,
    channel: "chrome",
  },
  reporter: "list",
});
