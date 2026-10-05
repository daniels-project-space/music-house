import { issueRenderMutationProof } from "@/lib/render-session";
import { renderAuthentication } from "@/lib/render-auth";
import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { pollMusic3Engine } from "@/lib/render-engine-music3";
export async function GET(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await renderAuthentication(request);
  if (auth.response) return auth.response;
  const { jobId } = await params;
  if (!/^[a-z0-9]{32}$/.test(jobId)) return NextResponse.json({ error: "Invalid job ID" }, { status: 400 });
  const cx = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const job = await cx.query(api.jobs.getOwned, { id: jobId as Id<"generationJobs">, sessionToken: auth.sessionToken });
  if (!job?.config?.engine || job.generator !== "minimax") return NextResponse.json({ error: "Engine job not found" }, { status: 404 });
  try {
    const result = await pollMusic3Engine(job.config.engine);
    await cx.mutation(api.jobs.syncEngineState, { id: job._id, engineJobId: job.config.engine.jobId, state: result.state, sessionToken: auth.sessionToken, serverProof: await issueRenderMutationProof("sync-engine", auth.identity.subject, { id: job._id, engineJobId: job.config.engine.jobId, state: result.state }, process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET) });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "Music3 engine status is unavailable" }, { status: 503 }); }
}
