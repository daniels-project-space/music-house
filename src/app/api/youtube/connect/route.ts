import { getConsentUrl } from "../../../../music-video/youtube";

export const runtime = "nodejs";

/** Kick off YouTube OAuth for a channel. Visit /api/youtube/connect to connect
 *  the Music House Records channel (or ?channel=<key> for another). */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const key = url.searchParams.get("channel") ?? "music-house-records";
  const redirectUri = `${url.origin}/api/youtube/callback`;
  const consent = await getConsentUrl(redirectUri, key);
  return Response.redirect(consent, 302);
}
