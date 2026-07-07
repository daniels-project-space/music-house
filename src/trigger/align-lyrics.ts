/**
 * Self-healing karaoke lyric alignment sweep.
 *
 * generate-suno-track tries to fetch Suno's word-level timestamps at generation
 * time, but the call can return empty (Suno still rendering, transient error,
 * or an earlier bug that sent a bad param). When it does, the track ships with
 * unaligned lyrics — every line.start = 0 — so the player can't highlight in
 * sync. This cron picks those tracks up, re-fetches Suno's timestamped lyrics
 * (taskId + audioId — audioId pins the exact clip, so each take aligns to its
 * OWN audio), maps the word timings back onto the original lyric lines, and
 * writes real per-line starts.
 *
 * Everything is best-effort and bounded: each track is tried inside its own
 * try/catch so one failure never blocks the others, only a handful are
 * processed per run, and bumpLyricAlignAttempt caps retries so we give up
 * gracefully when alignment is genuinely unavailable (lyrics stay readable).
 */
import { schedules, logger } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import * as suno from "../lib/suno";
import { buildAlignedLyrics, type LyricLine } from "./generate-suno-track";

const MAX_PER_RUN = 5;

type AlignTrack = {
  _id: Id<"tracks">;
  title?: string;
  lyrics?: LyricLine[];
  sunoTaskId?: string;
  sunoAudioId?: string;
  lyricAlignAttempts?: number;
};

export const alignLyrics = schedules.task({
  id: "align-lyrics",
  // Hourly, off the :00 / WAV-sweep marks. Widened from every-20-min 2026-07-07:
  // needingLyricAlignment full-scans the fat tracks table (no boolean field to
  // index on — it inspects lyrics[] content), and each patch re-triggers the
  // reactive tracks.list on 5 pages. Lyric alignment is not time-critical.
  cron: "13 * * * *",
  maxDuration: 900,
  run: async () => {
    const convexUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!convexUrl) {
      logger.error("align-lyrics: CONVEX_URL not set");
      return { aligned: 0, attempted: 0 };
    }
    const cx = new ConvexHttpClient(convexUrl);

    const pending = (await cx.query(api.tracks.needingLyricAlignment, {})) as AlignTrack[];
    const batch = pending.slice(0, MAX_PER_RUN);
    logger.info(`align-lyrics: ${pending.length} pending, processing ${batch.length}`);

    let aligned = 0;
    let attempted = 0;
    for (const t of batch) {
      attempted++;
      try {
        if (!t.sunoTaskId || !t.sunoAudioId || !t.lyrics?.length) {
          logger.warn("align-lyrics: track missing ids/lyrics, skipping", { trackId: t._id });
          await cx.mutation(api.tracks.bumpLyricAlignAttempt, { trackId: t._id, attempts: 24 });
          continue;
        }

        // Reconstruct the original lyric text from the stored lines (text +
        // section headers, in order). buildAlignedLyrics re-derives the line
        // structure from this exactly as generate-suno-track did at inception.
        const originalText = t.lyrics.map((l) => l.text).join("\n");

        logger.info("align-lyrics: fetching timestamped lyrics", {
          trackId: t._id,
          audioId: t.sunoAudioId,
        });
        const { alignedWords } = await suno.getTimestampedLyrics({
          taskId: t.sunoTaskId,
          audioId: t.sunoAudioId,
        });

        if (alignedWords.length === 0) {
          const attempts = (t.lyricAlignAttempts ?? 0) + 1;
          logger.warn("align-lyrics: Suno returned no timestamps (unavailable)", {
            trackId: t._id,
            attempts,
          });
          await cx.mutation(api.tracks.bumpLyricAlignAttempt, { trackId: t._id, attempts });
          continue;
        }

        const lines = buildAlignedLyrics(originalText, alignedWords);
        const nonZero = lines.filter((l) => !l.isSection && l.start > 0).length;
        if (lines.length === 0 || nonZero === 0) {
          // Words came back but mapped to all-zero starts — treat as a failure
          // so we don't overwrite readable lyrics with another all-zero set.
          const attempts = (t.lyricAlignAttempts ?? 0) + 1;
          logger.warn("align-lyrics: alignment produced no non-zero starts", {
            trackId: t._id,
            attempts,
          });
          await cx.mutation(api.tracks.bumpLyricAlignAttempt, { trackId: t._id, attempts });
          continue;
        }

        await cx.mutation(api.tracks.setAlignedLyrics, { trackId: t._id, lyrics: lines });
        aligned++;
        logger.info("align-lyrics: aligned", {
          trackId: t._id,
          title: t.title,
          lines: lines.length,
          nonZeroStarts: nonZero,
          words: alignedWords.length,
        });
      } catch (e) {
        const attempts = (t.lyricAlignAttempts ?? 0) + 1;
        logger.warn("align-lyrics: failed (non-fatal)", {
          trackId: t._id,
          attempts,
          err: String(e).slice(0, 200),
        });
        await cx.mutation(api.tracks.bumpLyricAlignAttempt, { trackId: t._id, attempts });
      }
    }

    return { aligned, attempted };
  },
});
