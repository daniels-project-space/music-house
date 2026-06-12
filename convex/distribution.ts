import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

export const createSingle = mutation({
  args: {
    trackId: v.id("tracks"),
    distributor: v.optional(v.union(v.literal("routenote"), v.literal("distrokid"))),
  },
  handler: async (ctx, { trackId, distributor }) => {
    const id = await ctx.db.insert("distributionJobs", {
      trackId,
      releaseType: "single",
      distributor: distributor ?? "routenote",
      status: "pending",
      createdAt: Date.now(),
    });
    await ctx.db.patch(trackId, { lastDistributionJobId: id });
    return id;
  },
});

export const createAlbum = mutation({
  args: { albumId: v.id("albums") },
  handler: async (ctx, { albumId }) => {
    const album = await ctx.db.get(albumId);
    if (!album) throw new Error("album not found");
    const tracks = await ctx.db
      .query("tracks")
      .withIndex("by_artist_album", (q) =>
        q.eq("artistSlug", album.artistSlug).eq("albumSlug", album.slug),
      )
      .collect();
    const live = tracks.filter((t) => !t.archivedAt).sort((a, b) => (a.trackNum ?? 0) - (b.trackNum ?? 0));
    if (live.length === 0) throw new Error("album has no tracks");
    if (live.length > 15) throw new Error(`album has ${live.length} tracks; RouteNote allows max 15`);
    const id = await ctx.db.insert("distributionJobs", {
      trackId: live[0]._id,
      albumId,
      releaseType: "album",
      distributor: "routenote",
      status: "pending",
      createdAt: Date.now(),
    });
    for (const t of live) await ctx.db.patch(t._id, { lastDistributionJobId: id });
    return id;
  },
});

// Backwards-compat: old API route uses `create({ trackId })` for singles.
export const create = mutation({
  args: { trackId: v.id("tracks") },
  handler: async (ctx, { trackId }) => {
    const id = await ctx.db.insert("distributionJobs", {
      trackId,
      releaseType: "single",
      distributor: "routenote",
      status: "pending",
      createdAt: Date.now(),
    });
    await ctx.db.patch(trackId, { lastDistributionJobId: id });
    return id;
  },
});

export const setRunning = mutation({
  args: { id: v.id("distributionJobs"), triggerRunId: v.optional(v.string()) },
  handler: async (ctx, { id, triggerRunId }) =>
    ctx.db.patch(id, { status: "running", triggerRunId }),
});

export const setUpc = mutation({
  args: { id: v.id("distributionJobs"), upc: v.string() },
  handler: async (ctx, { id, upc }) => {
    const job = await ctx.db.get(id);
    // RouteNote derives a live edit URL from the UPC. For DistroKid the UPC is
    // NOT a route key, so don't overwrite the DK release URL that
    // setSubmitted/setDraftReady already set — just record the UPC.
    if (job?.distributor === "distrokid") {
      await ctx.db.patch(id, { upc });
      return;
    }
    const liveViewUrl = `https://www.routenote.com/rn/edit_album/${upc}`;
    await ctx.db.patch(id, { upc, liveViewUrl });
  },
});

export const setDraftReady = mutation({
  args: {
    id: v.id("distributionJobs"),
    browserbaseSessionId: v.optional(v.string()),
    liveViewUrl: v.optional(v.string()),
  },
  handler: async (ctx, { id, browserbaseSessionId, liveViewUrl }) => {
    const patch: Partial<Doc<"distributionJobs">> = { status: "draft_ready" };
    if (browserbaseSessionId !== undefined) patch.browserbaseSessionId = browserbaseSessionId;
    if (liveViewUrl !== undefined) patch.liveViewUrl = liveViewUrl;
    await ctx.db.patch(id, patch);
  },
});

export const setSubmitted = mutation({
  args: { id: v.id("distributionJobs"), releaseUrl: v.optional(v.string()) },
  handler: async (ctx, { id, releaseUrl }) => {
    const job = await ctx.db.get(id);
    if (!job) return;
    await ctx.db.patch(id, {
      status: "submitted",
      releaseUrl,
      completedAt: Date.now(),
    });
    if (job.releaseType === "album" && job.albumId) {
      const album = await ctx.db.get(job.albumId);
      if (album) {
        const tracks = await ctx.db
          .query("tracks")
          .withIndex("by_artist_album", (q) =>
            q.eq("artistSlug", album.artistSlug).eq("albumSlug", album.slug),
          )
          .collect();
        for (const t of tracks) {
          if (!t.archivedAt) {
            await ctx.db.patch(t._id, { distributed: true, distributedAt: Date.now() });
          }
        }
      }
    } else {
      await ctx.db.patch(job.trackId, { distributed: true, distributedAt: Date.now() });
    }
  },
});

// Legacy alias — the old task path called this once draft was ready.
export const setComplete = setSubmitted;

export const setFailed = mutation({
  args: { id: v.id("distributionJobs"), error: v.string() },
  handler: async (ctx, { id, error }) =>
    ctx.db.patch(id, { status: "failed", error, completedAt: Date.now() }),
});

export const setProgress = mutation({
  args: { id: v.id("distributionJobs"), progress: v.string() },
  handler: async (ctx, { id, progress }) => ctx.db.patch(id, { progress }),
});

// Store pasted distributor session cookies (RouteNote or DistroKid) into
// distributorAuth. Upserts by distributor, mirroring distributorAuth.save.
export const setDistributorCookies = mutation({
  args: {
    distributor: v.union(v.literal("routenote"), v.literal("distrokid")),
    cookiesJson: v.string(),
  },
  handler: async (ctx, { distributor, cookiesJson }) => {
    const existing = await ctx.db
      .query("distributorAuth")
      .withIndex("by_distributor", (q) => q.eq("distributor", distributor))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { cookiesJson, savedAt: Date.now() });
      return existing._id;
    }
    return ctx.db.insert("distributorAuth", {
      distributor,
      cookiesJson,
      savedAt: Date.now(),
    });
  },
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

export const byAlbum = query({
  args: { albumId: v.id("albums") },
  handler: async (ctx, { albumId }) =>
    ctx.db
      .query("distributionJobs")
      .withIndex("by_album", (q) => q.eq("albumId", albumId))
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
