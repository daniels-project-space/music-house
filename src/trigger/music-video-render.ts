/**
 * Music Video render task (standalone pipeline — NOT part of the distribution
 * or AutoStudio block flow). Renders one job's VinylMusicVideo and, if the
 * Music House Records channel is connected, uploads it (gated inside the
 * pipeline). Triggered per-job by music-video-sweep, or manually.
 */
import { task, logger } from "@trigger.dev/sdk/v3";
import { runMusicVideoJob } from "../music-video/pipeline";

export type MusicVideoRenderPayload = {
  jobId: string;
  convexUrl?: string;
  doUpload?: boolean;
  privacy?: "private" | "unlisted" | "public";
};

export const musicVideoRender = task({
  id: "music-video-render",
  // Remotion render of a full track + audio on all 8 vCPUs (concurrency=auto).
  maxDuration: 3000,
  machine: "large-2x",
  retry: { maxAttempts: 1 },
  run: async (payload: MusicVideoRenderPayload) => {
    return runMusicVideoJob({
      jobId: payload.jobId,
      convexUrl: payload.convexUrl,
      doUpload: payload.doUpload ?? true,
      privacy: payload.privacy ?? "unlisted",
      log: (m) => logger.info(m),
    });
  },
});
