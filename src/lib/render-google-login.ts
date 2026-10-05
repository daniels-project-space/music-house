import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
export const GOOGLE_FLOW_COOKIE = "music-house-login-flow";
const keys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
export function renderGoogleConfig() {
  const clientId = process.env.MUSIC_HOUSE_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.MUSIC_HOUSE_GOOGLE_CLIENT_SECRET;
  const sessionSecret = process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET;
  const baseUrl = process.env.MUSIC_HOUSE_AUTH_BASE_URL;
  const emails = (process.env.MUSIC_HOUSE_RENDER_OWNER_EMAILS ?? "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
  if (!clientId || !clientSecret || !sessionSecret || sessionSecret.length < 32 || !baseUrl || !emails.length) throw new Error("Music House login is not configured");
  const origin = new URL(baseUrl);
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) throw new Error("Music House login origin is invalid");
  return { clientId, clientSecret, sessionSecret, emails, origin: origin.origin, callback: `${origin.origin}/api/auth/callback` };
}
const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("base64url");
export function beginRenderGoogleLogin(config: ReturnType<typeof renderGoogleConfig>, now=Date.now()) {
  const state = randomBytes(32).toString("base64url"), nonce = randomBytes(32).toString("base64url"), verifier = randomBytes(32).toString("base64url");
  const payload = Buffer.from(JSON.stringify({state,nonce,verifier,expiresAt:now+10*60_000})).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({client_id:config.clientId,redirect_uri:config.callback,response_type:"code",scope:"openid email",state,nonce,
    code_challenge:createHash("sha256").update(verifier).digest("base64url"),code_challenge_method:"S256",prompt:"select_account"}).toString();
  return { url:url.toString(), cookie:`${payload}.${sign(payload,config.sessionSecret)}` };
}
export function verifyRenderGoogleFlow(cookie:string|undefined,state:string|null,secret:string,now=Date.now()) {
  if(!cookie || cookie.length>2000 || !state)throw new Error("Invalid login flow");
  const [payload,signature,...extra]=cookie.split(".");
  const expected=sign(payload??"",secret);
  if(!payload || !signature || extra.length || signature.length!==expected.length || !timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw new Error("Invalid login flow");
  const flow=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));
  if(flow.state!==state || !/^[A-Za-z0-9_-]{43}$/.test(flow.nonce) || !/^[A-Za-z0-9_-]{43}$/.test(flow.verifier) ||
    !Number.isSafeInteger(flow.expiresAt) || flow.expiresAt<=now || flow.expiresAt>now+10*60_000)throw new Error("Invalid login flow");
  return flow as {state:string;nonce:string;verifier:string;expiresAt:number};
}
export async function finishRenderGoogleLogin(code:string,flow:ReturnType<typeof verifyRenderGoogleFlow>,config:ReturnType<typeof renderGoogleConfig>,fetcher:typeof fetch=fetch) {
  const response=await fetcher("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,code,code_verifier:flow.verifier,grant_type:"authorization_code",redirect_uri:config.callback}),
    redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15_000)});
  if(!response.ok)throw new Error("Login code exchange failed");
  const tokens=await response.json();
  if(typeof tokens.id_token!=="string")throw new Error("Login identity is missing");
  return verifyRenderGoogleIdToken(tokens.id_token,flow.nonce,config);
}
export async function verifyRenderGoogleIdToken(token:string,nonce:string,config:ReturnType<typeof renderGoogleConfig>,getKey:JWTVerifyGetKey=keys) {
  if(token.length>6000)throw new Error("Login identity token is oversized");
  const {payload}=await jwtVerify(token,getKey,{audience:config.clientId,issuer:["https://accounts.google.com","accounts.google.com"],algorithms:["RS256"],maxTokenAge:"10m"});
  if(payload.nonce!==nonce || (payload.azp !== undefined && payload.azp !== config.clientId) || !payload.sub || payload.sub.length>200 || typeof payload.email!=="string" || payload.email_verified!==true ||
    !config.emails.includes(payload.email.toLowerCase()))throw new Error("This account is not permitted to render");
  return {subject:`google:${payload.sub}`,email:payload.email};
}
