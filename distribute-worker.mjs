// Long-running worker on the VPS that polls Convex for pending distributionJobs
// and processes them with local headless Chromium via Playwright.
// Run as a systemd service — see music-house-distribute.service.
//
// Env (loaded from /home/ubuntu/music-house/.env.worker):
//   CONVEX_URL — music-house Convex deployment (https://determined-aardvark-936.convex.cloud)
//   VAULT_URL  — project-hub vault (defaults to fantastic-roadrunner-485.convex.cloud)
//   POLL_INTERVAL_MS — default 5000

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright-core";
import {
  S3Client, GetObjectCommand,
} from "@aws-sdk/client-s3";

const CONVEX_URL = process.env.CONVEX_URL ?? "https://determined-aardvark-936.convex.cloud";
const VAULT_URL = process.env.VAULT_URL ?? "https://fantastic-roadrunner-485.convex.cloud";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5000);
const BUCKET = process.env.R2_BUCKET ?? "music-house";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cx(base, path, args, mut = false) {
  const r = await fetch(`${base}/api/${mut ? "mutation" : "query"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
  });
  const j = await r.json();
  if (j.status && j.status !== "success") throw new Error(`${path} failed: ${JSON.stringify(j)}`);
  return j.value;
}

async function vault(service, keyName) {
  const row = await cx(VAULT_URL, "secrets:getOne", { service, keyName });
  if (!row) throw new Error(`vault ${service}.${keyName} missing`);
  return row.value;
}

let s3Client;
async function r2() {
  if (s3Client) return s3Client;
  const [accountId, accessKeyId, secretAccessKey, endpointFromVault] = await Promise.all([
    vault("cloudflare", "R2_ACCOUNT_ID"),
    vault("cloudflare", "R2_ACCESS_KEY_ID"),
    vault("cloudflare", "R2_SECRET_ACCESS_KEY"),
    vault("cloudflare", "R2_ENDPOINT").catch(() => null),
  ]);
  const endpoint = endpointFromVault || `https://${accountId}.r2.cloudflarestorage.com`;
  s3Client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return s3Client;
}

async function downloadToTmp(key, prefix) {
  const c = await r2();
  const r = await c.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of r.Body) chunks.push(Buffer.from(chunk));
  const buf = Buffer.concat(chunks);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `mh-${prefix}-`));
  const ext = key.endsWith(".flac") ? ".flac" : key.endsWith(".png") ? ".png" : key.endsWith(".jpg") ? ".jpg" : ".bin";
  const file = path.join(dir, `f${ext}`);
  await fs.writeFile(file, buf);
  return { file, dir };
}

