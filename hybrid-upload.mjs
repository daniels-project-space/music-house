// HYBRID RouteNote upload: curl for form-handler endpoints + Playwright for audio
// upload (must trigger subfunc() to register track row) and the final Distribute Free click.
import { chromium } from "playwright-core";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execP = promisify(execFile);

const TRACK_ID = process.argv[2] || "js7d0zwgzzhzx7dkek1nvmen7n85y69v";
const ARTIST_OVERRIDE = process.argv[3] || null;  // optional: override artist label-cased name

const APP = "https://music-house-nine.vercel.app";
const CX = "https://determined-aardvark-936.convex.cloud";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// === Convex helpers ===
const cx = async (kind, path, args) =>
  (await (await fetch(`${CX}/api/${kind}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
  })).json()).value;
const cxQuery = (path, args) => cx("query", path, args);
const cxMut = (path, args) => cx("mutation", path, args);

// === Cookie helpers ===
const dedupeCookies = (raw) => {
  const seen = new Map();
  for (const c of raw) {
    if (!/routenote\.com$/.test(c.domain || "")) continue;
    if (!seen.has(c.name)) seen.set(c.name, c);
  }
  return [...seen.values()];
};
const cookieHeader = (jar) => jar.map((c) => `${c.name}=${c.value}`).join("; ");
const playwrightCookies = (jar) => {
  const farFuture = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  return jar.map((c) => ({
    name: c.name,
    value: c.value,
    url: "https://www.routenote.com/",
    expires: farFuture,
    httpOnly: !!c.httpOnly,
    secure: true,
    sameSite: "Lax",
  }));
};

// === curl helpers ===
const parseCurl = (raw) => {
  const blocks = raw.split(/(?=^HTTP\/[12](?:\.\d)?\s)/m).filter((b) => /^HTTP\/[12]/.test(b));
  const last = blocks[blocks.length - 1] || raw;
  const sepIdx = last.indexOf("\r\n\r\n") >= 0 ? last.indexOf("\r\n\r\n") : last.indexOf("\n\n");
  const sepLen = last.indexOf("\r\n\r\n") >= 0 ? 4 : 2;
  const head = last.slice(0, sepIdx);
  const body = last.slice(sepIdx + sepLen);
  const status = parseInt((head.match(/^HTTP\/[\d.]+\s+(\d+)/) || [])[1] || "0", 10);
  const location = (head.match(/^location:\s*(.+)$/im) || [])[1]?.trim() || null;
  return { status, location, body, head };
};

const curlGet = async (cookieStr, url) => {
  const args = ["-sS", "-i", "-A", UA, url, "-H", `Cookie: ${cookieStr}`];
  const { stdout } = await execP("curl", args, { maxBuffer: 200 * 1024 * 1024 });
  return parseCurl(stdout);
};
const curlPost = async (cookieStr, url, fields, referer) => {
  const args = ["-sS", "-i", "-X", "POST", "-A", UA, url,
    "-H", `Cookie: ${cookieStr}`, "-H", "Origin: https://www.routenote.com",
    "-e", referer || url];
  for (const [k, v] of Object.entries(fields)) args.push("--data-urlencode", `${k}=${v}`);
  const { stdout } = await execP("curl", args, { maxBuffer: 200 * 1024 * 1024 });
  return parseCurl(stdout);
};
const curlMultipart = async (cookieStr, url, fields, files, referer) => {
  const args = ["-sS", "-i", "-X", "POST", "-A", UA, url,
    "-H", `Cookie: ${cookieStr}`, "-H", "Origin: https://www.routenote.com",
    "-e", referer || url];
  for (const f of files) args.push("-F", `${f.field}=@${f.path};type=${f.contentType};filename=${f.filename}`);
  for (const [k, v] of Object.entries(fields)) args.push("-F", `${k}=${v}`);
  const { stdout } = await execP("curl", args, { maxBuffer: 200 * 1024 * 1024 });
  return parseCurl(stdout);
};

// === scrape helpers ===
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const scrapeHidden = (html, name) => {
  const safe = escapeRe(name);
  const m1 = html.match(new RegExp(`<input[^>]*name=["']${safe}["'][^>]*value=["']([^"']*)["']`, "i"));
  if (m1) return m1[1];
  const m2 = html.match(new RegExp(`<input[^>]*value=["']([^"']*)["'][^>]*name=["']${safe}["']`, "i"));
  return m2 ? m2[1] : null;
};
const findUpc = (loc, body) => {
  const m = (loc || "").match(/\/edit_album\/(\d{8,16})/);
  if (m) return m[1];
  const m2 = body.match(/\/edit_album\/(\d{8,16})/);
  return m2 ? m2[1] : null;
};
const findFormErrors = (html) => {
  const errs = [];
  const block = html.match(/class=["']messages[^"']*error[^"']*["'][^>]*>([\s\S]{0,2000}?)<\/div>/i);
  if (block) errs.push(block[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240));
  return errs.filter(Boolean);
};
const futureDate = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const pickGenre = (g) => {
  const map = { cinematic: "Classical", "film score": "Classical", folk: "Folk", electronic: "Electronic", rock: "Rock", pop: "Pop", "hip-hop": "Hip Hop", "hip hop": "Hip Hop", jazz: "Jazz", country: "Country", classical: "Classical", "r&b": "R&B/Soul", soul: "R&B/Soul", reggae: "Reggae", latin: "Latin", metal: "Metal", blues: "Blues", indie: "Indie", alternative: "Alternative", dance: "Dance" };
  return (g && map[g.toLowerCase()]) || "Other";
};

// === main ===
console.log("[1/11] resolve track:", TRACK_ID);
const track = await cxQuery("tracks:get", { id: TRACK_ID });
if (!track) throw new Error("track not found");
const artistName = ARTIST_OVERRIDE || track.artistSlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
console.log(" →", track.title, "by", artistName);

let coverKey = track.coverKey;
if (!coverKey && track.albumSlug) {
  const a = await cxQuery("albums:getOne", { artistSlug: track.artistSlug, slug: track.albumSlug });
  coverKey = a?.coverKey;
}

console.log("[2/11] download audio + cover from R2 via Vercel proxy");
const presign = async (key) => (await (await fetch(`${APP}/api/audio?key=${encodeURIComponent(key)}`)).json()).url;
const dl = async (url) => Buffer.from(await (await fetch(url)).arrayBuffer());
const audioBuf = await dl(await presign(track.audioKey));
const coverBuf = coverKey ? await dl(await presign(coverKey)) : null;
console.log(" audio:", audioBuf.length, "B | cover:", coverBuf?.length || 0, "B");

const work = await mkdtemp(join(tmpdir(), "rn-"));
const audioExt = track.audioKey.endsWith(".flac") ? ".flac" : ".mp3";
const audioPath = join(work, `${track.title.replace(/[^a-zA-Z0-9-_ ]/g, "_")}${audioExt}`);
await writeFile(audioPath, audioBuf);
const coverPath = coverBuf ? join(work, "cover.jpg") : null;
if (coverPath) await writeFile(coverPath, coverBuf);

console.log("[3/11] load saved RouteNote cookies");
const auth = await cxQuery("distributorAuth:get", { distributor: "routenote" });
if (!auth?.cookiesJson) throw new Error("no cookies — bootstrap auth first");
const jar = dedupeCookies(JSON.parse(auth.cookiesJson));
const COOKIE = cookieHeader(jar);

const releaseDate = futureDate(21);

console.log("[4/11] CURL: create release");
const cm = await curlGet(COOKIE, "https://www.routenote.com/rn/create_album");
if (!cm.body.includes('id="create-album-form"')) throw new Error("create_album form missing — auth expired?");
const cr = await curlPost(COOKIE, "https://www.routenote.com/rn/create_album", {
  edit_album_info_upc: "",
  edit_album_info_release: releaseDate,
  tersawsas: scrapeHidden(cm.body, "tersawsas") ?? "true",
  form_id: scrapeHidden(cm.body, "form_id") || "create_album_form",
  form_build_id: scrapeHidden(cm.body, "form_build_id") || "",
  form_token: scrapeHidden(cm.body, "form_token") || "",
  album_save: "Create Release",
}, "https://www.routenote.com/rn/create_album");
const upc = findUpc(cr.location, cr.body);
if (!upc) {
  console.error(" FAIL: no UPC. status=" + cr.status + " errors=", findFormErrors(cr.body));
  process.exit(1);
}
console.log(" ✓ UPC:", upc);

console.log("[5/11] CURL: album metadata");
const editUrl = `https://www.routenote.com/rn/editalbum/${upc}`;
const em = await curlGet(COOKIE, editUrl);
const yr = String(new Date().getFullYear());
const firstName = artistName.split(" ")[0] || artistName;
const lastName = artistName.split(" ").slice(1).join(" ") || "Artist";
const albumFields = {
  edit_album_info_language: "English",
  edit_album_info_title: track.title,
  edit_album_info_artist: artistName,
  edit_album_info_genre: pickGenre(track.genre),
  edit_album_info_label: artistName,
  cpy_year: yr, cpy_name: artistName,
  edit_album_info_pcopyyear: yr, edit_album_info_pcopyname: artistName,
  edit_album_first_composer: firstName,
  edit_album_last_composer: lastName,
  edit_album_first_contributor: artistName,
  edit_album_info_release: releaseDate,
  edit_album_info_org_date: releaseDate,
  No: "1", No1: "1", No3: "1",
  form_id: scrapeHidden(em.body, "form_id") || "editalbum_form",
  form_build_id: scrapeHidden(em.body, "form_build_id") || "",
  form_token: scrapeHidden(em.body, "form_token") || "",
  album_save: "Save and Continue",
};
const tersaEdit = scrapeHidden(em.body, "tersawsas");
if (tersaEdit !== null) albumFields.tersawsas = tersaEdit;
const ar = await curlPost(COOKIE, editUrl, albumFields, editUrl);
console.log(" status:", ar.status, "loc:", ar.location);

// === STEP 6: PLAYWRIGHT — audio upload (registers track row via subfunc()) ===
console.log("[6/11] PLAYWRIGHT: audio upload via UI (creates track row)");
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const ctx = await browser.newContext({
  userAgent: UA,
  viewport: { width: 1440, height: 900 },
});
await ctx.addCookies(playwrightCookies(jar));
const page = await ctx.newPage();
page.on("dialog", d => d.accept().catch(() => {}));

const audioUrl = `https://www.routenote.com/rn/addaudiomp3/form/${upc}`;
console.log(" → goto", audioUrl);
await page.goto(audioUrl, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
if (page.url().toLowerCase().includes("/login")) {
  console.error("auth lost in Playwright"); await browser.close(); process.exit(2);
}
// The form's file inputs (files[Origin]) are display:none. Their onchange="getpath(...)"
// triggers an AJAX upload. We need setInputFiles to fire the change event so getpath runs.
const fileInput = page.locator('input[type="file"][name="files[Origin]"]').first();
const fileInputCount = await fileInput.count();
console.log(" file inputs (files[Origin]):", fileInputCount);
if (fileInputCount === 0) throw new Error("no files[Origin] input on addaudiomp3 form");

// Make the hidden input visible+enabled so setInputFiles + change works reliably.
await page.evaluate(() => {
  const inp = document.querySelector('input[type="file"][name="files[Origin]"]');
  if (inp) {
    inp.style.display = "inline-block";
    inp.style.opacity = "1";
    inp.disabled = false;
    inp.removeAttribute("disabled");
  }
});

// setInputFiles fires `change` automatically; getpath() should kick in.
await fileInput.setInputFiles(audioPath);
console.log(" file selected:", audioPath);

// Watch the network for the AJAX upload completion.
console.log(" waiting for upload AJAX to complete…");
try {
  // Poll the form for signs of successful upload: tracknio1 populated, or "100%", or new track row.
  await page.waitForFunction(
    () => {
      const tracknio = document.querySelector('input[name="tracknio1"]');
      if (tracknio && tracknio.value && tracknio.value.length > 0) return true;
      const txt = document.body.innerText || "";
      if (/uploaded|complete|100\s*%/i.test(txt)) return true;
      // Check if hidden tracking fields are populated
      const filePdf = document.querySelector('input[name="file_pdf_value0"]');
      if (filePdf && filePdf.value && filePdf.value.length > 0) return true;
      return false;
    },
    { timeout: 120000 },
  );
  console.log(" upload AJAX completed");
} catch (e) {
  console.log(" upload wait timed out; checking state anyway");
  const debug = await page.evaluate(() => ({
    tracknio1: document.querySelector('input[name="tracknio1"]')?.value || "",
    bodyText: (document.body.innerText || "").slice(0, 500),
    netActive: !!document.querySelector(".uploading, .progress, .uploadprogress"),
  }));
  console.log("  debug:", JSON.stringify(debug, null, 2));
}
await page.waitForTimeout(3000);

// Fill the track title (might already be auto-populated from filename)
const titleInput = page.locator('input[name="tracknio1"]').first();
if (await titleInput.count() > 0) {
  const cur = await titleInput.inputValue();
  console.log(" tracknio1 current:", JSON.stringify(cur));
  if (cur !== track.title) {
    await titleInput.fill(track.title);
    console.log(" tracknio1 set to:", track.title);
  }
}
// Click Save and Continue
const audioSave = page.locator('input#edit-submit, input[type="submit"][name="op"]').first();
console.log(" clicking Save and Continue");
await Promise.all([
  page.waitForLoadState("domcontentloaded").catch(() => {}),
  audioSave.click({ force: true }),
]);
await page.waitForTimeout(10000);
console.log(" landed on:", page.url());

// Refresh cookies from Playwright in case anything got rotated
const playwrightJar = (await ctx.cookies()).filter(c => /routenote\.com$/.test(c.domain));
const COOKIE_REFRESHED = cookieHeader(dedupeCookies(playwrightJar));

await browser.close();

// === STEP 7-10: CURL — artwork, trackmeta, confirm, stores ===
console.log("[7/11] CURL: artwork upload");
if (coverPath) {
  const ru = await curlMultipart(COOKIE_REFRESHED, `https://www.routenote.com/rn/addart/form/${upc}`,
    { tersawsas: "true", addart_savbtn: "Save and Continue" },
    [{ field: "audio_images", path: coverPath, filename: "cover.jpg", contentType: "image/jpeg" }],
    `https://www.routenote.com/rn/addart/form/${upc}`);
  console.log(" status:", ru.status, "loc:", ru.location);
}

console.log("[8/11] CURL: track metadata");
const tmUrl = `https://www.routenote.com/rn/trackmetadata/form/${upc}`;
const tm = await curlGet(COOKIE_REFRESHED, tmUrl);
const tmFormStart = tm.body.indexOf("<form");
const tmFormHtml = tm.body.slice(tmFormStart, tm.body.indexOf("</form>", tmFormStart));
const tmFields = {};
for (const m of tmFormHtml.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)) {
  if (m[1].startsWith("file[") || m[1] === "files[audio]") continue;
  if (!(m[1] in tmFields)) tmFields[m[1]] = m[2];
}
for (const sm of tmFormHtml.matchAll(/<select[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
  const sel = sm[2].match(/<option[^>]*selected[^>]*value="([^"]*)"/);
  if (sel) tmFields[sm[1]] = sel[1];
  else if (!(sm[1] in tmFields)) tmFields[sm[1]] = "";
}
tmFields["audio_tags0[title]"] = track.title;
tmFields["audio_tags0[trackno]"] = "1";
tmFields["audio_tags0[role]"] = "Primary";
tmFields["audio_tags0[artist]"] = artistName;
tmFields.edit_album_first_composer = firstName;
tmFields.edit_album_last_composer = lastName;
tmFields.edit_album_first_contributor = artistName;
tmFields.edit_album_info_language0 = "English";
tmFields.edit_album_info_explicit0 = "0";
tmFields.op = "Save and Continue";
const tmRes = await curlPost(COOKIE_REFRESHED, tmUrl, tmFields, tmUrl);
console.log(" status:", tmRes.status, "loc:", tmRes.location);

console.log("[9/11] CURL: confirm_upload (I'm Finished)");
const cuUrl = `https://www.routenote.com/rn/confirm_upload/form/${upc}`;
const cu = await curlGet(COOKIE_REFRESHED, cuUrl);
const cuFields = {
  op: "I'm Finished",
  form_id: scrapeHidden(cu.body, "form_id") || "confirm_upload_form",
  form_build_id: scrapeHidden(cu.body, "form_build_id") || "",
  form_token: scrapeHidden(cu.body, "form_token") || "",
};
const tersaCU = scrapeHidden(cu.body, "tersawsas");
if (tersaCU !== null) cuFields.tersawsas = tersaCU;
const cuRes = await curlPost(COOKIE_REFRESHED, cuUrl, cuFields, cuUrl);
console.log(" status:", cuRes.status, "loc:", cuRes.location);

console.log("[10/11] CURL: stores (select all)");
const stUrl = `https://www.routenote.com/rn/addstore/form/${upc}`;
const st = await curlGet(COOKIE_REFRESHED, stUrl);
const dids = [...new Set([...st.body.matchAll(/name="(did\d+)"/g)].map((m) => m[1]))];
const stFields = {
  "edit-selall": "1",
  approve_val: "1",
  album_save: "Save and Continue",
  op: "Save",
  form_id: scrapeHidden(st.body, "form_id") || "addstore_form",
  form_build_id: scrapeHidden(st.body, "form_build_id") || "",
  form_token: scrapeHidden(st.body, "form_token") || "",
};
for (const d of dids) stFields[d] = "1";
const tersaST = scrapeHidden(st.body, "tersawsas");
if (tersaST !== null) stFields.tersawsas = tersaST;
const hideStore = scrapeHidden(st.body, "hidestorevalue");
if (hideStore) stFields.hidestorevalue = hideStore;
const stRes = await curlPost(COOKIE_REFRESHED, stUrl, stFields, stUrl);
console.log(" status:", stRes.status, "loc:", stRes.location, "stores:", dids.length);

// === STEP 11: PLAYWRIGHT — final Distribute Free ===
console.log("[11/11] PLAYWRIGHT: tick T&C + Distribute Free");
const browser2 = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const ctx2 = await browser2.newContext({
  userAgent: UA,
  viewport: { width: 1440, height: 900 },
});
await ctx2.addCookies(playwrightCookies(dedupeCookies(playwrightJar.length ? playwrightJar : jar)));
const page2 = await ctx2.newPage();
page2.on("dialog", d => d.accept().catch(() => {}));

const albumPageUrl = `https://www.routenote.com/rn/edit_album/${upc}`;
console.log(" → goto", albumPageUrl);
await page2.goto(albumPageUrl, { waitUntil: "domcontentloaded" });
await page2.waitForTimeout(3000);
if (page2.url().toLowerCase().includes("/login")) {
  console.error(" auth lost in final-submit Playwright"); await browser2.close(); process.exit(3);
}
const trackcountVal = await page2.evaluate(() => {
  const scripts = [...document.querySelectorAll("script")].map(s => s.textContent || "").join("\n");
  const m = scripts.match(/var\s+trackcount\s*=\s*"?(\d+)"?/);
  return m ? m[1] : "?";
});
console.log(" trackcount:", trackcountVal, "← needs to be ≥1 for distribute to succeed");

await page2.locator("#submit_chk").check({ force: true });
await page2.waitForTimeout(500);
console.log(" T&C ticked");
await page2.locator(".dislinkfree, input[value='Distribute Free']").first().click({ force: true });
await page2.waitForTimeout(2500);
const visibleModals = await page2.evaluate(() => {
  const out = [];
  document.querySelectorAll("[id*='valid'], [id*='terms'], [id*='lcrole'], [id*='artrole'], [id*='dt_validation'], [id*='orgrlsdat']")
    .forEach(el => {
      if (getComputedStyle(el).display !== "none" && el.offsetParent !== null) {
        out.push({ id: el.id, text: (el.innerText || "").trim().slice(0, 200) });
      }
    });
  return out;
});
console.log(" visible modals:", JSON.stringify(visibleModals, null, 2));
const agreeOpen = visibleModals.some(m => m.id === "agree_terms");
if (agreeOpen) {
  console.log(" agree_terms open → clicking Complete Release");
  await page2.locator("#rn_btn_ok").click({ force: true });
  await page2.waitForTimeout(10000);
  console.log(" final URL:", page2.url());
} else {
  const errModal = visibleModals.find(m => /artist|valid|role|missing|invalid/i.test(m.text));
  if (errModal) console.log(" ❌ validation blocked:", errModal.text);
  else console.log(" ❌ no agree_terms modal — submit didn't progress (trackcount may still be 0)");
}

// Save cookies back
const finalCookies = (await ctx2.cookies()).filter(c => /routenote\.com$/.test(c.domain));
await cxMut("distributorAuth:save", { distributor: "routenote", cookiesJson: JSON.stringify(finalCookies) });
await browser2.close();

console.log("\n✓ DONE");
console.log("Live: https://www.routenote.com/rn/edit_album/" + upc);
console.log("UPC:", upc);
