/**
 * Preview the EXACT title / description / tags a video will upload with — no
 * upload, no side effects. Borrows the music metacraft engine.
 *   ./node_modules/.bin/tsx scripts/preview-metadata.ts --job <jobId> [--variant main|karaoke]
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { resolveLinks } from "../src/music-video/links";
import { craftMusicMetadata } from "../src/music-video/metacraft";
import { arg, convexUrl, loadEnvLocal } from "./_env";

(async () => {
  loadEnvLocal();
  const cx = new ConvexHttpClient(convexUrl());
  const jobId = arg("job");
  const variant = (arg("variant") as "main" | "karaoke") ?? "main";
  if (!jobId) throw new Error("--job <jobId> required");

  const inp: any = await cx.query(api.musicVideo.getRenderInputs, { jobId: jobId as any });
  if (!inp) throw new Error("no render inputs for job");
  const t = inp.track;
  const links = await resolveLinks({ isrc: t.isrc, artist: inp.artistName, title: t.title });
  const lyricsSample = (t.lyrics ?? []).filter((l: any) => !l.isSection).map((l: any) => l.text).join(" ").slice(0, 400);
  const crafted = await craftMusicMetadata(
    {
      title: t.title,
      artist: inp.artistName,
      album: inp.albumName ?? undefined,
      genre: t.genre ?? undefined,
      isrc: t.isrc ?? undefined,
      aiDisclosure: t.isAi,
      variant,
      lyricsSample,
    },
    links,
    (m) => console.error("  · " + m),
  );

  const linkCount = Object.keys(links.byPlatform).length;
  console.log(`\n========== METADATA PREVIEW (${variant}) — source: ${crafted.source} ==========`);
  console.log(`\n----- TITLE (${crafted.title.length} chars) -----\n${crafted.title}`);
  console.log(`\n----- TAGS (${crafted.tags.length}) -----\n${crafted.tags.join(", ")}`);
  console.log(`\n----- DESCRIPTION -----\n${crafted.description}`);
  console.log(`\n----- LINKS RESOLVED (${linkCount} platforms) -----`);
  for (const [k, v] of Object.entries(links.byPlatform)) console.log(`  ${k}: ${v}`);
  if (!linkCount) console.log("  (none — Odesli has not indexed this song on any platform yet)");
  console.log("\n(nothing was uploaded)\n");
})().catch((e) => {
  console.error("FAILED:", String(e));
  process.exit(1);
});
