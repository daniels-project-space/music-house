import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import { researchNiche } from "../../../../lib/nichecraft";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = { seed?: string };

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const seed = (body.seed ?? "").trim();
  if (!seed) return Response.json({ error: "seed required" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return Response.json({ error: "NEXT_PUBLIC_CONVEX_URL not set" }, { status: 500 });

  let overview;
  try {
    overview = await researchNiche(seed);
  } catch (e) {
    return Response.json({ error: `research failed: ${(e as Error).message}` }, { status: 502 });
  }

  try {
    const cx = new ConvexHttpClient(url);
    await cx.mutation(api.niches.upsert, {
      slug: overview.slug,
      name: overview.name,
      seed: overview.seed,
      primaryGenre: overview.primaryGenre,
      secondaryGenre: overview.secondaryGenre,
      stylePrompts: overview.stylePrompts,
      themes: overview.themes,
      moods: overview.moods,
      instruments: overview.instruments,
      culturalTags: overview.culturalTags,
      referenceArtists: overview.referenceArtists,
      relatedSearches: overview.relatedSearches,
      bpmMin: overview.bpmMin,
      bpmMax: overview.bpmMax,
      keys: overview.keys,
      competition: overview.competition,
      productionNotes: overview.productionNotes,
      overviewText: overview.overviewText,
    });
  } catch (e) {
    return Response.json({ error: `save failed: ${(e as Error).message}` }, { status: 500 });
  }

  return Response.json({ niche: overview });
}
