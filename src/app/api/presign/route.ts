import { NextRequest, NextResponse } from "next/server";
import { presignDownload } from "@/lib/storage";

// Bulk presign endpoint. POST { keys: string[] } => { urls: { [key]: url } }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const keys: string[] = Array.isArray(body.keys) ? body.keys : [];
  if (keys.length === 0) return NextResponse.json({ urls: {} });
  const out: Record<string, string> = {};
  await Promise.all(
    keys.map(async (k) => {
      try {
        out[k] = await presignDownload(k, 3600);
      } catch {
        // skip key
      }
    }),
  );
  return NextResponse.json(
    { urls: out },
    { headers: { "cache-control": "private, max-age=300" } },
  );
}
