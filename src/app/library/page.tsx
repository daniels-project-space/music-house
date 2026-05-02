"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { AlbumCard } from "@/components/album-card";

const SECTIONS: Array<{ key: string; label: string; icon: string; accent: string; rule: string }> = [
  { key: "film_cinematic", label: "Film & Cinematic", icon: "▲", accent: "#ef4444", rule: "rgba(239,68,68,0.35)" },
  { key: "artist_songs", label: "Artist Songs", icon: "♢", accent: "#8b5cf6", rule: "rgba(139,92,246,0.35)" },
  { key: "gaming", label: "Gaming", icon: "◎", accent: "#34d399", rule: "rgba(52,211,153,0.35)" },
];

export default function LibraryPage() {
  const albums = useQuery(api.albums.list, {}) ?? [];
  const tracks = useQuery(api.tracks.list, {}) ?? [];
  const artists = useQuery(api.artists.list, {}) ?? [];

  const tracksByAlbum = new Map<string, number>();
  for (const t of tracks) {
    const k = `${t.artistSlug}/${t.albumSlug ?? "_singles"}`;
    tracksByAlbum.set(k, (tracksByAlbum.get(k) ?? 0) + 1);
  }

  type AlbumDoc = (typeof albums)[number];
  const bySection: Record<string, AlbumDoc[]> = {};
  const unsorted: AlbumDoc[] = [];
  const sunoStaging: AlbumDoc[] = [];
  for (const a of albums) {
    if (a.artistSlug === "_suno") {
      sunoStaging.push(a);
      continue;
    }
    if (a.artistSlug === "_unsorted") {
      unsorted.push(a);
      continue;
    }
    const sec = (a as { section?: string }).section;
    if (sec && SECTIONS.some((s) => s.key === sec)) {
      (bySection[sec] ??= []).push(a);
    } else {
      unsorted.push(a);
    }
  }

  return (
    <main className="max-w-[1600px] mx-auto px-8 lg:px-12 py-12 animate-fi">
      {/* hero header */}
      <div className="mb-16 flex items-end justify-between gap-8 flex-wrap">
        <div>
          <p className="label-mono-amber">Library / 2026</p>
          <h1 className="mt-3 font-display text-[1.6rem] sm:text-[2.4rem] sm:text-[3.5rem] lg:text-[4.25rem] font-extrabold leading-[0.95] tracking-tight text-t1">
            Library<span className="text-purple/60">.</span>
          </h1>
          <p className="mt-4 max-w-xl text-[0.92rem] text-paper-dim leading-relaxed">
            Generated catalog. Browse by section, dive into an album, hit play. Drag to reorder, ⋮ for more.
          </p>
        </div>
        <div className="flex gap-5 sm:gap-8">
          <Stat n={artists.length} label="Artists" />
          <Stat n={albums.length} label="Albums" />
          <Stat n={tracks.length} label="Tracks" highlight />
        </div>
      </div>

      {/* section bands */}
      <div className="space-y-20">
        {SECTIONS.map((s) => {
          const list = bySection[s.key] ?? [];
          if (list.length === 0) return null;
          return (
            <Section key={s.key} label={s.label} icon={s.icon} accent={s.accent} rule={s.rule} count={list.length}>
              <Grid albums={list} tracksByAlbum={tracksByAlbum} />
            </Section>
          );
        })}

        {sunoStaging.length > 0 && (
          <Section
            label="Suno Staging"
            icon="◐"
            accent="#ec4899"
            rule="rgba(236,72,153,0.35)"
            count={sunoStaging.length}
          >
            <Grid albums={sunoStaging} tracksByAlbum={tracksByAlbum} />
          </Section>
        )}

        {unsorted.length > 0 && (
          <Section
            label="Unsorted"
            icon="◯"
            accent="#fbbf24"
            rule="rgba(251,191,36,0.35)"
            count={unsorted.length}
          >
            <Grid albums={unsorted} tracksByAlbum={tracksByAlbum} />
          </Section>
        )}
      </div>
    </main>
  );
}

function Stat({ n, label, highlight }: { n: number; label: string; highlight?: boolean }) {
  return (
    <div className="text-right">
      <p className="label-mono">{label}</p>
      <p
        className={
          "mt-1.5 font-mono font-bold tabular-nums " +
          (highlight ? "title-grad text-[1.6rem] sm:text-[2.4rem]" : "text-t1 text-[1.6rem] sm:text-[2.4rem]")
        }
      >
        {String(n).padStart(2, "0")}
      </p>
    </div>
  );
}

function Section({
  label,
  icon,
  accent,
  rule,
  count,
  children,
}: {
  label: string;
  icon: string;
  accent: string;
  rule: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div
        className="flex items-baseline justify-between mb-7 pb-3"
        style={{ borderBottom: `1px solid ${rule}` }}
      >
        <div className="flex items-baseline gap-3">
          <span style={{ color: accent }} className="text-[1.1rem]">
            {icon}
          </span>
          <h2
            className="font-display text-[1.55rem] font-semibold tracking-tight"
            style={{ color: accent }}
          >
            {label}
          </h2>
        </div>
        <span className="label-mono">{count} albums</span>
      </div>
      {children}
    </section>
  );
}

function Grid({
  albums,
  tracksByAlbum,
}: {
  albums: { _id: string; artistSlug: string; slug: string; name: string; coverKey?: string }[];
  tracksByAlbum: Map<string, number>;
}) {
  return (
    <div
      className="grid gap-7"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}
    >
      {albums.map((a) => (
        <AlbumCard
          key={a._id}
          artist={a.artistSlug}
          slug={a.slug}
          name={a.name}
          trackCount={tracksByAlbum.get(`${a.artistSlug}/${a.slug}`) ?? 0}
          coverKey={a.coverKey}
        />
      ))}
    </div>
  );
}
