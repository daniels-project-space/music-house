import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { artistSlug: v.optional(v.string()) },
  handler: async (ctx, { artistSlug }) => {
    if (artistSlug) {
      return ctx.db
        .query("albums")
        .withIndex("by_artist", (q) => q.eq("artistSlug", artistSlug))
        .collect();
    }
    return ctx.db.query("albums").collect();
  },
});

export const getOne = query({
  args: { artistSlug: v.string(), slug: v.string() },
  handler: async (ctx, { artistSlug, slug }) =>
    ctx.db
      .query("albums")
      .withIndex("by_artist_and_slug", (q) => q.eq("artistSlug", artistSlug).eq("slug", slug))
      .first(),
});

export const upsert = mutation({
  args: {
    artistSlug: v.string(),
    slug: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    genre: v.optional(v.string()),
    coverKey: v.optional(v.string()),
    section: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("albums")
      .withIndex("by_artist_and_slug", (q) => q.eq("artistSlug", args.artistSlug).eq("slug", args.slug))
      .first();
    const data = { ...args, createdAt: existing?.createdAt ?? Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, data);
      return existing._id;
    }
    return ctx.db.insert("albums", data);
  },
});
