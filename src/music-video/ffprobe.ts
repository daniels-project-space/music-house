import { spawn } from "node:child_process";

/** Audio/video duration in seconds via ffprobe (present in the Trigger ffmpeg
 *  extension and on the VPS). */
export function probeDurationSec(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      const n = parseFloat(out.trim());
      if (code === 0 && Number.isFinite(n) && n > 0) resolve(n);
      else reject(new Error(`ffprobe failed (${code}): ${err.trim()}`));
    });
  });
}
