/**
 * Async WAV-upgrade sweep.
 *
 * Suno's /wav/generate is sometimes slow or stuck. When it is, generate-suno-track
 * saves the MP3 Suno already returned (so the song ships) and flags the track
 * needsWavUpgrade=true. This cron picks those tracks up, retries the lossless WAV
 * export, and — once it readies — swaps the track's audioKey from .mp3 to .wav.
 *
 * Everything is best-effort and bounded: each track is tried inside its own
 * try/catch so one stuck export never blocks the others, only a handful are
 * processed per run, and bumpWavUpgradeAttempt gives up gracefully after a cap
 * (keeping the playable MP3).
 */
import { schedules, logger } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import * as suno from "../lib/suno";
import { downloadToR2 } from "../lib/transfer";

const MAX_PER_RUN = 5;

type UpgradeTrack = {
  _id: Id<"tracks">;
  audioKey: string;
  sunoTaskId?: string;
  sunoAudioId?: string;
  wavUpgradeAttempts?: number;
};

export const upgradeWav = schedules.task({
  id: "upgrade-wav",
  // Hourly (off the :00 mark on purpose). Widened from every-20-min 2026-07-07:
  // each patch re-triggers the reactive tracks.list on 5 pages, and pending WAVs
  // are not time-critical. needingWavUpgrade is now index-backed (cheap).
  cron: "7 * * * *",
  maxDuration: 900,
  // No internal retries. The project default is maxAttempts:3, which made
  // Trigger re-run this whole sweep up to 3x per cron tick on any throw — each
  // re-run re-looped the batch and bumped wavUpgradeAttempts again, accruing
  // ~24 attempts in ~1h instead of the ~3 a 20-min cron should allow. Each
  // track is already wrapped in its own try/catch (one bump per track per run),
  // so a single attempt is exactly what we want; the cron itself is the retry.
  retry: { maxAttempts: 1 },
  run: async () => {
    const convexUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!convexUrl) {
      logger.error("upgrade-wav: CONVEX_URL not set");
      return { upgraded: 0, attempted: 0 };
    }
    const cx = new ConvexHttpClient(convexUrl);

    const pending = (await cx.query(api.tracks.needingWavUpgrade, {})) as UpgradeTrack[];
    const batch = pending.slice(0, MAX_PER_RUN);
    logger.info(`upgrade-wav: ${pending.length} pending, processing ${batch.length}`);

    let upgraded = 0;
    let attempted = 0;
    for (const t of batch) {
      attempted++;
      try {
        if (!t.sunoTaskId || !t.sunoAudioId) {
          // Can't re-request the WAV without the Suno ids — give up on this one.
          logger.warn("upgrade-wav: track missing sunoTaskId/sunoAudioId, skipping", { trackId: t._id });
          await cx.mutation(api.tracks.bumpWavUpgradeAttempt, { trackId: t._id, attempts: 48 });
          continue;
        }

        logger.info("upgrade-wav: requesting WAV export", { trackId: t._id, audioId: t.sunoAudioId });
        const { wavTaskId } = await suno.requestWav({ taskId: t.sunoTaskId, audioId: t.sunoAudioId });
        // Bounded ~9 min: still well within maxDuration even across a few tracks.
        const wavUrl = await suno.pollWavUntilReady(wavTaskId, { intervalMs: 8000, timeoutMs: 9 * 60 * 1000 });

        // Derive the WAV key from the existing audioKey by swapping the extension.
        const baseKey = t.audioKey.replace(/\.[^./]+$/, "");
        const wavKey = `${baseKey}.wav`;
        await downloadToR2(wavUrl, wavKey, "audio/wav");
        await cx.mutation(api.tracks.upgradeAudioToWav, { trackId: t._id, wavKey });
        upgraded++;
        logger.info("upgrade-wav: upgraded to lossless WAV", { trackId: t._id, wavKey });
      } catch (e) {
        // Still not ready — record the attempt; the mutation caps and gives up gracefully.
        const attempts = (t.wavUpgradeAttempts ?? 0) + 1;
        logger.warn("upgrade-wav: WAV still not ready (non-fatal)", {
          trackId: t._id,
          attempts,
          err: String(e).slice(0, 200),
        });
        await cx.mutation(api.tracks.bumpWavUpgradeAttempt, { trackId: t._id, attempts });
      }
    }

    return { upgraded, attempted };
  },
});
