import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execP = promisify(execFile);

// RouteNote requires MP3 at exactly 320 kbps + 44.1 kHz + stereo, OR FLAC, OR WAV
// (with format-specific bitrate rules). Suno-generated MP3s are typically 180 kbps @ 48 kHz —
// these get rejected by RouteNote's audio validator (`bitrate too low` / `samplerate too high`).
//
// This helper takes ANY input audio buffer and returns a guaranteed-RouteNote-compliant
// 320 kbps 44.1 kHz stereo MP3 buffer. ffmpeg is shipped via the trigger.config.ts
// ffmpeg() build extension.

export type NormalizedAudio = {
  buffer: Buffer;
  filename: string;
  contentType: "audio/mpeg";
  bitrate: 320;
  sampleRate: 44100;
};

export async function normalizeForRouteNote(
  inputBuffer: Buffer,
  inputFilename: string,
): Promise<NormalizedAudio> {
  const work = await mkdtemp(join(tmpdir(), "norm-"));
  const inPath = join(work, inputFilename || "in.audio");
  const outPath = join(work, "normalized.mp3");
  await writeFile(inPath, inputBuffer);

  // -y: overwrite, -ar 44100: 44.1 kHz, -ac 2: stereo, -b:a 320k: 320 kbps
  await execP(
    "ffmpeg",
    ["-y", "-i", inPath, "-ar", "44100", "-ac", "2", "-b:a", "320k", "-c:a", "libmp3lame", outPath],
    { maxBuffer: 200 * 1024 * 1024 },
  );

  const buffer = await readFile(outPath);
  // Cleanup
  await unlink(inPath).catch(() => {});
  await unlink(outPath).catch(() => {});

  // Strip extension, normalise filename for RouteNote
  const base = (inputFilename || "audio").replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-_ ]/g, "_");
  return {
    buffer,
    filename: `${base}.mp3`,
    contentType: "audio/mpeg",
    bitrate: 320,
    sampleRate: 44100,
  };
}
