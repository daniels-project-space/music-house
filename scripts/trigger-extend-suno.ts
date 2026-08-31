/** Trigger one production Suno extension and wait for its terminal result. */
import { runs, tasks } from "@trigger.dev/sdk/v3";
import { arg } from "./_env";

const terminal = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELED",
  "TIMED_OUT",
  "CRASHED",
  "SYSTEM_FAILURE",
  "EXPIRED",
]);

(async () => {
  if (!process.env.TRIGGER_SECRET_KEY) {
    throw new Error("TRIGGER_SECRET_KEY must be injected for the Music House production project");
  }
  const audioId = arg("audioId");
  if (!audioId) throw new Error("--audioId is required");
  const sourceDuration = Number(arg("sourceDuration") ?? "0");
  const targetDurationSeconds = Number(arg("targetDuration") ?? "300");
  const maxExtensions = Number(arg("maxExtensions") ?? "1");

  const handle = await tasks.trigger("extend-suno-track", {
    audioId,
    sourceDuration,
    targetDurationSeconds,
    maxExtensions,
    model: "V5_5",
  });
  console.log(`runId=${handle.id}`);

  while (true) {
    const run = await runs.retrieve(handle.id);
    console.log(`status=${run.status}`);
    if (terminal.has(run.status)) {
      console.log(JSON.stringify({ id: run.id, status: run.status, output: run.output }, null, 2));
      if (run.status !== "COMPLETED") process.exitCode = 1;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 6000));
  }
})().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
