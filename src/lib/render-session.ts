/** Shared WebCrypto verification keeps the HTTP and Convex ownership boundaries identical. */
export const RENDER_SESSION_COOKIE = "music-house-render-session";
export const RENDER_SESSION_SECONDS = 8 * 60 * 60;
export type RenderIdentity = { subject: string; email: string; expiresAt: number };
const encoder = new TextEncoder();
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
async function key(secret: string | undefined) {
  if (!secret || secret.length < 32) throw new Error("Render login is not configured");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function issueRenderSession(subject: string, email: string, secret: string | undefined, now = Date.now()) {
  if (!subject || subject.length > 200 || !email || email.length > 320) throw new Error("Invalid render identity");
  const payload = encode(encoder.encode(JSON.stringify({ version: 1, audience: "music-house-render", subject, email, issuedAt: now, expiresAt: now + RENDER_SESSION_SECONDS * 1000 })));
  const signature = await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(payload));
  return `${payload}.${encode(new Uint8Array(signature))}`;
}
export async function verifyRenderSession(token: string | undefined, secret: string | undefined, now = Date.now()): Promise<RenderIdentity | null> {
  if (!token || token.length > 2000) return null;
  try {
    const [payload, signature, ...extra] = token.split(".");
    if (!payload || !signature || extra.length || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]{43}$/.test(signature) ||
        !await crypto.subtle.verify("HMAC", await key(secret), decode(signature), encoder.encode(payload))) return null;
    const value = JSON.parse(new TextDecoder().decode(decode(payload)));
    if (value.version !== 1 || value.audience !== "music-house-render" || typeof value.subject !== "string" || !value.subject || value.subject.length > 200 ||
        typeof value.email !== "string" || !value.email || value.email.length > 320 || !Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt) ||
        value.issuedAt > now + 30_000 || value.expiresAt <= now || value.expiresAt - value.issuedAt !== RENDER_SESSION_SECONDS * 1000) return null;
    return { subject: value.subject, email: value.email, expiresAt: value.expiresAt };
  } catch { return null; }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
/** Bind privileged engine ledger changes to the trusted HTTP caller, not merely a logged-in browser. */
export async function issueRenderMutationProof(operation: string, subject: string, args: unknown, secret: string | undefined, now=Date.now()) {
  const payload=encode(encoder.encode(JSON.stringify({audience:"music-house-server-mutation",operation,subject,args:canonical(args),expiresAt:now+60_000})));
  const signature=await crypto.subtle.sign("HMAC",await key(secret),encoder.encode(payload));
  return `${payload}.${encode(new Uint8Array(signature))}`;
}
export async function verifyRenderMutationProof(proof:string|undefined,operation:string,subject:string,args:unknown,secret:string|undefined,now=Date.now()) {
  try {
    if(!proof || proof.length>12000)return false;
    const [payload,signature,...extra]=proof.split(".");
    if(!payload || !signature || extra.length || !/^[A-Za-z0-9_-]{43}$/.test(signature) ||
      !await crypto.subtle.verify("HMAC",await key(secret),decode(signature),encoder.encode(payload)))return false;
    const value=JSON.parse(new TextDecoder().decode(decode(payload)));
    return value.audience==="music-house-server-mutation" && value.operation===operation && value.subject===subject && value.args===canonical(args) &&
      Number.isSafeInteger(value.expiresAt) && value.expiresAt>now && value.expiresAt<=now+60_000;
  } catch {return false;}
}

/** Job-scoped worker capability. Only its digest is persisted or returned. */
export async function renderWorkerTokenDigest(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid render worker capability");
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token))), byte => byte.toString(16).padStart(2,"0")).join("");
}
