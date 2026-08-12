import { ConvexHttpClient } from "convex/browser";
import { generatePitchCopy } from "../../../../lib/pitch";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Generates the copy a human pastes into the Spotify for Artists pitch form
 * (genres, moods, instruments, similar artists, and the ~500-char "why this song
 * is special" story). That pitch is what feeds Release Radar / algorithmic
 * targeting — the one lever a distributor can't fill automatically.
 *
 * Thin wrapper around src/lib/pitch.ts — the same logic also fires
 * automatically on submit (see distribute-*-distrokid.ts).
 */

type Body = { artistSlug?: string; albumSlug?: string; title?: string };

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

  try {
    const pitch = await generatePitchCopy(cx, {
      artistSlug,
      albumSlug: body.albumSlug,
      title: body.title,
    });
    return Response.json({ pitch });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
