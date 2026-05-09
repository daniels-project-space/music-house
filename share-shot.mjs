import { chromium } from 'playwright-core';
const b = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto('https://music-house-nine.vercel.app/share/album/iron_horizon/a-dying-art', { waitUntil: 'domcontentloaded' });
await p.waitForLoadState('networkidle', { timeout: 18000 }).catch(() => {});
await p.waitForTimeout(3500);
await p.screenshot({ path: '/tmp/v-3-share-full.png', fullPage: true });
await b.close();
console.log('done');
