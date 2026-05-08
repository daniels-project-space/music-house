import { tasks } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { distributeTrack } from "../../../trigger/distribute-track";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json()) as { trackId?: string };
  if (!body.trackId) {
    return Response.json({ error: "trackId required" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    return Response.json({ error: "NEXT_PUBLIC_CONVEX_URL not set" }, { status: 500 });
  }
  const cx = new ConvexHttpClient(url);

  const trackId = body.trackId as Id<"tracks">;
  const jobId = await cx.mutation(api.distribution.create, { trackId });

  const handle = await tasks.trigger<typeof distributeTrack>("distribute-track", { jobId });

  return Response.json({ jobId, runId: handle.id });
}
