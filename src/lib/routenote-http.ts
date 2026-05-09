import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdtemp, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Pure HTTP RouteNote client. Uses curl subprocess (Node fetch trips RouteNote's WAF).
// Three-stage audio upload protocol cracked 2026-05-09 — see
// memory/reference_routenote_http_methodology.md for the full reverse-engineering notes.
//
// Curl is shipped via the additionalPackages build extension in trigger.config.ts.

const execP = promisify(execFile);

export type CookieEntry = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
};

export type DistributeTrack = {
  audioBuffer: Buffer;
  audioFilename: string;
  audioContentType: string;
  title: string;
};

export type DistributeInput = {
  releaseType: "single" | "album";
  releaseTitle: string;             // for "single" set to the track title (RouteNote requires single title === track title)
  artistName: string;
  genre?: string;
  explicit?: boolean;
  language?: string;
  releaseDate?: string;
  tracks: DistributeTrack[];        // 1 for single, up to 15 for album
  coverBuffer?: Buffer;
  coverFilename?: string;
};

export type DistributeStepResult = { step: string; ok: boolean; detail?: string };

export type DistributeResult = {
  loggedIn: boolean;
  upc?: string;
  steps: DistributeStepResult[];
  liveViewUrl?: string;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const HOSTS = ["www.routenote.com", "routenote.com", ".routenote.com"];

export function buildCookieHeader(jar: CookieEntry[]): string {
  const filtered = jar.filter((c) =>
    HOSTS.some((h) => c.domain === h || c.domain.endsWith(h)),
  );
  // Last-write-wins by name (browsers only send the most recent cookie per name).
  const seen = new Map<string, CookieEntry>();
  for (const c of filtered) seen.set(c.name, c);
  return [...seen.values()].map((c) => `${c.name}=${c.value}`).join("; ");
}

type CurlResp = { status: number; location: string | null; body: string; head: string };

function parseCurl(raw: string): CurlResp {
  const blocks = raw.split(/(?=^HTTP\/[12](?:\.\d)?\s)/m).filter((b) => /^HTTP\/[12]/.test(b));
  const last = blocks[blocks.length - 1] || raw;
  const sepIdx = last.indexOf("\r\n\r\n") >= 0 ? last.indexOf("\r\n\r\n") : last.indexOf("\n\n");
  const sepLen = last.indexOf("\r\n\r\n") >= 0 ? 4 : 2;
  const head = last.slice(0, sepIdx);
  const body = last.slice(sepIdx + sepLen);
  const status = parseInt((head.match(/^HTTP\/[\d.]+\s+(\d+)/) || [])[1] || "0", 10);
  const location = (head.match(/^location:\s*(.+)$/im) || [])[1]?.trim() || null;
  return { status, location, body, head };
}

async function curlGet(cookieHeader: string, url: string, referer?: string): Promise<CurlResp> {
  const args = ["-sS", "-i", "-A", UA, url, "-H", `Cookie: ${cookieHeader}`];
  if (referer) args.push("-e", referer);
  const { stdout } = await execP("curl", args, { maxBuffer: 200 * 1024 * 1024 });
  return parseCurl(stdout);
}

async function curlPost(
  cookieHeader: string,
  url: string,
  fields: Record<string, string>,
  referer?: string,
): Promise<CurlResp> {
  const args = ["-sS", "-i", "-X", "POST", "-A", UA, url, "-H", `Cookie: ${cookieHeader}`];
  if (referer) args.push("-e", referer);
  args.push("-H", "Origin: https://www.routenote.com");
  for (const [k, v] of Object.entries(fields)) args.push("--data-urlencode", `${k}=${v}`);
  const { stdout } = await execP("curl", args, { maxBuffer: 200 * 1024 * 1024 });
  return parseCurl(stdout);
}

async function curlMultipart(
  cookieHeader: string,
  url: string,
  fields: Record<string, string>,
  files: Array<{ field: string; path: string; filename: string; contentType: string }>,
  referer?: string,
): Promise<CurlResp> {
  // Critical: do NOT pass `-c <jar>` — empirically that breaks multipart on RouteNote's WAF.
  const args = ["-sS", "-i", "-X", "POST", "-A", UA, url, "-H", `Cookie: ${cookieHeader}`];
  if (referer) args.push("-e", referer);
  args.push("-H", "Origin: https://www.routenote.com");
  for (const f of files) {
    args.push("-F", `${f.field}=@${f.path};type=${f.contentType};filename=${f.filename}`);
  }
  for (const [k, v] of Object.entries(fields)) args.push("-F", `${k}=${v}`);
  const { stdout } = await execP("curl", args, { maxBuffer: 200 * 1024 * 1024 });
  return parseCurl(stdout);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scrapeHidden(html: string, name: string): string | null {
  const safe = escapeRe(name);
  const m1 = html.match(new RegExp(`<input[^>]*name=["']${safe}["'][^>]*value=["']([^"']*)["']`, "i"));
  if (m1) return m1[1];
  const m2 = html.match(new RegExp(`<input[^>]*value=["']([^"']*)["'][^>]*name=["']${safe}["']`, "i"));
  return m2 ? m2[1] : null;
}

function findUpc(loc: string | null, body: string): string | null {
  const m = (loc || "").match(/\/edit_album\/(\d{8,16})/);
  if (m) return m[1];
  const m2 = body.match(/\/edit_album\/(\d{8,16})/);
  return m2 ? m2[1] : null;
}

function findFormErrors(html: string): string[] {
  const errs: string[] = [];
  const block = html.match(/class=["']messages[^"']*error[^"']*["'][^>]*>([\s\S]{0,2000}?)<\/div>/i);
  if (block) errs.push(block[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240));
  return errs.filter(Boolean);
}

function futureDateISO(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 86400000);
  return d.toISOString().slice(0, 10);
}

function pickGenre(g?: string): string {
  const map: Record<string, string> = {
    cinematic: "Classical", "film score": "Classical", folk: "Folk",
    electronic: "Electronic", rock: "Rock", pop: "Pop",
    "hip-hop": "Hip Hop", "hip hop": "Hip Hop", jazz: "Jazz",
    country: "Country", classical: "Classical", "r&b": "R&B/Soul",
    soul: "R&B/Soul", reggae: "Reggae", latin: "Latin", metal: "Metal",
    blues: "Blues", indie: "Indie", alternative: "Alternative", dance: "Dance",
  };
  if (!g) return "Other";
  return map[g.toLowerCase()] || "Other";
}

export async function distributeRouteNoteHttp(
  input: DistributeInput,
  cookies: CookieEntry[],
  log: (step: string, detail?: string) => void = () => {},
): Promise<DistributeResult> {
  const steps: DistributeStepResult[] = [];
  const out: DistributeResult = { loggedIn: false, steps };
  const cookieHeader = buildCookieHeader(cookies);

  // Stage tracks + cover to disk so curl can stream them as multipart files.
  const work = await mkdtemp(join(tmpdir(), "rn-"));
  const trackPaths: string[] = [];
  for (let i = 0; i < input.tracks.length; i++) {
    const t = input.tracks[i];
    const p = join(work, `track${i + 1}-${t.audioFilename || "audio.mp3"}`.replace(/[^a-zA-Z0-9._\- ]/g, "_"));
    await writeFile(p, t.audioBuffer);
    trackPaths.push(p);
  }
  let coverPath: string | null = null;
  if (input.coverBuffer) {
    coverPath = join(work, input.coverFilename || "cover.jpg");
    await writeFile(coverPath, input.coverBuffer);
  }

  // STEP 1: probe auth + scrape create_album form
  log("auth:probe");
  const cm = await curlGet(cookieHeader, "https://www.routenote.com/rn/create_album");
  if (!cm.body.includes('id="create-album-form"')) {
    steps.push({ step: "auth", ok: false, detail: "auth expired or WAF blocked — re-bootstrap cookies" });
    return out;
  }
  out.loggedIn = true;

  // STEP 2: create release
  log("create:post");
  const releaseDate = input.releaseDate ?? futureDateISO(21);
  const cr = await curlPost(
    cookieHeader,
    "https://www.routenote.com/rn/create_album",
    {
      edit_album_info_upc: "",
      edit_album_info_release: releaseDate,
      tersawsas: scrapeHidden(cm.body, "tersawsas") ?? "true",
      form_id: scrapeHidden(cm.body, "form_id") || "create_album_form",
      form_build_id: scrapeHidden(cm.body, "form_build_id") || "",
      form_token: scrapeHidden(cm.body, "form_token") || "",
      album_save: "Create Release",
    },
    "https://www.routenote.com/rn/create_album",
  );
  const upc = findUpc(cr.location, cr.body);
  if (!upc) {
    steps.push({
      step: "create",
      ok: false,
      detail: `no UPC; status=${cr.status}; errors=${findFormErrors(cr.body).join(" | ").slice(0, 200)}`,
    });
    return out;
  }
  out.upc = upc;
  out.liveViewUrl = `https://www.routenote.com/rn/edit_album/${upc}`;
  steps.push({ step: "create", ok: true, detail: `upc=${upc}` });

  const editUrl = `https://www.routenote.com/rn/editalbum/${upc}`;
  const audioFormUrl = `https://www.routenote.com/rn/addaudiomp3/form/${upc}`;

  // STEP 3: album metadata
  log("album:post");
  const em = await curlGet(cookieHeader, editUrl);
  const yr = String(new Date().getFullYear());
  const firstName = input.artistName.split(" ")[0] || input.artistName;
  const lastName = input.artistName.split(" ").slice(1).join(" ") || "Artist";
  const albumFields: Record<string, string> = {
    edit_album_info_language: input.language ?? "English",
    edit_album_info_title: input.releaseTitle,
    edit_album_info_artist: input.artistName,
    edit_album_info_genre: pickGenre(input.genre),
    edit_album_info_label: input.artistName,
    cpy_year: yr, cpy_name: input.artistName,
    edit_album_info_pcopyyear: yr, edit_album_info_pcopyname: input.artistName,
    edit_album_first_composer: firstName,
    edit_album_last_composer: lastName,
    edit_album_first_contributor: input.artistName,
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
  if (input.explicit) {
    albumFields.Yes2 = "1";
    delete albumFields.No3;
  }
  const ar = await curlPost(cookieHeader, editUrl, albumFields, editUrl);
  steps.push({
    step: "album",
    ok: ar.status === 302 || (!findFormErrors(ar.body).length && !/messages.*error/i.test(ar.body)),
    detail: `status=${ar.status}; errors=${findFormErrors(ar.body).join(" | ").slice(0, 200) || "-"}`,
  });

  // STEP 4: audio upload (three-stage protocol per track)
  for (let i = 0; i < input.tracks.length; i++) {
    const trackNum = i + 1;
    const t = input.tracks[i];
    log(`audio:track${trackNum}`);

    const am = await curlGet(cookieHeader, audioFormUrl);
    const tokenMatch = am.body.match(/cloud_upload\/([a-f0-9]{32})\//);
    const uploadToken = tokenMatch ? tokenMatch[1] : null;
    if (!uploadToken) {
      steps.push({ step: `audio${trackNum}`, ok: false, detail: "no cloud_upload token in HTML" });
      return out;
    }

    // Stage 1 — raw upload to current URL with field edit-OriginN
    await curlMultipart(
      cookieHeader,
      audioFormUrl,
      {},
      [{
        field: `edit-Origin${trackNum}`,
        path: trackPaths[i],
        filename: t.audioFilename,
        contentType: t.audioContentType,
      }],
      audioFormUrl,
    );

    // Stage 2 — finalize (returns success/error code from RouteNote's audio validator)
    const titleUrl = encodeURIComponent(audioFormUrl);
    const cloudUrl = `https://www.routenote.com/rn/cloud_upload/${uploadToken}/?track_id=edit-Origin${trackNum}&title=${titleUrl}`;
    const stage2 = await curlMultipart(
      cookieHeader,
      cloudUrl,
      {},
      [{
        field: "file",
        path: trackPaths[i],
        filename: t.audioFilename,
        contentType: t.audioContentType,
      }],
      audioFormUrl,
    );
    const stage2Status = (stage2.body || "").split(",")[1]?.trim() || "?";
    if (!/success/i.test(stage2Status)) {
      steps.push({
        step: `audio${trackNum}`,
        ok: false,
        detail: `stage2 rejected: "${stage2.body.slice(0, 120).trim()}" — file must be 320kbps MP3 @ 44.1kHz stereo, FLAC, or WAV`,
      });
      return out;
    }
  }

  // Stage 3 (per-form, all tracks together): commit form save with each tracknio<N>
  const am2 = await curlGet(cookieHeader, audioFormUrl);
  const commitFields: Record<string, string> = {
    form_id: scrapeHidden(am2.body, "form_id") || "addmp3_form",
    form_build_id: scrapeHidden(am2.body, "form_build_id") || "",
    form_token: scrapeHidden(am2.body, "form_token") || "",
    added: scrapeHidden(am2.body, "added") || "1",
    op: "Save and Continue",
  };
  for (let i = 0; i < input.tracks.length; i++) {
    commitFields[`tracknio${i + 1}`] = input.tracks[i].title;
  }
  const tersaAudio = scrapeHidden(am2.body, "tersawsas");
  if (tersaAudio !== null) commitFields.tersawsas = tersaAudio;
  const audioRes = await curlPost(cookieHeader, audioFormUrl, commitFields, audioFormUrl);
  steps.push({
    step: "audio:commit",
    ok: audioRes.status === 302 || /trackmetadata/i.test(audioRes.location || ""),
    detail: `status=${audioRes.status}; loc=${audioRes.location ?? "-"}`,
  });

  // STEP 5: artwork upload (RouteNote rejects when missing)
  if (coverPath) {
    log("art:post");
    const artUrl = `https://www.routenote.com/rn/addart/form/${upc}`;
    const artRes = await curlMultipart(
      cookieHeader,
      artUrl,
      { tersawsas: "true", addart_savbtn: "Save and Continue" },
      [{ field: "audio_images", path: coverPath, filename: input.coverFilename || "cover.jpg", contentType: "image/jpeg" }],
      artUrl,
    );
    steps.push({
      step: "art",
      ok: artRes.status === 302,
      detail: `status=${artRes.status}; loc=${artRes.location ?? "-"}`,
    });
  }

  // STEP 6: per-track metadata — echo all hidden inputs back, override key fields
  log("trackmeta:post");
  const tmUrl = `https://www.routenote.com/rn/trackmetadata/form/${upc}`;
  const tm = await curlGet(cookieHeader, tmUrl);
  const tmFields: Record<string, string> = {};
  const tmFormStart = tm.body.indexOf("<form");
  const tmFormEnd = tm.body.indexOf("</form>", tmFormStart);
  const tmFormHtml = tm.body.slice(tmFormStart, tmFormEnd);
  for (const m of tmFormHtml.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)) {
    if (m[1].startsWith("file[") || m[1] === "files[audio]") continue;
    if (!(m[1] in tmFields)) tmFields[m[1]] = m[2];
  }
  for (const sm of tmFormHtml.matchAll(/<select[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const sel = sm[2].match(/<option[^>]*selected[^>]*value="([^"]*)"/);
    if (sel) tmFields[sm[1]] = sel[1];
    else if (!(sm[1] in tmFields)) tmFields[sm[1]] = "";
  }
  for (let i = 0; i < input.tracks.length; i++) {
    const idx = i; // 0-based: audio_tags0, audio_tags1, ...
    const trk = input.tracks[i];
    tmFields[`audio_tags${idx}[title]`] = trk.title;
    tmFields[`audio_tags${idx}[trackno]`] = String(i + 1);
    tmFields[`audio_tags${idx}[role]`] = "Primary";
    tmFields[`audio_tags${idx}[artist]`] = input.artistName;
    tmFields[`edit_album_info_language${idx}`] = input.language ?? "English";
    tmFields[`edit_album_info_explicit${idx}`] = input.explicit ? "1" : "0";
  }
  tmFields.edit_album_first_composer = firstName;
  tmFields.edit_album_last_composer = lastName;
  tmFields.edit_album_first_contributor = input.artistName;
  tmFields.op = "Save and Continue";
  const tmRes = await curlPost(cookieHeader, tmUrl, tmFields, tmUrl);
  steps.push({
    step: "trackmeta",
    ok: tmRes.status === 302 || /confirm_upload/i.test(tmRes.location || ""),
    detail: `status=${tmRes.status}; loc=${tmRes.location ?? "-"}; errors=${findFormErrors(tmRes.body).join(" | ").slice(0, 200) || "-"}`,
  });

  // STEP 7: confirm upload (I'm Finished)
  log("confirm:post");
  const cuUrl = `https://www.routenote.com/rn/confirm_upload/form/${upc}`;
  const cu = await curlGet(cookieHeader, cuUrl);
  const cuFields: Record<string, string> = {
    op: "I'm Finished",
    form_id: scrapeHidden(cu.body, "form_id") || "confirm_upload_form",
    form_build_id: scrapeHidden(cu.body, "form_build_id") || "",
    form_token: scrapeHidden(cu.body, "form_token") || "",
  };
  const tersaCU = scrapeHidden(cu.body, "tersawsas");
  if (tersaCU !== null) cuFields.tersawsas = tersaCU;
  const cuRes = await curlPost(cookieHeader, cuUrl, cuFields, cuUrl);
  steps.push({
    step: "confirm",
    ok: cuRes.status === 302,
    detail: `status=${cuRes.status}; loc=${cuRes.location ?? "-"}`,
  });

  // STEP 8: stores — select all
  log("stores:post");
  const stUrl = `https://www.routenote.com/rn/addstore/form/${upc}`;
  const st = await curlGet(cookieHeader, stUrl);
  const dids = [...new Set([...st.body.matchAll(/name="(did\d+)"/g)].map((m) => m[1]))];
  const stFields: Record<string, string> = {
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
  const stRes = await curlPost(cookieHeader, stUrl, stFields, stUrl);
  steps.push({
    step: "stores",
    ok: stRes.status === 302,
    detail: `status=${stRes.status}; ${dids.length} stores`,
  });

  // Cleanup temp files (best effort)
  try {
    for (const p of trackPaths) await unlink(p).catch(() => {});
    if (coverPath) await unlink(coverPath).catch(() => {});
  } catch {}

  return out;
}
