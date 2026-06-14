/**
 * Music Video pipeline (standalone, CLOUD-NATIVE, PARALLEL).
 *
 * A single Trigger worker rendering 1080p in software GL is ~45-60 min, so the
 * production path splits each video into frame-range CHUNKS rendered in parallel
 * across many Trigger workers (Lambda-style), then concatenates them and muxes
 * the audio once. This module exposes the reusable stages; the orchestration
 * (fan-out) lives in src/trigger/music-video-render.ts.
 *
 * Stages:
 *   prepareRender   → inputs + Groq align + links + Node waveform + props
 *   renderToFile    → renderMedia (full single-worker, OR a muted frame-range chunk)
 *   concatChunksWithAudio → ffmpeg concat partials + mux audio → final mp4
 *   uploadAndFinalize → R2 upload + presign + Convex update + gated YouTube
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { ConvexHttpClient } from "convex/browser";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { api } from "../../convex/_generated/api";
import { downloadToFile, getBuffer, presignDownload, put } from "./r2";
import { alignLyrics, cleanLyricLines, type LyricLineInput, type TimedLine } from "./lyrics-align";
import { probeDurationSec } from "./ffprobe";
import { extractWaveformEnvelope } from "./waveform";
import { resolveLinks, type ResolvedLinks } from "./links";
import { generateBackgroundPlate } from "./nano-banana";
import { buildDescription, buildTitle, buildYouTubeTags } from "./tags";
import { setVideoThumbnail, uploadVideo } from "./youtube";

const FPS = 30;
const ACCENT_DEFAULT = "#E8B84B";
const COMPOSITION_ID = "VinylMusicVideo";

export type MvProps = {
  title: string;
  artist: string;
  coverSrc: string;
  audioSrc: string;
  bgSrc?: string;
  lyrics: TimedLine[];
  accentColor: string;
  fps: number;
  durationInFrames: number;
  waveform: number[];
};

export type RenderMeta = {
  trackId: string;
  title: string;
  artistName: string;
  albumName: string | null;
  genre: string | null;
  isrc: string | null;
  isAi: boolean;
  coverKey: string;
};

export type RenderContext = {
  props: MvProps;
  audioPath: string; // local mp3 (for muxing)
  durationInFrames: number;
  workDir: string;
  meta: RenderMeta;
  links: ResolvedLinks;
  alignMethod: string;
};

export type RunResult = {
  jobId: string;
  videoKey: string;
  previewUrl: string;
  youtubeUrl?: string;
  held: boolean;
  alignMethod: string;
};

export function convexClient(url?: string): ConvexHttpClient {
  const u = url ?? process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!u) throw new Error("CONVEX_URL not set");
  return new ConvexHttpClient(u);
}

export function marker(convex: ConvexHttpClient, jobId: string) {
  return (patch: Record<string, unknown>) =>
    convex.mutation(api.musicVideo.markStatus, { jobId: jobId as any, ...patch });
}

function resolveServeUrl(): string {
  const candidates = [
    process.env.MV_REMOTION_BUNDLE,
    path.resolve(process.cwd(), "music-video-remotion", "bundle"),
    path.resolve(__dirname, "..", "..", "music-video-remotion", "bundle"),
  ].filter(Boolean) as string[];
  for (const c of candidates) if (existsSync(path.join(c, "index.html"))) return c;
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

/** Stage 1: inputs → align → links → waveform → props. Downloads the audio
 *  locally (needed for the Node waveform + the final audio mux). */
