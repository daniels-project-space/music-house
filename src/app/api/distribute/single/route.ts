import { tasks } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { distributeSingle } from "../../../../trigger/distribute-single";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json()) as { trackId?: string; dryRun?: boolean };
  if (!body.trackId) return Response.json({ error: "trackId required" }, { status: 400 });
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return Response.json({ error: "NEXT_PUBLIC_CONVEX_URL not set" }, { status: 500 });

  const cx = new ConvexHttpClient(url);
  const jobId = await cx.mutation(api.distribution.createSingle, { trackId: body.trackId as Id<"tracks"> });
  const handle = await tasks.trigger<typeof distributeSingle>("distribute-single", {
    jobId,
    ...(body.dryRun ? { dryRun: true } : {}),
  });

  return Response.json({ jobId, runId: handle.id, releaseType: "single", dryRun: !!body.dryRun });
}
