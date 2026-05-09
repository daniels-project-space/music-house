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

const code = await page.evaluate(() => getpath.toString());
console.log("getpath length:", code.length);

// The function checks `if(rolename_sp=="admin")` then has else. Find end of admin block.
// Look for $.ajax or XMLHttpRequest calls with file upload
const ajaxBlocks = [];
let pos = 0;
let n = 0;
while (n < 25) {
  const idx = code.indexOf("$.ajax", pos);
  if (idx < 0) break;
  // Find end of this ajax call (matching closing brace)
  let depth = 0;
  let end = idx;
  for (let i = idx; i < Math.min(idx + 5000, code.length); i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  ajaxBlocks.push({ start: idx, end, snippet: code.slice(idx, Math.min(idx + 800, end)) });
  pos = end;
  n++;
}
console.log("ajax blocks found:", ajaxBlocks.length);
for (let i = 0; i < ajaxBlocks.length; i++) {
  console.log(`\n--- ajax #${i} at offset ${ajaxBlocks[i].start} ---`);
  console.log(ajaxBlocks[i].snippet);
}

// Also look for FormData / XMLHttpRequest / fetch calls
const formDataMatches = [...code.matchAll(/new FormData|new XMLHttpRequest|fetch\(/g)];
console.log("\nFormData/XHR/fetch matches:", formDataMatches.length);
for (const m of formDataMatches.slice(0, 10)) {
  const ctx_str = code.slice(Math.max(0, m.index - 100), m.index + 400);
  console.log(" at", m.index, ":", m[0]);
  console.log(" ctx:", ctx_str.replace(/\s+/g, " ").slice(0, 300));
}

await browser.close();
