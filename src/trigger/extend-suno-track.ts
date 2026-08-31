import { logger, task } from "@trigger.dev/sdk/v3";
import * as suno from "../lib/suno";

type ExtendSunoTrackInput = {
  audioId: string;
  sourceDuration?: number;
  targetDurationSeconds?: number;
  maxExtensions?: number;
  model?: string;
};

export const extendSunoTrack = task({
  id: "extend-suno-track",
  maxDuration: 1800,
  // Extension calls consume credits. Never let an infrastructure retry duplicate them.
  retry: { maxAttempts: 1 },
  run: async (input: ExtendSunoTrackInput) => {
    const target = Math.max(10, Math.min(480, input.targetDurationSeconds ?? 300));
    const maxExtensions = Math.max(1, Math.min(4, input.maxExtensions ?? 1));
    let current = {
      id: input.audioId,
      duration: input.sourceDuration,
      audioUrl: "",
    } as suno.SunoTrack;
    const chain: Array<{
      taskId: string;
      sourceAudioId: string;
      candidates: suno.SunoTrack[];
      selected: suno.SunoTrack;
    }> = [];

    for (let index = 0; index < maxExtensions; index++) {
      if ((current.duration ?? 0) >= target - 1) break;
      logger.info("suno:extend:start", {
        extension: index + 1,
        audioId: current.id,
        sourceDuration: current.duration,
        target,
      });
      const sourceAudioId = current.id;
      const { taskId } = await suno.extend({
        audioId: sourceAudioId,
        model: input.model ?? "V5_5",
        defaultParamFlag: false,
      });
      const candidates = await suno.pollUntilComplete(taskId, {
        intervalMs: 6000,
        timeoutMs: 10 * 60 * 1000,
      });
      const selected = [...candidates].sort(
        (a, b) => (b.duration ?? 0) - (a.duration ?? 0),
      )[0];
      if (!selected?.id || !selected.audioUrl) {
        throw new Error(`Suno extension ${taskId} returned no usable tracks`);
      }
      chain.push({ taskId, sourceAudioId, candidates, selected });
      current = selected;
      logger.info("suno:extend:complete", {
        extension: index + 1,
        taskId,
        selectedAudioId: selected.id,
        selectedDuration: selected.duration,
      });
    }

    return {
      sourceAudioId: input.audioId,
      targetDurationSeconds: target,
      finalTrack: current,
      finalTaskId: chain.at(-1)?.taskId,
      chain,
    };
  },
});
