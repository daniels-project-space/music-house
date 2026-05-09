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
const UPC = process.argv[2] || "5064011851360";

await page.goto(`https://www.routenote.com/rn/addaudiomp3/form/${UPC}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);

// Look for visible buttons/elements that say "Choose", "Upload", "Browse", "Drag"
const buttons = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll("button, a, label, span, div").forEach(el => {
    const txt = (el.innerText || "").trim();
    if (/choose|upload|browse|drag|drop|select.*file/i.test(txt) && txt.length < 100) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        out.push({ tag: el.tagName, text: txt.slice(0, 80), id: el.id, cls: el.className.slice(0, 60), onClick: el.getAttribute("onclick")?.slice(0, 80) });
      }
    }
  });
  return out.slice(0, 20);
});
console.log("upload-related visible elements:");
for (const b of buttons) console.log(" ", JSON.stringify(b));

// Look for upload-related JS objects/handlers
const widgetInfo = await page.evaluate(() => {
  const out = {};
  // Common upload widgets
  if (window.plupload) out.plupload = "yes";
  if (window.Dropzone) out.dropzone = "yes";
  if (window.Resumable) out.resumable = "yes";
  if (window.tus) out.tus = "yes";
  // Check for jQuery file upload
  if (window.jQuery && window.jQuery.fn.fileupload) out.jqFileUpload = "yes";
  // Look at window keys for anything with "upload"
  out.windowUploadKeys = Object.keys(window).filter(k => /upload/i.test(k)).slice(0, 10);
  return out;
});
console.log("\nupload widget detection:", JSON.stringify(widgetInfo, null, 2));

// Find the upload form's action URL
const formAction = await page.evaluate(() => {
  const form = document.querySelector("form");
  return form ? { action: form.action, method: form.method, id: form.id, enctype: form.enctype } : null;
});
console.log("\nform:", JSON.stringify(formAction));

// Find scripts that handle file input change
const fileInputHandler = await page.evaluate(() => {
  const inp = document.querySelector('input[type="file"][name="files[Origin]"]');
  if (!inp) return "no input";
  return {
    onchange: inp.getAttribute("onchange"),
    onclick: inp.getAttribute("onclick"),
    parentOnclick: inp.parentElement?.getAttribute("onclick"),
    className: inp.className,
    accept: inp.accept,
  };
});
console.log("\nfile input attrs:", JSON.stringify(fileInputHandler, null, 2));

await browser.close();
