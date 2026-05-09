import "server-only";

// Pure HTTP client for RouteNote's Drupal forms — no browser, no Playwright.
// Replicates: create release, edit album, upload audio, upload artwork, manage stores.

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
  url?: string;
};

export type DistributeResult = {
  loggedIn: boolean;
  upc?: string;
  steps: DistributeStepResult[];
  cookies: CookieEntry[];
};

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const ROUTENOTE_HOSTS = ["www.routenote.com", "routenote.com", ".routenote.com"];

function cookiesToHeader(jar: CookieEntry[]): string {
  return jar
    .filter((c) => ROUTENOTE_HOSTS.some((h) => c.domain === h || c.domain.endsWith(h)))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

function parseSetCookie(line: string): CookieEntry | null {
  const parts = line.split(/;\s*/);
  if (!parts.length) return null;
  const [first, ...attrs] = parts;
  const eq = first.indexOf("=");
  if (eq < 0) return null;
  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1).trim();
  const ent: CookieEntry = { name, value, domain: "www.routenote.com", path: "/" };
  for (const a of attrs) {
    const [k, v] = a.split("=", 2).map((s) => (s ?? "").trim());
    if (!k) continue;
    const lk = k.toLowerCase();
    if (lk === "domain") ent.domain = v ?? ent.domain;
    else if (lk === "path") ent.path = v ?? "/";
    else if (lk === "httponly") ent.httpOnly = true;
    else if (lk === "secure") ent.secure = true;
    else if (lk === "samesite") ent.sameSite = v ?? "Lax";
    else if (lk === "expires" && v) {
      const t = Date.parse(v);
      if (!isNaN(t)) ent.expires = Math.floor(t / 1000);
    }
  }
  return ent;
}

function mergeJar(jar: CookieEntry[], res: Response): CookieEntry[] {
  // Node 18+ exposes getSetCookie; fall back to single value for older runtimes.
  type WithGetSetCookie = Headers & { getSetCookie?: () => string[] };
  const h = res.headers as WithGetSetCookie;
  const lines = h.getSetCookie ? h.getSetCookie() : [];
  if (lines.length === 0) {
    const single = res.headers.get("set-cookie");
    if (single) lines.push(single);
  }
  const next = [...jar];
  for (const line of lines) {
    const ent = parseSetCookie(line);
    if (!ent) continue;
    const idx = next.findIndex(
      (c) => c.name === ent.name && c.domain === ent.domain && c.path === ent.path,
    );
    if (idx >= 0) next[idx] = ent;
    else next.push(ent);
  }
  return next;
}

async function rnFetch(
  url: string,
  jar: CookieEntry[],
  init: RequestInit = {},
): Promise<{ res: Response; body: string; jar: CookieEntry[] }> {
  const baseHeaders: Record<string, string> = {
    "User-Agent": UA,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Cookie: cookiesToHeader(jar),
  };
  if (init.headers) Object.assign(baseHeaders, init.headers as Record<string, string>);
  const res = await fetch(url, {
    ...init,
    redirect: "manual",
    headers: baseHeaders,
  });
  const newJar = mergeJar(jar, res);
  let body = "";
  if (res.status >= 200 && res.status < 400 && (res.headers.get("content-type") || "").includes("text")) {
    body = await res.text();
  } else if (res.status >= 200 && res.status < 300) {
    body = await res.text().catch(() => "");
  }
  return { res, body, jar: newJar };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scrapeHidden(html: string, name: string): string | null {
  const safe = escapeRe(name);
  const re = new RegExp(`<input[^>]*name=["']${safe}["'][^>]*value=["']([^"']*)["']`, "i");
  const m = html.match(re);
  if (m) return m[1];
  const re2 = new RegExp(`<input[^>]*value=["']([^"']*)["'][^>]*name=["']${safe}["']`, "i");
  const m2 = html.match(re2);
  return m2 ? m2[1] : null;
}

function findUpcInBodyOrLocation(res: Response, body: string): string | null {
  const loc = res.headers.get("location") ?? "";
  const m = loc.match(/\/edit_album\/(\d{8,16})/);
  if (m) return m[1];
  const m2 = body.match(/\/edit_album\/(\d{8,16})/);
  return m2 ? m2[1] : null;
}

function findFormErrors(html: string): string[] {
  const errs: string[] = [];
  const errorBlock = html.match(/class=["']messages[^"']*error[^"']*["'][^>]*>([\s\S]{0,2000}?)<\/div>/i);
  if (errorBlock) errs.push(stripTags(errorBlock[1]).trim().slice(0, 240));
  const formErrs = [...html.matchAll(/class=["']form-error[^"']*["'][^>]*>([^<]{2,200})/g)];
  for (const m of formErrs) errs.push(m[1].trim());
  return errs.filter(Boolean);
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

async function getFormMeta(
  jar: CookieEntry[],
  url: string,
  formId: string,
): Promise<{ jar: CookieEntry[]; html: string; build: string; token: string }> {
  const r = await rnFetch(url, jar);
  if (r.res.status >= 300 && r.res.status < 400) {
    const loc = r.res.headers.get("location") ?? "";
    if (loc.toLowerCase().includes("/login")) throw new Error("auth-expired");
  }
  const build = scrapeHidden(r.body, "form_build_id");
  const token = scrapeHidden(r.body, "form_token");
  if (!build || !token) {
    throw new Error(`could not scrape form_build_id/form_token at ${url} (formId=${formId})`);
  }
  return { jar: r.jar, html: r.body, build, token };
}

async function postUrlencoded(
  jar: CookieEntry[],
  url: string,
  fields: Record<string, string>,
): Promise<{ res: Response; body: string; jar: CookieEntry[] }> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) sp.append(k, v);
  return rnFetch(url, jar, {
    method: "POST",
    body: sp.toString(),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://www.routenote.com",
      Referer: url,
    },
  });
}

async function postMultipart(
  jar: CookieEntry[],
  url: string,
  fields: Record<string, string>,
  files: Array<{ field: string; filename: string; contentType: string; data: Buffer }>,
): Promise<{ res: Response; body: string; jar: CookieEntry[] }> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const f of files) {
    // Copy into a fresh ArrayBuffer to satisfy TS's strict BlobPart typing
    const ab = new ArrayBuffer(f.data.byteLength);
    new Uint8Array(ab).set(f.data);
    fd.append(f.field, new Blob([ab], { type: f.contentType }), f.filename);
  }
  return rnFetch(url, jar, {
    method: "POST",
    body: fd,
    headers: {
      Origin: "https://www.routenote.com",
      Referer: url,
    },
  });
}

