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
await page.goto(`https://www.routenote.com/rn/addaudiomp3/form/${UPC}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

const tv = await page.evaluate(() => typeof trackvalid === "function" ? trackvalid.toString() : "(not found)");
console.log("=== trackvalid() ===");
console.log(tv.slice(0, 8000));

// Also check jQuery form-plugin binding
const formBound = await page.evaluate(() => {
  if (!window.jQuery) return "no jquery";
  const f = jQuery("#addmp3-form");
  if (!f.length) return "no form";
  // Check internal events
  const evts = jQuery._data ? jQuery._data(f[0], "events") : null;
  const submitEvts = evts?.submit?.map(e => e.handler.toString().slice(0, 300)) || [];
  return { submitHandlers: submitEvts.length, firstHandler: submitEvts[0] };
});
console.log("\n=== form jq submit handlers ===");
console.log(JSON.stringify(formBound, null, 2));

await browser.close();
