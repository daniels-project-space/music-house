import { task, logger } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { getBuffer } from "../lib/storage";
import { distributeRouteNoteHttp, type CookieEntry } from "../lib/routenote-http";
import { submitDistributeFreePlaywright } from "../lib/routenote-playwright";
import { normalizeForRouteNote } from "../lib/audio-normalize";

function convexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set in Trigger env");
  return new ConvexHttpClient(url);
}

function humanizeSlug(slug: string): string {
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

export type DistributeSingleInput = {
  jobId: Id<"distributionJobs">;
};

export const distributeSingle = task({
  id: "distribute-single",
  maxDuration: 900,
  machine: "large-1x",
  run: async (input: DistributeSingleInput, { ctx }) => {
    const cx = convexClient();
    logger.info("dist:single:start", { jobId: input.jobId, runId: ctx.run.id });

    await cx.mutation(api.distribution.setRunning, { id: input.jobId, triggerRunId: ctx.run.id });
    const job = await cx.query(api.distribution.get, { id: input.jobId });
    if (!job) throw new Error("distribution job not found");
    if (job.releaseType === "album") throw new Error("use distribute-album for album releases");

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

    // Prefer FLAC (lossless) over MP3 if present — RouteNote accepts FLAC directly
    // with no re-encode needed.
    const audioKey = (track as { flacKey?: string }).flacKey ?? track.audioKey;
    const audioBuffer = await getBuffer(audioKey);
    const coverBuffer = coverKey ? await getBuffer(coverKey).catch(() => undefined) : undefined;

    // If source is MP3, normalize to 320 kbps + 44.1 kHz + stereo (RouteNote spec).
    // FLAC/WAV pass through untouched.
    let audioFilename = audioKey.split("/").pop() ?? "audio";
    let audioContentType = "audio/mpeg";
    let finalAudioBuffer = audioBuffer;
    if (audioKey.endsWith(".flac")) {
      audioContentType = "audio/flac";
    } else if (audioKey.endsWith(".wav")) {
      audioContentType = "audio/wav";
    } else {
      // MP3 — must be exactly 320 kbps @ 44.1 kHz; re-encode to guarantee compliance.
      logger.info("normalizing MP3 to 320kbps/44.1kHz");
      const normalized = await normalizeForRouteNote(audioBuffer, audioFilename);
      finalAudioBuffer = normalized.buffer;
      audioFilename = normalized.filename;
      audioContentType = normalized.contentType;
    }

    // Get RouteNote cookies
    const auth = await cx.query(api.distributorAuth.get, { distributor: "routenote" });
    if (!auth?.cookiesJson) {
      const msg = "no RouteNote cookies — bootstrap auth first";
      await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: msg });
      throw new Error(msg);
    }
    const cookies = JSON.parse(auth.cookiesJson) as CookieEntry[];

    const artistName = humanizeSlug(track.artistSlug);

    // Run the full curl-based pipeline (steps 1-8)
    let result;
    try {
      result = await distributeRouteNoteHttp(
        {
          releaseType: "single",
          // For singles RouteNote enforces album-title === track-title
          releaseTitle: track.title,
          artistName,
          genre: track.genre,
          explicit: false,
          tracks: [{
            audioBuffer: finalAudioBuffer,
            audioFilename,
            audioContentType,
            title: track.title,
          }],
          coverBuffer,
          coverFilename: coverKey ? coverKey.split("/").pop() : undefined,
        },
        cookies,
        (step, detail) => logger.info(`rn:${step}`, { detail }),
      );
    } catch (e) {
      const msg = (e as Error).message;
      await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: msg });
      throw e;
    }

    if (!result.loggedIn) {
      const msg = "RouteNote auth expired — re-bootstrap cookies";
      await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: msg });
      throw new Error(msg);
    }
    if (!result.upc) {
      const detail = result.steps.map((s) => `${s.step}=${s.ok ? "ok" : "FAIL"}${s.detail ? "(" + s.detail.slice(0, 60) + ")" : ""}`).join(" | ");
      await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: `create release failed: ${detail}` });
      throw new Error(detail);
    }
    await cx.mutation(api.distribution.setUpc, { id: input.jobId, upc: result.upc });

    const failedStep = result.steps.find((s) => !s.ok);
    if (failedStep) {
      const summary = result.steps.map((s) => `${s.step}=${s.ok ? "ok" : "FAIL"}`).join(" | ");
      await cx.mutation(api.distribution.setFailed, {
        id: input.jobId,
        error: `step ${failedStep.step} failed: ${failedStep.detail ?? "?"} | ${summary}`,
      });
      throw new Error(`step ${failedStep.step} failed`);
    }

    await cx.mutation(api.distribution.setDraftReady, {
      id: input.jobId,
      liveViewUrl: result.liveViewUrl,
    });
    logger.info("dist:single:draft_ready", { upc: result.upc });

    // Final submit via Playwright
    logger.info("dist:single:submitting via Playwright");
    const submit = await submitDistributeFreePlaywright(result.upc, cookies);

    // Persist refreshed cookies
    if (submit.refreshedCookies?.length) {
      await cx.mutation(api.distributorAuth.save, {
        distributor: "routenote",
        cookiesJson: JSON.stringify(submit.refreshedCookies),
      });
    }

    if (!submit.submitted) {
      await cx.mutation(api.distribution.setFailed, {
        id: input.jobId,
        error: `final submit didn't reach release_details: ${submit.finalUrl}${submit.modalText ? " | " + submit.modalText : ""}`,
      });
      throw new Error("final submit failed");
    }

    await cx.mutation(api.distribution.setSubmitted, {
      id: input.jobId,
      releaseUrl: submit.finalUrl,
    });
    logger.info("dist:single:submitted", { upc: result.upc, releaseUrl: submit.finalUrl });

    return { upc: result.upc, releaseUrl: submit.finalUrl };
  },
});
