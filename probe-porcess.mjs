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

const fns = await page.evaluate(() => {
  const out = {};
  for (const k of ["porcess", "process", "completeHandler", "getfilevalue", "ajaxSubmit", "uplodfile"]) {
    if (typeof window[k] === "function") out[k] = window[k].toString().slice(0, 5000);
  }
  return out;
});
for (const [k, v] of Object.entries(fns)) {
  console.log(`\n=== ${k}() ===`);
  console.log(v);
}

// Also look for inline functions in the page source
const code = await page.evaluate(() => getpath.toString());
console.log("\n=== porcess/completeHandler in getpath source ===");
for (const fnName of ["porcess", "completeHandler"]) {
  const idx = code.indexOf("function " + fnName);
  if (idx >= 0) {
    console.log(`\n--- ${fnName} at ${idx} ---`);
    console.log(code.slice(idx, idx + 3000));
  } else {
    console.log(`${fnName}: not in getpath`);
  }
}

await browser.close();
