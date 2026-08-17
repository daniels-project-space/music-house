import { task, logger } from "@trigger.dev/sdk/v3";
// Parse plain-text lyrics into the structured shape tracks.lyrics expects.
function parseLyrics(text: string): Array<{ text: string; start: number; isSection: boolean }> {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => ({ text: l, start: 0, isSection: /^\[.+\]$/.test(l) }));
}
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
  // Generation calls are billed and non-idempotent. Never let an infrastructure
  // retry re-run a successful (paid) generation because of a later failure.
  retry: { maxAttempts: 1 },
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

      // HARD RULE: every Mureka track is saved as lossless FLAC. If the API didn't return
      // flac_url, we fail the whole job rather than silently saving a lossy MP3.
      if (!c.flac_url) {
        throw new Error(
          `Mureka choice "${title}" has no flac_url — can't enforce HQ rule. ` +
          `Check Mureka API response shape; their plan may have changed.`,
        );
      }
      const audioKey = `${baseKey}.flac`;
      await downloadToR2(c.flac_url, audioKey, "audio/flac");
      logger.info("mureka:FLAC saved (lossless)", { audioKey });

      const id = await cx.mutation(api.tracks.insert, {
        artistSlug,
        albumSlug,
        title,
        duration: Math.round((c.duration ?? 0) / 1000),
        generator: "mureka",
        audioKey,
        lyrics: input.lyrics && input.lyrics.trim().length > 0 ? parseLyrics(input.lyrics) : undefined,
      });
      created.push(id);
    }

    await cx.mutation(api.jobs.setComplete, { id: input.jobId, resultTrackIds: created });
    logger.info("mureka:done", { count: created.length });
    return { trackIds: created };
  },
});
