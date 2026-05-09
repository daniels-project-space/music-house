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

// Dump every globally defined function name + the source of relevant ones
const fns = await page.evaluate(() => {
  const names = [];
  for (const k of Object.keys(window)) {
    if (typeof window[k] === "function" && /^[a-zA-Z_]/.test(k)) names.push(k);
  }
  const target = ["check", "checkbit", "checkfilebit", "filechunkuploadcheck", "do_upload", "doupload", "uploadtoserver", "send_to_server", "callupload", "uploadFn", "uplodfile"];
  const out = { totalGlobalFns: names.length, found: {}, namesContainingUpload: names.filter(n => /upload/i.test(n)), namesContainingFile: names.filter(n => /file/i.test(n)).slice(0, 30) };
  for (const n of target) {
    if (typeof window[n] === "function") {
      out.found[n] = window[n].toString();
    }
  }
  return out;
});
console.log("uploadFns:", fns.namesContainingUpload);
console.log("fileFns sample:", fns.namesContainingFile);
console.log("\n=== known function bodies ===");
for (const [k, v] of Object.entries(fns.found)) {
  console.log(`\n--- ${k} ---`);
  console.log(v.slice(0, 4000));
}

// Also dump the inline script that defines getpath, check, etc. — find the source URL
const scriptSrcs = await page.evaluate(() => {
  return [...document.querySelectorAll("script")].map(s => ({ src: s.src || "(inline)", inlineLen: (s.textContent || "").length }));
});
console.log("\nscripts on page:");
for (const s of scriptSrcs) if (s.src !== "(inline)" || s.inlineLen > 5000) console.log(" ", s.src, "len:", s.inlineLen);

await browser.close();
