/**
 * Cover-image proxy for the public funnel page (`/r/...`).
 *
 * R2 objects are private, so the funnel page can't embed a raw bucket URL, and a
 * presigned URL expires after ~1h — useless as an `og:image` that social/search
 * crawlers cache for days. This route gives og:image a STABLE url: each request
 * 302-redirects to a freshly presigned download URL.
 *
 *   GET /api/cover?key=<r2-object-key>  ->  302  ->  presigned R2 url
 */
import { NextResponse, type NextRequest } from "next/server";
import { presignDownload } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key) return new NextResponse("missing key", { status: 400 });
  try {
    const url = await presignDownload(key, 3600);
    // 302 (not 301) — the presigned target rotates, so it must not be cached as
    // permanent. A short CDN cache keeps repeat crawls cheap without pinning a
    // soon-to-expire signature.
    return NextResponse.redirect(url, {
      status: 302,
      headers: { "cache-control": "public, max-age=600" },
    });
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
}
