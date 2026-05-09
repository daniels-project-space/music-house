// Delete stuck draft releases on RouteNote via Playwright (UI-driven; no bulk delete API exposed).
import { chromium } from "playwright-core";

const STUCK = ["5064011213885", "5064011612510", "5064011692406", "5064011851360"];

const APP = "https://determined-aardvark-936.convex.cloud";
const auth = await (await fetch(APP + "/api/query", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ path: "distributorAuth:get", args: { distributor: "routenote" }, format: "json" }),
})).json();
if (!auth?.value?.cookiesJson) { console.error("no cookies"); process.exit(1); }

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

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  viewport: { width: 1440, height: 900 },
});
await ctx.addCookies(cookies);
const page = await ctx.newPage();
page.on("dialog", async d => { try { await d.accept(); } catch {} });

for (const upc of STUCK) {
  console.log(`\n=== Deleting UPC ${upc} ===`);
  // Navigate to releases listing
  await page.goto("https://www.routenote.com/rn/releases", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  if (page.url().toLowerCase().includes("/login")) {
    console.error("auth lost — abort");
    break;
  }

  // Check tabs that might surface incomplete drafts
  for (const tabUrl of [
    "https://www.routenote.com/rn/releases",
    "https://www.routenote.com/rn/releases?type=incomplete",
    "https://www.routenote.com/rn/releases?type=draft",
    "https://www.routenote.com/rn/my_releases",
  ]) {
    await page.goto(tabUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const found = await page.evaluate((targetUpc) => {
      return (document.body.innerText || "").includes(targetUpc);
    }, upc);
    if (found) {
      console.log(`  found on ${tabUrl}`);
      // Locate the row with this UPC; find its trash icon
      const deleteAttempt = await page.evaluate((targetUpc) => {
        // Walk DOM for an element whose text contains the UPC
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        let row = null;
        while (walker.nextNode()) {
          const el = walker.currentNode;
          const txt = el.textContent || "";
          if (txt.includes(targetUpc) && el.children.length < 30 && el.children.length > 0) {
            row = el;
            break;
          }
        }
        if (!row) return { ok: false, why: "no row found" };
        // Look for a delete icon/button within the row
        const candidates = row.querySelectorAll("a, button, img, span");
        for (const c of candidates) {
          const cls = (c.className || "").toString().toLowerCase();
          const id = (c.id || "").toLowerCase();
          const onclick = (c.getAttribute("onclick") || "").toLowerCase();
          const title = (c.getAttribute("title") || "").toLowerCase();
          const alt = (c.getAttribute("alt") || "").toLowerCase();
          const src = (c.getAttribute("src") || "").toLowerCase();
          if (/trash|delete|remove/i.test(cls + id + onclick + title + alt + src)) {
            c.click();
            return { ok: true, clickedTag: c.tagName, clickedAttrs: { cls, id, src } };
          }
        }
        return { ok: false, why: "no trash element in row" };
      }, upc);
      console.log("  delete attempt:", JSON.stringify(deleteAttempt));
      if (deleteAttempt.ok) {
        await page.waitForTimeout(2000);
        // Confirm any modal
        const confirmed = await page.evaluate(() => {
          const buttons = document.querySelectorAll("button, input[type='button'], input[type='submit'], a");
          for (const b of buttons) {
            const txt = (b.innerText || b.value || "").trim().toLowerCase();
            if (/^(yes|delete|confirm|ok)$/.test(txt) && b.offsetParent !== null) {
              b.click();
              return txt;
            }
          }
          return null;
        });
        console.log("  modal confirm clicked:", confirmed);
        await page.waitForTimeout(3000);
      }
      break; // only need to find on one tab
    }
  }
}

// Save cookies back
const finalCookies = (await ctx.cookies()).filter(c => /routenote\.com$/.test(c.domain));
await fetch(APP + "/api/mutation", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ path: "distributorAuth:save", args: { distributor: "routenote", cookiesJson: JSON.stringify(finalCookies) }, format: "json" }),
});

await browser.close();
console.log("\n✓ cleanup done");
