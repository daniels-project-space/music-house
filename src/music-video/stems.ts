/**
 * Instrumental extraction for the karaoke variant — Suno NATIVE stems.
 *
 * Suno's own get-stem API (sunoapi.org /vocal-removal) splits a platform track
 * into a clean vocal + instrumental with Suno's source-separation model. This is
 * far higher quality than a generic Demucs pass, so we use it exclusively.
 *
 * It requires the original generation's taskId + audioId — Suno only separates
 * tracks created on its platform (uploaded audio is rejected). The instrumental
 * is cached at a deterministic R2 key so we separate once per track. Tracks
 * without live Suno IDs (e.g. imported MP3s) cannot be separated here and must
 * have an instrumental supplied another way — we throw rather than fall back to
 * Demucs, whose quality is not acceptable.
 */
import { exists, put } from "./r2";
import { getServiceSecrets } from "./vault";

const BASE = "https://api.sunoapi.org/api/v1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sunoKey(): Promise<string> {
  if (process.env.SUNO_API_KEY) return process.env.SUNO_API_KEY;
  const env = await getServiceSecrets("suno");
  const k = env.SUNO_API_KEY;
  if (!k) throw new Error("SUNO_API_KEY not available (env or vault service \"suno\")");
  return k;
}

export type EnsureInstrumentalArgs = {
  sunoTaskId?: string | null;
  sunoAudioId?: string | null;
  /** track.instrumentalKey — only honoured as a cache when it equals destKey. */
  cachedKey?: string | null;
  /** Deterministic R2 key the native instrumental is stored at. */
  destKey: string;
  log: (m: string) => void;
};

/**
 * Ensure a clean Suno-native instrumental exists; returns its R2 key.
 * Reuses destKey if already separated. Any legacy (non-native) instrumentalKey
 * is ignored so we never reuse a Demucs stem.
 */
export async function ensureInstrumental(args: EnsureInstrumentalArgs): Promise<string> {
  const { sunoTaskId, sunoAudioId, cachedKey, destKey, log } = args;

  if (cachedKey === destKey && (await exists(destKey).catch(() => false))) {
    log(`suno instrumental cached: ${destKey}`);
    return destKey;
  }
  if (!sunoTaskId || !sunoAudioId) {
    throw new Error(
      "Karaoke needs Suno native stems, but this track has no live sunoTaskId/sunoAudioId. " +
        "Backfill them (musicVideo.setSunoIds) or supply an instrumental stem — Demucs is disabled.",
    );
  }

  const key = await sunoKey();
  log(`suno stems: requesting separation (task ${sunoTaskId}, audio ${sunoAudioId})`);
  const gen = await fetch(`${BASE}/vocal-removal/generate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      taskId: sunoTaskId,
      audioId: sunoAudioId,
      type: "separate_vocal",
      callBackUrl:
        process.env.SUNO_CALLBACK_URL || "https://music-house-nine.vercel.app/api/suno-callback",
    }),
  });
  if (!gen.ok)
    throw new Error(`suno vocal-removal generate ${gen.status}: ${await gen.text().catch(() => "")}`);
  const gj: any = await gen.json();
  const sepTaskId = gj?.data?.taskId ?? gj?.taskId;
  if (!sepTaskId)
    throw new Error(`suno vocal-removal: no taskId in ${JSON.stringify(gj).slice(0, 300)}`);

  const deadline = Date.now() + 8 * 60 * 1000;
  let instUrl = "";
  while (Date.now() < deadline) {
    await sleep(5000);
    const r = await fetch(
      `${BASE}/vocal-removal/record-info?taskId=${encodeURIComponent(sepTaskId)}`,
      { headers: { Authorization: `Bearer ${key}` } },
    );
    const j: any = await r.json();
    const data = j?.data ?? {};
    const flag = String(data.successFlag ?? data.status ?? "").toUpperCase();
    log(`suno stems: ${flag || "pending"}`);
    if (flag === "SUCCESS") {
      instUrl =
        data?.response?.instrumentalUrl ?? data?.response?.instrumental_url ?? "";
      break;
    }
    if (flag.includes("FAIL") || flag === "ERROR" || flag.includes("SENSITIVE")) {
      throw new Error(`suno stems failed: ${data.errorMessage ?? flag}`);
    }
  }
  if (!instUrl) throw new Error("suno stems: timed out / no instrumentalUrl");

  const buf = Buffer.from(await (await fetch(instUrl)).arrayBuffer());
  await put(destKey, buf, "audio/mpeg");
  log(`suno instrumental stored: ${destKey}`);
  return destKey;
}
