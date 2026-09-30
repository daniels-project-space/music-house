import { randomBytes } from "node:crypto";
import { renderWorkerTokenDigest } from "@/lib/render-session";
import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import { renderAuthentication } from "@/lib/render-auth";
import { tasks } from "@trigger.dev/sdk/v3";

export async function POST(req: NextRequest) {
  const auth = await renderAuthentication(req);
  if (auth.response) return auth.response;
  const { artistSlug, albumSlug } = await req.json();
  if (!artistSlug || !albumSlug) return NextResponse.json({ error: "artistSlug + albumSlug required" }, { status: 400 });
  const cx = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const tracksList = await cx.query(api.tracks.list, { artistSlug, albumSlug });
  const needed = 10 - (tracksList?.length ?? 0);
  if (needed <= 0) return NextResponse.json({ ok: true, message: "already 10+ tracks", needed: 0 });

  const generator = artistSlug === "_suno" ? "suno" : "mureka";
  const handles: string[] = [];
  for (let i = 0; i < needed; i++) {
    const workerToken = randomBytes(32).toString("hex");
    const jobId = await cx.mutation(api.jobs.create, {
      workerTokenSha256: await renderWorkerTokenDigest(workerToken),
      sessionToken: auth.sessionToken,
      generator,
      prompt: `Autocomplete track for ${artistSlug}/${albumSlug} — match album style + cohesion.`,
      artistSlug,
      albumSlug,
      config: { autocomplete: true },
    });
    const taskId = generator === "suno" ? "generate-suno-track" : "generate-mureka-track";
    const handle = await tasks.trigger(taskId, {
      jobId,
      workerToken,
      prompt: `Autocomplete track ${i + 1}/${needed} for ${artistSlug}/${albumSlug}`,
      artistSlug,
      albumSlug,
    });
    handles.push(handle.id);
  }
  return NextResponse.json({ ok: true, dispatched: handles.length, runIds: handles });
}
