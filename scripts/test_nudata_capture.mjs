#!/usr/bin/env node
/** Smoke-test NuData collector — original sync.js, blocked POST, capture via nds-pmd */
import puppeteer from "puppeteer-core";
import { existsSync } from "fs";

const PAGE = process.argv[2] || "https://zawg3.github.io/fp-capture/nudata/";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

async function main() {
  if (!existsSync(CHROME)) throw new Error("Chrome not found");
  const nudataPosts = [];
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (/nudatasecurity\.com/i.test(req.url()) && req.method() === "POST") nudataPosts.push(req.url());
    req.continue();
  });
  await page.goto(PAGE, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById("go")?.disabled, { timeout: 45000 });
  await page.mouse.move(200, 200);
  await page.mouse.click(200, 200);
  await page.click("#go");
  await page.waitForFunction(
    () => /Captured locally|err/i.test(document.getElementById("status")?.textContent || ""),
    { timeout: 20000 },
  );
  const state = await page.evaluate(() => ({
    status: document.getElementById("status")?.textContent,
    wg: window.__nudataLastPlain?.widgetData?.wg,
    pl: window.__nudataLastPlain?.widgetData?.pl,
  }));
  console.log(JSON.stringify({ state, nudataPosts }, null, 2));
  const ok = nudataPosts.length === 0 && state.wg && /Captured locally/i.test(state.status || "");
  console.log(ok ? "PASS" : "FAIL");
  await browser.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
