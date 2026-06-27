import { task, logger, tasks } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { getBuffer } from "../lib/storage";
import { distributeRouteNoteHttp, type CookieEntry } from "../lib/routenote-http";
import { submitDistributeFreePlaywright } from "../lib/routenote-playwright";
import { normalizeForRouteNote } from "../lib/audio-normalize";
import { resolveReleaseLinks, hasAnyStoreLink } from "../lib/resolve-release-links";
import { validateReleaseMetadata } from "../lib/validate-release-metadata";
import type { refreshRoutenoteAuthNow } from "./refresh-routenote-auth";

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
  dryRun?: boolean;
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

    // Album metadata — reused by the quality gate, the cover fallback, and the
    // post-submit funnel-links hook below.
    const releaseAlbum = track.albumSlug
      ? await cx.query(api.albums.getOne, { artistSlug: track.artistSlug, slug: track.albumSlug })
      : null;

    // Metadata-quality gate (conservative): hard-block only when no genre exists
    // anywhere — DistroKid requires one and the release would be rejected anyway.
    // Missing description/cover are soft-flagged (logged), never blocked.
    const meta = validateReleaseMetadata(track, releaseAlbum);
    if (!meta.ok) {
      const msg = `metadata gate: missing ${meta.hardMissing.join(", ")} — set a genre before distributing`;
      await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: msg });
      throw new Error(msg);
    }
    if (meta.softMissing.length) {
      logger.warn("dist:single:metadata soft-flags", { missing: meta.softMissing });
      await cx.mutation(api.distribution.setProgress, {
        id: input.jobId,
        progress: `metadata note: missing ${meta.softMissing.join(", ")} (recommended for SEO)`,
      });
    }

    // Resolve cover key (track override → album cover fallback)
    let coverKey: string | undefined = track.coverKey;
    if (!coverKey && releaseAlbum) coverKey = releaseAlbum.coverKey ?? undefined;

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

    // Get RouteNote cookies — self-heal if missing/expired by firing refreshRoutenoteAuthNow
    async function loadCookies(): Promise<CookieEntry[]> {
      const auth = await cx.query(api.distributorAuth.get, { distributor: "routenote" });
      if (!auth?.cookiesJson) return [];
      return JSON.parse(auth.cookiesJson) as CookieEntry[];
    }
    let cookies = await loadCookies();
    if (cookies.length === 0) {
      logger.info("no RouteNote cookies — auto-refreshing");
      const handle = await tasks.triggerAndWait<typeof refreshRoutenoteAuthNow>(
        "refresh-routenote-auth-now",
        {},
      );
      if (!handle.ok) {
        const msg = "auto-refresh failed; bootstrap manually";
        await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: msg });
        throw new Error(msg);
      }
      cookies = await loadCookies();
      if (cookies.length === 0) {
        const msg = "auth refresh succeeded but no cookies in Convex";
        await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: msg });
        throw new Error(msg);
      }
    }

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
      // Auth expired mid-pipeline — refresh cookies and retry the entire flow once.
      logger.warn("auth expired during distribute; firing auto-refresh and retrying");
      const refreshHandle = await tasks.triggerAndWait<typeof refreshRoutenoteAuthNow>(
        "refresh-routenote-auth-now",
        {},
      );
      if (!refreshHandle.ok) {
        const msg = "auth expired and auto-refresh failed";
        await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: msg });
        throw new Error(msg);
      }
      cookies = await loadCookies();
      result = await distributeRouteNoteHttp(
        {
          releaseType: "single",
          releaseTitle: track.title,
          artistName,
          genre: track.genre,
          explicit: false,
          tracks: [{ audioBuffer: finalAudioBuffer, audioFilename, audioContentType, title: track.title }],
          coverBuffer,
          coverFilename: coverKey ? coverKey.split("/").pop() : undefined,
        },
        cookies,
        (step, detail) => logger.info(`rn:${step}`, { detail }),
      );
      if (!result.loggedIn) {
        const msg = "auth still failed after refresh — RouteNote credentials may be wrong";
        await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: msg });
        throw new Error(msg);
      }
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

    // Dry-run: stop before the Playwright submit. Useful for verifying the curl pipeline
    // and the audio/cover/forms all land correctly without actually pushing to review.
    if (input.dryRun) {
      logger.info("dist:single:dryRun stop — release ready for review on RouteNote, NOT submitted");
      return { upc: result.upc, liveViewUrl: result.liveViewUrl, dryRun: true };
    }

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

    // SEO funnel: resolve this release's streaming-store links and persist them on
    // its album, so the public /r/{artist}/{album} page can link out to the stores.
    // Best-effort — the release is already submitted; nothing here may throw.
    if (track.albumSlug) {
      try {
        const storeLinks = await resolveReleaseLinks({
          isrc: track.isrc ?? job.isrc,
          seedUrl: track.seedUrl,
          artist: artistName,
          title: track.title,
        });
        if (hasAnyStoreLink(storeLinks)) {
          await cx.mutation(api.albums.setStoreLinks, {
            artistSlug: track.artistSlug,
            slug: track.albumSlug,
            links: storeLinks,
          });
          logger.info("dist:single:storeLinks", { keys: Object.keys(storeLinks) });
        } else {
          logger.info("dist:single:storeLinks none yet — stores not indexed");
        }
      } catch (e) {
        logger.warn("dist:single:storeLinks failed", { error: (e as Error).message });
      }
    }

    return { upc: result.upc, releaseUrl: submit.finalUrl };
  },
});
