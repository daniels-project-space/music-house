/**
 * Pre-distribution metadata-quality gate.
 *
 * Conservative by design — it must never break the live pipeline. The ONLY hard
 * failure is a complete absence of genre (DistroKid requires one anyway, and the
 * release would be rejected downstream regardless). Missing album description or
 * cover are reported as soft flags for logging, not blockers.
 */

export type TrackMeta = {
  genre?: string | null;
  title?: string | null;
};

export type AlbumMeta = {
  genre?: string | null;
  description?: string | null;
  coverKey?: string | null;
} | null | undefined;

export type MetadataReport = {
  /** false only when a hard requirement is missing (blocks distribution). */
  ok: boolean;
  /** every missing field (hard + soft), for human-readable messages. */
  missing: string[];
  /** fields that block distribution. */
  hardMissing: string[];
  /** fields that are merely recommended (logged, never blocks). */
  softMissing: string[];
};

function blank(s: string | null | undefined): boolean {
  return !s || !s.trim();
}

export function validateReleaseMetadata(track: TrackMeta, album: AlbumMeta): MetadataReport {
  const hardMissing: string[] = [];
  const softMissing: string[] = [];

  // Effective genre: a track genre, or the album genre as a fallback. Block only
  // when neither exists — many tracks carry the genre on the album, not the row.
  const effectiveGenre = !blank(track.genre) ? track.genre : album?.genre;
  if (blank(effectiveGenre)) hardMissing.push("genre");

  // Soft recommendations — improve the funnel page's SEO but don't gate release.
  if (blank(album?.description)) softMissing.push("album.description");
  if (blank(album?.coverKey)) softMissing.push("album.coverKey");

  return {
    ok: hardMissing.length === 0,
    missing: [...hardMissing, ...softMissing],
    hardMissing,
    softMissing,
  };
}
