import { chromium } from "playwright-core";
const APP = "https://determined-aardvark-936.convex.cloud";
const auth = await (await fetch(APP + "/api/query", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ path: "distributorAuth:get", args: { distributor: "routenote" }, format: "json" }),
})).json();
const seen = new Map();
for (const c of JSON.parse(auth.value.cookiesJson)) {
  if (!/routenote\.com$/.test(c.domain || "")) continue;
  if (!seen.has(c.name)) seen.set(c.name, c);
}
const farFuture = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
const cookies = [...seen.values()].map(c => ({
  name: c.name, value: c.value, url: "https://www.routenote.com/",
  expires: farFuture, httpOnly: !!c.httpOnly, secure: true, sameSite: "Lax",
}));

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  viewport: { width: 1440, height: 900 },
});
await ctx.addCookies(cookies);
const page = await ctx.newPage();

await page.goto("https://www.routenote.com/rn/releases", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);

// Click the "In Review" tab specifically — locate by exact text
const inReviewTab = page.locator(".disco__tab-header").filter({ hasText: /^In Review/ }).first();
console.log("In Review tab count:", await inReviewTab.count());
await inReviewTab.click({ force: true });
await page.waitForTimeout(5000);

// Wait for actual content
await page.waitForFunction(() => {
  const cards = document.querySelectorAll(".disco__release, .disco__details");
  return cards.length > 0;
}, { timeout: 10000 }).catch(() => console.log("no cards rendered"));

const inReview = await page.evaluate(() => {
  const releases = [];
  document.querySelectorAll(".disco__release, .disco__details").forEach(el => {
    const upcM = (el.innerText || "").match(/UPC:\s*(\d{10,14})/);
    const titleEl = el.querySelector(".disco__title, .disco__release-title, [class*='title']");
    releases.push({
      upc: upcM ? upcM[1] : null,
      title: titleEl ? (titleEl.innerText || "").trim().slice(0, 60) : null,
      text: (el.innerText || "").trim().slice(0, 200),
    });
  });
  return releases.slice(0, 5);
});
console.log("In Review releases:");
for (const r of inReview) console.log(" ", JSON.stringify(r));

await browser.close();
