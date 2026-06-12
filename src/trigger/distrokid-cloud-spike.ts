import { task, logger } from "@trigger.dev/sdk/v3";
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { chromium } from "playwright";

// DistroKid cloud feasibility spike — READ-ONLY diagnostic.
//
// Proves/disproves: Cloudflare clearance + /new globals scrape inside the
// Trigger.dev cloud container, in headless AND headed-under-Xvfb modes.
// Mirrors the proven VPS bootstrap (distrokid-cli helpers/bootstrap.mjs):
// warm /dashboard, load /new, reload-on-challenge, scrape window.albumuuid /
// window.me.id / window.distroJavascriptVars.
//
// It NEVER uploads, clicks, or submits anything — navigation + reads only.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

type RawCookie = {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expires?: number;
  expirationDate?: number; // Chrome-extension export format (what distributorAuth stores)
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
};

const SAME_SITE: Record<string, "Strict" | "Lax" | "None"> = {
  strict: "Strict",
  Strict: "Strict",
  lax: "Lax",
  Lax: "Lax",
  none: "None",
  None: "None",
  no_restriction: "None",
};

function toStorageState(raw: RawCookie[]) {
  return {
    cookies: raw.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path ?? "/",
      expires: Math.floor(c.expires ?? c.expirationDate ?? -1),
      httpOnly: c.httpOnly ?? false,
      secure: c.secure ?? false,
      sameSite: SAME_SITE[c.sameSite ?? ""] ?? "Lax",
    })),
    origins: [],
  };
}

async function startXvfb(): Promise<string> {
  const exe = ["/usr/bin/Xvfb", "/usr/local/bin/Xvfb"].find((p) => existsSync(p));
  if (!exe) return "missing-binary";
  let err = "";
  const proc = spawn(exe, [":99", "-screen", "0", "1440x900x24", "-ac"], {
    stdio: "ignore",
    detached: true,
  });
  proc.on("error", (e) => {
    err = e.message;
  });
  proc.unref();
  await new Promise((r) => setTimeout(r, 1500));
  return err ? "error:" + err : "started";
}

type AttemptResult = {
  mode: "headless" | "headed";
  ok: boolean;
  cfCleared: boolean;
  launchVariant: string;
  finalTitle: string;
  finalUrl: string;
  formEls: number;
  albumuuid: string | null;
  meId: string | number | null;
  s3Present: boolean;
  waitedIterations: number;
  error?: string;
};

async function attempt(
  mode: "headless" | "headed",
  storageState: ReturnType<typeof toStorageState>,
): Promise<AttemptResult> {
  const res: AttemptResult = {
    mode,
    ok: false,
    cfCleared: false,
    launchVariant: "",
    finalTitle: "",
    finalUrl: "",
    formEls: 0,
    albumuuid: null,
    meId: null,
    s3Present: false,
    waitedIterations: 0,
  };

  const args = [
    "--no-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--disable-dev-shm-usage",
  ];

  let browser;
  if (mode === "headless") {
    // Prefer full chromium in new-headless mode (channel) over headless-shell —
    // far less fingerprint-able. Fall back to plain headless if channel missing.
    try {
      browser = await chromium.launch({ headless: true, channel: "chromium", args });
      res.launchVariant = "channel:chromium new-headless";
    } catch {
      try {
        browser = await chromium.launch({ headless: true, args });
        res.launchVariant = "default headless (shell)";
      } catch (e) {
        res.error = "launch failed: " + (e as Error).message;
        return res;
      }
    }
  } else {
    try {
      browser = await chromium.launch({ headless: false, args });
      res.launchVariant = "headed under Xvfb";
    } catch (e) {
      res.error = "headed launch failed: " + (e as Error).message;
      return res;
    }
  }

  try {
    const context = await browser.newContext({
      storageState,
      viewport: { width: 1440, height: 900 },
      userAgent: UA,
      locale: "en-US",
      timezoneId: "Europe/London",
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);

    logger.info(mode + ": warm /dashboard");
    await page
      .goto("https://distrokid.com/dashboard", { waitUntil: "domcontentloaded", timeout: 60000 })
      .catch((e) => logger.warn(mode + ": dashboard nav: " + (e as Error).message));
    await page.waitForTimeout(3500);

    logger.info(mode + ": goto /new");
    await page
      .goto("https://distrokid.com/new", { waitUntil: "domcontentloaded", timeout: 60000 })
      .catch((e) => logger.warn(mode + ": /new nav: " + (e as Error).message));

    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(2000);
      res.waitedIterations = i + 1;
      const title = await page.title().catch(() => "");
      const els = await page.$$eval("input,select", (e) => e.length).catch(() => 0);
      res.finalTitle = title;
      res.formEls = els;
      if (!/just a moment/i.test(title) && els > 20) {
        res.cfCleared = true;
        break;
      }
      if (i === 3 || i === 10) {
        logger.info(mode + ": reload on challenge (i=" + i + ", title=" + title + ", els=" + els + ")");
        await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
      }
    }
    res.finalUrl = page.url();

    if (res.cfCleared) {
      const ids = await page
        .evaluate(() => {
          const w = window as unknown as {
            albumuuid?: string;
            me?: { id?: string | number };
            distroJavascriptVars?: unknown;
          };
          const inputEl = document.querySelector("#albumuuid") as HTMLInputElement | null;
          return {
            albumuuid: typeof w.albumuuid !== "undefined" ? w.albumuuid : inputEl?.value ?? null,
            meId: (w.me && w.me.id) ?? null,
            s3Present: !!w.distroJavascriptVars,
          };
        })
        .catch(() => ({ albumuuid: null, meId: null, s3Present: false }));
      res.albumuuid = ids.albumuuid ?? null;
      res.meId = ids.meId;
      res.s3Present = ids.s3Present;
      res.ok = !!(res.albumuuid && res.meId);
    }
  } catch (e) {
    res.error = (e as Error).message;
  } finally {
    await browser.close().catch(() => {});
  }
  return res;
}

