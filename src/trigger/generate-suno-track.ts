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

      const audioKey = `${baseKey}.mp3`;
      await downloadToR2(t.audioUrl, audioKey, "audio/mpeg");

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
      });
      created.push(id);
    }

    await cx.mutation(api.jobs.setComplete, { id: input.jobId, resultTrackIds: created });
    logger.info("suno:done", { count: created.length });
    return { trackIds: created };
  },
});
