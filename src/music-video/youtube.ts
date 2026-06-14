/**
 * Standalone YouTube Data API v3 client for the Music Video pipeline.
 *
 * Pure HTTP (no googleapis SDK), trigger-safe (no "server-only"). Patterned on
 * youtube-studio-ai/src/lib/youtube.ts. One refresh token == one channel, so a
 * per-channel token (Music House Records) is passed in; falls back to the
 * global YOUTUBE_REFRESH_TOKEN.
 *
 * Credentials resolve from process.env first, then the vault service "youtube":
 *   YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN
 */
import { readFile } from "node:fs/promises";
import { getServiceSecrets } from "./vault";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";
const API_BASE = "https://www.googleapis.com/youtube/v3";

export const YT_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.force-ssl",
];

async function creds(): Promise<{ clientId: string; clientSecret: string; refreshToken?: string }> {
  let clientId = process.env.YOUTUBE_CLIENT_ID;
  let clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  let refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;
  if (!clientId || !clientSecret) {
    const env = await getServiceSecrets("youtube");
    clientId ??= env.YOUTUBE_CLIENT_ID;
    clientSecret ??= env.YOUTUBE_CLIENT_SECRET;
    refreshToken ??= env.YOUTUBE_REFRESH_TOKEN;
  }
  if (!clientId || !clientSecret) throw new Error("YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET unavailable");
  return { clientId, clientSecret, refreshToken };
}

export async function getAccessToken(refreshToken?: string): Promise<string> {
  const c = await creds();
  const token = refreshToken ?? c.refreshToken;
  if (!token) throw new Error("No YouTube refresh token (channel not connected)");
  const body = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    refresh_token: token,
    grant_type: "refresh_token",
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`Token refresh failed: ${r.status} ${await r.text().catch(() => "")}`);
  const j = (await r.json()) as { access_token: string };
  return j.access_token;
}

export type UploadVideoArgs = {
  filePath: string;
  title: string;
  description: string;
  tags: string[];
  categoryId?: string; // default "10" (Music)
  privacyStatus?: "private" | "public" | "unlisted";
  publishAt?: string; // ISO8601 → scheduled publish (requires privacyStatus "private")
  refreshToken?: string;
  madeForKids?: boolean;
};

export type UploadResult = { videoId: string; url: string };

