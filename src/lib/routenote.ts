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
  loggedIn: boolean;
  reachedReview: boolean;
};

export type ProgressLogger = (step: string, detail?: string) => void | Promise<void>;

const SIGNIN_URL = "https://www.routenote.com/rn/login";
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
  const liveViewUrl =
    stagehand.browserbaseSessionURL ?? `https://www.browserbase.com/sessions/${sessionId}`;
  await log("init:done", liveViewUrl);
  const page = stagehand.context.pages()[0];

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  let loggedIn = false;
  let reachedReview = false;

  try {
    await log("login:goto");
    await page.goto(SIGNIN_URL, { waitUntil: "domcontentloaded", timeoutMs: 30_000 });
    await page.waitForLoadState("networkidle", 15_000).catch(() => {});
    await sleep(1500);

    try {
      const emailInput = page
        .locator(
          'input[type="email"], input[name="email"], input[autocomplete="username"], input[id*="email" i]',
        )
        .first();
      await emailInput.fill(creds.email);
      await log("login:email-filled");

      const passwordInput = page
        .locator('input[type="password"], input[name="password"]')
        .first();
      await passwordInput.fill(creds.password);
      await log("login:password-filled");

      const submitBtn = page
        .locator(
          'button[type="submit"], input[type="submit"], button:has-text("Log in"), button:has-text("Sign in"), button:has-text("Login")',
        )
        .first();
      await submitBtn.click();
      await log("login:submitted");

      for (let i = 0; i < 25; i++) {
        await sleep(1000);
        if (!page.url().toLowerCase().includes("/login")) break;
      }
      await page.waitForLoadState("networkidle", 15_000).catch(() => {});

      loggedIn = !page.url().toLowerCase().includes("/login");
      await log("login:result", `loggedIn=${loggedIn} url=${page.url()}`);
    } catch (e) {
      await log("login:error", (e as Error).message);
    }

    if (!loggedIn) {
      await log("login:fallback-to-manual", "user must finish login via live view");
      return { sessionId, liveViewUrl, loggedIn, reachedReview };
    }

    await log("releases:goto");
    await page.goto(RELEASES_URL, { waitUntil: "domcontentloaded", timeoutMs: 30_000 });
    await page.waitForLoadState("networkidle", 15_000).catch(() => {});
    await log("releases:landed", page.url());

    await log("upload:click-new");
    await stagehand
      .act(
        "Click the button or link that starts a new release / new music upload / distribute new song. The button text may say Add release, New release, Distribute, Upload music, or similar.",
      )
      .catch(async (e) => {
        await log("upload:click-new-failed", (e as Error).message);
      });
    await page.waitForLoadState("networkidle", 15_000).catch(() => {});
    await log("upload:after-click", page.url());

    await stagehand
      .act("If asked to choose between a Free plan and a Premium plan, choose the Free option")
      .catch(() => {});
    await stagehand
      .act("If asked to choose between Single and Album, choose Single")
      .catch(() => {});

    try {
      await sleep(1500);
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(input.audioPath);
      await log("upload:audio-set");
    } catch (e) {
      await log("upload:audio-set-failed", (e as Error).message);
    }
    await page.waitForLoadState("networkidle", 30_000).catch(() => {});

    const explicit = input.explicit ? "yes" : "no";
    const coverNote = input.coverPath
      ? `A cover-art image is at "${input.coverPath}". When the form asks for cover art, set it on the cover-art file input.`
      : `If cover art is required and none is provided, stop and return.`;

    await log("agent:fill-metadata:start");
    const agent = stagehand.agent();
    await agent.execute(
      [
        `You are filling the RouteNote upload form for a single track. Current URL: ${page.url()}.`,
        `Fill these fields wherever they appear in this multi-step form:`,
        `- Song / track title: "${input.title}"`,
        `- Primary artist name: "${input.artistName}"`,
        `- Genre / primary genre: "${input.genre ?? "Electronic"}"`,
        `- Songwriter / composer: "${input.artistName}"`,
        `- Explicit lyrics: ${explicit}`,
        `When the form shows a list of music stores or distribution channels (Spotify, Apple Music, Deezer, Tidal, Amazon Music, YouTube Music, SoundCloud, TikTok, etc.), select / enable ALL of them.`,
        coverNote,
        `Click Continue / Next / Save to advance each page.`,
        `STOP at the final review / submit / publish / pay page.`,
        `DO NOT click any button labeled Submit, Publish, Distribute Now, Confirm, Pay, or Confirm and Pay.`,
        `When you reach the final review page, return immediately.`,
      ].join("\n"),
    );
    reachedReview = true;
    await log("agent:fill-metadata:done", page.url());

    return { sessionId, liveViewUrl, loggedIn, reachedReview };
  } catch (err) {
    await log("error", (err as Error).message);
    return { sessionId, liveViewUrl, loggedIn, reachedReview };
  }
}
