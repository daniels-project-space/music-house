import { NextRequest, NextResponse } from "next/server";
import { callClaude } from "@/lib/anthropic";

export async function POST(req: NextRequest) {
  const { prompt, generator } = await req.json();
  if (!prompt) return NextResponse.json({ error: "prompt required" }, { status: 400 });
  try {
    const system =
      generator === "suno"
        ? "You enhance Suno V5.5 music prompts. Output a single style/genre prompt 30-100 words: instruments, era, mood, vocal style, production texture. No commentary, no quotes, no headings."
        : "You enhance Mureka V8 music prompts. Output a single style prompt 30-100 words: genre, BPM hint, instruments, mood, dynamics, mix character. No commentary, no quotes.";
    const enhanced = await callClaude({ system, user: `Enhance: ${prompt}`, model: "claude-haiku-4-5-20251001", maxTokens: 200 });
    return NextResponse.json({ enhanced: enhanced.trim() });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
