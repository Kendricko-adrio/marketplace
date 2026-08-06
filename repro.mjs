import { chromium } from "playwright-core";

const EXEC =
  "C:/Users/USER/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true, executablePath: EXEC });
const ctx = await browser.newContext();
const page = await ctx.newPage();

const apiCalls = [];
page.on("request", (req) => {
  if (req.url().includes("/api/admin/orders")) {
    apiCalls.push(req.url().replace("http://localhost:3001", ""));
  }
});

await page.goto("http://localhost:3001/login", { waitUntil: "domcontentloaded" });
await page.fill('input[type="text"]', "hq@store.com");
await page.fill('input[type="password"]', "hq123");
await page.click('button[type="submit"]');
await page.waitForURL("**/admin/**", { timeout: 15000 }).catch(() => {});
await sleep(1500);

await page.goto("http://localhost:3001/admin/orders", { waitUntil: "domcontentloaded" });
await page.waitForSelector("tbody tr", { timeout: 15000 });
await sleep(1500);

const getRows = () =>
  page.$$eval("tbody tr", (trs) => trs.length + " rows");

const searchInput = page.locator('input[placeholder*="Search"]');

// Search "zzzzz" -> 0 rows
apiCalls.length = 0;
await searchInput.fill("zzzzz");
await sleep(2500);
console.log('After "zzzzz":', await getRows());
console.log("API calls so far:", apiCalls.join(" ; "));

// Wait 35s to let the 30s polling fire
console.log("\nWaiting 38s to observe 30s polling...");
apiCalls.length = 0;
await sleep(38000);
console.log('After 38s wait:', await getRows());
console.log("Polling API calls:", apiCalls.join(" ; "));

await browser.close();