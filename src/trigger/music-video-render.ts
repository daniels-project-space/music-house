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
  finalizePreview,
  marker,
  prepareRender,
  uploadAndFinalize,
} from "../music-video/pipeline";
import { downloadToFile } from "../music-video/r2";
import { NoStemSourceError } from "../music-video/stems";
import { musicVideoChunk } from "./music-video-chunk";

export type MusicVideoRenderPayload = {
  jobId: string;
  convexUrl?: string;
  doUpload?: boolean;
  privacy?: "private" | "unlisted" | "public";
  chunks?: number;
  variant?: "main" | "karaoke";
  /**
   * Preview/iterate mode: render ONE short slice at FULL quality for QA instead
   * of the whole song. Uploads the clip to a dedicated R2 preview key (never the
   * real videoKey) and never publishes. A full 12-chunk render costs ~$3 on
   * Trigger; a 20s preview costs ~$0.25 — so tuning iterations stop re-rendering
   * the entire 1080p video. The final locked render (preview omitted) is
   * byte-identical to today's output: same chunk renderer, same concat path.
   */
  preview?: boolean;
  previewSec?: number; // preview clip length, default 20, clamped 2..60
  previewStartSec?: number; // where in the song the preview starts, default 0
};

export const musicVideoRender = task({
  id: "music-video-render",
  // Orchestrator compute = prepare + ffmpeg concat/mux + uploads (the parallel
  // chunk renders are separate workers and run while this task is suspended).
  // maxDuration is a WALL-CLOCK ceiling that includes the suspended wait for the
  // chunk fan-out; billed compute is only the active phases (~90s). At 1800s a
  // slow render (a chunk near the 1500s cap, or one that retries) tripped the
  // ceiling AFTER chunks finished — killing the orchestrator and wasting every
  // completed chunk render. 5400s covers a worst-case chunk + one retry; the
  // higher ceiling costs nothing (suspended time isn't billed).
  maxDuration: 5400,
  machine: "large-1x",
  retry: { maxAttempts: 1 },
  run: async (payload: MusicVideoRenderPayload) => {
    const log = (m: string) => logger.info(m);
    const convex = convexClient(payload.convexUrl);
    const mark = marker(convex, payload.jobId, payload.variant ?? "main");

    let ctx!: Awaited<ReturnType<typeof prepareRender>>;
    try {
      ctx = await prepareRender(convex, payload.jobId, log, payload.variant ?? "main");
    } catch (e) {
      if (payload.variant === "karaoke" && e instanceof NoStemSourceError) {
        await mark({ status: "aborted", progress: `karaoke skipped: ${(e as Error).message}` });
        log(`karaoke aborted: ${(e as Error).message}`);
        return { aborted: true, variant: "karaoke", reason: (e as Error).message };
      }
      throw e;
    }
    const stitchDir = path.join(os.tmpdir(), `mv-stitch-${payload.jobId}`);

    const preview = payload.preview === true;
    const fps = ctx.props.fps ?? 30;
    const previewStartSec = preview ? Math.max(0, payload.previewStartSec ?? 0) : 0;

    try {
      const total = ctx.durationInFrames;
      const ranges: Array<{ index: number; start: number; end: number }> = [];
      if (preview) {
        // QA slice: a single full-quality chunk covering ~previewSec seconds.
        const lenSec = Math.max(2, Math.min(60, payload.previewSec ?? 20));
        const startF = Math.min(Math.max(0, total - 2), Math.round(previewStartSec * fps));
        const endF = Math.min(total - 1, startF + Math.round(lenSec * fps) - 1);
        ranges.push({ index: 0, start: startF, end: endF });
        await mark({ progress: `PREVIEW · 1 chunk ~${lenSec}s @ ${fps}fps (full quality, no upload)` });
        log(`PREVIEW: 1 chunk frames ${startF}..${endF} (~${lenSec}s from ${previewStartSec}s) — full quality`);
      } else {
        const N = Math.max(1, Math.min(24, payload.chunks ?? Number(process.env.MV_CHUNKS ?? 18)));
        const per = Math.ceil(total / N);
        for (let i = 0; i < N; i++) {
          const start = i * per;
          if (start >= total) break;
          ranges.push({ index: ranges.length, start, end: Math.min(total - 1, start + per - 1) });
        }
        await mark({ progress: `rendering · ${ranges.length} parallel chunks` });
        log(`Fan-out: ${ranges.length} chunks × ~${per} frames (total ${total})`);
      }

      const items = ranges.map((r) => ({
        payload: {
          jobId: payload.jobId,
          chunkIndex: r.index,
          frameStart: r.start,
          frameEnd: r.end,
          partialKey: `music-video/tmp/${payload.jobId}/${payload.variant ?? "main"}-chunk-${String(r.index).padStart(3, "0")}.mp4`,
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
      // Preview slices may start mid-song; offset the muxed audio so it stays in
      // sync with the rendered frames (-shortest then trims to the slice).
      await concatChunksWithAudio(localPartials, ctx.audioPath, finalOut, stitchDir, log, previewStartSec);

      if (preview) {
        return await finalizePreview(
          convex,
          payload.jobId,
          finalOut,
          { trackId: ctx.meta.trackId, variant: ctx.meta.variant },
          log,
        );
      }

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
