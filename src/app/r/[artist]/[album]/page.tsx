/**
 * Public, indexable funnel page for a release: /r/{artist}/{album}.
 *
 * Unlike the free-stream /share pages (client-rendered, noindex, full audio), this
 * is a server component built for SEO — SSR metadata, MusicAlbum JSON-LD, and
 * "Listen on …" buttons that drive traffic OUT to the paid stores. No audio player.
 *
 * It is only published once the release has resolved storeLinks (see the distribute
 * hook / backfill script); without them there is nothing to funnel to, so the page
 * 404s rather than letting Google index thin, linkless content.
 */
import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";

export const dynamic = "force-dynamic";

const LISTEN_BASE = (
  process.env.NEXT_PUBLIC_LISTEN_BASE_URL ?? "https://mh-listen.vercel.app"
).replace(/\/+$/, "");

type Params = { artist: string; album: string };
type Release = NonNullable<Awaited<ReturnType<typeof loadRelease>>>;

// One Convex fetch per request, shared by generateMetadata and the page body.
const loadRelease = cache(async (artist: string, album: string) => {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;
  const convex = new ConvexHttpClient(url);
  try {
    return await convex.query(api.albums.getRelease, { artistSlug: artist, slug: album });
  } catch {
    return null;
  }
});

function coverProxyUrl(coverKey?: string): string | undefined {
  return coverKey ? `${LISTEN_BASE}/api/cover?key=${encodeURIComponent(coverKey)}` : undefined;
}

function releaseUrl(artist: string, album: string): string {
  return `${LISTEN_BASE}/r/${artist}/${album}`;
}

function hasUsableStoreLinks(links?: Release["album"]["storeLinks"]): boolean {
  if (!links) return false;
  return Boolean(
    links.universal ||
      links.spotify ||
      links.appleMusic ||
      links.youtube ||
      links.youtubeMusic ||
      links.deezer,
  );
}

function artistName(rel: Release): string {
  return rel.artist?.name ?? rel.album.artistSlug;
}

function descriptionFor(rel: Release): string {
  const desc = rel.album.description?.trim();
  if (desc) return desc;
  const where = "Spotify, Apple Music, YouTube and more";
  return `${rel.album.name} by ${artistName(rel)} — listen now on ${where}.`;
}

function releaseYear(rel: Release): number | undefined {
  const ts = rel.album.completedAt ?? rel.album.createdAt;
  return ts ? new Date(ts).getUTCFullYear() : undefined;
}

/** Seconds -> ISO-8601 duration (e.g. 215 -> "PT3M35S"). */
function isoDuration(seconds?: number): string | undefined {
  if (!seconds || seconds <= 0) return undefined;
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `PT${m}M${s}S`;
}

