import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Pure HTTP RouteNote client. Uses `curl` subprocess (not Node fetch) because
// RouteNote's WAF rejects Node fetch — tripped TLS/HTTP version check.
// See memory/reference_routenote_http_methodology.md for the field-by-field
// gotchas this implementation works around.

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

export type DistributeInput = {
  audioBuffer: Buffer;
  audioFilename: string;
  audioContentType: string;
  coverBuffer?: Buffer;
  coverFilename?: string;
  title: string;
  artistName: string;
  genre?: string;
  explicit?: boolean;
  language?: string;
  releaseDate?: string;
};

export type DistributeStepResult = {
  step: string;
  ok: boolean;
  detail?: string;
};

export type DistributeResult = {
  loggedIn: boolean;
  upc?: string;
  steps: DistributeStepResult[];
  cookies: CookieEntry[];
  liveViewUrl?: string;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const ROUTENOTE_HOSTS = ["www.routenote.com", "routenote.com", ".routenote.com"];

function buildCookieHeader(jar: CookieEntry[]): string {
  const filtered = jar.filter((c) =>
    ROUTENOTE_HOSTS.some((h) => c.domain === h || c.domain.endsWith(h)),
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
  const m = head.match(/^HTTP\/[\d.]+\s+(\d+)/);
  const locM = head.match(/^location:\s*(.+)$/im);
  return {
    status: m ? parseInt(m[1], 10) : 0,
    location: locM ? locM[1].trim() : null,
    body,
    head,
  };
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
  // Critical: do NOT pass `-c <jar>`. Empirically that breaks multipart on this WAF.
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
  const re1 = new RegExp(`<input[^>]*name=["']${safe}["'][^>]*value=["']([^"']*)["']`, "i");
  const m1 = html.match(re1);
  if (m1) return m1[1];
  const re2 = new RegExp(`<input[^>]*value=["']([^"']*)["'][^>]*name=["']${safe}["']`, "i");
  const m2 = html.match(re2);
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
  if (block) {
    errs.push(
      block[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240),
    );
  }
  const formErrs = [...html.matchAll(/class=["']form-error[^"']*["'][^>]*>([^<]{2,200})/g)];
  for (const m of formErrs) errs.push(m[1].trim());
  return errs.filter(Boolean);
}

function futureDateISO(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 86400000);
  return d.toISOString().slice(0, 10);
}

function pickGenre(g?: string): string {
  // Genres confirmed valid in RouteNote autocomplete. Anything else falls back to "Other".
  const map: Record<string, string> = {
    cinematic: "Classical",
    "film score": "Classical",
    folk: "Folk",
    electronic: "Electronic",
    rock: "Rock",
    pop: "Pop",
    "hip-hop": "Hip Hop",
    "hip hop": "Hip Hop",
    jazz: "Jazz",
    country: "Country",
    classical: "Classical",
    "r&b": "R&B/Soul",
    soul: "R&B/Soul",
    reggae: "Reggae",
    latin: "Latin",
    metal: "Metal",
    blues: "Blues",
    indie: "Indie",
    alternative: "Alternative",
    dance: "Dance",
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
  const out: DistributeResult = { loggedIn: false, steps, cookies };
  const cookieHeader = buildCookieHeader(cookies);

  // Stage audio + cover to disk so curl can stream them as multipart files.
  const work = await mkdtemp(join(tmpdir(), "rn-"));
  const audioPath = join(work, input.audioFilename || "audio.mp3");
  await writeFile(audioPath, input.audioBuffer);
  let coverPath: string | null = null;
  if (input.coverBuffer) {
    coverPath = join(work, input.coverFilename || "cover.jpg");
    await writeFile(coverPath, input.coverBuffer);
  }

  // STEP 1: probe auth + scrape create_album form
  log("auth:probe");
  const cm = await curlGet(cookieHeader, "https://www.routenote.com/rn/create_album");
  if (cm.status >= 300 && cm.status < 400 && (cm.location || "").toLowerCase().includes("/login")) {
    steps.push({ step: "auth", ok: false, detail: "cookies expired — re-bootstrap" });
    return out;
  }
  if (!cm.body.includes('id="create-album-form"')) {
    steps.push({ step: "auth", ok: false, detail: "create_album form not in response (WAF block?)" });
    return out;
  }
  out.loggedIn = true;

  // STEP 2: create release
  log("create:post");
  const releaseDate = input.releaseDate ?? futureDateISO(21);
  const tersaCreate = scrapeHidden(cm.body, "tersawsas") ?? "true";
  const createRes = await curlPost(
    cookieHeader,
    "https://www.routenote.com/rn/create_album",
    {
      edit_album_info_upc: "",
      edit_album_info_release: releaseDate,
      tersawsas: tersaCreate,
      form_id: scrapeHidden(cm.body, "form_id") || "create_album_form",
      form_build_id: scrapeHidden(cm.body, "form_build_id") || "",
      form_token: scrapeHidden(cm.body, "form_token") || "",
      album_save: "Create Release",
    },
    "https://www.routenote.com/rn/create_album",
  );
  const upc = findUpc(createRes.location, createRes.body);
  if (!upc) {
    steps.push({
      step: "create",
      ok: false,
      detail: `no UPC; status=${createRes.status}; errors=${findFormErrors(createRes.body).join(" | ").slice(0, 200)}`,
    });
    return out;
  }
  out.upc = upc;
  out.liveViewUrl = `https://www.routenote.com/rn/edit_album/${upc}`;
  steps.push({ step: "create", ok: true, detail: `upc=${upc}` });
  log("create:ok", upc);

  const editUrl = `https://www.routenote.com/rn/editalbum/${upc}`;

  // STEP 3: album metadata
  log("album:get-form");
  const em = await curlGet(cookieHeader, editUrl);
  log("album:post");
  const yr = String(new Date().getFullYear());
  const artistName = input.artistName;
  const firstName = artistName.split(" ")[0] || artistName;
  const lastName = artistName.split(" ").slice(1).join(" ") || "Artist";

  const albumFields: Record<string, string> = {
    edit_album_info_language: input.language ?? "English",
    edit_album_info_title: input.title,
    edit_album_info_artist: artistName,
    edit_album_info_genre: pickGenre(input.genre),
    edit_album_info_label: artistName,
    cpy_year: yr,
    cpy_name: artistName,
    edit_album_info_pcopyyear: yr,
    edit_album_info_pcopyname: artistName,
    edit_album_first_composer: firstName,
    edit_album_last_composer: lastName,
    edit_album_first_contributor: artistName,
    edit_album_info_release: releaseDate,
    edit_album_info_org_date: releaseDate,
    No: "1",
    No1: "1",
    No3: "1",
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
  const albumRes = await curlPost(cookieHeader, editUrl, albumFields, editUrl);
  const albumOk = albumRes.status === 302 || (!findFormErrors(albumRes.body).length && !/messages.*error/i.test(albumRes.body));
  steps.push({
    step: "album",
    ok: albumOk,
    detail: `status=${albumRes.status}; errors=${findFormErrors(albumRes.body).join(" | ").slice(0, 200) || "-"}`,
  });

  // STEP 4: audio upload — three-stage protocol cracked 2026-05-09:
  //   stage 1: POST file to addaudiomp3/form/<UPC> with field edit-Origin1 (raw upload)
  //   stage 2: POST file to /rn/cloud_upload/<TOKEN>/?track_id=edit-Origin1&title=<URL> with field "file" (finalize/process)
  //   stage 3: POST urlencoded form save with tracknio1, op=Save and Continue (commits track row)
  // Audio MUST be 320 kbps + 44.1 kHz + stereo for MP3, otherwise stage 2 errors out.
  try {
    log("audio:post");
    const audioUrl = `https://www.routenote.com/rn/addaudiomp3/form/${upc}`;
    const am = await curlGet(cookieHeader, audioUrl);

    // Scrape the per-user upload token from the form HTML.
    const tokenMatch = am.body.match(/cloud_upload\/([a-f0-9]{32})\//);
    const uploadToken = tokenMatch ? tokenMatch[1] : null;
    if (!uploadToken) {
      steps.push({ step: "audio", ok: false, detail: "no cloud_upload token in form HTML" });
      throw new Error("no cloud_upload token");
    }

    // Stage 1
    const stage1 = await curlMultipart(
      cookieHeader,
      audioUrl,
      {},
      [{ field: "edit-Origin1", path: audioPath, filename: input.audioFilename, contentType: input.audioContentType }],
      audioUrl,
    );

    // Stage 2 — finalize (this is the call that returns success/error code from RouteNote's audio validator)
    const titleUrl = encodeURIComponent(audioUrl);
    const cloudUrl = `https://www.routenote.com/rn/cloud_upload/${uploadToken}/?track_id=edit-Origin1&title=${titleUrl}`;
    const stage2 = await curlMultipart(
      cookieHeader,
      cloudUrl,
      {},
      [{ field: "file", path: audioPath, filename: input.audioFilename, contentType: input.audioContentType }],
      audioUrl,
    );
    // stage2 body is plain text like "edit-Origin1,success" or "edit-Origin1,bitrate too low"
    const stage2Status = (stage2.body || "").split(",")[1]?.trim() || "?";
    if (!/success/i.test(stage2Status)) {
      steps.push({ step: "audio", ok: false, detail: `stage2 rejected: ${stage2.body.slice(0, 120)}` });
      throw new Error("audio rejected: " + stage2Status);
    }

    // Stage 3 — commit the form (creates the track row)
    const am2 = await curlGet(cookieHeader, audioUrl);
    const audioFields: Record<string, string> = {
      tracknio1: input.title,
      form_id: scrapeHidden(am2.body, "form_id") || "addmp3_form",
      form_build_id: scrapeHidden(am2.body, "form_build_id") || "",
      form_token: scrapeHidden(am2.body, "form_token") || "",
      added: scrapeHidden(am2.body, "added") || "1",
      op: "Save and Continue",
    };
    const tersaAudio = scrapeHidden(am2.body, "tersawsas");
    if (tersaAudio !== null) audioFields.tersawsas = tersaAudio;
    const audioRes = await curlPost(cookieHeader, audioUrl, audioFields, audioUrl);
    const audioOk = audioRes.status === 302 || /trackmetadata/i.test(audioRes.location || "");
    steps.push({
      step: "audio",
      ok: audioOk,
      detail: `stage1=${stage1.status} stage2=${stage2Status} commit=${audioRes.status} loc=${audioRes.location ?? "-"}`,
    });
  } catch (e) {
    steps.push({ step: "audio", ok: false, detail: (e as Error).message });
  }

  // STEP 5: artwork upload
  if (coverPath) {
    try {
      log("art:post");
      const artUrl = `https://www.routenote.com/rn/addart/form/${upc}`;
      const artRes = await curlMultipart(
        cookieHeader,
        artUrl,
        { tersawsas: "true", addart_savbtn: "Save and Continue" },
        [
          {
            field: "audio_images",
            path: coverPath,
            filename: input.coverFilename || "cover.jpg",
            contentType: "image/jpeg",
          },
        ],
        artUrl,
      );
      const artOk = artRes.status === 302;
      steps.push({
        step: "art",
        ok: artOk,
        detail: `status=${artRes.status}; loc=${artRes.location ?? "-"}`,
      });
    } catch (e) {
      steps.push({ step: "art", ok: false, detail: (e as Error).message });
    }
  }

  // STEP 6: per-track metadata
  try {
    log("trackmeta:post");
    const tmUrl = `https://www.routenote.com/rn/trackmetadata/form/${upc}`;
    const tm = await curlGet(cookieHeader, tmUrl);
    // Echo back every existing form input value so we don't lose hidden defaults (ISRC etc.)
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
    tmFields["audio_tags0[title]"] = input.title;
    tmFields["audio_tags0[trackno]"] = "1";
    tmFields["audio_tags0[role]"] = "Primary";
    tmFields["audio_tags0[artist]"] = artistName;
    tmFields.edit_album_first_composer = firstName;
    tmFields.edit_album_last_composer = lastName;
    tmFields.edit_album_first_contributor = artistName;
    tmFields.edit_album_info_language0 = input.language ?? "English";
    tmFields.edit_album_info_explicit0 = input.explicit ? "1" : "0";
    tmFields.op = "Save and Continue";
    const tmRes = await curlPost(cookieHeader, tmUrl, tmFields, tmUrl);
    const tmOk = tmRes.status === 302 || /confirm_upload/i.test(tmRes.location || "");
    steps.push({
      step: "trackmeta",
      ok: tmOk,
      detail: `status=${tmRes.status}; loc=${tmRes.location ?? "-"}; errors=${findFormErrors(tmRes.body).join(" | ").slice(0, 200) || "-"}`,
    });
  } catch (e) {
    steps.push({ step: "trackmeta", ok: false, detail: (e as Error).message });
  }

  // STEP 7: confirm upload (I'm Finished)
  try {
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
  } catch (e) {
    steps.push({ step: "confirm", ok: false, detail: (e as Error).message });
  }

  // STEP 8: store selection (select all)
  try {
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
      detail: `status=${stRes.status}; ${dids.length} stores; errors=${findFormErrors(stRes.body).join(" | ").slice(0, 100) || "-"}`,
    });
  } catch (e) {
    steps.push({ step: "stores", ok: false, detail: (e as Error).message });
  }

  return out;
}
