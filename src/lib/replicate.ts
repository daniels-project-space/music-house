import "server-only";
import { getSecret } from "./vault";

const FLUX_MODEL = "black-forest-labs/flux-1.1-pro-ultra";

async function getKey() {
  return getSecret("replicate", "REPLICATE_API_TOKEN");
}

export async function generateCoverArt(prompt: string): Promise<{ url: string }> {
  const key = await getKey();
  const r = await fetch(`https://api.replicate.com/v1/models/${FLUX_MODEL}/predictions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      input: {
        prompt: `Album cover art, ${prompt}, high quality, professional, no text, no letters`,
        aspect_ratio: "1:1",
        safety_tolerance: 5,
      },
    }),
  });
  if (!r.ok) throw new Error(`Replicate create ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const id = j.id;
  const start = Date.now();
  while (Date.now() - start < 120_000) {
    await new Promise((r) => setTimeout(r, 2000));
    const p = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const d = await p.json();
    if (d.status === "succeeded") {
      const url = Array.isArray(d.output) ? d.output[0] : d.output;
      if (!url) throw new Error("Replicate returned no url");
      return { url };
    }
    if (d.status === "failed" || d.status === "canceled") {
      throw new Error(`Replicate ${d.status}: ${d.error ?? "unknown"}`);
    }
  }
  throw new Error("Replicate timed out");
}
