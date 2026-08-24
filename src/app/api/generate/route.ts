import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import { tasks } from "@trigger.dev/sdk/v3";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "valid JSON required" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "JSON object required" }, { status: 400 });
  }

  const generator = body.generator ?? "suno";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const lyrics = typeof body.lyrics === "string" && body.lyrics.trim() ? body.lyrics.trim() : undefined;
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : undefined;
  const genre = typeof body.genre === "string" && body.genre.trim() ? body.genre.trim() : undefined;

  if (generator !== "suno") {
    return NextResponse.json({ error: "The Studio currently renders with Suno only." }, { status: 400 });
  }
  if (!prompt) return NextResponse.json({ error: "render brief required" }, { status: 400 });
  if (prompt.length > 1000) return NextResponse.json({ error: "render brief must be 1000 characters or fewer" }, { status: 400 });
  if (genre && genre.length > 120) return NextResponse.json({ error: "genre must be 120 characters or fewer" }, { status: 400 });
  if (title && title.length > 100) return NextResponse.json({ error: "title must be 100 characters or fewer" }, { status: 400 });
  if (lyrics && lyrics.length > 5000) return NextResponse.json({ error: "lyrics must be 5000 characters or fewer" }, { status: 400 });

  // Suno's custom-mode `style` field is where genre and production direction
  // belong. Preserve the genre independently too, so the resulting catalog
  // track remains filterable after the job has finished.
  const stylePrompt = genre ? `${genre}. ${prompt}` : prompt;

  const cx = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  // Save the writer's source lyrics before starting a paid provider job. That
  // way a declined or failed render can never silently discard their writing.
  if (lyrics) {
    await cx.mutation(api.savedLyrics.create, {
      title: title ?? "Untitled lyrics",
      genre,
      lyrics,
    });
  }

  const jobId = await cx.mutation(api.jobs.create, {
    generator: "suno",
    prompt: stylePrompt,
    lyrics,
    config: { title, genre, model: "V5_5", delivery: "lossless WAV master" },
  });

  try {
    const handle = await tasks.trigger("generate-suno-track", {
      jobId,
      prompt: stylePrompt,
      lyrics,
      title,
      genre,
      model: "V5_5" as const,
    });
    return NextResponse.json({ jobId, runId: handle.id, quality: "lossless WAV master" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Trigger error";
    await cx.mutation(api.jobs.setFailed, {
      id: jobId,
      error: `Could not start render worker: ${message.slice(0, 700)}`,
    }).catch(() => undefined);
    return NextResponse.json(
      { error: "The render service could not start. Please try again shortly." },
      { status: 502 },
    );
  }
}
