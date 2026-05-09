import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import { put } from "../../../../lib/storage";
import { getServiceSecrets } from "../../../../lib/vault";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  artistSlug: string;
  slug?: string;
  name: string;
  style?: string;
  description?: string;
  section?: string;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

async function generateCoverViaFlux(prompt: string, replicateToken: string): Promise<Buffer> {
  // Use flux-schnell — fastest, cheapest, jpg output
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
  if (!r.ok) {
    throw new Error(`replicate ${r.status}: ${await r.text()}`);
  }
  const data = (await r.json()) as { id: string; status: string; output: string | string[] | null };
  let imageUrl: string | undefined;
  if (data.status === "succeeded" && data.output) {
    imageUrl = Array.isArray(data.output) ? data.output[0] : data.output;
  }
  if (!imageUrl) {
    // poll
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
  if (!body.artistSlug || !body.name) {
    return Response.json({ error: "artistSlug and name required" }, { status: 400 });
  }

  const slug = body.slug ? slugify(body.slug) : slugify(body.name);
  if (!slug) return Response.json({ error: "could not derive slug" }, { status: 400 });

  // Generate cover via Flux
  const replicate = await getServiceSecrets("replicate").catch(() => ({}) as Record<string, string>);
  const replicateToken = replicate.REPLICATE_API_TOKEN;
  if (!replicateToken) {
    return Response.json({ error: "vault replicate.REPLICATE_API_TOKEN missing" }, { status: 500 });
  }

  const promptParts: string[] = [];
  promptParts.push(`Album cover artwork for "${body.name}"`);
  if (body.style) promptParts.push(`style: ${body.style}`);
  if (body.description) promptParts.push(body.description);
  promptParts.push(
    "professional album art, square 1:1, high contrast, evocative, no text, no watermark",
  );
  const prompt = promptParts.join(", ");

  let coverKey: string | undefined;
  try {
    const buf = await generateCoverViaFlux(prompt, replicateToken);
    coverKey = `${body.artistSlug}/${slug}/cover.jpg`;
    await put(coverKey, buf, "image/jpeg");
  } catch (e) {
    return Response.json({ error: `cover generation failed: ${(e as Error).message}` }, { status: 500 });
  }

  const albumId = await cx.mutation(api.albums.upsert, {
    artistSlug: body.artistSlug,
    slug,
    name: body.name,
    description: body.description,
    genre: body.style,
    coverKey,
    section: body.section,
  });

  return Response.json({ albumId, slug, coverKey });
}
