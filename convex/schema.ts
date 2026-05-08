import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  artists: defineTable({
    slug: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    genres: v.array(v.string()),
    coverKey: v.optional(v.string()),
  }).index("by_slug", ["slug"]),

  albums: defineTable({
    artistSlug: v.string(),
    slug: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    genre: v.optional(v.string()),
    coverKey: v.optional(v.string()),
    section: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_artist", ["artistSlug"])
    .index("by_artist_and_slug", ["artistSlug", "slug"]),

  tracks: defineTable({
    artistSlug: v.string(),
    albumSlug: v.optional(v.string()),
    trackNum: v.optional(v.number()),
    title: v.string(),
    duration: v.optional(v.number()),
    genre: v.optional(v.string()),
    generator: v.union(v.literal("suno"), v.literal("mureka"), v.literal("import")),
    audioKey: v.string(),
    flacKey: v.optional(v.string()),
    coverKey: v.optional(v.string()),
    lyrics: v.optional(v.array(v.object({
      text: v.string(),
      start: v.number(),
      isSection: v.boolean(),
    }))),
    clapScore: v.optional(v.number()),
    clapBestMatch: v.optional(v.string()),
    notes: v.optional(v.string()),
    rating: v.optional(v.number()),
    distributed: v.boolean(),
    distributedAt: v.optional(v.number()),
    lastDistributionJobId: v.optional(v.id("distributionJobs")),
    createdAt: v.number(),
    archivedAt: v.optional(v.number()),
  })
    .index("by_artist_album", ["artistSlug", "albumSlug"])
    .index("by_artist", ["artistSlug"])
    .index("by_generator", ["generator"]),

  hearts: defineTable({
    trackId: v.id("tracks"),
    createdAt: v.number(),
  }).index("by_track", ["trackId"]),

  playlists: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    createdAt: v.number(),
  }),

  playlistTracks: defineTable({
    playlistId: v.id("playlists"),
    trackId: v.id("tracks"),
    position: v.number(),
  })
    .index("by_playlist", ["playlistId", "position"])
    .index("by_track", ["trackId"]),

  generationJobs: defineTable({
    generator: v.union(v.literal("suno"), v.literal("mureka")),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    triggerRunId: v.optional(v.string()),
    artistSlug: v.optional(v.string()),
    albumSlug: v.optional(v.string()),
    prompt: v.string(),
    lyrics: v.optional(v.string()),
    referenceUrl: v.optional(v.string()),
    config: v.any(),
    resultTrackIds: v.optional(v.array(v.id("tracks"))),
    error: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_trigger_run", ["triggerRunId"]),

  distributionJobs: defineTable({
    trackId: v.id("tracks"),
    distributor: v.literal("routenote"),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("draft_ready"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    triggerRunId: v.optional(v.string()),
    browserbaseSessionId: v.optional(v.string()),
    liveViewUrl: v.optional(v.string()),
    releaseUrl: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_track", ["trackId"])
    .index("by_status", ["status"])
    .index("by_trigger_run", ["triggerRunId"]),
});
