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

export type ProgressLogger = (step: string, detail?: string) => void | Promise<void>;

const SIGNIN_URL = "https://routenote.com/login";
const RELEASES_URL = "https://www.routenote.com/rn/releases";

export async function distributeToRoutenote(
  input: DistributeInput,
  creds: { email: string; password: string },
  bb: { apiKey: string; projectId: string },
  llm: { provider: "anthropic"; apiKey: string; model: string },
  log: ProgressLogger = () => {},
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

  await log("init:start");
  await stagehand.init();
  const sessionId = stagehand.browserbaseSessionID;
  if (!sessionId) throw new Error("Stagehand init returned no Browserbase sessionId");
  const liveViewUrl = stagehand.browserbaseSessionURL ?? `https://www.browserbase.com/sessions/${sessionId}`;
  await log("init:done", liveViewUrl);
  const page = stagehand.context.pages()[0];

  try {
    await log("login:goto");
    await page.goto(SIGNIN_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await log("login:type-email");
    await stagehand.act(`Type "${creds.email}" into the email or username field`);
    await log("login:type-password");
    await stagehand.act(`Type "${creds.password}" into the password field`);
    await log("login:submit");
    await stagehand.act("Click the Login or Sign In submit button");
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await log("login:landed", page.url());

    await log("releases:goto");
    await page.goto(RELEASES_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await log("releases:landed", page.url());

    await log("upload:click-new");
    await stagehand.act("Click the button or link to add a new release, create a new release, upload music, or start a new distribution");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await log("upload:after-click", page.url());

    await stagehand
      .act("If asked to choose between a Free plan and a Premium plan, choose the Free option")
      .catch(() => {});
    await stagehand
      .act("If asked to choose between Single and Album, choose Single")
      .catch(() => {});
    await log("upload:tier-and-type-handled");

    const audioInput = page.locator('input[type="file"]').first();
    await audioInput.setInputFiles(input.audioPath);
    await log("upload:audio-set");
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

    const agent = stagehand.agent();
    const explicit = input.explicit ? "yes" : "no";
    const coverNote = input.coverPath
      ? `A cover-art image is available at path "${input.coverPath}". When the form asks for cover art / artwork, upload it from that path using the file input.`
      : `If cover art is required and none is provided, stop on that page and return without filling cover.`;

    await log("agent:fill-metadata:start");
    await agent.execute(
      [
        `You are filling the RouteNote upload form for a single track. Page state: ${page.url()}.`,
        `Fill these fields wherever they appear in this multi-step form:`,
        `- Song title / track title: "${input.title}"`,
        `- Primary artist name: "${input.artistName}"`,
        `- Genre / primary genre: "${input.genre ?? "Electronic"}"`,
        `- Songwriter / composer: "${input.artistName}"`,
        `- Explicit lyrics: ${explicit}`,
        `When the form shows a list of music stores or distribution channels (Spotify, Apple Music, Deezer, Tidal, Amazon Music, YouTube Music, SoundCloud, TikTok, etc.), select / enable ALL of them.`,
        coverNote,
        `Click Continue / Next / Save to advance to the next page each time.`,
        `STOP at the final review / submit / publish / pay page.`,
        `DO NOT click any button labeled Submit, Publish, Distribute Now, Confirm, Pay, or Confirm and Pay.`,
        `When you reach the final review page, your job is done — return immediately.`,
      ].join("\n"),
    );
    await log("agent:fill-metadata:done", page.url());

    return { sessionId, liveViewUrl };
  } catch (err) {
    await log("error", (err as Error).message);
    try {
      await stagehand.close();
    } catch {}
    throw err;
  }
}
