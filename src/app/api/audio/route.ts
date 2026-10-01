import { isPublicMediaKey } from "@/lib/public-media-key";
import { NextRequest, NextResponse } from "next/server";
import { presignDownload } from "@/lib/storage";

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
  if (!isPublicMediaKey(key)) return NextResponse.json({ error: "Asset not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  try {
    const url = await presignDownload(key, 3600);
    return NextResponse.json({ url });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
