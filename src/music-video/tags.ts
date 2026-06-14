/**
 * YouTube metadata builders for the Music Video pipeline:
 * title, description (with "listen everywhere" links), and discovery tags.
 */
import { platformLabel, type PlatformKey, type ResolvedLinks } from "./links";

export type VideoMeta = {
  title: string;
  artist: string;
  album?: string;
  genre?: string;
  isrc?: string;
  aiDisclosure?: boolean;
};

const LABEL = "Music House Productions";

export function buildTitle(meta: VideoMeta): string {
  return `${meta.title} — ${meta.artist} (Official Audio)`.slice(0, 100);
}

/** Ordered list of platforms to surface in the description. */
const DESC_ORDER: PlatformKey[] = [
  "spotify",
  "appleMusic",
  "youtubeMusic",
  "amazonMusic",
  "deezer",
  "tidal",
  "soundcloud",
  "pandora",
  "youtube",
];

export function buildDescription(meta: VideoMeta, links: ResolvedLinks): string {
  const lines: string[] = [];
  lines.push(`${meta.title} by ${meta.artist} — official audio.`);
  lines.push("");
  if (links.universal) {
    lines.push(`🎧 Listen everywhere: ${links.universal}`);
    lines.push("");
  }
  const platformLines = DESC_ORDER.filter((p) => links.byPlatform[p]).map(
    (p) => `• ${platformLabel(p)}: ${links.byPlatform[p]}`,
  );
  if (platformLines.length) {
    lines.push(...platformLines);
    lines.push("");
  }
  if (meta.album && meta.album.toLowerCase() !== meta.title.toLowerCase()) {
    lines.push(`From the release: ${meta.album}`);
  }
  if (meta.isrc) lines.push(`ISRC: ${meta.isrc}`);
  lines.push("");
  lines.push(`Released by ${LABEL} — independent music.`);
  lines.push("Subscribe for new releases.");
  lines.push("");
  lines.push(hashtagLine(meta));
  if (meta.aiDisclosure) {
    lines.push("");
    lines.push("This track was created with the assistance of AI.");
  }
  return lines.join("\n").slice(0, 4900);
}

function hashtagLine(meta: VideoMeta): string {
  const tags = [
    slugHash(meta.artist),
    slugHash(meta.title),
    meta.genre ? slugHash(meta.genre) : null,
    "musichouseproductions",
    "officialaudio",
  ].filter(Boolean);
  return [...new Set(tags)].slice(0, 5).map((t) => `#${t}`).join(" ");
}

function slugHash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Discovery tags for the YouTube `snippet.tags` field.
 * Deduped, clamped to 30 tags and ~480 chars total (YouTube's hard limit is 500).
 */
export function buildYouTubeTags(meta: VideoMeta): string[] {
  const genre = meta.genre?.trim();
  const candidates: string[] = [
    meta.artist,
    meta.title,
    `${meta.title} ${meta.artist}`,
    meta.album && meta.album !== meta.title ? meta.album : "",
    genre ?? "",
    genre ? `${genre} music` : "",
    genre ? `${genre} 2026` : "",
    "official audio",
    `${meta.artist} official audio`,
    "music house productions",
    "new music 2026",
    "new release",
    "indie music",
    "lyric video",
    "visualizer",
    "music video",
  ].filter((t): t is string => Boolean(t && t.trim()));

  const seen = new Set<string>();
  const out: string[] = [];
  let total = 0;
  for (const raw of candidates) {
    const tag = raw.trim().slice(0, 60);
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    const add = tag.length + 2; // YouTube counts quotes/commas roughly
    if (out.length >= 30 || total + add > 480) break;
    seen.add(key);
    out.push(tag);
    total += add;
  }
  return out;
}
