/**
 * Captures the public KYROX preview through a real Chromium render.
 *
 * It intentionally uses the product's Preview account rather than a real wallet:
 * the deployed site labels this environment as simulated and no blockchain
 * transaction is signed or broadcast. The only post-recording overlay here is
 * a visible cursor; captions and music are added by render-kyrox-demo.sh.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const rawDir = path.join(here, "raw");
const liveUrl = "https://kyrox-dun.vercel.app";
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let activeCaption = "";

fs.mkdirSync(rawDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
  args: ["--hide-scrollbars", "--force-color-profile=srgb"],
});

const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
  recordVideo: { dir: rawDir, size: { width: 1920, height: 1080 } },
});

const page = await context.newPage();
page.setDefaultTimeout(25_000);
page.on("pageerror", (error) => console.error("Page error:", error.message));

async function pause(ms) {
  await page.waitForTimeout(ms);
}

async function installCursor() {
  await page.addStyleTag({
    content: `
      #kyrox-video-cursor {
        position: fixed; left: 0; top: 0; z-index: 2147483647;
        width: 29px; height: 38px; pointer-events: none;
        transform: translate(-100px, -100px); transition: transform 430ms cubic-bezier(.22, .84, .33, 1);
        filter: drop-shadow(0 2px 3px rgba(0,0,0,.45));
      }
      #kyrox-video-cursor svg { display: block; width: 100%; height: 100%; }
      #kyrox-video-cursor.is-clicking { filter: drop-shadow(0 0 7px rgba(82, 217, 179, .9)); }
      #kyrox-video-caption {
        position: fixed; left: 50%; bottom: 54px; z-index: 2147483646;
        transform: translate(-50%, 14px); opacity: 0; pointer-events: none;
        color: #f8fafc; background: rgba(10, 16, 29, .82);
        border: 1px solid rgba(248, 250, 252, .15); border-radius: 999px;
        padding: 14px 24px; font: 700 19px/1.1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: .015em; box-shadow: 0 10px 30px rgba(0, 0, 0, .28);
        transition: opacity 340ms ease, transform 340ms ease;
      }
      #kyrox-video-caption.is-visible { opacity: 1; transform: translate(-50%, 0); }
    `,
  });
  await page.evaluate((captionText) => {
    const cursor = document.createElement("div");
    cursor.id = "kyrox-video-cursor";
    cursor.setAttribute("aria-hidden", "true");
    cursor.innerHTML = `<svg viewBox="0 0 30 40" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 2.5 25.2 21l-9.4 1.6 5.2 10.2-6.2 3.1-5.1-10.3-6.5 7.6L4 2.5Z" fill="white" stroke="#111827" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
    document.body.append(cursor);
    const caption = document.createElement("div");
    caption.id = "kyrox-video-caption";
    caption.setAttribute("aria-hidden", "true");
    caption.textContent = captionText;
    if (captionText.length > 0) caption.classList.add("is-visible");
    document.body.append(caption);
  }, activeCaption);
}

async function ensureCursor() {
  if ((await page.locator("#kyrox-video-cursor").count()) === 0) await installCursor();
}

async function setCaption(text) {
  const changed = activeCaption !== text;
  activeCaption = text;
  await ensureCursor();
  if (changed) {
    await page.evaluate(() => document.getElementById("kyrox-video-caption")?.classList.remove("is-visible"));
    await pause(150);
  }
  await page.evaluate((next) => {
    const caption = document.getElementById("kyrox-video-caption");
    if (caption !== null) {
      caption.textContent = next;
      caption.classList.add("is-visible");
    }
  }, text);
  await pause(changed ? 350 : 0);
}

async function pointAt(locator) {
  await ensureCursor();
  await locator.waitFor({ state: "visible" });
  const box = await locator.boundingBox();
  if (box === null) throw new Error("Could not position the recording cursor.");
  const x = Math.round(box.x + Math.min(Math.max(box.width * 0.5, 12), box.width - 12));
  const y = Math.round(box.y + Math.min(Math.max(box.height * 0.5, 12), box.height - 12));
  await page.evaluate(
    ({ x: nextX, y: nextY }) => {
      const cursor = document.getElementById("kyrox-video-cursor");
      if (cursor !== null) cursor.style.transform = `translate(${nextX}px, ${nextY}px)`;
    },
    { x, y },
  );
  await pause(500);
  return { x, y };
}

async function click(locator, settle = 750) {
  const point = await pointAt(locator);
  await page.evaluate(() => document.getElementById("kyrox-video-cursor")?.classList.add("is-clicking"));
  await page.mouse.click(point.x, point.y);
  await pause(130);
  await page.evaluate(() => document.getElementById("kyrox-video-cursor")?.classList.remove("is-clicking"));
  await pause(settle);
}

async function navigate(link, expectedPath, settle = 1_500) {
  await click(link, 100);
  await page.waitForURL((url) => url.pathname === expectedPath);
  await ensureCursor();
  await pause(settle);
}

try {
  // Landing: give the real client render and market feed room to settle.
  await page.goto(liveUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /Access the market/ }).waitFor({ state: "visible" });
  await installCursor();
  await setCaption("Introducing KYROX");
  await pause(4_200);

  // Markets: exercise real search and sorting before opening tAAPL.
  await navigate(page.getByRole("link", { name: "Markets", exact: true }).first(), "/markets");
  await setCaption("Explore tokenized assets");
  const search = page.getByRole("textbox", { name: "Search markets" });
  await pointAt(search);
  await page.mouse.click((await search.boundingBox()).x + 40, (await search.boundingBox()).y + 18);
  await page.keyboard.type("AAPL", { delay: 145 });
  await pause(1_700);
  await search.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await pause(650);
  await click(page.getByRole("button", { name: "Price", exact: true }), 1_500);
  await setCaption("Detailed asset insights");
  await navigate(page.getByRole("link", { name: /tAAPL Apple Inc\./ }).first(), "/markets/tAAPL", 2_100);

  // Asset detail: switch the real interactive price range.
  await click(page.getByRole("button", { name: "1M", exact: true }), 1_850);
  await pause(1_450);

  // Show the genuine non-custodial sign-in modal, then intentionally take the
  // preview route so the recording never suggests that an on-chain trade occurred.
  await setCaption("Secure, non-custodial access");
  await click(page.getByRole("button", { name: "Connect", exact: true }), 3_300);
  await click(page.getByRole("button", { name: /Continue with preview account/ }), 2_800);

  // Portfolio in the authenticated public-preview session.
  await setCaption("Your portfolio, in one place");
  await navigate(page.getByRole("link", { name: "Portfolio", exact: true }).first(), "/portfolio", 3_000);

  // Trading: request a quote, show the exact review data, then record a simulated fill.
  await navigate(page.getByRole("link", { name: "Markets", exact: true }).first(), "/markets", 1_600);
  await setCaption("Review. Understand. Execute.");
  await navigate(page.getByRole("link", { name: /tAAPL Apple Inc\./ }).first(), "/markets/tAAPL", 1_900);
  const amount = page.getByRole("textbox", { name: "Amount in tUSDC" });
  await pointAt(amount);
  await page.mouse.click((await amount.boundingBox()).x + 55, (await amount.boundingBox()).y + 22);
  await page.keyboard.type("250", { delay: 170 });
  await pause(900);
  await click(page.getByRole("button", { name: /Review order/ }), 2_750);
  await pause(2_400);
  await click(page.getByRole("button", { name: "Confirm simulated fill", exact: true }), 3_400);

  // Activity proves the fill was recorded locally and visibly labelled as a preview flow.
  await setCaption("Track every activity");
  await navigate(page.getByRole("link", { name: "Activity", exact: true }).first(), "/activity", 3_000);

  // Developer differentiator: invoke the read-only MCP bridge from the real playground.
  await setCaption("Built for AI-agent integration");
  await navigate(page.getByRole("link", { name: "Developers", exact: true }).first(), "/developers", 1_900);
  const tool = page.getByLabel("Tool");
  await tool.scrollIntoViewIfNeeded();
  await pause(900);
  await pointAt(tool);
  await tool.selectOption("kyrox_preview_quote");
  await pause(700);
  const mcpAmount = page.getByLabel("Amount");
  await pointAt(mcpAmount);
  await mcpAmount.fill("250");
  await pause(600);
  await click(page.getByRole("button", { name: /Run tool/ }), 3_600);

  // Close on the real product home, keeping the live-preview disclosure visible.
  await setCaption("KYROX  |  Public preview - simulated trading");
  await navigate(page.getByRole("link", { name: "KYROX home" }).first(), "/", 1_800);
  await pause(4_200);
} finally {
  const video = page.video();
  await page.close();
  await context.close();
  await browser.close();
  if (video !== null) {
    const source = await video.path();
    const destination = path.join(rawDir, `kyrox-live-demo-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`);
    fs.renameSync(source, destination);
    console.log(`RAW_VIDEO=${destination}`);
  }
}

