import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) =>
    ctx.db.query("savedLyrics").withIndex("by_created").order("desc").collect(),
});

export const get = query({
  args: { id: v.id("savedLyrics") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const create = mutation({
  args: {
    title: v.string(),
    vibe: v.optional(v.string()),
    theme: v.optional(v.string()),
    topic: v.optional(v.string()),
    genre: v.optional(v.string()),
    lyrics: v.string(),
  },
  handler: async (ctx, args) =>
    ctx.db.insert("savedLyrics", { ...args, createdAt: Date.now() }),
});

export const update = mutation({
  args: {
    id: v.id("savedLyrics"),
    title: v.optional(v.string()),
    vibe: v.optional(v.string()),
    theme: v.optional(v.string()),
    topic: v.optional(v.string()),
    genre: v.optional(v.string()),
    lyrics: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) fields[k] = v;
    }
    if (Object.keys(fields).length > 0) await ctx.db.patch(id, fields);
  },
});

export const remove = mutation({
  args: { id: v.id("savedLyrics") },
  handler: async (ctx, { id }) => ctx.db.delete(id),
});
