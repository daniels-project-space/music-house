import "server-only";
import { chromium, type Browser, type Page, type BrowserContext } from "playwright-core";

export type DistributeInput = {
  audioPath: string;
  coverPath?: string;
  title: string;
  artistName: string;
  genre?: string;
  explicit?: boolean;
};

export type DistributeCreds = {
  username: string;
  password: string;
};

export type DistributeResult = {
  sessionId: string;
  liveViewUrl: string;
  loggedIn: boolean;
  upc?: string;
  filledAlbumDetails: boolean;
  uploadedAudio: boolean;
  uploadedCover: boolean;
  enabledStores: boolean;
  newCookiesJson?: string;
  finalUrl: string;
};

export type ProgressLogger = (step: string, detail?: string) => void | Promise<void>;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const ROUTENOTE_GENRES = new Set([
  "Pop","Rock","Hip Hop","Electronic","Dance","Classical","Jazz","Country",
  "Folk","R&B/Soul","Alternative","Indie","Reggae","Latin","Metal","Blues","Other",
]);

function pickGenre(g?: string) {
  if (!g) return "Electronic";
  const m = Array.from(ROUTENOTE_GENRES).find((x) => x.toLowerCase() === g.toLowerCase());
  if (m) return m;
  if (g.toLowerCase().includes("cinematic")) return "Classical";
  if (g.toLowerCase().includes("lofi") || g.toLowerCase().includes("lo-fi")) return "Electronic";
  return "Electronic";
}

async function createBrowserbaseSession(bb: { apiKey: string; projectId: string }) {
  const r = await fetch("https://api.browserbase.com/v1/sessions", {
    method: "POST",
    headers: { "X-BB-API-Key": bb.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: bb.projectId,
      keepAlive: true,
      browserSettings: { viewport: { width: 1440, height: 900 }, blockAds: true },
    }),
  });
  if (!r.ok) throw new Error(`browserbase session create ${r.status}: ${await r.text()}`);
  const data = (await r.json()) as { id: string; connectUrl: string };
  return data;
}

async function gotoSettled(page: Page, url: string, timeoutMs = 25_000) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await sleep(1500);
}

async function fillAlbumDetails(page: Page, input: DistributeInput, log: ProgressLogger) {
  await log("album:fill-title");
  await page.locator("#edit_album_info_title").fill(input.title).catch(() => {});
  await log("album:fill-artist");
  await page.locator("#edit_album_info_artist").fill(input.artistName).catch(() => {});

  await log("album:fill-genre");
  const genre = pickGenre(input.genre);
  await page.locator("#edit_album_info_genre").fill(genre).catch(() => {});

  await log("album:fill-copyright");
  const year = new Date().getFullYear().toString();
  await page.locator("#cpy_year").fill(year).catch(() => {});
  await page.locator("#cpy_name").fill(input.artistName).catch(() => {});
  await page.locator("#edit_album_info_pcopyyear").fill(year).catch(() => {});
  await page.locator("#edit_album_info_pcopyname").fill(input.artistName).catch(() => {});
  await page.locator("#edit_album_info_label").fill(input.artistName).catch(() => {});

  await log("album:fill-composer");
  await page.locator("#edit_album_first_composer").fill(input.artistName.split(" ")[0] ?? input.artistName).catch(() => {});
  await page.locator("#edit_album_last_composer").fill(input.artistName.split(" ").slice(1).join(" ") || "Artist").catch(() => {});

  await log("album:try-save");
  await clickSaveAndDismissModal(page, "#edit-album-save-image", log, "album");
}

async function clickSaveAndDismissModal(page: Page, btnSelector: string, log: ProgressLogger, prefix: string) {
  const btn = page.locator(btnSelector).first();
  if ((await btn.count()) === 0) {
    await log(`${prefix}:save-btn-not-found`);
    return false;
  }
  try {
    await btn.scrollIntoViewIfNeeded({ timeout: 5000 });
  } catch {}
  // Cancel native confirm() popups (RouteNote uses them for some saves)
  page.once("dialog", (d) => d.accept().catch(() => {}));
  await btn.click({ force: true }).catch(async (e) => {
    await log(`${prefix}:save-click-failed`, (e as Error).message);
  });
  await sleep(2000);

  // The cldvrsn_modal() onclick may pop a custom modal — find any visible OK / Confirm / Continue button
  for (let i = 0; i < 3; i++) {
    const okBtn = page.locator("button:visible:has-text('OK'), button:visible:has-text('Continue'), button:visible:has-text('Confirm'), button:visible:has-text('Yes'), input[type='button'][value='OK']:visible, input[type='button'][value='Continue']:visible").first();
    if ((await okBtn.count()) > 0) {
      try {
        await okBtn.click({ force: true });
        await log(`${prefix}:modal-dismissed-${i}`);
        await sleep(1500);
      } catch {}
    } else {
      break;
    }
  }
  await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
  await sleep(1500);
  return true;
}

