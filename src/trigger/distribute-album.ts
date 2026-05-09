import { task, logger } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { getBuffer } from "../lib/storage";
import { distributeRouteNoteHttp, type CookieEntry, type DistributeTrack } from "../lib/routenote-http";
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

export type DistributeAlbumInput = {
  jobId: Id<"distributionJobs">;
  dryRun?: boolean;
};

export const distributeAlbum = task({
  id: "distribute-album",
  maxDuration: 1800,
  machine: "large-1x",
  run: async (input: DistributeAlbumInput, { ctx }) => {
    const cx = convexClient();
    logger.info("dist:album:start", { jobId: input.jobId, runId: ctx.run.id });

    await cx.mutation(api.distribution.setRunning, { id: input.jobId, triggerRunId: ctx.run.id });
    const job = await cx.query(api.distribution.get, { id: input.jobId });
    if (!job) throw new Error("distribution job not found");
    if (job.releaseType !== "album" || !job.albumId) throw new Error("not an album distribution job");

    // No `albums.get(id)` query exists; resolve via list() and pick by _id.
    const allAlbums = await cx.query(api.albums.list, {});
    const album = allAlbums.find((a) => a._id === job.albumId);
    if (!album) throw new Error("album not found");

    // Fetch all live tracks in this album, sorted by trackNum
    const albumTracks = await cx.query(api.tracks.list, {
      artistSlug: album.artistSlug,
      albumSlug: album.slug,
    });
    const tracks = albumTracks
      .filter((t) => !t.archivedAt)
      .sort((a, b) => (a.trackNum ?? 0) - (b.trackNum ?? 0));

    if (tracks.length === 0) throw new Error("album has no live tracks");
    if (tracks.length > 15) throw new Error(`album has ${tracks.length} tracks; RouteNote allows max 15`);

    logger.info("dist:album:tracks", { count: tracks.length, names: tracks.map((t) => t.title) });

    // Resolve cover (album cover, fall back to first track's cover)
    let coverKey: string | undefined = album.coverKey ?? tracks[0].coverKey;
    const coverBuffer = coverKey ? await getBuffer(coverKey).catch(() => undefined) : undefined;

    // Download + normalize all audio
    const distTracks: DistributeTrack[] = [];
    for (const t of tracks) {
      const audioKey = (t as { flacKey?: string }).flacKey ?? t.audioKey;
      const buf = await getBuffer(audioKey);
      let filename = audioKey.split("/").pop() ?? "audio";
      let contentType = "audio/mpeg";
      let finalBuf = buf;
      if (audioKey.endsWith(".flac")) {
        contentType = "audio/flac";
      } else if (audioKey.endsWith(".wav")) {
        contentType = "audio/wav";
      } else {
        logger.info("normalize", { trackId: t._id, title: t.title });
        const normalized = await normalizeForRouteNote(buf, filename);
        finalBuf = normalized.buffer;
        filename = normalized.filename;
        contentType = normalized.contentType;
      }
      distTracks.push({
        audioBuffer: finalBuf,
        audioFilename: filename,
        audioContentType: contentType,
        title: t.title,
      });
    }

    // Get RouteNote cookies
    const auth = await cx.query(api.distributorAuth.get, { distributor: "routenote" });
    if (!auth?.cookiesJson) {
      const msg = "no RouteNote cookies — bootstrap auth first";
      await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: msg });
      throw new Error(msg);
    }
    const cookies = JSON.parse(auth.cookiesJson) as CookieEntry[];

    const artistName = humanizeSlug(album.artistSlug);

    let result;
    try {
      result = await distributeRouteNoteHttp(
        {
          releaseType: "album",
          releaseTitle: album.name,
          artistName,
          genre: album.genre,
          explicit: false,
          tracks: distTracks,
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
      await cx.mutation(api.distribution.setFailed, {
        id: input.jobId,
        error: `step ${failedStep.step} failed: ${failedStep.detail ?? "?"}`,
      });
      throw new Error(`step ${failedStep.step} failed`);
    }

    await cx.mutation(api.distribution.setDraftReady, {
      id: input.jobId,
      liveViewUrl: result.liveViewUrl,
    });

    if (input.dryRun) {
      logger.info("dist:album:dryRun stop — release ready for review on RouteNote, NOT submitted", {
        upc: result.upc,
        trackCount: tracks.length,
      });
      return { upc: result.upc, liveViewUrl: result.liveViewUrl, trackCount: tracks.length, dryRun: true };
    }

    logger.info("dist:album:submitting via Playwright");
    const submit = await submitDistributeFreePlaywright(result.upc, cookies);

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
    logger.info("dist:album:submitted", { upc: result.upc, tracks: tracks.length });

    return { upc: result.upc, releaseUrl: submit.finalUrl, trackCount: tracks.length };
  },
});
