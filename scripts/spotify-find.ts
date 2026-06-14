/**
 * Autonomously find a song's Spotify link by BROWSING the Spotify website
 * (search page is JS-rendered, so we drive a real headless Chrome).
 *   ./node_modules/.bin/tsx scripts/spotify-find.ts "<artist> <title>"
 */
import { chromium, type Browser } from "playwright";

const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function launch(): Promise<Browser> {
  const args = ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"];
  try {
    return await chromium.launch({ headless: true, channel: "chrome", args });
  } catch {
    return await chromium.launch({ headless: true, args });
  }
}

(async () => {
  const query = process.argv.slice(2).join(" ") || "a dying art the dollcat";
  const wantTitle = norm(process.env.WANT_TITLE || "a dying art");
  const browser = await launch();
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
  });
  const page = await ctx.newPage();
  await page.goto(`https://open.spotify.com/search/${encodeURIComponent(query)}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  console.log("page title:", await page.title());
  try {
    await page.click("#onetrust-accept-btn-handler", { timeout: 6000 });
    console.log("(accepted cookies)");
  } catch {}
  await page.waitForSelector('a[href*="/track/"], a[href*="/album/"]', { timeout: 35000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const links = await page.$$eval('a[href*="/track/"], a[href*="/album/"]', (as) =>
    as.map((a) => ({
      href: (a.getAttribute("href") || "").split("?")[0],
      text: (a.textContent || "").trim(),
      aria: a.getAttribute("aria-label") || "",
    })),
  );
  // de-dupe by href, keep the richest label
  const byHref = new Map<string, { href: string; text: string; aria: string }>();
  for (const l of links) {
    if (!/^\/(track|album)\//.test(l.href)) continue;
    const prev = byHref.get(l.href);
    if (!prev || (l.text + l.aria).length > (prev.text + prev.aria).length) byHref.set(l.href, l);
  }
  const all = [...byHref.values()];
  console.log("candidate links:", all.length);
  const hit = all.find((l) => norm(l.text + " " + l.aria).includes(wantTitle));
  if (hit) {
    console.log("MATCH:", "https://open.spotify.com" + hit.href, "|", hit.text.slice(0, 50) || hit.aria.slice(0, 50));
  } else {
    console.log("no title match; top candidates:");
    for (const l of all.slice(0, 12)) console.log("  https://open.spotify.com" + l.href, "|", (l.text || l.aria).slice(0, 50));
  }
  await browser.close();
})().catch((e) => {
  console.error("FAILED:", String(e).slice(0, 300));
  process.exit(1);
});
