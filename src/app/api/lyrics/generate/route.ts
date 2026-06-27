import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import { getServiceSecrets } from "../../../../lib/vault";
import { nicheGroundingBlock } from "../../../../lib/nichecraft";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  title?: string;
  vibe?: string;
  theme?: string;
  topic?: string;
  genre?: string;
  nicheSlug?: string;
};

const SYSTEM = `You are an experienced songwriter. Write lyrics that scan well, have a clear hook, and avoid clichés. Output ONLY the lyrics — no preamble, no commentary, no markdown fences.

Format the lyrics with section headers in square brackets:
[Verse 1]
[Pre-Chorus]
[Chorus]
[Verse 2]
[Bridge]
[Chorus]
[Outro]

Aim for 2 verses, a chorus that repeats, optionally a bridge. Lines should be singable. Match the genre's typical line length and rhyme density.`;

function buildPrompt(b: Body, grounding?: string): string {
  const parts: string[] = [];
  parts.push(`Write a song.`);
  if (grounding) parts.push(grounding);
  if (b.title) parts.push(`Working title: "${b.title}".`);
  if (b.genre) parts.push(`Genre: ${b.genre}.`);
  if (b.vibe) parts.push(`Vibe / mood: ${b.vibe}.`);
  if (b.theme) parts.push(`Theme: ${b.theme}.`);
  if (b.topic) parts.push(`Topic / story: ${b.topic}.`);
  parts.push(`Output the lyrics now.`);
  return parts.join("\n");
}

// Pull the selected niche from Convex and turn it into a compact grounding block.
async function loadNicheGrounding(nicheSlug?: string): Promise<string | undefined> {
  if (!nicheSlug) return undefined;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return undefined;
  try {
    const cx = new ConvexHttpClient(url);
    const n = await cx.query(api.niches.getBySlug, { slug: nicheSlug });
    if (!n) return undefined;
    return nicheGroundingBlock(n);
  } catch {
    return undefined;
  }
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.vibe && !body.theme && !body.topic && !body.genre && !body.nicheSlug) {
    return Response.json({ error: "need at least one of: vibe, theme, topic, genre, niche" }, { status: 400 });
  }

  const grounding = await loadNicheGrounding(body.nicheSlug);

  const anth = await getServiceSecrets("anthropic").catch(() => ({}) as Record<string, string>);
  const apiKey = anth.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "vault anthropic.ANTHROPIC_API_KEY missing" }, { status: 500 });
  }

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: SYSTEM,
      messages: [{ role: "user", content: buildPrompt(body, grounding) }],
    }),
  });
  if (!r.ok) {
    return Response.json({ error: `anthropic ${r.status}: ${await r.text()}` }, { status: 502 });
  }
  const j = (await r.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = (j.content ?? [])
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text)
    .join("\n")
    .trim();
  if (!text) {
    return Response.json({ error: "empty response from model" }, { status: 502 });
  }

  return Response.json({ lyrics: text });
}
