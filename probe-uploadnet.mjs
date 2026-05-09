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

const requests = [];
page.on("request", req => {
  const u = req.url();
  if (u.includes("routenote.com") && req.method() === "POST") {
    requests.push({ url: u, method: req.method(), postData: (req.postData() || "").slice(0, 200) });
  }
});

const UPC = process.argv[2];
const audioPath = process.argv[3] || "/tmp/A_Dying_Art.mp3";

await page.goto(`https://www.routenote.com/rn/addaudiomp3/form/${UPC}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);

// Look at getpath function definition
const getpathSrc = await page.evaluate(() => {
  return typeof getpath === "function" ? getpath.toString().slice(0, 2000) : "undefined";
});
console.log("=== getpath() source ===");
console.log(getpathSrc);

// Make file input visible & enabled
await page.evaluate(() => {
  const inp = document.querySelector('input[type="file"][name="files[Origin]"]');
  if (inp) {
    inp.style.display = "inline-block";
    inp.style.opacity = "1";
    inp.disabled = false;
  }
});

// Set file
console.log("\n=== setInputFiles ===");
const fileInput = page.locator('input[type="file"][name="files[Origin]"]').first();
await fileInput.setInputFiles(audioPath);
await page.waitForTimeout(15000);  // wait for upload

console.log("\n=== POST requests during upload ===");
for (const r of requests) console.log(" ", r.method, r.url, "data:", r.postData.slice(0, 80));

// State after wait
const state = await page.evaluate(() => ({
  tracknio1: document.querySelector('input[name="tracknio1"]')?.value || "",
  uploadName0: document.querySelector('input[name="upload_name0"]')?.value || "",
  uploadFile: document.querySelector('input[name="upload_file"]')?.value || "",
  filePdf0: document.querySelector('input[name="file_pdf_value0"]')?.value || "",
  bodyText: (document.body.innerText || "").slice(0, 600),
}));
console.log("\n=== form state after upload wait ===");
console.log(JSON.stringify(state, null, 2));

await browser.close();
