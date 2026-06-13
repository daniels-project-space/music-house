/**
 * Run the prepare stage for a job and dump the resolved Remotion props to a
 * file, so we can render stills locally to iterate on the look.
 *   ./node_modules/.bin/tsx scripts/dump-props.ts --job <jobId> --out /tmp/mv-props.json
 */
import { writeFileSync } from "node:fs";
import { convexClient, prepareRender } from "../src/music-video/pipeline";
import { hydrate } from "../src/music-video/vault";
import { arg, convexUrl, loadEnvLocal } from "./_env";

(async () => {
  loadEnvLocal();
  const url = convexUrl();
  await hydrate(["cloudflare", "groq", "gemini", "youtube"]).catch(() => {});
  const convex = convexClient(url);
  const jobId = arg("job");
  if (!jobId) throw new Error("--job required");
  const ctx = await prepareRender(convex, jobId, (m) => console.error("[prep]", m));
  writeFileSync(arg("out") ?? "/tmp/mv-props.json", JSON.stringify(ctx.props));
  console.error(`\nalign=${ctx.alignMethod} frames=${ctx.durationInFrames} lyricLines=${ctx.props.lyrics.length}`);
  console.error("first caption timings:");
  for (const l of ctx.props.lyrics.slice(0, 8)) {
    console.error(`  ${l.start.toFixed(1)}s–${l.end.toFixed(1)}s ${l.isSection ? "[sec] " : ""}${l.text.slice(0, 48)}`);
  }
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
