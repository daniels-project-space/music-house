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

const UPC = process.argv[2] || "5064011213885";
await page.goto(`https://www.routenote.com/rn/edit_album/${UPC}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
console.log("URL:", page.url());

// Capture status indicators
const status = await page.evaluate(() => {
  const allText = document.body.innerText || "";
  const find = (re) => { const m = allText.match(re); return m ? m[0] : null; };
  return {
    stepsLine: find(/Step\s*1:\s*[A-Za-z]+\s+Step\s*2:\s*[A-Za-z]+\s+Step\s*3:\s*[A-Za-z]+\s+Step\s*4:\s*[A-Za-z]+/),
    finishLine: find(/Finish\s*[:_]\s*[A-Za-z]+/),
    distributeButtons: [
      document.querySelector("input[value='Distribute Free']") ? "Distribute Free present" : null,
      document.querySelector("input[value='Distribute Premium']") ? "Distribute Premium present" : null,
    ].filter(Boolean),
    inReviewBanner: find(/[Ii]n\s+[Rr]eview/),
    submittedBanner: find(/[Ss]ubmitted|[Pp]ending|[Aa]pproved|[Dd]elivered|[Cc]ompleted/),
    trackcount: (() => {
      const scripts = [...document.querySelectorAll("script")].map(s => s.textContent || "").join("\n");
      const m = scripts.match(/var\s+trackcount\s*=\s*"?(\d+)"?/);
      return m ? m[1] : null;
    })(),
  };
});
console.log(JSON.stringify(status, null, 2));

// Also probe /rn/releases for the UPC
await page.goto("https://www.routenote.com/rn/releases", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
const onReleases = await page.evaluate((upc) => {
  return {
    found: (document.body.innerText || "").includes(upc),
    tabs: [...document.querySelectorAll("[class*='tab-header']")].map(t => t.innerText.trim()),
  };
}, UPC);
console.log("\n/rn/releases:", JSON.stringify(onReleases, null, 2));

// Try in-review tab specifically
const inReviewTabIndex = onReleases.tabs.findIndex(t => /review/i.test(t));
if (inReviewTabIndex >= 0) {
  console.log("\nClicking In Review tab...");
  const headers = page.locator("[class*='tab-header']");
  await headers.nth(inReviewTabIndex).click({ force: true });
  await page.waitForTimeout(2500);
  const inReviewState = await page.evaluate((upc) => ({
    upcFound: (document.body.innerText || "").includes(upc),
    sample: (document.body.innerText || "").slice(0, 600),
  }), UPC);
  console.log("In Review tab:", JSON.stringify(inReviewState, null, 2));
}

await browser.close();
