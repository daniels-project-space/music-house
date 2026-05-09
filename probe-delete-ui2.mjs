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

const UPC = "5064011213885";

// Find the closest .disco__card or similar Vue release card containing this UPC
const result = await page.evaluate((targetUpc) => {
  // Walk up from text node containing UPC
  const all = [...document.querySelectorAll("[class*='disco']")];
  let card = null;
  for (const el of all) {
    if ((el.innerText || "").includes(targetUpc)) {
      // Pick the OUTERMOST disco__card class
      let candidate = el;
      while (candidate.parentElement && /disco/i.test((candidate.parentElement.className || "").toString())) {
        candidate = candidate.parentElement;
      }
      card = candidate;
      break;
    }
  }
  if (!card) return { found: false };
  // List all svg, button, a, div with class containing 'menu', 'action', 'delete', 'remove', 'trash'
  const elements = [...card.querySelectorAll("*")];
  const interesting = [];
  for (const el of elements) {
    const cls = ((el.className || "").baseVal !== undefined ? el.className.baseVal : (el.className || "")).toString().toLowerCase();
    const id = (el.id || "").toLowerCase();
    const onclick = (el.getAttribute("onclick") || "").toLowerCase();
    const text = (el.innerText || "").trim().slice(0, 50);
    if (/menu|action|delete|remove|trash|bin|edit_btn|context|kebab|more/i.test(cls + id + onclick)) {
      interesting.push({ tag: el.tagName, cls: cls.slice(0, 80), id, onclick: onclick.slice(0, 100), text });
    }
  }
  // Also: collect all SVGs inside the card (might be the trash icon)
  const svgs = [];
  card.querySelectorAll("svg").forEach((s, i) => {
    if (i > 8) return;
    svgs.push({
      idx: i,
      cls: ((s.className.baseVal !== undefined ? s.className.baseVal : s.className) || "").toString().slice(0, 60),
      parentTag: s.parentElement?.tagName,
      parentCls: (s.parentElement?.className || "").toString().slice(0, 60),
      parentOnclick: (s.parentElement?.getAttribute("onclick") || "").slice(0, 80),
      childPaths: s.querySelectorAll("path").length,
    });
  });
  // Find card class
  return {
    found: true,
    cardCls: card.className,
    cardOuterTag: card.tagName,
    interesting: interesting.slice(0, 20),
    svgs,
    cardHtml: card.outerHTML.slice(0, 2500),
  };
}, UPC);
console.log("=== card recon ===");
console.log("cardCls:", result.cardCls);
console.log("interesting:", JSON.stringify(result.interesting, null, 2));
console.log("svgs:", JSON.stringify(result.svgs, null, 2));
console.log("\n=== card HTML head ===");
console.log(result.cardHtml);

await browser.close();