async function uploadAudio(page: Page, input: DistributeInput, log: ProgressLogger) {
  await log("audio:click-add-track");
  const addTrackBtn = page.locator("#rn_track");
  if ((await addTrackBtn.count()) === 0) {
    await log("audio:no-add-track-button");
    return false;
  }
  // The Add Track button likely spawns a file chooser via JS new_link().
  // Listen for a filechooser event and click.
  const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 8_000 }).catch(() => null);
  await addTrackBtn.click();
  const fileChooser = await fileChooserPromise;
  if (fileChooser) {
    await log("audio:filechooser-fired");
    await fileChooser.setFiles(input.audioPath);
  } else {
    // Fallback: search for any input[type=file] that may have appeared
    await sleep(1500);
    const fileInput = page.locator('input[type="file"]').first();
    if ((await fileInput.count()) > 0) {
      await fileInput.setInputFiles(input.audioPath).catch(async (e) => {
        await log("audio:fallback-fileinput-failed", (e as Error).message);
      });
    } else {
      await log("audio:no-file-mechanism-found");
      return false;
    }
  }

  await sleep(2500);
  await log("audio:fill-track-title");
  await page.locator("#edit-tracknio1, input[name='tracknio1']").first().fill(input.title).catch(() => {});

  await log("audio:click-save-continue");
  await clickSaveAndDismissModal(page, "#edit-submit", log, "audio");
  return true;
}

async function uploadCover(page: Page, input: DistributeInput, log: ProgressLogger) {
  if (!input.coverPath) {
    await log("cover:skip-no-path");
    return false;
  }
  await log("cover:set-input");
  const fileInput = page.locator("#audio_images1, input[type='file'][name='audio_images']").first();
  if ((await fileInput.count()) === 0) {
    await log("cover:no-input-found");
    return false;
  }
  await fileInput.setInputFiles(input.coverPath).catch(async (e) => {
    await log("cover:setfiles-failed", (e as Error).message);
  });
  await sleep(3000);
  // Cover form usually auto-saves on file change; try a save button if present.
  await clickSaveAndDismissModal(page, "input[type='submit'][value*='Save' i], input[type='submit'][value*='Continue' i], #album_save, #edit-submit", log, "cover");
  return true;
}

async function enableStores(page: Page, log: ProgressLogger) {
  await log("stores:click-select-all");
  const selAll = page.locator("#edit-selall");
  if ((await selAll.count()) > 0) {
    await selAll.check({ force: true }).catch(() => {});
    await sleep(800);
  }
  await log("stores:click-save");
  return clickSaveAndDismissModal(page, "#album_save", log, "stores");
}

