import "server-only";
import { Stagehand } from "@browserbasehq/stagehand";

export type DistributeInput = {
  audioPath: string;
  coverPath?: string;
  title: string;
  artistName: string;
  genre?: string;
  explicit?: boolean;
};

export type DistributeResult = {
  sessionId: string;
  liveViewUrl: string;
};

const SIGNIN_URL = "https://routenote.com/login";
const HOME_URL = "https://routenote.com/";

export async function distributeToRoutenote(
  input: DistributeInput,
  creds: { email: string; password: string },
  bb: { apiKey: string; projectId: string },
  llm: { provider: "anthropic"; apiKey: string; model: string },
): Promise<DistributeResult> {
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey: bb.apiKey,
    projectId: bb.projectId,
    keepAlive: true,
    disablePino: true,
    verbose: 1,
    model: { modelName: llm.model, apiKey: llm.apiKey },
    browserbaseSessionCreateParams: {
      projectId: bb.projectId,
      browserSettings: {
        viewport: { width: 1440, height: 900 },
        blockAds: true,
      },
    },
  });

  await stagehand.init();
  const sessionId = stagehand.browserbaseSessionID;
  if (!sessionId) throw new Error("Stagehand init returned no Browserbase sessionId");
  const liveViewUrl = stagehand.browserbaseSessionURL ?? `https://www.browserbase.com/sessions/${sessionId}`;
  const page = stagehand.context.pages()[0];

  try {
    await page.goto(SIGNIN_URL, { waitUntil: "domcontentloaded" });
    await stagehand.act(`Type "${creds.email}" into the email or username field`);
    await stagehand.act(`Type "${creds.password}" into the password field`);
    await stagehand.act("Click the Login or Sign In submit button");
    await page.waitForLoadState("networkidle").catch(() => {});

    const explicit = input.explicit ? "yes" : "no";
    const coverNote = input.coverPath
      ? `A cover-art image is available at path "${input.coverPath}" — when prompted to upload cover art, upload it from that path.`
      : `If cover art is required and none is provided, stop on that page and return so the user can upload manually.`;

    const directive = [
      `You are uploading a single song for distribution on RouteNote (routenote.com).`,
      `If you are still on the homepage or dashboard, navigate to the music distribution upload flow ("Distribute" / "New Release" / "Upload Music" — find whichever button/link starts the upload of a new release).`,
      `Choose the option to release as a Single (one song).`,
      `When prompted, upload the audio file. The audio file path is "${input.audioPath}" — set it on the file input element.`,
      `Song title: "${input.title}"`,
      `Artist name: "${input.artistName}"`,
      `Genre: "${input.genre ?? "Electronic"}"`,
      `Explicit lyrics: ${explicit}`,
      `Enable distribution to ALL stores RouteNote offers (Spotify, Apple Music, Deezer, Tidal, Amazon Music, YouTube Music, SoundCloud, TikTok, and any others) — accept the default "select all" if available.`,
      `Set songwriter / composer fields to the same artist name unless RouteNote requires real-name format.`,
      `Continue clicking Continue / Next / Save through the multi-step form.`,
      coverNote,
      `STOP at the final review / submit page. DO NOT click any final submit, distribute, or confirm button.`,
      `When you reach the final review page, return.`,
    ].join("\n");

    const agent = stagehand.agent();
    await agent.execute(directive);

    return { sessionId, liveViewUrl };
  } catch (err) {
    try {
      await stagehand.close();
    } catch {}
    throw err;
  }
}
