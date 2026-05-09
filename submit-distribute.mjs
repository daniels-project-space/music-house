// Playwright-driven RouteNote final submit:
// 1. Fix trackmetadata (set title via real input — JS-side validation registers the track)
// 2. Tick T&C, click Distribute Free, confirm modal
// Saves cookies back to Convex on success.
import { chromium } from "playwright-core";

const UPC = process.argv[2];
const TITLE = process.argv[3] || "A Dying Art";
const ARTIST = process.argv[4] || "The Dollcat Club";
if (!UPC) { console.error("usage: node submit-distribute.mjs <UPC> [title] [artist]"); process.exit(1); }

const APP = "https://determined-aardvark-936.convex.cloud";
const auth = await (await fetch(APP + "/api/query", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ path: "distributorAuth:get", args: { distributor: "routenote" }, format: "json" }),
})).json();
if (!auth?.value?.cookiesJson) { console.error("no cookies"); process.exit(2); }

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  viewport: { width: 1440, height: 900 },
});

// Cookie loading: dedupe + url-scope so Playwright keeps the Drupal session.
const seen = new Map();
for (const c of JSON.parse(auth.value.cookiesJson)) {
  if (!/routenote\.com$/.test(c.domain || "")) continue;
  if (!seen.has(c.name)) seen.set(c.name, c);
}
const farFuture = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
const cleanCookies = [...seen.values()].map(c => ({
  name: c.name,
  value: c.value,
  url: "https://www.routenote.com/",
  expires: farFuture,
  httpOnly: !!c.httpOnly,
  secure: true,
  sameSite: "Lax",
}));
await ctx.addCookies(cleanCookies);

const page = await ctx.newPage();
page.on("dialog", d => d.accept().catch(() => {}));

