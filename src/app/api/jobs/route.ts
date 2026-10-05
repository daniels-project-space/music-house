import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import { renderAuthentication } from "@/lib/render-auth";
export async function GET(request: NextRequest) {
  const auth=await renderAuthentication(request);if(auth.response)return auth.response;
  const jobs=await new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!).query(api.jobs.listOwned,{sessionToken:auth.sessionToken});
  return NextResponse.json({jobs},{headers:{"Cache-Control":"private, no-store"}});
}
