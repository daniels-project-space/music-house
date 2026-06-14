/**
 * Streaming-link resolution for the Music Video pipeline.
 *
 * Given any one known platform URL for a release (Apple/Deezer/Spotify/Tidal),
 * resolve the full set via the public Odesli / song.link API. Called at video
 * fire-time (+5 days after release) so late-propagating stores like Spotify
 * are already indexed.
 */

export type PlatformKey =
  | "spotify"
  | "appleMusic"
  | "deezer"
  | "youtube"
  | "youtubeMusic"
  | "tidal"
  | "amazonMusic"
  | "soundcloud"
  | "pandora";

export type ResolvedLinks = {
  /** The single best "listen everywhere" URL for a description. */
  universal: string | null;
  byPlatform: Partial<Record<PlatformKey, string>>;
  /** Odesli's stable cross-platform id, if returned. */
  entityUniqueId: string | null;
};

const ODESLI = "https://api.song.link/v1-alpha.1/links";

const PLATFORM_LABELS: Record<PlatformKey, string> = {
  spotify: "Spotify",
  appleMusic: "Apple Music",
  deezer: "Deezer",
  youtube: "YouTube",
  youtubeMusic: "YouTube Music",
  tidal: "Tidal",
  amazonMusic: "Amazon Music",
  soundcloud: "SoundCloud",
  pandora: "Pandora",
};

export function platformLabel(p: PlatformKey): string {
  return PLATFORM_LABELS[p] ?? p;
}

/**
 * Resolve all platform links from one seed URL. Returns whatever Odesli knows
 * about right now; never throws on "not found" — returns the seed as a partial
 * result so the pipeline can still proceed.
 */
export async function resolveStreamingLinks(
  seedUrl: string,
  opts: { userCountry?: string } = {},
): Promise<ResolvedLinks> {
  const country = opts.userCountry ?? "US";
  const url = `${ODESLI}?url=${encodeURIComponent(seedUrl)}&userCountry=${country}`;

  let data: any;
  try {
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`Odesli ${r.status}`);
    data = await r.json();
  } catch (err) {
    // Soft-fail: keep the seed so the description still has at least one link.
    return { universal: seedUrl, byPlatform: seedToPartial(seedUrl), entityUniqueId: null };
  }

  const byPlatform: Partial<Record<PlatformKey, string>> = {};
  const links = (data?.linksByPlatform ?? {}) as Record<string, { url?: string }>;
  for (const key of Object.keys(PLATFORM_LABELS) as PlatformKey[]) {
    const u = links[key]?.url;
    if (u) byPlatform[key] = u;
  }

  const universal: string | null =
    data?.pageUrl ?? byPlatform.appleMusic ?? byPlatform.spotify ?? byPlatform.deezer ?? seedUrl;

  return {
    universal,
    byPlatform: Object.keys(byPlatform).length ? byPlatform : seedToPartial(seedUrl),
    entityUniqueId: data?.entityUniqueId ?? null,
  };
}

/**
 * Resolve links starting from just an ISRC. Deezer's public API exposes an
 * ISRC lookup with no auth (`/track/isrc:{ISRC}`); we use the resulting Deezer
 * URL as the Odesli seed. This is the auto-flow path: the only thing stored on
 * a track is its ISRC.
 */
export async function resolveByISRC(
  isrc: string,
  opts: { userCountry?: string } = {},
): Promise<ResolvedLinks> {
  try {
    const r = await fetch(`https://api.deezer.com/track/isrc:${encodeURIComponent(isrc)}`, {
      headers: { accept: "application/json" },
    });
    if (r.ok) {
      const j = (await r.json()) as { link?: string; error?: unknown };
      if (j?.link && !j.error) return resolveStreamingLinks(j.link, opts);
    }
  } catch {
    /* fall through */
  }
  return { universal: null, byPlatform: {}, entityUniqueId: null };
}

/** Find an Apple Music URL via the public iTunes Search API (no auth) — a
 *  robust fallback seed when ISRC lookup misses. */
async function seedFromITunes(artist: string, title: string): Promise<string | null> {
  try {
    const term = encodeURIComponent(`${artist} ${title}`);
    const r = await fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=8`, {
      headers: { accept: "application/json" },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { results?: Array<{ trackName?: string; trackViewUrl?: string; collectionViewUrl?: string }> };
    const tnorm = title.toLowerCase().replace(/[^a-z0-9]/g, "");
    const hit =
      (j.results ?? []).find((x) => (x.trackName ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").includes(tnorm)) ??
      (j.results ?? [])[0];
    return hit?.trackViewUrl ?? hit?.collectionViewUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * Robustly resolve all-platform links, trying several seed routes in order and
 * returning the first that yields real platform links. Always works as long as
 * the song is indexed on at least one of: a known store URL, Deezer (by ISRC),
 * or Apple Music (by artist+title search).
 */
export async function resolveLinks(
  input: { isrc?: string | null; seedUrl?: string | null; artist?: string | null; title?: string | null },
  opts: { userCountry?: string } = {},
): Promise<ResolvedLinks> {
  // Gather every seed we can, then MERGE Odesli results across all of them so
  // the description lists EVERY platform the song is live on — even when one
  // store's Odesli entity does not cross-link to another's.
  const seeds: string[] = [];
  if (input.seedUrl) seeds.push(input.seedUrl);
  if (input.isrc) {
    try {
      const r = await fetch(`https://api.deezer.com/track/isrc:${encodeURIComponent(input.isrc)}`, {
        headers: { accept: "application/json" },
      });
      if (r.ok) {
        const j = (await r.json()) as { link?: string; error?: unknown };
        if (j?.link && !j.error) seeds.push(j.link);
      }
    } catch {
      /* ignore */
    }
  }
  if (input.artist && input.title) {
    const apple = await seedFromITunes(input.artist, input.title);
    if (apple) seeds.push(apple);
  }

  const merged: Partial<Record<PlatformKey, string>> = {};
  let universal: string | null = null;
  let entityUniqueId: string | null = null;
  const tried = new Set<string>();
  for (const seed of seeds) {
    if (tried.has(seed)) continue;
    tried.add(seed);
    const r = await resolveStreamingLinks(seed, opts);
    for (const [k, v] of Object.entries(r.byPlatform) as [PlatformKey, string][]) {
      if (!merged[k]) merged[k] = v;
    }
    if (!universal) universal = r.universal;
    if (!entityUniqueId) entityUniqueId = r.entityUniqueId;
  }
  return { universal, byPlatform: merged, entityUniqueId };
}

function seedToPartial(seedUrl: string): Partial<Record<PlatformKey, string>> {
  if (/spotify\.com/.test(seedUrl)) return { spotify: seedUrl };
  if (/music\.apple\.com/.test(seedUrl)) return { appleMusic: seedUrl };
  if (/deezer\.com/.test(seedUrl)) return { deezer: seedUrl };
  if (/tidal\.com/.test(seedUrl)) return { tidal: seedUrl };
  if (/music\.youtube\.com/.test(seedUrl)) return { youtubeMusic: seedUrl };
  if (/youtube\.com|youtu\.be/.test(seedUrl)) return { youtube: seedUrl };
  return {};
}