const STORES: { key: keyof NonNullable<Release["album"]["storeLinks"]>; label: string }[] = [
  { key: "spotify", label: "Spotify" },
  { key: "appleMusic", label: "Apple Music" },
  { key: "youtubeMusic", label: "YouTube Music" },
  { key: "youtube", label: "YouTube" },
  { key: "deezer", label: "Deezer" },
];

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { artist, album } = await params;
  const rel = await loadRelease(artist, album);
  if (!rel || !hasUsableStoreLinks(rel.album.storeLinks)) {
    return { title: "Not found", robots: { index: false, follow: false } };
  }
  const title = `${rel.album.name} — ${artistName(rel)} | Listen`;
  const description = descriptionFor(rel);
  const canonical = releaseUrl(artist, album);
  const image = coverProxyUrl(rel.album.coverKey);

  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: {
      type: "music.album",
      title,
      description,
      url: canonical,
      siteName: "Music House",
      images: image ? [{ url: image, width: 1200, height: 1200, alt: rel.album.name }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function ReleaseFunnelPage({ params }: { params: Promise<Params> }) {
  const { artist, album } = await params;
  const rel = await loadRelease(artist, album);
  if (!rel || !hasUsableStoreLinks(rel.album.storeLinks)) notFound();

  const links = rel.album.storeLinks!;
  const cover = coverProxyUrl(rel.album.coverKey);
  const name = rel.album.name;
  const aName = artistName(rel);
  const year = releaseYear(rel);
  const canonical = releaseUrl(artist, album);
  const tracks = rel.tracks.filter((t) => !t.archivedAt);
  const buttons = STORES.filter((s) => links[s.key]);

  // ── JSON-LD: MusicAlbum with byArtist, image, track[], sameAs(store links) ──
  const sameAs = [
    links.spotify,
    links.appleMusic,
    links.youtube,
    links.youtubeMusic,
    links.deezer,
    links.universal,
  ].filter(Boolean) as string[];

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "MusicAlbum",
    name,
    url: canonical,
    byArtist: { "@type": "MusicGroup", name: aName },
    ...(cover ? { image: cover } : {}),
    ...(rel.album.genre ? { genre: rel.album.genre } : {}),
    ...(rel.album.description ? { description: rel.album.description } : {}),
    datePublished: new Date(rel.album.completedAt ?? rel.album.createdAt).toISOString(),
    numTracks: tracks.length,
    ...(sameAs.length ? { sameAs } : {}),
    track: tracks.map((t, i) => {
      const rec: Record<string, unknown> = {
        "@type": "MusicRecording",
        name: t.title,
        position: t.trackNum ?? i + 1,
        byArtist: { "@type": "MusicGroup", name: aName },
      };
      const dur = isoDuration(t.duration);
      if (dur) rec.duration = dur;
      if (t.isrc) rec.isrcCode = t.isrc;
      const text = (t.lyrics ?? [])
        .filter((l) => !l.isSection && l.text.trim())
        .map((l) => l.text)
        .join("\n");
      if (text) rec.lyrics = { "@type": "Lyrics", text };
      return rec;
    }),
  };

  return (
    <main className="min-h-screen pb-24">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Hero */}
      <div className="relative">
        <div
          className="absolute inset-0 -z-10 opacity-40 blur-3xl"
          style={
            cover
              ? { backgroundImage: `url(${cover})`, backgroundSize: "cover", backgroundPosition: "center" }
              : undefined
          }
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-bg2/60 via-bg/80 to-bg" />
        <div className="px-4 sm:px-10 lg:px-16 pt-10 sm:pt-16 pb-8 max-w-5xl mx-auto flex flex-col sm:flex-row gap-6 sm:gap-8 items-center sm:items-end">
          <div
            className="w-44 h-44 sm:w-56 sm:h-56 rounded-lg overflow-hidden ring-1 ring-paper/10 bg-paper/[0.04] shrink-0"
            style={{ boxShadow: "0 24px 60px rgba(0,0,0,0.45)" }}
          >
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cover} alt={`${name} cover`} className="w-full h-full object-cover" width={224} height={224} />
            ) : (
              <div className="w-full h-full grid place-items-center text-5xl text-t4">♪</div>
            )}
          </div>
          <div className="flex-1 min-w-0 text-center sm:text-left">
            <p className="font-mono text-[0.55rem] uppercase tracking-[0.2em] text-paper-faint mb-2">Album</p>
            <h1 className="font-display text-3xl sm:text-5xl font-bold tracking-tight text-paper leading-tight mb-2 sm:mb-3">
              {name}
            </h1>
            <p className="font-display text-[1rem] text-paper-dim mb-1">{aName}</p>
            <p className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-paper-faint">
              {tracks.length} {tracks.length === 1 ? "track" : "tracks"}
              {rel.album.genre ? ` · ${rel.album.genre}` : ""}
              {year ? ` · ${year}` : ""}
            </p>
            <p className="font-display text-[0.85rem] text-paper-dim mt-4 max-w-xl">{descriptionFor(rel)}</p>
          </div>
        </div>
      </div>

      {/* Store buttons — the funnel */}
      <div className="px-4 sm:px-10 lg:px-16 max-w-3xl mx-auto mt-2">
        <h2 className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-paper-faint mb-3">Listen on</h2>
        <div className="flex flex-wrap gap-2.5">
          {buttons.map((s) => (
            <a
              key={s.key}
              href={links[s.key]}
              target="_blank"
              rel="noopener"
              className="px-4 py-2.5 rounded-full text-[0.8rem] font-display font-medium text-paper bg-paper/[0.06] ring-1 ring-paper/10 hover:bg-purple/30 hover:ring-purple/40 transition-colors"
            >
              {s.label} ↗
            </a>
          ))}
          {links.universal ? (
            <a
              href={links.universal}
              target="_blank"
              rel="noopener"
              className="px-4 py-2.5 rounded-full text-[0.8rem] font-display font-medium text-paper"
              style={{ background: "linear-gradient(135deg, #ec4899, #8b5cf6)" }}
            >
              All platforms ↗
            </a>
          ) : null}
        </div>
      </div>

      {/* Tracklist */}
      <div className="px-4 sm:px-10 lg:px-16 max-w-3xl mx-auto mt-10">
        <h2 className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-paper-faint mb-3">Tracklist</h2>
        <ol className="rounded-md border border-brd/40 bg-card/30 backdrop-blur divide-y divide-brd/30">
          {tracks.map((t, i) => (
            <li key={t._id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="w-6 font-mono text-[0.6rem] text-paper-faint text-right tabular-nums">
                {t.trackNum ?? i + 1}
              </span>
              <span className="flex-1 min-w-0 font-display text-[0.9rem] text-paper truncate">{t.title}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Lyrics (crawlable SEO content) */}
      {tracks.some((t) => (t.lyrics ?? []).some((l) => !l.isSection && l.text.trim())) ? (
        <div className="px-4 sm:px-10 lg:px-16 max-w-3xl mx-auto mt-12">
          <h2 className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-paper-faint mb-4">Lyrics</h2>
          <div className="space-y-8">
            {tracks.map((t) => {
              const text = (t.lyrics ?? []).filter((l) => !l.isSection && l.text.trim());
              if (!text.length) return null;
              return (
                <section key={t._id}>
                  <h3 className="font-display text-[0.95rem] text-paper mb-2">{t.title}</h3>
                  <p className="font-display text-[0.82rem] leading-relaxed text-paper-dim whitespace-pre-line">
                    {text.map((l) => l.text).join("\n")}
                  </p>
                </section>
              );
            })}
          </div>
        </div>
      ) : null}
    </main>
  );
}
