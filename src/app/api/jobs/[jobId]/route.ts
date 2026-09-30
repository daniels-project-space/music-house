import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { pollMusic3Engine } from "@/lib/render-engine-music3";
export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!/^[a-z0-9]{32}$/.test(jobId)) return NextResponse.json({ error: "Invalid job ID" }, { status: 400 });
  const cx = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const job = await cx.query(api.jobs.get, { id: jobId as Id<"generationJobs"> });
  if (!job?.config?.engine || job.generator !== "minimax") return NextResponse.json({ error: "Engine job not found" }, { status: 404 });
  try {
    const result = await pollMusic3Engine(job.config.engine);
    await cx.mutation(api.jobs.syncEngineState, { id: job._id, engineJobId: job.config.engine.jobId, state: result.state });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "Music3 engine status is unavailable" }, { status: 503 }); }
}
