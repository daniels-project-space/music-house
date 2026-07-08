import { schedules, task, logger } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { openSession, closeSession } from "../lib/distrokid-native";
import type { CookieEntry } from "../lib/distrokid-cli";

// ---------------------------------------------------------------------------
// DistroKid keep-alive auth refresh.
//
// WHY THIS EXISTS: DistroKid's session cookie `BEEFARONI` has a ~24h TTL. Every
// other DistroKid cookie is long-lived (cfid/cftoken 362d, COMPUTER_* 397d), so
// the ONLY thing that expires daily is BEEFARONI — and once it lapses, every
// authenticated page redirects to /signin. Nothing in the pipeline refreshed it
// (unlike RouteNote), so the session died every day and needed a manual reauth.
//
// WHAT THIS DOES: loads the saved cookies, opens an authenticated DistroKid page
// (clearing Cloudflare), and IF still logged in re-saves the FRESH rolling
// cookies (new BEEFARONI + AWSALB) back to Convex. Running well under the 24h
// TTL keeps the session warm indefinitely with NO reauth.
//
// KEEP-ALIVE ONLY (by design): this NEVER uses a stored password. If it ever
// finds the session already dead (login wall), it throws DISTROKID_REAUTH_NEEDED
// so the Trigger run fails loudly — a human re-seeds the cookies once, then the
// keep-alive sustains them.
//
// Output: overwrites Convex `distributorAuth` (distributor:"distrokid").
// ---------------------------------------------------------------------------

function convexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
  return new ConvexHttpClient(url);
}

const SESSION_COOKIE = "BEEFARONI";
const AUTH_PAGES = [
  "https://distrokid.com/dashboard",
  "https://distrokid.com/mymusic",
];

function beefExpiryHours(cookies: { name: string; expires?: number }[]): number | null {
  const b = cookies.find((c) => c.name === SESSION_COOKIE);
  if (!b || !b.expires || b.expires <= 0) return null;
  return (b.expires - Date.now() / 1000) / 3600;
}

// Navigate to an authed page and wait out any Cloudflare interstitial.
// Returns the settled { title, url }.
async function navSettled(
  page: import("playwright").Page,
  url: string,
  log: (m: string) => void,
): Promise<{ title: string; url: string }> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(2000);
    const title = await page.title().catch(() => "");
    if (!/just a moment|attention required|checking|enable javascript/i.test(title)) {
      return { title, url: page.url() };
    }
    if (i === 3 || i === 9) {
      log(`cf-challenge reload (i=${i}, title="${title}")`);
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    }
  }
  return { title: await page.title().catch(() => ""), url: page.url() };
}

async function isLoginWall(page: import("playwright").Page, finalUrl: string): Promise<boolean> {
  if (/\/signin|\/login/i.test(finalUrl)) return true;
  const hasPwd = (await page.$('input[type="password"]')) !== null;
  const hasEmail = (await page.$('input[name="email"], input#email')) !== null;
  const hasLoginForm = (await page.$("form#loginForm")) !== null;
  return hasPwd || hasEmail || hasLoginForm;
}

async function performKeepAlive(runId: string): Promise<{
  ok: true;
  cookieCount: number;
  beefHoursBefore: number | null;
  beefHoursAfter: number | null;
}> {
  const log = (m: string) => logger.info(`dk-keepalive:${m}`, { runId });
  log("start");

  const cx = convexClient();
  const auth = await cx.query(api.distributorAuth.get, { distributor: "distrokid" });
  if (!auth?.cookiesJson) {
    // DistroKid is not configured yet (inert integration — RouteNote is the live
    // distribution path). Skip cleanly instead of throwing every 8h; auto-resumes
    // once cookies are seeded. Avoids a failed run + retry noise on every tick.
    log("no cookies in distributorAuth — DistroKid not configured, skipping keepalive");
    return { ok: true, cookieCount: 0, beefHoursBefore: null, beefHoursAfter: null };
  }
  const cookies = JSON.parse(auth.cookiesJson) as CookieEntry[];
  const beefHoursBefore = beefExpiryHours(cookies);
  log(`loaded ${cookies.length} cookies, BEEFARONI hrs_left=${beefHoursBefore?.toFixed(1) ?? "expired/none"}`);

  const session = await openSession(cookies as never, log);
  try {
    let settled = await navSettled(session.page, AUTH_PAGES[0], log);
    log(`settled url=${settled.url} title="${settled.title}" mode=${session.mode}`);

    if (await isLoginWall(session.page, settled.url)) {
      throw new Error(
        `DISTROKID_REAUTH_NEEDED: session expired — ${AUTH_PAGES[0]} hit login wall (url=${settled.url}). ` +
          `Re-seed DistroKid cookies once; keep-alive will then sustain them.`,
      );
    }

    // Touch a second authed page so the rolling session/AWSALB is fully warmed,
    // then read back the freshest cookie jar.
    settled = await navSettled(session.page, AUTH_PAGES[1], log).catch(() => settled);
    if (await isLoginWall(session.page, settled.url)) {
      throw new Error(`DISTROKID_REAUTH_NEEDED: lost session on ${AUTH_PAGES[1]} (url=${settled.url})`);
    }

    const fresh = (await session.context.cookies()).filter((c) => /distrokid\.com$/.test(c.domain));
    const beef = fresh.find((c) => c.name === SESSION_COOKIE);
    if (!beef) {
      throw new Error(`DISTROKID_REAUTH_NEEDED: no ${SESSION_COOKIE} after warm — not authenticated`);
    }
    const beefHoursAfter = beefExpiryHours(fresh);

    await cx.mutation(api.distributorAuth.save, {
      distributor: "distrokid",
      cookiesJson: JSON.stringify(fresh),
    });
    log(
      `saved ${fresh.length} cookies — BEEFARONI refreshed to hrs_left=${beefHoursAfter?.toFixed(1) ?? "?"}`,
    );

    return { ok: true, cookieCount: fresh.length, beefHoursBefore, beefHoursAfter };
  } finally {
    await closeSession(session);
  }
}

// Every 8h. BEEFARONI TTL is ~24h, so 3 attempts per TTL window — a single
// failed/missed run still leaves two more before the session can lapse.
export const refreshDistrokidAuth = schedules.task({
  id: "refresh-distrokid-auth",
  cron: "0 */8 * * *",
  maxDuration: 300,
  run: async (_payload, { ctx }) => performKeepAlive(ctx.run.id),
});

// Manual one-shot: run after a fresh cookie seed to confirm warm + on demand.
export const refreshDistrokidAuthNow = task({
  id: "refresh-distrokid-auth-now",
  maxDuration: 300,
  run: async (_input: Record<string, never>, { ctx }) => performKeepAlive(ctx.run.id),
});
