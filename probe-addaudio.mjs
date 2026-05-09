import { chromium } from "playwright-core";
const APP = "https://determined-aardvark-936.convex.cloud";
const auth = await (await fetch(APP + "/api/query", {
  method:"POST", headers:{"Content-Type":"application/json"},
  body:JSON.stringify({path:"distributorAuth:get",args:{distributor:"routenote"},format:"json"})
})).json();
const seen = new Map();
for (const c of JSON.parse(auth.value.cookiesJson)) {
  if (!/routenote\.com$/.test(c.domain || "")) continue;
  if (!seen.has(c.name)) seen.set(c.name, c);
}
const farFuture = Math.floor(Date.now()/1000) + 60*60*24*365;
const cookies = [...seen.values()].map(c => ({
  name: c.name, value: c.value, url: "https://www.routenote.com/",
  expires: farFuture, httpOnly: !!c.httpOnly, secure: true, sameSite: "Lax",
}));

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox","--disable-dev-shm-usage"] });
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  viewport: { width: 1440, height: 900 },
});
await ctx.addCookies(cookies);
const page = await ctx.newPage();
const UPC = "5064011612510";
await page.goto(`https://www.routenote.com/rn/addaudiomp3/form/${UPC}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
console.log("URL:", page.url());
const allInputs = await page.evaluate(() => {
  return [...document.querySelectorAll("input")].map(el => ({
    name: el.name,
    type: el.type,
    visible: el.offsetParent !== null,
    style: el.style.cssText.slice(0, 80),
    id: el.id,
  }));
});
console.log("Total inputs:", allInputs.length);
const fileInputs = allInputs.filter(i => i.type === "file");
console.log("File inputs:", JSON.stringify(fileInputs, null, 2));
const submitInputs = allInputs.filter(i => i.type === "submit");
console.log("Submit inputs:", JSON.stringify(submitInputs, null, 2));
await page.screenshot({ path: "/tmp/addaudio-state.png", fullPage: true });
console.log("screenshot saved");
await browser.close();
