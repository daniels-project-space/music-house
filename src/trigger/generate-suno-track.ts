import { task, logger } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { buildAlignedLyrics, type LyricLine } from "../lib/build-aligned-lyrics";
import * as suno from "../lib/suno";
import { downloadToR2, slug } from "../lib/transfer";
import { ensureInstrumental } from "../music-video/stems";

export { buildAlignedLyrics, type LyricLine } from "../lib/build-aligned-lyrics";

function convexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set in Trigger env");
  return new ConvexHttpClient(url);
}

// Parse plain-text lyrics into the structured shape the schema expects.
// Section headers like [Verse 1] are flagged as isSection=true. Used as the
// fallback when timestamped alignment is unavailable (start stays 0).
function parseLyrics(text: string): LyricLine[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => ({
      text: l,
      start: 0,
      isSection: /^\[.+\]$/.test(l),
    }));
}

export type SunoGenerateInput = {
  jobId: Id<"generationJobs">;
  prompt: string;
  lyrics?: string;
  title?: string;
  artistSlug?: string;
  albumSlug?: string;
  callbackUrl?: string;
};

export const generateSunoTrack = task({
  id: "generate-suno-track",
  maxDuration: 1800,
  run: async (input: SunoGenerateInput, { ctx }) => {
    const cx = convexClient();
    logger.info("suno:start", { jobId: input.jobId });

    const { taskId } = await suno.generate({
      prompt: input.prompt,
      lyrics: input.lyrics,
      title: input.title ?? "Untitled",
      callbackUrl: input.callbackUrl,
    });
    await cx.mutation(api.jobs.setRunning, { id: input.jobId, triggerRunId: `suno:${taskId}` });

    const tracks = await suno.pollUntilComplete(taskId, { intervalMs: 6000, timeoutMs: 8 * 60 * 1000 });

    const created: Id<"tracks">[] = [];
    let i = 0;
    for (const t of tracks) {
      i++;
      const title = t.title ?? input.title ?? "Untitled";
      const trackSlug = `${slug(title)}-${Date.now().toString(36)}${i}`;
      const artistSlug = input.artistSlug ?? "_unsorted";
      const albumSlug = input.albumSlug;
      const baseKey = albumSlug
        ? `${artistSlug}/${albumSlug}/${trackSlug}`
        : `${artistSlug}/_singles/${trackSlug}`;

      // PREFERENCE: every Suno track wants to be saved as lossless WAV (44.1 kHz /
      // 16-bit stereo — Spotify/Apple Music streaming spec). Suno's /wav/generate
      // is sometimes slow or stuck, so we bound the wait and fall back to the MP3
      // Suno already returned rather than discarding a perfectly good generation.
      // When we fall back, the track is flagged needsWavUpgrade=true and the
      // upgrade-wav scheduled task swaps in the WAV later (async, non-blocking).
      const audioId = t.id;
      if (!audioId) {
        throw new Error(
          `Suno track "${title}" has no audio id in response — can't queue WAV export. ` +
          `Suno API response shape may have changed; check src/lib/suno.ts mapping.`,
        );
      }

      let audioKey: string;
      let needsWavUpgrade = false;
      let wavUpgradeAttempts: number | undefined;
      try {
        logger.info("suno:requesting WAV export", { title, audioId });
        const { wavTaskId } = await suno.requestWav({ taskId, audioId });
        // Bounded ~7 min: the WAV upgrade is now async, so we don't need to block
        // the whole generation on a slow export.
        const wavUrl = await suno.pollWavUntilReady(wavTaskId, { intervalMs: 8000, timeoutMs: 7 * 60 * 1000 });
        audioKey = `${baseKey}.wav`;
        await downloadToR2(wavUrl, audioKey, "audio/wav");
        logger.info("suno:WAV saved (lossless 44.1kHz stereo)", { audioKey });
      } catch (e) {
        // WAV slow/stuck/failed — do NOT discard the generation. Save the MP3 Suno
        // already returned and flag the track for async WAV upgrade.
        const mp3Url = t.audioUrl;
        if (!mp3Url) {
          throw new Error(
            `Suno track "${title}" WAV export failed AND no MP3 audioUrl to fall back to. ` +
            `WAV err: ${String(e).slice(0, 200)}`,
          );
        }
        logger.warn("suno:WAV export slow/failed — falling back to MP3, queued for async WAV upgrade", {
          title,
          err: String(e).slice(0, 200),
        });
        audioKey = `${baseKey}.mp3`;
        await downloadToR2(mp3Url, audioKey, "audio/mpeg");
        needsWavUpgrade = true;
        wavUpgradeAttempts = 0;
        logger.info("suno:MP3 saved (WAV upgrade pending)", { audioKey });
      }

      let coverKey: string | undefined;
      if (t.imageUrl) {
        coverKey = `${baseKey}.jpg`;
        await downloadToR2(t.imageUrl, coverKey, "image/jpeg");
      }

      // Lyrics: prefer karaoke-ready timestamped lines (real per-line start
      // times) so the player can highlight in sync. Best-effort — if alignment
      // fails or returns nothing, fall back to parseLyrics (start=0). A song is
      // never failed over lyric alignment.
      const lyricText = t.lyrics ?? input.lyrics;
      let lyrics: LyricLine[] | undefined;
      if (lyricText && lyricText.trim().length > 0) {
        lyrics = parseLyrics(lyricText);
        try {
          const { alignedWords } = await suno.getTimestampedLyrics({ taskId, audioId });
          if (alignedWords.length > 0) {
            const aligned = buildAlignedLyrics(lyricText, alignedWords);
            if (aligned.length > 0) {
              lyrics = aligned;
              logger.info("suno:timestamped lyrics aligned", { title, words: alignedWords.length });
            }
          } else {
            logger.warn("suno:timestamped lyrics empty — using unaligned fallback", { title });
          }
        } catch (e) {
          logger.warn("suno:timestamped lyrics failed (non-fatal, using fallback)", {
            err: String(e).slice(0, 200),
          });
        }
      }

      const id = await cx.mutation(api.tracks.insert, {
        artistSlug,
        albumSlug,
        title,
        duration: t.duration,
        generator: "suno",
        audioKey,
        coverKey,
        sunoTaskId: taskId,
        sunoAudioId: audioId,
        needsWavUpgrade,
        wavUpgradeAttempts,
        // Capture whatever lyrics exist at inception: Suno's returned lyrics
        // (vocal tracks) take precedence over the prompt we sent in.
        lyrics,
      });
      created.push(id);

      // Cache Suno's native stems now (instrumental backing track + isolated
      // vocal) so the karaoke video can be auto-rendered later with zero extra
      // setup (best-effort; never fails gen). Both stems are persisted.
      try {
        const destKey = `music-video/stems/${id}-suno-instrumental.mp3`;
        const { instrumentalKey, vocalKey } = await ensureInstrumental({
          sunoTaskId: taskId,
          sunoAudioId: audioId,
          cachedKey: null,
          destKey,
          log: (m) => logger.info(m),
        });
        await cx.mutation(api.musicVideo.setStems, { trackId: id, instrumentalKey, vocalKey });
        logger.info("suno:stems cached", { instrumentalKey, vocalKey });
      } catch (e) {
        logger.warn("suno:stem separation failed (non-fatal)", { err: String(e).slice(0, 200) });
      }
    }

    await cx.mutation(api.jobs.setComplete, { id: input.jobId, resultTrackIds: created });
    logger.info("suno:done", { count: created.length });
    return { trackIds: created };
  },
});
