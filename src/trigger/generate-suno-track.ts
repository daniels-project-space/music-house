import { task, logger } from "@trigger.dev/sdk/v3";

export type SunoGenerateInput = {
  prompt: string;
  lyrics?: string;
  artistSlug?: string;
  albumSlug?: string;
  personaId?: string;
  generationJobId: string;
};

// Skeleton — implement against Suno API in a follow-up step.
export const generateSunoTrack = task({
  id: "generate-suno-track",
  maxDuration: 1800,
  run: async (payload: SunoGenerateInput) => {
    logger.info("suno generate request", { jobId: payload.generationJobId });
    // TODO: pull SUNO_API_KEY via vault, call Suno, poll, download stems, upload to R2,
    // write track rows to Convex, update generationJobs.status.
    return { ok: true, todo: "implement" };
  },
});
