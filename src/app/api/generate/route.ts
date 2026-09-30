import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import { renderWorkerTokenDigest, issueRenderMutationProof } from "@/lib/render-session";
import { renderAuthentication } from "@/lib/render-auth";
import { randomBytes } from "node:crypto";
import { music3EngineConfig, stageMusic3Engine } from "@/lib/render-engine-music3";
import { tasks } from "@trigger.dev/sdk/v3";

export async function POST(req: NextRequest) {
  const auth = await renderAuthentication(req);
  if (auth.response) return auth.response;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "valid JSON required" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "JSON object required" }, { status: 400 });
  }

  const generator = body.generator ?? "minimax";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const lyrics = typeof body.lyrics === "string" && body.lyrics.trim() ? body.lyrics : undefined;
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : undefined;
  const genre = typeof body.genre === "string" && body.genre.trim() ? body.genre.trim() : undefined;

  if (generator !== "suno" && generator !== "minimax") {
    return NextResponse.json({ error: "Choose Suno or MiniMax Music3." }, { status: 400 });
  }
  if (!prompt) return NextResponse.json({ error: "render brief required" }, { status: 400 });
  if (prompt.length > 1000) return NextResponse.json({ error: "render brief must be 1000 characters or fewer" }, { status: 400 });
  if (genre && genre.length > 120) return NextResponse.json({ error: "genre must be 120 characters or fewer" }, { status: 400 });
  if (title && title.length > 100) return NextResponse.json({ error: "title must be 100 characters or fewer" }, { status: 400 });
  if (lyrics && lyrics.length > 5000) return NextResponse.json({ error: "lyrics must be 5000 characters or fewer" }, { status: 400 });

  // Both engines work best when genre and production direction live in one
  // focused caption. Keep genre separately too so finished tracks stay filterable.
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

  if (generator === "minimax") {
    if (!lyrics) return NextResponse.json({ error: "Music3 requires source lyrics. They can include an instrumental section tag." }, { status: 400 });
    try { music3EngineConfig(); } catch {
      return NextResponse.json({ error: "Music3 Render Engine connection is not configured. Your lyrics were saved." }, { status: 503 });
    }
    const jobId = await cx.mutation(api.jobs.create, { sessionToken: auth.sessionToken, generator, prompt: stylePrompt, lyrics,
      config: { title, genre, model: "MiniMax-Music3", delivery: "verified stereo WAV master" } });
    try {
      const binding = await stageMusic3Engine({ sourceId: jobId, lyrics, description: stylePrompt, seed: randomBytes(4).readUInt32LE() });
      await cx.mutation(api.jobs.setEngineBinding, { id: jobId, binding, sessionToken: auth.sessionToken, serverProof: await issueRenderMutationProof("bind-engine", auth.identity.subject, { id: jobId, binding }, process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET) });
      return NextResponse.json({ jobId, state: binding.state, quality: "verified stereo WAV master" }, { status: 202 });
    } catch {
      const error = "Music3 engine admission could not be verified. Source lyrics remain saved.";
      await cx.mutation(api.jobs.setFailed, { id: jobId, error, sessionToken: auth.sessionToken,
        serverProof: await issueRenderMutationProof("fail-engine", auth.identity.subject, { id: jobId, error }, process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET) });
      return NextResponse.json({ error: "Music3 engine admission could not be verified. Source lyrics remain saved." }, { status: 502 });
    }
  }

  const workerToken = randomBytes(32).toString("hex");
  const jobId = await cx.mutation(api.jobs.create, {
    workerTokenSha256: await renderWorkerTokenDigest(workerToken),
    sessionToken: auth.sessionToken,
    generator,
    prompt: stylePrompt,
    lyrics,
    config: { title, genre, model: "V5_5", delivery: "lossless WAV master" },
  });

  try {
    const handle = await tasks.trigger("generate-suno-track", {
      jobId,
      workerToken,
      prompt: stylePrompt,
      lyrics,
      title,
      genre,
    });
    return NextResponse.json({
      jobId,
      runId: handle.id,
      quality: "lossless WAV master",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Trigger error";
    await cx.mutation(api.jobs.setFailed, {
      id: jobId,
      workerToken,
      error: `Could not start render worker: ${message.slice(0, 700)}`,
    }).catch(() => undefined);
    return NextResponse.json(
      { error: "The render service could not start. Please try again shortly." },
      { status: 502 },
    );
  }
}
