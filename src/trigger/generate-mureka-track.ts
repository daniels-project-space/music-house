import { task, logger } from "@trigger.dev/sdk/v3";

export type MurekaGenerateInput = {
  prompt: string;
  lyrics?: string;
  artistSlug?: string;
  albumSlug?: string;
  generationJobId: string;
};

// Skeleton — implement against Mureka V8 API in a follow-up step.
export const generateMurekaTrack = task({
  id: "generate-mureka-track",
  maxDuration: 1800,
  run: async (payload: MurekaGenerateInput) => {
    logger.info("mureka generate request", { jobId: payload.generationJobId });
    // TODO: pull MUREKA_API_KEY via vault, call Mureka, download FLAC, upload to R2,
    // write track row to Convex, update generationJobs.status.
    return { ok: true, todo: "implement" };
  },
});
