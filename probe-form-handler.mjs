// Find what handles form submit on the addaudiomp3 page (jquery.form.ajaxSubmit?)
import { chromium } from "playwright-core";
const APP = "https://determined-aardvark-936.convex.cloud";
const auth = await (await fetch(APP + "/api/query", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ path: "distributorAuth:get", args: { distributor: "routenote" }, format: "json" }),
})).json();
const seen = new Map();
for (const c of JSON.parse(auth.value.cookiesJson)) {
  if (!/routenote\.com$/.test(c.domain || "")) continue;
  if (!seen.has(c.name)) seen.set(c.name, c);
}
const farFuture = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
const cookies = [...seen.values()].map(c => ({
  name: c.name, value: c.value, url: "https://www.routenote.com/",
  expires: farFuture, httpOnly: !!c.httpOnly, secure: true, sameSite: "Lax",
}));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  viewport: { width: 1440, height: 900 },
});
await ctx.addCookies(cookies);
const page = await ctx.newPage();

const allReqs = [];
page.on("request", req => {
  const u = req.url();
  if (u.includes("routenote.com") && req.method() === "POST" && !u.includes("google") && !u.includes("analytics")) {
    allReqs.push({
      url: u,
      method: req.method(),
      ct: req.headers()["content-type"] || "",
      bodySize: (req.postData() || "").length,
      bodyPreview: (req.postData() || "").slice(0, 600).replace(/[^\x20-\x7e]/g, "·"),
    });
  }
});

const UPC = process.argv[2] || "5064011213885";
const audioPath = process.argv[3] || "/tmp/A_Dying_Art.mp3";

await page.goto(`https://www.routenote.com/rn/addaudiomp3/form/${UPC}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

// Inspect the form and how it submits
const formInfo = await page.evaluate(() => {
  const form = document.getElementById("addmp3-form");
  if (!form) return { found: false };
  return {
    found: true,
    enctype: form.enctype,
    action: form.action,
    method: form.method,
    onsubmit: form.getAttribute("onsubmit"),
    submitButtonId: document.getElementById("edit-submit")?.id,
    submitOnclick: document.getElementById("edit-submit")?.getAttribute("onclick"),
    // Check if jQuery form plugin is bound
    jqFormBound: typeof window.jQuery === "function" && jQuery._data ? "yes" : "?",
  };
});
console.log("form info:", JSON.stringify(formInfo, null, 2));

// Look for subfunc() function definition (the onclick on submit button calls "return subfunc();")
const subfunc = await page.evaluate(() => {
  return typeof subfunc === "function" ? subfunc.toString() : "(not found)";
});
console.log("\n=== subfunc() ===");
console.log(subfunc.slice(0, 6000));

await browser.close();
