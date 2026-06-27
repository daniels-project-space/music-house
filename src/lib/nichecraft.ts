import "server-only";
import { callClaude } from "./anthropic";

/**
 * Niche Intelligence — demand-first creation.
 *
 * Replicates the "niche overview" step of the AI-music monetization workflow:
 * given a seed niche ("outlaw country rap"), produce the grounding object the
 * writer needs — canonical DistroKid genres, themes, instruments, BPM, reference
 * artists, and ready-to-paste style prompts. Two signals are combined:
 *   1. Claude (Sonnet) — domain knowledge of the niche's conventions.
 *   2. YouTube autocomplete — free "what people actually search" expansion
 *      (the spirit of vidIQ/keyword research, no paid tool or API key).
 *
 * The genre fields are constrained to DistroKid's upload taxonomy so the value
 * can flow straight into the distribution payload (Spotify clusters on genre).
 */

// DistroKid's release-genre taxonomy. The niche's primary/secondary genre MUST be
// one of these so distribute-*-distrokid.ts can pass them through verbatim.
export const DISTROKID_GENRES = [
  "Alternative",
  "Big Band",
  "Blues",
  "Children's Music",
  "Classical",
  "Comedy",
  "Country",
  "Dance",
  "Electronic",
  "Folk",
  "Gospel/Religious",
  "Hip Hop/Rap",
  "Holiday",
  "Jazz",
  "Latin",
  "Metal",
  "New Age",
  "Pop",
  "Punk",
  "R&B",
  "Reggae",
  "Rock",
  "Singer/Songwriter",
  "Soundtrack",
  "Spoken Word",
  "Vocal",
  "World",
] as const;

export type NicheOverview = {
  slug: string;
  name: string;
  seed: string;
  primaryGenre: string;
  secondaryGenre?: string;
  stylePrompts: string[];
  themes: string[];
  moods: string[];
  instruments: string[];
  culturalTags: string[];
  referenceArtists: string[];
  relatedSearches: string[];
  bpmMin?: number;
  bpmMax?: number;
  keys?: string[];
  competition?: string;
  productionNotes?: string;
  overviewText: string;
};

export function slugifyNiche(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

const SYSTEM = `You are a music A&R and streaming-SEO strategist. Given a niche/sub-genre seed, return a rigorous "niche overview" used to make and market AI-assisted music.

Return ONLY a JSON object (no prose, no markdown fences) with EXACTLY these keys:
{
  "name": string,                 // clean title-case name of the niche
  "primaryGenre": string,         // MUST be one of the allowed DistroKid genres
  "secondaryGenre": string,       // MUST be one of the allowed DistroKid genres (or "")
  "stylePrompts": string[],       // 5 ready-to-paste Suno/Mureka style prompts, 20-40 words each: instruments, era, vocal style, production texture, mood
  "themes": string[],             // 6-10 lyrical themes that resonate in this niche
  "moods": string[],              // 4-8 mood words (for the Spotify pitch form)
  "instruments": string[],        // 5-10 essential instruments/sounds
  "culturalTags": string[],       // 4-8 cultural/context tags for the Spotify pitch form
  "referenceArtists": string[],   // 4-8 real reference artists who define the sound (for STYLE reference only, never to imitate)
  "bpmMin": number,               // typical low BPM
  "bpmMax": number,               // typical high BPM
  "keys": string[],               // 2-5 common keys/scales
  "competition": string,          // "low" | "medium" | "high" — your honest read of how saturated this niche is on streaming
  "productionNotes": string       // 1-3 sentences of mix/production guidance
}

Allowed DistroKid genres (choose the closest fit for primaryGenre/secondaryGenre): ${DISTROKID_GENRES.join(", ")}.

Rules:
- referenceArtists are for capturing the SOUND only. The lyrics/output must be original personas — never imitate a real artist's name, voice, song titles, or likeness.
- stylePrompts must be concrete and immediately usable in Suno/Mureka.
- Be specific to the niche, not generic.`;

function extractJson(text: string): Record<string, unknown> {
  let t = text.trim();
  // Strip ```json fences if present.
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("model did not return JSON");
  }
  return JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean);
}

function coerceGenre(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  // Exact match first, then case-insensitive, else return as-is (best effort).
  const exact = DISTROKID_GENRES.find((g) => g === s);
  if (exact) return exact;
  const ci = DISTROKID_GENRES.find((g) => g.toLowerCase() === s.toLowerCase());
  return ci ?? s;
}

// Free "what people search" signal — YouTube autocomplete. No API key. Best-effort:
// any failure just yields an empty list, the niche is still useful without it.
async function youtubeAutocomplete(seed: string): Promise<string[]> {
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(
      seed,
    )}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return [];
    const data = (await r.json()) as [string, string[]];
    const suggestions = Array.isArray(data?.[1]) ? data[1] : [];
    return suggestions
      .map((s) => String(s).trim())
      .filter((s) => s && s.toLowerCase() !== seed.toLowerCase())
      .slice(0, 12);
  } catch {
    return [];
  }
}

