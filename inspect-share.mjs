import { chromium } from 'playwright-core';
const b = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto('https://music-house-nine.vercel.app/share/album/iron_horizon/a-dying-art', { waitUntil: 'domcontentloaded' });
await p.waitForLoadState('networkidle', { timeout: 18000 }).catch(() => {});
await p.waitForTimeout(3500);
const info = await p.evaluate(() => {
  const main = document.querySelector('main');
  if (!main) return { error: 'no main' };
  const rect = main.getBoundingClientRect();
  const cs = getComputedStyle(main);
  const h1 = main.querySelector('h1');
  const h1rect = h1?.getBoundingClientRect();
  const h1cs = h1 && getComputedStyle(h1);
  const img = main.querySelector('img');
  const imgrect = img?.getBoundingClientRect();
  return {
    main: { x: rect.x, y: rect.y, w: rect.width, h: rect.height, display: cs.display, visibility: cs.visibility, opacity: cs.opacity },
    h1: h1 ? { text: h1.textContent, x: h1rect.x, y: h1rect.y, w: h1rect.width, h: h1rect.height, color: h1cs.color, display: h1cs.display, opacity: h1cs.opacity } : null,
    img: img ? { x: imgrect.x, y: imgrect.y, w: imgrect.width, h: imgrect.height, src: img.src.slice(0, 80) } : null,
    bodyClass: document.body.className,
    bodyChildren: Array.from(document.body.children).map(c => ({ tag: c.tagName, cls: c.className?.slice(0,50), display: getComputedStyle(c).display })),
  };
});
console.log(JSON.stringify(info, null, 2));
await b.close();
