import { task, logger } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import * as mureka from "../lib/mureka";
import { downloadToR2, slug } from "../lib/transfer";

function convexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set in Trigger env");
  return new ConvexHttpClient(url);
}

export type MurekaGenerateInput = {
  jobId: Id<"generationJobs">;
  prompt?: string;
  lyrics?: string;
  title?: string;
  artistSlug?: string;
  albumSlug?: string;
  instrumental?: boolean;
};

export const generateMurekaTrack = task({
  id: "generate-mureka-track",
  maxDuration: 1800,
  run: async (input: MurekaGenerateInput) => {
    const cx = convexClient();
    logger.info("mureka:start", { jobId: input.jobId });

    const { taskId, type } = await mureka.generate({
      prompt: input.prompt,
      lyrics: input.lyrics,
      instrumental: input.instrumental,
    });
    await cx.mutation(api.jobs.setRunning, { id: input.jobId, triggerRunId: `mureka:${taskId}` });

    const choices = await mureka.pollUntilComplete(taskId, type, { intervalMs: 6000, timeoutMs: 8 * 60 * 1000 });

    const created: Id<"tracks">[] = [];
    let i = 0;
    for (const c of choices) {
      i++;
      const title = input.title ?? `Mureka ${type} ${i}`;
      const trackSlug = `${slug(title)}-${Date.now().toString(36)}${i}`;
      const artistSlug = input.artistSlug ?? "_unsorted";
      const albumSlug = input.albumSlug;
      const baseKey = albumSlug
        ? `${artistSlug}/${albumSlug}/${trackSlug}`
        : `${artistSlug}/_singles/${trackSlug}`;

      // HQ rule: prefer FLAC. We do NOT save MP3 when FLAC is available.
      // Mureka returns both `url` (MP3) and `flac_url` (lossless FLAC).
      let audioKey: string;
      let contentType: string;
      if (c.flac_url) {
        audioKey = `${baseKey}.flac`;
        contentType = "audio/flac";
        await downloadToR2(c.flac_url, audioKey, contentType);
        logger.info("mureka:FLAC saved", { audioKey });
      } else {
        // FLAC not provided by API — fall back to MP3 (rare).
        logger.warn("mureka:no flac_url; falling back to MP3", { title });
        audioKey = `${baseKey}.mp3`;
        contentType = "audio/mpeg";
        await downloadToR2(c.url, audioKey, contentType);
      }

      const id = await cx.mutation(api.tracks.insert, {
        artistSlug,
        albumSlug,
        title,
        duration: Math.round((c.duration ?? 0) / 1000),
        generator: "mureka",
        audioKey,
      });
      created.push(id);
    }

    await cx.mutation(api.jobs.setComplete, { id: input.jobId, resultTrackIds: created });
    logger.info("mureka:done", { count: created.length });
    return { trackIds: created };
  },
});
