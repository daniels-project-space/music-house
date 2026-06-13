/**
 * Music Video pipeline orchestrator (standalone, CLOUD-NATIVE).
 *
 * Designed to run on Trigger.dev cloud workers — NOT the VPS. The render uses
 * @remotion/renderer programmatically against a PRE-BUILT bundle (serveUrl)
 * shipped with the deploy, plus a runtime `publicDir` for the per-job assets.
 * This needs no nested node_modules at runtime (only @remotion/renderer, which
 * Trigger bundles; Chromium + ffmpeg come from the trigger.config extensions).
 *
 * Steps:
 *   1. pull render inputs from Convex
 *   2. download audio + cover from R2 into a temp publicDir
 *   3. probe duration → align lyrics (Groq forced alignment) → resolve links
 *   4. (best-effort) generate a Nano Banana background plate
 *   5. render VinylMusicVideo (renderMedia → mp4)
 *   6. upload the mp4 to R2 + presign a preview URL
 *   7. GATED: upload to Music House Records if its refresh token is present;
 *      otherwise leave the job "held" for review.
 */
import { existsSync } from "node:fs";
import { mkdir, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ConvexHttpClient } from "convex/browser";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { api } from "../../convex/_generated/api";
import { downloadToFile, getBuffer, presignDownload, put } from "./r2";
import { alignLyrics, type LyricLineInput, type TimedLine } from "./lyrics-align";
import { probeDurationSec } from "./ffprobe";
import { resolveLinks } from "./links";
import { generateBackgroundPlate } from "./nano-banana";
import { buildDescription, buildTitle, buildYouTubeTags } from "./tags";
import { setVideoThumbnail, uploadVideo } from "./youtube";

const FPS = 30;
const ACCENT_DEFAULT = "#E8B84B";
const COMPOSITION_ID = "VinylMusicVideo";

type MvProps = {
  title: string;
  artist: string;
  coverSrc: string;
  audioSrc: string;
  bgSrc?: string;
  lyrics: TimedLine[];
  accentColor: string;
  fps: number;
  durationInFrames: number;
};

export type RunOptions = {
  jobId: string;
  convexUrl?: string;
  doUpload?: boolean;
  privacy?: "private" | "unlisted" | "public";
  log?: (msg: string) => void;
};

export type RunResult = {
  jobId: string;
  videoKey: string;
  previewUrl: string;
  youtubeUrl?: string;
  held: boolean;
  alignMethod: string;
};

/** Locate the pre-built Remotion bundle (a static webpack site). On Trigger it
 *  is shipped via the additionalFiles extension; locally build it once with
 *  `cd music-video-remotion && node build-bundle.mjs`. Always prebuilt — no
 *  runtime bundling, so @remotion/bundler never enters the worker image. */
function resolveServeUrl(): string {
  const candidates = [
    process.env.MV_REMOTION_BUNDLE,
    path.resolve(process.cwd(), "music-video-remotion", "bundle"),
    path.resolve(__dirname, "..", "..", "music-video-remotion", "bundle"),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (existsSync(path.join(c, "index.html"))) return c;
  }
  throw new Error(
    `Remotion bundle not found (looked in: ${candidates.join(", ")}). ` +
      `Build it with: cd music-video-remotion && node build-bundle.mjs`,
  );
}

async function mhrRefreshToken(): Promise<string | undefined> {
  if (process.env.YOUTUBE_REFRESH_TOKEN_MUSIC_HOUSE_RECORDS)
    return process.env.YOUTUBE_REFRESH_TOKEN_MUSIC_HOUSE_RECORDS;
  try {
    const { getServiceSecrets } = await import("./vault");
    return (await getServiceSecrets("youtube")).YOUTUBE_REFRESH_TOKEN_MUSIC_HOUSE_RECORDS;
  } catch {
    return undefined;
  }
}

