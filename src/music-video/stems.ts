/**
 * Vocal-removal / instrumental extraction for the karaoke variant.
 *
 * Suno has no stem API, so we separate stems with Demucs (htdemucs) on
 * Replicate — cloud, ~2-4 min, ~$0.01/track. The "vocals" two-stems mode yields
 * the isolated vocals + the clean instrumental ("no_vocals"). The result is
 * cached as the track's instrumentalKey in R2 so we only run it once per track.
 */
import { getBuffer, presignDownload, put } from "./r2";
import { getServiceSecrets } from "./vault";

const DEMUCS_VERSION = "25a173108cff36ef9f80f854c162d01df9e6528be175794b81158fa03836d953"; // cjwbw/demucs

async function replicateToken(): Promise<string> {
  if (process.env.REPLICATE_API_TOKEN) return process.env.REPLICATE_API_TOKEN;
  const env = await getServiceSecrets("replicate");
  const k = env.REPLICATE_API_TOKEN ?? env.REPLICATE_API_KEY;
  if (!k) throw new Error("REPLICATE_API_TOKEN not available (env or vault service 'replicate')");
  return k;
}

/** Pick the instrumental URL out of Demucs output (object or array). */
function pickInstrumental(output: unknown): string | null {
  const entries: Array<[string, unknown]> = [];
  if (Array.isArray(output)) output.forEach((v, i) => entries.push([String(i), v]));
  else if (output && typeof output === "object") for (const [k, v] of Object.entries(output)) entries.push([k, v]);
  const urls = entries.filter(([, v]) => typeof v === "string" && (v as string).startsWith("http")) as Array<[string, string]>;
  const inst = urls.find(([k]) => /no[_-]?vocal|no[_-]?stem|instrumental|accompan|karaoke/i.test(k));
  if (inst) return inst[1];
  const nonVocal = urls.find(([k, v]) => !/vocal/i.test(k) && !/vocal/i.test(v));
  return nonVocal ? nonVocal[1] : urls[0]?.[1] ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ensure a clean instrumental exists for `audioKey`; returns its R2 key.
 * Uses the cached `instrumentalKey` if it already exists in R2.
 */
export async function ensureInstrumental(
  audioKey: string,
  instrumentalKey: string | null,
  cacheKeyBase: string,
  log: (m: string) => void,
): Promise<string> {
  if (instrumentalKey && (await import("./r2").then((m) => m.exists(instrumentalKey)).catch(() => false))) {
    log(`instrumental cached: ${instrumentalKey}`);
    return instrumentalKey;
  }

  const token = await replicateToken();
  const audioUrl = await presignDownload(audioKey, 6 * 3600);

  log("demucs: creating Replicate prediction…");
  const create = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: { authorization: `Token ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      version: DEMUCS_VERSION,
      input: { audio: audioUrl, stem: "vocals", model_name: "htdemucs", output_format: "mp3" },
    }),
  });
  if (!create.ok) throw new Error(`Replicate create failed: ${create.status} ${await create.text().catch(() => "")}`);
  let pred = (await create.json()) as { id: string; status: string; output?: unknown; error?: unknown; urls?: { get: string } };

  const getUrl = pred.urls?.get ?? `https://api.replicate.com/v1/predictions/${pred.id}`;
  const deadline = Date.now() + 8 * 60 * 1000;
  while (!["succeeded", "failed", "canceled"].includes(pred.status)) {
    if (Date.now() > deadline) throw new Error("demucs timed out");
    await sleep(3000);
    const r = await fetch(getUrl, { headers: { authorization: `Token ${token}` } });
    pred = (await r.json()) as typeof pred;
    log(`demucs: ${pred.status}`);
  }
  if (pred.status !== "succeeded") throw new Error(`demucs ${pred.status}: ${JSON.stringify(pred.error)?.slice(0, 200)}`);

  const instUrl = pickInstrumental(pred.output);
  if (!instUrl) throw new Error(`demucs: no instrumental in output ${JSON.stringify(pred.output)?.slice(0, 200)}`);

  const buf = Buffer.from(await (await fetch(instUrl)).arrayBuffer());
  const key = `${cacheKeyBase}-instrumental.mp3`;
  await put(key, buf, "audio/mpeg");
  log(`instrumental stored: ${key}`);
  return key;
}

/** Download the instrumental's bytes (helper for callers that want a buffer). */
export async function instrumentalBuffer(key: string): Promise<Buffer> {
  return getBuffer(key);
}
