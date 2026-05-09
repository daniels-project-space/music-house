import { NextResponse } from "next/server";

// No-op middleware — gating is handled by serving share routes from a separate
// Vercel project (mh-listen) so the main app stays unauthenticated.
export function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: "/((?!_next/|favicon\\.ico).*)",
};
