import { chromium } from "playwright-core";

const URL = process.env.URL ?? "https://music-house-nine.vercel.app/library/iron_horizon/a-dying-art";
const OUT = process.env.OUT ?? "/tmp/player.png";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "no-preference",
});
const page = await ctx.newPage();

console.log("goto", URL);
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});
await page.waitForTimeout(3500);

const playBtns = page.locator('button[aria-label="Play"]');
const count = await playBtns.count();
console.log("play buttons:", count);
if (count > 0) {
  await playBtns.nth(1).click({ force: true });
  console.log("clicked second Play (skip first which is the album header play)");
}
await page.waitForTimeout(3000);

// Capture transform of the vinyl to see if rotation is changing
async function vinylTransform() {
  return page.evaluate(() => {
    const el = document.querySelector('[class*="fixed"][class*="bottom-0"] .vinyl');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      transform: cs.transform,
      animationName: cs.animationName,
      animationDuration: cs.animationDuration,
      animationPlayState: cs.animationPlayState,
    };
  });
}

const t1 = await vinylTransform();
console.log("vinyl @ t=0:", t1);
await page.waitForTimeout(1500);
const t2 = await vinylTransform();
console.log("vinyl @ t=1.5:", t2);

// Cover img URL?
const coverInfo = await page.evaluate(() => {
  const a = document.querySelector('[class*="fixed"][class*="bottom-0"] a');
  if (!a) return null;
  const cover = a.querySelectorAll('div')[1]; // sleeve div
  const img = cover?.querySelector('img');
  return {
    sleeveHTML: cover?.outerHTML?.slice(0, 400),
    imgSrc: img?.src,
    naturalW: img?.naturalWidth,
    naturalH: img?.naturalHeight,
  };
});
console.log("cover info:", JSON.stringify(coverInfo, null, 2));

await page.screenshot({ path: OUT, clip: { x: 200, y: 800, width: 600, height: 100 } });
console.log("saved crop to", OUT);

await browser.close();
