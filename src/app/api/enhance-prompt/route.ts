import { NextRequest, NextResponse } from "next/server";

function sentence(value: string) {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * A dependable, reviewable Suno prompt formatter. It deliberately does not
 * depend on a third-party LLM: the previous Claude request could fail before a
 * user ever reached the renderer. The output keeps the user's creative brief
 * intact and appends only production/arrangement guidance that Suno accepts.
 */
function enhanceForSuno(input: { prompt: string; genre?: string; hasLyrics: boolean }) {
  // Keep repeated clicks safe: a user can refine the formatted brief without
  // accidentally stacking the same production instructions over and over.
  if (input.prompt.includes("Keep a focused musical palette")) return input.prompt;

  const sections = [
    input.genre ? sentence(input.genre) : undefined,
    sentence(input.prompt),
    "Keep a focused musical palette, a memorable melodic hook, and a polished, cohesive mix.",
    "Use a clear arrangement with an intentional opening, development, peak, and ending.",
    input.hasLyrics ? "Use the supplied lyrics and preserve their section labels." : undefined,
  ].filter((part): part is string => Boolean(part));

  return sections.join(" ");
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Valid JSON is required." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "A JSON object is required." }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const genre = typeof body.genre === "string" && body.genre.trim() ? body.genre.trim() : undefined;
  const hasLyrics = typeof body.lyrics === "string" && body.lyrics.trim().length > 0;

  if (!prompt) return NextResponse.json({ error: "Write a sound brief before enhancing it." }, { status: 400 });
  if (prompt.length > 1000) return NextResponse.json({ error: "The sound brief must be 1000 characters or fewer." }, { status: 400 });
  if (genre && genre.length > 120) return NextResponse.json({ error: "The genre must be 120 characters or fewer." }, { status: 400 });

  return NextResponse.json({ enhanced: enhanceForSuno({ prompt, genre, hasLyrics }) });
}
