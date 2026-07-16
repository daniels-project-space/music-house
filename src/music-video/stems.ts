/**
 * Instrumental extraction for the karaoke variant — Suno NATIVE stems.
 *
 * Suno's own get-stem API (sunoapi.org /vocal-removal) splits a platform track
 * into a clean vocal + instrumental with Suno's source-separation model. This is
 * far higher quality than a generic Demucs pass, so we use it exclusively.
 *
 * It requires the original generation's taskId + audioId — Suno only separates
 * tracks created on its platform. When a track has no stored IDs we SEARCH the
 * account (generation history, matched by title) before giving up. If nothing is
 * found and no stem is cached we throw NoStemSourceError, which the render task
 * treats as a graceful abort of the karaoke variant (the main video is fine).
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { exists, put } from "./r2";
import { getServiceSecrets } from "./vault";

const BASE = "https://api.sunoapi.org/api/v1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** No usable stem source: no Suno IDs (after search) and no cached stem. */
export class NoStemSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoStemSourceError";
  }
}

async function sunoKey(): Promise<string> {
  if (process.env.SUNO_API_KEY) return process.env.SUNO_API_KEY;
  const env = await getServiceSecrets("suno");
  const k = env.SUNO_API_KEY;
  if (!k) throw new Error("SUNO_API_KEY not available (env or vault service \"suno\")");
  return k;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Search the Suno account's generation history for a clip matching this track
 * by title (with a duration tie-break), returning its taskId + audioId. Used to
 * recover IDs for tracks generated before IDs were persisted. Returns null when
 * nothing matches (e.g. imported tracks that never lived on the account).
 */
export async function findSunoIdsForTrack(
  convex: ConvexHttpClient,
  track: { title: string; durationSec?: number | null },
  log: (m: string) => void,
): Promise<{ sunoTaskId: string; sunoAudioId: string } | null> {
  const want = norm(track.title ?? "");
  if (!want) return null;
  const key = await sunoKey();
  const jobs: any[] = await convex.query(api.jobs.list, {}).catch(() => []);
  const taskIds = Array.from(
    new Set(
      (jobs ?? [])
        .map((j: any) => j.triggerRunId)
        .filter((t: string) => t && t.startsWith("suno:"))
        .map((t: string) => t.slice(5)),
    ),
  );
  const dur = track.durationSec ?? 0;
  let best: { sunoTaskId: string; sunoAudioId: string; score: number } | null = null;
  for (const tid of taskIds) {
    try {
      const r = await fetch(`${BASE}/generate/record-info?taskId=${tid}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      const j: any = await r.json();
      const clips = j?.data?.response?.sunoData ?? [];
      for (const c of clips) {
        if (!c?.id || norm(c.title ?? "") !== want) continue;
        const dd = Math.abs((Number(c.duration) || 0) - dur);
        if (dur > 0 && dd > 6) continue; // title matches but wrong length — skip
        if (!best || dd < best.score) best = { sunoTaskId: String(tid), sunoAudioId: String(c.id), score: dd };
      }
    } catch {
      // ignore a single bad task lookup
    }
  }
  if (best) {
    log(`karaoke: account search matched "${track.title}" -> task ${best.sunoTaskId} / audio ${best.sunoAudioId}`);
    return { sunoTaskId: best.sunoTaskId, sunoAudioId: best.sunoAudioId };
  }
  log(`karaoke: no clip titled "${track.title}" found on the Suno account`);
  return null;
}

export type EnsureInstrumentalArgs = {
  sunoTaskId?: string | null;
  sunoAudioId?: string | null;
  /** track.instrumentalKey — only honoured as a cache when it equals destKey. */
  cachedKey?: string | null;
  /**
   * Deterministic R2 key prefix the native stems are stored at. The instrumental
   * is saved at `${destKey}` for backwards compatibility (existing callers pass a
   * full ".mp3" key); the vocal stem is derived from the same prefix by swapping
   * the "-instrumental" segment for "-vocal" (or appending it). The actual file
   * extension follows the URL the provider returns.
   */
  destKey: string;
  log: (m: string) => void;
};

export type EnsureInstrumentalResult = {
  /** R2 key of the instrumental (backing-track) stem. */
  instrumentalKey: string;
  /** R2 key of the isolated vocal stem, when the provider returned one. */
  vocalKey?: string;
};

/** Derive a file extension from a stem URL; falls back to mp3 (provider default). */
function extFromUrl(url: string, fallback = "mp3"): string {
  const m = /\.([a-z0-9]+)(?:\?|#|$)/i.exec(url);
  const ext = m?.[1]?.toLowerCase();
  return ext && ext.length <= 4 ? ext : fallback;
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
};

/**
 * Ensure clean Suno-native stems exist; returns the instrumental key (always)
 * plus the vocal key when the provider returns one.
 * Reuses destKey for the instrumental if already separated. Any legacy
 * (non-native) instrumentalKey is ignored so we never reuse a Demucs stem.
 * Throws NoStemSourceError when there is neither a cached native stem nor
 * usable Suno IDs.
 *
 * Note: the sunoapi.org vocal-removal endpoint does not expose a WAV/format
 * option for stems, so stems are saved in whatever format the provider returns
 * (mp3). WAV stems are a provider limitation, not a code one. The main track
 * audio is unaffected and remains lossless WAV.
 */
export async function ensureInstrumental(args: EnsureInstrumentalArgs): Promise<EnsureInstrumentalResult> {
  const { sunoTaskId, sunoAudioId, cachedKey, destKey, log } = args;

  if (cachedKey === destKey && (await exists(destKey).catch(() => false))) {
    log(`suno instrumental cached: ${destKey}`);
    return { instrumentalKey: destKey };
  }
  if (!sunoTaskId || !sunoAudioId) {
    throw new NoStemSourceError(
      "No Suno native stem source: track has no live sunoTaskId/sunoAudioId and account " +
        "search found no match. Karaoke variant aborted (Demucs is disabled).",
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
  let vocalUrl = "";
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
      const resp = data?.response ?? {};
      // sunoapi returns the backing track under instrumentalUrl/vocalRemovalUrl
      // and the isolated voice under vocalUrl/originUrl (snake_case variants too).
      instUrl =
        resp.instrumentalUrl ?? resp.instrumental_url ?? resp.vocalRemovalUrl ?? resp.vocal_removal_url ?? "";
      vocalUrl = resp.vocalUrl ?? resp.vocal_url ?? resp.originUrl ?? resp.origin_url ?? "";
      break;
    }
    if (flag.includes("FAIL") || flag === "ERROR" || flag.includes("SENSITIVE")) {
      throw new Error(`suno stems failed: ${data.errorMessage ?? flag}`);
    }
  }
  if (!instUrl) throw new Error("suno stems: timed out / no instrumentalUrl");

  // Instrumental: keep destKey as the canonical key (callers persist it). Save
  // the bytes with a content type matching the returned format.
  const instExt = extFromUrl(instUrl);
  const instBuf = Buffer.from(await (await fetch(instUrl)).arrayBuffer());
  await put(destKey, instBuf, CONTENT_TYPE_BY_EXT[instExt] ?? "audio/mpeg");
  log(`suno instrumental stored: ${destKey}`);

  const result: EnsureInstrumentalResult = { instrumentalKey: destKey };

  // Vocal stem: best-effort. Derive a key alongside the instrumental so both
  // stems live together; persist whatever succeeds without failing the step.
  if (vocalUrl) {
    try {
      const vocalExt = extFromUrl(vocalUrl);
      const vocalKey = destKey.includes("-instrumental")
        ? destKey.replace("-instrumental", "-vocal").replace(/\.[a-z0-9]+$/i, `.${vocalExt}`)
        : destKey.replace(/(\.[a-z0-9]+)?$/i, `-vocal.${vocalExt}`);
      const vocalBuf = Buffer.from(await (await fetch(vocalUrl)).arrayBuffer());
      await put(vocalKey, vocalBuf, CONTENT_TYPE_BY_EXT[vocalExt] ?? "audio/mpeg");
      result.vocalKey = vocalKey;
      log(`suno vocal stem stored: ${vocalKey}`);
    } catch (e) {
      log(`suno vocal stem save failed (non-fatal): ${String(e).slice(0, 160)}`);
    }
  } else {
    log("suno stems: no vocal URL in response (instrumental only)");
  }

  return result;
}
