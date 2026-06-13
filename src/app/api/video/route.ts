import { NextRequest, NextResponse } from "next/server";
import { presignDownload } from "@/lib/storage";

/** Presign a rendered music-video MP4 (R2 key) for inline playback / download. */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
  try {
    const url = await presignDownload(key, 6 * 3600);
    // ?redirect=1 → 302 to the object (for a direct download/open link);
    // otherwise return JSON { url } for the inline <video> player.
    if (req.nextUrl.searchParams.get("redirect")) return NextResponse.redirect(url);
    return NextResponse.json({ url });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
