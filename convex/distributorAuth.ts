import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const save = mutation({
  args: {
    distributor: v.literal("routenote"),
    cookiesJson: v.string(),
  },
  handler: async (ctx, { distributor, cookiesJson }) => {
    const existing = await ctx.db
      .query("distributorAuth")
      .withIndex("by_distributor", (q) => q.eq("distributor", distributor))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { cookiesJson, savedAt: Date.now() });
      return existing._id;
    }
    return ctx.db.insert("distributorAuth", {
      distributor,
      cookiesJson,
      savedAt: Date.now(),
    });
  },
});

export const get = query({
  args: { distributor: v.literal("routenote") },
  handler: async (ctx, { distributor }) =>
    ctx.db
      .query("distributorAuth")
      .withIndex("by_distributor", (q) => q.eq("distributor", distributor))
      .first(),
});

export const clear = mutation({
  args: { distributor: v.literal("routenote") },
  handler: async (ctx, { distributor }) => {
    const existing = await ctx.db
      .query("distributorAuth")
      .withIndex("by_distributor", (q) => q.eq("distributor", distributor))
      .first();
    if (existing) await ctx.db.delete(existing._id);
  },
});
