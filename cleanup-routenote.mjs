// Walk RouteNote /rn/releases and delete every "Action Needed" / incomplete release
// using the saved cookies in distributorAuth.
import { chromium } from "playwright-core";

const APP = "https://determined-aardvark-936.convex.cloud";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cx(path, args, mut = false) {
  const r = await fetch(`${APP}/api/${mut ? "mutation" : "query"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
  });
  return (await r.json()).value;
}

const auth = await cx("distributorAuth:get", { distributor: "routenote" });
if (!auth?.cookiesJson) {
  console.error("no saved RouteNote cookies — bootstrap first");
  process.exit(1);
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies(JSON.parse(auth.cookiesJson));
const page = await ctx.newPage();

await page.goto("https://www.routenote.com/rn/releases", { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
await sleep(2500);

if (page.url().toLowerCase().includes("/login")) {
  console.error("cookies expired — run bootstrap-auth.mjs again");
  await browser.close();
  process.exit(2);
}

// Click the "Action Needed" tab if not already
try {
  await page.locator("text=Action Needed").first().click();
  await sleep(2000);
} catch {}

// Find all incomplete releases — the trash icon
let killed = 0;
for (let pass = 0; pass < 25; pass++) {
  // Inspect available release cards
  const upcs = await page.evaluate(() => {
    const out = [];
    const rows = document.querySelectorAll("[class*='release'], div");
    document.querySelectorAll("body *").forEach((el) => {
      const t = (el.textContent || "");
      const m = t.match(/UPC:\s*(\d{10,14})/);
      if (m && el.children.length < 30) {
        const upc = m[1];
        if (!out.find((x) => x.upc === upc)) out.push({ upc });
      }
    });
    return out.slice(0, 20);
  });
  console.log(`[${pass}] ${upcs.length} releases visible`);
  if (upcs.length === 0) break;

  // Find all trash icons (typically images or buttons near the release)
  const trashCount = await page.locator("img[src*='trash'], img[alt*='trash' i], img[alt*='delete' i], button:has(img[src*='trash']), [onclick*='delete']").count();
  console.log(`  trash icons found: ${trashCount}`);
  if (trashCount === 0) break;

  // Click first trash, dismiss confirm
  page.once("dialog", (d) => d.accept().catch(() => {}));
  try {
    await page.locator("img[src*='trash'], img[alt*='trash' i], img[alt*='delete' i]").first().click({ force: true });
    await sleep(2000);
    // Try to confirm any modal
    const ok = page.locator("button:visible:has-text('Yes'), button:visible:has-text('OK'), button:visible:has-text('Delete'), button:visible:has-text('Confirm')").first();
    if ((await ok.count()) > 0) {
      await ok.click({ force: true });
      await sleep(2000);
    }
    killed++;
    console.log(`  killed ${killed} so far`);
  } catch (e) {
    console.log(`  click failed: ${e.message}`);
    break;
  }
  // Reload to refresh
  await page.goto("https://www.routenote.com/rn/releases", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await sleep(2000);
}

console.log(`\nfinal: deleted ${killed} releases`);
await browser.close();