export async function prepareRender(
  convex: ConvexHttpClient,
  jobId: string,
  log: (m: string) => void,
): Promise<RenderContext> {
  const mark = marker(convex, jobId);
  await mark({ status: "rendering", progress: "loading inputs" });

  const inputs = (await convex.query(api.musicVideo.getRenderInputs, { jobId: jobId as any })) as any;
  if (!inputs) throw new Error(`No render inputs for job ${jobId}`);
  const { track, artistName, albumName } = inputs;
  log(`Preparing "${track.title}" — ${artistName}`);

  const workDir = path.join(os.tmpdir(), `mv-${jobId}`);
  await mkdir(workDir, { recursive: true });
  const audioPath = path.join(workDir, "audio.mp3");

  await mark({ progress: "downloading audio" });
  if (!track.coverKey) throw new Error("Track has no cover art (track/album/artist coverKey empty)");
  await downloadToFile(track.audioKey, audioPath);
  const coverUrl = await presignDownload(track.coverKey, 6 * 3600);
  const audioUrl = await presignDownload(track.audioKey, 6 * 3600);

  let durationSec = track.durationSec ?? 0;
  try {
    durationSec = await probeDurationSec(audioPath);
  } catch {
    log(`ffprobe failed, using stored duration ${durationSec}s`);
  }
  if (!durationSec || durationSec < 1) durationSec = 180;
  const durationInFrames = Math.round(durationSec * FPS);

  await mark({ progress: "aligning lyrics" });
  const lyricInput: LyricLineInput[] = cleanLyricLines(
    (track.lyrics ?? []).map((l: any) => ({ text: l.text, isSection: l.isSection })),
    track.title,
  );
  const aligned = await alignLyrics({ audioPath, lines: lyricInput, durationSec });
  log(`Lyric alignment: ${aligned.method} (${aligned.confidence.toFixed(2)})`);

  await mark({ progress: "resolving streaming links" });
  const links = await resolveLinks({ isrc: track.isrc, artist: artistName, title: track.title });

  let bgSrc: string | undefined;
  try {
    const plate = await generateBackgroundPlate(`${track.genre ?? "moody"} — ${track.title}`);
    if (plate) {
      const bgKey = `music-video/tmp/${jobId}-bg.jpg`;
      await put(bgKey, plate, "image/jpeg");
      bgSrc = await presignDownload(bgKey, 6 * 3600);
    }
  } catch {
    /* procedural bg */
  }

  await mark({ progress: "analyzing audio" });
  const waveform = await extractWaveformEnvelope(audioPath, FPS, durationInFrames).catch((e) => {
    log(`waveform extract failed: ${(e as Error).message}`);
    return [] as number[];
  });

  const props: MvProps = {
    title: track.title,
    artist: artistName,
    coverSrc: coverUrl,
    audioSrc: audioUrl,
    bgSrc,
    lyrics: aligned.lines,
    accentColor: ACCENT_DEFAULT,
    fps: FPS,
    durationInFrames,
    waveform,
  };

  return {
    props,
    audioPath,
    durationInFrames,
    workDir,
    alignMethod: aligned.method,
    links,
    meta: {
      trackId: inputs.track.id,
      title: track.title,
      artistName,
      albumName: albumName ?? null,
      genre: track.genre ?? null,
      isrc: track.isrc ?? null,
      isAi: !!track.isAi,
      coverKey: track.coverKey,
    },
  };
}

/** Render the composition to a local mp4 — either the whole thing (single
 *  worker, audio included) or a muted frame-range chunk. */
export async function renderToFile(
  props: MvProps,
  outPath: string,
  log: (m: string) => void,
  opts: { frameRange?: [number, number]; muted?: boolean; onPct?: (pct: number) => void } = {},
): Promise<string> {
  await ensureBrowser();
  const serveUrl = resolveServeUrl();
  const composition = await selectComposition({
    serveUrl,
    id: COMPOSITION_ID,
    inputProps: props,
    chromiumOptions: { gl: "swangle", disableWebSecurity: true },
  });
  let lastPct = -1;
  await renderMedia({
    serveUrl,
    composition,
    codec: "h264",
    audioCodec: "aac",
    muted: opts.muted ?? false,
    frameRange: opts.frameRange,
    outputLocation: outPath,
    inputProps: props,
    imageFormat: "jpeg",
    jpegQuality: 80,
    concurrency: process.env.MV_CONCURRENCY ? Number(process.env.MV_CONCURRENCY) : null,
    chromiumOptions: { gl: "swangle", disableWebSecurity: true },
    onProgress: ({ progress }) => {
      const pct = Math.round(progress * 100);
      if (pct >= lastPct + 10) {
        lastPct = pct;
        opts.onPct?.(pct);
      }
    },
  });
  return outPath;
}

