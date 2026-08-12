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
import { resolveReleaseLinks, hasAnyStoreLink } from "../lib/resolve-release-links";
import { validateReleaseMetadata } from "../lib/validate-release-metadata";
import { generatePitchCopy } from "../lib/pitch";

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
  /** Explicit ISO release date (YYYY-MM-DD). Overrides the lead-time default. */
  releaseDate?: string;
  /** Days from now to set the release date. Default: env or 21. A lead time keeps
   *  the Spotify editorial-pitch + pre-save + Release Radar window open. */
  leadDays?: number;
};

// Default release lead time. Spotify wants unreleased tracks pitched >=7 days
// ahead (via Spotify for Artists); ~3 weeks leaves room to pitch + pre-save.
const DEFAULT_LEAD_DAYS = 21;

function resolveReleaseDate(input: { releaseDate?: string; leadDays?: number }): string {
  if (input.releaseDate) return input.releaseDate;
  const lead = input.leadDays ?? Number(process.env.DISTROKID_RELEASE_LEAD_DAYS ?? DEFAULT_LEAD_DAYS);
  const days = Number.isFinite(lead) && lead >= 0 ? lead : DEFAULT_LEAD_DAYS;
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

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

    // Album metadata — reused by the quality gate, the cover fallback, and the
    // post-submit funnel-links hook below.
    const releaseAlbum = track.albumSlug
      ? await cx.query(api.albums.getOne, { artistSlug: track.artistSlug, slug: track.albumSlug })
      : null;

    // Metadata-quality gate (conservative): hard-block only when no genre exists
    // anywhere — DistroKid requires one. Missing description/cover are soft-flagged.
    const metaCheck = validateReleaseMetadata(track, releaseAlbum);
    if (!metaCheck.ok) {
      const msg = `metadata gate: missing ${metaCheck.hardMissing.join(", ")} — set a genre before distributing`;
      await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: msg });
      throw new AbortTaskRunError(msg);
    }
    if (metaCheck.softMissing.length) {
      logger.warn("dist:single:dk:metadata soft-flags", { missing: metaCheck.softMissing });
      await cx.mutation(api.distribution.setProgress, {
        id: input.jobId,
        progress: `metadata note: missing ${metaCheck.softMissing.join(", ")} (recommended for SEO)`,
      });
    }

    // Resolve cover key (track override → album cover fallback)
    let coverKey: string | undefined = track.coverKey;
    if (!coverKey && releaseAlbum) coverKey = releaseAlbum.coverKey ?? undefined;

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
    let widthPx = meta.width ?? 0;
    let heightPx = meta.height ?? 0;
    const imageFilename = coverKey ? coverKey.split("/").pop() ?? "cover" : "cover";
    let imageContentType = meta.format === "png" ? "image/png" : "image/jpeg";
    let finalCoverBuffer: Buffer = coverBuffer;
    // DistroKid requires EXACTLY 3000x3000. Square covers at other sizes are
    // deterministically resampled (lanczos3); non-square artwork is a content
    // error the pipeline can't fix — abort without retries.
    if (widthPx !== 3000 || heightPx !== 3000) {
      if (widthPx !== heightPx || widthPx === 0) {
        const msg = `cover artwork is ${widthPx}x${heightPx} — must be square to resample to 3000x3000`;
        await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: msg });
        throw new AbortTaskRunError(msg);
      }
      logger.info("resampling cover to 3000x3000", { from: `${widthPx}x${heightPx}` });
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
      imageFilename,
      imageContentType,
      widthPx,
      heightPx,
    };

    const artistName = humanizeSlug(track.artistSlug);
    // Pinned streaming-profile ids (else releases default to "new artist").
    const artistRec = await cx.query(api.artists.getBySlug, { slug: track.artistSlug });
    const artistIdentity =
      artistRec?.spotifyArtistId || artistRec?.appleArtistId
        ? { spotifyArtistId: artistRec?.spotifyArtistId, appleArtistId: artistRec?.appleArtistId }
        : undefined;
    // DistroKid requires a real legal name for songwriters, not the artist/stage name.
    // TODO: source this from a tracks/artist schema field per the metadata-source rule.
    const songwriterLegalName = process.env.DISTROKID_SONGWRITER_LEGAL_NAME ?? "Daniel Broj";
    const language = "en";
    // Future-dated by default — preserves the Spotify editorial-pitch / pre-save /
    // Release Radar window (immediate releases forfeit all of it).
    const releaseDate = resolveReleaseDate(input);
    const copyrightYear = releaseDate.slice(0, 4);

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

    // Genre drives Spotify's listener clustering. Prefer the track genre, then the
    // album's (niche-sourced) genre; only fall back to a neutral default. Pass the
    // secondary genre through too — it sharpens the recommendation target.
    const primaryGenre = track.genre ?? releaseAlbum?.genre ?? "Pop";
    const secondaryGenre = releaseAlbum?.secondaryGenre ?? undefined;

    const payload: DistrokidReleasePayload = {
      releaseTitle: track.title,
      artistName,
      genre: primaryGenre,
      secondaryGenre,
      language,
      releaseDate,
      copyrightYear,
      copyrightName: artistName,
      tracks: [dkTrack],
      artwork,
      aiDisclosure,
      stores,
      artistIdentity,
    };

    // Pure pre-submit gate — hard-throws on any invalid field. Validation
    // failures are deterministic: abort without retries.
    try {
      validateBeforeSubmit(payload);
    } catch (e) {
      const msg = (e as Error).message;
      await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: msg });
      throw new AbortTaskRunError(msg);
    }

    // ----- Native Playwright flow (one browser session in this container) ---
    // Bootstrap /new past Cloudflare, S3-upload artwork + audio, assemble the
    // verbatim distroAlbumPayload, and (live runs only) fire the single gated
    // distroAlbumSave POST. dryRun stops after uploads + payload assembly.
    // Live progress: each native-flow step is mirrored onto the job row so the
    // dashboard shows more than "agent working" (fire-and-forget — progress
    // must never fail the flow).
    const reportProgress = (msg: string) => {
      cx.mutation(api.distribution.setProgress, {
        id: input.jobId,
        progress: msg.slice(0, 200),
      }).catch(() => {});
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
      logger.error("dist:single:dk:flow_failed", { error: msg });
      throw e;
    }
    const releaseId = result.albumuuid;

    if (!result.submitted) {
      await cx.mutation(api.distribution.setDraftReady, { id: input.jobId });
      logger.info("dist:single:dk:dryRun stop — uploads + payload done, NOT submitted", {
        releaseId,
        artworkKey: result.artworkKey,
        audioKeys: result.audioKeys,
        mode: result.mode,
      });
      return { releaseId, dryRun: true, artworkKey: result.artworkKey, audioKeys: result.audioKeys, pinnedArtist: artistIdentity ?? null };
    }

    if (result.upc) {
      await cx.mutation(api.distribution.setUpc, { id: input.jobId, upc: result.upc });
    }
    await cx.mutation(api.distribution.setSubmitted, {
      id: input.jobId,
      releaseUrl: result.releaseUrl,
    });
    await cx.mutation(api.artists.markDistrokidReleased, { slug: track.artistSlug });
    logger.info("dist:single:dk:submitted", {
      releaseId,
      upc: result.upc,
      releaseUrl: result.releaseUrl,
    });

    // Spotify pitch copy: auto-generate the Spotify-for-Artists pitch now that the
    // release is submitted, so it's waiting in the UI instead of requiring a manual
    // "♪ Pitch" click first. Best-effort — the release is already submitted;
    // nothing here may throw (mirrors the storeLinks hook below).
    try {
      const pitchCopy = await generatePitchCopy(cx, {
        artistSlug: track.artistSlug,
        albumSlug: track.albumSlug,
        title: track.title,
      });
      await cx.mutation(api.tracks.setPitchCopy, { id: track._id, pitchCopy });
      logger.info("dist:single:dk:pitch generated", { length: pitchCopy.length });
    } catch (e) {
      logger.warn("dist:single:dk:pitch generation failed", { error: (e as Error).message });
    }

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
          logger.info("dist:single:dk:storeLinks", { keys: Object.keys(storeLinks) });
        } else {
          logger.info("dist:single:dk:storeLinks none yet — stores not indexed");
        }
      } catch (e) {
        logger.warn("dist:single:dk:storeLinks failed", { error: (e as Error).message });
      }
    }

    return { releaseId, upc: result.upc, releaseUrl: result.releaseUrl };
  },
});
