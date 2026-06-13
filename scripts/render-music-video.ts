/**
 * Manual Music Video render (demo + ad-hoc).
 *
 *   npx tsx scripts/render-music-video.ts --track <trackId> [--fire-now]
 *   npx tsx scripts/render-music-video.ts --job <jobId> [--upload] [--privacy unlisted]
 *
 * Default holds the YouTube upload — it renders to R2 and prints a preview URL.
 * Pass --upload to attempt publishing (still gated on the channel token).
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { hydrate } from "../src/music-video/vault";
import { runMusicVideoJob } from "../src/music-video/pipeline";
import { arg, convexUrl, flag, loadEnvLocal } from "./_env";

(async () => {
  loadEnvLocal();
  const url = convexUrl();
  await hydrate(["cloudflare", "groq", "gemini", "youtube"]).catch((e) =>
    console.warn("vault hydrate partial:", (e as Error).message),
  );

  const convex = new ConvexHttpClient(url);
  let jobId = arg("job");
  const trackId = arg("track");
  if (!jobId) {
    if (!trackId) throw new Error("provide --job <id> or --track <id>");
    jobId = (await convex.mutation(api.musicVideo.scheduleForTrack, {
      trackId: trackId as any,
      fireNow: true,
    })) as unknown as string;
    console.log("scheduled job:", jobId);
  }

  const res = await runMusicVideoJob({
    jobId,
    convexUrl: url,
    doUpload: flag("upload"),
    privacy: (arg("privacy") as "private" | "unlisted" | "public") ?? "unlisted",
    log: (m) => console.log(m),
  });

  console.log("\n=== DONE ===");
  console.log("R2 video key :", res.videoKey);
  console.log("preview URL  :", res.previewUrl);
  console.log("lyric align  :", res.alignMethod);
  if (res.youtubeUrl) console.log("youtube      :", res.youtubeUrl);
  else console.log("upload       :", res.held ? "HELD (no channel token / --upload not set)" : "skipped");
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
