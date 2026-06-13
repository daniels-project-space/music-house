/**
 * Nano Banana (Gemini image generation) — best-effort background plate for the
 * music video. Patterned on youtube-studio-ai/src/lib/banana.ts. Used only to
 * enrich the dark backdrop; ALWAYS optional — on any failure the composition
 * falls back to its procedural background, so the pipeline never blocks on it.
 */
import { getServiceSecrets } from "./vault";

const MODELS = ["gemini-3-pro-image-preview", "gemini-2.5-flash-image"];

async function geminiKey(): Promise<string | null> {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  try {
    const env = await getServiceSecrets("gemini");
    return env.GEMINI_API_KEY ?? null;
  } catch {
    return null;
  }
}

/**
 * Generate a dark, cinematic background plate. Returns JPEG/PNG bytes, or null
 * if generation is unavailable. `aspectRatio` is folded into the prompt since
 * these models don't take a structured ratio param.
 */
export async function generateBackgroundPlate(
  subject: string,
  opts: { aspectRatio?: string } = {},
): Promise<Buffer | null> {
  const key = await geminiKey();
  if (!key) return null;

  const prompt =
    `Cinematic ${opts.aspectRatio ?? "16:9"} abstract background for a music video. ` +
    `Very dark, near-black, moody studio atmosphere with soft volumetric light, ` +
    `subtle film grain and bokeh, low contrast, NO text, NO faces, NO logos. ` +
    `Mood/theme: ${subject}. Leave the center darker so foreground album art reads clearly.`;

  for (const model of MODELS) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ["IMAGE"] },
          }),
        },
      );
      if (!r.ok) continue;
      const j = (await r.json()) as {
        candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
      };
      const data = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
      if (data) return Buffer.from(data, "base64");
    } catch {
      /* try next model */
    }
  }
  return null;
}
