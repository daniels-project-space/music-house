/**
 * Thin wrapper that turns whatever we know about a track (an existing store URL,
 * an ISRC, or just artist + title) into the storeLinks object the funnel page and
 * Convex `albums.setStoreLinks` mutation expect.
 *
 * Backed by the Music Video pipeline's Odesli/Deezer/Spotify/iTunes resolver
 * (`resolveLinks`), so there is no new third-party dependency. Runs in the Trigger
 * env (or a one-off script) where vault secrets are reachable. Never throws — a
 * brand-new release that stores have not indexed yet simply returns {}.
 *
 * NOTE: relative import (not the `@/` alias) so this stays bundler-safe when pulled
 * into a Trigger.dev task — same convention the other src/trigger imports follow.
 */
import { resolveLinks } from "../music-video/links";

export type StoreLinks = {
  universal?: string;
  spotify?: string;
  appleMusic?: string;
  youtube?: string;
  youtubeMusic?: string;
  deezer?: string;
};

export type ResolveReleaseInput = {
  isrc?: string | null;
  seedUrl?: string | null;
  artist?: string | null;
  title?: string | null;
};

/** Resolve a release's streaming-store links from any known seed. */
export async function resolveReleaseLinks(input: ResolveReleaseInput): Promise<StoreLinks> {
  let resolved;
  try {
    resolved = await resolveLinks({
      isrc: input.isrc ?? null,
      seedUrl: input.seedUrl ?? null,
      artist: input.artist ?? null,
      title: input.title ?? null,
    });
  } catch {
    return {};
  }

  const out: StoreLinks = {};
  if (resolved.universal) out.universal = resolved.universal;
  const p = resolved.byPlatform;
  if (p.spotify) out.spotify = p.spotify;
  if (p.appleMusic) out.appleMusic = p.appleMusic;
  if (p.youtube) out.youtube = p.youtube;
  if (p.youtubeMusic) out.youtubeMusic = p.youtubeMusic;
  if (p.deezer) out.deezer = p.deezer;
  return out;
}

/** Whether a resolved link set has anything worth funnelling to. */
export function hasAnyStoreLink(links: StoreLinks): boolean {
  return Boolean(
    links.universal ||
      links.spotify ||
      links.appleMusic ||
      links.youtube ||
      links.youtubeMusic ||
      links.deezer,
  );
}
