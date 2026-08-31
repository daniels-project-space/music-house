import { logger, task } from "@trigger.dev/sdk/v3";
import * as suno from "../lib/suno";
import { downloadToR2 } from "../lib/transfer";

type ExportSunoWavInput = {
  taskId: string;
  audioId: string;
  outputKey: string;
};

export const exportSunoWav = task({
  id: "export-suno-wav",
  maxDuration: 900,
  // WAV conversion consumes credits, so infrastructure retries must not duplicate it.
  retry: { maxAttempts: 1 },
  run: async (input: ExportSunoWavInput) => {
    if (!input.outputKey.endsWith(".wav")) {
      throw new Error("outputKey must end in .wav");
    }
    logger.info("suno:wav-export:start", {
      taskId: input.taskId,
      audioId: input.audioId,
      outputKey: input.outputKey,
    });
    const { wavTaskId } = await suno.requestWav({
      taskId: input.taskId,
      audioId: input.audioId,
    });
    const wavUrl = await suno.pollWavUntilReady(wavTaskId, {
      intervalMs: 8000,
      timeoutMs: 12 * 60 * 1000,
    });
    const stored = await downloadToR2(wavUrl, input.outputKey, "audio/wav");
    logger.info("suno:wav-export:complete", { wavTaskId, ...stored });
    return { wavTaskId, ...stored };
  },
});
