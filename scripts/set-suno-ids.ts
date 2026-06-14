/**
 * Backfill a track's live Suno IDs so native stem separation (karaoke) can run.
 *   ./node_modules/.bin/tsx scripts/set-suno-ids.ts --track <id> --task <sunoTaskId> --audio <sunoAudioId>
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { arg, convexUrl, loadEnvLocal } from "./_env";
(async () => {
  loadEnvLocal();
  const cx = new ConvexHttpClient(convexUrl());
  const trackId = arg("track");
  const sunoTaskId = arg("task");
  const sunoAudioId = arg("audio");
  if (!trackId || !sunoTaskId || !sunoAudioId) throw new Error("--track --task --audio all required");
  await cx.mutation(api.musicVideo.setSunoIds, { trackId: trackId as any, sunoTaskId, sunoAudioId });
  console.log("OK set suno ids on", trackId, "->", { sunoTaskId, sunoAudioId });
})().catch(e => { console.error(String(e)); process.exit(1); });
