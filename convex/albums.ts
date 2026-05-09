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

export const rename = mutation({
  args: { id: v.id("albums"), name: v.string() },
  handler: async (ctx, { id, name }) => {
    const n = name.trim();
    if (!n) throw new Error("name required");
    await ctx.db.patch(id, { name: n });
  },
});

export const setSection = mutation({
  args: { id: v.id("albums"), section: v.optional(v.string()) },
  handler: async (ctx, { id, section }) => ctx.db.patch(id, { section }),
});

export const setComplete = mutation({
  args: { id: v.id("albums"), completed: v.boolean() },
  handler: async (ctx, { id, completed }) =>
    ctx.db.patch(id, { completedAt: completed ? Date.now() : undefined }),
});

export const removeAndOrphan = mutation({
  args: { id: v.id("albums") },
  handler: async (ctx, { id }) => {
    const album = await ctx.db.get(id);
    if (!album) return;
    const tracks = await ctx.db
      .query("tracks")
      .withIndex("by_artist_album", (q) =>
        q.eq("artistSlug", album.artistSlug).eq("albumSlug", album.slug)
      )
      .collect();
    for (const t of tracks) {
      await ctx.db.patch(t._id, { albumSlug: undefined });
    }
    await ctx.db.delete(id);
  },
});

export const remove = mutation({
  args: { id: v.id("albums") },
  handler: async (ctx, { id }) => ctx.db.delete(id),
});

export const reassignArtist = mutation({
  args: { id: v.id("albums"), newArtistSlug: v.string() },
  handler: async (ctx, { id, newArtistSlug }) => {
    const album = await ctx.db.get(id);
    if (!album) throw new Error("album not found");
    const oldArtist = album.artistSlug;
    const albumSlug = album.slug;
    if (oldArtist === newArtistSlug) return id;
    const tracks = await ctx.db
      .query("tracks")
      .withIndex("by_artist_album", (q) =>
        q.eq("artistSlug", oldArtist).eq("albumSlug", albumSlug),
      )
      .collect();
    for (const t of tracks) {
      await ctx.db.patch(t._id, { artistSlug: newArtistSlug });
    }
    await ctx.db.patch(id, { artistSlug: newArtistSlug });
    return id;
  },
});

export const setMeta = mutation({
  args: {
    id: v.id("albums"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    genre: v.optional(v.string()),
    section: v.optional(v.string()),
    coverKey: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const album = await ctx.db.get(id);
    if (!album) throw new Error("album not found");
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) fields[k] = v;
    }
    if (Object.keys(fields).length > 0) await ctx.db.patch(id, fields);
    return id;
  },
});
