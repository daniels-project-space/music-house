import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import { tasks } from "@trigger.dev/sdk/v3";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { generator, prompt, lyrics, title, artistSlug, albumSlug } = body as {
    generator: "suno" | "mureka";
    prompt: string;
    lyrics?: string;
    title?: string;
    artistSlug?: string;
    albumSlug?: string;
  };
  if (!generator || !prompt) return NextResponse.json({ error: "generator + prompt required" }, { status: 400 });

  const cx = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const jobId = await cx.mutation(api.jobs.create, {
    generator,
    prompt,
    lyrics,
    artistSlug,
    albumSlug,
    config: { title },
  });

  const taskId = generator === "suno" ? "generate-suno-track" : "generate-mureka-track";
  const handle = await tasks.trigger(taskId, { jobId, prompt, lyrics, title, artistSlug, albumSlug });

  return NextResponse.json({ jobId, runId: handle.id });
}
