import "server-only";
import { chromium } from "playwright";
import type { CookieEntry } from "./routenote-http";

// Final submit step: tick T&C, click Distribute Free, click Complete Release in modal.
// Curl POST to /rn/edit_album/<UPC> is WAF-blocked; only a real browser passes.
//
// Trigger.dev's playwright build extension installs Chromium in the runtime image.

export type FinalSubmitResult = {
  submitted: boolean;
  finalUrl: string;
  modalText?: string;
  refreshedCookies?: CookieEntry[];
};

export async function submitDistributeFreePlaywright(
  upc: string,
  cookies: CookieEntry[],
): Promise<FinalSubmitResult> {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 900 },
    });

    // Cookie scoping: pass with `url:` (not domain+path) — Playwright silently drops
    // path-scoped cookies from the saved Browserbase jar otherwise, killing the SESS.
    const seen = new Map<string, CookieEntry>();
    for (const c of cookies) {
      if (!/routenote\.com$/.test(c.domain || "")) continue;
      if (!seen.has(c.name)) seen.set(c.name, c);
    }
    const farFuture = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
    const cleanCookies = [...seen.values()].map((c) => ({
      name: c.name,
      value: c.value,
      url: "https://www.routenote.com/",
      expires: farFuture,
      httpOnly: !!c.httpOnly,
      secure: true,
      sameSite: "Lax" as const,
    }));
    await ctx.addCookies(cleanCookies);

    const page = await ctx.newPage();
    page.on("dialog", (d) => { d.accept().catch(() => {}); });

    const albumUrl = `https://www.routenote.com/rn/edit_album/${upc}`;
    await page.goto(albumUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    if (page.url().toLowerCase().includes("/login")) {
      throw new Error("auth lost — re-bootstrap RouteNote cookies via Browserbase");
    }

    // Verify trackcount is ≥ 1 before attempting submit (otherwise validator blocks)
    const trackCountStr = await page.evaluate(() => {
      const scripts = [...document.querySelectorAll("script")].map((s) => s.textContent || "").join("\n");
      const m = scripts.match(/var\s+trackcount\s*=\s*"?(\d+)"?/);
      return m ? m[1] : "0";
    });
    if (parseInt(trackCountStr, 10) < 1) {
      throw new Error(`trackcount=${trackCountStr} on album page — audio upload didn't register`);
    }

    // Tick "I understand T&Cs" + click Distribute Free
    await page.locator("#submit_chk").check({ force: true });
    await page.waitForTimeout(500);
    await page.locator(".dislinkfree, input[value='Distribute Free']").first().click({ force: true });
    await page.waitForTimeout(2500);

    // The agree_terms modal pops up if validation passed
    const visibleModals = await page.evaluate(() => {
      const out: Array<{ id: string; text: string }> = [];
      document
        .querySelectorAll("[id*='valid'], [id*='terms'], [id*='lcrole'], [id*='artrole'], [id*='dt_validation'], [id*='orgrlsdat']")
        .forEach((el) => {
          const e = el as HTMLElement;
          if (getComputedStyle(e).display !== "none" && e.offsetParent !== null) {
            out.push({ id: e.id, text: (e.innerText || "").trim().slice(0, 300) });
          }
        });
      return out;
    });

    const agreeOpen = visibleModals.some((m) => m.id === "agree_terms");
    if (!agreeOpen) {
      const errModal = visibleModals.find((m) => /artist|valid|role|missing|invalid/i.test(m.text));
      const refreshedCookies = (await ctx.cookies()) as CookieEntry[];
      return {
        submitted: false,
        finalUrl: page.url(),
        modalText: errModal ? errModal.text : `agree_terms didn't open (modals: ${JSON.stringify(visibleModals.map((m) => m.id))})`,
        refreshedCookies,
      };
    }

    // Click Complete Release — sets freedist=1 and submits the completefrm form
    try {
      await page.locator("#rn_btn_ok").click({ force: true, timeout: 5000 });
    } catch {
      // Click already fired but Playwright's "wait for navigation" hung — ignore.
    }

    // Wait for redirect to release_details/<UPC> (success signal)
    try {
      await page.waitForURL(/release_details/, { timeout: 30000 });
    } catch {
      // Even if waitForURL times out, RouteNote often took the submit. Verify by checking releases listing.
    }
    const finalUrl = page.url();

    // Capture refreshed cookies for next run
    const refreshedCookies = (await ctx.cookies()) as CookieEntry[];

    return {
      submitted: /release_details/.test(finalUrl),
      finalUrl,
      refreshedCookies,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
