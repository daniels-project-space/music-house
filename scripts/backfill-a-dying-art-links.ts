/**
 * Backfill the verified ISRC onto the "A Dying Art" single so the pipeline can
 * resolve streaming links (Spotify/Apple/Deezer/etc.) at render time.
 * Links are resolved from the ISRC alone via Deezer's public lookup — no store
 * URLs need to be stored.
 *
 *   npx tsx scripts/backfill-a-dying-art-links.ts
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { arg, convexUrl, loadEnvLocal } from "./_env";

const DEFAULT_TRACK_ID = "js7d0zwgzzhzx7dkek1nvmen7n85y69v"; // A Dying Art — The Dollcat Club
const DEFAULT_ISRC = "QT3FE2667534";

(async () => {
  loadEnvLocal();
  const url = convexUrl();
  const convex = new ConvexHttpClient(url);
  const trackId = arg("track") ?? DEFAULT_TRACK_ID;
  const isrc = arg("isrc") ?? DEFAULT_ISRC;
  await convex.mutation(api.musicVideo.setTrackIsrc, { trackId: trackId as any, isrc });
  console.log(`Set ISRC ${isrc} on track ${trackId}`);
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
