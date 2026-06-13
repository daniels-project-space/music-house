import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Minimal .env loader for standalone tsx scripts (Next normally injects these,
 *  but a raw `npx tsx scripts/...` run does not). Never overwrites existing env. */
export function loadEnvLocal(): void {
  for (const f of [".env.local", ".env"]) {
    const p = path.resolve(__dirname, "..", f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const val = m[2].trim().replace(/^["']|["']$/g, "");
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
  }
}

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export function convexUrl(): string {
  const u = arg("convex-url") ?? process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!u) throw new Error("No Convex URL — pass --convex-url or set NEXT_PUBLIC_CONVEX_URL / CONVEX_URL");
  process.env.CONVEX_URL = u;
  return u;
}
