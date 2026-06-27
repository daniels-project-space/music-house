/**
 * Resolve + persist streaming-store links for already-released albums so their
 * public funnel page (/r/{artist}/{album}) can link out to the stores. Mirrors the
 * post-submit hook in the distribute tasks, for releases that went live before the
 * hook existed (e.g. "A Dying Art").
 *
 *   npx tsx scripts/backfill-store-links.ts                          # default: A Dying Art
 *   npx tsx scripts/backfill-store-links.ts --artist x --album y     # one album
 *   npx tsx scripts/backfill-store-links.ts --all                    # every album with a seed
 *   npx tsx scripts/backfill-store-links.ts --dry                    # resolve + print, no write
 *
 * Convex URL: --convex-url, or NEXT_PUBLIC_CONVEX_URL / CONVEX_URL from .env.local.
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { resolveReleaseLinks, hasAnyStoreLink } from "../src/lib/resolve-release-links";
import { arg, convexUrl, flag, loadEnvLocal } from "./_env";

const DEFAULT_ARTIST = "the-dollcat-club";
const DEFAULT_ALBUM = "a-dying-art";

function humanize(slug: string): string {
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

async function backfillAlbum(
  convex: ConvexHttpClient,
  artistSlug: string,
  slug: string,
): Promise<boolean> {
  const tracks = await convex.query(api.tracks.list, { artistSlug, albumSlug: slug });
  if (!tracks.length) {
    console.log(`  ${artistSlug}/${slug}: no tracks — skipped`);
    return false;
  }
  // Prefer a track that already carries a store seed (ISRC or seedUrl).
  const seed = tracks.find((t) => t.isrc || t.seedUrl) ?? tracks[0];
  const links = await resolveReleaseLinks({
    isrc: seed.isrc,
    seedUrl: seed.seedUrl,
    artist: humanize(artistSlug),
    title: seed.title,
  });
  if (!hasAnyStoreLink(links)) {
    console.log(`  ${artistSlug}/${slug}: no store links resolved (not indexed yet)`);
    return false;
  }
  if (flag("dry")) {
    console.log(`  ${artistSlug}/${slug} [dry]: ${JSON.stringify(links)}`);
    return true;
  }
  await convex.mutation(api.albums.setStoreLinks, { artistSlug, slug, links });
  console.log(`  ${artistSlug}/${slug}: ${Object.keys(links).join(", ")}`);
  return true;
}

(async () => {
  loadEnvLocal();
  const convex = new ConvexHttpClient(convexUrl());

  if (flag("all")) {
    const albums = await convex.query(api.albums.list, {});
    let n = 0;
    for (const a of albums) {
      if (await backfillAlbum(convex, a.artistSlug, a.slug)) n++;
    }
    console.log(`Done — ${n}/${albums.length} albums now have store links.`);
  } else {
    const artistSlug = arg("artist") ?? DEFAULT_ARTIST;
    const slug = arg("album") ?? DEFAULT_ALBUM;
    const ok = await backfillAlbum(convex, artistSlug, slug);
    console.log(ok ? "Done." : "No links stored.");
  }
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
