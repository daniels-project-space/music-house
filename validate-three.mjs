import { chromium } from "playwright-core";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" });
const page = await ctx.newPage();

async function shoot(url, label, action) {
  console.log("\n=== " + label + " :: " + url + " ===");
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 18000 }).catch(() => {});
  await page.waitForTimeout(2500);
  if (action) await action();
  const out = "/tmp/v-" + label + ".png";
  await page.screenshot({ path: out, fullPage: false });
  console.log("saved", out);

  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  console.log("body bg:", bg);
}

// 1. brighter background — library page
await shoot("https://music-house-nine.vercel.app/library", "1-bg-library");

// 2. lyrics collapse — album page, click first track lyrics, then click expand
await shoot("https://music-house-nine.vercel.app/library/iron_horizon/a-dying-art", "2a-album", async () => {
  // Open three-dots menu of first track row, click Lyrics
  const moreBtns = page.locator('button[aria-label="More"]');
  if (await moreBtns.count()) {
    await moreBtns.first().click();
    await page.waitForTimeout(500);
    const lyricsBtn = page.locator('button:has-text("Lyrics")').first();
    if (await lyricsBtn.count()) {
      await lyricsBtn.click();
      await page.waitForTimeout(800);
    }
  }
});
await shoot("https://music-house-nine.vercel.app/library/iron_horizon/a-dying-art", "2b-album-after-expand", async () => {
  const moreBtns = page.locator('button[aria-label="More"]');
  if (await moreBtns.count()) {
    await moreBtns.first().click();
    await page.waitForTimeout(400);
    const lyricsBtn = page.locator('button:has-text("Lyrics")').first();
    if (await lyricsBtn.count()) {
      await lyricsBtn.click();
      await page.waitForTimeout(700);
    }
  }
  // Now click the lyrics header to expand
  const expander = page.locator('button[aria-expanded]').first();
  if (await expander.count()) {
    await expander.click();
    await page.waitForTimeout(800);
  }
});

// 3. share page
await shoot("https://music-house-nine.vercel.app/share/album/iron_horizon/a-dying-art", "3-share");

const sidebarVisible = await page.evaluate(() => {
  const aside = document.querySelector("aside");
  return aside ? getComputedStyle(aside).display : "no-aside";
});
console.log("sidebar display on share page:", sidebarVisible);

await browser.close();
