import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type {
  CookieEntry,
  DistrokidReleasePayload,
  DistrokidTrack,
} from "./distrokid-cli";

// Native Node/Playwright port of the DistroKid flow, replacing the Go CLI
// subprocess for the Trigger.dev cloud runtime. The browser concerns mirror
// the proven VPS bootstrap (distrokid-cli helpers/bootstrap.mjs) and the
// payload/save logic mirrors the Go CLI internal/draft + internal/save —
// both verified live (release "A Dying Art") and via the 2026-06-12 cloud
// spike (distrokid-cloud-spike, PASS headless + headed).
//
// SUBMIT SAFETY CONTRACT (same as the Go CLI's DISTROKID_CLI_ALLOW_SUBMIT):
// doSave() is the ONLY function that touches /api/distroAlbumSave/. It refuses
// — before any network call — unless DISTROKID_ALLOW_SUBMIT=1 is set in the
// task environment AND the caller passed allowSubmit: true (i.e. not a dry run).

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export const ALLOW_SUBMIT_ENV = "DISTROKID_ALLOW_SUBMIT";

export function submitEnabled(): boolean {
  return (process.env[ALLOW_SUBMIT_ENV] ?? "").trim() === "1";
}

// ---------------------------------------------------------------------------
// Cookie conversion: distributorAuth stores Chrome-extension export format
// (expirationDate, lowercase sameSite incl. no_restriction/unspecified).
// ---------------------------------------------------------------------------

type RawCookie = CookieEntry & { expirationDate?: number };

const SAME_SITE: Record<string, "Strict" | "Lax" | "None"> = {
  strict: "Strict",
  Strict: "Strict",
  lax: "Lax",
  Lax: "Lax",
  none: "None",
  None: "None",
  no_restriction: "None",
};

export function cookiesToStorageState(raw: RawCookie[]) {
  return {
    cookies: raw.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path ?? "/",
      expires: Math.floor(c.expires ?? c.expirationDate ?? -1),
      httpOnly: c.httpOnly ?? false,
      secure: c.secure ?? false,
      sameSite: SAME_SITE[c.sameSite ?? ""] ?? "Lax",
    })),
    origins: [],
  };
}

// ---------------------------------------------------------------------------
// Browser session: headless (channel:chromium) first, headed-under-Xvfb
// fallback. Both modes cleared Cloudflare in the cloud spike.
// ---------------------------------------------------------------------------

export type DistrokidSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  mode: "headless" | "headed";
};

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-blink-features=AutomationControlled",
  "--disable-dev-shm-usage",
];

async function startXvfb(): Promise<void> {
  const exe = ["/usr/bin/Xvfb", "/usr/local/bin/Xvfb"].find((p) => existsSync(p));
  if (!exe) throw new Error("Xvfb binary missing — image built without headless:false?");
  const proc = spawn(exe, [":99", "-screen", "0", "1440x900x24", "-ac"], {
    stdio: "ignore",
    detached: true,
  });
  proc.on("error", () => {});
  proc.unref();
  await new Promise((r) => setTimeout(r, 1500));
}

