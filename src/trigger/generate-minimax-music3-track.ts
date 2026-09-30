import { logger, task } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export type MiniMaxMusic3GenerateInput = {
  jobId: Id<"generationJobs">;
  prompt: string;
  lyrics?: string;
  title?: string;
  genre?: string;
  artistSlug?: string;
  albumSlug?: string;
};

/** Retain the task ID so queued legacy runs fail without launching a provider. */
export const generateMiniMaxMusic3Track = task({
  id: "generate-minimax-music3-track",
  queue: { name: "music-house-minimax-music3-4090", concurrencyLimit: 1 },
  maxDuration: 60,
  retry: { maxAttempts: 1 },
  run: async (input: MiniMaxMusic3GenerateInput) => {
    const error = "MiniMax Music3 is waiting for its qualified Render Engine route; legacy GPU dispatch is retired";
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (url) {
      await new ConvexHttpClient(url).mutation(api.jobs.setFailed, { id: input.jobId, error }).catch((cause) => {
        logger.error("minimax:retired-job-update-failed", { jobId: input.jobId, cause: String(cause) });
      });
    }
    throw new Error(error);
  },
});
