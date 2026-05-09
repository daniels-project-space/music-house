import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = ["/share", "/api", "/locked"];

const COOKIE_NAME = "mh_unlock";

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Allow share, api, locked, Next internals, and any file with an extension (favicon, fonts, images).
  if (PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p + "/"))) {
    return NextResponse.next();
  }
  if (path.startsWith("/_next") || /\.[a-z0-9]+$/i.test(path)) {
    return NextResponse.next();
  }

  const expected = process.env.MUSIC_HOUSE_UNLOCK;
  // If no password configured, do not block (dev / first-time deploys).
  if (!expected) return NextResponse.next();

  const auth = req.cookies.get(COOKIE_NAME)?.value;
  if (auth === expected) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/locked";
  url.searchParams.set("next", path);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: "/((?!_next/|favicon\\.ico).*)",
};
