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
    await page.goto("https://www.routenote.com/rn/login", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    // Login form selectors — verified against RouteNote's Drupal login page.
    // Field names: name (username/email), pass (password), op (submit).
    await page.locator('input[name="name"], input#edit-name').first().fill(email);
    await page.locator('input[name="pass"], input#edit-pass').first().fill(password);
    await Promise.all([
      page.waitForLoadState("domcontentloaded").catch(() => {}),
      page.locator('input[name="op"][value*="Sign" i], input[type="submit"]').first().click({ force: true }),
    ]);
    await page.waitForTimeout(4000);

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
