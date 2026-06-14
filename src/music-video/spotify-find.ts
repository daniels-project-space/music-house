/**
 * Autonomous Spotify link finder — BROWSES the Spotify website and reads the
 * rendered search results (the search page is a JS SPA; the API is Premium-gated
 * and anonymous search is throttled, so we drive a real headless browser).
 * Best-effort: returns null on any failure so it never blocks a render.
 * Playwright chromium ships in the Trigger image (trigger.config playwright ext).
 */
import { chromium, type Browser } from "playwright";

const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const LAUNCH_ARGS = ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"];

export async function findSpotifyLink(artist: string, title: string): Promise<string | null> {
  let browser: Browser | null = null;
  try {
    try {
      browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
    } catch {
      browser = await chromium.launch({ headless: true, channel: "chrome", args: LAUNCH_ARGS });
    }
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      viewport: { width: 1366, height: 900 },
      locale: "en-US",
    });
    const page = await ctx.newPage();
    await page.goto(`https://open.spotify.com/search/${encodeURIComponent(`${artist} ${title}`)}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    try {
      await page.click("#onetrust-accept-btn-handler", { timeout: 6000 });
    } catch {
      /* no cookie banner */
    }
    await page.waitForSelector('a[href*="/track/"]', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const links = await page.$$eval('a[href*="/track/"]', (as) =>
      as.map((a) => ({
        href: (a.getAttribute("href") || "").split("?")[0],
        text: (a.textContent || "").trim(),
        aria: a.getAttribute("aria-label") || "",
      })),
    );
    const byHref = new Map<string, { href: string; label: string }>();
    for (const l of links) {
      if (!/^\/track\//.test(l.href)) continue;
      const label = `${l.text} ${l.aria}`.trim();
      const prev = byHref.get(l.href);
      if (!prev || label.length > prev.label.length) byHref.set(l.href, { href: l.href, label });
    }
    const want = norm(title);
    const hit = [...byHref.values()].find((l) => norm(l.label).includes(want));
    return hit ? `https://open.spotify.com${hit.href}` : null;
  } catch {
    return null;
  } finally {
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
  }
}
