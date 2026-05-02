import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { artistSlug: v.optional(v.string()), albumSlug: v.optional(v.string()) },
  handler: async (ctx, { artistSlug, albumSlug }) => {
    if (artistSlug && albumSlug !== undefined) {
      return ctx.db
        .query("tracks")
        .withIndex("by_artist_album", (q) => q.eq("artistSlug", artistSlug).eq("albumSlug", albumSlug))
        .collect();
    }
    if (artistSlug) {
      return ctx.db
        .query("tracks")
        .withIndex("by_artist", (q) => q.eq("artistSlug", artistSlug))
        .collect();
    }
    return ctx.db.query("tracks").collect();
  },
});

export const get = query({
  args: { id: v.id("tracks") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const insert = mutation({
  args: {
    artistSlug: v.string(),
    albumSlug: v.optional(v.string()),
    trackNum: v.optional(v.number()),
    title: v.string(),
    duration: v.optional(v.number()),
    genre: v.optional(v.string()),
    generator: v.union(v.literal("suno"), v.literal("mureka"), v.literal("import")),
    audioKey: v.string(),
    flacKey: v.optional(v.string()),
    coverKey: v.optional(v.string()),
    lyrics: v.optional(v.array(v.object({ text: v.string(), start: v.number(), isSection: v.boolean() }))),
    clapScore: v.optional(v.number()),
    clapBestMatch: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    ctx.db.insert("tracks", { ...args, distributed: false, createdAt: Date.now() }),
});

export const setNotes = mutation({
  args: { id: v.id("tracks"), notes: v.string() },
  handler: async (ctx, { id, notes }) => ctx.db.patch(id, { notes }),
});

export const setRating = mutation({
  args: { id: v.id("tracks"), rating: v.number() },
  handler: async (ctx, { id, rating }) => ctx.db.patch(id, { rating }),
});

export const archive = mutation({
  args: { id: v.id("tracks") },
  handler: async (ctx, { id }) => ctx.db.patch(id, { archivedAt: Date.now() }),
});

export const unarchive = mutation({
  args: { id: v.id("tracks") },
  handler: async (ctx, { id }) => ctx.db.patch(id, { archivedAt: undefined }),
});

export const setLyrics = mutation({
  args: {
    id: v.id("tracks"),
    lyrics: v.array(v.object({ text: v.string(), start: v.number(), isSection: v.boolean() })),
  },
  handler: async (ctx, { id, lyrics }) => ctx.db.patch(id, { lyrics }),
});
