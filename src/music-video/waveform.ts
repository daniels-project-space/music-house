import { spawn } from "node:child_process";

/**
 * Extract a per-frame loudness envelope (0..1) from audio using ffmpeg.
 *
 * This lets the Remotion circular waveform react to the music WITHOUT decoding
 * audio inside the browser. In-browser `useAudioData`/`visualizeAudio` decode
 * the full MP3 in every Chromium tab, which stalls/thrashes the software-GL
 * render workers. Computing the envelope once in Node and passing it as a prop
 * removes that bottleneck entirely.
 */
export function extractWaveformEnvelope(
  audioPath: string,
  fps: number,
  frameCount: number,
): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const sampleRate = 8000; // plenty for a loudness envelope
    const p = spawn("ffmpeg", [
      "-v",
      "error",
      "-i",
      audioPath,
      "-ac",
      "1",
      "-ar",
      String(sampleRate),
      "-f",
      "s16le",
      "-",
    ]);
    const chunks: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (d) => chunks.push(d as Buffer));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg pcm extract failed (${code}): ${err.trim()}`));
      const buf = Buffer.concat(chunks);
      const totalSamples = Math.floor(buf.length / 2);
      const spf = sampleRate / fps;
      const env = new Array<number>(frameCount).fill(0);
      let peak = 1e-6;
      for (let f = 0; f < frameCount; f++) {
        const start = Math.floor(f * spf);
        const end = Math.min(totalSamples, Math.floor((f + 1) * spf));
        let sum = 0;
        let n = 0;
        for (let i = start; i < end; i++) {
          const s = buf.readInt16LE(i * 2) / 32768;
          sum += s * s;
          n++;
        }
        const rms = n ? Math.sqrt(sum / n) : 0;
        env[f] = rms;
        if (rms > peak) peak = rms;
      }
      // Normalize to peak + gentle gamma so quiet parts still show some motion.
      for (let f = 0; f < frameCount; f++) {
        env[f] = Math.min(1, Math.pow(env[f] / peak, 0.7));
      }
      resolve(env);
    });
  });
}
