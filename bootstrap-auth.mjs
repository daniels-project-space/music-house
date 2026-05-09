// Boot a Browserbase session, navigate to RouteNote login, wait up to 15 minutes
// for the user to log in via live view, then capture and save cookies to Convex.
import { chromium } from "playwright-core";

const BB_API_KEY = process.env.BB_API_KEY;
const BB_PROJECT_ID = process.env.BB_PROJECT_ID;
const APP_URL = process.env.APP_URL ?? "https://determined-aardvark-936.convex.cloud";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const r = await fetch("https://api.browserbase.com/v1/sessions", {
  method: "POST",
  headers: { "X-BB-API-Key": BB_API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({
    projectId: BB_PROJECT_ID,
    keepAlive: false,
    browserSettings: { viewport: { width: 1440, height: 900 }, blockAds: true },
  }),
});
const session = await r.json();
const liveView = `https://www.browserbase.com/sessions/${session.id}`;
console.log("LIVE_VIEW=" + liveView);

const browser = await chromium.connectOverCDP(session.connectUrl);
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] ?? (await ctx.newPage());

await page.goto("https://www.routenote.com/rn/login", { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
console.log("AT_LOGIN=" + page.url());

// Poll for ~15 min for the user to log in manually
let authed = false;
for (let i = 0; i < 90; i++) {
  await sleep(10000);
  const url = page.url().toLowerCase();
  if (!url.includes("/login")) {
    authed = true;
    console.log("USER_LOGGED_IN url=" + page.url());
    break;
  }
  console.log(`waiting... ${(i + 1) * 10}s url=${page.url()}`);
}

if (!authed) {
  console.error("TIMEOUT — user did not log in within 15 minutes");
  await browser.close();
  process.exit(2);
}

// Verify auth by hitting create_album
await page.goto("https://www.routenote.com/rn/create_album", { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
if (page.url().toLowerCase().includes("/login")) {
  console.error("Auth check failed — create_album redirected to login");
  await browser.close();
  process.exit(3);
}
console.log("VERIFIED authed at " + page.url());

const cookies = await ctx.cookies();
console.log("CAPTURED " + cookies.length + " cookies");
const save = await fetch(`${APP_URL}/api/mutation`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    path: "distributorAuth:save",
    args: { distributor: "routenote", cookiesJson: JSON.stringify(cookies) },
    format: "json",
  }),
});
console.log("SAVED status=" + save.status);

await browser.close();
console.log("DONE");
