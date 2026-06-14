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
    sunoTaskId: v.optional(v.string()),
    sunoAudioId: v.optional(v.string()),
    seedUrl: v.optional(v.string()),
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


export const move = mutation({
  args: {
    id: v.id("tracks"),
    targetArtistSlug: v.string(),
    targetAlbumSlug: v.optional(v.string()),
    targetPosition: v.optional(v.number()),
  },
  handler: async (ctx, { id, targetArtistSlug, targetAlbumSlug, targetPosition }) => {
    const track = await ctx.db.get(id);
    if (!track) throw new Error("Track not found");
    const patch: { artistSlug: string; albumSlug?: string; trackNum?: number } = {
      artistSlug: targetArtistSlug,
      albumSlug: targetAlbumSlug,
    };
    if (typeof targetPosition === "number") patch.trackNum = targetPosition;
    await ctx.db.patch(id, patch);
  },
});

export const reorder = mutation({
  args: {
    id: v.id("tracks"),
    position: v.number(),
  },
  handler: async (ctx, { id, position }) => {
    const track = await ctx.db.get(id);
    if (!track) throw new Error("Track not found");
    const siblings = await ctx.db
      .query("tracks")
      .withIndex("by_artist_album", (q) =>
        q.eq("artistSlug", track.artistSlug).eq("albumSlug", track.albumSlug),
      )
      .collect();
    const sorted = siblings.sort((a, b) => (a.trackNum ?? 0) - (b.trackNum ?? 0));
    const without = sorted.filter((t) => t._id !== id);
    without.splice(Math.max(0, Math.min(position, without.length)), 0, track);
    for (let i = 0; i < without.length; i++) {
      await ctx.db.patch(without[i]._id, { trackNum: i + 1 });
    }
  },
});
export const rename = mutation({
  args: { id: v.id("tracks"), title: v.string() },
  handler: async (ctx, { id, title }) => {
    const t = title.trim();
    if (!t) throw new Error("title required");
    await ctx.db.patch(id, { title: t });
  },
});

export const setDistributed = mutation({
  args: { id: v.id("tracks"), distributed: v.boolean() },
  handler: async (ctx, { id, distributed }) =>
    ctx.db.patch(id, { distributed, distributedAt: distributed ? Date.now() : undefined }),
});

export const remove = mutation({
  args: { id: v.id("tracks") },
  handler: async (ctx, { id }) => ctx.db.delete(id),
});
