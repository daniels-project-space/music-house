/**
 * Update an already-published video's metadata in place (no re-upload).
 *   ./node_modules/.bin/tsx scripts/update-live-meta.ts --job <jobId> --video <videoId> [--variant main]
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { resolveLinks } from "../src/music-video/links";
import { craftMusicMetadata } from "../src/music-video/metacraft";
import { updateVideoMeta, findYouTubeMusicLink } from "../src/music-video/youtube";
import { findSpotifyLink } from "../src/music-video/spotify-find";
import { arg, convexUrl, loadEnvLocal } from "./_env";

(async () => {
  loadEnvLocal();
  const cx = new ConvexHttpClient(convexUrl());
  const jobId = arg("job");
  const videoId = arg("video");
  const variant = (arg("variant") as "main" | "karaoke") ?? "main";
  if (!jobId || !videoId) throw new Error("--job and --video required");

  const token = (await cx.query(api.youtubeChannels.getToken, { key: "music-house-records" })) as string | null;
  if (!token) throw new Error("No channel connected.");
  const inp: any = await cx.query(api.musicVideo.getRenderInputs, { jobId: jobId as any });
  const t = inp.track;
  const links = await resolveLinks({ seedUrl: t.seedUrl, isrc: t.isrc, artist: inp.artistName, title: t.title });
  if (!links.byPlatform.spotify) {
    const sp = await findSpotifyLink(inp.artistName, t.title);
    if (sp) links.byPlatform.spotify = sp;
  }
  if (!links.byPlatform.youtubeMusic) {
    const ym = await findYouTubeMusicLink(inp.artistName, t.title, token);
    if (ym) links.byPlatform.youtubeMusic = ym;
  }
  const lyricsSample = (t.lyrics ?? []).filter((l: any) => !l.isSection).map((l: any) => l.text).join(" ").slice(0, 400);
  const crafted = await craftMusicMetadata(
    { title: t.title, artist: inp.artistName, album: inp.albumName ?? undefined, genre: t.genre ?? undefined, isrc: t.isrc ?? undefined, aiDisclosure: t.isAi, variant, lyricsSample },
    links,
    (m) => console.log("  · " + m),
  );
  await updateVideoMeta(videoId, { title: crafted.title, description: crafted.description, tags: crafted.tags }, token);
  console.log("UPDATED", videoId, "— platforms:", Object.keys(links.byPlatform).join(", "));
})().catch((e) => {
  console.error("FAILED:", String(e));
  process.exit(1);
});
