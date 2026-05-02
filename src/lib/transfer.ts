import "server-only";
import { put } from "./storage";

// Download a remote URL straight into R2 (streamed via memory — fine for music files <100MB).
export async function downloadToR2(url: string, key: string, contentType?: string): Promise<{ key: string; bytes: number }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status} ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await put(key, buf, contentType);
  return { key, bytes: buf.byteLength };
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}
