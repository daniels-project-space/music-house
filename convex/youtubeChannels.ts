import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/** OAuth refresh tokens for the YouTube channel(s) the pipeline uploads to.
 *  Single label channel today (key "music-house-records"); keyed for future
 *  per-artist channels. Written by the /api/youtube/callback connect flow. */
export const save = mutation({
  args: {
    key: v.string(),
    refreshToken: v.string(),
    channelId: v.optional(v.string()),
    channelTitle: v.optional(v.string()),
  },
  handler: async (ctx, { key, refreshToken, channelId, channelTitle }) => {
    const existing = await ctx.db
      .query("youtubeChannels")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    const patch = { refreshToken, channelId, channelTitle, connectedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return ctx.db.insert("youtubeChannels", { key, ...patch });
  },
});

export const get = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) =>
    ctx.db.query("youtubeChannels").withIndex("by_key", (q) => q.eq("key", key)).first(),
});

/** Just the refresh token for a channel key (used by the render pipeline). */
export const getToken = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const row = await ctx.db
      .query("youtubeChannels")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    return row?.refreshToken ?? null;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("youtubeChannels").collect()).map((c) => ({
      key: c.key,
      channelId: c.channelId,
      channelTitle: c.channelTitle,
      connectedAt: c.connectedAt,
    })),
});

export const clear = mutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const existing = await ctx.db
      .query("youtubeChannels")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (existing) await ctx.db.delete(existing._id);
  },
});
