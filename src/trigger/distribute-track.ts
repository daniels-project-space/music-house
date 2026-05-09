import { task, logger } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { getBuffer } from "../lib/storage";
import { distributeRouteNoteHttp, type CookieEntry } from "../lib/routenote-http";

function convexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set in Trigger env");
  return new ConvexHttpClient(url);
}

function humanizeSlug(slug: string): string {
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

export type DistributeInput = {
  jobId: Id<"distributionJobs">;
};

export const distributeTrack = task({
  id: "distribute-track",
  maxDuration: 600,
  run: async (input: DistributeInput, { ctx }) => {
    const cx = convexClient();
    logger.info("distribute:start", { jobId: input.jobId, runId: ctx.run.id });

    await cx.mutation(api.distribution.setRunning, {
      id: input.jobId,
      triggerRunId: ctx.run.id,
    });

    const job = await cx.query(api.distribution.get, { id: input.jobId });
    if (!job) throw new Error("distribution job not found");

    const track = await cx.query(api.tracks.get, { id: job.trackId });
    if (!track) throw new Error("track not found");

    // Resolve cover key (track override → album cover fallback)
    let coverKey: string | undefined = track.coverKey;
    if (!coverKey && track.albumSlug) {
      const album = await cx.query(api.albums.getOne, {
        artistSlug: track.artistSlug,
        slug: track.albumSlug,
      });
      coverKey = album?.coverKey ?? undefined;
    }

    let audioBuffer: Buffer;
    let coverBuffer: Buffer | undefined;
    try {
      audioBuffer = await getBuffer(track.audioKey);
    } catch (e) {
      const msg = `audio download failed: ${(e as Error).message}`;
      await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: msg });
      throw new Error(msg);
    }
    if (coverKey) {
      try {
        coverBuffer = await getBuffer(coverKey);
      } catch (e) {
        logger.warn("cover-download-failed", { err: (e as Error).message });
      }
    }

    const auth = await cx.query(api.distributorAuth.get, { distributor: "routenote" });
    if (!auth?.cookiesJson) {
      const msg = "no RouteNote cookies — run bootstrap-auth.mjs once";
      await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: msg });
      throw new Error(msg);
    }

    let cookies: CookieEntry[];
    try {
      cookies = JSON.parse(auth.cookiesJson) as CookieEntry[];
    } catch (e) {
      const msg = `cookies parse failed: ${(e as Error).message}`;
      await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: msg });
      throw new Error(msg);
    }

    const audioExt = track.audioKey.endsWith(".flac") ? ".flac" : ".mp3";
    const audioContentType = track.audioKey.endsWith(".flac") ? "audio/flac" : "audio/mpeg";

    let result;
    try {
      result = await distributeRouteNoteHttp(
        {
          audioBuffer,
          audioFilename: `${track.title.replace(/[^a-zA-Z0-9-_ ]/g, "_")}${audioExt}`,
          audioContentType,
          coverBuffer,
          coverFilename: coverKey ? coverKey.split("/").pop() : "cover.jpg",
          title: track.title,
          artistName: humanizeSlug(track.artistSlug || "Unknown"),
          genre: track.genre,
          explicit: false,
        },
        cookies,
        (step, detail) => {
          logger.info(`rn:${step}`, { detail });
        },
      );
    } catch (e) {
      const msg = (e as Error).message;
      await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: msg });
      throw e;
    }

    // Persist refreshed cookies for the next run.
    if (result.cookies?.length) {
      try {
        await cx.mutation(api.distributorAuth.save, {
          distributor: "routenote",
          cookiesJson: JSON.stringify(result.cookies),
        });
      } catch (e) {
        logger.warn("cookies-save-failed", { err: (e as Error).message });
      }
    }

    if (!result.loggedIn) {
      const msg = "auth expired — re-run bootstrap-auth.mjs";
      await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: msg });
      throw new Error(msg);
    }

    const summary = result.steps.map((s) => `${s.step}=${s.ok ? "ok" : "FAIL"}${s.detail ? "(" + s.detail.slice(0, 80) + ")" : ""}`).join(" | ");
    logger.info("distribute:summary", { upc: result.upc, summary });

    if (!result.upc) {
      await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: `create release failed: ${summary}` });
      throw new Error(`create failed: ${summary}`);
    }

    const allOk = result.steps.every((s) => s.ok);
    const liveUrl = `https://www.routenote.com/rn/edit_album/${result.upc}`;

    if (allOk) {
      await cx.mutation(api.distribution.setDraftReady, {
        id: input.jobId,
        browserbaseSessionId: `http-${result.upc}`,
        liveViewUrl: liveUrl,
      });
      logger.info("distribute:draft_ready", { upc: result.upc, summary });
    } else {
      // Partial — mark draft_ready so user can finish on RouteNote, but include detail.
      await cx.mutation(api.distribution.setDraftReady, {
        id: input.jobId,
        browserbaseSessionId: `http-${result.upc}`,
        liveViewUrl: liveUrl,
      });
      logger.warn("distribute:partial", { upc: result.upc, summary });
    }

    return { upc: result.upc, steps: result.steps, liveViewUrl: liveUrl };
  },
});
