import { NextRequest, NextResponse } from "next/server";
import { RENDER_SESSION_COOKIE, verifyRenderSession } from "./render-session";
export async function renderAuthentication(request: NextRequest) {
  const sessionToken = request.cookies.get(RENDER_SESSION_COOKIE)?.value;
  const identity = await verifyRenderSession(sessionToken, process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET);
  if (!identity || !sessionToken) return { response: NextResponse.json({ error: "Log in before rendering.", loginUrl: "/api/auth/login" }, { status: 401, headers: { "Cache-Control": "no-store" } }) } as const;
  if (request.method !== "GET" && request.headers.get("origin") !== request.nextUrl.origin) {
    return { response: NextResponse.json({ error: "Same-origin request required." }, { status: 403 }) } as const;
  }
  return { identity, sessionToken } as const;
}
