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
import { craftMusicMetadata } from "./metacraft";
import { findYouTubeMusicLink, setVideoThumbnail, uploadVideo } from "./youtube";
import { ensureInstrumental, findSunoIdsForTrack } from "./stems";
import { findSpotifyLink } from "./spotify-find";

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
  karaoke?: boolean;
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
  variant: "main" | "karaoke";
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

const KARAOKE_FIELD_MAP: Record<string, string> = {
  status: "karaokeStatus",
  progress: "karaokeProgress",
  error: "karaokeError",
  videoKey: "karaokeVideoKey",
  previewUrl: "karaokePreviewUrl",
  youtubeVideoId: "karaokeYoutubeVideoId",
  youtubeUrl: "karaokeYoutubeUrl",
};
// Fields meaningful only to the main render — never written on the karaoke run.
const KARAOKE_DROP = new Set(["linksJson", "timedLyricsJson", "alignMethod", "triggerRunId"]);

/**
 * Job status writer. For the karaoke variant, generic fields are auto-remapped
 * to karaoke-namespaced counterparts so the main + karaoke renders write to the
 * SAME job row without clobbering each other.
 */
export function marker(
  convex: ConvexHttpClient,
  jobId: string,
  variant: "main" | "karaoke" = "main",
) {
  return (patch: Record<string, unknown>) => {
    let p = patch;
    if (variant === "karaoke") {
      p = {};
      for (const [k, v] of Object.entries(patch)) {
        if (KARAOKE_DROP.has(k)) continue;
        p[KARAOKE_FIELD_MAP[k] ?? k] = v;
      }
    }
    return convex.mutation(api.musicVideo.markStatus, { jobId: jobId as any, ...p });
  };
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

async function mhrRefreshToken(convex: ConvexHttpClient): Promise<string | undefined> {
  if (process.env.YOUTUBE_REFRESH_TOKEN_MUSIC_HOUSE_RECORDS)
    return process.env.YOUTUBE_REFRESH_TOKEN_MUSIC_HOUSE_RECORDS;
  // Canonical store: the /api/youtube/connect flow writes the token here.
  try {
    const tok = (await convex.query(api.youtubeChannels.getToken, {
      key: "music-house-records",
    })) as string | null;
    if (tok) return tok;
  } catch {
    // fall through to vault
  }
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
  variant: "main" | "karaoke" = "main",
): Promise<RenderContext> {
  const mark = marker(convex, jobId, variant);
  await mark({ status: "rendering", progress: "loading inputs" });

  const inputs = (await convex.query(api.musicVideo.getRenderInputs, { jobId: jobId as any })) as any;
  if (!inputs) throw new Error(`No render inputs for job ${jobId}`);
  const { track, artistName, albumName } = inputs;
  log(`Preparing "${track.title}" — ${artistName}${variant === "karaoke" ? " [karaoke]" : ""}`);

  const workDir = path.join(os.tmpdir(), `mv-${jobId}-${variant}`);
  await mkdir(workDir, { recursive: true });

  // Vocal mix: needed for lyric alignment (and is the default playback audio).
  await mark({ progress: "downloading audio" });
  if (!track.coverKey) throw new Error("Track has no cover art (track/album/artist coverKey empty)");
  const vocalPath = path.join(workDir, "vocal.mp3");
  await downloadToFile(track.audioKey, vocalPath);
  const coverUrl = await presignDownload(track.coverKey, 6 * 3600);

  let durationSec = track.durationSec ?? 0;
  try {
    durationSec = await probeDurationSec(vocalPath);
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
  const aligned = await alignLyrics({ audioPath: vocalPath, lines: lyricInput, durationSec });
  log(`Lyric alignment: ${aligned.method} (${aligned.confidence.toFixed(2)})`);

  await mark({ progress: "resolving streaming links" });
  const links = await resolveLinks({ seedUrl: track.seedUrl, isrc: track.isrc, artist: artistName, title: track.title });

  // Playback audio: karaoke uses Suno's native vocals-removed instrumental.
  let audioPath = vocalPath;
  let audioSrc: string;
  if (variant === "karaoke") {
    await mark({ progress: "separating stems (suno native)" });
    const destKey = `music-video/stems/${inputs.track.id}-suno-instrumental.mp3`;
    let sunoTaskId = (track.sunoTaskId ?? null) as string | null;
    let sunoAudioId = (track.sunoAudioId ?? null) as string | null;
    // No stored IDs (e.g. generated before IDs were persisted)? Search the
    // account by title before aborting; persist what we find.
    if ((!sunoTaskId || !sunoAudioId) && track.instrumentalKey !== destKey) {
      log("karaoke: no Suno IDs on track — searching the account by title…");
      const found = await findSunoIdsForTrack(convex, { title: track.title, durationSec }, log);
      if (found) {
        sunoTaskId = found.sunoTaskId;
        sunoAudioId = found.sunoAudioId;
        await convex.mutation(api.musicVideo.setSunoIds, {
          trackId: inputs.track.id,
          sunoTaskId,
          sunoAudioId,
        });
      }
    }
    const instKey = await ensureInstrumental({
      sunoTaskId,
      sunoAudioId,
      cachedKey: track.instrumentalKey,
      destKey,
      log,
    });
    if (instKey !== track.instrumentalKey) {
      await convex.mutation(api.musicVideo.setInstrumentalKey, {
        trackId: inputs.track.id,
        instrumentalKey: instKey,
      });
    }
    audioPath = path.join(workDir, "instrumental.mp3");
    await downloadToFile(instKey, audioPath);
    audioSrc = await presignDownload(instKey, 6 * 3600);
  } else {
    audioSrc = await presignDownload(track.audioKey, 6 * 3600);
  }

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
    audioSrc,
    bgSrc,
    lyrics: aligned.lines,
    accentColor: ACCENT_DEFAULT,
    fps: FPS,
    durationInFrames,
    waveform,
    karaoke: variant === "karaoke",
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
      title: variant === "karaoke" ? `${track.title} (Karaoke)` : track.title,
      artistName,
      albumName: albumName ?? null,
      genre: track.genre ?? null,
      isrc: track.isrc ?? null,
      isAi: !!track.isAi,
      coverKey: track.coverKey,
      variant,
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
  // Remotion's default concurrency is round(min(8, cores/2)) — only HALF the
  // box. These chunks are CPU-bound 1080p software (swangle) renders, so at the
  // default we pay for the whole machine but use half of it. Use cores-1 (leave
  // one thread for node/ffmpeg/the encode), capped at 3 tabs (~2GB each) so
  // large-1x's 8GB never OOMs. Env MV_CONCURRENCY overrides for tuning.
  const cores = (os.availableParallelism?.() ?? os.cpus().length) || 2;
  // 4K pipeline: render the 1080 design at 2x = 3840x2160. Each 4K tab uses
  // ~2x the RAM, so cap concurrency lower at scale>=2 to avoid OOM.
  const scale = Number(process.env.MV_SCALE ?? 2);
  const concCap = scale >= 2 ? 2 : 3;
  const concurrency = process.env.MV_CONCURRENCY
    ? Number(process.env.MV_CONCURRENCY)
    : Math.max(1, Math.min(cores - 1, concCap));
  log(`render scale=${scale} concurrency=${concurrency} (cores=${cores})`);
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
    jpegQuality: 90,
    scale,
    concurrency,
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
  audioStartSec = 0,
): Promise<string> {
  const listPath = path.join(workDir, "concat.txt");
  await writeFile(listPath, partialPaths.map((p) => `file '${p}'`).join("\n"));
  // Re-encode on concat for robustness across separately-encoded h264 segments,
  // and mux the original audio. -shortest trims to the (slightly shorter) audio.
  // audioStartSec > 0 (preview slices that start mid-song) seeks the audio so it
  // stays aligned with the rendered frames; the full render passes 0 (no change).
  const audioInput =
    audioStartSec > 0 ? ["-ss", String(audioStartSec), "-i", audioPath] : ["-i", audioPath];
  await runFfmpeg(
    [
      "-v", "error", "-y",
      "-f", "concat", "-safe", "0", "-i", listPath,
      ...audioInput,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k",
      "-map", "0:v:0", "-map", "1:a:0", "-shortest",
      outPath,
    ],
    log,
  );
  return outPath;
}

/**
 * Preview finalize: upload a short QA clip to a DEDICATED R2 key and surface its
 * presigned URL via the job's progress line + the task return value. It never
 * touches the real videoKey/previewUrl/status fields and never publishes — so a
 * preview render can't clobber a finished video or trip the YouTube upload gate.
 */
export async function finalizePreview(
  convex: ConvexHttpClient,
  jobId: string,
  finalPath: string,
  meta: { trackId: string; variant: "main" | "karaoke" },
  log: (m: string) => void,
): Promise<{ jobId: string; previewClipKey: string; previewClipUrl: string; preview: true }> {
  const mark = marker(convex, jobId, meta.variant);
  const previewClipKey = `music-video/${meta.trackId}/_preview-${meta.variant}.mp4`;
  await put(previewClipKey, await readFile(finalPath), "video/mp4");
  const previewClipUrl = await presignDownload(previewClipKey, 24 * 3600);
  await mark({ progress: `PREVIEW READY → ${previewClipUrl}` });
  log(`Preview clip → ${previewClipKey}`);
  log(`PREVIEW URL (24h): ${previewClipUrl}`);
  return { jobId, previewClipKey, previewClipUrl, preview: true };
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
  const { meta, links } = ctx;
  const isKaraoke = meta.variant === "karaoke";
  const mark = marker(convex, jobId, meta.variant);
  await mark({ progress: "uploading to R2" });
  const slug = meta.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const videoKey = isKaraoke
    ? `music-video/${meta.trackId}/karaoke.mp4`
    : `music-video/${meta.trackId}/${slug || "video"}.mp4`;
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
    const refreshToken = await mhrRefreshToken(convex);
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
      try {
        if (!links.byPlatform.spotify) {
          const sp = await findSpotifyLink(meta.artistName, meta.title);
          if (sp) links.byPlatform.spotify = sp;
        }
      } catch {
        /* Spotify enrich is best-effort */
      }
      try {
        if (!links.byPlatform.youtubeMusic) {
          const ym = await findYouTubeMusicLink(meta.artistName, meta.title, refreshToken);
          if (ym) links.byPlatform.youtubeMusic = ym;
        }
      } catch {
        /* YT Music enrich is best-effort */
      }
      const crafted = await craftMusicMetadata({ ...m, variant: meta.variant }, links, log);
      const up = await uploadVideo({
        filePath: finalPath,
        title: crafted.title,
        description: crafted.description,
        tags: crafted.tags,
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
  variant?: "main" | "karaoke";
  log?: (m: string) => void;
}): Promise<RunResult> {
  const log = opts.log ?? (() => {});
  const convex = convexClient(opts.convexUrl);
  const mark = marker(convex, opts.jobId, opts.variant ?? "main");
  const ctx = await prepareRender(convex, opts.jobId, log, opts.variant ?? "main");
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
