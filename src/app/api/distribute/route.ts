import { tasks } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { distributeSingleDistrokid } from "../../../trigger/distribute-single-distrokid";

export const runtime = "nodejs";

// Legacy /api/distribute alias — forwards to the new single-distribute path so existing
// callers don't break. New UI code calls /api/distribute/single or /api/distribute/album.
// DistroKid is the only active distributor — RouteNote release automation is retired.
export async function POST(req: Request) {
  const body = (await req.json()) as {
    trackId?: string;
    leadDays?: number;
    releaseDate?: string;
  };
  if (!body.trackId) return Response.json({ error: "trackId required" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return Response.json({ error: "NEXT_PUBLIC_CONVEX_URL not set" }, { status: 500 });
  const cx = new ConvexHttpClient(url);
  const jobId = await cx.mutation(api.distribution.createSingle, {
    trackId: body.trackId as Id<"tracks">,
  });

  // Release timing (DistroKid only) — a lead time keeps the Spotify editorial-pitch
  // / pre-save / Release Radar window open. Falls back to the task's env/default.
  const timing: { leadDays?: number; releaseDate?: string } = {};
  if (typeof body.leadDays === "number" && Number.isFinite(body.leadDays) && body.leadDays >= 0) {
    timing.leadDays = Math.round(body.leadDays);
  }
  if (typeof body.releaseDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.releaseDate)) {
    timing.releaseDate = body.releaseDate;
  }

  const handle = await tasks.trigger<typeof distributeSingleDistrokid>("distribute-single-distrokid", {
    jobId,
    ...timing,
  });

  return Response.json({ jobId, runId: handle.id, releaseType: "single", distributor: "distrokid" });
}
