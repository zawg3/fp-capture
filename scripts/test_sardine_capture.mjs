/**
 * Headless test: fp-capture Sardine collector page
 * Usage: node scripts/test_sardine_capture.mjs [pageUrl]
 */
import puppeteer from "puppeteer-core";
import { existsSync } from "fs";

const PAGE = process.argv[2] || "https://zawg3.github.io/fp-capture/sardine/";
const BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

function pickBrowser() {
  for (const p of BROWSERS) if (existsSync(p)) return p;
  throw new Error("No Chrome/Edge found");
}

const sardinePosts = [];
const discordPosts = [];

async function main() {
  const browser = await puppeteer.launch({
    executablePath: pickBrowser(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage();
    page.on("console", (msg) => {
      const t = msg.text();
      if (/sardine|capture|error|warn/i.test(t)) console.log("[console]", t);
    });
    page.on("pageerror", (err) => console.log("[pageerror]", err.message));

    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      const method = req.method();
      if (/sardine\.ai/i.test(url) && method === "POST") {
        sardinePosts.push(url);
        console.log("[BLOCK-ATTEMPT?]", method, url);
      }
      if (/discord\.com\/api\/webhooks/i.test(url) && method === "POST") {
        discordPosts.push(url);
        console.log("[discord POST]", url.slice(0, 80) + "…");
      }
      req.continue();
    });

    page.on("response", (res) => {
      const url = res.url();
      if (/sardine\.ai\/v1\/events/i.test(url)) {
        console.log("[sardine RESPONSE]", res.status(), url);
      }
    });

    console.log("goto", PAGE);
    await page.goto(PAGE, { waitUntil: "networkidle2", timeout: 60000 });

    await page.click("#go");
    console.log("clicked Run — waiting up to 45s…");

    const result = await page.waitForFunction(
      () => {
        const st = document.getElementById("status")?.textContent || "";
        if (/Captured locally|Auto-sent|Copied|err/i.test(st)) return { done: true, status: st };
        if (window.__sardineLastEvents?.payload?.length > 5) {
          return { done: true, status: "capture-object", fields: window.__sardineLastEvents.payload.length };
        }
        return false;
      },
      { timeout: 45000, polling: 500 },
    ).catch(() => null);

    const evalState = await page.evaluate(() => ({
      statusHtml: document.getElementById("status")?.innerHTML || "",
      hasLastEvents: !!window.__sardineLastEvents,
      payloadLen: window.__sardineLastEvents?.payload?.length || 0,
      hasSardine: !!window._Sardine,
      actionsVisible: !document.getElementById("actions")?.hidden,
      outVisible: !document.getElementById("out")?.hidden,
      capturedFlag: window.__sardineCaptured,
    }));

    console.log("\n=== RESULT ===");
    console.log(JSON.stringify({ result: result?._remoteObject?.value || result, evalState, sardinePosts, discordPosts }, null, 2));

    const ok =
      sardinePosts.length === 0 &&
      evalState.payloadLen > 8 &&
      (evalState.actionsVisible || evalState.hasLastEvents);

    console.log(ok ? "\nPASS" : "\nFAIL");
    process.exit(ok ? 0 : 1);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
