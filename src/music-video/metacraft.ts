/**
 * Music-video metadata engine — title + description + tags.
 *
 * Borrowed from youtube-studio-ai's golden METACRAFT module (Gemini-driven,
 * evidence-based via YouTube autocomplete), but tuned for MUSIC releases:
 * official-audio title conventions, mood-aware blurb, music discovery tags.
 *
 * KEY GUARANTEE: the LLM only writes prose (title/hook/blurb/tags). The real
 * streaming links, ISRC, label, hashtags and AI disclosure are appended
 * DETERMINISTICALLY from the resolved links — so every real platform the song
 * is live on always appears, and the model can never invent or drop a URL.
 *
 * Falls back to the deterministic builders if Gemini is unavailable, so an
 * upload is never blocked by the LLM.
 */
import { platformLabel, type PlatformKey, type ResolvedLinks } from "./links";
import { buildTitle, buildDescription, buildYouTubeTags, type VideoMeta } from "./tags";
import { getServiceSecrets } from "./vault";

const GEMINI_MODEL = "gemini-2.5-flash";
const LABEL = "Music House Productions";

async function geminiKey(): Promise<string | null> {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  try {
    return (await getServiceSecrets("gemini")).GEMINI_API_KEY ?? null;
  } catch {
    return null;
  }
}

async function geminiJson<T>(prompt: string, opts: { maxTokens?: number; temperature?: number } = {}): Promise<T> {
  const key = await geminiKey();
  if (!key) throw new Error("GEMINI_API_KEY unavailable");
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: opts.temperature ?? 0.7,
          maxOutputTokens: opts.maxTokens ?? 2048,
          // Disable "thinking" — on flash it eats the output budget and truncates
          // the JSON ("thinking starves small"), forcing the fallback.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    },
  );
  if (!r.ok) throw new Error(`gemini ${r.status}: ${(await r.text().catch(() => "")).slice(0, 120)}`);
  const j: any = await r.json();
  const text = (j?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? "").join("").trim();
  if (!text) throw new Error("gemini empty response");
  return JSON.parse(text) as T;
}

/** Real YouTube autocomplete queries for evidence (no key needed). */
export async function youtubeSuggest(seed: string): Promise<string[]> {
  try {
    const r = await fetch(
      `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(seed)}`,
    );
    const j: any = await r.json();
    return Array.isArray(j?.[1]) ? j[1].slice(0, 10) : [];
  } catch {
    return [];
  }
}

/** Order platforms are listed in; any extra Odesli keys are appended after. */
const PLATFORM_ORDER: PlatformKey[] = [
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

/** Listen block: the universal link + EVERY real platform link Odesli returned. */
export function renderListenBlock(links: ResolvedLinks): string[] {
  const lines: string[] = [];
  if (links.universal) {
    lines.push(`🎧 Listen everywhere: ${links.universal}`);
    lines.push("");
  }
  const keys: PlatformKey[] = [
    ...PLATFORM_ORDER,
    ...(Object.keys(links.byPlatform) as PlatformKey[]).filter((k) => !PLATFORM_ORDER.includes(k)),
  ];
  const seen = new Set<string>();
  const platformLines = keys
    .filter((p) => links.byPlatform[p] && !seen.has(p))
    .map((p) => {
      seen.add(p);
      return `• ${platformLabel(p)}: ${links.byPlatform[p]}`;
    });
  if (platformLines.length) {
    lines.push(...platformLines);
    lines.push("");
  }
  return lines;
}

function hashtagLine(meta: VideoMeta, isKaraoke: boolean): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const tags = [
    slug(meta.artist),
    slug(meta.title),
    meta.genre ? slug(meta.genre) : null,
    "musichouseproductions",
    isKaraoke ? "karaoke" : "officialaudio",
  ].filter(Boolean) as string[];
  return [...new Set(tags)].slice(0, 5).map((t) => `#${t}`).join(" ");
}

