import { task, logger } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import * as suno from "../lib/suno";
import { downloadToR2, slug } from "../lib/transfer";

function convexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set in Trigger env");
  return new ConvexHttpClient(url);
}

// Parse plain-text lyrics into the structured shape the schema expects.
// Section headers like [Verse 1] are flagged as isSection=true.
function parseLyrics(text: string): Array<{ text: string; start: number; isSection: boolean }> {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => ({
      text: l,
      start: 0,
      isSection: /^\[.+\]$/.test(l),
    }));
}

export type SunoGenerateInput = {
  jobId: Id<"generationJobs">;
  prompt: string;
  lyrics?: string;
  title?: string;
  artistSlug?: string;
  albumSlug?: string;
  callbackUrl?: string;
};

export const generateSunoTrack = task({
  id: "generate-suno-track",
  maxDuration: 1800,
  run: async (input: SunoGenerateInput, { ctx }) => {
    const cx = convexClient();
    logger.info("suno:start", { jobId: input.jobId });

    const { taskId } = await suno.generate({
      prompt: input.prompt,
      lyrics: input.lyrics,
      title: input.title ?? "Untitled",
      callbackUrl: input.callbackUrl,
    });
    await cx.mutation(api.jobs.setRunning, { id: input.jobId, triggerRunId: `suno:${taskId}` });

    const tracks = await suno.pollUntilComplete(taskId, { intervalMs: 6000, timeoutMs: 8 * 60 * 1000 });

    const created: Id<"tracks">[] = [];
    let i = 0;
    for (const t of tracks) {
      i++;
      const title = t.title ?? input.title ?? "Untitled";
      const trackSlug = `${slug(title)}-${Date.now().toString(36)}${i}`;
      const artistSlug = input.artistSlug ?? "_unsorted";
      const albumSlug = input.albumSlug;
      const baseKey = albumSlug
        ? `${artistSlug}/${albumSlug}/${trackSlug}`
        : `${artistSlug}/_singles/${trackSlug}`;

      // HQ rule: queue Suno's lossless WAV export and wait for it. We do NOT save the MP3.
      // Each Suno track has an `id` (audio_id) we pass to the wav-generate endpoint.
      const audioId = (t as { id?: string }).id ?? "";
      if (!audioId) {
        logger.warn("suno:no-audio-id; skipping WAV export, falling back to MP3", { title });
        const audioKey = `${baseKey}.mp3`;
        await downloadToR2(t.audioUrl, audioKey, "audio/mpeg");
        let coverKey: string | undefined;
        if (t.imageUrl) {
          coverKey = `${baseKey}.jpg`;
          await downloadToR2(t.imageUrl, coverKey, "image/jpeg");
        }
        const id = await cx.mutation(api.tracks.insert, {
          artistSlug, albumSlug, title, duration: t.duration,
          generator: "suno", audioKey, coverKey,
          lyrics: input.lyrics ? parseLyrics(input.lyrics) : undefined,
        });
        created.push(id);
        continue;
      }

      logger.info("suno:requesting WAV export", { title, audioId });
      const { wavTaskId } = await suno.requestWav({ taskId, audioId });
      const wavUrl = await suno.pollWavUntilReady(wavTaskId, { intervalMs: 8000, timeoutMs: 12 * 60 * 1000 });

      const audioKey = `${baseKey}.wav`;
      await downloadToR2(wavUrl, audioKey, "audio/wav");
      logger.info("suno:WAV saved", { audioKey });

      let coverKey: string | undefined;
      if (t.imageUrl) {
        coverKey = `${baseKey}.jpg`;
        await downloadToR2(t.imageUrl, coverKey, "image/jpeg");
      }

      const id = await cx.mutation(api.tracks.insert, {
        artistSlug,
        albumSlug,
        title,
        duration: t.duration,
        generator: "suno",
        audioKey,
        coverKey,
        lyrics: input.lyrics ? parseLyrics(input.lyrics) : undefined,
      });
      created.push(id);
    }

    await cx.mutation(api.jobs.setComplete, { id: input.jobId, resultTrackIds: created });
    logger.info("suno:done", { count: created.length });
    return { trackIds: created };
  },
});
