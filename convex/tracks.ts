import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { artistSlug: v.optional(v.string()), albumSlug: v.optional(v.string()) },
  handler: async (ctx, { artistSlug, albumSlug }) => {
    if (artistSlug && albumSlug !== undefined) {
      return ctx.db
        .query("tracks")
        .withIndex("by_artist_album", (q) => q.eq("artistSlug", artistSlug).eq("albumSlug", albumSlug))
        .collect();
    }
    if (artistSlug) {
      return ctx.db
        .query("tracks")
        .withIndex("by_artist", (q) => q.eq("artistSlug", artistSlug))
        .collect();
    }
    return ctx.db.query("tracks").collect();
  },
});

export const get = query({
  args: { id: v.id("tracks") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const insert = mutation({
  args: {
    artistSlug: v.string(),
    albumSlug: v.optional(v.string()),
    trackNum: v.optional(v.number()),
    title: v.string(),
    duration: v.optional(v.number()),
    genre: v.optional(v.string()),
    generator: v.union(v.literal("suno"), v.literal("mureka"), v.literal("import")),
    audioKey: v.string(),
    flacKey: v.optional(v.string()),
    instrumentalKey: v.optional(v.string()),
    vocalKey: v.optional(v.string()),
    coverKey: v.optional(v.string()),
    lyrics: v.optional(v.array(v.object({ text: v.string(), start: v.number(), isSection: v.boolean() }))),
    clapScore: v.optional(v.number()),
    clapBestMatch: v.optional(v.string()),
    sunoTaskId: v.optional(v.string()),
    sunoAudioId: v.optional(v.string()),
    needsWavUpgrade: v.optional(v.boolean()),
    wavUpgradeAttempts: v.optional(v.number()),
    lyricAlignAttempts: v.optional(v.number()),
    seedUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    ctx.db.insert("tracks", {
      ...args,
      distributed: false,
      createdAt: Date.now(),
      needsLyricAlign: computeNeedsLyricAlign(args),
    }),
});

// Tracks saved as MP3 because Suno's WAV export was slow/stuck at generation time.
// The upgrade-wav scheduled task polls this and tries to swap in the lossless WAV.
export const needingWavUpgrade = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("tracks")
      // PERF: index the pending set instead of full-scanning the fat tracks table
      // (this runs on a poller several times/hour). Result-equivalent to the old
      // `.filter(needsWavUpgrade === true)`.
      .withIndex("by_wav_upgrade", (q) => q.eq("needsWavUpgrade", true))
      .collect();
    // Round-robin fairness: serve least-attempted first, then oldest. Without
    // this the cron's slice(0, MAX_PER_RUN) always re-hit the same first rows in
    // insertion order, so one take got hammered (24 attempts) while another sat
    // at 0. Least-attempted-first guarantees every pending track gets a turn.
    return rows.sort((a, b) => {
      const ax = a.wavUpgradeAttempts ?? 0;
      const bx = b.wavUpgradeAttempts ?? 0;
      if (ax !== bx) return ax - bx;
      return (a.createdAt ?? 0) - (b.createdAt ?? 0);
    });
  },
});

// WAV finally readied: swap audioKey to the lossless WAV and clear the flag.
export const upgradeAudioToWav = mutation({
  args: { trackId: v.id("tracks"), wavKey: v.string() },
  handler: async (ctx, { trackId, wavKey }) =>
    ctx.db.patch(trackId, { audioKey: wavKey, needsWavUpgrade: false }),
});

// WAV still not ready: record the attempt. After the cap (48 ≈ 16h at 20-min
// cadence) give up gracefully and keep the MP3 — the track stays playable.
export const bumpWavUpgradeAttempt = mutation({
  args: { trackId: v.id("tracks"), attempts: v.number() },
  handler: async (ctx, { trackId, attempts }) => {
    const patch: { wavUpgradeAttempts: number; needsWavUpgrade?: boolean } = {
      wavUpgradeAttempts: attempts,
    };
    if (attempts >= 48) patch.needsWavUpgrade = false;
    await ctx.db.patch(trackId, patch);
  },
});

// ── Karaoke lyric alignment (self-healing backfill) ──────────────────────
// Tracks that HAVE lyric lines but every line's start is 0 (the unaligned
// parseLyrics fallback) AND still carry the Suno ids needed to re-fetch
// word-level timestamps. The align-lyrics scheduled task picks these up.
// Capped via lyricAlignAttempts so we stop trying when alignment is genuinely
// unavailable (e.g. instrumental, or model/plan without timestamp support).
const LYRIC_ALIGN_ATTEMPT_CAP = 24;

// Single source of truth for the "needs karaoke alignment" predicate. The indexed
// `needsLyricAlign` flag is maintained (at insert/setLyrics/setAlignedLyrics/
// bumpLyricAlignAttempt) to equal this exactly, so the poller can read the flagged
// set via index instead of full-scanning the fat (lyrics[]) tracks table.
function computeNeedsLyricAlign(t: {
  lyrics?: { text: string; start: number; isSection: boolean }[];
  sunoTaskId?: string;
  sunoAudioId?: string;
  lyricAlignAttempts?: number;
}): boolean {
  return (
    Array.isArray(t.lyrics) &&
    t.lyrics.length > 0 &&
    t.lyrics.every((l) => (l.start ?? 0) === 0) &&
    !!t.sunoTaskId &&
    !!t.sunoAudioId &&
    (t.lyricAlignAttempts ?? 0) < LYRIC_ALIGN_ATTEMPT_CAP
  );
}

// One-time backfill of needsLyricAlign for tracks created before the flag existed.
// Idempotent — run once via `convex run tracks:backfillLyricAlign`.
export const backfillLyricAlign = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("tracks").collect();
    let updated = 0;
    for (const t of all) {
      const want = computeNeedsLyricAlign(t);
      if ((t.needsLyricAlign ?? false) !== want) {
        await ctx.db.patch(t._id, { needsLyricAlign: want });
        updated++;
      }
    }
    return { total: all.length, updated };
  },
});

