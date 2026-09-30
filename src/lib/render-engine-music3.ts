import { createHash } from "node:crypto";

const PIN = "72db6c53834ff62ff7b1892d553a86b86a61d9b3649920b5a8d9f2115d03acfd";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = /^[a-z0-9]{32}$/;
const states = ["awaiting-final-qualification", "queued", "waiting-for-capacity", "capacity-checking", "launching", "running", "shutdown-requested", "completed", "failed", "cancelled"];
export type Music3EngineBinding = { jobId: string; state: string; manifestSha256: string; output: { bucket: string; key: string; receiptKey: string } };
export function music3EngineConfig(env: Record<string, string | undefined> = process.env) {
  const origin = env.MUSIC_HOUSE_RENDER_ENGINE_CONVEX_SITE_URL ?? env.RENDER_ENGINE_CONVEX_SITE_URL;
  const token = env.MUSIC_HOUSE_RENDER_ENGINE_PROJECT_TOKEN ?? env.RENDER_ENGINE_PROJECT_TOKEN;
  const workflowId = env.MUSIC_HOUSE_RENDER_ENGINE_MUSIC3_WORKFLOW_ID;
  const bucket = env.MUSIC_HOUSE_RENDER_ENGINE_OUTPUT_BUCKET ?? "music-house";
  const maxCostUsd = Number(env.MUSIC_HOUSE_RENDER_ENGINE_MAX_COST_USD);
  if (!origin || !token || !workflowId || !bucket || !/^[a-f0-9]{64}$/.test(token) || !id.test(workflowId) ||
      !/^[a-z0-9][a-z0-9-]{2,62}$/.test(bucket) || bucket !== "music-house" || !Number.isFinite(maxCostUsd) || maxCostUsd <= 0 || maxCostUsd > 100) {
    throw new Error("Music3 Render Engine server configuration is missing or invalid");
  }
  const url = new URL(origin);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".convex.site") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Music3 Render Engine endpoint must be an HTTPS Convex site origin");
  }
  return { origin: url.origin, token, workflowId, bucket, maxCostUsd };
}
function checkOutput(value: unknown, jobId: string, bucket: string): asserts value is Record<string, unknown> {
  if (!isRecord(value) || value.bucket !== bucket || value.key !== `projects/music-house/jobs/${jobId}/music3.wav` ||
      (value.receiptKey !== undefined && value.receiptKey !== `projects/music-house/jobs/${jobId}/music3.receipt.json`)) {
    throw new Error("Music3 output is not bound to this project's bucket and job");
  }
}
async function request(path: string, init: RequestInit, config: ReturnType<typeof music3EngineConfig>, fetcher: typeof fetch) {
  const response = await fetcher(`${config.origin}${path}`, { ...init, redirect: "error", cache: "no-store",
    signal: AbortSignal.timeout(20_000), headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" } });
  if (!response.ok || (init.method === "POST" && response.status !== 202)) throw new Error(`Music3 Render Engine request rejected (HTTP ${response.status})`);
  const raw = await response.text();
  if (Buffer.byteLength(raw) > 48_000) throw new Error("Music3 engine response exceeds the bounded limit");
  return JSON.parse(raw) as unknown;
}
export async function stageMusic3Engine(input: { sourceId: string; lyrics: string; description: string; seed: number }, fetcher: typeof fetch = fetch): Promise<Music3EngineBinding> {
  if (typeof window !== "undefined") throw new Error("Music3 engine client is server-only");
  const config = music3EngineConfig();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/.test(input.sourceId) || !input.lyrics.trim() || Buffer.byteLength(input.lyrics) > 16000 ||
      !input.description.trim() || Buffer.byteLength(input.description) > 12000 || !Number.isSafeInteger(input.seed) || input.seed < 0 || input.seed > 0xffffffff) {
    throw new Error("Music3 requires valid lyrics, description, source identity and seed");
  }
  const canonical = { version: 1, idempotencyKey: `music-house:music3:${input.sourceId}`, sourceId: input.sourceId,
    profileRevisionSha256: PIN, lyrics: input.lyrics, description: input.description, seed: input.seed,
    maxAudioSeconds: 300, maxCostUsd: config.maxCostUsd, output: { contentType: "audio/wav", sampleRateHz: 32000, channels: 2, bitsPerSample: 16 } };
  const value = await request("/client/music3-jobs", { method: "POST", body: JSON.stringify({ projectName: "music-house", workflowId: config.workflowId, request: canonical }) }, config, fetcher);
  if (!isRecord(value) || typeof value.jobId !== "string" || !id.test(value.jobId) || typeof value.state !== "string" || !states.includes(value.state) ||
      value.manifestSha256 !== digest(JSON.stringify(canonical))) throw new Error("Music3 stage receipt does not match the submitted request");
  checkOutput(value.output, value.jobId, config.bucket);
  if (value.output.receiptKey !== `projects/music-house/jobs/${value.jobId}/music3.receipt.json`) throw new Error("Music3 stage receipt key is missing");
  return { jobId: value.jobId, state: value.state, manifestSha256: String(value.manifestSha256), output: { bucket: config.bucket, key: String(value.output.key), receiptKey: String(value.output.receiptKey) } };
}
export async function pollMusic3Engine(binding: Music3EngineBinding, fetcher: typeof fetch = fetch) {
  const config = music3EngineConfig();
  if (!id.test(binding.jobId)) throw new Error("Invalid Music3 engine job ID");
  checkOutput(binding.output, binding.jobId, config.bucket);
  const query = new URLSearchParams({ projectName: "music-house", jobId: binding.jobId });
  const value = await request(`/client/jobs?${query}`, { method: "GET" }, config, fetcher);
  if (!isRecord(value) || value.jobId !== binding.jobId || value.profileId !== "minimax-music3" || typeof value.status !== "string" || !states.includes(value.status)) {
    throw new Error("Music3 status does not match the admitted native job");
  }
  if (value.outputRetired) throw new Error("Music3 output has been retired");
  if (value.status === "completed") {
    checkOutput(value.output, binding.jobId, config.bucket);
    if (!isRecord(value.output) || value.output.contentType !== "audio/wav" || typeof value.output.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.output.sha256) || !Number.isSafeInteger(value.output.bytes) || Number(value.output.bytes) <= 44 ||
        typeof value.output.verifiedAt !== "number" || value.output.verifiedAt <= 0) throw new Error("Music3 completion has no verified WAV receipt");
  }
  return { state: value.status, output: value.output ?? null };
}
export async function readMusic3EngineOutput(binding: Music3EngineBinding, fetcher: typeof fetch = fetch) {
  const status = await pollMusic3Engine(binding, fetcher);
  if (status.state !== "completed") throw new Error("Music3 output is not complete");
  const config = music3EngineConfig();
  const query = new URLSearchParams({ projectName: "music-house", jobId: binding.jobId });
  const value = await request(`/client/jobs/output?${query}`, { method: "GET" }, config, fetcher);
  checkOutput(value, binding.jobId, config.bucket);
  if (!isRecord(value) || typeof value.url !== "string" || value.contentType !== "audio/wav" || !isRecord(status.output) ||
      value.sha256 !== status.output.sha256 || value.bytes !== status.output.bytes) throw new Error("Music3 readback differs from its verified output");
  const url = new URL(value.url);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid Music3 output read URL");
  return value.url;
}