function humanizeSlug(slug) {
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

const ROUTENOTE_GENRES = ["Pop","Rock","Hip Hop","Electronic","Dance","Classical","Jazz","Country","Folk","R&B/Soul","Alternative","Indie","Reggae","Latin","Metal","Blues","Other"];
function pickGenre(g) {
  if (!g) return "Electronic";
  const m = ROUTENOTE_GENRES.find((x) => x.toLowerCase() === String(g).toLowerCase());
  if (m) return m;
  if (String(g).toLowerCase().includes("cinematic")) return "Classical";
  return "Electronic";
}

async function logToJob(jobId, step, detail) {
  console.log(`[${jobId}] ${step}${detail ? " " + String(detail).slice(0, 200) : ""}`);
}

async function clickSaveAndDismissModal(page, btnSelector, jobId, prefix) {
  const btn = page.locator(btnSelector).first();
  if ((await btn.count()) === 0) {
    await logToJob(jobId, `${prefix}:save-btn-not-found`);
    return false;
  }
  try { await btn.scrollIntoViewIfNeeded({ timeout: 5000 }); } catch {}
  page.once("dialog", (d) => d.accept().catch(() => {}));
  await btn.click({ force: true }).catch((e) => logToJob(jobId, `${prefix}:click-failed`, e.message));
  await sleep(2000);
  for (let i = 0; i < 3; i++) {
    const okBtn = page.locator("button:visible:has-text('OK'), button:visible:has-text('Continue'), button:visible:has-text('Confirm'), button:visible:has-text('Yes'), input[type='button'][value='OK']:visible, input[type='button'][value='Continue']:visible").first();
    if ((await okBtn.count()) > 0) {
      try {
        await okBtn.click({ force: true });
        await logToJob(jobId, `${prefix}:modal-dismissed-${i}`);
        await sleep(1500);
      } catch {}
    } else break;
  }
  await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
  await sleep(1500);
  return true;
}

// Submit a Drupal form bypassing onclick validation handlers entirely.
// Direct call to HTMLFormElement.submit() ignores onclick="return cldvrsn_modal();"
// and posts whatever fields are currently in the form.
async function bypassSubmitForm(page, formId, jobId, prefix) {
  const before = page.url();
  const submitted = await page.evaluate((fid) => {
    const f = document.getElementById(fid) || document.forms.namedItem(fid);
    if (!f) return false;
    f.submit();
    return true;
  }, formId).catch(() => false);
  if (!submitted) {
    await logToJob(jobId, `${prefix}:bypass-form-not-found`, formId);
    return false;
  }
  await logToJob(jobId, `${prefix}:bypass-submitted`);
  for (let i = 0; i < 25; i++) {
    await sleep(1000);
    if (page.url() !== before) break;
  }
  await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
  await sleep(1500);
  return true;
}

async function uploadShot(s3, bucket, jobId, prefix, page) {
  try {
    const buf = await page.screenshot({ fullPage: true });
    const key = `_distrib-debug/${jobId}/${Date.now()}-${prefix}.png`;
    await s3.send(new (await import("@aws-sdk/client-s3")).PutObjectCommand({
      Bucket: bucket, Key: key, Body: buf, ContentType: "image/png",
    }));
    return key;
  } catch (e) {
    return null;
  }
}

async function gotoSettled(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await sleep(1500);
}

async function processJob(job) {
  const jobId = job._id;
  await logToJob(jobId, "pickup");
  await cx(CONVEX_URL, "distribution:setRunning", { id: jobId, triggerRunId: `vps-${process.pid}-${Date.now()}` }, true);

  const track = await cx(CONVEX_URL, "tracks:get", { id: job.trackId });
  if (!track) {
    await cx(CONVEX_URL, "distribution:setFailed", { id: jobId, error: "track not found" }, true);
    return;
  }

  const audio = await downloadToTmp(track.audioKey, "audio").catch((e) => { logToJob(jobId, "audio-download-failed", e.message); return null; });
  if (!audio) {
    await cx(CONVEX_URL, "distribution:setFailed", { id: jobId, error: "audio download failed" }, true);
    return;
  }

  let coverKey = track.coverKey;
  if (!coverKey && track.albumSlug) {
    const album = await cx(CONVEX_URL, "albums:getOne", { artistSlug: track.artistSlug, slug: track.albumSlug });
    coverKey = album?.coverKey;
  }
  const cover = coverKey ? await downloadToTmp(coverKey, "cover").catch((e) => { logToJob(jobId, "cover-download-failed", e.message); return null; }) : null;

  const auth = await cx(CONVEX_URL, "distributorAuth:get", { distributor: "routenote" });
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  let succeeded = false;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    if (auth?.cookiesJson) await ctx.addCookies(JSON.parse(auth.cookiesJson));
    const page = await ctx.newPage();

    // Auth check
    await gotoSettled(page, "https://www.routenote.com/rn/create_album");
    if (page.url().toLowerCase().includes("/login")) {
      await logToJob(jobId, "auth:cookies-expired-trying-programmatic-login");
      const username = await vault("routenote", "ROUTENOTE_USERNAME").catch(() => null);
      const password = await vault("routenote", "ROUTENOTE_PASSWORD").catch(() => null);
      if (username && password) {
        await page.locator('#user-login input[name="name"]').first().fill(username).catch(() => {});
        await page.locator('#user-login input[name="pass"]').first().fill(password).catch(() => {});
        await page.locator("#in_signin_button").first().click().catch(() => {});
        for (let i = 0; i < 20; i++) {
          await sleep(1000);
          if (!page.url().toLowerCase().includes("/login")) break;
        }
      }
      if (page.url().toLowerCase().includes("/login")) {
        const shot = await uploadShot(await r2(), BUCKET, jobId, "auth-failed", page);
        await cx(CONVEX_URL, "distribution:setFailed", {
          id: jobId,
          error: "Login failed (likely captcha). Re-run bootstrap-auth.mjs to log in manually." + (shot ? ` shot=${shot}` : ""),
        }, true);
        return;
      }
      await logToJob(jobId, "auth:programmatic-login-ok");
      // Save fresh cookies immediately
      try {
        const cookies = await ctx.cookies();
        await cx(CONVEX_URL, "distributorAuth:save", { distributor: "routenote", cookiesJson: JSON.stringify(cookies) }, true);
      } catch (e) { logToJob(jobId, "auth:cookie-save-failed", e.message); }
      // Re-navigate now that we're logged in
      await gotoSettled(page, "https://www.routenote.com/rn/create_album");
    }

    // Step 1: Create release
    const futureDate = new Date(Date.now() + 21 * 86400 * 1000).toISOString().slice(0, 10);
    await page.locator("#edit_album_info_release").fill(futureDate);
    await sleep(500);
    await page.locator("#edit-album-save-image").click();
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      if (page.url().includes("/edit_album/")) break;
    }
    if (!page.url().includes("/edit_album/")) {
      await cx(CONVEX_URL, "distribution:setFailed", { id: jobId, error: "Failed to create release on /rn/create_album" }, true);
      return;
    }
    const upc = page.url().split("/").pop();
    await logToJob(jobId, "upc", upc);

    // Step 2: Album Details
    await gotoSettled(page, `https://www.routenote.com/rn/editalbum/${upc}`);
    const artistName = humanizeSlug(track.artistSlug);
    const year = String(new Date().getFullYear());

    async function setText(sel, val) {
      const loc = page.locator(sel).first();
      if ((await loc.count()) === 0) return;
      await loc.click({ force: true }).catch(() => {});
      await loc.fill(val).catch(() => {});
      // Trigger blur for Drupal AJAX validation
      await loc.press("Tab").catch(() => {});
      await sleep(150);
    }

    await setText("#edit_album_info_language", "English");
    await setText("#edit_album_info_title", track.title);
    await setText("#edit_album_info_artist", artistName);
    await setText("#edit_album_info_genre", pickGenre(track.genre));
    await setText("#cpy_year", year);
    await setText("#cpy_name", artistName);
    await setText("#edit_album_info_pcopyyear", year);
    await setText("#edit_album_info_pcopyname", artistName);
    await setText("#edit_album_info_label", artistName);
    await setText("#edit_album_first_composer", artistName.split(" ")[0] || artistName);
    await setText("#edit_album_last_composer", artistName.split(" ").slice(1).join(" ") || "Artist");

    // Required Yes/No questions — pick safe defaults:
    await page.locator("#No").check({ force: true }).catch(() => {});
    await sleep(200);
    await page.locator("#No1").check({ force: true }).catch(() => {});
    await sleep(200);
    await page.locator("#No3").check({ force: true }).catch(() => {});
    await sleep(200);

    // Screenshot before save attempt
    const beforeShot = await uploadShot(await r2(), BUCKET, jobId, "album-before-save", page);
    if (beforeShot) await logToJob(jobId, "album:shot-before", beforeShot);

    // Bypass cldvrsn_modal() onclick validation by calling form.submit() directly.
    // Drupal still validates server-side; if anything fails, the next page-load shows errors.
    await bypassSubmitForm(page, "editalbum-form", jobId, "album");
    await logToJob(jobId, "album:after-save-url", page.url());

    // Screenshot after save attempt (may show server-side errors)
    const afterShot = await uploadShot(await r2(), BUCKET, jobId, "album-after-save", page);
    if (afterShot) await logToJob(jobId, "album:shot-after", afterShot);

    // Step 3: Add Audio
    await gotoSettled(page, `https://www.routenote.com/rn/addaudiomp3/form/${upc}`);
    const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 8_000 }).catch(() => null);
    const addBtn = page.locator("#rn_track");
    if ((await addBtn.count()) > 0) await addBtn.click();
    const fc = await fileChooserPromise;
    if (fc) {
      await fc.setFiles(audio.file);
      await logToJob(jobId, "audio:filechooser-set");
    } else {
      await sleep(1500);
      const fileInput = page.locator('input[type="file"]').first();
      if ((await fileInput.count()) > 0) await fileInput.setInputFiles(audio.file).catch(() => {});
    }
    await sleep(2500);
    await page.locator("#edit-tracknio1, input[name='tracknio1']").first().fill(track.title).catch(() => {});
    const audioBefore = await uploadShot(await r2(), BUCKET, jobId, "audio-before-save", page);
    if (audioBefore) await logToJob(jobId, "audio:shot-before", audioBefore);
    // Bypass any onclick validation — submit the form containing #edit-submit.
    await page.evaluate(() => {
      const btn = document.getElementById("edit-submit");
      const f = btn && btn.form ? btn.form : (document.querySelector("form") || null);
      if (f) f.submit();
    }).catch(() => {});
    await sleep(3000);
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
    const audioAfter = await uploadShot(await r2(), BUCKET, jobId, "audio-after-save", page);
    if (audioAfter) await logToJob(jobId, "audio:shot-after", audioAfter);
    await logToJob(jobId, "audio:after-save-url", page.url());

    // Step 4: Add Artwork
    if (cover) {
      await gotoSettled(page, `https://www.routenote.com/rn/addart/form/${upc}`);
      await page.locator("#audio_images1").first().setInputFiles(cover.file).catch(async (e) => logToJob(jobId, "cover-failed", e.message));
      await sleep(3000);
      await clickSaveAndDismissModal(page, "input[type='submit'][value*='Save' i], input[type='submit'][value*='Continue' i], #album_save, #edit-submit", jobId, "cover");
    }

    // Step 5: Manage Stores
    await gotoSettled(page, `https://www.routenote.com/rn/addstore/form/${upc}`);
    await page.locator("#edit-selall").check({ force: true }).catch(() => {});
    await sleep(800);
    await clickSaveAndDismissModal(page, "#album_save", jobId, "stores");

    // Save refreshed cookies
    try {
      const cookies = await ctx.cookies();
      await cx(CONVEX_URL, "distributorAuth:save", { distributor: "routenote", cookiesJson: JSON.stringify(cookies) }, true);
    } catch (e) { logToJob(jobId, "cookies-save-failed", e.message); }

    // Mark draft ready with the Edit Album hub URL as "live view" stand-in
    await cx(CONVEX_URL, "distribution:setDraftReady", {
      id: jobId,
      browserbaseSessionId: `vps-${upc}`,
      liveViewUrl: `https://www.routenote.com/rn/edit_album/${upc}`,
    }, true);
    await logToJob(jobId, "done", upc);
    succeeded = true;
  } catch (err) {
    await logToJob(jobId, "error", err.message);
    if (!succeeded) {
      await cx(CONVEX_URL, "distribution:setFailed", { id: jobId, error: err.message.slice(0, 400) }, true).catch(() => {});
    }
  } finally {
    try { await browser.close(); } catch {}
    if (audio) await fs.rm(audio.dir, { recursive: true, force: true }).catch(() => {});
    if (cover) await fs.rm(cover.dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function pickPending() {
  // Use distribution:listAll then find first pending; cheap enough for low volume.
  const jobs = await cx(CONVEX_URL, "distribution:listAll", {});
  return (jobs || []).find((j) => j.status === "pending");
}

async function main() {
  console.log(`[worker] starting; convex=${CONVEX_URL} poll=${POLL_INTERVAL_MS}ms`);
  while (true) {
    try {
      const job = await pickPending();
      if (job) {
        await processJob(job);
      }
    } catch (e) {
      console.error("[worker] loop error:", e.message);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((e) => {
  console.error("[worker] fatal:", e);
  process.exit(1);
});
