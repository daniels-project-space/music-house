import { tasks } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { distributeSingle } from "../../../trigger/distribute-single";
import type { distributeSingleDistrokid } from "../../../trigger/distribute-single-distrokid";

export const runtime = "nodejs";

type Distributor = "routenote" | "distrokid";

// Legacy /api/distribute alias — forwards to the new single-distribute path so existing
// callers don't break. New UI code calls /api/distribute/single or /api/distribute/album.
export async function POST(req: Request) {
  const body = (await req.json()) as { trackId?: string; distributor?: string };
  if (!body.trackId) return Response.json({ error: "trackId required" }, { status: 400 });

  // Default to RouteNote so existing callers that omit `distributor` behave exactly as before.
  const distributorRaw = body.distributor ?? "routenote";
  if (distributorRaw !== "routenote" && distributorRaw !== "distrokid") {
    return Response.json({ error: "distributor must be 'routenote' or 'distrokid'" }, { status: 400 });
  }
  const distributor: Distributor = distributorRaw;

  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return Response.json({ error: "NEXT_PUBLIC_CONVEX_URL not set" }, { status: 500 });
  const cx = new ConvexHttpClient(url);
  const jobId = await cx.mutation(api.distribution.createSingle, {
    trackId: body.trackId as Id<"tracks">,
    distributor,
  });

  const handle =
    distributor === "distrokid"
      ? await tasks.trigger<typeof distributeSingleDistrokid>("distribute-single-distrokid", { jobId })
      : await tasks.trigger<typeof distributeSingle>("distribute-single", { jobId });

  return Response.json({ jobId, runId: handle.id, releaseType: "single", distributor });
}
