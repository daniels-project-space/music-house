import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const distributorArg = v.union(v.literal("routenote"), v.literal("distrokid"));

// Latest analytics snapshot per distributor (streams + bank balance), written
// by the distrokid-analytics Trigger task. One row per distributor (upsert).

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
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return ctx.db.insert("distributorAnalytics", args);
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