const ROUTENOTE_GENRES = ["Pop","Rock","Hip Hop","Electronic","Dance","Classical","Jazz","Country","Folk","R&B/Soul","Alternative","Indie","Reggae","Latin","Metal","Blues","Other"];
function pickGenre(g?: string): string {
  if (!g) return "Electronic";
  const m = ROUTENOTE_GENRES.find((x) => x.toLowerCase() === g.toLowerCase());
  if (m) return m;
  if (g.toLowerCase().includes("cinematic")) return "Classical";
  if (g.toLowerCase().includes("folk") || g.toLowerCase().includes("irish")) return "Folk";
  return "Electronic";
}

function futureDateISO(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * 86400 * 1000).toISOString().slice(0, 10);
}

export async function distributeRouteNoteHttp(
  input: DistributeInput,
  cookies: CookieEntry[],
  log: (step: string, detail?: string) => void = () => {},
): Promise<DistributeResult> {
  const steps: DistributeStepResult[] = [];
  const out: DistributeResult = { loggedIn: false, steps, cookies };
  let jar = cookies;

  // STEP 1: probe auth + get create_album form tokens
  log("auth:probe");
  let createMeta: { jar: CookieEntry[]; html: string; build: string; token: string };
  try {
    createMeta = await getFormMeta(jar, "https://www.routenote.com/rn/create_album", "create-album-form");
  } catch (e) {
    if ((e as Error).message === "auth-expired") {
      steps.push({ step: "auth", ok: false, detail: "cookies expired — re-bootstrap" });
      return out;
    }
    steps.push({ step: "auth", ok: false, detail: (e as Error).message });
    return out;
  }
  jar = createMeta.jar;
  out.loggedIn = true;

  // STEP 2: POST create_album with release date
  log("create:post");
  const releaseDate = input.releaseDate ?? futureDateISO(21);
  const cr = await postUrlencoded(jar, "https://www.routenote.com/rn/create_album", {
    edit_album_info_upc: "",
    edit_album_info_release: releaseDate,
    form_id: "create-album-form",
    form_build_id: createMeta.build,
    form_token: createMeta.token,
    album_save: "Create Release",
  });
  jar = cr.jar;
  const upc = findUpcInBodyOrLocation(cr.res, cr.body);
  if (!upc) {
    const errs = findFormErrors(cr.body);
    steps.push({ step: "create", ok: false, detail: `no UPC; status=${cr.res.status}; errors=${errs.join(" | ").slice(0, 240)}` });
    return out;
  }
  out.upc = upc;
  steps.push({ step: "create", ok: true, detail: `upc=${upc}` });
  log("create:ok", upc);

  // STEP 3: edit album details
  log("album:get-form");
  const editUrl = `https://www.routenote.com/rn/editalbum/${upc}`;
  const editMeta = await getFormMeta(jar, editUrl, "editalbum-form");
  jar = editMeta.jar;

  const language = input.language ?? "English";
  const genre = pickGenre(input.genre);
  const year = String(new Date().getFullYear());
  const firstName = input.artistName.split(" ")[0] || input.artistName;
  const lastName = input.artistName.split(" ").slice(1).join(" ") || "Artist";

  const albumFields: Record<string, string> = {
    edit_album_info_language: language,
    edit_album_info_title: input.title,
    edit_album_info_artist: input.artistName,
    edit_album_info_genre: genre,
    edit_album_info_label: input.artistName,
    cpy_year: year,
    cpy_name: input.artistName,
    edit_album_info_pcopyyear: year,
    edit_album_info_pcopyname: input.artistName,
    edit_album_first_composer: firstName,
    edit_album_last_composer: lastName,
    edit_album_first_contributor: input.artistName,
    edit_album_info_release: releaseDate,
    // Yes/No questions — choose "No" defaults
    No: "1",
    No1: "1",
    No3: "1",
    form_id: "editalbum-form",
    form_build_id: editMeta.build,
    form_token: editMeta.token,
    album_save: "Save and Continue",
  };
  if (input.explicit) {
    albumFields.Yes2 = "1";
    delete albumFields.No3;
  }

  log("album:post");
  const ar = await postUrlencoded(jar, editUrl, albumFields);
  jar = ar.jar;
  const albumOk = ar.res.status === 302 || (!findFormErrors(ar.body).length && !/messages.*error/i.test(ar.body));
  steps.push({ step: "album", ok: albumOk, detail: `status=${ar.res.status}; errors=${findFormErrors(ar.body).join(" | ").slice(0, 200) || "-"}` });

  // STEP 4: audio upload
  try {
    log("audio:get-form");
    const audioUrl = `https://www.routenote.com/rn/addaudiomp3/form/${upc}`;
    const audioMeta = await getFormMeta(jar, audioUrl, "addaudio");
    jar = audioMeta.jar;
    log("audio:post");
    const ur = await postMultipart(
      jar,
      audioUrl,
      {
        tracknio1: input.title,
        text_val: "",
        form_id: scrapeHidden(audioMeta.html, "form_id") ?? "",
        form_build_id: audioMeta.build,
        form_token: audioMeta.token,
        op: "Save and continue",
      },
      [
        {
          field: "files[audio]",
          filename: input.audioFilename,
          contentType: input.audioContentType,
          data: input.audioBuffer,
        },
      ],
    );
    jar = ur.jar;
    const audioOk = ur.res.status === 302 || (!findFormErrors(ur.body).length && !/messages.*error/i.test(ur.body));
    steps.push({ step: "audio", ok: audioOk, detail: `status=${ur.res.status}; errors=${findFormErrors(ur.body).join(" | ").slice(0, 200) || "-"}` });
  } catch (e) {
    steps.push({ step: "audio", ok: false, detail: (e as Error).message });
  }

  // STEP 5: artwork
  if (input.coverBuffer) {
    try {
      log("art:get-form");
      const artUrl = `https://www.routenote.com/rn/addart/form/${upc}`;
      const artMeta = await getFormMeta(jar, artUrl, "addart");
      jar = artMeta.jar;
      log("art:post");
      const cr2 = await postMultipart(
        jar,
        artUrl,
        {
          form_id: scrapeHidden(artMeta.html, "form_id") ?? "",
          form_build_id: artMeta.build,
          form_token: artMeta.token,
          op: "Save and continue",
        },
        [
          {
            field: "files[audio_images]",
            filename: input.coverFilename ?? "cover.jpg",
            contentType: "image/jpeg",
            data: input.coverBuffer,
          },
        ],
      );
      jar = cr2.jar;
      const artOk = cr2.res.status === 302 || (!findFormErrors(cr2.body).length && !/messages.*error/i.test(cr2.body));
      steps.push({ step: "art", ok: artOk, detail: `status=${cr2.res.status}; errors=${findFormErrors(cr2.body).join(" | ").slice(0, 200) || "-"}` });
    } catch (e) {
      steps.push({ step: "art", ok: false, detail: (e as Error).message });
    }
  }

  // STEP 6: stores
  try {
    log("stores:get-form");
    const storeUrl = `https://www.routenote.com/rn/addstore/form/${upc}`;
    const storeMeta = await getFormMeta(jar, storeUrl, "addstore");
    jar = storeMeta.jar;
    // collect all did<N> checkbox names
    const dids = [...new Set([...storeMeta.html.matchAll(/name=["'](did\d+)["']/g)].map((m) => m[1]))];
    const storeFields: Record<string, string> = {
      "edit-selall": "1",
      form_id: scrapeHidden(storeMeta.html, "form_id") ?? "",
      form_build_id: storeMeta.build,
      form_token: storeMeta.token,
      album_save: "Save and Continue",
    };
    for (const d of dids) storeFields[d] = "1";
    log("stores:post", `${dids.length} stores`);
    const sr = await postUrlencoded(jar, storeUrl, storeFields);
    jar = sr.jar;
    const storesOk = sr.res.status === 302 || (!findFormErrors(sr.body).length && !/messages.*error/i.test(sr.body));
    steps.push({ step: "stores", ok: storesOk, detail: `status=${sr.res.status}; ${dids.length} dids; errors=${findFormErrors(sr.body).join(" | ").slice(0, 200) || "-"}` });
  } catch (e) {
    steps.push({ step: "stores", ok: false, detail: (e as Error).message });
  }

  out.cookies = jar;
  return out;
}
