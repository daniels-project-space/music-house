import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  artists: defineTable({
    slug: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    genres: v.array(v.string()),
    coverKey: v.optional(v.string()),
    // DistroKid artist-identity pinning: when set, releases reuse the existing
    // streaming profile instead of telling DistroKid "new artist" every time.
    spotifyArtistId: v.optional(v.string()),
    appleArtistId: v.optional(v.string()),
    distrokidReleased: v.optional(v.boolean()),
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
    instrumentalKey: v.optional(v.string()), // cached vocals-removed stem (karaoke)
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
    // DistroKid requires AI disclosure for Suno/Mureka tracks.
    aiDisclosure: v.optional(v.object({
      isAi: v.boolean(),
      tools: v.optional(v.array(v.string())),
    })),
    isrc: v.optional(v.string()),
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
    albumId: v.optional(v.id("albums")),
    releaseType: v.optional(v.union(v.literal("single"), v.literal("album"))),
    distributor: v.union(v.literal("routenote"), v.literal("distrokid")),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("draft_ready"),
      v.literal("submitted"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    triggerRunId: v.optional(v.string()),
    browserbaseSessionId: v.optional(v.string()),
    liveViewUrl: v.optional(v.string()),
    releaseUrl: v.optional(v.string()),
    upc: v.optional(v.string()),
    // DistroKid: AI disclosure + ISRC carried on the job.
    aiDisclosure: v.optional(v.object({
      isAi: v.boolean(),
      tools: v.optional(v.array(v.string())),
    })),
    isrc: v.optional(v.string()),
    error: v.optional(v.string()),
    // Live progress line written by the distribute task (UI: In Progress column).
    progress: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_track", ["trackId"])
    .index("by_album", ["albumId"])
    .index("by_status", ["status"])
    .index("by_trigger_run", ["triggerRunId"]),

  distributorAuth: defineTable({
    distributor: v.union(v.literal("routenote"), v.literal("distrokid")),
    cookiesJson: v.string(),
    savedAt: v.number(),
  }).index("by_distributor", ["distributor"]),

  // Latest analytics snapshot per distributor (streams + bank balance),
  // written by the distrokid-analytics Trigger task (upsert, one row each).
  distributorAnalytics: defineTable({
    distributor: v.union(v.literal("routenote"), v.literal("distrokid")),
    fetchedAt: v.number(),
    streamsTotal: v.number(),
    streamsPending: v.boolean(),
    streamsItemsJson: v.string(),
    balance: v.number(),
    currency: v.string(),
    balancePending: v.boolean(),
    message: v.optional(v.string()),
  }).index("by_distributor", ["distributor"]),

  // Append-only time series behind the streams/earnings graph (one row per
  // analytics pull — the scheduled task runs every 2 days; manual refreshes
  // within 6h of the last point update it in place instead of appending).
  distributorAnalyticsHistory: defineTable({
    distributor: v.union(v.literal("routenote"), v.literal("distrokid")),
    fetchedAt: v.number(),
    streamsTotal: v.number(),
    balance: v.number(),
    currency: v.string(),
  }).index("by_distributor_time", ["distributor", "fetchedAt"]),

  savedLyrics: defineTable({
    title: v.string(),
    vibe: v.optional(v.string()),
    theme: v.optional(v.string()),
    topic: v.optional(v.string()),
    genre: v.optional(v.string()),
    lyrics: v.string(),
    createdAt: v.number(),
  }).index("by_created", ["createdAt"]),

  // ── Music Video pipeline (standalone) ──────────────────────────────────
  // One job per released single. Created at release time (+5d fireAt), swept
  // daily by the musicVideo:fireDueJobs cron. NOT part of the distribution flow.
  musicVideoJobs: defineTable({
    trackId: v.id("tracks"),
    artistSlug: v.optional(v.string()),
    albumSlug: v.optional(v.string()),
    status: v.union(
      v.literal("scheduled"), // waiting for fireAt
      v.literal("rendering"), // resolve links → align → render
      v.literal("rendered"), // mp4 in R2, awaiting upload (gated)
      v.literal("uploading"),
      v.literal("published"), // live on YouTube
      v.literal("held"), // rendered but no channel connected yet
      v.literal("failed"),
    ),
    fireAt: v.number(), // distributedAt + 5 days
    triggerRunId: v.optional(v.string()),
    videoKey: v.optional(v.string()), // R2 key of rendered mp4
    previewUrl: v.optional(v.string()), // presigned R2 url for review
    karaokeVideoKey: v.optional(v.string()),
    karaokePreviewUrl: v.optional(v.string()),
    youtubeVideoId: v.optional(v.string()),
    youtubeUrl: v.optional(v.string()),
    linksJson: v.optional(v.string()), // ResolvedLinks JSON
    timedLyricsJson: v.optional(v.string()), // aligned TimedLine[] JSON
    alignMethod: v.optional(v.string()), // "forced" | "even"
    progress: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_track", ["trackId"])
    .index("by_status", ["status"])
    .index("by_status_fireAt", ["status", "fireAt"])
    .index("by_trigger_run", ["triggerRunId"]),
  // NOTE: the channel binding (refresh token) intentionally lives in env/vault
  // as YOUTUBE_REFRESH_TOKEN_MUSIC_HOUSE_RECORDS, never in a public Convex row.
  // Uploads are gated on that key existing.
});