export type DistrokidCloudSpikeInput = {
  /** Override Convex deployment to read distributorAuth cookies from. */
  convexUrl?: string;
  /** Which modes to attempt. Default: both. */
  modes?: Array<"headless" | "headed">;
};

export const distrokidCloudSpike = task({
  id: "distrokid-cloud-spike",
  maxDuration: 900,
  machine: "large-1x",
  retry: { maxAttempts: 1 },
  run: async (payload: DistrokidCloudSpikeInput) => {
    const convexUrl = payload.convexUrl ?? process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!convexUrl) throw new Error("no convexUrl (payload or NEXT_PUBLIC_CONVEX_URL)");

    const resp = await fetch(convexUrl + "/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "distributorAuth:get",
        args: { distributor: "distrokid" },
        format: "json",
      }),
    });
    const data = (await resp.json()) as { value?: { cookiesJson?: string } };
    const cookiesJson = data?.value?.cookiesJson;
    if (!cookiesJson) throw new Error("no distrokid cookies in distributorAuth — paste cookies first");
    const rawCookies = JSON.parse(cookiesJson) as RawCookie[];
    const storageState = toStorageState(rawCookies);
    logger.info("cookies loaded", { count: rawCookies.length, convexUrl });

    const diagnostics = {
      display: process.env.DISPLAY ?? null,
      browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH ?? null,
      browsersInstalled: (() => {
        try {
          return readdirSync(process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/ms-playwright");
        } catch {
          return [] as string[];
        }
      })(),
      chromiumExecutable: (() => {
        try {
          return chromium.executablePath();
        } catch (e) {
          return "error:" + (e as Error).message;
        }
      })(),
      xvfbStart: "not-attempted",
    };
    logger.info("diagnostics", diagnostics);

    const modes = payload.modes ?? ["headless", "headed"];
    const attempts: AttemptResult[] = [];
    for (const mode of modes) {
      if (mode === "headed") {
        if (!process.env.DISPLAY) process.env.DISPLAY = ":99";
        diagnostics.xvfbStart = await startXvfb();
        logger.info("xvfb: " + diagnostics.xvfbStart + ", DISPLAY=" + process.env.DISPLAY);
      }
      logger.info("=== attempt: " + mode + " ===");
      const r = await attempt(mode, storageState);
      logger.info("=== attempt " + mode + " done ===", { ...r });
      attempts.push(r);
    }

    const passed = attempts.filter((a) => a.ok).map((a) => a.mode);
    const verdict =
      passed.length > 0
        ? "PASS via " + passed.join("+")
        : "FAIL — Cloudflare not cleared / globals missing in all modes";
    return { verdict, diagnostics, attempts, cookieCount: rawCookies.length };
  },
});
