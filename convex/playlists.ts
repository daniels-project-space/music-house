import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => ctx.db.query("playlists").collect(),
});

export const create = mutation({
  args: { name: v.string(), description: v.optional(v.string()) },
  handler: async (ctx, args) => ctx.db.insert("playlists", { ...args, createdAt: Date.now() }),
});

export const rename = mutation({
  args: { id: v.id("playlists"), name: v.string() },
  handler: async (ctx, { id, name }) => ctx.db.patch(id, { name }),
});

export const remove = mutation({
  args: { id: v.id("playlists") },
  handler: async (ctx, { id }) => {
    const tracks = await ctx.db.query("playlistTracks").withIndex("by_playlist", (q) => q.eq("playlistId", id)).collect();
    for (const t of tracks) await ctx.db.delete(t._id);
    await ctx.db.delete(id);
  },
});

export const tracks = query({
  args: { playlistId: v.id("playlists") },
  handler: async (ctx, { playlistId }) =>
    ctx.db.query("playlistTracks").withIndex("by_playlist", (q) => q.eq("playlistId", playlistId)).collect(),
});

export const addTrack = mutation({
  args: { playlistId: v.id("playlists"), trackId: v.id("tracks") },
  handler: async (ctx, { playlistId, trackId }) => {
    const existing = await ctx.db.query("playlistTracks").withIndex("by_playlist", (q) => q.eq("playlistId", playlistId)).collect();
    return ctx.db.insert("playlistTracks", { playlistId, trackId, position: existing.length });
  },
});

export const removeTrack = mutation({
  args: { playlistId: v.id("playlists"), trackId: v.id("tracks") },
  handler: async (ctx, { playlistId, trackId }) => {
    const rows = await ctx.db.query("playlistTracks").withIndex("by_track", (q) => q.eq("trackId", trackId)).collect();
    for (const r of rows) if (r.playlistId === playlistId) await ctx.db.delete(r._id);
  },
});
