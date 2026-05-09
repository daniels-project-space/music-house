// Probe: connects to Browserbase, restores RouteNote cookies if any, otherwise logs in,
// then saves cookies. After auth, navigates to /rn/create_album and dumps form structure.
import { chromium } from "playwright-core";

const BB_API_KEY = process.env.BB_API_KEY;
const BB_PROJECT_ID = process.env.BB_PROJECT_ID;
const USERNAME = process.env.USERNAME;
const PASSWORD = process.env.PASSWORD;
const APP_URL = process.env.APP_URL ?? "https://determined-aardvark-936.convex.cloud";
if (!BB_API_KEY || !BB_PROJECT_ID || !USERNAME || !PASSWORD) {
  console.error("missing env: BB_API_KEY / BB_PROJECT_ID / USERNAME / PASSWORD");
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[probe]", ...a);

async function cx(path, args, mut = false) {
  const r = await fetch(`${APP_URL}/api/${mut ? "mutation" : "query"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
  });
  return (await r.json()).value;
}

async function createSession() {
  const r = await fetch("https://api.browserbase.com/v1/sessions", {
    method: "POST",
    headers: { "X-BB-API-Key": BB_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: BB_PROJECT_ID,
      keepAlive: false,
      browserSettings: { viewport: { width: 1440, height: 900 }, blockAds: true },
    }),
  });
  if (!r.ok) throw new Error(`session create ${r.status}: ${await r.text()}`);
  return r.json();
}

const session = await createSession();
log("session:", session.id, "live:", `https://www.browserbase.com/sessions/${session.id}`);

const browser = await chromium.connectOverCDP(session.connectUrl);
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] ?? (await ctx.newPage());

try {
  // 1. Try restoring cookies first
  const saved = await cx("distributorAuth:get", { distributor: "routenote" });
  if (saved && saved.cookiesJson) {
    log("restoring saved cookies (saved at", new Date(saved.savedAt).toISOString(), ")");
    const cookies = JSON.parse(saved.cookiesJson);
    await ctx.addCookies(cookies);
  } else {
    log("no saved cookies");
  }

  // 2. Probe authenticated state by visiting the auth-required create page
  await page.goto("https://www.routenote.com/rn/create_album", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  let authenticated = !page.url().toLowerCase().includes("/login");
  log("after cookie restore — authenticated?", authenticated, "url=", page.url());

  // 3. If not authenticated, do programmatic login
  if (!authenticated) {
    log("attempting fresh login");
    await page.goto("https://www.routenote.com/rn/login", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await sleep(1500);
    await page.locator('#user-login input[name="name"]').first().fill(USERNAME);
    await page.locator('#user-login input[name="pass"]').first().fill(PASSWORD);
    await page.locator("#in_signin_button").first().click();
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      if (!page.url().toLowerCase().includes("/login")) break;
    }
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    authenticated = !page.url().toLowerCase().includes("/login");
    log("login attempt — authenticated?", authenticated, "url=", page.url());

    if (!authenticated) {
      log("FAIL: login blocked (likely captcha). Open live view and log in manually:");
      log(`  https://www.browserbase.com/sessions/${session.id}`);
      log("Once you're on /rn/users/<your-name>, this script will save cookies on next run.");
      // Wait up to 5 min for the user to log in manually
      for (let i = 0; i < 30; i++) {
        await sleep(10000);
        if (!page.url().toLowerCase().includes("/login")) {
          authenticated = true;
          log("user finished manual login");
          break;
        }
        log(`  still waiting... [${i * 10}s]`);
      }
    }
  }

  if (!authenticated) {
    throw new Error("not authenticated after login attempts");
  }

  // 4. Save cookies
  const cookies = await ctx.cookies();
  log("captured", cookies.length, "cookies");
  await cx("distributorAuth:save", { distributor: "routenote", cookiesJson: JSON.stringify(cookies) }, true);
  log("cookies saved to Convex");

  // 5. Navigate to create_album and inspect
  await page.goto("https://www.routenote.com/rn/create_album", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await sleep(2500);
  log("create page url:", page.url());
  if (page.url().toLowerCase().includes("/login")) {
    log("WARN: create_album redirected to login — auth cookie didn't stick");
  }

  const everything = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("input, textarea, select")).map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.type || "",
      name: el.name || "",
      id: el.id || "",
      placeholder: el.placeholder || "",
      visible: el.offsetParent !== null,
      label: (el.labels && el.labels[0] ? el.labels[0].innerText : "").trim().slice(0, 60),
    }));
    const buttons = Array.from(document.querySelectorAll("button, input[type=submit], input[type=button]")).map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.type || "",
      name: el.name || "",
      id: el.id || "",
      text: (el.innerText || el.value || "").trim().slice(0, 60),
      visible: el.offsetParent !== null,
    }));
    const headings = Array.from(document.querySelectorAll("h1, h2, h3, label, legend")).map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || "").trim().slice(0, 100),
      visible: el.offsetParent !== null,
    })).filter((h) => h.visible && h.text);
    return { all, buttons, headings };
  });
  console.log("\nALL INPUTS (incl hidden) on /rn/create_album:");
  for (const el of everything.all) {
    console.log(`  ${el.tag}[type=${el.type}] name=${el.name} id=${el.id} vis=${el.visible} placeholder="${el.placeholder}" label="${el.label}"`);
  }
  console.log("\nBUTTONS (visible):");
  for (const b of everything.buttons) {
    if (!b.visible) continue;
    console.log(`  ${b.tag}[type=${b.type}] name=${b.name} id=${b.id} text="${b.text}"`);
  }
  console.log("\nHEADINGS / LABELS (top 30):");
  for (const h of everything.headings.slice(0, 30)) {
    console.log(`  ${h.tag}: ${h.text}`);
  }

  // Try filling release date first (today + 21 days, RouteNote typically wants future date)
  const futureDate = new Date(Date.now() + 21 * 86400 * 1000);
  const dateStr = futureDate.toISOString().slice(0, 10); // YYYY-MM-DD
  // Try multiple date formats
  log("filling release date " + dateStr);
  try {
    await page.locator("#edit_album_info_release").fill(dateStr);
  } catch (e) {
    log("date fill failed:", e.message);
  }
  await sleep(500);

  // Click Create Release and inspect step 2
  log("clicking Create Release");
  await page.locator("#edit-album-save-image").click();
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    if (page.url() !== "https://www.routenote.com/rn/create_album") break;
  }
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await sleep(2000);
  log("after Create Release url:", page.url());

  const step2 = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("input, textarea, select")).map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.type || "",
      name: el.name || "",
      id: el.id || "",
      placeholder: el.placeholder || "",
      visible: el.offsetParent !== null,
      label: (el.labels && el.labels[0] ? el.labels[0].innerText : "").trim().slice(0, 60),
    }));
    const buttons = Array.from(document.querySelectorAll("button, input[type=submit], input[type=button]")).map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.type || "",
      name: el.name || "",
      id: el.id || "",
      text: (el.innerText || el.value || "").trim().slice(0, 60),
      visible: el.offsetParent !== null,
    }));
    const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, label, legend, [class*='step'], [class*='heading']")).map((el) => ({
      tag: el.tagName.toLowerCase(),
      cls: (el.className || "").slice(0, 40),
      text: (el.innerText || "").trim().slice(0, 100),
      visible: el.offsetParent !== null,
    })).filter((h) => h.visible && h.text);
    const errors = Array.from(document.querySelectorAll(".messages, .error, [role=alert], .form-error, .messages--error")).map((el) => (el.innerText || "").trim().slice(0, 200)).filter(Boolean);
    return { all, buttons, headings, errors };
  });
  console.log("\nSTEP 2 VISIBLE INPUTS:");
  for (const el of step2.all) {
    if (!el.visible) continue;
    console.log(`  ${el.tag}[type=${el.type}] name=${el.name} id=${el.id} placeholder="${el.placeholder}" label="${el.label}"`);
  }
  console.log("\nSTEP 2 BUTTONS (visible, top 20):");
  for (const b of step2.buttons.filter((x) => x.visible).slice(0, 20)) {
    console.log(`  ${b.tag}[type=${b.type}] name=${b.name} id=${b.id} text="${b.text}"`);
  }
  console.log("\nSTEP 2 HEADINGS:");
  for (const h of step2.headings.slice(0, 25)) {
    console.log(`  ${h.tag}.${h.cls}: ${h.text}`);
  }
  if (step2.errors.length) {
    console.log("\nERRORS:");
    for (const e of step2.errors.slice(0, 5)) console.log(`  ${e}`);
  }

  // Capture all visible text content + any modal/dialog text
  const visibleText = await page.evaluate(() => {
    const pieces = [];
    function walk(node) {
      if (!node) return;
      if (node.nodeType === 3) {
        const t = (node.textContent || "").trim();
        if (t) pieces.push(t);
        return;
      }
      if (node.nodeType !== 1) return;
      const el = node;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || el.offsetParent === null) {
        // include modals which may use position:fixed without offsetParent
        if (style.position !== "fixed" && style.position !== "absolute") return;
      }
      for (const c of el.childNodes) walk(c);
    }
    walk(document.body);
    // dedupe
    const seen = new Set();
    return pieces.filter((t) => { if (seen.has(t)) return false; seen.add(t); return true; }).slice(0, 80);
  });
  console.log("\nVISIBLE TEXT (top 80 unique pieces):");
  for (const t of visibleText) console.log(`  | ${t.slice(0, 120)}`);

  // Detect any visible modal/dialog
  const visibleModal = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('[id^="unrec"], [id^="Invalid"], [id^="Comp_"], [class*="modal"], [class*="dialog"], [role="dialog"]'));
    const visible = candidates.filter((el) => el.offsetParent !== null && (el.innerText || "").trim());
    return visible.map((el) => ({
      id: el.id, classes: (el.className || "").slice(0, 60),
      text: (el.innerText || "").trim().slice(0, 300),
    }));
  });
  if (visibleModal.length) {
    console.log("\nVISIBLE MODALS:");
    for (const m of visibleModal) console.log(`  #${m.id} cls="${m.classes}": ${m.text}`);
  } else {
    console.log("\n(no visible modals)");
  }

  // Inspect onclick handlers for each tab button (they probably navigate to distinct URLs)
  const tabHandlers = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("input[type='button'], button"));
    return buttons
      .filter((b) => b.offsetParent !== null && /Album Details|Add Audio|Add Artwork|Manage Stores|Add Localisations/.test(b.value || b.innerText || ""))
      .map((b) => ({
        text: (b.value || b.innerText || "").trim(),
        onclick: b.getAttribute("onclick") || "",
        id: b.id, name: b.name, classes: (b.className || "").slice(0, 60),
        href: b.tagName === "A" ? b.href : "",
      }));
  });
  console.log("\nTAB HANDLERS:");
  for (const t of tabHandlers) {
    console.log(`  "${t.text}" id=${t.id} name=${t.name} onclick="${t.onclick.slice(0, 200)}" href=${t.href}`);
  }

  // Click each tab and dump its form
  const tabs = ["Album Details", "Add Audio", "Add Artwork", "Manage Stores"];
  for (const tab of tabs) {
    log("clicking tab:", tab);
    const tabBtn = page.locator(`input[type="button"][value="${tab}"], button:has-text("${tab}")`).first();
    try {
      await tabBtn.click();
      await sleep(2000);
    } catch (e) {
      log("tab click failed:", e.message);
      continue;
    }
    const tabData = await page.evaluate(() => ({
      url: location.href,
      visibleInputs: Array.from(document.querySelectorAll("input, textarea, select")).filter((el) => el.offsetParent !== null).map((el) => ({
        tag: el.tagName.toLowerCase(), type: el.type || "",
        name: el.name || "", id: el.id || "",
        placeholder: el.placeholder || "",
        label: (el.labels && el.labels[0] ? el.labels[0].innerText : "").trim().slice(0, 50),
      })),
      visibleCheckboxLabels: Array.from(document.querySelectorAll("label")).filter((el) => el.offsetParent !== null).map((el) => ({
        text: (el.innerText || "").trim().slice(0, 60),
        forId: el.htmlFor || "",
      })).filter((l) => l.text).slice(0, 30),
    }));
    console.log(`\n=== TAB: ${tab} ===`);
    console.log(`url: ${tabData.url}`);
    console.log("inputs:");
    for (const i of tabData.visibleInputs.slice(0, 30)) {
      console.log(`  ${i.tag}[type=${i.type}] name=${i.name} id=${i.id} placeholder="${i.placeholder}" label="${i.label}"`);
    }
    console.log("labels:");
    for (const l of tabData.visibleCheckboxLabels.slice(0, 20)) {
      console.log(`  for=${l.forId} text="${l.text}"`);
    }
  }
} catch (e) {
  console.error("ERR:", e.message);
} finally {
  await browser.close();
}