export async function runMusicVideoJob(opts: RunOptions): Promise<RunResult> {
  const log = opts.log ?? (() => {});
  const convexUrl = opts.convexUrl ?? process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) throw new Error("CONVEX_URL not set");
  const convex = new ConvexHttpClient(convexUrl);
  const { jobId } = opts;

  const mark = (patch: Record<string, unknown>) =>
    convex.mutation(api.musicVideo.markStatus, { jobId: jobId as any, ...patch });

  await mark({ status: "rendering", progress: "loading inputs" });

  const inputs = (await convex.query(api.musicVideo.getRenderInputs, { jobId: jobId as any })) as any;
  if (!inputs) throw new Error(`No render inputs for job ${jobId}`);
  const { track, artistName, albumName } = inputs;
  log(`Rendering "${track.title}" — ${artistName}`);

  // Audio is downloaded locally only for ffprobe + Groq alignment. Remotion
  // fetches all media over HTTPS via presigned R2 URLs (no staticFile/publicDir).
  const workDir = path.join(os.tmpdir(), `mv-${jobId}`);
  await mkdir(workDir, { recursive: true });
  const audioAbs = path.join(workDir, "audio.mp3");
  const workOut = path.join(os.tmpdir(), `mv-${jobId}.mp4`);

  try {
    // 2. assets
    await mark({ progress: "downloading audio" });
    if (!track.coverKey) throw new Error("Track has no cover art (track/album/artist coverKey all empty)");
    await downloadToFile(track.audioKey, audioAbs);
    const coverUrl = await presignDownload(track.coverKey, 6 * 3600);
    const audioUrl = await presignDownload(track.audioKey, 6 * 3600);

    // 3. duration → align → links
    let durationSec = track.durationSec ?? 0;
    try {
      durationSec = await probeDurationSec(audioAbs);
    } catch {
      log(`ffprobe failed, using stored duration ${durationSec}s`);
    }
    if (!durationSec || durationSec < 1) durationSec = 180;

    await mark({ progress: "aligning lyrics" });
    const lyricInput: LyricLineInput[] = (track.lyrics ?? []).map((l: any) => ({
      text: l.text,
      isSection: l.isSection,
    }));
    const aligned = await alignLyrics({ audioPath: audioAbs, lines: lyricInput, durationSec });
    log(`Lyric alignment: ${aligned.method} (confidence ${aligned.confidence.toFixed(2)})`);

    await mark({ progress: "resolving streaming links" });
    const links = await resolveLinks({ isrc: track.isrc });
    log(`Links: ${Object.keys(links.byPlatform).join(", ") || "none yet"}`);

    // 4. optional Nano Banana background plate (uploaded to R2 + presigned)
    let bgSrc: string | undefined;
    try {
      const plate = await generateBackgroundPlate(`${track.genre ?? "moody"} — ${track.title}`);
      if (plate) {
        const bgKey = `music-video/tmp/${jobId}-bg.jpg`;
        await put(bgKey, plate, "image/jpeg");
        bgSrc = await presignDownload(bgKey, 6 * 3600);
      }
    } catch {
      /* procedural bg fallback */
    }

    // 5. render (programmatic; serveUrl = prebuilt bundle; media via presigned URLs)
    const props: MvProps = {
      title: track.title,
      artist: artistName,
      coverSrc: coverUrl,
      audioSrc: audioUrl,
      bgSrc,
      lyrics: aligned.lines,
      accentColor: ACCENT_DEFAULT,
      fps: FPS,
      durationInFrames: Math.round(durationSec * FPS),
    };

    await mark({ progress: "preparing renderer" });
    await ensureBrowser();
    const serveUrl = resolveServeUrl();
    const composition = await selectComposition({
      serveUrl,
      id: COMPOSITION_ID,
      inputProps: props,
      // R2 presigned URLs have no CORS headers; assets are fetched in-browser.
      chromiumOptions: { gl: "swangle", disableWebSecurity: true },
    });

    await mark({ progress: "rendering video" });
    let lastPct = -1;
    await renderMedia({
      serveUrl,
      composition,
      codec: "h264",
      audioCodec: "aac",
      outputLocation: workOut,
      inputProps: props,
      // Use ALL worker cores (large-2x = 8 vCPU). null = Remotion auto-detects.
      concurrency: process.env.MV_CONCURRENCY ? Number(process.env.MV_CONCURRENCY) : null,
      imageFormat: "jpeg",
      jpegQuality: 80,
      chromiumOptions: { gl: "swangle", disableWebSecurity: true },
      onProgress: ({ progress }) => {
        const pct = Math.round(progress * 100);
        if (pct >= lastPct + 5) {
          lastPct = pct;
          log(`render ${pct}%`);
          // Surface real % to Convex so the /videos dashboard shows live progress.
          void mark({ progress: `rendering ${pct}%` });
        }
      },
    });

    // 6. upload to R2 + presign
    await mark({ progress: "uploading to R2" });
    const slug = `${track.title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const videoKey = `music-video/${inputs.track.id}/${slug || "video"}.mp4`;
    await put(videoKey, await readFile(workOut), "video/mp4");
    const previewUrl = await presignDownload(videoKey, 7 * 24 * 3600);

    await mark({
      status: "rendered",
      progress: "rendered",
      videoKey,
      previewUrl,
      linksJson: JSON.stringify(links),
      timedLyricsJson: JSON.stringify(aligned.lines),
      alignMethod: aligned.method,
    });
    log(`Rendered → ${videoKey}`);

    // 7. gated upload
    const result: RunResult = { jobId, videoKey, previewUrl, held: true, alignMethod: aligned.method };
    if (opts.doUpload) {
      const refreshToken = await mhrRefreshToken();
      if (!refreshToken) {
        await mark({ status: "held", progress: "rendered; channel not connected (no MHR refresh token)" });
        log("Upload skipped: Music House Records channel not connected.");
      } else {
        await mark({ status: "uploading", progress: "uploading to YouTube" });
        const meta = {
          title: track.title,
          artist: artistName,
          album: albumName ?? undefined,
          genre: track.genre ?? undefined,
          isrc: track.isrc ?? undefined,
          aiDisclosure: !!track.isAi,
        };
        const up = await uploadVideo({
          filePath: workOut,
          title: buildTitle(meta),
          description: buildDescription(meta, links),
          tags: buildYouTubeTags(meta),
          categoryId: "10",
          privacyStatus: opts.privacy ?? "unlisted",
          refreshToken,
          madeForKids: false,
        });
        try {
          await setVideoThumbnail(up.videoId, await getBuffer(track.coverKey), "image/jpeg", refreshToken);
        } catch (e) {
          log(`Thumbnail set failed (non-fatal): ${(e as Error).message}`);
        }
        await mark({ status: "published", progress: "published", youtubeVideoId: up.videoId, youtubeUrl: up.url });
        result.youtubeUrl = up.url;
        result.held = false;
        log(`Published → ${up.url}`);
      }
    }
    return result;
  } catch (err) {
    await mark({ status: "failed", error: (err as Error).message?.slice(0, 800) });
    throw err;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    await rm(workOut, { force: true }).catch(() => {});
  }
}