function dedupeTags(tags: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let total = 0;
  for (const raw of tags) {
    const tag = String(raw).trim().replace(/^#/, "").slice(0, 60);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    const add = tag.length + 2;
    if (out.length >= max || total + add > 480) break;
    seen.add(key);
    out.push(tag);
    total += add;
  }
  return out;
}

export type CraftedMusicMeta = {
  title: string;
  description: string;
  tags: string[];
  source: "gemini" | "fallback";
};

export type MusicMetaInput = VideoMeta & {
  lyricsSample?: string;
  variant?: "main" | "karaoke";
};

/**
 * Craft music-video metadata. Gemini writes the prose; the streaming links are
 * appended verbatim from `links` (all real platforms, always). Falls back to the
 * deterministic builders on any failure so uploads are never blocked.
 */
export async function craftMusicMetadata(
  meta: MusicMetaInput,
  links: ResolvedLinks,
  log: (m: string) => void = () => {},
): Promise<CraftedMusicMeta> {
  const isK = meta.variant === "karaoke";
  try {
    const suggests = await youtubeSuggest(`${meta.artist} ${meta.title}`);
    const gen = await geminiJson<{ title?: string; hook?: string; blurb?: string; tags?: string[] }>(
      [
        `Write YouTube metadata for a MUSIC video (official audio${isK ? " — KARAOKE/instrumental cut" : ""}).`,
        `SONG: "${meta.title}" | ARTIST: "${meta.artist}"${meta.album ? ` | RELEASE: "${meta.album}"` : ""}${meta.genre ? ` | GENRE: ${meta.genre}` : ""}.`,
        meta.lyricsSample ? `LYRICS EXCERPT (mood only — never reproduce in full):\n${meta.lyricsSample.slice(0, 400)}` : "",
        suggests.length ? `REAL YouTube search queries for this kind of song:\n- ${suggests.join("\n- ")}` : "",
        `RULES:`,
        `- title: standard music format like "${meta.artist} - ${meta.title} (${isK ? "Karaoke Instrumental" : "Official Audio"})" or a tasteful variant; <=95 chars; the real artist + song VERBATIM; no clickbait; never invent featured artists.`,
        `- hook: ONE short evocative line about the song's mood/vibe (no invented facts).`,
        `- blurb: 1-2 sentences (<=45 words) on the track's mood/genre for listeners; never invent collaborators, chart positions, or any fact not given above.`,
        `- tags: 22-28 lowercase discovery tags (artist, song, genre, mood, "music release"${isK ? ', "karaoke","instrumental","sing along"' : ', "official audio"'}, plus the real search queries). No "#".`,
        `Return STRICT JSON {"title":string,"hook":string,"blurb":string,"tags":string[]}.`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      { maxTokens: 2048, temperature: 0.7 },
    );

    const title = (gen.title || "").trim().slice(0, 100) || buildTitle(meta);
    const lines: string[] = [];
    if (gen.hook) lines.push(gen.hook.trim());
    lines.push(`${meta.title} by ${meta.artist} — official ${isK ? "karaoke (instrumental)" : "audio"}.`);
    if (gen.blurb) {
      lines.push("");
      lines.push(gen.blurb.trim());
    }
    lines.push("");
    lines.push(...renderListenBlock(links));
    if (meta.album && meta.album.toLowerCase() !== meta.title.toLowerCase()) lines.push(`From the release: ${meta.album}`);
    if (meta.isrc) lines.push(`ISRC: ${meta.isrc}`);
    lines.push("");
    lines.push(`Released by ${LABEL} — independent music.`);
    lines.push("Subscribe for new releases.");
    lines.push("");
    lines.push(hashtagLine(meta, isK));
    if (meta.aiDisclosure) {
      lines.push("");
      lines.push("This track was created with the assistance of AI.");
    }
    const description = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 4900);
    const tags = dedupeTags([...(gen.tags ?? []), isK ? "karaoke" : "official audio", "music release", meta.artist, meta.title], 30);
    if (tags.length < 5) throw new Error("too few tags from gemini");
    log(`metacraft(music): gemini ok — "${title}" (${tags.length} tags, ${Object.keys(links.byPlatform).length} links)`);
    return { title, description, tags, source: "gemini" };
  } catch (e) {
    log(`metacraft(music): fallback builders (${String((e as Error).message).slice(0, 90)})`);
    return {
      title: buildTitle(meta),
      description: buildDescription(meta, links),
      tags: buildYouTubeTags(meta),
      source: "fallback",
    };
  }
}
