import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("nicheBank").collect()).sort((a, b) => b.createdAt - a.createdAt),
});

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) =>
    ctx.db.query("nicheBank").withIndex("by_slug", (q) => q.eq("slug", slug)).first(),
});

// Upsert a researched niche by slug. Called by the /api/niche/research route after
// nichecraft assembles the overview.
export const upsert = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    seed: v.string(),
    primaryGenre: v.string(),
    secondaryGenre: v.optional(v.string()),
    stylePrompts: v.array(v.string()),
    themes: v.array(v.string()),
    moods: v.array(v.string()),
    instruments: v.array(v.string()),
    culturalTags: v.array(v.string()),
    referenceArtists: v.array(v.string()),
    relatedSearches: v.array(v.string()),
    bpmMin: v.optional(v.number()),
    bpmMax: v.optional(v.number()),
    keys: v.optional(v.array(v.string())),
    competition: v.optional(v.string()),
    productionNotes: v.optional(v.string()),
    overviewText: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("nicheBank")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return ctx.db.insert("nicheBank", { ...args, createdAt: Date.now() });
  },
});

export const remove = mutation({
  args: { id: v.id("nicheBank") },
  handler: async (ctx, { id }) => ctx.db.delete(id),
});