function buildOverviewText(o: Omit<NicheOverview, "overviewText">): string {
  const lines: string[] = [];
  lines.push(`# Niche Overview — ${o.name}`, "");
  lines.push(`Seed: ${o.seed}`);
  lines.push(
    `Genre: ${o.primaryGenre}${o.secondaryGenre ? ` / ${o.secondaryGenre}` : ""}`,
  );
  if (o.bpmMin && o.bpmMax) lines.push(`BPM: ${o.bpmMin}–${o.bpmMax}`);
  if (o.keys?.length) lines.push(`Keys: ${o.keys.join(", ")}`);
  if (o.competition) lines.push(`Competition: ${o.competition}`);
  lines.push("");
  lines.push("## Themes", o.themes.map((t) => `- ${t}`).join("\n"), "");
  lines.push("## Moods", o.moods.join(", "), "");
  lines.push("## Essential instruments", o.instruments.map((t) => `- ${t}`).join("\n"), "");
  lines.push(
    "## Reference artists (sound only — never imitate)",
    o.referenceArtists.map((t) => `- ${t}`).join("\n"),
    "",
  );
  lines.push("## Cultural / pitch tags", o.culturalTags.join(", "), "");
  if (o.relatedSearches.length)
    lines.push("## Related searches (YouTube autocomplete)", o.relatedSearches.map((t) => `- ${t}`).join("\n"), "");
  lines.push("## Ready style prompts");
  o.stylePrompts.forEach((p, i) => lines.push(`${i + 1}. ${p}`));
  if (o.productionNotes) lines.push("", "## Production notes", o.productionNotes);
  return lines.join("\n");
}

export async function researchNiche(seed: string): Promise<NicheOverview> {
  const cleanSeed = seed.trim();
  if (!cleanSeed) throw new Error("seed required");

  // Run the model + the free autocomplete signal concurrently.
  const [raw, related] = await Promise.all([
    callClaude({
      system: SYSTEM,
      user: `Niche seed: "${cleanSeed}". Produce the niche overview JSON now.`,
      model: "claude-sonnet-4-6",
      maxTokens: 2000,
    }),
    youtubeAutocomplete(cleanSeed),
  ]);

  const j = extractJson(raw);
  const name = String(j.name ?? cleanSeed).trim() || cleanSeed;
  const secondary = coerceGenre(j.secondaryGenre);

  const base: Omit<NicheOverview, "overviewText"> = {
    slug: slugifyNiche(name),
    name,
    seed: cleanSeed,
    primaryGenre: coerceGenre(j.primaryGenre) || "Pop",
    secondaryGenre: secondary || undefined,
    stylePrompts: asStringArray(j.stylePrompts).slice(0, 5),
    themes: asStringArray(j.themes),
    moods: asStringArray(j.moods),
    instruments: asStringArray(j.instruments),
    culturalTags: asStringArray(j.culturalTags),
    referenceArtists: asStringArray(j.referenceArtists),
    relatedSearches: related,
    bpmMin: typeof j.bpmMin === "number" ? j.bpmMin : undefined,
    bpmMax: typeof j.bpmMax === "number" ? j.bpmMax : undefined,
    keys: asStringArray(j.keys),
    competition: j.competition ? String(j.competition).toLowerCase() : undefined,
    productionNotes: j.productionNotes ? String(j.productionNotes) : undefined,
  };

  return { ...base, overviewText: buildOverviewText(base) };
}

/**
 * Compact grounding block injected into the lyric-writer prompt when a niche is
 * selected. Keeps the writer on-niche (themes, instruments, reference sound)
 * without dumping the whole overview.
 */
export function nicheGroundingBlock(n: {
  name: string;
  primaryGenre: string;
  secondaryGenre?: string;
  themes: string[];
  moods: string[];
  instruments: string[];
  referenceArtists: string[];
  bpmMin?: number;
  bpmMax?: number;
}): string {
  const parts: string[] = [];
  parts.push(`NICHE: ${n.name} (${n.primaryGenre}${n.secondaryGenre ? ` / ${n.secondaryGenre}` : ""}).`);
  if (n.themes.length) parts.push(`Themes that resonate: ${n.themes.join("; ")}.`);
  if (n.moods.length) parts.push(`Moods: ${n.moods.join(", ")}.`);
  if (n.instruments.length) parts.push(`Sonic palette: ${n.instruments.join(", ")}.`);
  if (n.bpmMin && n.bpmMax) parts.push(`Tempo feel: ${n.bpmMin}-${n.bpmMax} BPM.`);
  if (n.referenceArtists.length)
    parts.push(
      `Match the WRITING STYLE/cadence of this niche (artists for reference only, never imitate or name them): ${n.referenceArtists.join(", ")}.`,
    );
  parts.push("Write an ORIGINAL song that fits this niche's conventions and lyrical world.");
  return parts.join("\n");
}