export async function openSession(
  cookies: RawCookie[],
  log: (msg: string) => void = () => {},
): Promise<DistrokidSession> {
  const storageState = cookiesToStorageState(cookies);

  let browser: Browser | undefined;
  let mode: "headless" | "headed" = "headless";
  try {
    browser = await chromium.launch({ headless: true, channel: "chromium", args: LAUNCH_ARGS });
    log("launched: channel:chromium new-headless");
  } catch (e) {
    log("headless launch failed (" + (e as Error).message + ") — falling back to headed/Xvfb");
    if (!process.env.DISPLAY) process.env.DISPLAY = ":99";
    await startXvfb();
    browser = await chromium.launch({ headless: false, args: LAUNCH_ARGS });
    mode = "headed";
  }

  const context = await browser.newContext({
    storageState,
    viewport: { width: 1440, height: 900 },
    userAgent: UA,
    locale: "en-US",
    timezoneId: "Europe/London",
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  return { browser, context, page, mode };
}

export async function closeSession(s: DistrokidSession): Promise<void> {
  await s.browser.close().catch(() => {});
}

// ---------------------------------------------------------------------------
// Cloudflare clearance + /new globals (port of bootstrap.mjs globals mode).
// Every /new page load mints a FRESH albumuuid + S3 policy.
// ---------------------------------------------------------------------------

export type NewPageGlobals = {
  albumuuid: string;
  meId: number;
  s3: { BucketName: string; accessKeyId: string; PolicyBase64: string; signature: string };
};

export async function loadNewAndScrapeGlobals(
  page: Page,
  log: (msg: string) => void = () => {},
  opts: { warmDashboard?: boolean } = {},
): Promise<NewPageGlobals> {
  if (opts.warmDashboard !== false) {
    log("warmup /dashboard...");
    await page
      .goto("https://distrokid.com/dashboard", { waitUntil: "domcontentloaded", timeout: 60000 })
      .catch(() => {});
    await page.waitForTimeout(3500);
  }
  log("goto /new...");
  await page
    .goto("https://distrokid.com/new", { waitUntil: "domcontentloaded", timeout: 60000 })
    .catch(() => {});

  let ready = false;
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(2000);
    const title = await page.title().catch(() => "");
    const els = await page.$$eval("input,select", (e) => e.length).catch(() => 0);
    if (!/just a moment/i.test(title) && els > 20) {
      ready = true;
      break;
    }
    if (i === 3 || i === 10) {
      log("reload on challenge (i=" + i + ", title=" + title + ")");
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    }
  }
  if (!ready) throw new Error("FORM_NOT_READY (Cloudflare challenge not cleared on /new)");

  const ids = await page.evaluate(() => {
    const w = window as unknown as {
      albumuuid?: string;
      me?: { id?: number };
      distroJavascriptVars?: {
        BucketName?: string;
        accessKeyId?: string;
        PolicyBase64?: string;
        signature?: string;
      };
    };
    const inputEl = document.querySelector("#albumuuid") as HTMLInputElement | null;
    return {
      albumuuid: typeof w.albumuuid !== "undefined" ? w.albumuuid : inputEl?.value ?? null,
      meId: (w.me && w.me.id) ?? null,
      s3: w.distroJavascriptVars
        ? {
            BucketName: w.distroJavascriptVars.BucketName ?? "",
            accessKeyId: w.distroJavascriptVars.accessKeyId ?? "",
            PolicyBase64: w.distroJavascriptVars.PolicyBase64 ?? "",
            signature: w.distroJavascriptVars.signature ?? "",
          }
        : null,
    };
  });
  if (!ids.albumuuid || !ids.meId) throw new Error("missing albumuuid/meId after CF clearance");
  if (!ids.s3 || !ids.s3.PolicyBase64) throw new Error("S3 policy globals missing on /new");
  return { albumuuid: ids.albumuuid, meId: ids.meId, s3: ids.s3 };
}

// ---------------------------------------------------------------------------
// READ-ONLY page fetch through Cloudflare (port of bootstrap.mjs clearCloudflare).
// Warms /dashboard, navigates `url`, reloads on a "Just a moment" challenge.
// Used by the stats/earnings analytics task — never submits or clicks.
// ---------------------------------------------------------------------------

export async function fetchPageThroughCf(
  page: Page,
  url: string,
  log: (msg: string) => void = () => {},
  tries = 4,
): Promise<string> {
  log("warmup /dashboard...");
  await page
    .goto("https://distrokid.com/dashboard", { waitUntil: "domcontentloaded", timeout: 60000 })
    .catch(() => {});
  await page.waitForTimeout(3000);
  let html = "";
  for (let t = 0; t < tries; t++) {
    log(`goto (try ${t}) ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => log("nav: " + (e as Error).message));
    await page.waitForTimeout(4000);
    const title = await page.title().catch(() => "");
    html = await page.content().catch(() => "");
    if (!/just a moment/i.test(title) && !/just a moment/i.test(html)) return html;
    log(`CF challenge (try ${t}) — reloading`);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(4000);
  }
  if (/just a moment/i.test(html)) throw new Error("CF_NOT_CLEARED: " + url);
  return html;
}

export type StatsPageResult = {
  url: string;
  html: string;
  selector: Array<{ id: string | null; val: string | null; upc: string | null; txt: string }>;
};

export async function fetchStatsPage(page: Page, statsUrl: string, log?: (m: string) => void): Promise<StatsPageResult> {
  const html = await fetchPageThroughCf(page, statsUrl, log);
  const selector = await page
    .$$eval(".trendingFilterAlbums option, .trendingFilterTracks option, #selectAlbum option", (els) =>
      els.slice(0, 200).map((e) => ({
        id: e.id || e.getAttribute("id") || null,
        val: (e as HTMLOptionElement).value || null,
        upc: e.getAttribute("upc") || null,
        txt: (e.textContent || "").trim().slice(0, 80),
      })),
    )
    .catch(() => []);
  return { url: page.url(), html, selector };
}

export type EarningsPageResult = {
  url: string;
  html: string;
  pageData: { amount: string | null; currency: string | null; countryCode: string | null };
};

export async function fetchEarningsPage(page: Page, log?: (m: string) => void): Promise<EarningsPageResult> {
  const html = await fetchPageThroughCf(page, "https://distrokid.com/bank/overview/", log);
  const pageData = await page
    .evaluate(() => {
      const el = document.querySelector("#page-data") as HTMLElement | null;
      const d = el ? { ...el.dataset } : ({} as DOMStringMap);
      const w = window as unknown as { countryCode?: string };
      return {
        amount: d.amount != null ? String(d.amount) : null,
        currency: d.currency != null ? String(d.currency) : null,
        countryCode: typeof w.countryCode !== "undefined" ? String(w.countryCode) : null,
      };
    })
    .catch(() => ({ amount: null, currency: null, countryCode: null }));
  return { url: page.url(), html, pageData };
}

// ---------------------------------------------------------------------------
// In-page S3 upload (port of bootstrap.mjs upload mode + distro.js uploadFile).
// fileNum: "0" artwork | "1" track audio. The S3 policy is short-lived, so the
// caller re-runs loadNewAndScrapeGlobals before each upload for a FRESH policy
// while pinning the original albumuuid in the key.
// ---------------------------------------------------------------------------

// removeNonAlphaCharacters — matches distro.js key-name cleaning.
function cleanName(name: string): string {
  return basename(name).replace(/[^a-zA-Z0-9.]/g, "").toLowerCase();
}

export type S3UploadResult = { key: string; status: number; ok: boolean; bodyHead: string };

export async function uploadFileInPage(
  page: Page,
  globals: NewPageGlobals,
  pinnedAlbumuuid: string,
  file: { buffer: Buffer | Uint8Array; filename: string; contentType: string },
  fileNum: "0" | "1",
): Promise<S3UploadResult> {
  const fileSize = file.buffer.byteLength;
  const name = cleanName(file.filename);
  const key = `${globals.meId}--${pinnedAlbumuuid}--${fileNum}--${fileSize}--${name}`;
  const b64 = Buffer.from(file.buffer).toString("base64");

  const result = await page.evaluate(
    async (a: {
      key: string;
      contentType: string;
      b64: string;
      s3: NewPageGlobals["s3"];
      meId: number;
    }) => {
      const bin = atob(a.b64);
      const len = bin.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: a.contentType });

      // FormData order is STRICT (matches distro.js uploadFile):
      // key, acl, Content-Type, AWSAccessKeyId, policy, signature,
      // x-amz-meta-user-id, file(LAST).
      const fd = new FormData();
      fd.append("key", a.key);
      fd.append("acl", "authenticated-read");
      fd.append("Content-Type", a.contentType);
      fd.append("AWSAccessKeyId", a.s3.accessKeyId);
      fd.append("policy", a.s3.PolicyBase64);
      fd.append("signature", a.s3.signature);
      fd.append("x-amz-meta-user-id", String(a.meId));
      fd.append("file", blob, a.key.split("--").pop());

      const endpoint = "https://s3.amazonaws.com/" + (a.s3.BucketName || "uploader.distrokid.com") + "/";
      const resp = await fetch(endpoint, { method: "POST", body: fd });
      let text = "";
      try {
        text = await resp.text();
      } catch {
        // body read best-effort
      }
      return { status: resp.status, ok: resp.ok, bodyHead: text.slice(0, 300) };
    },
    { key, contentType: file.contentType, b64, s3: globals.s3, meId: globals.meId },
  );

  return { key, ...result };
}

// ---------------------------------------------------------------------------
// distroAlbumPayload assembly (verbatim port of Go internal/draft BuildPayload).
// Field set from RELEASE-RESULT.md (reverse-engineered live capture).
// ---------------------------------------------------------------------------

type SongPayload = Record<string, unknown>;

function boolToInt(b: boolean): number {
  return b ? 1 : 0;
}

function aiArtistAI(usedAi: boolean): string[] {
  return usedAi ? ["music", "lyrics", "full"] : [];
}

function buildSong(
  t: DistrokidTrack,
  audioKey: string,
  release: DistrokidReleasePayload,
): SongPayload {
  const artist = t.artistName || release.artistName;
  const composer = t.songwriters[0] ?? "";
  const usedAi = release.aiDisclosure?.usedAi ?? false;
  return {
    trackNum: t.trackNumber,
    filename: audioKey, // S3 key
    title: t.title,
    artistName: artist,
    composer,
    explicit: boolToInt(t.explicit),
    instrumental: 0,
    isrc: t.isrc ?? "",
    language: t.language || release.language,
    originalArtist: "",
    originalSongTitle: "",
    originalSongwriters: t.songwriters.join(", "),
    songwriters: t.songwriters,
    lyrics: t.lyrics ?? "",
    cleaned: 0,
    previewStartSeconds: 0,
    // Apple performer + producer credits (>=1 performer + >=1 producer for track 1).
    dspFormattedRoles: ["Singing & vocals", "Producer"],
    dspFormattedNames: [artist, composer || artist],
    dspFormattedStoreIds: ["itunes", "itunes"],
    dspFormattedVersions: [],
    dspFormattedArtistAI: aiArtistAI(usedAi),
    aiArtistIsAiPersona: boolToInt(usedAi),
  };
}

export function buildDistroAlbumPayload(
  release: DistrokidReleasePayload,
  albumuuid: string,
  artworkKey: string,
  audioKeysByTrack: Record<number, string>,
): Record<string, unknown> {
  const usedAi = release.aiDisclosure?.usedAi ?? false;
  const anyExplicit = release.tracks.some((t) => t.explicit);
  const p: Record<string, unknown> = {
    albumuuid,
    artwork: artworkKey,
    title: release.releaseTitle,
    artistName: release.artistName,
    genre: release.genre,
    language: release.language,
    label: release.label ?? "",
    releaseDate: release.releaseDate,
    synchronizedReleaseDate: release.releaseDate,
    copyrightYear: release.copyrightYear,
    copyrightName: release.copyrightName,
    cline: release.copyrightName,
    pline: release.copyrightName,
    explicit: boolToInt(anyExplicit),
    // Empty list means ALL stores.
    stores: release.stores?.storeIds ?? [],
    // Mixea upsell knobs — declined.
    doMixeaALaCarte: 0,
    hasSongsMasteredWithMixea: 0,
    ismobileupload: 0,
    // Social "new artist" sentinels (payload-embedded gotchas).
    spotifyArtistID: release.artistIdentity?.spotifyArtistId || "new",
    appleArtistID: release.artistIdentity?.appleArtistId || "new",
    googleArtistID: "new",
    instagramProfileArtistID: "new",
    facebookProfileArtistID: "new",
    // AI persona scope at album level (recording scope "full" when AI used).
    aiArtistIsAiPersona: boolToInt(usedAi),
    aiRecordingScope: usedAi ? "full" : "",
    dspFormattedArtistAI: aiArtistAI(usedAi),
  };
  if (release.secondaryGenre) p.secondaryGenre = release.secondaryGenre;

  p.songs = release.tracks.map((t) => {
    const key = audioKeysByTrack[t.trackNumber];
    if (!key) throw new Error(`no uploaded audio S3 key for track ${t.trackNumber}`);
    return buildSong(t, key, release);
  });
  return p;
}

// ---------------------------------------------------------------------------
// THE single irreversible call: POST /api/distroAlbumSave/ — fired as an
// in-page fetch so it rides the live CF-cleared browser session (closer to
// DistroKid's own distro.js than the Go CLI's out-of-band HTTP POST).
// ---------------------------------------------------------------------------

export type SaveResponse = {
  ERROR?: unknown;
  MESSAGE?: string;
  forward?: string;
  raw: string;
  status: number;
};

export class SubmitDisabledError extends Error {
  constructor() {
    super(
      `submit refused: ${ALLOW_SUBMIT_ENV} is not set to 1 (live distroAlbumSave is disabled)`,
    );
    this.name = "SubmitDisabledError";
  }
}

export async function doSave(
  page: Page,
  payload: Record<string, unknown>,
  opts: { allowSubmit: boolean },
): Promise<SaveResponse> {
  // Guard: no network. Same dry-run safety contract as the Go CLI.
  if (!opts.allowSubmit || !submitEnabled()) throw new SubmitDisabledError();

  const body = JSON.stringify(payload);
  const res = await page.evaluate(async (payloadJson: string) => {
    const form = new URLSearchParams();
    form.set("payload", payloadJson);
    const resp = await fetch("https://distrokid.com/api/distroAlbumSave/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: form.toString(),
      credentials: "include",
    });
    let text = "";
    try {
      text = await resp.text();
    } catch {
      // body read best-effort
    }
    return { status: resp.status, raw: text };
  }, body);

  let parsed: { ERROR?: unknown; MESSAGE?: string; forward?: string } = {};
  try {
    parsed = JSON.parse(res.raw) as typeof parsed;
  } catch {
    throw new Error(
      `distroAlbumSave returned non-JSON (status ${res.status}): ${res.raw.slice(0, 200)}`,
    );
  }
  return { ...parsed, raw: res.raw, status: res.status };
}

// saveOK mirrors the Go CLI's tolerant ERROR-field check.
export function saveOK(r: SaveResponse): boolean {
  const v = r.ERROR;
  if (v === null || v === undefined) return true;
  if (typeof v === "boolean") return !v;
  if (typeof v === "number") return v === 0;
  if (typeof v === "string") return v === "" || v.toLowerCase() === "false" || v === "0";
  return false;
}

const UPC_RE = /[0-9]{11,14}/;

export function extractUpc(r: SaveResponse): string | undefined {
  return r.MESSAGE?.match(UPC_RE)?.[0] ?? r.raw.match(UPC_RE)?.[0] ?? undefined;
}

export function releaseUrlFrom(albumuuid: string, r: SaveResponse): string {
  if (r.forward) {
    return r.forward.startsWith("http") ? r.forward : "https://distrokid.com" + r.forward;
  }
  return "https://distrokid.com/new/done/?albumuuid=" + albumuuid;
}

// ---------------------------------------------------------------------------
// High-level release flow — the whole thing in ONE browser session.
// dryRun stops after uploads + payload assembly (S3 orphans are reversible);
// live submit additionally requires DISTROKID_ALLOW_SUBMIT=1 in the env.
// ---------------------------------------------------------------------------

export type NativeReleaseResult = {
  albumuuid: string;
  meId: number;
  mode: "headless" | "headed";
  artworkKey: string;
  audioKeys: Record<number, string>;
  payload: Record<string, unknown>;
  submitted: boolean;
  upc?: string;
  releaseUrl?: string;
  saveMessage?: string;
};

export async function runDistrokidRelease(
  release: DistrokidReleasePayload,
  cookies: RawCookie[],
  opts: { dryRun: boolean; log?: (msg: string) => void },
): Promise<NativeReleaseResult> {
  const log = opts.log ?? (() => {});
  const session = await openSession(cookies, log);
  try {
    // Bootstrap: clear CF, mint the release's albumuuid.
    const first = await loadNewAndScrapeGlobals(session.page, log);
    const albumuuid = first.albumuuid;
    log(`bootstrap ok: albumuuid=${albumuuid} meId=${first.meId} mode=${session.mode}`);

    // Artwork upload (fileNum=0) on the first page-load's fresh policy.
    const artUp = await uploadFileInPage(
      session.page,
      first,
      albumuuid,
      {
        buffer: release.artwork.imageBuffer,
        filename: release.artwork.imageFilename,
        contentType: release.artwork.imageContentType,
      },
      "0",
    );
    if (!artUp.ok || (artUp.status !== 204 && artUp.status !== 200)) {
      throw new Error(`artwork S3 POST returned ${artUp.status}: ${artUp.bodyHead}`);
    }
    log(`artwork uploaded: ${artUp.key}`);

    // Audio uploads (fileNum=1), each on a FRESH policy (re-load /new, pin albumuuid).
    const audioKeys: Record<number, string> = {};
    for (const t of release.tracks) {
      const fresh = await loadNewAndScrapeGlobals(session.page, log, { warmDashboard: false });
      const up = await uploadFileInPage(
        session.page,
        fresh,
        albumuuid,
        {
          buffer: t.audio.audioBuffer,
          filename: t.audio.audioFilename,
          contentType: t.audio.audioContentType,
        },
        "1",
      );
      if (!up.ok || (up.status !== 204 && up.status !== 200)) {
        throw new Error(`track ${t.trackNumber} audio S3 POST returned ${up.status}: ${up.bodyHead}`);
      }
      audioKeys[t.trackNumber] = up.key;
      log(`track ${t.trackNumber} audio uploaded: ${up.key}`);
    }

    const payload = buildDistroAlbumPayload(release, albumuuid, artUp.key, audioKeys);

    if (opts.dryRun) {
      log("dryRun stop — payload assembled, distroAlbumSave NOT called");
      return {
        albumuuid,
        meId: first.meId,
        mode: session.mode,
        artworkKey: artUp.key,
        audioKeys,
        payload,
        submitted: false,
      };
    }

    log("POSTing distroAlbumSave (IRREVERSIBLE)...");
    const resp = await doSave(session.page, payload, { allowSubmit: true });
    if (!saveOK(resp)) {
      throw new Error(`distroAlbumSave reported an error: ${resp.raw.slice(0, 300)}`);
    }
    const upc = extractUpc(resp);
    const releaseUrl = releaseUrlFrom(albumuuid, resp);
    log(`submitted: upc=${upc ?? "?"} url=${releaseUrl}`);
    return {
      albumuuid,
      meId: first.meId,
      mode: session.mode,
      artworkKey: artUp.key,
      audioKeys,
      payload,
      submitted: true,
      upc,
      releaseUrl,
      saveMessage: resp.MESSAGE,
    };
  } finally {
    await closeSession(session);
  }
}
