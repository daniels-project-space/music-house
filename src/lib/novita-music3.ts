import "server-only";

import { getServiceSecrets } from "./vault";

const NOVITA_BASE = "https://api.novita.ai/gpu-instance/openapi/v1";
const REQUEST_TIMEOUT_MS = 60_000;

export type MiniMaxMusic3Launch = {
  instanceId: string;
  instanceName: string;
  productName: string;
  spotPrice?: number;
};

type Music3Settings = {
  apiKey: string;
  clusterId: string;
  clusterName: string;
  volumeId: string;
  imageUrl: string;
  modelPath: string;
};

type NovitaProduct = {
  id?: string;
  name?: string;
  availableDeploy?: boolean;
  inventoryState?: string;
  spotPrice?: number | string;
  price?: number | string;
  regions?: string[];
};

function required(env: Record<string, string>, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`MiniMax Music3 is not configured: missing novita.${name}`);
  return value;
}

async function settings(): Promise<Music3Settings> {
  const env = await getServiceSecrets("novita");
  const imageUrl = required(env, "MUSIC_HOUSE_MINIMAX_MUSIC3_WORKER_IMAGE");
  // A content-addressed image prevents a tag update from silently changing the
  // renderer underneath a stored model volume.
  if (!/@sha256:[a-f0-9]{64}$/i.test(imageUrl)) {
    throw new Error("MiniMax Music3 worker image must be pinned by immutable sha256 digest");
  }
  return {
    apiKey: required(env, "NOVITA_API_KEY"),
    clusterId: required(env, "MUSIC_HOUSE_MINIMAX_MUSIC3_CLUSTER_ID"),
    clusterName: required(env, "MUSIC_HOUSE_MINIMAX_MUSIC3_CLUSTER_NAME"),
    volumeId: required(env, "MUSIC_HOUSE_MINIMAX_MUSIC3_VOLUME_ID"),
    imageUrl,
    modelPath: env.MUSIC_HOUSE_MINIMAX_MUSIC3_MODEL_PATH?.trim() || "/network/music-house/minimax-music3",
  };
}

async function request<T>(
  config: Music3Settings,
  path: string,
  init: RequestInit,
  retryable = false,
): Promise<T> {
  const attempts = retryable ? 3 : 1;
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(`${NOVITA_BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "Music-House-MiniMax-Music3/1.0",
          ...init.headers,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const raw = await response.text();
      if (!response.ok) throw new Error(`Novita ${init.method ?? "GET"} ${path} failed (${response.status}): ${raw.slice(0, 300)}`);
      return (raw ? JSON.parse(raw) : {}) as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
    }
  }
  throw lastError ?? new Error(`Novita ${path} failed`);
}

function isOrdinary4090(product: NovitaProduct, clusterName: string) {
  const name = `${product.name ?? ""} ${product.id ?? ""}`.toLowerCase();
  const regions = product.regions ?? [];
  return product.availableDeploy === true
    && name.includes("4090")
    && !name.includes("high frequency")
    && !name.includes(".hf.")
    && (regions.length === 0 || regions.includes(clusterName));
}

function productRank(product: NovitaProduct): [number, number] {
  const inventory = { high: 0, normal: 1, low: 2 }[String(product.inventoryState ?? "").toLowerCase()] ?? 3;
  const price = Number(product.spotPrice ?? product.price ?? Number.MAX_VALUE);
  return [inventory, Number.isFinite(price) ? price : Number.MAX_VALUE];
}

function instanceName(jobId: string) {
  const suffix = jobId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(-24) || "job";
  return `music-house-m3-${suffix}`.slice(0, 63);
}

export async function launchMiniMaxMusic3Worker(input: {
  jobId: string;
  inputUrl: string;
  outputUrl: string;
  statusUrl: string;
}): Promise<MiniMaxMusic3Launch> {
  const config = await settings();
  const products = await request<{ data?: NovitaProduct[] }>(
    config,
    "/products?productName=4090&billingMethod=spot",
    { method: "GET" },
    true,
  );
  const product = (products.data ?? [])
    .filter((candidate) => isOrdinary4090(candidate, config.clusterName))
    .sort((a, b) => {
      const [ai, ap] = productRank(a);
      const [bi, bp] = productRank(b);
      return ai - bi || ap - bp;
    })[0];
  if (!product?.id) {
    throw new Error(`No deployable ordinary RTX 4090 spot SKU is available in ${config.clusterName}`);
  }

  const name = instanceName(input.jobId);
  // This request deliberately has no automatic retry. If a create request times
  // out after Novita accepted it, retrying could rent a second GPU.
  const created = await request<{ id?: string }>(config, "/gpu/instance/create", {
    method: "POST",
    body: JSON.stringify({
      name,
      productId: product.id,
      gpuNum: 1,
      rootfsSize: 80,
      imageUrl: config.imageUrl,
      kind: "gpu",
      billingMode: "spot",
      clusterId: config.clusterId,
      minCudaVersion: "12.8",
      networkStorages: [{ Id: config.volumeId, mountPoint: "/network" }],
      // The worker only receives short-lived object links. In particular it does
      // not receive NOVITA_API_KEY and cannot enumerate or change any other job.
      envs: [
        { key: "MUSIC_HOUSE_MINIMAX_MUSIC3_INPUT_URL", value: input.inputUrl },
        { key: "MUSIC_HOUSE_MINIMAX_MUSIC3_OUTPUT_URL", value: input.outputUrl },
        { key: "MUSIC_HOUSE_MINIMAX_MUSIC3_STATUS_URL", value: input.statusUrl },
        { key: "MUSIC_HOUSE_MINIMAX_MUSIC3_MODEL_PATH", value: config.modelPath },
        { key: "MUSIC_HOUSE_MINIMAX_MUSIC3_WORKER_NAME", value: name },
      ],
      command: "bash -lc '/app/entrypoint.sh'",
    }),
  });
  if (!created.id) throw new Error("Novita did not return an instance id for the MiniMax Music3 worker");
  return {
    instanceId: created.id,
    instanceName: name,
    productName: product.name ?? "RTX 4090",
    spotPrice: Number(product.spotPrice ?? product.price),
  };
}

export async function closeMiniMaxMusic3Worker(instanceId: string): Promise<boolean> {
  const config = await settings();
  // Close only the exact id created for this render — never by a prefix or a
  // broad account scan. Stop is best-effort because a completed worker may
  // already be in a terminal state when the result marker arrives.
  await request(config, "/gpu/instance/stop", {
    method: "POST",
    body: JSON.stringify({ instanceId }),
  }).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  await request(config, "/gpu/instance/delete", {
    method: "POST",
    body: JSON.stringify({ instanceId }),
  }).catch(() => undefined);

  for (let attempt = 0; attempt < 18; attempt++) {
    try {
      const value = await request<{ status?: string }>(
        config,
        `/gpu/instance?instanceId=${encodeURIComponent(instanceId)}`,
        { method: "GET" },
        true,
      );
      if (String(value.status ?? "").toLowerCase() === "removed") return true;
    } catch (error) {
      // Novita returns 404 once an instance is fully removed. That is the
      // strongest possible closure signal and is intentionally accepted.
      if (String(error).includes("(404)")) return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  return false;
}
