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
  audioUrl: string;
  sourceAudioUrl?: string;
  imageUrl?: string;
  title?: string;
  duration?: number;
  modelName?: string;
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
        audioUrl: String(t.audioUrl ?? t.sourceAudioUrl ?? ""),
        sourceAudioUrl: t.sourceAudioUrl ? String(t.sourceAudioUrl) : undefined,
        imageUrl: t.imageUrl ? String(t.imageUrl) : undefined,
        title: t.title ? String(t.title) : undefined,
        duration: typeof t.duration === "number" ? t.duration : undefined,
        modelName: t.modelName ? String(t.modelName) : undefined,
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
