/**
 * Music Video render ORCHESTRATOR (standalone, parallel).
 *
 * Prepares inputs once, fans the render out across many `music-video-chunk`
 * workers (one per frame range), waits for all, then concatenates the partials
 * and muxes the audio into the final mp4. This Lambda-style parallelism is what
 * turns a ~45-60 min single-worker 1080p render into a few minutes.
 *
 * Chunk count: payload.chunks → env MV_CHUNKS → default 12 (clamped 1..24).
 */
import { task, logger } from "@trigger.dev/sdk/v3";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  concatChunksWithAudio,
  convexClient,
  marker,
  prepareRender,
  uploadAndFinalize,
} from "../music-video/pipeline";
import { downloadToFile } from "../music-video/r2";
import { musicVideoChunk } from "./music-video-chunk";

export type MusicVideoRenderPayload = {
  jobId: string;
  convexUrl?: string;
  doUpload?: boolean;
  privacy?: "private" | "unlisted" | "public";
  chunks?: number;
};

export const musicVideoRender = task({
  id: "music-video-render",
  // Orchestrator compute = prepare + ffmpeg concat/mux + uploads (the parallel
  // chunk renders are separate workers and run while this task is suspended).
  maxDuration: 1800,
  machine: "large-1x",
  retry: { maxAttempts: 1 },
  run: async (payload: MusicVideoRenderPayload) => {
    const log = (m: string) => logger.info(m);
    const convex = convexClient(payload.convexUrl);
    const mark = marker(convex, payload.jobId);

    const ctx = await prepareRender(convex, payload.jobId, log);
    const stitchDir = path.join(os.tmpdir(), `mv-stitch-${payload.jobId}`);

    try {
      const N = Math.max(1, Math.min(24, payload.chunks ?? Number(process.env.MV_CHUNKS ?? 12)));
      const total = ctx.durationInFrames;
      const per = Math.ceil(total / N);
      const ranges: Array<{ index: number; start: number; end: number }> = [];
      for (let i = 0; i < N; i++) {
        const start = i * per;
        if (start >= total) break;
        ranges.push({ index: ranges.length, start, end: Math.min(total - 1, start + per - 1) });
      }
      await mark({ progress: `rendering · ${ranges.length} parallel chunks` });
      log(`Fan-out: ${ranges.length} chunks × ~${per} frames (total ${total})`);

      const items = ranges.map((r) => ({
        payload: {
          jobId: payload.jobId,
          chunkIndex: r.index,
          frameStart: r.start,
          frameEnd: r.end,
          partialKey: `music-video/tmp/${payload.jobId}/chunk-${String(r.index).padStart(3, "0")}.mp4`,
          props: ctx.props,
        },
      }));

      const batch = await musicVideoChunk.batchTriggerAndWait(items);

      const partialKeys: string[] = new Array(ranges.length);
      for (const run of batch.runs) {
        if (!run.ok) throw new Error(`chunk failed: ${JSON.stringify(run.error)?.slice(0, 200)}`);
        const out = run.output as { chunkIndex: number; partialKey: string };
        partialKeys[out.chunkIndex] = out.partialKey;
      }
      if (partialKeys.some((k) => !k)) throw new Error("missing chunk output(s)");

      await mark({ progress: "stitching chunks + muxing audio" });
      await mkdir(stitchDir, { recursive: true });
      const localPartials: string[] = [];
      for (let i = 0; i < partialKeys.length; i++) {
        const p = path.join(stitchDir, `chunk-${String(i).padStart(3, "0")}.mp4`);
        await downloadToFile(partialKeys[i], p);
        localPartials.push(p);
      }
      const finalOut = path.join(stitchDir, "final.mp4");
      await concatChunksWithAudio(localPartials, ctx.audioPath, finalOut, stitchDir, log);

      return await uploadAndFinalize(
        convex,
        payload.jobId,
        finalOut,
        ctx,
        { doUpload: payload.doUpload ?? true, privacy: payload.privacy ?? "unlisted" },
        log,
      );
    } catch (err) {
      await mark({ status: "failed", error: (err as Error).message?.slice(0, 800) });
      throw err;
    } finally {
      await rm(ctx.workDir, { recursive: true, force: true }).catch(() => {});
      await rm(stitchDir, { recursive: true, force: true }).catch(() => {});
    }
  },
});
