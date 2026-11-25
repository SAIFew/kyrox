import { expect, test } from "@playwright/test";

import { expectNoHorizontalOverflow, expectNoRuntimeErrors, monitorRuntimeErrors } from "./helpers";

test("preview consumer can browse, quote, simulate a fill, and audit it", async ({ page }) => {
  const errors = monitorRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/markets");

  await expect(
    page.getByRole("heading", { name: "Reference venues, not speculation." }),
  ).toBeVisible();
  await expect(page.locator(".market-table tbody tr")).toHaveCount(7);
  await expect(page.locator('.market-table .market-cell[href="/markets/tAAPL"]')).toContainText(
    "Apple",
  );

  const search = page.getByRole("searchbox", { name: "Search markets" });
  await search.fill("Tesla");
  await expect(page.locator(".market-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".market-table tbody")).toContainText("Tesla");
  await expect(page.locator('.market-table .market-cell[href="/markets/tAAPL"]')).toHaveCount(0);
  await search.fill("");
  await page.getByRole("button", { name: "A–Z", exact: true }).click();
  await expect(page.locator(".market-table tbody tr").first()).toContainText("Apple");

  // The connect dialog is usable without a wallet and dismisses with Escape.
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Sign in to KYROX" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Target network · Base Sepolia \(84532\)/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.locator('.market-table .market-cell[href="/markets/tAAPL"]').click();
  await expect(page.getByRole("heading", { name: "Test Apple", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reference price" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Provenance" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Trade policy" })).toBeVisible();
  await page.getByRole("button", { name: "1M", exact: true }).click();
  await expect(page.getByText("30 days ·", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Continue with preview account/ }).click();
  await Promise.race([
    dialog.waitFor({ state: "hidden", timeout: 5_000 }),
    dialog.locator(".form-error").waitFor({ state: "visible", timeout: 5_000 }),
  ]);
  expect(await dialog.locator(".form-error").allTextContents()).toEqual([]);
  await expect(dialog).toBeHidden();
  await expect(page.locator(".account-tag")).toHaveText("demo");

  await page.getByRole("textbox", { name: "Amount in USDC" }).fill("10");
  const [quoteResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/quotes") && response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Review order" }).click(),
  ]);
  expect(quoteResponse.ok()).toBe(true);
  const quotePayload = (await quoteResponse.json()) as {
    quote?: {
      quoteId?: string;
      ttlSeconds?: number;
      simulated?: boolean;
      simulatedPrice?: boolean;
    };
  };
  expect(quotePayload.quote?.quoteId).toEqual(expect.any(String));
  expect(quotePayload.quote?.ttlSeconds).toBe(120);
  expect(quotePayload.quote?.simulated).toBe(true);
  expect(quotePayload.quote?.simulatedPrice).toBe(true);

  await expect(page.getByText("Review buy", { exact: true })).toBeVisible();
  await expect(page.getByText("Minimum received", { exact: true })).toBeVisible();
  await expect(page.getByText("Daily limit remaining", { exact: true })).toBeVisible();
  await expect(page.getByText(/No transaction is signed or broadcast/)).toBeVisible();

  const [fillResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/trades/execute") && response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Confirm simulated fill" }).click(),
  ]);
  expect(fillResponse.ok()).toBe(true);
  const fillPayload = (await fillResponse.json()) as {
    fill?: { simulated?: boolean; reference?: string };
    portfolio?: { cash?: { amount?: string } };
    activity?: Array<{ status?: string }>;
  };
  expect(fillPayload.fill?.simulated).toBe(true);
  expect(fillPayload.fill?.reference).toMatch(/^sim_/);
  expect(fillPayload.portfolio?.cash?.amount).toEqual(expect.any(String));
  expect(fillPayload.activity?.[0]?.status).toBe("simulated");

  await expect(page.getByRole("heading", { name: "Simulated fill recorded" })).toBeVisible();
  await expect(page.getByText(/Nothing was broadcast to a blockchain/)).toBeVisible();
  await page.getByRole("link", { name: "View portfolio" }).click();

  await expect(page.getByRole("heading", { name: "Your portfolio" })).toBeVisible();
  await expect(page.locator(".portfolio-total strong")).not.toHaveText("—");
  await expect(
    page.locator('.position-table-wrap .market-cell[href="/markets/tAAPL"]'),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole("link", { name: "Full activity" }).click();

  await expect(page.getByRole("heading", { name: "Order history" })).toBeVisible();
  const firstActivity = page.locator(".activity-item").first();
  await expect(firstActivity).toContainText("Simulated buy fill · Test Apple");
  await expect(firstActivity).toContainText("Simulated fill");
  await expect(firstActivity).toContainText("off-chain");
  await expectNoHorizontalOverflow(page);
  expectNoRuntimeErrors(errors);
});