export async function distributeToRoutenote(
  input: DistributeInput,
  creds: DistributeCreds,
  bb: { apiKey?: string; projectId?: string } | undefined,
  cookiesJson: string | undefined,
  log: ProgressLogger = () => {},
): Promise<DistributeResult> {
  let browser: Browser | undefined;
  let sessionId = "local";
  let liveViewUrl = "";

  // Try Browserbase if creds + a usable plan available; otherwise local chromium.
  let usingBrowserbase = false;
  if (bb?.apiKey && bb?.projectId) {
    try {
      await log("init:browserbase-attempt");
      const session = await createBrowserbaseSession({ apiKey: bb.apiKey, projectId: bb.projectId });
      sessionId = session.id;
      liveViewUrl = `https://www.browserbase.com/sessions/${sessionId}`;
      browser = await chromium.connectOverCDP(session.connectUrl);
      usingBrowserbase = true;
      await log("init:browserbase-ok", liveViewUrl);
    } catch (e) {
      await log("init:browserbase-failed-local-fallback", (e as Error).message.slice(0, 200));
    }
  }
  if (!usingBrowserbase) {
    await log("init:local-chromium");
    browser = await chromium.launch({ headless: true });
    sessionId = `local-${Date.now()}`;
    liveViewUrl = "";
  }
  if (!browser) throw new Error("failed to launch any browser");

  let ctx: BrowserContext;
  let page: Page;
  let loggedIn = false;
  let upc: string | undefined;
  let filledAlbumDetails = false;
  let uploadedAudio = false;
  let uploadedCover = false;
  let enabledStores = false;
  let finalUrl = "";

  try {
    ctx = browser.contexts()[0] ?? (await browser.newContext({ viewport: { width: 1440, height: 900 } }));
    page = ctx.pages()[0] ?? (await ctx.newPage());

    if (cookiesJson) {
      try {
        const cookies = JSON.parse(cookiesJson);
        await ctx.addCookies(cookies);
        await log("init:cookies-restored", `count=${cookies.length}`);
      } catch (e) {
        await log("init:cookies-parse-failed", (e as Error).message);
      }
    }

    // Probe auth by navigating to /rn/create_album
    await gotoSettled(page, "https://www.routenote.com/rn/create_album");
    loggedIn = !page.url().toLowerCase().includes("/login");
    await log("auth:check", `logged-in=${loggedIn} url=${page.url()}`);

    if (!loggedIn) {
      // Try programmatic login (likely captcha-blocked)
      await gotoSettled(page, "https://www.routenote.com/rn/login");
      await page.locator('#user-login input[name="name"]').first().fill(creds.username);
      await page.locator('#user-login input[name="pass"]').first().fill(creds.password);
      await page.locator("#in_signin_button").first().click();
      for (let i = 0; i < 15; i++) {
        await sleep(1000);
        if (!page.url().toLowerCase().includes("/login")) break;
      }
      loggedIn = !page.url().toLowerCase().includes("/login");
      await log("auth:after-login", `logged-in=${loggedIn}`);
    }

    if (!loggedIn) {
      await log("auth:fallback-to-manual");
      finalUrl = page.url();
      return {
        sessionId, liveViewUrl, loggedIn, upc, filledAlbumDetails,
        uploadedAudio, uploadedCover, enabledStores, finalUrl,
      };
    }

    // Step 1: Create release
    await gotoSettled(page, "https://www.routenote.com/rn/create_album");
    const futureDate = new Date(Date.now() + 21 * 86400 * 1000).toISOString().slice(0, 10);
    await log("create:fill-date", futureDate);
    await page.locator("#edit_album_info_release").fill(futureDate);
    await sleep(500);
    await log("create:click-create");
    await page.locator("#edit-album-save-image").click();
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      if (page.url().includes("/edit_album/")) break;
    }
    if (page.url().includes("/edit_album/")) {
      upc = page.url().split("/").pop();
      await log("create:upc-captured", upc);
    } else {
      await log("create:upc-not-captured", page.url());
    }

    if (!upc) {
      finalUrl = page.url();
      throw new Error("Failed to capture UPC from create_album response");
    }

    // Step 2: Album Details
    await gotoSettled(page, `https://www.routenote.com/rn/editalbum/${upc}`);
    await fillAlbumDetails(page, input, log);
    filledAlbumDetails = true;
    await log("album:done", page.url());

    // Step 3: Add Audio
    await gotoSettled(page, `https://www.routenote.com/rn/addaudiomp3/form/${upc}`);
    uploadedAudio = await uploadAudio(page, input, log);
    await log("audio:done", `uploaded=${uploadedAudio} url=${page.url()}`);

    // Step 4: Add Artwork
    await gotoSettled(page, `https://www.routenote.com/rn/addart/form/${upc}`);
    uploadedCover = await uploadCover(page, input, log);
    await log("cover:done", `uploaded=${uploadedCover} url=${page.url()}`);

    // Step 5: Manage Stores
    await gotoSettled(page, `https://www.routenote.com/rn/addstore/form/${upc}`);
    enabledStores = await enableStores(page, log);
    await log("stores:done", `enabled=${enabledStores} url=${page.url()}`);

    // Capture refreshed cookies
    finalUrl = page.url();
    let newCookiesJson: string | undefined;
    try {
      const cookies = await ctx.cookies();
      newCookiesJson = JSON.stringify(cookies);
      await log("cookies:captured", `count=${cookies.length}`);
    } catch (e) {
      await log("cookies:capture-failed", (e as Error).message);
    }

    return {
      sessionId, liveViewUrl, loggedIn, upc, filledAlbumDetails,
      uploadedAudio, uploadedCover, enabledStores, newCookiesJson, finalUrl,
    };
  } catch (err) {
    await log("error", (err as Error).message);
    finalUrl = page!?.url() ?? finalUrl;
    return {
      sessionId, liveViewUrl, loggedIn, upc, filledAlbumDetails,
      uploadedAudio, uploadedCover, enabledStores, finalUrl,
    };
  } finally {
    try {
      await browser?.close();
    } catch {}
  }
}
