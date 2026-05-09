import { chromium } from "playwright-core";
const APP = "https://determined-aardvark-936.convex.cloud";
const auth = await (await fetch(APP + "/api/query", {
  method:"POST", headers:{"Content-Type":"application/json"},
  body:JSON.stringify({path:"distributorAuth:get",args:{distributor:"routenote"},format:"json"})
})).json();
const seen = new Map();
for (const c of JSON.parse(auth.value.cookiesJson)) {
  if (!/routenote\.com$/.test(c.domain || "")) continue;
  if (!seen.has(c.name)) seen.set(c.name, c);
}
const farFuture = Math.floor(Date.now()/1000) + 60*60*24*365;
const cookies = [...seen.values()].map(c => ({
  name: c.name, value: c.value, url: "https://www.routenote.com/",
  expires: farFuture, httpOnly: !!c.httpOnly, secure: true, sameSite: "Lax",
}));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox","--disable-dev-shm-usage"] });
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  viewport: { width: 1440, height: 900 },
});
await ctx.addCookies(cookies);
const page = await ctx.newPage();
const UPC = process.argv[2];
await page.goto(`https://www.routenote.com/rn/addaudiomp3/form/${UPC}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
const code = await page.evaluate(() => typeof getpath === "function" ? getpath.toString() : "n/a");
console.log("=== full getpath() ===");
console.log(code);
console.log("\n=== full upload-related funcs ===");
const otherFns = await page.evaluate(() => {
  const out = {};
  for (const name of ["cloudupload", "cloudUpload", "upload_file", "uploadfile", "checkfilebit", "uplodfilenam", "filechunkuploadcheck", "chunkupload", "rdy_for_upload", "do_upload", "uplodfile", "upload_audio", "rebuild_value", "rebuildvalue"]) {
    try { if (typeof window[name] === "function") out[name] = window[name].toString().slice(0, 1500); } catch{}
  }
  return out;
});
for (const [k,v] of Object.entries(otherFns)) {
  console.log(`\n--- ${k} ---`);
  console.log(v);
}
await browser.close();
