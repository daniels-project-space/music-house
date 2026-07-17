import "server-only";

const VAULT_URL = process.env.VAULT_URL ?? "https://fantastic-roadrunner-485.convex.cloud";

type SecretRow = {
  service: string;
  keyName: string;
  value: string;
  scopes: string[];
  aliases: string[];
};

let cache: Map<string, Record<string, string>> | null = null;

async function fetchService(service: string): Promise<Record<string, string>> {
  const vaultToken = process.env.VAULT_ACCESS_TOKEN;
  if (!vaultToken) throw new Error("VAULT_ACCESS_TOKEN is not configured");
  const r = await fetch(`${VAULT_URL}/api/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      path: "secrets:listByService",
      args: { service, vaultToken },
      format: "json",
    }),
  });
  if (!r.ok) throw new Error(`Vault fetch failed for ${service}: ${r.status}`);
  const { value } = (await r.json()) as { value: SecretRow[] };
  return Object.fromEntries(value.map((s) => [s.keyName, s.value]));
}

export async function getServiceSecrets(service: string): Promise<Record<string, string>> {
  if (!cache) cache = new Map();
  if (cache.has(service)) return cache.get(service)!;
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
