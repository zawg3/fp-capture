#!/usr/bin/env node
/** Smoke-test /verify/ — one Continue tap should POST NuData then Sardine to Discord. */
import puppeteer from "puppeteer-core";
import { existsSync } from "fs";
import { createServer } from "http";
import { readFile } from "fs/promises";
import { extname, join } from "path";
import { fileURLToPath } from "url";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "docs");
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
};

function serveDocs() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      let p = decodeURIComponent((req.url || "/").split("?")[0]);
      if (p.endsWith("/")) p += "index.html";
      const file = join(ROOT, p);
      try {
        const body = await readFile(file);
        res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end("not found");
      }
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function main() {
  if (!existsSync(CHROME)) throw new Error("Chrome not found");
  const server = await serveDocs();
  const port = server.address().port;
  const pageUrl = `http://127.0.0.1:${port}/verify/`;
  const discordBodies = [];
  const sardinePosts = [];
  const nudataPosts = [];

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      const method = req.method();
      if (/nudatasecurity\.com/i.test(url) && method === "POST") nudataPosts.push(url);
      if (/sardine\.ai/i.test(url) && method === "POST") sardinePosts.push(url);
      if (/discord\.com\/api\/webhooks/i.test(url) && method === "POST") {
        discordBodies.push(req.postData() || "");
      }
      req.continue();
    });
    await page.goto(pageUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForFunction(() => !document.getElementById("go")?.disabled, { timeout: 45000 });
    await page.mouse.move(180, 220);
    await page.mouse.click(180, 220);
    await page.click("#go");
    await page.waitForFunction(
      () => /Data sent successfully|Sardine did not complete|Something went wrong/i.test(
        document.getElementById("msg")?.textContent || "",
      ),
      { timeout: 60000 },
    );
    const msg = await page.evaluate(() => document.getElementById("msg")?.textContent || "");
    const nudataPing = discordBodies.some((b) => /NuData/i.test(b));
    const sardinePing = discordBodies.some((b) => /Sardine/i.test(b));
    const result = {
      msg,
      discordPosts: discordBodies.length,
      nudataPing,
      sardinePing,
      leakedNudata: nudataPosts.length,
      leakedSardine: sardinePosts.length,
    };
    console.log(JSON.stringify(result, null, 2));
    const ok = /Data sent successfully/i.test(msg) && nudataPing && sardinePing
      && nudataPosts.length === 0 && sardinePosts.length === 0;
    console.log(ok ? "PASS" : "FAIL");
    process.exitCode = ok ? 0 : 1;
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
