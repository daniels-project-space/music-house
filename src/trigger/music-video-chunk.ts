/**
 * Renders ONE frame-range chunk of a VinylMusicVideo (video only, muted) and
 * uploads the partial mp4 to R2. Many of these run in parallel (one per Trigger
 * worker) — that parallelism is what makes the full render fast. The audio is
 * muxed once by the orchestrator after all chunks finish.
 */
import { task, logger } from "@trigger.dev/sdk/v3";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { renderToFile, type MvProps } from "../music-video/pipeline";
import { put } from "../music-video/r2";

export type MusicVideoChunkPayload = {
  jobId: string;
  chunkIndex: number;
  frameStart: number;
  frameEnd: number;
  partialKey: string;
  props: MvProps;
};

export const musicVideoChunk = task({
  id: "music-video-chunk",
  maxDuration: 1500,
  machine: "large-2x",
  retry: { maxAttempts: 2 },
  run: async (payload: MusicVideoChunkPayload) => {
    const out = path.join(os.tmpdir(), `mv-chunk-${payload.jobId}-${payload.chunkIndex}.mp4`);
    try {
      await renderToFile(payload.props, out, (m) => logger.info(m), {
        frameRange: [payload.frameStart, payload.frameEnd],
        muted: true,
        onPct: (pct) => logger.info(`chunk ${payload.chunkIndex}: ${pct}%`),
      });
      await put(payload.partialKey, await readFile(out), "video/mp4");
      logger.info(`chunk ${payload.chunkIndex} → ${payload.partialKey}`);
      return { chunkIndex: payload.chunkIndex, partialKey: payload.partialKey };
    } finally {
      await rm(out, { force: true }).catch(() => {});
    }
  },
});
