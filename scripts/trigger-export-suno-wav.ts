/** Trigger one production Suno WAV export and wait for its terminal result. */
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
  const taskId = arg("taskId");
  const audioId = arg("audioId");
  const outputKey = arg("outputKey");
  if (!taskId || !audioId || !outputKey) {
    throw new Error("--taskId, --audioId, and --outputKey are required");
  }

  const handle = await tasks.trigger("export-suno-wav", { taskId, audioId, outputKey });
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
