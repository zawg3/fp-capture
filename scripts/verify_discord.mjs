/**
 * Verify full capture + Discord webhook on Sardine page
 */
import puppeteer from "puppeteer-core";
import { existsSync } from "fs";

const PAGE = process.argv[2] || "http://localhost:8765/sardine/";
const BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

function pickBrowser() {
  for (const p of BROWSERS) if (existsSync(p)) return p;
  throw new Error("No Chrome found");
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: pickBrowser(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  const discordPosts = [];
  const sardinePosts = [];

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    const m = req.method();
    if (/discord\.com\/api\/webhooks/i.test(u) && m === "POST") discordPosts.push(u);
    if (/sardine\.ai/i.test(u) && m === "POST") sardinePosts.push(u);
    req.continue();
  });

  await page.goto(PAGE, { waitUntil: "networkidle2", timeout: 60000 });
  await page.click("#go");
  await page.waitForFunction(
    () => /Captured locally|Auto-sent|Discord|err/i.test(document.getElementById("status")?.textContent || ""),
    { timeout: 60000, polling: 500 },
  );

  const state = await page.evaluate(() => ({
    status: document.getElementById("status")?.textContent,
    payloadLen: window.__sardineLastEvents?.payload?.length,
    iframeHasHash: (document.querySelector("iframe")?.src || "").includes("#"),
  }));

  const ok =
    state.payloadLen > 8 &&
    sardinePosts.length === 0 &&
    /Captured locally/i.test(state.status || "") &&
    discordPosts.length >= 1;

  console.log(JSON.stringify({ state, discordPosts: discordPosts.length, sardinePosts, ok }, null, 2));
  console.log(ok ? "\nPASS (full flow)" : "\nFAIL");
  await browser.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
