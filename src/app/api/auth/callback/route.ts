import { NextRequest, NextResponse } from "next/server";
import { finishRenderGoogleLogin, GOOGLE_FLOW_COOKIE, renderGoogleConfig, verifyRenderGoogleFlow } from "@/lib/render-google-login";
import { issueRenderSession, RENDER_SESSION_COOKIE, RENDER_SESSION_SECONDS } from "@/lib/render-session";
export async function GET(request:NextRequest) {
  try {
    const config=renderGoogleConfig();
    const flow=verifyRenderGoogleFlow(request.cookies.get(GOOGLE_FLOW_COOKIE)?.value,request.nextUrl.searchParams.get("state"),config.sessionSecret);
    const code=request.nextUrl.searchParams.get("code");if(!code || code.length>4096)throw new Error("Missing login code");
    const identity=await finishRenderGoogleLogin(code,flow,config);
    const response=NextResponse.redirect(`${config.origin}/studio`);
    response.cookies.set(RENDER_SESSION_COOKIE,await issueRenderSession(identity.subject,identity.email,config.sessionSecret),
      {httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:RENDER_SESSION_SECONDS});
    response.cookies.set(GOOGLE_FLOW_COOKIE,"",{httpOnly:true,secure:true,sameSite:"lax",path:"/api/auth",maxAge:0});
    response.headers.set("Cache-Control","no-store");return response;
  } catch {
    const response=NextResponse.json({error:"Login failed. Use an authorized Google account and start again."},{status:401,headers:{"Cache-Control":"no-store"}});
    response.cookies.set(GOOGLE_FLOW_COOKIE,"",{httpOnly:true,secure:true,sameSite:"lax",path:"/api/auth",maxAge:0});return response;
  }
}
