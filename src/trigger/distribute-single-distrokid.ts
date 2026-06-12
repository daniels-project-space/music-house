import { task, logger } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import sharp from "sharp";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { getBuffer } from "../lib/storage";
import { normalizeForRouteNote } from "../lib/audio-normalize";
import {
  distrokidSubmitFlow,
  validateBeforeSubmit,
  type CookieEntry,
  type DistrokidArtwork,
  type DistrokidReleasePayload,
  type DistrokidStoreSelection,
  type DistrokidTrack,
} from "../lib/distrokid-cli";

function convexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set in Trigger env");
  return new ConvexHttpClient(url);
}

function humanizeSlug(slug: string): string {
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

// Flatten the structured `tracks.lyrics` array (timed/section-tagged lines) into
// the plain-text string DistroKid's trackMetadata step expects.
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

export type DistributeSingleDistrokidInput = {
  jobId: Id<"distributionJobs">;
  dryRun?: boolean;
};

export const distributeSingleDistrokid = task({
  id: "distribute-single-distrokid",
  maxDuration: 900,
  machine: "large-1x",
  run: async (input: DistributeSingleDistrokidInput, { ctx }) => {
    const cx = convexClient();
    logger.info("dist:single:dk:start", { jobId: input.jobId, runId: ctx.run.id });

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

    // Prefer FLAC (lossless) over MP3 if present.
    const audioKey = (track as { flacKey?: string }).flacKey ?? track.audioKey;
    const audioBuffer = await getBuffer(audioKey);

    // If source is MP3, normalize to 320 kbps + 44.1 kHz + stereo. FLAC/WAV pass through.
    let audioFilename = audioKey.split("/").pop() ?? "audio";
    let audioContentType = "audio/mpeg";
    let finalAudioBuffer: Buffer = audioBuffer;
    if (audioKey.endsWith(".flac")) {
      audioContentType = "audio/flac";
    } else if (audioKey.endsWith(".wav")) {
      audioContentType = "audio/wav";
    } else {
      logger.info("normalizing MP3 to 320kbps/44.1kHz");
      const normalized = await normalizeForRouteNote(audioBuffer, audioFilename);
      finalAudioBuffer = normalized.buffer;
      audioFilename = normalized.filename;
      audioContentType = normalized.contentType;
    }

    // ----- HARD GUARD -------------------------------------------------------
    // Load DistroKid auth cookies BEFORE building any payload or touching the
    // CLI. If absent/empty, fail cleanly and return WITHOUT calling the CLI so
    // the build can never accidentally fire a live submit.
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
      logger.warn("dist:single:dk:no_cookies — aborting before CLI", { jobId: input.jobId });
      return { aborted: true, reason: msg };
    }
    // ------------------------------------------------------------------------

    // Resolve artwork buffer + dimensions (DistroKid requires exactly 3000x3000).
    const coverBuffer = coverKey ? await getBuffer(coverKey).catch(() => undefined) : undefined;
    if (!coverBuffer) {
      const msg = "no cover artwork found for track — DistroKid requires 3000x3000 artwork";
      await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: msg });
      throw new Error(msg);
    }
    const meta = await sharp(coverBuffer).metadata();
    const widthPx = meta.width ?? 0;
    const heightPx = meta.height ?? 0;
    const imageFilename = coverKey ? coverKey.split("/").pop() ?? "cover" : "cover";
    const imageContentType = meta.format === "png" ? "image/png" : "image/jpeg";
    const artwork: DistrokidArtwork = {
      imageBuffer: coverBuffer,
      imageFilename,
      imageContentType,
      widthPx,
      heightPx,
    };

    const artistName = humanizeSlug(track.artistSlug);
    // DistroKid requires a real legal name for songwriters, not the artist/stage name.
    // TODO: source this from a tracks/artist schema field per the metadata-source rule.
    const songwriterLegalName = process.env.DISTROKID_SONGWRITER_LEGAL_NAME ?? "Daniel Broj";
    const language = "en";
    const now = new Date();
    const releaseDate = now.toISOString().slice(0, 10);
    const copyrightYear = String(now.getUTCFullYear());

    // AI disclosure from the track (schema: { isAi, tools? } → CLI: { usedAi, details? }).
    const aiDisclosure = {
      usedAi: track.aiDisclosure?.isAi ?? false,
      details: track.aiDisclosure?.tools?.length
        ? track.aiDisclosure.tools.join(", ")
        : undefined,
    };

    // All stores / all territories.
    const stores: DistrokidStoreSelection = { storeIds: [], territories: [] };

    const dkTrack: DistrokidTrack = {
      title: track.title,
      trackNumber: track.trackNum ?? 1,
      artistName,
      isrc: track.isrc,
      explicit: false,
      language,
      lyrics: lyricsToPlainText(track.lyrics),
      songwriters: [songwriterLegalName],
      audio: {
        audioBuffer: finalAudioBuffer,
        audioFilename,
        audioContentType,
      },
    };

    const payload: DistrokidReleasePayload = {
      releaseTitle: track.title,
      artistName,
      genre: track.genre ?? "Electronic",
      language,
      releaseDate,
      copyrightYear,
      copyrightName: artistName,
      tracks: [dkTrack],
      artwork,
      aiDisclosure,
      stores,
    };

    // Pure pre-submit gate — hard-throws on any invalid field.
    try {
      validateBeforeSubmit(payload);
    } catch (e) {
      const msg = (e as Error).message;
      await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: msg });
      throw e;
    }

    // ----- Run the ordered CLI flow to a draft -----------------------------
    // Each step funnels through runDistrokidCli, which is INERT today and throws
    // DISTROKID_CLI_NOT_WIRED. Any failure (including that one) is surfaced via
    // setFailed before re-throwing.
    let releaseId: string;
    try {
      const created = await distrokidSubmitFlow.createRelease(payload, cookies);
      releaseId = created.stdout.trim();
      await distrokidSubmitFlow.releaseInfo(releaseId, payload, cookies);
      await distrokidSubmitFlow.uploadAudio(releaseId, dkTrack, cookies);
      await distrokidSubmitFlow.uploadArtwork(releaseId, artwork, cookies);
      await distrokidSubmitFlow.trackMetadata(releaseId, dkTrack, cookies);
      await distrokidSubmitFlow.setAiDisclosure(releaseId, aiDisclosure, cookies);
      await distrokidSubmitFlow.selectStores(releaseId, stores, cookies);
      await distrokidSubmitFlow.saveDraft(releaseId, cookies);
    } catch (e) {
      const msg = (e as Error).message;
      await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: msg });
      logger.error("dist:single:dk:draft_failed", { error: msg });
      throw e;
    }

    await cx.mutation(api.distribution.setDraftReady, { id: input.jobId });
    logger.info("dist:single:dk:draft_ready", { releaseId });

    if (input.dryRun) {
      logger.info("dist:single:dk:dryRun stop — draft ready on DistroKid, NOT submitted");
      return { releaseId, dryRun: true };
    }

    // ----- AUTO-SUBMIT ------------------------------------------------------
    let submitResult;
    try {
      submitResult = await distrokidSubmitFlow.submit(releaseId, cookies);
    } catch (e) {
      const msg = (e as Error).message;
      await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: msg });
      logger.error("dist:single:dk:submit_failed", { error: msg });
      throw e;
    }

    // The submit step's stdout carries the result; parse defensively.
    let upc: string | undefined;
    let releaseUrl: string | undefined;
    try {
      const parsed = JSON.parse(submitResult.stdout) as {
        upc?: string;
        releaseId?: string;
        url?: string;
      };
      upc = parsed.upc;
      releaseUrl = parsed.url;
      if (parsed.releaseId) releaseId = parsed.releaseId;
    } catch {
      // Non-JSON stdout — leave upc/url undefined, keep releaseId.
    }

    if (upc) await cx.mutation(api.distribution.setUpc, { id: input.jobId, upc });
    await cx.mutation(api.distribution.setSubmitted, { id: input.jobId, releaseUrl });
    logger.info("dist:single:dk:submitted", { releaseId, upc, releaseUrl });

    return { releaseId, upc, releaseUrl };
  },
});