// === STEP 0: Re-upload audio via Playwright UI (curl upload doesn't register the track row) ===
const audioPath = process.argv[5] || "/tmp/A_Dying_Art.mp3";
const audioFormUrl = `https://www.routenote.com/rn/addaudiomp3/form/${UPC}`;
console.log("[0] re-upload audio via UI", audioFormUrl);
await page.goto(audioFormUrl, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
if (page.url().toLowerCase().includes("/login")) { console.error("auth lost"); await browser.close(); process.exit(3); }
const fileInput = page.locator('input[type="file"][name="files[audio]"]').first();
const fileCount = await fileInput.count();
console.log("  file inputs:", fileCount);
if (fileCount > 0) {
  try {
    await fileInput.setInputFiles(audioPath);
    console.log("  file selected:", audioPath);
    await page.waitForTimeout(2000);
    // Submit the audio form
    const audioSave = page.locator('input[type="submit"], input[name="op"]').first();
    if (await audioSave.count() > 0) {
      await Promise.all([
        page.waitForLoadState("domcontentloaded").catch(() => {}),
        audioSave.click({ force: true }),
      ]);
      await page.waitForTimeout(8000);
      console.log("  landed on:", page.url());
    }
  } catch (e) {
    console.log("  audio upload skipped:", e.message);
  }
} else {
  console.log("  no file input — audio likely already saved");
}

// === STEP 1: Fix trackmetadata via UI ===
const tmUrl = `https://www.routenote.com/rn/trackmetadata/form/${UPC}`;
console.log("[1] goto trackmetadata", tmUrl);
await page.goto(tmUrl, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
if (page.url().toLowerCase().includes("/login")) { console.error("auth lost on tmeta page"); await browser.close(); process.exit(3); }

// Fill the track title text input
const titleInput = page.locator('input[name="audio_tags0[title]"]').first();
const tCount = await titleInput.count();
console.log("  title input count:", tCount);
if (tCount > 0) {
  await titleInput.fill("");
  await titleInput.fill(TITLE);
  console.log("  title set to", TITLE);
}

// Artist field is readonly when set — RouteNote's UI requires you to use the
// "Change" link to actually pick a different artist. Skip if already populated correctly.
const artistInput = page.locator('input[name="audio_tags0[artist]"]').first();
if (await artistInput.count() > 0) {
  const isReadonly = await artistInput.evaluate((el) => el.hasAttribute("readonly"));
  const currentVal = await artistInput.inputValue();
  console.log("  artist input readonly?", isReadonly, "current value:", JSON.stringify(currentVal));
  if (!isReadonly) {
    await artistInput.fill("");
    await artistInput.fill(ARTIST);
    await artistInput.press("Tab");
    await page.waitForTimeout(500);
  }
}

// Set language to English explicitly
const langSelect = page.locator('select[name="edit_album_info_language0"]').first();
if (await langSelect.count() > 0) {
  await langSelect.selectOption({ label: "English" }).catch(() => langSelect.selectOption("English"));
  console.log("  language set to English");
}

// Click "Save and Continue" — try every plausible submit button
console.log("[2] click Save and Continue on trackmetadata");
const saveBtns = await page.locator('input[type="submit"], button[type="submit"]').all();
console.log("  submit buttons on form:", saveBtns.length);
for (const b of saveBtns) {
  const v = await b.evaluate(el => el.value || el.textContent || el.id);
  console.log("    button:", JSON.stringify(v));
}
const saveBtn = page.locator('input[type="submit"][value*="Save" i], input[name="op"][value*="Save" i]').first();
const sbCount = await saveBtn.count();
console.log("  matching save buttons:", sbCount);
if (sbCount > 0) {
  // Read its onclick attribute first
  const onClick = await saveBtn.evaluate(el => el.getAttribute("onclick") || "");
  console.log("  onclick:", onClick.slice(0, 200));
  try {
    await Promise.race([
      page.waitForNavigation({ timeout: 15000 }).catch(() => null),
      Promise.all([saveBtn.click({ force: true }), page.waitForTimeout(15000)]),
    ]);
  } catch {}
  console.log("  landed on:", page.url());
} else {
  console.log("  no matching save button found");
}

// === STEP 2: confirm_upload "I'm Finished" if shown ===
if (page.url().includes("confirm_upload")) {
  console.log("[3] click I'm Finished on confirm_upload");
  const finBtn = page.locator('input[type="submit"][value*="Finished" i], input[name="op"][value*="Finished" i]').first();
  if (await finBtn.count() > 0) {
    await Promise.all([page.waitForLoadState("domcontentloaded"), finBtn.click({ force: true })]);
    await page.waitForTimeout(3000);
    console.log("  landed on:", page.url());
  }
}

// === STEP 3: edit_album page → tick T&C + click Distribute Free ===
const albumUrl = `https://www.routenote.com/rn/edit_album/${UPC}`;
console.log("[4] goto edit_album", albumUrl);
await page.goto(albumUrl, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

// Probe trackcount JS var
const trackCountVal = await page.evaluate(() => {
  // try to read inline-script-defined var
  const scripts = [...document.querySelectorAll("script")].map(s => s.textContent || "").join("\n");
  const m = scripts.match(/var\s+trackcount\s*=\s*"?(\d+)"?/);
  return m ? m[1] : "?";
});
console.log("  trackcount var on page:", trackCountVal);

console.log("[5] tick T&C checkbox");
await page.locator("#submit_chk").check({ force: true });
await page.waitForTimeout(500);

console.log("[6] click Distribute Free");
await page.locator(".dislinkfree, input[value='Distribute Free']").first().click({ force: true });
await page.waitForTimeout(2500);

// What modal showed up?
const modalState = await page.evaluate(() => {
  const out = [];
  const all = document.querySelectorAll("[id*='valid'], [id*='terms'], [id*='lcrole'], [id*='artrole'], [id*='dt_validation'], [id*='orgrlsdat']");
  all.forEach(el => {
    if (getComputedStyle(el).display !== "none" && el.offsetParent !== null) {
      out.push({ id: el.id, text: (el.innerText || "").trim().slice(0, 200) });
    }
  });
  return out;
});
console.log("  visible modals:", JSON.stringify(modalState, null, 2));

// If agree_terms is showing → click rn_btn_ok to submit for real
const agreeOpen = modalState.some(m => m.id === "agree_terms");
if (agreeOpen) {
  console.log("[7] agree_terms open — clicking Complete Release (rn_btn_ok)");
  await Promise.all([
    page.waitForLoadState("domcontentloaded").catch(() => {}),
    page.locator("#rn_btn_ok").click({ force: true }),
  ]);
  await page.waitForTimeout(8000);
  console.log("  final URL:", page.url());
} else {
  console.log("[7] agree_terms NOT open — validation likely blocked submit");
  // Print first validation modal text so we know what's wrong
  const errModal = modalState.find(m => /artist|valid|role/i.test(m.text));
  if (errModal) console.log("  validation says:", errModal.text);
}

// Save cookies back
const cookies = await ctx.cookies();
await fetch(APP + "/api/mutation", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ path: "distributorAuth:save", args: { distributor: "routenote", cookiesJson: JSON.stringify(cookies) }, format: "json" }),
});

console.log("\n✓ session ended — final URL:", page.url());
console.log("Live: https://www.routenote.com/rn/edit_album/" + UPC);

await browser.close();
