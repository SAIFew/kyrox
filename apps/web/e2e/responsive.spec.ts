import { expect, test } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  expectNoRuntimeErrors,
  monitorRuntimeErrors,
  openPreviewAccount,
} from "./helpers";

const VIEWPORTS = [
  { name: "mobile-320", width: 320, height: 780 },
  { name: "mobile-375", width: 375, height: 812 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-430", width: 430, height: 932 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "laptop-1024", width: 1024, height: 768 },
  { name: "desktop-1440", width: 1440, height: 900 },
];

for (const viewport of VIEWPORTS) {
  test(`consumer routes have no horizontal overflow at ${viewport.name}`, async ({ page }) => {
    const errors = monitorRuntimeErrors(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /Access the market/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Explore markets/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Sign in to KYROX" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Sign in to KYROX" })).toBeHidden();

    await openPreviewAccount(page);

    const routes = [
      { path: "/markets", heading: "Reference venues, not speculation." },
      { path: "/markets/tAAPL", heading: "Test Apple" },
      { path: "/portfolio", heading: "Your portfolio" },
      { path: "/activity", heading: "Order history" },
    ] as const;

    for (const route of routes) {
      await page.goto(route.path);
      await expect(page.getByRole("heading", { name: route.heading, exact: true })).toBeVisible();
      await expect(page.locator("main")).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }

    expectNoRuntimeErrors(errors);
  });
}
