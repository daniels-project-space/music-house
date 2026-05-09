import { chromium } from "playwright-core";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();
await page.goto("https://www.routenote.com/rn/login", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
const out = await page.evaluate(() => {
  const captcha = document.querySelector(".g-recaptcha, [class*=\"recaptcha\"]");
  const remember = document.querySelector("input[type=\"checkbox\"][name*=\"remember\" i], input[type=\"checkbox\"][id*=\"remember\" i]");
  const visibleCheckboxes = [...document.querySelectorAll("input[type=\"checkbox\"]")].filter(c => c.offsetParent).map(c => ({ id: c.id, name: c.name }));
  return {
    captchaPresent: !!captcha,
    captchaSitekey: captcha?.getAttribute("data-sitekey"),
    rememberMePresent: !!remember,
    visibleCheckboxes,
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
