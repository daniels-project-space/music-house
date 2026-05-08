import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const create = mutation({
  args: { trackId: v.id("tracks") },
  handler: async (ctx, { trackId }) => {
    const id = await ctx.db.insert("distributionJobs", {
      trackId,
      distributor: "routenote",
      status: "pending",
      createdAt: Date.now(),
    });
    await ctx.db.patch(trackId, { lastDistributionJobId: id });
    return id;
  },
});

export const setRunning = mutation({
  args: {
    id: v.id("distributionJobs"),
    triggerRunId: v.optional(v.string()),
  },
  handler: async (ctx, { id, triggerRunId }) =>
    ctx.db.patch(id, { status: "running", triggerRunId }),
});

export const setDraftReady = mutation({
  args: {
    id: v.id("distributionJobs"),
    browserbaseSessionId: v.string(),
    liveViewUrl: v.string(),
  },
  handler: async (ctx, { id, browserbaseSessionId, liveViewUrl }) =>
    ctx.db.patch(id, {
      status: "draft_ready",
      browserbaseSessionId,
      liveViewUrl,
    }),
});

export const setLiveView = mutation({
  args: {
    id: v.id("distributionJobs"),
    browserbaseSessionId: v.string(),
    liveViewUrl: v.string(),
  },
  handler: async (ctx, { id, browserbaseSessionId, liveViewUrl }) =>
    ctx.db.patch(id, { browserbaseSessionId, liveViewUrl }),
});

export const setComplete = mutation({
  args: {
    id: v.id("distributionJobs"),
    releaseUrl: v.optional(v.string()),
  },
  handler: async (ctx, { id, releaseUrl }) => {
    const job = await ctx.db.get(id);
    if (!job) return;
    await ctx.db.patch(id, {
      status: "complete",
      releaseUrl,
      completedAt: Date.now(),
    });
    await ctx.db.patch(job.trackId, {
      distributed: true,
      distributedAt: Date.now(),
    });
  },
});

export const setFailed = mutation({
  args: { id: v.id("distributionJobs"), error: v.string() },
  handler: async (ctx, { id, error }) =>
    ctx.db.patch(id, { status: "failed", error, completedAt: Date.now() }),
});

export const get = query({
  args: { id: v.id("distributionJobs") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const byTrack = query({
  args: { trackId: v.id("tracks") },
  handler: async (ctx, { trackId }) =>
    ctx.db
      .query("distributionJobs")
      .withIndex("by_track", (q) => q.eq("trackId", trackId))
      .order("desc")
      .first(),
});

export const listAll = query({
  args: {},
  handler: async (ctx) => ctx.db.query("distributionJobs").order("desc").collect(),
});

export const findByTriggerRun = query({
  args: { triggerRunId: v.string() },
  handler: async (ctx, { triggerRunId }) =>
    ctx.db
      .query("distributionJobs")
      .withIndex("by_trigger_run", (q) => q.eq("triggerRunId", triggerRunId))
      .first(),
});
