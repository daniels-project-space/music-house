import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { put } from "../../../../lib/storage";
import { getServiceSecrets } from "../../../../lib/vault";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  albumId: string;
  prompt?: string;
  style?: string;
  description?: string;
};

async function generateCoverViaFlux(prompt: string, replicateToken: string): Promise<Buffer> {
  const r = await fetch(
    "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${replicateToken}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      body: JSON.stringify({
        input: {
          prompt,
          aspect_ratio: "1:1",
          num_outputs: 1,
          output_format: "jpg",
          output_quality: 92,
        },
      }),
    },
  );
  if (!r.ok) throw new Error(`replicate ${r.status}: ${await r.text()}`);
  const data = (await r.json()) as { id: string; status: string; output: string | string[] | null };
  let imageUrl: string | undefined;
  if (data.status === "succeeded" && data.output) {
    imageUrl = Array.isArray(data.output) ? data.output[0] : data.output;
  }
  if (!imageUrl) {
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const p = await fetch(`https://api.replicate.com/v1/predictions/${data.id}`, {
        headers: { Authorization: `Bearer ${replicateToken}` },
      });
      const pj = (await p.json()) as { status: string; output: string | string[] | null };
      if (pj.status === "succeeded" && pj.output) {
        imageUrl = Array.isArray(pj.output) ? pj.output[0] : pj.output;
        break;
      }
      if (pj.status === "failed" || pj.status === "canceled") {
        throw new Error(`replicate prediction ${pj.status}`);
      }
    }
  }
  if (!imageUrl) throw new Error("replicate timed out generating cover");
  const img = await fetch(imageUrl);
  if (!img.ok) throw new Error(`failed to download generated image ${img.status}`);
  return Buffer.from(await img.arrayBuffer());
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return Response.json({ error: "NEXT_PUBLIC_CONVEX_URL not set" }, { status: 500 });
  const cx = new ConvexHttpClient(url);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.albumId) return Response.json({ error: "albumId required" }, { status: 400 });

  const album = await cx.query(api.albums.list, {});
  const target = album.find((a) => a._id === body.albumId);
  if (!target) return Response.json({ error: "album not found" }, { status: 404 });

  const replicate = await getServiceSecrets("replicate").catch(() => ({}) as Record<string, string>);
  const replicateToken = replicate.REPLICATE_API_TOKEN;
  if (!replicateToken) return Response.json({ error: "vault replicate.REPLICATE_API_TOKEN missing" }, { status: 500 });

  let prompt = body.prompt?.trim();
  if (!prompt) {
    const parts: string[] = [];
    parts.push(`Album cover artwork for "${target.name}"`);
    if (body.style?.trim() || target.genre) parts.push(`style: ${body.style?.trim() || target.genre}`);
    if (body.description?.trim() || target.description) parts.push(body.description?.trim() || target.description!);
    parts.push("professional album art, square 1:1, high contrast, evocative, no text, no watermark");
    prompt = parts.join(", ");
  }

  let coverKey: string;
  try {
    const buf = await generateCoverViaFlux(prompt, replicateToken);
    coverKey = `${target.artistSlug}/${target.slug}/cover-${Date.now()}.jpg`;
    await put(coverKey, buf, "image/jpeg");
  } catch (e) {
    return Response.json({ error: `cover generation failed: ${(e as Error).message}` }, { status: 500 });
  }

  await cx.mutation(api.albums.setMeta, { id: body.albumId as Id<"albums">, coverKey });

  return Response.json({ coverKey });
}
