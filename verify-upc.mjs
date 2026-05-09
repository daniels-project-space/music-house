// Visit a release on RouteNote, dump the visible field values to confirm what's actually saved.
import { chromium } from "playwright-core";

const BB_API_KEY = process.env.BB_API_KEY;
const BB_PROJECT_ID = process.env.BB_PROJECT_ID;
const APP_URL = "https://determined-aardvark-936.convex.cloud";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const upcs = (process.env.UPCS || "").split(",").filter(Boolean);
if (upcs.length === 0) { console.error("set UPCS=upc1,upc2"); process.exit(1); }

const r = await fetch("https://api.browserbase.com/v1/sessions", {
  method: "POST",
  headers: { "X-BB-API-Key": BB_API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ projectId: BB_PROJECT_ID, keepAlive: false, browserSettings: { viewport: { width: 1440, height: 900 }, blockAds: true } }),
});
const session = await r.json();
console.log("session:", session.id, "https://www.browserbase.com/sessions/" + session.id);

const browser = await chromium.connectOverCDP(session.connectUrl);
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] ?? (await ctx.newPage());

try {
  // Restore cookies
  const saved = await fetch(`${APP_URL}/api/query`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "distributorAuth:get", args: { distributor: "routenote" }, format: "json" }),
  }).then(r => r.json()).then(j => j.value);
  if (saved?.cookiesJson) await ctx.addCookies(JSON.parse(saved.cookiesJson));

  for (const upc of upcs) {
    console.log("\n==================");
    console.log("UPC:", upc);
    console.log("==================");

    // Hub page
    const hubUrl = `https://www.routenote.com/rn/edit_album/${upc}`;
    await page.goto(hubUrl, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await sleep(2000);
    if (page.url().toLowerCase().includes("/login")) {
      console.log("  REDIRECTED TO LOGIN — not authed for this UPC");
      continue;
    }
    const hubText = await page.evaluate(() => {
      const main = document.querySelector("main, #main, .main, body");
      return (main?.innerText || "").slice(0, 2500);
    });
    console.log("HUB url:", page.url());
    console.log("HUB text (first 2500 chars):");
    console.log(hubText);

    // Album Details form
    const detailsUrl = `https://www.routenote.com/rn/editalbum/${upc}`;
    await page.goto(detailsUrl, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await sleep(2000);
    const fields = await page.evaluate(() => {
      const ids = [
        "edit_album_info_title", "edit_album_info_artist", "edit_album_info_genre",
        "edit_album_info_sec_genre", "edit_album_info_label",
        "cpy_year", "cpy_name", "edit_album_info_pcopyyear", "edit_album_info_pcopyname",
        "edit_album_first_composer", "edit_album_last_composer",
        "edit_album_info_release", "edit_album_info_org_date",
      ];
      const out = {};
      for (const id of ids) {
        const el = document.getElementById(id);
        out[id] = el ? (el.value || "") : "<not found>";
      }
      return out;
    });
    console.log("DETAILS values:");
    for (const [k, v] of Object.entries(fields)) console.log(`  ${k} = "${v}"`);
  }
} catch (e) {
  console.error("ERR:", e.message);
} finally {
  await browser.close();
}
