import { verifyRenderSession } from "../src/lib/render-session";
export async function requireRenderIdentity(sessionToken: string | undefined) {
  const identity = await verifyRenderSession(sessionToken, process.env.MUSIC_HOUSE_RENDER_SESSION_SECRET);
  if (!identity) throw new Error("Render login required");
  return identity;
}
