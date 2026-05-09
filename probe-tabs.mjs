// Probe remaining tabs directly using an existing UPC
import { chromium } from "playwright-core";

const BB_API_KEY = process.env.BB_API_KEY;
const BB_PROJECT_ID = process.env.BB_PROJECT_ID;
const APP_URL = "https://determined-aardvark-936.convex.cloud";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const r = await fetch("https://api.browserbase.com/v1/sessions", {
  method: "POST",
  headers: { "X-BB-API-Key": BB_API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ projectId: BB_PROJECT_ID, keepAlive: false, browserSettings: { viewport: { width: 1440, height: 900 }, blockAds: true } }),
});
const session = await r.json();
console.log("session:", session.id, "https://www.browserbase.com/sessions/" + session.id);
const browser = await chromium.connectOverCDP(session.connectUrl);
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] ?? (await ctx.newPage());

try {
  // restore cookies
  const saved = await fetch(`${APP_URL}/api/query`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "distributorAuth:get", args: { distributor: "routenote" }, format: "json" }),
  }).then(r => r.json()).then(j => j.value);
  if (saved?.cookiesJson) await ctx.addCookies(JSON.parse(saved.cookiesJson));

  // Need an existing UPC — create one first
  await page.goto("https://www.routenote.com/rn/create_album", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const futureDate = new Date(Date.now() + 21 * 86400 * 1000).toISOString().slice(0, 10);
  await page.locator("#edit_album_info_release").fill(futureDate);
  await sleep(500);
  await page.locator("#edit-album-save-image").click();
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    if (page.url().includes("/edit_album/")) break;
  }
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const upc = page.url().split("/").pop();
  console.log("created release UPC:", upc);

  async function dumpTab(label, url) {
    console.log(`\n=== ${label} :: ${url} ===`);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await sleep(2500);
    const data = await page.evaluate(() => ({
      url: location.href,
      inputs: Array.from(document.querySelectorAll("input, textarea, select")).filter((el) => el.offsetParent !== null).map((el) => ({
        tag: el.tagName.toLowerCase(), type: el.type || "",
        name: el.name || "", id: el.id || "", placeholder: el.placeholder || "",
      })).slice(0, 50),
      buttons: Array.from(document.querySelectorAll("button, input[type=submit], input[type=button]")).filter((el) => el.offsetParent !== null).map((el) => ({
        tag: el.tagName.toLowerCase(), type: el.type || "",
        name: el.name || "", id: el.id || "",
        text: (el.innerText || el.value || "").trim().slice(0, 40),
        onclick: (el.getAttribute("onclick") || "").slice(0, 120),
      })).slice(0, 30),
      headings: Array.from(document.querySelectorAll("h1, h2, h3, label, legend")).filter((el) => el.offsetParent !== null && (el.innerText || "").trim()).map((el) => `${el.tagName.toLowerCase()}: ${(el.innerText || "").trim().slice(0, 80)}`).slice(0, 25),
    }));
    console.log("url:", data.url);
    console.log("inputs:");
    for (const i of data.inputs) console.log(`  ${i.tag}[type=${i.type}] name=${i.name} id=${i.id} placeholder="${i.placeholder}"`);
    console.log("buttons:");
    for (const b of data.buttons) console.log(`  ${b.tag}[type=${b.type}] id=${b.id} text="${b.text}" onclick="${b.onclick}"`);
    console.log("labels:");
    for (const h of data.headings) console.log(`  ${h}`);
  }

  await dumpTab("Add Audio", `https://www.routenote.com/rn/addaudiomp3/form/${upc}`);
  await dumpTab("Add Artwork", `https://www.routenote.com/rn/addart/form/${upc}`);
  await dumpTab("Manage Stores", `https://www.routenote.com/rn/addstore/form/${upc}`);
} catch (e) {
  console.error("ERR:", e.message, e.stack);
} finally {
  await browser.close();
}
