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

// Capture FULL request bodies
const seen_reqs = [];
page.on("request", async req => {
  if (req.url().includes("/rn/cloud_upload") || req.url().includes("/rn/addaudio")) {
    seen_reqs.push({ url: req.url(), method: req.method(), headers: req.headers(), postData: req.postData() || "(none)" });
  }
});
page.on("response", async res => {
  if (res.url().includes("/rn/cloud_upload")) {
    const txt = await res.text().catch(() => "(unreadable)");
    console.log("CLOUD_UPLOAD RESPONSE: status=" + res.status() + " body=" + txt.slice(0, 800));
  }
});

const UPC = process.argv[2];
await page.goto(`https://www.routenote.com/rn/addaudiomp3/form/${UPC}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

await page.evaluate(() => {
  const inp = document.querySelector("input[type=\"file\"][name=\"files[Origin]\"]");
  if (inp) { inp.style.display="block"; inp.style.opacity="1"; inp.disabled=false; }
});

const fileInput = page.locator("input[type=\"file\"][name=\"files[Origin]\"]").first();
await fileInput.setInputFiles(process.argv[3] || "/tmp/A_Dying_Art.mp3");
await page.waitForTimeout(20000);

console.log("\n--- captured requests ---");
for (const r of seen_reqs) {
  console.log(r.method, r.url);
  console.log("  Content-Type:", r.headers["content-type"]);
  console.log("  body (first 400):", (r.postData || "").slice(0, 400));
}
await browser.close();
