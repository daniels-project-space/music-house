/**
 * Publish an already-rendered MAIN music video (full mix w/ vocals) to the
 * connected YouTube channel. No re-render — uploads the R2 mp4 directly, with
 * metacraft metadata (all real streaming links in the description).
 *   ./node_modules/.bin/tsx scripts/upload-existing.ts --job <jobId> [--privacy public]
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { resolveLinks } from "../src/music-video/links";
import { craftMusicMetadata } from "../src/music-video/metacraft";
import { uploadVideo, setVideoThumbnail, deleteVideo } from "../src/music-video/youtube";
import { downloadToFile, getBuffer } from "../src/music-video/r2";
import { arg, convexUrl, loadEnvLocal } from "./_env";
import { tmpdir } from "node:os";
import path from "node:path";

(async () => {
  loadEnvLocal();
  const cx = new ConvexHttpClient(convexUrl());
  const jobId = arg("job");
  const privacy = (arg("privacy") as "public" | "unlisted" | "private") ?? "public";
  if (!jobId) throw new Error("--job <jobId> required");

  const token = (await cx.query(api.youtubeChannels.getToken, { key: "music-house-records" })) as string | null;
  if (!token) throw new Error("No channel connected — finish /api/youtube/connect for Music House Productions first.");

  const job: any = await cx.query(api.musicVideo.getJob, { jobId: jobId as any });
  if (!job?.videoKey) throw new Error("Job has no main videoKey (render the main video first).");
  const inp: any = await cx.query(api.musicVideo.getRenderInputs, { jobId: jobId as any });
  const t = inp.track;
  const links = await resolveLinks({ seedUrl: t.seedUrl, isrc: t.isrc, artist: inp.artistName, title: t.title });
  const lyricsSample = (t.lyrics ?? []).filter((l: any) => !l.isSection).map((l: any) => l.text).join(" ").slice(0, 400);
  const crafted = await craftMusicMetadata(
    {
      title: t.title,
      artist: inp.artistName,
      album: inp.albumName ?? undefined,
      genre: t.genre ?? undefined,
      isrc: t.isrc ?? undefined,
      aiDisclosure: t.isAi,
      variant: "main",
      lyricsSample,
    },
    links,
    (m) => console.log("  · " + m),
  );

  const file = path.join(tmpdir(), `upload-${jobId}.mp4`);
  console.log("downloading", job.videoKey);
  await downloadToFile(job.videoKey, file);
  console.log(`uploading to YouTube as ${privacy} — "${crafted.title}"`);
  const up = await uploadVideo({
    filePath: file,
    title: crafted.title,
    description: crafted.description,
    tags: crafted.tags,
    categoryId: "10",
    privacyStatus: privacy,
    refreshToken: token,
    madeForKids: false,
  });
  try {
    await setVideoThumbnail(up.videoId, await getBuffer(t.coverKey), "image/jpeg", token);
  } catch (e) {
    console.log("thumb failed (non-fatal):", String((e as Error).message).slice(0, 100));
  }
  await cx.mutation(api.musicVideo.markStatus, {
    jobId: jobId as any,
    status: "published",
    progress: "published",
    youtubeVideoId: up.videoId,
    youtubeUrl: up.url,
    linksJson: JSON.stringify(links),
  });
  console.log("PUBLISHED:", up.url);

  // --replace <oldVideoId>: delete the prior cut now that the new one is live.
  const replace = arg("replace");
  if (replace && replace !== up.videoId) {
    try {
      await deleteVideo(replace, token);
      console.log("DELETED old video:", replace);
    } catch (e) {
      console.log("delete old failed (non-fatal):", String((e as Error).message).slice(0, 120));
    }
  }
})().catch((e) => {
  console.error("FAILED:", String(e));
  process.exit(1);
});
