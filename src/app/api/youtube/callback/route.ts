import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import { exchangeCode, getChannelMine } from "../../../../music-video/youtube";

export const runtime = "nodejs";

function page(msg: string, ok: boolean): Response {
  return new Response(
    `<!doctype html><meta charset=utf-8><body style="font-family:system-ui;background:#0b0b0f;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><div style="max-width:560px;padding:32px;border:1px solid #333;border-radius:12px"><h2 style="color:${ok ? "#5ad" : "#f66"};margin:0 0 12px">${ok ? "✓ Channel connected" : "✗ Connect error"}</h2><p style="line-height:1.5">${msg}</p></div></body>`,
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/** OAuth redirect target: exchanges the code, identifies the channel, and saves
 *  the refresh token so the render pipeline publishes to it. */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const key = url.searchParams.get("state") ?? "music-house-records";
  const err = url.searchParams.get("error");
  if (err) return page(`Google returned: ${err}`, false);
  if (!code) return page("Missing ?code in callback.", false);
  const redirectUri = `${url.origin}/api/youtube/callback`;
  try {
    const { refreshToken, accessToken } = await exchangeCode(code, redirectUri);
    let channelId: string | undefined;
    let channelTitle: string | undefined;
    try {
      const ch = await getChannelMine(accessToken);
      channelId = ch.id;
      channelTitle = ch.title;
    } catch {
      // channels.list can fail for brand-new channels; token is still valid.
    }
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!convexUrl) return page("NEXT_PUBLIC_CONVEX_URL not set on the server.", false);
    const cx = new ConvexHttpClient(convexUrl);
    await cx.mutation(api.youtubeChannels.save, { key, refreshToken, channelId, channelTitle });
    return page(
      `Connected <b>${channelTitle ?? key}</b>${channelId ? ` (<code>${channelId}</code>)` : ""}. Music videos will now publish here. You can close this tab.`,
      true,
    );
  } catch (e) {
    return page(`${String((e as Error).message).slice(0, 320)}`, false);
  }
}
