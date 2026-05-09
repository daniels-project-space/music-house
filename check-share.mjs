import { chromium } from 'playwright-core';
const b = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errors = [], reqs = [];
p.on('pageerror', e => errors.push('PAGE:' + e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE:' + m.text()); });
p.on('requestfailed', r => reqs.push('FAIL:' + r.url() + ' ' + r.failure()?.errorText));
p.on('response', r => { if (r.status() >= 400) reqs.push('HTTP ' + r.status() + ' ' + r.url()); });
await p.goto('https://mh-listen.vercel.app/iron_horizon/a-dying-art', { waitUntil: 'domcontentloaded' });
await p.waitForLoadState('networkidle', { timeout: 18000 }).catch(() => {});
await p.waitForTimeout(3500);
console.log('errors:'); errors.forEach(e => console.log(' ', e.slice(0,200)));
console.log('failed reqs:'); reqs.slice(0, 10).forEach(r => console.log(' ', r.slice(0, 200)));
const body = await p.evaluate(() => ({
  url: location.href, title: document.title,
  bodyText: document.body.innerText.slice(0, 200),
  bodyBg: getComputedStyle(document.body).backgroundColor,
  htmlBg: getComputedStyle(document.documentElement).backgroundColor,
}));
console.log(JSON.stringify(body, null, 2));
await p.screenshot({ path: '/tmp/check-share.png', fullPage: true });
await b.close();
