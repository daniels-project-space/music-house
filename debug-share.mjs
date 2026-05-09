import { chromium } from 'playwright-core';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGE: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
await page.goto('https://music-house-nine.vercel.app/share/album/iron_horizon/a-dying-art', { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(4000);
console.log('errors:'); errors.forEach(e => console.log(' ', e));
const body = await page.evaluate(() => ({
  url: location.href,
  bodyHTML: document.body.innerHTML.length,
  mainHTML: (document.querySelector('main')?.innerHTML || '').slice(0, 600),
  hasMain: !!document.querySelector('main'),
  bodyChildCount: document.body.children.length,
}));
console.log(JSON.stringify(body, null, 2));
await browser.close();
