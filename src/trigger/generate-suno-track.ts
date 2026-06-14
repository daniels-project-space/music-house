import { task, logger } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import * as suno from "../lib/suno";
import { downloadToR2, slug } from "../lib/transfer";
import { ensureInstrumental } from "../music-video/stems";

function convexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set in Trigger env");
  return new ConvexHttpClient(url);
}

// Parse plain-text lyrics into the structured shape the schema expects.
// Section headers like [Verse 1] are flagged as isSection=true.
function parseLyrics(text: string): Array<{ text: string; start: number; isSection: boolean }> {
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

      // HARD RULE: every Suno track is saved as lossless WAV. No MP3 fallback — if the
      // WAV export fails, we fail the whole job rather than silently downgrade quality.
      // Suno V5_5's WAV is 44.1 kHz / 16-bit stereo (Spotify/Apple Music streaming spec).
      const audioId = t.id;
      if (!audioId) {
        throw new Error(
          `Suno track "${title}" has no audio id in response — can't queue WAV export. ` +
          `Suno API response shape may have changed; check src/lib/suno.ts mapping.`,
        );
      }

      logger.info("suno:requesting WAV export", { title, audioId });
      const { wavTaskId } = await suno.requestWav({ taskId, audioId });
      const wavUrl = await suno.pollWavUntilReady(wavTaskId, { intervalMs: 8000, timeoutMs: 12 * 60 * 1000 });

      const audioKey = `${baseKey}.wav`;
      await downloadToR2(wavUrl, audioKey, "audio/wav");
      logger.info("suno:WAV saved (lossless 44.1kHz stereo)", { audioKey });

      let coverKey: string | undefined;
      if (t.imageUrl) {
        coverKey = `${baseKey}.jpg`;
        await downloadToR2(t.imageUrl, coverKey, "image/jpeg");
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
        // Capture whatever lyrics exist at inception: Suno's returned lyrics
        // (vocal tracks) take precedence over the prompt we sent in.
        lyrics: (() => {
          const lyr = t.lyrics ?? input.lyrics;
          return lyr && lyr.trim().length > 0 ? parseLyrics(lyr) : undefined;
        })(),
      });
      created.push(id);

      // Cache Suno's native instrumental stem now so the karaoke video can be
      // auto-rendered later with zero extra setup (best-effort; never fails gen).
      try {
        const destKey = `music-video/stems/${id}-suno-instrumental.mp3`;
        const instKey = await ensureInstrumental({
          sunoTaskId: taskId,
          sunoAudioId: audioId,
          cachedKey: null,
          destKey,
          log: (m) => logger.info(m),
        });
        await cx.mutation(api.musicVideo.setInstrumentalKey, { trackId: id, instrumentalKey: instKey });
        logger.info("suno:instrumental stem cached", { destKey });
      } catch (e) {
        logger.warn("suno:instrumental separation failed (non-fatal)", { err: String(e).slice(0, 200) });
      }
    }

    await cx.mutation(api.jobs.setComplete, { id: input.jobId, resultTrackIds: created });
    logger.info("suno:done", { count: created.length });
    return { trackIds: created };
  },
});
