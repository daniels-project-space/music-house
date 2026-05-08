import { task, logger } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { getBuffer } from "../lib/storage";
import { getServiceSecrets } from "../lib/vault";
import { distributeToRoutenote } from "../lib/routenote";

function convexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set in Trigger env");
  return new ConvexHttpClient(url);
}

function humanizeSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

async function writeTempFile(prefix: string, ext: string, buf: Buffer): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `mh-distrib-${prefix}-`));
  const file = path.join(dir, `track${ext}`);
  await fs.writeFile(file, buf);
  return file;
}

export type DistributeInput = {
  jobId: Id<"distributionJobs">;
};

export const distributeTrack = task({
  id: "distribute-track",
  maxDuration: 1800,
  run: async (input: DistributeInput, { ctx }) => {
    const cx = convexClient();
    logger.info("distribute:start", { jobId: input.jobId, runId: ctx.run.id });

    await cx.mutation(api.distribution.setRunning, {
      id: input.jobId,
      triggerRunId: ctx.run.id,
    });

    let job: Awaited<ReturnType<typeof cx.query>>;
    try {
      job = await cx.query(api.distribution.get, { id: input.jobId });
    } catch (err) {
      throw new Error(`failed to load job: ${(err as Error).message}`);
    }
    if (!job) throw new Error("distribution job not found");

    const track = await cx.query(api.tracks.get, { id: (job as { trackId: Id<"tracks"> }).trackId });
    if (!track) throw new Error("track not found for distribution job");

    let audioPath: string | undefined;
    let coverPath: string | undefined;
    try {
      const audioBuf = await getBuffer(track.audioKey);
      const audioExt = track.audioKey.endsWith(".flac") ? ".flac" : ".mp3";
      audioPath = await writeTempFile("audio", audioExt, audioBuf);

      if (track.coverKey) {
        const coverBuf = await getBuffer(track.coverKey);
        const coverExt = track.coverKey.endsWith(".png") ? ".png" : ".jpg";
        coverPath = await writeTempFile("cover", coverExt, coverBuf);
      }

      const [rn, bb, anth] = await Promise.all([
        getServiceSecrets("routenote"),
        getServiceSecrets("browserbase"),
        getServiceSecrets("anthropic"),
      ]);

      const email = rn.ROUTENOTE_EMAIL ?? rn.EMAIL;
      const password = rn.ROUTENOTE_PASSWORD ?? rn.PASSWORD;
      if (!email || !password) {
        throw new Error("vault routenote: missing ROUTENOTE_EMAIL or ROUTENOTE_PASSWORD");
      }
      const bbApiKey = bb.BROWSERBASE_API_KEY ?? bb.API_KEY;
      const bbProjectId = bb.BROWSERBASE_PROJECT_ID ?? bb.PROJECT_ID;
      if (!bbApiKey || !bbProjectId) {
        throw new Error("vault browserbase: missing BROWSERBASE_API_KEY or BROWSERBASE_PROJECT_ID");
      }
      const anthKey = anth.ANTHROPIC_API_KEY;
      if (!anthKey) throw new Error("vault anthropic: missing ANTHROPIC_API_KEY");

      const { sessionId, liveViewUrl } = await distributeToRoutenote(
        {
          audioPath,
          coverPath,
          title: track.title,
          artistName: humanizeSlug(track.artistSlug),
          genre: track.genre,
        },
        { email, password },
        { apiKey: bbApiKey, projectId: bbProjectId },
        {
          provider: "anthropic",
          apiKey: anthKey,
          model: process.env.STAGEHAND_MODEL ?? "claude-sonnet-4-6",
        },
      );

      await cx.mutation(api.distribution.setDraftReady, {
        id: input.jobId,
        browserbaseSessionId: sessionId,
        liveViewUrl,
      });

      logger.info("distribute:draft_ready", { jobId: input.jobId, liveViewUrl });
      return { sessionId, liveViewUrl };
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      logger.error("distribute:failed", { jobId: input.jobId, error: msg });
      await cx.mutation(api.distribution.setFailed, { id: input.jobId, error: msg });
      throw err;
    } finally {
      const cleanup = async (p?: string) => {
        if (!p) return;
        try {
          await fs.rm(path.dirname(p), { recursive: true, force: true });
        } catch {}
      };
      await cleanup(audioPath);
      await cleanup(coverPath);
    }
  },
});
