import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const distributorArg = v.union(v.literal("routenote"), v.literal("distrokid"));

// Latest analytics snapshot per distributor (streams + bank balance), written
// by the distrokid-analytics Trigger task. One row per distributor (upsert),
// plus an append-only history row per pull powering the streams graph.

// Manual refreshes within this window UPDATE the last history point instead of
// appending, so spam-clicking Refresh doesn't flood the time series.
const HISTORY_MIN_GAP_MS = 6 * 60 * 60 * 1000;

export const save = mutation({
  args: {
    distributor: distributorArg,
    fetchedAt: v.number(),
    streamsTotal: v.number(),
    streamsPending: v.boolean(),
    streamsItemsJson: v.string(),
    balance: v.number(),
    currency: v.string(),
    balancePending: v.boolean(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("distributorAnalytics")
      .withIndex("by_distributor", (q) => q.eq("distributor", args.distributor))
      .first();
    let id;
    if (existing) {
      await ctx.db.patch(existing._id, args);
      id = existing._id;
    } else {
      id = await ctx.db.insert("distributorAnalytics", args);
    }

    const point = {
      distributor: args.distributor,
      fetchedAt: args.fetchedAt,
      streamsTotal: args.streamsTotal,
      balance: args.balance,
      currency: args.currency,
    };
    const lastPoint = await ctx.db
      .query("distributorAnalyticsHistory")
      .withIndex("by_distributor_time", (q) => q.eq("distributor", args.distributor))
      .order("desc")
      .first();
    if (lastPoint && args.fetchedAt - lastPoint.fetchedAt < HISTORY_MIN_GAP_MS) {
      await ctx.db.patch(lastPoint._id, point);
    } else {
      await ctx.db.insert("distributorAnalyticsHistory", point);
    }
    return id;
  },
});

export const latest = query({
  args: { distributor: distributorArg },
  handler: async (ctx, { distributor }) =>
    ctx.db
      .query("distributorAnalytics")
      .withIndex("by_distributor", (q) => q.eq("distributor", distributor))
      .first(),
});

// Oldest→newest time series for charts (default last 180 points ≈ 1 year at
// the every-2-days cadence). Also read cross-deployment by project-hub's
// AI-income poll.
export const history = query({
  args: { distributor: distributorArg, limit: v.optional(v.number()) },
  handler: async (ctx, { distributor, limit }) => {
    const rows = await ctx.db
      .query("distributorAnalyticsHistory")
      .withIndex("by_distributor_time", (q) => q.eq("distributor", distributor))
      .order("desc")
      .take(Math.min(limit ?? 180, 500));
    return rows.reverse().map((r) => ({
      fetchedAt: r.fetchedAt,
      streamsTotal: r.streamsTotal,
      balance: r.balance,
      currency: r.currency,
    }));
  },
});
