import { NextRequest, NextResponse } from "next/server";
import { verifyRenderSession, issueRenderSession, RENDER_SESSION_SECONDS, RENDER_SESSION_COOKIE } from "@/lib/render-session";
export async function GET(request:NextRequest) {
  const identity=await verifyRenderSession(request.cookies.get(RENDER_SESSION_COOKIE)?.value,process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET);
  return NextResponse.json({authenticated:!!identity,...(identity?{email:identity.email}:{})},{headers:{"Cache-Control":"no-store"}});
}
export async function DELETE(request:NextRequest) {
  if(request.headers.get("origin")!==request.nextUrl.origin)return NextResponse.json({error:"Same-origin request required"},{status:403});
  const response=NextResponse.json({authenticated:false},{headers:{"Cache-Control":"no-store"}});
  response.cookies.set(RENDER_SESSION_COOKIE,"",{httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:0});return response;
}

/** Public rendering uses browser-scoped ownership, without a login requirement. */
export async function POST(request:NextRequest) {
  if(request.headers.get("origin")!==request.nextUrl.origin)return NextResponse.json({error:"Same-origin request required"},{status:403});
  const existing=request.cookies.get(RENDER_SESSION_COOKIE)?.value;
  const identity=await verifyRenderSession(existing,process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET);
  if(identity)return NextResponse.json({authenticated:true},{headers:{"Cache-Control":"no-store"}});
  try {
    const subject=`browser:${crypto.randomUUID()}`;
    const token=await issueRenderSession(subject,"browser@music-house.invalid",process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET);
    const response=NextResponse.json({authenticated:true},{headers:{"Cache-Control":"no-store"}});
    response.cookies.set(RENDER_SESSION_COOKIE,token,{httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:RENDER_SESSION_SECONDS});
    return response;
  } catch {return NextResponse.json({error:"Render session is unavailable"},{status:503,headers:{"Cache-Control":"no-store"}});}
}
