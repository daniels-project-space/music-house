import "server-only";
import { getSecret } from "./vault";

const BASE = "https://api.sunoapi.org/api/v1";

export type SunoGenerateInput = {
  prompt: string;
  lyrics?: string;
  title?: string;
  model?: string;
  callbackUrl?: string;
  customMode?: boolean;
  instrumental?: boolean;
};

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const key = await getSecret("suno", "SUNO_API_KEY");
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  });
}

export async function generate(input: SunoGenerateInput): Promise<{ taskId: string }> {
  const body: Record<string, unknown> = {
    customMode: input.customMode ?? true,
    instrumental: input.instrumental ?? !input.lyrics,
    model: input.model ?? "V5_5",
    style: input.prompt,
    title: input.title ?? "Untitled",
  };
  if (input.lyrics) body.prompt = input.lyrics;
  body.callBackUrl = input.callbackUrl || process.env.SUNO_CALLBACK_URL || "https://music-house-nine.vercel.app/api/suno-callback";

  const r = await authedFetch("/generate", { method: "POST", body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Suno generate ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const taskId = j?.data?.taskId ?? j?.taskId;
  if (!taskId) throw new Error(`Suno: no taskId in response ${JSON.stringify(j).slice(0, 300)}`);
  return { taskId };
}

export type SunoTrack = {
  id: string;                  // Suno's audio_id — required for WAV export
  audioUrl: string;            // MP3 URL — used only as transient input to WAV export, never saved
  sourceAudioUrl?: string;
  imageUrl?: string;
  title?: string;
  duration?: number;
  modelName?: string;
  lyrics?: string;            // Suno's returned lyrics (record-info `prompt` field)
};

export type SunoTaskState =
  | { status: "pending" }
  | { status: "success"; tracks: SunoTrack[] }
  | { status: "failed"; error: string };

export async function getTask(taskId: string): Promise<SunoTaskState> {
  const r = await authedFetch(`/generate/record-info?taskId=${encodeURIComponent(taskId)}`);
  if (!r.ok) throw new Error(`Suno poll ${r.status}`);
  const j = await r.json();
  const data = j?.data ?? {};
  const status = String(data.status ?? "").toUpperCase();
  const sunoData = data?.response?.sunoData ?? [];

  if (status === "SUCCESS" && sunoData.length > 0) {
    return {
      status: "success",
      tracks: sunoData.map((t: Record<string, unknown>) => ({
        // Suno returns track id as `id`, sometimes also as `audioId` — accept both shapes
        id: String(t.id ?? t.audioId ?? ""),
        audioUrl: String(t.audioUrl ?? t.sourceAudioUrl ?? ""),
        sourceAudioUrl: t.sourceAudioUrl ? String(t.sourceAudioUrl) : undefined,
        imageUrl: t.imageUrl ? String(t.imageUrl) : undefined,
        title: t.title ? String(t.title) : undefined,
        duration: typeof t.duration === "number" ? t.duration : undefined,
        modelName: t.modelName ? String(t.modelName) : undefined,
        // Suno returns the (provided or AI-generated) lyrics in `prompt`; some
        // API builds use `lyric`/`lyrics`. Blank for instrumentals.
        lyrics:
          (t.prompt ? String(t.prompt) : "") ||
          (t.lyric ? String(t.lyric) : "") ||
          (t.lyrics ? String(t.lyrics) : "") ||
          undefined,
      })),
    };
  }
  if (status.includes("FAIL") || status === "ERROR" || status.includes("SENSITIVE_WORD")) {
    return { status: "failed", error: data.errorMessage ?? status };
  }
  return { status: "pending" };
}

export async function pollUntilComplete(
  taskId: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<SunoTrack[]> {
  const interval = opts.intervalMs ?? 5000;
  const timeout = opts.timeoutMs ?? 5 * 60 * 1000;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const s = await getTask(taskId);
    if (s.status === "success") return s.tracks;
    if (s.status === "failed") throw new Error(`Suno failed: ${s.error}`);
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error("Suno timed out");
}

// =====================================================================
// HQ rule: every Suno track MUST be exported in lossless WAV before storage.
// MP3 is never saved. Even though Suno V5 returns MP3 on the standard endpoint,
// we always queue a WAV export and wait for it before the track is considered ready.
// =====================================================================

export async function requestWav(
  payload: { taskId: string; audioId: string },
): Promise<{ wavTaskId: string }> {
  const body: Record<string, unknown> = {
    taskId: payload.taskId,
    audioId: payload.audioId,
    callBackUrl: process.env.SUNO_CALLBACK_URL || "https://music-house-nine.vercel.app/api/suno-callback",
  };
  const r = await authedFetch("/wav/generate", { method: "POST", body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Suno wav/generate ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const wavTaskId = j?.data?.taskId ?? j?.taskId;
  if (!wavTaskId) throw new Error(`Suno: no wav taskId in ${JSON.stringify(j).slice(0, 300)}`);
  return { wavTaskId };
}

export async function getWav(wavTaskId: string): Promise<{ status: "pending" | "success" | "failed"; wavUrl?: string; error?: string }> {
  const r = await authedFetch(`/wav/record-info?taskId=${encodeURIComponent(wavTaskId)}`);
  if (!r.ok) throw new Error(`Suno wav poll ${r.status}`);
  const j = await r.json();
  const data = j?.data ?? {};
  const status = String(data.status ?? "").toUpperCase();
  if (status === "SUCCESS") {
    const wavUrl = data?.response?.audio_wav_url ?? data?.audio_wav_url ?? data?.response?.wav_url ?? data?.wav_url;
    if (!wavUrl) return { status: "pending" };
    return { status: "success", wavUrl: String(wavUrl) };
  }
  if (status.includes("FAIL") || status === "ERROR") {
    return { status: "failed", error: data.errorMessage ?? status };
  }
  return { status: "pending" };
}

export async function pollWavUntilReady(
  wavTaskId: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<string> {
  const interval = opts.intervalMs ?? 6000;
  const timeout = opts.timeoutMs ?? 10 * 60 * 1000;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const s = await getWav(wavTaskId);
    if (s.status === "success" && s.wavUrl) return s.wavUrl;
    if (s.status === "failed") throw new Error(`Suno WAV failed: ${s.error}`);
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error("Suno WAV export timed out");
}
