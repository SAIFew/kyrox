/** Captures and annotates the deployed KYROX preview for the narrated V2 film. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const rawDir = path.join(here, "raw");
const liveUrl = "https://kyrox-dun.vercel.app";
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let activeCaption = "";
const captionCues = [];
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
const captureStartedAt = Date.now();
page.setDefaultTimeout(25_000);
page.on("pageerror", (error) => console.error("Page error:", error.message));

async function pause(ms) {
  await page.waitForTimeout(ms);
}

async function installOverlay() {
  await page.addStyleTag({
    content: `
      #kyrox-video-cursor { position:fixed; left:0; top:0; z-index:2147483647; width:29px; height:38px; pointer-events:none; transform:translate(-100px,-100px); transition:transform 430ms cubic-bezier(.22,.84,.33,1); filter:drop-shadow(0 2px 3px rgba(0,0,0,.45)); }
      #kyrox-video-cursor svg { display:block; width:100%; height:100%; }
      #kyrox-video-cursor.is-clicking { filter:drop-shadow(0 0 7px rgba(82,217,179,.9)); }
      #kyrox-video-caption { position:fixed; left:50%; bottom:54px; z-index:2147483646; transform:translate(-50%,14px); opacity:0; pointer-events:none; color:#f8fafc; background:rgba(10,16,29,.84); border:1px solid rgba(248,250,252,.15); border-radius:999px; padding:14px 24px; font:700 19px/1.1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; letter-spacing:.015em; box-shadow:0 10px 30px rgba(0,0,0,.28); transition:opacity 340ms ease,transform 340ms ease; }
      #kyrox-video-caption.is-visible { opacity:1; transform:translate(-50%,0); }
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
    document.body.append(caption);
  }, activeCaption);
}

async function ensureOverlay() {
  if ((await page.locator("#kyrox-video-cursor").count()) === 0) await installOverlay();
}

async function setCaption(text) {
  await ensureOverlay();
  await page.evaluate(() => document.getElementById("kyrox-video-caption")?.classList.remove("is-visible"));
  await pause(150);
  activeCaption = text;
  captionCues.push({ text, atMs: Date.now() - captureStartedAt });
  await page.evaluate((next) => {
    const caption = document.getElementById("kyrox-video-caption");
    if (caption !== null) {
      caption.textContent = next;
      caption.classList.add("is-visible");
    }
  }, text);
  await pause(350);
}

async function moveTo(locator) {
  await ensureOverlay();
  await locator.waitFor({ state: "visible" });
  const box = await locator.boundingBox();
  if (box === null) throw new Error("A visible product control has no screen position.");
  const x = Math.round(box.x + Math.min(Math.max(box.width / 2, 12), box.width - 12));
  const y = Math.round(box.y + Math.min(Math.max(box.height / 2, 12), box.height - 12));
  await page.evaluate(({ px, py }) => {
    const cursor = document.getElementById("kyrox-video-cursor");
    if (cursor !== null) cursor.style.transform = `translate(${px}px, ${py}px)`;
  }, { px: x, py: y });
  await pause(450);
  return { x, y };
}

async function click(locator, settle = 700) {
  const { x, y } = await moveTo(locator);
  await page.evaluate(() => document.getElementById("kyrox-video-cursor")?.classList.add("is-clicking"));
  await page.mouse.click(x, y);
  await pause(120);
  await page.evaluate(() => document.getElementById("kyrox-video-cursor")?.classList.remove("is-clicking"));
  await pause(settle);
}

async function navigate(link, pathName, settle = 1_500) {
  await click(link, 100);
  await page.waitForURL((url) => url.pathname === pathName);
  await pause(settle);
}

async function settleMarkets() {
  await page.getByRole("heading", { name: /Reference venues/ }).waitFor({ state: "visible" });
  await page.locator(".market-table tbody tr").first().waitFor({ state: "visible" });
}

async function settleAsset() {
  await page.getByRole("heading", { name: "tAAPL", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("heading", { name: "Reference price" }).waitFor({ state: "visible" });
  await page.locator(".chart-svg").waitFor({ state: "visible" });
}

try {
  await page.goto(liveUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /Access the market/ }).waitFor({ state: "visible" });
  await installOverlay();
  await setCaption("KYROX · A transparent Base product");
  await pause(3_700);

  await navigate(page.getByRole("link", { name: "Markets", exact: true }).first(), "/markets", 1_400);
  await settleMarkets();
  await setCaption("Explore simulated reference markets");
  const search = page.getByRole("textbox", { name: "Search markets" });
  await moveTo(search);
  const searchBox = await search.boundingBox();
  if (searchBox === null) throw new Error("Market search did not render.");
  await page.mouse.click(searchBox.x + 44, searchBox.y + searchBox.height / 2);
  await page.keyboard.type("AAPL", { delay: 130 });
  await pause(3_400);
  await search.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await pause(500);
  await click(page.getByRole("button", { name: "Price", exact: true }), 900);
  await navigate(page.locator('a[href="/markets/tAAPL"]').first(), "/markets/tAAPL", 700);
  await settleAsset();
  await setCaption("Chart, price range, and observation details");
  await click(page.getByRole("button", { name: "1M", exact: true }), 1_200);
  await pause(3_000);

  await click(page.getByRole("button", { name: "Connect", exact: true }), 1_300);
  await page.getByRole("dialog", { name: "Sign in to KYROX" }).waitFor({ state: "visible" });
  await setCaption("Wallet authentication · preview account used");
  await pause(2_000);
  await click(page.getByRole("button", { name: /Continue with preview account/ }), 1_500);
  await page.getByText(/DEMO|demo/i).first().waitFor({ state: "visible" });

  await navigate(page.getByRole("link", { name: "Portfolio", exact: true }).first(), "/portfolio", 1_000);
  await page.getByRole("heading", { name: "Your portfolio" }).waitFor({ state: "visible" });
  await page.getByText("Total value", { exact: true }).waitFor({ state: "visible" });
  await setCaption("Positions and balances · simulated preview values");
  await pause(6_000);

  await navigate(page.getByRole("link", { name: "Markets", exact: true }).first(), "/markets", 800);
  await settleMarkets();
  await navigate(page.locator('a[href="/markets/tAAPL"]').first(), "/markets/tAAPL", 700);
  await settleAsset();
  const amount = page.getByRole("textbox", { name: "Amount in tUSDC" });
  const amountPoint = await moveTo(amount);
  await page.mouse.click(amountPoint.x, amountPoint.y);
  await page.keyboard.type("250", { delay: 130 });
  await pause(700);
  await click(page.getByRole("button", { name: /Review order/ }), 1_900);
  await page.getByText("Minimum received", { exact: true }).waitFor({ state: "visible" });
  await setCaption("Review price, minimum received, and expiry");
  await pause(7_700);
  await click(page.getByRole("button", { name: "Confirm simulated fill", exact: true }), 1_900);
  await page.getByText("Simulated fill recorded", { exact: true }).waitFor({ state: "visible" });
  await pause(2_800);

  await navigate(page.getByRole("link", { name: "Activity", exact: true }).first(), "/activity", 1_000);
  await page.getByRole("heading", { name: "Order history" }).waitFor({ state: "visible" });
  await setCaption("Activity keeps simulated fills clearly labelled");
  await pause(4_800);

  await navigate(page.getByRole("link", { name: "Developers", exact: true }).first(), "/developers", 1_000);
  await page.getByRole("heading", { name: /Agent context without custody/ }).waitFor({ state: "visible" });
  await setCaption("Read-only MCP tools for markets and quote previews");
  const tool = page.getByLabel("Tool");
  await tool.scrollIntoViewIfNeeded();
  await pause(500);
  await moveTo(tool);
  await tool.selectOption("kyrox_preview_quote");
  await pause(500);
  const mcpAmount = page.getByLabel("Amount");
  await moveTo(mcpAmount);
  await mcpAmount.fill("250");
  await click(page.getByRole("button", { name: /Run tool/ }), 1_300);
  await page.locator(".playground-output pre code").waitFor({ state: "visible" });
  await pause(4_300);

  await page.goto(`${liveUrl}/status`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /No ambiguity about what is live/ }).waitFor({ state: "visible" });
  await page.locator(".status-row-main strong").first().waitFor({ state: "visible" });
  await setCaption("What is built · what still needs deployment");
  await pause(12_200);

  await page.goto(liveUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /Access the market/ }).waitFor({ state: "visible" });
  await setCaption("Long-term vision · a carefully prepared Base launch");
  await pause(9_500);
} finally {
  const video = page.video();
  await page.close();
  await context.close();
  await browser.close();
  fs.writeFileSync(path.join(here, "caption-cues.json"), JSON.stringify(captionCues, null, 2));
  if (video !== null) {
    const source = await video.path();
    const destination = path.join(rawDir, `kyrox-v2-live-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`);
    fs.renameSync(source, destination);
    console.log(`RAW_VIDEO=${destination}`);
  }
}
