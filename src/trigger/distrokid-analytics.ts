import { task, logger } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import {
  openSession,
  closeSession,
  fetchStatsPage,
  fetchEarningsPage,
} from "../lib/distrokid-native";
import {
  buildStatsUrl,
  parseStats,
  parseEarnings,
} from "../lib/distrokid-analytics";
import type { CookieEntry } from "../lib/distrokid-cli";

// READ-ONLY analytics pull: account-wide streams (amCharts dataProvider on
// /stats/) + bank balance (/bank/overview/), persisted to Convex
// distributorAnalytics for the dashboard. Never submits, clicks, or POSTs.

export type DistrokidAnalyticsInput = {
  /** Override Convex deployment (defaults to NEXT_PUBLIC_CONVEX_URL). */
  convexUrl?: string;
};

export const distrokidAnalytics = task({
  id: "distrokid-analytics",
  maxDuration: 600,
  machine: "large-1x",
  retry: { maxAttempts: 2 },
  run: async (payload: DistrokidAnalyticsInput) => {
    const convexUrl = payload.convexUrl ?? process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!convexUrl) throw new Error("no convexUrl (payload or NEXT_PUBLIC_CONVEX_URL)");
    const cx = new ConvexHttpClient(convexUrl);

    const auth = await cx.query(api.distributorAuth.get, { distributor: "distrokid" });
    if (!auth?.cookiesJson) throw new Error("no DistroKid auth cookies — paste cookies first");
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
  },
});