function runFfmpeg(args: string[], log: (m: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err.slice(-400)}`))));
  });
}

/** Concatenate the ordered video-only chunk files and mux the full audio track. */
export async function concatChunksWithAudio(
  partialPaths: string[],
  audioPath: string,
  outPath: string,
  workDir: string,
  log: (m: string) => void,
): Promise<string> {
  const listPath = path.join(workDir, "concat.txt");
  await writeFile(listPath, partialPaths.map((p) => `file '${p}'`).join("\n"));
  // Re-encode on concat for robustness across separately-encoded h264 segments,
  // and mux the original audio. -shortest trims to the (slightly shorter) audio.
  await runFfmpeg(
    [
      "-v", "error", "-y",
      "-f", "concat", "-safe", "0", "-i", listPath,
      "-i", audioPath,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k",
      "-map", "0:v:0", "-map", "1:a:0", "-shortest",
      outPath,
    ],
    log,
  );
  return outPath;
}

/** Stage 3: upload final mp4 → R2, presign, mark rendered, gated YouTube. */
export async function uploadAndFinalize(
  convex: ConvexHttpClient,
  jobId: string,
  finalPath: string,
  ctx: { meta: RenderMeta; links: ResolvedLinks; alignMethod: string },
  opts: { doUpload?: boolean; privacy?: "private" | "unlisted" | "public" },
  log: (m: string) => void,
): Promise<RunResult> {
  const mark = marker(convex, jobId);
  const { meta, links } = ctx;
  await mark({ progress: "uploading to R2" });
  const slug = meta.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const videoKey = `music-video/${meta.trackId}/${slug || "video"}.mp4`;
  await put(videoKey, await readFile(finalPath), "video/mp4");
  const previewUrl = await presignDownload(videoKey, 7 * 24 * 3600);

  await mark({
    status: "rendered",
    progress: "rendered",
    videoKey,
    previewUrl,
    linksJson: JSON.stringify(links),
    alignMethod: ctx.alignMethod,
  });
  log(`Rendered → ${videoKey}`);

  const result: RunResult = { jobId, videoKey, previewUrl, held: true, alignMethod: ctx.alignMethod };
  if (opts.doUpload) {
    const refreshToken = await mhrRefreshToken();
    if (!refreshToken) {
      await mark({ status: "held", progress: "rendered; channel not connected" });
      log("Upload skipped: Music House Records channel not connected.");
    } else {
      await mark({ status: "uploading", progress: "uploading to YouTube" });
      const m = {
        title: meta.title,
        artist: meta.artistName,
        album: meta.albumName ?? undefined,
        genre: meta.genre ?? undefined,
        isrc: meta.isrc ?? undefined,
        aiDisclosure: meta.isAi,
      };
      const up = await uploadVideo({
        filePath: finalPath,
        title: buildTitle(m),
        description: buildDescription(m, links),
        tags: buildYouTubeTags(m),
        categoryId: "10",
        privacyStatus: opts.privacy ?? "unlisted",
        refreshToken,
        madeForKids: false,
      });
      try {
        await setVideoThumbnail(up.videoId, await getBuffer(meta.coverKey), "image/jpeg", refreshToken);
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
}

/** Single-worker render (local script / fallback). Slow for 1080p — production
 *  uses the parallel chunked orchestrator in the Trigger task. */
export async function runMusicVideoJob(opts: {
  jobId: string;
  convexUrl?: string;
  doUpload?: boolean;
  privacy?: "private" | "unlisted" | "public";
  log?: (m: string) => void;
}): Promise<RunResult> {
  const log = opts.log ?? (() => {});
  const convex = convexClient(opts.convexUrl);
  const mark = marker(convex, opts.jobId);
  const ctx = await prepareRender(convex, opts.jobId, log);
  const out = path.join(os.tmpdir(), `mv-${opts.jobId}.mp4`);
  try {
    await mark({ progress: "rendering video" });
    await renderToFile(ctx.props, out, log, {
      onPct: (pct) => void mark({ progress: `rendering ${pct}%` }),
    });
    return await uploadAndFinalize(convex, opts.jobId, out, ctx, opts, log);
  } catch (err) {
    await mark({ status: "failed", error: (err as Error).message?.slice(0, 800) });
    throw err;
  } finally {
    await rm(ctx.workDir, { recursive: true, force: true }).catch(() => {});
    await rm(out, { force: true }).catch(() => {});
  }
}
