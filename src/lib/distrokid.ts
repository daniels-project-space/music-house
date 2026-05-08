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

const SIGNIN_URL = "https://distrokid.com/signin/";
const NEW_UPLOAD_URL = "https://distrokid.com/new/";

export async function distributeToDistrokid(
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
    await stagehand.act(`Type "${creds.email}" into the email field`);
    await stagehand.act(`Type "${creds.password}" into the password field`);
    await stagehand.act("Click the Sign In submit button");
    await page.waitForLoadState("networkidle").catch(() => {});

    await page.goto(NEW_UPLOAD_URL, { waitUntil: "domcontentloaded" });
    await stagehand.act("If asked to choose between Single and Album, choose Single");

    const audioInput = page.locator('input[type="file"]').first();
    await audioInput.setInputFiles(input.audioPath);

    const explicit = input.explicit ? "yes" : "no";
    const coverNote = input.coverPath
      ? `A cover-art image is available at path "${input.coverPath}" — when DistroKid prompts for cover art upload, upload it.`
      : `If DistroKid asks for cover art and none is provided, skip past it (you can return without finalizing).`;
    const directive = [
      `You are filling out the DistroKid upload form for the user.`,
      `Song title: "${input.title}"`,
      `Artist name: "${input.artistName}"`,
      `Genre: "${input.genre ?? "Electronic"}"`,
      `Explicit lyrics: ${explicit}`,
      `Enable distribution to ALL stores: Spotify, Apple Music, Deezer, SoundCloud, YouTube Music, Tidal, Amazon Music, and any others offered.`,
      `Set songwriter / iTunes / writer-name fields to the same artist name unless DistroKid requires a different format.`,
      coverNote,
      `Continue clicking Continue / Next through the form.`,
      `STOP at the final review/payment page. DO NOT click any final submit, pay, or confirm-and-pay button.`,
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
