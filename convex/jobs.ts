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
    generator: v.union(v.literal("suno"), v.literal("mureka"), v.literal("minimax")),
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

/** Persist the verified engine admission without claiming an audio result. */
export const setEngineBinding = mutation({
  args: { id: v.id("generationJobs"), binding: v.object({ jobId: v.string(), state: v.string(), manifestSha256: v.string(),
    output: v.object({ bucket: v.string(), key: v.string(), receiptKey: v.string() }) }) },
  handler: async (ctx, { id, binding }) => {
    const job = await ctx.db.get(id);
    if (!job || job.generator !== "minimax" || job.status !== "pending" || job.config?.engine) throw new Error("Music3 job binding changed");
    await ctx.db.patch(id, { config: { ...job.config, engine: binding } });
  },
});
export const syncEngineState = mutation({
  args: { id: v.id("generationJobs"), engineJobId: v.string(), state: v.string() },
  handler: async (ctx, { id, engineJobId, state }) => {
    const job = await ctx.db.get(id);
    if (!job || job.generator !== "minimax" || job.config?.engine?.jobId !== engineJobId || ["complete", "failed"].includes(job.status)) return;
    const status = state === "completed" ? "complete" : ["failed", "cancelled"].includes(state) ? "failed" :
      ["launching", "running", "shutdown-requested"].includes(state) ? "running" : "pending";
    await ctx.db.patch(id, { status, config: { ...job.config, engine: { ...job.config.engine, state } },
      ...(status === "complete" || status === "failed" ? { completedAt: Date.now() } : {}),
      ...(status === "failed" ? { error: `Music3 engine job ${state}` } : {}) });
  },
});
