import { task, schedules, logger } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import {
  openSession,
  closeSession,
  fetchStatsPage,
  fetchEarningsPage,
  fetchHyperfollowPages,
  findHyperfollowUrl,
} from "../lib/distrokid-native";
import {
  buildStatsUrl,
  parseStats,
  parseEarnings,
} from "../lib/distrokid-analytics";
import type { CookieEntry } from "../lib/distrokid-cli";

function humanizeSlug(slug: string): string {
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

// READ-ONLY analytics pull: account-wide streams (amCharts dataProvider on
// /stats/) + bank balance (/bank/overview/), persisted to Convex
// distributorAnalytics (latest + history row). Never submits, clicks, or POSTs.
// Runs on demand (UI Refresh button) and every 2 days via the schedule below.

export type DistrokidAnalyticsInput = {
  /** Override Convex deployment (defaults to NEXT_PUBLIC_CONVEX_URL). */
  convexUrl?: string;
};

async function runAnalyticsPull(convexUrlOverride?: string) {
  const convexUrl = convexUrlOverride ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) throw new Error("no convexUrl (payload or NEXT_PUBLIC_CONVEX_URL)");
  const cx = new ConvexHttpClient(convexUrl);

  const auth = await cx.query(api.distributorAuth.get, { distributor: "distrokid" });
  if (!auth?.cookiesJson) {
    // DistroKid not configured yet (inert integration). Skip cleanly instead of
    // throwing every 2 days; auto-resumes once cookies are seeded.
    logger.info("dk:analytics: no DistroKid cookies — not configured, skipping");
    return;
  }
  const cookies = JSON.parse(auth.cookiesJson) as CookieEntry[];

  const log = (msg: string) => logger.info("dk:analytics: " + msg);
  const session = await openSession(cookies, log);
  try {
    const statsUrl = buildStatsUrl({ view: "streams" });
    const statsPage = await fetchStatsPage(session.page, statsUrl, log);
    const stats = parseStats(statsPage, { view: "streams" });
    log(`stats: total=${stats.total} items=${stats.items.length} pending=${!!stats.pending}`);

    const earningsPage = await fetchEarningsPage(session.page, log);
    const earnings = parseEarnings(earningsPage);
    log(`earnings: ${earnings.balance} ${earnings.currency} pending=${earnings.pending}`);

    await cx.mutation(api.distributorAnalytics.save, {
      distributor: "distrokid",
      fetchedAt: Date.now(),
      streamsTotal: stats.total,
      streamsPending: stats.pending ?? false,
      streamsItemsJson: JSON.stringify(stats.items.slice(0, 500)),
      balance: earnings.balance,
      currency: earnings.currency,
      balancePending: earnings.pending,
      message: stats.message ?? earnings.message,
    });

    // HyperFollow sync: best-effort. A release only gets a URL once Daniel has
    // manually built a HyperFollow page for it in DistroKid's own dashboard
    // (see fetchHyperfollowPages) — this just discovers + persists whichever
    // already exist, piggybacking on this cron (every 2 days) instead of a
    // dedicated schedule. Never fails the analytics pull above.
    try {
      const cards = await fetchHyperfollowPages(session.page, log);
      if (cards.length) {
        const jobs = await cx.query(api.distribution.listAll, {});
        const pending = jobs.filter(
          (j) => (j.status === "submitted" || j.status === "complete") && !j.hyperfollowUrl,
        );
        if (pending.length) {
          const allAlbums = await cx.query(api.albums.list, {});
          for (const j of pending) {
            let artistSlug: string | undefined;
            let releaseTitle: string | undefined;
            if (j.releaseType === "album" && j.albumId) {
              const album = allAlbums.find((a) => a._id === j.albumId);
              if (album) {
                artistSlug = album.artistSlug;
                releaseTitle = album.name;
              }
            } else {
              const track = await cx.query(api.tracks.get, { id: j.trackId });
              if (track) {
                artistSlug = track.artistSlug;
                releaseTitle = track.title;
              }
            }
            if (!artistSlug || !releaseTitle) continue;
            const url = findHyperfollowUrl(cards, { artistName: humanizeSlug(artistSlug), releaseTitle });
            if (url) {
              await cx.mutation(api.distribution.setHyperfollowUrl, { id: j._id, hyperfollowUrl: url });
              log(`hyperfollow matched: ${releaseTitle} -> ${url}`);
            }
          }
        }
      }
    } catch (e) {
      log("hyperfollow sync failed (non-fatal): " + (e as Error).message);
    }

    return {
      streamsTotal: stats.total,
      streamsItems: stats.items.length,
      streamsPending: stats.pending ?? false,
      balance: earnings.balance,
      currency: earnings.currency,
      mode: session.mode,
    };
  } finally {
    await closeSession(session);
  }
}

export const distrokidAnalytics = task({
  id: "distrokid-analytics",
  maxDuration: 600,
  machine: "large-1x",
  retry: { maxAttempts: 2 },
  run: async (payload: DistrokidAnalyticsInput) => runAnalyticsPull(payload.convexUrl),
});

// Every 2 days at 07:00 UTC — keeps the streams graph (music-house /analytics
// + project-hub AI-income widget) moving without anyone pressing Refresh.
export const distrokidAnalyticsSchedule = schedules.task({
  id: "distrokid-analytics-schedule",
  cron: "0 7 */2 * *",
  maxDuration: 600,
  machine: "large-1x",
  retry: { maxAttempts: 2 },
  run: async () => runAnalyticsPull(),
});
