import "server-only";
import { getSecret } from "./vault";

const BASE = "https://api.mureka.ai/v1";

export type MurekaGenerateInput = {
  prompt?: string;
  lyrics?: string;
  model?: string;
  songFileId?: string;
  referVoiceId?: string;
  instrumental?: boolean;
};

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const key = await getSecret("mureka", "MUREKA_API_KEY");
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  });
}

export async function generate(input: MurekaGenerateInput): Promise<{ taskId: string; type: "song" | "instrumental" }> {
  const isInstrumental = input.instrumental ?? !input.lyrics;
  const path = isInstrumental ? "/instrumental/generate" : "/song/generate";
  const body: Record<string, unknown> = {
    model: input.model ?? "auto",
    lyrics: input.lyrics || "[instrumental]",
  };
  if (input.prompt) body.prompt = input.prompt;
  if (input.songFileId) body.song_file_id = input.songFileId;
  if (input.referVoiceId) body.refer_voice_id = input.referVoiceId;

  const r = await authedFetch(path, { method: "POST", body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Mureka generate ${r.status}: ${await r.text()}`);
  const j = await r.json();
  if (!j.id) throw new Error(`Mureka: no id in response ${JSON.stringify(j).slice(0, 300)}`);
  return { taskId: j.id, type: isInstrumental ? "instrumental" : "song" };
}

export type MurekaChoice = {
  id?: string;
  url: string;
  flac_url?: string;
  duration: number;
};

export type MurekaTaskState =
  | { status: "pending" }
  | { status: "succeeded"; choices: MurekaChoice[] }
  | { status: "failed"; error: string };

export async function getTask(taskId: string, type: "song" | "instrumental"): Promise<MurekaTaskState> {
  const r = await authedFetch(`/${type}/query/${encodeURIComponent(taskId)}`);
  if (!r.ok) throw new Error(`Mureka poll ${r.status}`);
  const j = await r.json();
  if (j.status === "succeeded") return { status: "succeeded", choices: j.choices ?? [] };
  if (j.status === "failed" || j.status === "cancelled" || j.status === "timeouted") return { status: "failed", error: j.status };
  return { status: "pending" };
}

export async function pollUntilComplete(
  taskId: string,
  type: "song" | "instrumental",
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<MurekaChoice[]> {
  const interval = opts.intervalMs ?? 5000;
  const timeout = opts.timeoutMs ?? 5 * 60 * 1000;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const s = await getTask(taskId, type);
    if (s.status === "succeeded") return s.choices;
    if (s.status === "failed") throw new Error(`Mureka failed: ${s.error}`);
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error("Mureka timed out");
}
