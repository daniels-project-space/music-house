import { schedules, task, logger } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { chromium } from "playwright";
import { api } from "../../convex/_generated/api";

// Auto-refresh RouteNote auth cookies. Runs weekly via cron, uses headless Chromium
// from the trigger.config.ts playwright extension — no Browserbase needed.
//
// Required Trigger.dev env vars (set in cloud.trigger.dev project settings):
//   ROUTENOTE_EMAIL    — RouteNote account email
//   ROUTENOTE_PASSWORD — RouteNote account password
//
// Output: writes fresh cookies to Convex `distributorAuth` (overwrites existing).

function convexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
  return new ConvexHttpClient(url);
}

// reCAPTCHA v2 site key on RouteNote's login form (constant unless they rotate it).
const ROUTENOTE_RECAPTCHA_SITEKEY = "6LfCcwwTAAAAAPp-Ksxds8T1Kv3eo0zzaJO-yUu6";
const ROUTENOTE_LOGIN_URL = "https://www.routenote.com/rn/login";

// Solve a Google reCAPTCHA v2 challenge via 2Captcha. Requires TWOCAPTCHA_API_KEY env var.
async function solveRecaptchaV2(sitekey: string, pageUrl: string): Promise<string> {
  const apiKey = process.env.TWOCAPTCHA_API_KEY;
  if (!apiKey) throw new Error("TWOCAPTCHA_API_KEY missing — needed to solve RouteNote's reCAPTCHA v2");
  const submit = await fetch(
    `https://2captcha.com/in.php?key=${apiKey}&method=userrecaptcha&googlekey=${sitekey}&pageurl=${encodeURIComponent(pageUrl)}&json=1`,
  );
  const submitJson = (await submit.json()) as { status: number; request: string };
  if (submitJson.status !== 1) throw new Error(`2captcha submit failed: ${submitJson.request}`);
  const captchaId = submitJson.request;
  // Poll up to 3 minutes for solution
  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const poll = await fetch(`https://2captcha.com/res.php?key=${apiKey}&action=get&id=${captchaId}&json=1`);
    const pollJson = (await poll.json()) as { status: number; request: string };
    if (pollJson.status === 1) return pollJson.request;
    if (pollJson.request !== "CAPCHA_NOT_READY") throw new Error(`2captcha poll error: ${pollJson.request}`);
  }
  throw new Error("2captcha timed out after 3 min");
}

async function performRefresh(runId: string): Promise<{ ok: true; cookieCount: number }> {
  logger.info("rn-refresh:start", { runId });
  const email = process.env.ROUTENOTE_EMAIL;
  const password = process.env.ROUTENOTE_PASSWORD;
  if (!email || !password) {
    throw new Error("ROUTENOTE_EMAIL / ROUTENOTE_PASSWORD missing from Trigger env");
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    logger.info("rn-refresh:nav-login");
    await page.goto(ROUTENOTE_LOGIN_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // Fill credentials. RouteNote field names: name (email), pass (password).
    await page.locator('input#name, input[name="name"]').first().fill(email);
    await page.locator('input#pass, input[name="pass"]').first().fill(password);

    // Solve the reCAPTCHA via 2Captcha and inject the response token into the hidden textarea
    // that grecaptcha.getResponse() reads. Without this, RouteNote's submit handler bails out.
    logger.info("rn-refresh:solving captcha");
    const token = await solveRecaptchaV2(ROUTENOTE_RECAPTCHA_SITEKEY, ROUTENOTE_LOGIN_URL);
    await page.evaluate((t) => {
      // reCAPTCHA injects multiple textareas across iframes; set them all
      document.querySelectorAll('textarea[name="g-recaptcha-response"], textarea#g-recaptcha-response').forEach((ta) => {
        (ta as HTMLTextAreaElement).value = t;
        (ta as HTMLTextAreaElement).innerHTML = t;
      });
      const w = window as unknown as { ___grecaptcha_cfg?: { clients?: Record<string, unknown> } };
      // Manually trigger the callback if defined on the widget config
      if (w.___grecaptcha_cfg?.clients) {
        Object.values(w.___grecaptcha_cfg.clients).forEach((client) => {
          const c = client as Record<string, unknown>;
          for (const k of Object.keys(c)) {
            const v = c[k] as Record<string, unknown> | undefined;
            if (v && typeof v === "object") {
              for (const kk of Object.keys(v)) {
                const vv = v[kk] as Record<string, unknown> | undefined;
                if (vv && typeof vv === "object" && typeof (vv as { callback?: unknown }).callback === "function") {
                  ((vv as { callback: (token: string) => void }).callback)(t);
                }
              }
            }
          }
        });
      }
    }, token);

    // Click the actual submit button — id=in_signin_button per RouteNote's HTML
    await Promise.all([
      page.waitForLoadState("domcontentloaded").catch(() => {}),
      page.locator('button#in_signin_button, button[name="submit"]').first().click({ force: true }),
    ]);
    await page.waitForTimeout(5000);

    const finalUrl = page.url();
    if (/\/login/i.test(finalUrl)) {
      const errText = await page.evaluate(() => {
        const errEl = document.querySelector(".messages.error, .error, [class*='error']");
        return errEl ? (errEl as HTMLElement).innerText.trim().slice(0, 200) : null;
      });
      throw new Error(`login failed — still on /login. error=${errText ?? "unknown"}`);
    }

    // Confirm by hitting create_album (will redirect to /login if auth lost)
    await page.goto("https://www.routenote.com/rn/create_album", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    if (/\/login/i.test(page.url())) {
      throw new Error(`auth check failed — create_album redirected to login`);
    }

    const cookies = await context.cookies();
    const rnCookies = cookies.filter((c) => /routenote\.com$/.test(c.domain));
    logger.info("rn-refresh:captured", { total: cookies.length, rn: rnCookies.length });

    const cx = convexClient();
    await cx.mutation(api.distributorAuth.save, {
      distributor: "routenote",
      cookiesJson: JSON.stringify(rnCookies),
    });

    logger.info("rn-refresh:saved", { cookieCount: rnCookies.length });
    return { ok: true, cookieCount: rnCookies.length };
  } finally {
    await browser.close().catch(() => {});
  }
}

export const refreshRoutenoteAuth = schedules.task({
  id: "refresh-routenote-auth",
  // Every Monday at 04:00 UTC. RouteNote sessions last ~30 days; refreshing weekly is safe.
  cron: "0 4 * * 1",
  maxDuration: 300,
  run: async (_payload, { ctx }) => performRefresh(ctx.run.id),
});

// Manual one-shot for the UI button or after a distribution job hits an auth-expired error.
export const refreshRoutenoteAuthNow = task({
  id: "refresh-routenote-auth-now",
  maxDuration: 300,
  run: async (_input: Record<string, never>, { ctx }) => performRefresh(ctx.run.id),
});
