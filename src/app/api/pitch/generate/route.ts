import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import { callClaude } from "../../../../lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Generates the copy a human pastes into the Spotify for Artists pitch form
 * (genres, moods, instruments, similar artists, and the ~500-char "why this song
 * is special" story). That pitch is what feeds Release Radar / algorithmic
 * targeting — the one lever a distributor can't fill automatically.
 */

type Body = { artistSlug?: string; albumSlug?: string; title?: string };

const SYSTEM = `You are a release manager writing a Spotify for Artists playlist pitch. Spotify editors skim hundreds daily and the data here also feeds the algorithm (Release Radar / Discover Weekly targeting), so every tag must be accurate to the actual track. Output a ready-to-paste pitch with EXACTLY these labelled sections (plain text, no markdown, no preamble):

GENRES: up to 3 comma-separated genres (most specific first)
MOODS: 3-5 comma-separated moods
STYLES: 3-5 comma-separated style/sub-genre/era tags
INSTRUMENTS: 3-6 comma-separated key instruments/sounds that define the track
SIMILAR ARTISTS: 3-5 comma-separated reference artists whose listeners would like this (editor context only — never claim affiliation)
PLAYLIST FIT: 2-3 comma-separated types of playlists or listening moments this slots into (e.g. "late-night focus, rainy-day indie, gym warmup")
PITCH: ONE paragraph, HARD LIMIT 500 characters, first person. Lead with the single strongest hook, then the target listener + the moment they'd press play. Specific and confident. No hype clichés ("must-listen", "next big thing"), no invented stats, no emoji.

Be concrete and faithful to the release context. If a detail is unknown, omit it rather than inventing.`;

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const artistSlug = (body.artistSlug ?? "").trim();
  if (!artistSlug) return Response.json({ error: "artistSlug required" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return Response.json({ error: "NEXT_PUBLIC_CONVEX_URL not set" }, { status: 500 });
  const cx = new ConvexHttpClient(url);

  const artist = await cx.query(api.artists.getBySlug, { slug: artistSlug }).catch(() => null);
  const album = body.albumSlug
    ? await cx.query(api.albums.getOne, { artistSlug, slug: body.albumSlug }).catch(() => null)
    : null;
  const niche = album?.nicheSlug
    ? await cx.query(api.niches.getBySlug, { slug: album.nicheSlug }).catch(() => null)
    : null;

  const ctx: string[] = [];
  ctx.push(`Artist: ${artist?.name ?? artistSlug}.`);
  if (body.title) ctx.push(`Track: "${body.title}".`);
  if (album) ctx.push(`Release/album: "${album.name}".`);
  const genre = album?.genre ?? (artist?.genres ?? [])[0];
  if (genre) ctx.push(`Primary genre: ${genre}.`);
  if (album?.secondaryGenre) ctx.push(`Secondary genre: ${album.secondaryGenre}.`);
  if (artist?.genres?.length) ctx.push(`Artist genres: ${artist.genres.join(", ")}.`);
  if (album?.description) ctx.push(`Description: ${album.description}.`);
  if (niche) {
    ctx.push(`Niche: ${niche.name}.`);
    if (niche.moods?.length) ctx.push(`Niche moods: ${niche.moods.join(", ")}.`);
    if (niche.instruments?.length) ctx.push(`Niche instruments: ${niche.instruments.join(", ")}.`);
    if (niche.culturalTags?.length) ctx.push(`Cultural tags: ${niche.culturalTags.join(", ")}.`);
    if (niche.referenceArtists?.length) ctx.push(`Reference artists: ${niche.referenceArtists.join(", ")}.`);
    if (niche.themes?.length) ctx.push(`Themes: ${niche.themes.join(", ")}.`);
  }

  try {
    const pitch = await callClaude({
      system: SYSTEM,
      user: `Release context:\n${ctx.join("\n")}\n\nWrite the pitch now.`,
      model: "claude-sonnet-4-6",
      maxTokens: 700,
    });
    return Response.json({ pitch: pitch.trim() });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
