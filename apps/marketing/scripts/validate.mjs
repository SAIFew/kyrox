// Static marketing-site validation. Run against a static server for `out/`.
// Usage: node apps/marketing/scripts/validate.mjs [baseUrl]
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://127.0.0.1:4173";
const SHOTS = "/Users/saif/Documents/Windows Migration/Projects/kyrox-app-backups/marketing-shots";
const WIDTHS = [320, 375, 430, 768, 1024, 1440];
mkdirSync(SHOTS, { recursive: true });

const failures = [];
const results = [];
const check = (ok, label, detail = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` :: ${detail}` : ""}`);
  if (!ok) failures.push(`${label}${detail ? ` :: ${detail}` : ""}`);
};

const browser = await chromium.launch();
const errors = { console: [], page: [], requests: [] };

for (const width of WIDTHS) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.console.push(`${width}: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.page.push(`${width}: ${err.message}`));
  page.on("requestfailed", (req) => errors.requests.push(`${width}: ${req.url()}`));
  const requests = [];
  page.on("request", (req) => requests.push(req.url()));

  const response = await page.goto(base, { waitUntil: "networkidle" });
  check(response?.status() === 200, `HTTP 200 at ${width}px`, String(response?.status()));

  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.getAttribute("content"),
    ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute("content"),
    ogDescription: document
      .querySelector('meta[property="og:description"]')
      ?.getAttribute("content"),
    twitter: document.querySelector('meta[name="twitter:card"]')?.getAttribute("content"),
    viewport: document.querySelector('meta[name="viewport"]')?.getAttribute("content"),
    themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
    icon: document.querySelector('link[rel="icon"]')?.getAttribute("href"),
    h1: document.querySelectorAll("h1").length,
    header: document.querySelectorAll("header").length,
    main: document.querySelectorAll("main").length,
    footer: document.querySelectorAll("footer").length,
    navs: [...document.querySelectorAll("nav[aria-label]")].map((n) =>
      n.getAttribute("aria-label"),
    ),
    sections: [...document.querySelectorAll("section[aria-labelledby]")].map((s) => ({
      id: s.getAttribute("aria-labelledby"),
      found: document.getElementById(s.getAttribute("aria-labelledby") ?? "") !== null,
    })),
    unnamedButtons: [...document.querySelectorAll("button")].filter(
      (b) => !(b.getAttribute("aria-label") || b.textContent?.trim()),
    ).length,
    anchors: [...document.querySelectorAll('a[href^="#"]')].map((a) => ({
      href: a.getAttribute("href"),
      exists: document.querySelector(a.getAttribute("href") ?? "") !== null,
    })),
    external: [
      ...new Set(
        [...document.querySelectorAll('a[target="_blank"]')].map((a) => a.getAttribute("href")),
      ),
    ],
    emptyLinks: [...document.querySelectorAll("a")].filter((a) => !a.getAttribute("href")).length,
  }));

  check(
    metrics.scrollWidth <= metrics.innerWidth,
    `No horizontal overflow at ${width}px`,
    `${metrics.scrollWidth}/${metrics.innerWidth}`,
  );
  check(metrics.h1 === 1, `Exactly one h1 at ${width}px`, String(metrics.h1));
  check(
    metrics.header === 1 && metrics.main === 1 && metrics.footer === 1,
    `Landmarks at ${width}px`,
  );
  check(
    metrics.anchors.every((a) => a.exists),
    `All in-page anchors resolve at ${width}px`,
    JSON.stringify(metrics.anchors.filter((a) => !a.exists)),
  );
  check(
    metrics.sections.every((s) => s.found),
    `Section labels resolve at ${width}px`,
  );
  check(metrics.unnamedButtons === 0, `Buttons have accessible names at ${width}px`);
  check(metrics.emptyLinks === 0, `No empty links at ${width}px`);
  check(
    metrics.external.every((href) => href === "https://x.com/Kyrox_io"),
    `Only the known X profile is linked externally at ${width}px`,
    JSON.stringify(metrics.external),
  );
  check(!requests.some((u) => u.includes("/api/")), `No API requests at ${width}px`);
  check(
    requests.every((u) => new URL(u).origin === new URL(base).origin),
    `No third-party requests at ${width}px`,
    JSON.stringify(requests.filter((u) => new URL(u).origin !== new URL(base).origin)),
  );

  await page.screenshot({ path: `${SHOTS}/hero-${width}.png` });
  await page.screenshot({ path: `${SHOTS}/page-${width}.png`, fullPage: true });
  if (width === 1440) {
    check(metrics.title.includes("KYROX"), "Document title", metrics.title);
    check((metrics.description?.length ?? 0) > 80, "Meta description present");
    check(metrics.ogTitle?.includes("KYROX") === true, "OpenGraph title");
    check((metrics.ogDescription?.length ?? 0) > 80, "OpenGraph description");
    check(metrics.twitter === "summary", "Twitter card", String(metrics.twitter));
    check((metrics.viewport ?? "").includes("width=device-width"), "Viewport meta");
    check(metrics.themeColor === "#06070a", "Theme color", String(metrics.themeColor));
    check(
      (metrics.icon ?? "").includes("icon.svg"),
      "Favicon points at KYROX icon",
      String(metrics.icon),
    );
    await page.screenshot({ path: `${SHOTS}/hero-1440.png` });
    await page.locator("#how-it-works").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/how-it-works-1440.png` });
    await page.locator("#security").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/security-1440.png` });
    await page.locator("#status").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/status-1440.png` });
  }
  await context.close();
}

// Mobile navigation behaviour.
{
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "networkidle" });
  const toggle = page.locator(".menu-toggle");
  check(await toggle.isVisible(), "Mobile menu button visible at 375px");
  check(!(await page.locator("#mobile-menu").isVisible()), "Mobile menu starts closed");
  await toggle.click();
  check(await page.locator("#mobile-menu").isVisible(), "Mobile menu opens");
  check((await toggle.getAttribute("aria-expanded")) === "true", "aria-expanded true when open");
  await page.screenshot({ path: `${SHOTS}/mobile-menu-375.png` });
  await page.locator('#mobile-menu a[href="#security"]').click();
  check(!(await page.locator("#mobile-menu").isVisible()), "Mobile menu closes after navigation");
  check(page.url().endsWith("#security"), "Mobile navigation moves to section", page.url());
  await toggle.click();
  await page.keyboard.press("Escape");
  check(!(await page.locator("#mobile-menu").isVisible()), "Escape closes the mobile menu");
  await context.close();
}

// Keyboard navigation and reduced motion.
{
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "networkidle" });
  const animation = await page.evaluate(() => {
    const el = document.querySelector(".hero-copy h1");
    return el === null ? null : getComputedStyle(el).animationName;
  });
  check(animation === "none", "Reduced motion disables keyframe animation", String(animation));
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => document.activeElement?.textContent?.trim());
  check(focused === "Skip to content", "First tab stop is the skip link", String(focused));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  const activeId = await page.evaluate(() => document.activeElement?.id);
  check(activeId === "main", "Skip link moves focus to main content", String(activeId));
  const outline = await page.evaluate(() => {
    const el = document.activeElement;
    return el === null ? "" : getComputedStyle(el).outlineStyle;
  });
  check(outline !== "none", "Visible focus outline", outline);
  await context.close();
}

// Metadata files.
const robots = await fetch(`${base}/robots.txt`);
check(robots.status === 200, "robots.txt served", String(robots.status));
check(/user-agent:\s*\*/i.test(await robots.text()), "robots.txt content");
const icon = await fetch(`${base}/icon.svg`);
check(icon.status === 200, "Favicon served", String(icon.status));

check(errors.console.length === 0, "No console errors", JSON.stringify(errors.console));
check(errors.page.length === 0, "No uncaught page errors", JSON.stringify(errors.page));
check(errors.requests.length === 0, "No failed requests", JSON.stringify(errors.requests));

await browser.close();

// Contrast ratios for the principal text pairs.
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
for (const [name, fg, bg] of [
  ["body text", "#e9edf4", "#06070a"],
  ["muted text", "#9aa6b8", "#06070a"],
  ["dim text", "#7d8899", "#06070a"],
  ["accent on background", "#7cf0c1", "#06070a"],
  ["button ink on accent", "#05231a", "#7cf0c1"],
]) {
  const value = ratio(fg, bg);
  check(value >= 4.5, `WCAG AA contrast for ${name}`, `${value.toFixed(2)}:1`);
}

const report = results.join("\n");
console.log(report);
writeFileSync(`${SHOTS}/validation-results.txt`, `${report}\n`);
console.log(`\nScreenshots: ${SHOTS}`);
if (failures.length > 0) {
  console.error(`\n${failures.length} FAILURES:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
