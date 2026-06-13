/**
 * Music Video pipeline — Convex functions (standalone).
 *
 * One musicVideoJobs row per released single, created at release time with a
 * fireAt = distributedAt + 5 days. A daily Trigger.dev sweep calls `listDue`
 * and triggers the render task. These are PUBLIC functions because the Trigger
 * tasks reach Convex via ConvexHttpClient — none of them return secrets.
 */
import { query, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * Shared helper used by the distribution flow (distribution.setSubmitted) to
 * enqueue a music video when a single goes out. Idempotent per track.
 */
export async function scheduleMusicVideoForTrack(
  ctx: MutationCtx,
  trackId: Id<"tracks">,
  distributedAt?: number,
): Promise<Id<"musicVideoJobs"> | null> {
  const track = await ctx.db.get(trackId);
  if (!track) return null;
  // Only singles get a dedicated video here; album-track videos are out of scope.
  const existing = await ctx.db
    .query("musicVideoJobs")
    .withIndex("by_track", (q) => q.eq("trackId", trackId))
    .first();
  if (existing) return existing._id;

  const now = Date.now();
  return ctx.db.insert("musicVideoJobs", {
    trackId,
    artistSlug: track.artistSlug,
    albumSlug: track.albumSlug,
    status: "scheduled",
    fireAt: (distributedAt ?? now) + FIVE_DAYS_MS,
    createdAt: now,
    updatedAt: now,
  });
}

/** Manual / script entry point to (re)schedule a track's video. */
export const scheduleForTrack = mutation({
  args: {
    trackId: v.id("tracks"),
    fireAt: v.optional(v.number()),
    fireNow: v.optional(v.boolean()),
  },
  handler: async (ctx, { trackId, fireAt, fireNow }) => {
    const existing = await ctx.db
      .query("musicVideoJobs")
      .withIndex("by_track", (q) => q.eq("trackId", trackId))
      .first();
    const now = Date.now();
    const targetFire = fireNow ? now : fireAt ?? now + FIVE_DAYS_MS;
    if (existing) {
      await ctx.db.patch(existing._id, { status: "scheduled", fireAt: targetFire, updatedAt: now, error: undefined });
      return existing._id;
    }
    const track = await ctx.db.get(trackId);
    return ctx.db.insert("musicVideoJobs", {
      trackId,
      artistSlug: track?.artistSlug,
      albumSlug: track?.albumSlug,
      status: "scheduled",
      fireAt: targetFire,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Jobs whose +5d timer is due (status scheduled, fireAt <= now). */
export const listDue = query({
  args: { now: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, { now, limit }) => {
    const cutoff = now ?? Date.now();
    const rows = await ctx.db
      .query("musicVideoJobs")
      .withIndex("by_status_fireAt", (q) => q.eq("status", "scheduled").lte("fireAt", cutoff))
      .take(limit ?? 25);
    return rows.map((r) => ({ jobId: r._id, trackId: r.trackId, fireAt: r.fireAt }));
  },
});

export const getJob = query({
  args: { jobId: v.id("musicVideoJobs") },
  handler: async (ctx, { jobId }) => ctx.db.get(jobId),
});

/** Recent music-video jobs for the dashboard, joined with track + artist name.
 *  Reactive — the /videos page live-updates as jobs progress. */
export const listJobs = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db.query("musicVideoJobs").order("desc").take(limit ?? 50);
    return Promise.all(
      rows.map(async (r) => {
        const track = await ctx.db.get(r.trackId);
        const artist = track
          ? await ctx.db
              .query("artists")
              .withIndex("by_slug", (q) => q.eq("slug", track.artistSlug))
              .first()
          : null;
        return {
          jobId: r._id,
          status: r.status,
          progress: r.progress ?? null,
          error: r.error ?? null,
          title: track?.title ?? "(unknown track)",
          artist: artist?.name ?? track?.artistSlug ?? "",
          videoKey: r.videoKey ?? null,
          previewUrl: r.previewUrl ?? null,
          youtubeUrl: r.youtubeUrl ?? null,
          alignMethod: r.alignMethod ?? null,
          fireAt: r.fireAt,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        };
      }),
    );
  },
});

/**
 * Everything the render task needs for one job: the track + resolved
 * artist/album names + best cover key. No secrets.
 */
export const getRenderInputs = query({
  args: { jobId: v.id("musicVideoJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    const track = await ctx.db.get(job.trackId);
    if (!track) return null;

    const artist = await ctx.db
      .query("artists")
      .withIndex("by_slug", (q) => q.eq("slug", track.artistSlug))
      .first();

    let album = null;
    if (track.albumSlug) {
      album = await ctx.db
        .query("albums")
        .withIndex("by_artist_and_slug", (q) =>
          q.eq("artistSlug", track.artistSlug).eq("slug", track.albumSlug as string),
        )
        .first();
    }

    const coverKey = track.coverKey ?? album?.coverKey ?? artist?.coverKey ?? null;

    return {
      jobId: job._id,
      status: job.status,
      track: {
        id: track._id,
        title: track.title,
        genre: track.genre ?? album?.genre ?? null,
        audioKey: track.audioKey,
        coverKey,
        durationSec: track.duration ?? null,
        isrc: track.isrc ?? null,
        lyrics: track.lyrics ?? [],
        isAi: track.aiDisclosure?.isAi ?? track.generator !== "import",
      },
      artistName: artist?.name ?? track.artistSlug,
      albumName: album?.name ?? null,
    };
  },
});

/** Backfill an ISRC onto a track (used to wire "A Dying Art" for the demo).
 *  Links resolve from the ISRC alone via Deezer's public lookup. */
export const setTrackIsrc = mutation({
  args: { trackId: v.id("tracks"), isrc: v.string() },
  handler: async (ctx, { trackId, isrc }) => {
    await ctx.db.patch(trackId, { isrc });
    return { ok: true };
  },
});

/** Patch a job's status + any produced fields. Called by the Trigger tasks. */
export const markStatus = mutation({
  args: {
    jobId: v.id("musicVideoJobs"),
    status: v.optional(
      v.union(
        v.literal("scheduled"),
        v.literal("rendering"),
        v.literal("rendered"),
        v.literal("uploading"),
        v.literal("published"),
        v.literal("held"),
        v.literal("failed"),
      ),
    ),
    progress: v.optional(v.string()),
    error: v.optional(v.string()),
    triggerRunId: v.optional(v.string()),
    videoKey: v.optional(v.string()),
    previewUrl: v.optional(v.string()),
    youtubeVideoId: v.optional(v.string()),
    youtubeUrl: v.optional(v.string()),
    linksJson: v.optional(v.string()),
    timedLyricsJson: v.optional(v.string()),
    alignMethod: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, ...patch }) => {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined));
    await ctx.db.patch(jobId, { ...clean, updatedAt: Date.now() });
  },
});
