/**
 * Daily sweep for the standalone Music Video pipeline.
 *
 * This is the ONLY recurring schedule in the pipeline — it is a generic
 * heartbeat, NOT a per-channel cadence. Each released single creates its own
 * +5-day `musicVideoJobs` row (see distribution.setSubmitted); this sweep just
 * fires the ones that have come due. Marks each "rendering" on dispatch so a
 * later sweep can't double-trigger it.
 */
import { schedules, logger } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { musicVideoRender } from "./music-video-render";

export const musicVideoSweep = schedules.task({
  id: "music-video-sweep",
  // ~06:23 UTC daily (off the :00 mark on purpose).
  cron: "23 6 * * *",
  maxDuration: 120,
  run: async () => {
    const convexUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!convexUrl) {
      logger.error("music-video-sweep: CONVEX_URL not set");
      return { triggered: 0 };
    }
    const convex = new ConvexHttpClient(convexUrl);
    const due = (await convex.query(api.musicVideo.listDue, {})) as { jobId: string }[];
    logger.info(`music-video-sweep: ${due.length} job(s) due`);

    for (const job of due) {
      // Claim it so a subsequent sweep won't re-dispatch the same job.
      await convex.mutation(api.musicVideo.markStatus, {
        jobId: job.jobId as any,
        status: "rendering",
        progress: "queued for render",
        karaokeStatus: "rendering",
        karaokeProgress: "queued for render",
      });
      // Two videos per song: the normal music video + the karaoke (instrumental) cut.
      await musicVideoRender.trigger({ jobId: job.jobId, convexUrl, doUpload: true, privacy: "unlisted", variant: "main" });
      await musicVideoRender.trigger({ jobId: job.jobId, convexUrl, doUpload: true, privacy: "unlisted", variant: "karaoke" });
    }
    return { triggered: due.length };
  },
});
