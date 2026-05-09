import { chromium } from 'playwright-core';
const b = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
await p.goto('https://music-house-nine.vercel.app/library', { waitUntil: 'domcontentloaded' });
await p.waitForLoadState('networkidle', { timeout: 18000 }).catch(() => {});
await p.waitForTimeout(2500);
await p.screenshot({ path: '/tmp/lib-mobile.png', fullPage: false });
const data = await p.evaluate(() => {
  const aside = document.querySelector('aside');
  const cs = aside ? getComputedStyle(aside) : null;
  return {
    asideDisplay: cs?.display, asideWidth: cs?.width,
    bodyWidth: document.body.scrollWidth,
    viewport: { w: innerWidth, h: innerHeight },
  };
});
console.log(JSON.stringify(data, null, 2));
await b.close();
