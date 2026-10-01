import { renderAuthentication } from "@/lib/render-auth";
import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { readMusic3EngineOutput } from "@/lib/render-engine-music3";
export async function GET(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await renderAuthentication(request);
  if (auth.response) return auth.response;
  const { jobId } = await params;
  if (!/^[a-z0-9]{32}$/.test(jobId)) return NextResponse.json({ error: "Invalid job ID" }, { status: 400 });
  const cx = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const job = await cx.query(api.jobs.getOwned, { id: jobId as Id<"generationJobs">, sessionToken: auth.sessionToken });
  if (!job?.config?.engine || job.generator !== "minimax") return NextResponse.json({ error: "Engine job not found" }, { status: 404 });
  try { return NextResponse.redirect(await readMusic3EngineOutput(job.config.engine), { headers: { "Cache-Control": "private, no-store" } }); }
  catch { return NextResponse.json({ error: "Verified Music3 WAV is unavailable" }, { status: 409 }); }
}
