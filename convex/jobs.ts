import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { status: v.optional(v.union(v.literal("pending"), v.literal("running"), v.literal("complete"), v.literal("failed"))) },
  handler: async (ctx, { status }) => {
    if (status) return ctx.db.query("generationJobs").withIndex("by_status", (q) => q.eq("status", status)).collect();
    return ctx.db.query("generationJobs").collect();
  },
});

export const get = query({
  args: { id: v.id("generationJobs") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const create = mutation({
  args: {
    generator: v.union(v.literal("suno"), v.literal("mureka")),
    artistSlug: v.optional(v.string()),
    albumSlug: v.optional(v.string()),
    prompt: v.string(),
    lyrics: v.optional(v.string()),
    referenceUrl: v.optional(v.string()),
    config: v.any(),
  },
  handler: async (ctx, args) =>
    ctx.db.insert("generationJobs", { ...args, status: "pending", createdAt: Date.now() }),
});

export const setRunning = mutation({
  args: { id: v.id("generationJobs"), triggerRunId: v.optional(v.string()) },
  handler: async (ctx, { id, triggerRunId }) =>
    ctx.db.patch(id, { status: "running", triggerRunId }),
});

export const setComplete = mutation({
  args: { id: v.id("generationJobs"), resultTrackIds: v.array(v.id("tracks")) },
  handler: async (ctx, { id, resultTrackIds }) =>
    ctx.db.patch(id, { status: "complete", resultTrackIds, completedAt: Date.now() }),
});

export const setFailed = mutation({
  args: { id: v.id("generationJobs"), error: v.string() },
  handler: async (ctx, { id, error }) =>
    ctx.db.patch(id, { status: "failed", error, completedAt: Date.now() }),
});

export const findByTriggerRun = query({
  args: { triggerRunId: v.string() },
  handler: async (ctx, { triggerRunId }) =>
    ctx.db.query("generationJobs").withIndex("by_trigger_run", (q) => q.eq("triggerRunId", triggerRunId)).first(),
});
