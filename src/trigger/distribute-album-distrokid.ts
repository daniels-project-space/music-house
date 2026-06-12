import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import sharp from "sharp";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { getBuffer } from "../lib/storage";
import { normalizeForRouteNote } from "../lib/audio-normalize";
import {
  validateBeforeSubmit,
  type CookieEntry,
  type DistrokidArtwork,
  type DistrokidReleasePayload,
  type DistrokidStoreSelection,
  type DistrokidTrack,
} from "../lib/distrokid-cli";
import { runDistrokidRelease } from "../lib/distrokid-native";

function convexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set in Trigger env");
  return new ConvexHttpClient(url);
}

function humanizeSlug(slug: string): string {
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

function lyricsToPlainText(
  lyrics: Array<{ text: string; start: number; isSection: boolean }> | undefined,
): string | undefined {
  if (!lyrics || lyrics.length === 0) return undefined;
  const text = lyrics
    .map((l) => l.text)
    .filter((t) => t && t.trim().length > 0)
    .join("\n")
    .trim();
  return text.length > 0 ? text : undefined;
}

export type DistributeAlbumDistrokidInput = {
  jobId: Id<"distributionJobs">;
  dryRun?: boolean;
};

// Whole-album DistroKid release. Mirrors distribute-single-distrokid but gathers
// every live track in the album into one multi-song distroAlbumPayload. The
// native lib (runDistrokidRelease) already uploads each track on a fresh S3
// policy and builds the multi-song payload; this task only assembles metadata.
export const distributeAlbumDistrokid = task({
  id: "distribute-album-distrokid",
  maxDuration: 1800,
  machine: "large-1x",
  run: async (input: DistributeAlbumDistrokidInput, { ctx }) => {
    const cx = convexClient();
    logger.info("dist:album:dk:start", { jobId: input.jobId, runId: ctx.run.id });

    await cx.mutation(api.distribution.setRunning, { id: input.jobId, triggerRunId: ctx.run.id });
    const job = await cx.query(api.distribution.get, { id: input.jobId });
    if (!job) throw new Error("distribution job not found");
    if (job.releaseType !== "album" || !job.albumId) throw new Error("not an album distribution job");

    const allAlbums = await cx.query(api.albums.list, {});
    const album = allAlbums.find((a) => a._id === job.albumId);
    if (!album) throw new Error("album not found");

    const albumTracks = await cx.query(api.tracks.list, {
      artistSlug: album.artistSlug,
      albumSlug: album.slug,
    });
    const tracks = albumTracks
      .filter((t) => !t.archivedAt)
      .sort((a, b) => (a.trackNum ?? 0) - (b.trackNum ?? 0));
    if (tracks.length === 0) throw new AbortTaskRunError("album has no live tracks");
    logger.info("dist:album:dk:tracks", { count: tracks.length, names: tracks.map((t) => t.title) });

    // ----- Cookie hard-guard (before any payload/CLI work) -----------------
    const auth = await cx.query(api.distributorAuth.get, { distributor: "distrokid" });
    let cookies: CookieEntry[] = [];
    if (auth?.cookiesJson) {
      try {
        cookies = JSON.parse(auth.cookiesJson) as CookieEntry[];
      } catch {
        cookies = [];
      }
    }
    if (cookies.length === 0) {
      const msg = "no DistroKid auth cookies — paste cookies first";
      await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: msg });
      logger.warn("dist:album:dk:no_cookies — aborting", { jobId: input.jobId });
      return { aborted: true, reason: msg };
    }

    // ----- Artwork (album cover → first track cover), resampled to 3000x3000 -
    const coverKey = album.coverKey ?? tracks[0].coverKey;
    const coverBuffer = coverKey ? await getBuffer(coverKey).catch(() => undefined) : undefined;
    if (!coverBuffer) {
      const msg = "no cover artwork for album — DistroKid requires 3000x3000 artwork";
      await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: msg });
      throw new AbortTaskRunError(msg);
    }
    const meta = await sharp(coverBuffer).metadata();
    let widthPx = meta.width ?? 0;
    let heightPx = meta.height ?? 0;
    let imageContentType = meta.format === "png" ? "image/png" : "image/jpeg";
    let finalCoverBuffer: Buffer = coverBuffer;
    if (widthPx !== 3000 || heightPx !== 3000) {
      if (widthPx !== heightPx || widthPx === 0) {
        const msg = `album cover is ${widthPx}x${heightPx} — must be square to resample to 3000x3000`;
        await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: msg });
        throw new AbortTaskRunError(msg);
      }
      logger.info("resampling album cover to 3000x3000", { from: `${widthPx}x${heightPx}` });
      finalCoverBuffer = await sharp(coverBuffer)
        .resize(3000, 3000, { kernel: "lanczos3", fit: "fill" })
        .jpeg({ quality: 95 })
        .toBuffer();
      widthPx = 3000;
      heightPx = 3000;
      imageContentType = "image/jpeg";
    }
    const artwork: DistrokidArtwork = {
      imageBuffer: finalCoverBuffer,
      imageFilename: coverKey ? coverKey.split("/").pop() ?? "cover" : "cover",
      imageContentType,
      widthPx,
      heightPx,
    };

    // ----- Per-track audio + metadata --------------------------------------
    const artistName = humanizeSlug(album.artistSlug);
    const artistRec = await cx.query(api.artists.getBySlug, { slug: album.artistSlug });
    const artistIdentity =
      artistRec?.spotifyArtistId || artistRec?.appleArtistId
        ? { spotifyArtistId: artistRec?.spotifyArtistId, appleArtistId: artistRec?.appleArtistId }
        : undefined;
    const songwriterLegalName = process.env.DISTROKID_SONGWRITER_LEGAL_NAME ?? "Daniel Broj";
    const language = "en";

    const dkTracks: DistrokidTrack[] = [];
    let albumUsedAi = false;
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      const audioKey = (t as { flacKey?: string }).flacKey ?? t.audioKey;
      const audioBuffer = await getBuffer(audioKey);
      let audioFilename = audioKey.split("/").pop() ?? "audio";
      let audioContentType = "audio/mpeg";
      let finalAudioBuffer: Buffer = audioBuffer;
      if (audioKey.endsWith(".flac")) {
        audioContentType = "audio/flac";
      } else if (audioKey.endsWith(".wav")) {
        audioContentType = "audio/wav";
      } else {
        logger.info("normalizing MP3 to 320kbps/44.1kHz", { title: t.title });
        const normalized = await normalizeForRouteNote(audioBuffer, audioFilename);
        finalAudioBuffer = normalized.buffer;
        audioFilename = normalized.filename;
        audioContentType = normalized.contentType;
      }
      const usedAi = t.aiDisclosure?.isAi ?? false;
      if (usedAi) albumUsedAi = true;
      dkTracks.push({
        title: t.title,
        trackNumber: i + 1, // contiguous 1..N regardless of source trackNum
        artistName,
        isrc: t.isrc,
        explicit: false,
        language,
        lyrics: lyricsToPlainText(t.lyrics),
        songwriters: [songwriterLegalName],
        audio: { audioBuffer: finalAudioBuffer, audioFilename, audioContentType },
      });
    }

    const now = new Date();
    const stores: DistrokidStoreSelection = { storeIds: [], territories: [] };
    const payload: DistrokidReleasePayload = {
      releaseTitle: album.name,
      artistName,
      genre: album.genre ?? "Electronic",
      language,
      releaseDate: now.toISOString().slice(0, 10),
      copyrightYear: String(now.getUTCFullYear()),
      copyrightName: artistName,
      tracks: dkTracks,
      artwork,
      // Album-level AI disclosure is true if ANY track was AI-made.
      aiDisclosure: { usedAi: albumUsedAi, details: albumUsedAi ? "AI-assisted production" : undefined },
      stores,
      artistIdentity,
    };

    try {
      validateBeforeSubmit(payload);
    } catch (e) {
      const msg = (e as Error).message;
      await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: msg });
      throw new AbortTaskRunError(msg);
    }

    const reportProgress = (msg: string) => {
      cx.mutation(api.distribution.setProgress, { id: input.jobId, progress: msg.slice(0, 200) }).catch(() => {});
    };

    let result;
    try {
      result = await runDistrokidRelease(payload, cookies, {
        dryRun: input.dryRun ?? false,
        log: (msg) => {
          logger.info("dk:native: " + msg);
          reportProgress(msg);
        },
      });
    } catch (e) {
      const msg = (e as Error).message;
      await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: msg });
      logger.error("dist:album:dk:flow_failed", { error: msg });
      throw e;
    }
    const releaseId = result.albumuuid;

    if (!result.submitted) {
      await cx.mutation(api.distribution.setDraftReady, { id: input.jobId });
      logger.info("dist:album:dk:dryRun stop — uploads + payload done, NOT submitted", {
        releaseId,
        trackCount: dkTracks.length,
        mode: result.mode,
      });
      return { releaseId, dryRun: true, trackCount: dkTracks.length, artworkKey: result.artworkKey, pinnedArtist: artistIdentity ?? null };
    }

    if (result.upc) await cx.mutation(api.distribution.setUpc, { id: input.jobId, upc: result.upc });
    await cx.mutation(api.distribution.setSubmitted, { id: input.jobId, releaseUrl: result.releaseUrl });
    await cx.mutation(api.artists.markDistrokidReleased, { slug: album.artistSlug });
    logger.info("dist:album:dk:submitted", { releaseId, upc: result.upc, trackCount: dkTracks.length });

    return { releaseId, upc: result.upc, releaseUrl: result.releaseUrl, trackCount: dkTracks.length };
  },
});