export async function uploadVideo(args: UploadVideoArgs): Promise<UploadResult> {
  const accessToken = await getAccessToken(args.refreshToken);
  const bytes = await readFile(args.filePath);

  const metadata = {
    snippet: {
      title: args.title.slice(0, 100),
      description: args.description.slice(0, 5000),
      tags: args.tags.slice(0, 30),
      categoryId: args.categoryId ?? "10",
    },
    status: {
      privacyStatus: args.privacyStatus ?? "private",
      ...(args.publishAt ? { publishAt: args.publishAt } : {}),
      selfDeclaredMadeForKids: args.madeForKids ?? false,
    },
  };

  // 1) initiate resumable session
  const init = await fetch(`${UPLOAD_URL}?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": "video/*",
      "x-upload-content-length": String(bytes.length),
    },
    body: JSON.stringify(metadata),
  });
  if (!init.ok) throw new Error(`Resumable init failed: ${init.status} ${await init.text().catch(() => "")}`);
  const location = init.headers.get("location");
  if (!location) throw new Error("Resumable init returned no upload URL");

  // 2) upload bytes
  const put = await fetch(location, {
    method: "PUT",
    headers: { "content-type": "video/*", "content-length": String(bytes.length) },
    body: new Uint8Array(bytes),
  });
  if (!put.ok) throw new Error(`Video upload failed: ${put.status} ${await put.text().catch(() => "")}`);
  const j = (await put.json()) as { id: string };
  return { videoId: j.id, url: `https://www.youtube.com/watch?v=${j.id}` };
}

/** Set a custom thumbnail (e.g. the album cover). Channel must be verified. */
export async function setVideoThumbnail(
  videoId: string,
  image: Buffer,
  contentType: string,
  refreshToken?: string,
): Promise<void> {
  const accessToken = await getAccessToken(refreshToken);
  const r = await fetch(
    `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": contentType },
      body: new Uint8Array(image),
    },
  );
  if (!r.ok) throw new Error(`Thumbnail set failed: ${r.status} ${await r.text().catch(() => "")}`);
}

// --- OAuth connect flow (used once by scripts/connect-music-house-records.ts) ---

export async function getConsentUrl(redirectUri: string, state = "music-house-records"): Promise<string> {
  const c = await creds();
  const p = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: YT_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    state,
  });
  return `${AUTH_URL}?${p.toString()}`;
}

export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string; accessToken: string }> {
  const c = await creds();
  const body = new URLSearchParams({
    code,
    client_id: c.clientId,
    client_secret: c.clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`Code exchange failed: ${r.status} ${await r.text().catch(() => "")}`);
  const j = (await r.json()) as { access_token: string; refresh_token?: string };
  if (!j.refresh_token) throw new Error("No refresh_token returned (revoke prior grant and retry with prompt=consent)");
  return { refreshToken: j.refresh_token, accessToken: j.access_token };
}

export async function getChannelMine(accessToken: string): Promise<{ id: string; title: string }> {
  const r = await fetch(`${API_BASE}/channels?part=snippet&mine=true`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(`channels.list failed: ${r.status} ${await r.text().catch(() => "")}`);
  const j = (await r.json()) as { items?: { id: string; snippet: { title: string } }[] };
  const item = j.items?.[0];
  if (!item) throw new Error("No channel found for this token");
  return { id: item.id, title: item.snippet.title };
}

/** Delete a video from the channel (used to replace a prior cut on re-upload). */
export async function deleteVideo(videoId: string, refreshToken?: string): Promise<void> {
  const accessToken = await getAccessToken(refreshToken);
  const r = await fetch(`${API_BASE}/videos?id=${encodeURIComponent(videoId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok && r.status !== 204) {
    throw new Error(`videos.delete ${r.status}: ${(await r.text().catch(() => "")).slice(0, 160)}`);
  }
}

/** Update an existing video's title/description/tags in place. */
export async function updateVideoMeta(
  videoId: string,
  meta: { title: string; description: string; tags: string[]; categoryId?: string },
  refreshToken?: string,
): Promise<void> {
  const accessToken = await getAccessToken(refreshToken);
  const r = await fetch(`${API_BASE}/videos?part=snippet`, {
    method: "PUT",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      id: videoId,
      snippet: {
        title: meta.title,
        description: meta.description,
        tags: meta.tags,
        categoryId: meta.categoryId ?? "10",
      },
    }),
  });
  if (!r.ok) throw new Error(`videos.update ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
}

/** Find a song's YouTube Music link via its auto-generated "- Topic" art track. */
export async function findYouTubeMusicLink(
  artist: string,
  title: string,
  refreshToken?: string,
): Promise<string | null> {
  try {
    const accessToken = await getAccessToken(refreshToken);
    const r = await fetch(
      `${API_BASE}/search?part=snippet&type=video&maxResults=10&q=${encodeURIComponent(`${artist} ${title}`)}`,
      { headers: { authorization: `Bearer ${accessToken}` } },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { items?: { id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string } }[] };
    const norm = (x: string) => (x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const wantT = norm(title);
    const wantA = norm(artist);
    for (const it of j.items ?? []) {
      const ch = it.snippet?.channelTitle ?? "";
      const ti = it.snippet?.title ?? "";
      const vid = it.id?.videoId;
      if (vid && /-\s*topic$/i.test(ch) && norm(ti).includes(wantT) && norm(ch).includes(wantA)) {
        return `https://music.youtube.com/watch?v=${vid}`;
      }
    }
    return null;
  } catch {
    return null;
  }
}
