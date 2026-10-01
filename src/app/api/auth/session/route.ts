import { NextRequest, NextResponse } from "next/server";
import { verifyRenderSession, RENDER_SESSION_COOKIE } from "@/lib/render-session";
export async function GET(request:NextRequest) {
  const identity=await verifyRenderSession(request.cookies.get(RENDER_SESSION_COOKIE)?.value,process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET);
  return NextResponse.json({authenticated:!!identity,...(identity?{email:identity.email}:{})},{headers:{"Cache-Control":"no-store"}});
}
export async function DELETE(request:NextRequest) {
  if(request.headers.get("origin")!==request.nextUrl.origin)return NextResponse.json({error:"Same-origin request required"},{status:403});
  const response=NextResponse.json({authenticated:false},{headers:{"Cache-Control":"no-store"}});
  response.cookies.set(RENDER_SESSION_COOKIE,"",{httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:0});return response;
}
