import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => ctx.db.query("artists").collect(),
});

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) =>
    ctx.db.query("artists").withIndex("by_slug", (q) => q.eq("slug", slug)).first(),
});

export const upsert = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    genres: v.array(v.string()),
    coverKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("artists").withIndex("by_slug", (q) => q.eq("slug", args.slug)).first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return ctx.db.insert("artists", args);
  },
});

// Set (or clear) an artist's streaming-profile ids for DistroKid pinning. Empty
// string clears the field (reverts to "new artist" on the next release).
export const setStreamingIds = mutation({
  args: {
    slug: v.string(),
    spotifyArtistId: v.optional(v.string()),
    appleArtistId: v.optional(v.string()),
  },
  handler: async (ctx, { slug, spotifyArtistId, appleArtistId }) => {
    const a = await ctx.db.query("artists").withIndex("by_slug", (q) => q.eq("slug", slug)).first();
    if (!a) throw new Error(`artist ${slug} not found`);
    await ctx.db.patch(a._id, {
      spotifyArtistId: spotifyArtistId ? spotifyArtistId : undefined,
      appleArtistId: appleArtistId ? appleArtistId : undefined,
    });
    return a._id;
  },
});

// Flag an artist as having a live DistroKid release (set after a successful
// submit) so the UI can prompt for streaming-profile ids once stores ingest.
export const markDistrokidReleased = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const a = await ctx.db.query("artists").withIndex("by_slug", (q) => q.eq("slug", slug)).first();
    if (a && !a.distrokidReleased) await ctx.db.patch(a._id, { distrokidReleased: true });
  },
});
