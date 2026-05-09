import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export const runtime = "nodejs";

// Distribution is processed by the VPS worker (distribute-worker.mjs) which
// polls Convex for pending jobs. This route just inserts the job — no Trigger
// task is invoked.
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

  return Response.json({ jobId });
}
