import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => ctx.db.query("hearts").collect(),
});

export const isHearted = query({
  args: { trackId: v.id("tracks") },
  handler: async (ctx, { trackId }) => {
    const r = await ctx.db.query("hearts").withIndex("by_track", (q) => q.eq("trackId", trackId)).first();
    return r !== null;
  },
});

export const toggle = mutation({
  args: { trackId: v.id("tracks") },
  handler: async (ctx, { trackId }) => {
    const existing = await ctx.db.query("hearts").withIndex("by_track", (q) => q.eq("trackId", trackId)).first();
    if (existing) {
      await ctx.db.delete(existing._id);
      return false;
    }
    await ctx.db.insert("hearts", { trackId, createdAt: Date.now() });
    return true;
  },
});
