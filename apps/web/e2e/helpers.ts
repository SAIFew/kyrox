import { expect, type Page } from "@playwright/test";

/** Capture uncaught exceptions and browser console errors before navigation. */
export function monitorRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

export function expectNoRuntimeErrors(errors: readonly string[]): void {
  expect(errors, "browser runtime errors").toEqual([]);
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    dimensions.scrollWidth,
    `page width ${dimensions.scrollWidth}px exceeds viewport ${dimensions.clientWidth}px`,
  ).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

/** The demo journey must work in a clean browser with no injected wallet. */
export async function openPreviewAccount(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "ethereum", { configurable: true, value: undefined });
  });
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Sign in to KYROX" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Target network · Base Sepolia \(84532\)/)).toBeVisible();
  await dialog.getByRole("button", { name: /Continue with preview account/ }).click();
  await Promise.race([
    dialog.waitFor({ state: "hidden", timeout: 5_000 }),
    dialog.locator(".form-error").waitFor({ state: "visible", timeout: 5_000 }),
  ]);
  expect(await dialog.locator(".form-error").allTextContents()).toEqual([]);
  await expect(dialog).toBeHidden();
  await expect(page.locator(".account-tag")).toHaveText("demo");
}
