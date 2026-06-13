/**
 * One-time OAuth connect for the Music House Records YouTube channel.
 *
 *   npx tsx scripts/connect-music-house-records.ts [--redirect-uri http://localhost]
 *
 * Prerequisite: the channel (Brand Account) already exists — a YouTube channel
 * cannot be created via API. See docs/MUSIC_VIDEO_CHANNEL_SETUP.md.
 *
 * The --redirect-uri MUST be a redirect URI registered on the YOUTUBE_CLIENT_ID
 * OAuth client in Google Cloud Console.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { exchangeCode, getChannelMine, getConsentUrl } from "../src/music-video/youtube";
import { hydrate } from "../src/music-video/vault";
import { arg, loadEnvLocal } from "./_env";

(async () => {
  loadEnvLocal();
  await hydrate(["youtube"]).catch(() => {});
  const redirectUri = arg("redirect-uri") ?? "http://localhost";

  const url = await getConsentUrl(redirectUri, "music-house-records");
  console.log("\n1) Open this URL in a browser signed into the Google account that OWNS");
  console.log("   the Music House Records channel (pick the Brand Account when prompted):\n");
  console.log(url);
  console.log(`\n2) Approve the scopes. The browser redirects to: ${redirectUri}?code=...&state=...`);
  console.log("   On a remote server that page may not load — that's fine. Copy the FULL");
  console.log("   redirected URL from the address bar (or just the code= value).\n");

  const rl = createInterface({ input: stdin, output: stdout });
  const pasted = (await rl.question("Paste the redirected URL or the code: ")).trim();
  rl.close();

  let code = pasted;
  try {
    code = new URL(pasted).searchParams.get("code") ?? pasted;
  } catch {
    /* not a URL — treat as raw code */
  }

  const { refreshToken, accessToken } = await exchangeCode(code, redirectUri);
  const ch = await getChannelMine(accessToken);

  console.log(`\n✅ Connected channel: ${ch.title}  (${ch.id})`);
  console.log("\nStore this value as YOUTUBE_REFRESH_TOKEN_MUSIC_HOUSE_RECORDS in:");
  console.log("  • Trigger.dev dashboard → project env vars  (cloud pipeline)");
  console.log("  • music-house/.env.local                    (local renders)");
  console.log("  • optionally the secrets vault (service 'youtube')\n");
  console.log("REFRESH_TOKEN:");
  console.log(refreshToken + "\n");
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
