import { tasks } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { distributeAlbumDistrokid } from "../../../../trigger/distribute-album-distrokid";

export const runtime = "nodejs";

// DistroKid is the only active distributor — RouteNote release automation is retired.
export async function POST(req: Request) {
  const body = (await req.json()) as { albumId?: string; dryRun?: boolean };
  if (!body.albumId) return Response.json({ error: "albumId required" }, { status: 400 });
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return Response.json({ error: "NEXT_PUBLIC_CONVEX_URL not set" }, { status: 500 });

  const cx = new ConvexHttpClient(url);
  try {
    const jobId = await cx.mutation(api.distribution.createAlbum, {
      albumId: body.albumId as Id<"albums">,
    });
    const handle = await tasks.trigger<typeof distributeAlbumDistrokid>("distribute-album-distrokid", {
      jobId,
      ...(body.dryRun ? { dryRun: true } : {}),
    });
    return Response.json({ jobId, runId: handle.id, releaseType: "album", distributor: "distrokid", dryRun: !!body.dryRun });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
