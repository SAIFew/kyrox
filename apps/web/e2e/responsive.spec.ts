import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { name: "mobile-320", width: 320, height: 780 },
  { name: "mobile-375", width: 375, height: 812 },
  { name: "mobile-430", width: 430, height: 932 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "laptop-1024", width: 1024, height: 768 },
  { name: "desktop-1440", width: 1440, height: 900 },
];

for (const viewport of VIEWPORTS) {
  test(`no horizontal overflow at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByText("KYROX").first()).toBeVisible();

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    await expect(page.getByRole("heading", { name: "Balances" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Trade" })).toBeVisible();

    // The table is allowed to scroll internally but must not widen the page.
    await expect(page.locator("main")).toBeVisible();
  });
}
