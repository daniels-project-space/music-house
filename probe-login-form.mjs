import { chromium } from "playwright-core";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();
await page.goto("https://www.routenote.com/rn/login", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
console.log("URL:", page.url());

const fields = await page.evaluate(() => {
  const out = { inputs: [], buttons: [], forms: [] };
  document.querySelectorAll("form").forEach(f => out.forms.push({ id: f.id, action: f.action, method: f.method }));
  document.querySelectorAll("input").forEach(i => out.inputs.push({
    name: i.name, type: i.type, id: i.id, value: i.value,
    visible: i.offsetParent !== null,
  }));
  document.querySelectorAll("button").forEach(b => out.buttons.push({
    type: b.type, text: (b.innerText || "").trim().slice(0, 60),
    id: b.id, name: b.name, visible: b.offsetParent !== null,
  }));
  return out;
});
console.log(JSON.stringify(fields, null, 2));
await browser.close();
