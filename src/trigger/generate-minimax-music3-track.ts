import { logger, task, wait } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { closeMiniMaxMusic3Worker, launchMiniMaxMusic3Worker } from "../lib/novita-music3";
import { getBuffer, head, presignDownload, presignUpload, put } from "../lib/storage";
import { slug } from "../lib/transfer";

type LyricLine = { text: string; start: number; isSection: boolean };
type WorkerStatus = {
  status?: "complete" | "failed";
  error?: string;
  durationSeconds?: number;
  sampleRate?: number;
  channels?: number;
  bytes?: number;
};

export type MiniMaxMusic3GenerateInput = {
  jobId: Id<"generationJobs">;
  prompt: string;
  lyrics?: string;
  title?: string;
  genre?: string;
  artistSlug?: string;
  albumSlug?: string;
};

function convexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set in Trigger env");
  return new ConvexHttpClient(url);
}

function parseLyrics(text?: string): LyricLine[] | undefined {
  if (!text?.trim()) return undefined;
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => ({ text, start: 0, isSection: /^\[.+\]$/.test(text) }));
}

function seedFor(jobId: string) {
  let hash = 2166136261;
  for (const char of jobId) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function jobError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
}

async function readWorkerStatus(key: string): Promise<WorkerStatus | null> {
  const marker = await head(key);
  if (!marker) return null;
  try {
    return JSON.parse((await getBuffer(key)).toString("utf8")) as WorkerStatus;
  } catch {
    throw new Error("MiniMax Music3 worker wrote an unreadable status marker");
  }
}

// One queue means one 24 GB 4090, one render, and one GPU bill at a time. The
// server is also started with max-running-requests=1 inside the isolated worker.
export const generateMiniMaxMusic3Track = task({
  id: "generate-minimax-music3-track",
  queue: { name: "music-house-minimax-music3-4090", concurrencyLimit: 1 },
  maxDuration: 3600,
  retry: { maxAttempts: 1 },
  run: async (input: MiniMaxMusic3GenerateInput) => {
    const cx = convexClient();
    const title = input.title?.trim() || "Untitled";
    const trackSlug = `${slug(title)}-${Date.now().toString(36)}`;
    const artistSlug = input.artistSlug ?? "_unsorted";
    const baseKey = input.albumSlug
      ? `${artistSlug}/${input.albumSlug}/${trackSlug}`
      : `${artistSlug}/_singles/${trackSlug}`;
    const prefix = `workers/minimax-music3/${input.jobId}`;
    const requestKey = `${prefix}/request.json`;
    const statusKey = `${prefix}/status.json`;
    const audioKey = `${baseKey}.wav`;
    let worker: Awaited<ReturnType<typeof launchMiniMaxMusic3Worker>> | undefined;
    let output: { trackIds: Id<"tracks">[] } | undefined;
    let error: unknown;

    try {
      // Music3 requires non-empty lyrics even for an instrumental. The compact
      // instrumental form is the model's documented contract, not a fake vocal.
      const modelLyrics = input.lyrics?.trim() || "[Intro]\n(instrumental)\n[Outro]\n(instrumental)";
      await put(requestKey, JSON.stringify({
        model: "MiniMaxAI/MiniMax-Music3",
        input: modelLyrics,
        instructions: input.prompt,
        seed: seedFor(String(input.jobId)),
        // 3,000 frames = up to two minutes at the model's 25 fps. Quality stays
        // at MiniMax's reference defaults (both CFG stages and 30-step solver).
        max_new_tokens: 3000,
        response_format: "wav",
        stream: false,
      }), "application/json");

      worker = await launchMiniMaxMusic3Worker({
        jobId: String(input.jobId),
        inputUrl: await presignDownload(requestKey, 7_200),
        outputUrl: await presignUpload(audioKey, 7_200, "audio/wav"),
        statusUrl: await presignUpload(statusKey, 7_200, "application/json"),
      });
      await cx.mutation(api.jobs.setRunning, { id: input.jobId, triggerRunId: `minimax:${worker.instanceId}` });
      logger.info("minimax:start", {
        jobId: input.jobId,
        worker: worker.instanceName,
        product: worker.productName,
        spotPrice: worker.spotPrice,
      });

      let status: WorkerStatus | null = null;
      for (let attempt = 0; attempt < 180; attempt++) {
        status = await readWorkerStatus(statusKey);
        if (status) break;
        await wait.for({ seconds: 15 });
      }
      if (!status) throw new Error("MiniMax Music3 worker timed out without a completion marker");
      if (status.status !== "complete") throw new Error(status.error || "MiniMax Music3 worker failed before producing audio");
      if (status.sampleRate !== 32_000 || status.channels !== 2) {
        throw new Error(`MiniMax Music3 worker returned invalid audio (${status.sampleRate} Hz, ${status.channels} channels)`);
      }
      const audio = await head(audioKey);
      if (!audio || audio.size < 44 || !audio.contentType?.toLowerCase().includes("wav")) {
        throw new Error("MiniMax Music3 worker did not upload a valid WAV master");
      }

      const trackId = await cx.mutation(api.tracks.insert, {
        artistSlug,
        albumSlug: input.albumSlug,
        title,
        duration: status.durationSeconds,
        genre: input.genre,
        generator: "minimax",
        audioKey,
        lyrics: parseLyrics(input.lyrics),
      });
      await cx.mutation(api.jobs.setComplete, { id: input.jobId, resultTrackIds: [trackId] });
      output = { trackIds: [trackId] };
      logger.info("minimax:done", { jobId: input.jobId, trackId, seconds: status.durationSeconds, bytes: audio.size });
    } catch (caught) {
      error = caught;
    } finally {
      if (worker) {
        const closed = await closeMiniMaxMusic3Worker(worker.instanceId).catch(() => false);
        if (!closed) {
          const closeError = new Error(`Music House 4090 cleanup could not be verified for ${worker.instanceName}; the exact worker id is ${worker.instanceId}`);
          error ??= closeError;
          logger.error("minimax:cleanup-unverified", { jobId: input.jobId, instanceId: worker.instanceId });
        } else {
          logger.info("minimax:cleanup-verified", { jobId: input.jobId, instanceId: worker.instanceId });
        }
      }
    }

    if (error) {
      const message = jobError(error);
      logger.error("minimax:failed", { jobId: input.jobId, error: message });
      await cx.mutation(api.jobs.setFailed, { id: input.jobId, error: message }).catch((markFailedError) => {
        logger.error("minimax:failed-to-record-error", { jobId: input.jobId, error: jobError(markFailedError) });
      });
      throw error;
    }
    return output!;
  },
});
