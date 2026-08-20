import { NextRequest, NextResponse } from "next/server";
import { presignAttachment } from "@/lib/storage";

// Per-track "download original" endpoint. The client picks the highest-quality
// key it holds (flacKey > audioKey) and we 302 to a short-lived presigned URL
// carrying a Content-Disposition override, so the browser saves the untouched
// R2 object rather than streaming it in a tab. Redirecting (instead of proxying
// the bytes) keeps lossless WAV/FLAC downloads off the serverless function.

const CONTENT_TYPES: Record<string, string> = {
  flac: "audio/flac",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
};

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
  // Object keys only — no absolute URLs, no traversal, no bucket-root escapes.
  if (key.startsWith("/") || key.includes("://") || key.includes("..")) {
    return NextResponse.json({ error: "invalid key" }, { status: 400 });
  }

  const ext = (key.split(".").pop() ?? "").toLowerCase();
  if (!CONTENT_TYPES[ext]) {
    return NextResponse.json({ error: "unsupported audio type" }, { status: 400 });
  }

  const requested = req.nextUrl.searchParams.get("name")?.trim();
  const fallback = key.split("/").pop() ?? `track.${ext}`;
  // Strip path separators and control chars; keep the real extension.
  const base = (requested || fallback).replace(/[/\\\x00-\x1F]/g, "_").slice(0, 180);
  const filename = base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;

  try {
    const url = await presignAttachment(key, filename, 900, CONTENT_TYPES[ext]);
    return NextResponse.redirect(url, 302);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
