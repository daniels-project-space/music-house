import { NextResponse } from "next/server";
import { beginRenderGoogleLogin, GOOGLE_FLOW_COOKIE, renderGoogleConfig } from "@/lib/render-google-login";
export async function GET() {
  try {
    const flow=beginRenderGoogleLogin(renderGoogleConfig());
    const response=NextResponse.redirect(flow.url);
    response.cookies.set(GOOGLE_FLOW_COOKIE,flow.cookie,{httpOnly:true,secure:true,sameSite:"lax",path:"/api/auth",maxAge:600});
    response.headers.set("Cache-Control","no-store");return response;
  } catch { return NextResponse.json({error:"Render login has not been configured. Public viewing remains available."},{status:503,headers:{"Cache-Control":"no-store"}}); }
}
