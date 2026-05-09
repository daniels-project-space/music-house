// Probe RouteNote /rn/releases to find the actual delete-row mechanism.
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
await page.waitForTimeout(3000);

const UPC = "5064011213885";

// Walk up DOM from UPC text to find the row container, then dump all clickable children
const rowInfo = await page.evaluate((targetUpc) => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let textNode = null;
  while (walker.nextNode()) {
    if ((walker.currentNode.textContent || "").includes(targetUpc)) {
      textNode = walker.currentNode;
      break;
    }
  }
  if (!textNode) return { found: false };
  // Walk up to find row-ish container (table row, list item, or div with reasonable child count)
  let el = textNode.parentElement;
  for (let i = 0; i < 12 && el; i++) {
    if (el.tagName === "TR" || el.tagName === "LI" || (el.children.length > 3 && el.children.length < 20)) break;
    el = el.parentElement;
  }
  if (!el) return { found: false };
  const summary = {
    rowTag: el.tagName,
    rowId: el.id || "(none)",
    rowCls: (el.className || "").toString().slice(0, 80),
    children: [],
    allButtons: [],
    allLinks: [],
    allImgs: [],
  };
  // Direct children
  for (const c of el.children) {
    summary.children.push({ tag: c.tagName, cls: (c.className || "").toString().slice(0, 60), text: (c.innerText || "").trim().slice(0, 40) });
  }
  // All buttons in row
  el.querySelectorAll("button, input[type='button']").forEach(b => {
    summary.allButtons.push({ id: b.id, cls: (b.className || "").toString().slice(0, 60), text: (b.innerText || b.value || "").trim().slice(0, 50), onclick: (b.getAttribute("onclick") || "").slice(0, 100) });
  });
  // All links
  el.querySelectorAll("a").forEach(a => {
    const href = a.getAttribute("href") || "";
    if (/delete|remove|trash/i.test(href + (a.getAttribute("onclick") || "") + (a.className || ""))) {
      summary.allLinks.push({ href: href.slice(0, 150), cls: a.className.slice(0, 60), onclick: (a.getAttribute("onclick") || "").slice(0, 100) });
    }
  });
  // All images
  el.querySelectorAll("img").forEach(img => {
    const src = img.getAttribute("src") || "";
    if (/trash|delete|remove|bin|x\.png|cross/i.test(src)) {
      summary.allImgs.push({ src: src.slice(0, 150), alt: img.alt, parentTag: img.parentElement?.tagName, parentOnclick: (img.parentElement?.getAttribute("onclick") || "").slice(0, 100) });
    }
  });
  return { found: true, ...summary };
}, UPC);
console.log(JSON.stringify(rowInfo, null, 2));

// Also dump the raw HTML around the UPC for direct inspection
const rawSegment = await page.evaluate((targetUpc) => {
  const html = document.documentElement.innerHTML;
  const idx = html.indexOf(targetUpc);
  if (idx < 0) return null;
  return html.slice(Math.max(0, idx - 800), idx + 800);
}, UPC);
console.log("\n=== raw HTML around UPC ===");
console.log(rawSegment);

await browser.close();
