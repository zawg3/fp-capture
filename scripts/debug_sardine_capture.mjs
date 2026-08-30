/**
 * Debug test for fp-capture Sardine collector
 */
import puppeteer from "puppeteer-core";
import { existsSync } from "fs";

const PAGE = process.argv[2] || "https://zawg3.github.io/fp-capture/sardine/";
const BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

function pickBrowser() {
  for (const p of BROWSERS) if (existsSync(p)) return p;
  throw new Error("No Chrome/Edge");
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: pickBrowser(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  const logs = [];
  page.on("console", (m) => logs.push(["console", m.type(), m.text()]));
  page.on("pageerror", (e) => logs.push(["pageerror", e.message]));
  page.on("request", (r) => {
    const u = r.url();
    if (/sardine|live-harbor|sentry|discord|webhook/i.test(u)) {
      logs.push(["req", r.method(), u.slice(0, 120)]);
    }
  });
  page.on("response", async (r) => {
    const u = r.url();
    if (/sardine|live-harbor|sentry/i.test(u)) {
      logs.push(["res", r.status(), u.slice(0, 120)]);
    }
  });

  await page.goto(PAGE, { waitUntil: "networkidle2", timeout: 60000 });
  await page.click("#go");
  await new Promise((r) => setTimeout(r, 35000));

  const state = await page.evaluate(() => ({
    status: document.getElementById("status")?.textContent,
    hasEvents: !!window.__sardineLastEvents,
    payloadLen: window.__sardineLastEvents?.payload?.length,
    iframes: [...document.querySelectorAll("iframe")].map((f) => f.src),
  }));

  console.log("STATE", JSON.stringify(state, null, 2));
  console.log("LOGS\n" + logs.map((l) => l.join(" ")).join("\n"));
  await browser.close();
}

main().catch(console.error);