export const needingLyricAlignment = query({
  args: {},
  handler: async (ctx) =>
    // PERF: index the pending set instead of full-scanning the fat tracks table
    // each hourly run. Result-equivalent to the old `.collect().filter(...)`
    // because `needsLyricAlign` === computeNeedsLyricAlign (maintained at writes).
    ctx.db
      .query("tracks")
      .withIndex("by_lyric_align", (q) => q.eq("needsLyricAlign", true))
      .collect(),
});

// Alignment succeeded: replace the lyric lines with the karaoke-ready (real
// per-line start) version and clear the attempt counter.
export const setAlignedLyrics = mutation({
  args: {
    trackId: v.id("tracks"),
    lyrics: v.array(v.object({ text: v.string(), start: v.number(), isSection: v.boolean() })),
  },
  handler: async (ctx, { trackId, lyrics }) =>
    // aligned now (real per-line starts) → clears the indexed pending flag
    ctx.db.patch(trackId, { lyrics, lyricAlignAttempts: 0, needsLyricAlign: false }),
});

// Alignment unavailable this run: record the attempt. After the cap, the
// needingLyricAlignment filter stops returning the track (give up gracefully —
// lyrics stay readable, just not karaoke-synced).
export const bumpLyricAlignAttempt = mutation({
  args: { trackId: v.id("tracks"), attempts: v.number() },
  handler: async (ctx, { trackId, attempts }) => {
    const patch: { lyricAlignAttempts: number; needsLyricAlign?: boolean } = {
      lyricAlignAttempts: attempts,
    };
    // hit the cap → give up gracefully; drop out of the indexed pending set
    if (attempts >= LYRIC_ALIGN_ATTEMPT_CAP) patch.needsLyricAlign = false;
    await ctx.db.patch(trackId, patch);
  },
});

export const setNotes = mutation({
  args: { id: v.id("tracks"), notes: v.string() },
  handler: async (ctx, { id, notes }) => ctx.db.patch(id, { notes }),
});

export const setRating = mutation({
  args: { id: v.id("tracks"), rating: v.number() },
  handler: async (ctx, { id, rating }) => ctx.db.patch(id, { rating }),
});

export const archive = mutation({
  args: { id: v.id("tracks") },
  handler: async (ctx, { id }) => ctx.db.patch(id, { archivedAt: Date.now() }),
});

export const unarchive = mutation({
  args: { id: v.id("tracks") },
  handler: async (ctx, { id }) => ctx.db.patch(id, { archivedAt: undefined }),
});

export const setLyrics = mutation({
  args: {
    id: v.id("tracks"),
    lyrics: v.array(v.object({ text: v.string(), start: v.number(), isSection: v.boolean() })),
  },
  handler: async (ctx, { id, lyrics }) => {
    const t = await ctx.db.get(id);
    const needsLyricAlign = t ? computeNeedsLyricAlign({ ...t, lyrics }) : false;
    await ctx.db.patch(id, { lyrics, needsLyricAlign });
  },
});


export const move = mutation({
  args: {
    id: v.id("tracks"),
    targetArtistSlug: v.string(),
    targetAlbumSlug: v.optional(v.string()),
    targetPosition: v.optional(v.number()),
  },
  handler: async (ctx, { id, targetArtistSlug, targetAlbumSlug, targetPosition }) => {
    const track = await ctx.db.get(id);
    if (!track) throw new Error("Track not found");
    const patch: { artistSlug: string; albumSlug?: string; trackNum?: number } = {
      artistSlug: targetArtistSlug,
      albumSlug: targetAlbumSlug,
    };
    if (typeof targetPosition === "number") patch.trackNum = targetPosition;
    await ctx.db.patch(id, patch);
  },
});

export const reorder = mutation({
  args: {
    id: v.id("tracks"),
    position: v.number(),
  },
  handler: async (ctx, { id, position }) => {
    const track = await ctx.db.get(id);
    if (!track) throw new Error("Track not found");
    const siblings = await ctx.db
      .query("tracks")
      .withIndex("by_artist_album", (q) =>
        q.eq("artistSlug", track.artistSlug).eq("albumSlug", track.albumSlug),
      )
      .collect();
    const sorted = siblings.sort((a, b) => (a.trackNum ?? 0) - (b.trackNum ?? 0));
    const without = sorted.filter((t) => t._id !== id);
    without.splice(Math.max(0, Math.min(position, without.length)), 0, track);
    for (let i = 0; i < without.length; i++) {
      await ctx.db.patch(without[i]._id, { trackNum: i + 1 });
    }
  },
});
export const rename = mutation({
  args: { id: v.id("tracks"), title: v.string() },
  handler: async (ctx, { id, title }) => {
    const t = title.trim();
    if (!t) throw new Error("title required");
    await ctx.db.patch(id, { title: t });
  },
});

export const setDistributed = mutation({
  args: { id: v.id("tracks"), distributed: v.boolean() },
  handler: async (ctx, { id, distributed }) =>
    ctx.db.patch(id, { distributed, distributedAt: distributed ? Date.now() : undefined }),
});

export const remove = mutation({
  args: { id: v.id("tracks") },
  handler: async (ctx, { id }) => ctx.db.delete(id),
});
