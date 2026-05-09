import { chromium } from "playwright-core";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox","--disable-dev-shm-usage"] });
const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", viewport:{width:1440,height:900} });
const page = await ctx.newPage();
await page.goto("https://www.routenote.com/rn/login", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
const sitekey = await page.evaluate(() => {
  const all = [...document.querySelectorAll("[data-sitekey], iframe[src*=\"recaptcha\"], div[class*=\"recaptcha\"], div[id*=\"recaptcha\"]")];
  const out = [];
  for (const el of all) {
    out.push({
      tag: el.tagName,
      dataSitekey: el.getAttribute("data-sitekey"),
      src: el.getAttribute("src")?.slice(0, 200),
      id: el.id,
      cls: (el.className.baseVal !== undefined ? el.className.baseVal : el.className || "").toString().slice(0, 80),
    });
  }
  // Also look in window for grecaptcha widgets and globals
  const renderCalls = [...document.querySelectorAll("script")].map(s => s.textContent || "").join("\n");
  const sk = renderCalls.match(/sitekey[\"\x27\s:=]+([\"\x27])([0-9a-zA-Z_-]{30,})\1/);
  return { elements: out, scriptSitekey: sk ? sk[2] : null };
});
console.log(JSON.stringify(sitekey, null, 2));
await browser.close();
