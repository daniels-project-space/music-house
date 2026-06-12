import { tasks } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { distributeAlbum } from "../../../../trigger/distribute-album";
import type { distributeAlbumDistrokid } from "../../../../trigger/distribute-album-distrokid";

export const runtime = "nodejs";

type Distributor = "routenote" | "distrokid";

export async function POST(req: Request) {
  const body = (await req.json()) as { albumId?: string; dryRun?: boolean; distributor?: string };
  if (!body.albumId) return Response.json({ error: "albumId required" }, { status: 400 });
  const distributorRaw = body.distributor ?? "distrokid";
  if (distributorRaw !== "routenote" && distributorRaw !== "distrokid") {
    return Response.json({ error: "distributor must be 'routenote' or 'distrokid'" }, { status: 400 });
  }
  const distributor: Distributor = distributorRaw;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return Response.json({ error: "NEXT_PUBLIC_CONVEX_URL not set" }, { status: 500 });

  const cx = new ConvexHttpClient(url);
  try {
    const jobId = await cx.mutation(api.distribution.createAlbum, {
      albumId: body.albumId as Id<"albums">,
      distributor,
    });
    const handle =
      distributor === "distrokid"
        ? await tasks.trigger<typeof distributeAlbumDistrokid>("distribute-album-distrokid", {
            jobId,
            ...(body.dryRun ? { dryRun: true } : {}),
          })
        : await tasks.trigger<typeof distributeAlbum>("distribute-album", {
            jobId,
            ...(body.dryRun ? { dryRun: true } : {}),
          });
    return Response.json({ jobId, runId: handle.id, releaseType: "album", distributor, dryRun: !!body.dryRun });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
