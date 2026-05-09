// Capture EVERY network request + response during a real audio upload via Playwright
// to reverse-engineer RouteNote's cloud_upload chunked-upload protocol.
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

const UPC = process.argv[2];
const audioPath = process.argv[3] || "/tmp/A_Dying_Art.mp3";
if (!UPC) { console.error("usage: node trace-upload.mjs <UPC> [audioPath]"); process.exit(1); }

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  viewport: { width: 1440, height: 900 },
});
await ctx.addCookies(cookies);
const page = await ctx.newPage();

const requests = [];
page.on("request", req => {
  const u = req.url();
  if (u.includes("routenote.com") && !u.includes("google") && !u.includes("analytics") && !u.includes("/files/") && !u.includes(".css") && !u.includes(".js") && !u.includes(".png") && !u.includes(".jpg") && !u.includes(".gif") && !u.includes(".svg")) {
    const headers = req.headers();
    requests.push({
      url: u,
      method: req.method(),
      contentType: headers["content-type"],
      bodySize: (req.postData() || "").length,
      bodyPreview: (req.postData() || "").slice(0, 600),
    });
  }
});

const responses = new Map();
page.on("response", async res => {
  const u = res.url();
  if (u.includes("/rn/cloud_upload") || u.includes("/rn/addaudio") || u.includes("/rn/upl")) {
    let body = "";
    try { body = await res.text(); } catch {}
    responses.set(u + "@" + Date.now(), { url: u, status: res.status(), body: body.slice(0, 600) });
  }
});

await page.goto(`https://www.routenote.com/rn/addaudiomp3/form/${UPC}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

console.log("=== before file selection ===");
console.log("Window globals related to upload:");
const fns = await page.evaluate(() => {
  const out = {};
  for (const k of Object.keys(window)) {
    if (/upload|chunk|getpath|cloudupload|filesend|do_send|sendfile/i.test(k)) {
      try { if (typeof window[k] === "function") out[k] = window[k].toString().slice(0, 400); } catch {}
    }
  }
  return out;
});
console.log(JSON.stringify(fns, null, 2));

// Make file input accessible
await page.evaluate(() => {
  document.querySelectorAll('input[type="file"]').forEach(inp => {
    inp.style.display = "block";
    inp.style.opacity = "1";
    inp.disabled = false;
  });
});

const fileInput = page.locator('input[type="file"][name="files[Origin]"]').first();
console.log("\n=== setInputFiles ===");
await fileInput.setInputFiles(audioPath);

// Wait long for upload to definitely complete
console.log("waiting 60s for upload AJAX activity...");
await page.waitForTimeout(60000);

console.log("\n=== captured requests (RouteNote only) ===");
for (const r of requests) {
  console.log(`\n${r.method} ${r.url}`);
  console.log(`  Content-Type: ${r.contentType}`);
  console.log(`  Body size: ${r.bodySize}`);
  if (r.bodySize > 0) console.log(`  Body preview: ${r.bodyPreview.replace(/[^\x20-\x7e]/g, "·")}`);
}

console.log("\n=== captured responses (cloud_upload / addaudio) ===");
for (const [k, r] of responses) {
  console.log(`\n${r.url} → ${r.status}`);
  console.log(`  Body: ${r.body.replace(/[^\x20-\x7e\n]/g, "·")}`);
}

console.log("\n=== form state after upload ===");
const state = await page.evaluate(() => ({
  tracknio1: document.querySelector('input[name="tracknio1"]')?.value || "",
  uploadName0: document.querySelector('input[name="upload_name0"]')?.value || "",
  uploadFile: document.querySelector('input[name="upload_file"]')?.value || "",
  filePdf0: document.querySelector('input[name="file_pdf_value0"]')?.value || "",
  hiddenInputs: [...document.querySelectorAll('input[type="hidden"]')].map(i => ({ n: i.name, v: i.value.slice(0, 60) })).filter(x => x.v),
}));
console.log(JSON.stringify(state, null, 2));

await browser.close();
