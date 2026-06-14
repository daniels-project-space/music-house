/**
 * Dispatch the music-video-render task on Trigger.dev CLOUD (prod).
 *
 *   ./node_modules/.bin/tsx scripts/trigger-music-video.ts --job <jobId> [--upload true]
 *
 * Preview/iterate (cheap QA — renders ONE ~20s slice at full quality, no upload):
 *   ./node_modules/.bin/tsx scripts/trigger-music-video.ts --job <jobId> --preview true
 *   [--previewSec 20] [--previewStartSec 0]
 * The preview's presigned URL is printed in the run output and the job's progress
 * line (~$0.25 vs ~$3 for a full render). Drop --preview for the final render.
 *
 * The music-house prod Trigger key lives in the vault (service "trigger",
 * key MUSIC_HOUSE_TRIGGER_SECRET_KEY). We set it as TRIGGER_SECRET_KEY so the
 * SDK triggers the prod-deployed task.
 */
import { tasks } from "@trigger.dev/sdk/v3";
import { getServiceSecrets } from "../src/music-video/vault";
import { arg, convexUrl, loadEnvLocal } from "./_env";

(async () => {
  loadEnvLocal();
  const url = convexUrl();

  if (!process.env.TRIGGER_SECRET_KEY) {
    const env = await getServiceSecrets("trigger");
    const key =
      env.MUSIC_HOUSE_TRIGGER_SECRET_KEY ?? env.TRIGGER_SECRET_KEY_PROD_RMV2 ?? env.TRIGGER_SECRET_KEY;
    if (!key) throw new Error("No music-house prod Trigger secret key in vault service 'trigger'");
    process.env.TRIGGER_SECRET_KEY = key;
  }

  const jobId = arg("job");
  if (!jobId) throw new Error("--job <jobId> required");

  const preview = arg("preview") === "true";
  const previewSec = arg("previewSec") ? Number(arg("previewSec")) : undefined;
  const previewStartSec = arg("previewStartSec") ? Number(arg("previewStartSec")) : undefined;

  const handle = await tasks.trigger("music-video-render", {
    jobId,
    convexUrl: url,
    // Preview never uploads, regardless of --upload.
    doUpload: preview ? false : arg("upload") === "true",
    privacy: (arg("privacy") as "private" | "unlisted" | "public") ?? "unlisted",
    variant: (arg("variant") as "main" | "karaoke") ?? "main",
    preview,
    previewSec,
    previewStartSec,
  });

  console.log(preview ? "Triggered PREVIEW render (1 slice, full quality, no upload):" : "Triggered cloud render:");
  console.log("  run id:", handle.id);
  console.log("  job   :", jobId);
  if (preview) console.log("  preview URL prints in the run output + job progress line when done.");
  console.log("  dashboard: https://cloud.trigger.dev/projects/v3/proj_ukkzrxclaoncuvhvqpud/runs/" + handle.id);
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
