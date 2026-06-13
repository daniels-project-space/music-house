/**
 * Trigger-safe secret access for the standalone Music Video pipeline.
 *
 * This is a deliberate copy of src/lib/vault.ts WITHOUT the `import "server-only"`
 * guard, so it can be imported from Trigger.dev tasks (plain Node) and one-off
 * scripts. Same vault, same `secrets:listByService` query, same shape.
 */

const VAULT_URL = process.env.VAULT_URL ?? "https://fantastic-roadrunner-485.convex.cloud";

type SecretRow = {
  service: string;
  keyName: string;
  value: string;
  scopes: string[];
  aliases: string[];
};

const cache = new Map<string, Record<string, string>>();

async function fetchService(service: string): Promise<Record<string, string>> {
  const r = await fetch(`${VAULT_URL}/api/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "secrets:listByService", args: { service }, format: "json" }),
  });
  if (!r.ok) throw new Error(`Vault fetch failed for ${service}: ${r.status}`);
  const { value } = (await r.json()) as { value: SecretRow[] };
  return Object.fromEntries(value.map((s) => [s.keyName, s.value]));
}

export async function getServiceSecrets(service: string): Promise<Record<string, string>> {
  const cached = cache.get(service);
  if (cached) return cached;
  const env = await fetchService(service);
  cache.set(service, env);
  return env;
}

export async function getSecret(service: string, keyName: string): Promise<string> {
  const env = await getServiceSecrets(service);
  const v = env[keyName];
  if (!v) throw new Error(`Vault missing ${service}.${keyName}`);
  return v;
}

/**
 * Hydrate process.env from one or more vault services (idempotent — never
 * overwrites a value already present in the environment, so Trigger.dev
 * dashboard env vars and local .env win). Returns the merged map.
 */
export async function hydrate(services: string[]): Promise<Record<string, string>> {
  const merged: Record<string, string> = {};
  for (const service of services) {
    const env = await getServiceSecrets(service);
    for (const [k, val] of Object.entries(env)) {
      merged[k] = val;
      if (process.env[k] === undefined) process.env[k] = val;
    }
  }
  // mirror Gemini key the way the rest of the fleet expects it
  if (process.env.GEMINI_API_KEY) {
    process.env.GOOGLE_API_KEY ??= process.env.GEMINI_API_KEY;
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ??= process.env.GEMINI_API_KEY;
  }
  return merged;
}
