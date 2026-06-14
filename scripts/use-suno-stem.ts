/**
 * Use a Suno-provided instrumental stem directly (no API separation needed).
 * Downloads the stem to the track's native instrumental R2 key and points the
 * track at it, so the karaoke render uses Suno's own stem.
 *   ./node_modules/.bin/tsx scripts/use-suno-stem.ts --track <id> --url <stemUrl>
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { put } from "../src/music-video/r2";
import { arg, convexUrl, loadEnvLocal } from "./_env";
(async () => {
  loadEnvLocal();
  const cx = new ConvexHttpClient(convexUrl());
  const trackId = arg("track");
  const url = arg("url");
  if (!trackId || !url) throw new Error("--track and --url required");
  const destKey = `music-video/stems/${trackId}-suno-instrumental.mp3`;
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  if (buf.length < 10000) throw new Error(`stem too small (${buf.length} bytes) — bad URL?`);
  await put(destKey, buf, "audio/mpeg");
  await cx.mutation(api.musicVideo.setInstrumentalKey, { trackId: trackId as any, instrumentalKey: destKey });
  console.log("OK stored Suno stem", buf.length, "bytes ->", destKey);
})().catch(e => { console.error(String(e)); process.exit(1); });
