/**
 * Watch a music-video job until it finishes; prints the preview URL.
 *   ./node_modules/.bin/tsx scripts/mv-watch.ts --job <jobId> [--max 35]
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { arg, convexUrl, loadEnvLocal } from "./_env";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  loadEnvLocal();
  const convex = new ConvexHttpClient(convexUrl());
  const jobId = arg("job");
  if (!jobId) throw new Error("--job <jobId> required");
  const field = arg("field") ?? "previewUrl"; // e.g. karaokePreviewUrl
  const deadline = Date.now() + Number(arg("max") ?? "35") * 60_000;
  let prev = "";
  while (Date.now() < deadline) {
    const j: any = await convex.query(api.musicVideo.getJob, { jobId: jobId as any });
    const url = j?.[field];
    const line = `${j?.status} | ${j?.progress ?? ""} | ${url ? "URL" : "-"}`;
    if (line !== prev) {
      console.log(new Date().toISOString().slice(11, 19), line);
      prev = line;
    }
    if (["rendered", "held", "published"].includes(j?.status) && url) {
      console.log("PREVIEW_URL=" + url);
      process.exit(0);
    }
    if (j?.status === "failed") {
      console.log("FAILED: " + String(j.error ?? "").slice(0, 400));
      process.exit(1);
    }
    await sleep(15_000);
  }
  console.log("TIMEOUT waiting for job");
  process.exit(2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
