"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import { api } from "../../../convex/_generated/api";
import { AlbumCard } from "@/components/album-card";
import { PageHero, PageShell } from "@/components/page-hero";
import { useResolvedUrls } from "@/components/url-cache-provider";
import { TrackRow, useHeartedSet } from "@/components/track-row";
import type { PlayerTrack } from "@/components/player-context";

const SECTIONS: Array<{ key: string; label: string; icon: string; accent: string; rule: string }> = [
  { key: "film_cinematic", label: "Film & Cinematic", icon: "▲", accent: "#ef4444", rule: "rgba(239,68,68,0.35)" },
  { key: "artist_songs", label: "Artist Songs", icon: "♢", accent: "#8b5cf6", rule: "rgba(139,92,246,0.35)" },
  { key: "gaming", label: "Gaming", icon: "◎", accent: "#34d399", rule: "rgba(52,211,153,0.35)" },
];

export default function LibraryPage() {
  const albums = useQuery(api.albums.list, {}) ?? [];
  const tracks = useQuery(api.tracks.list, {}) ?? [];
  const artists = useQuery(api.artists.list, {}) ?? [];
  const hearted = useHeartedSet();
  const sp = useSearchParams();
  const stage = sp?.get("stage");

  // Bulk-prefetch every album cover in one shot (cached). Player URLs not needed here.
  const coverKeys = useMemo(() => albums.map((a) => a.coverKey).filter((k): k is string => !!k), [albums]);
  useResolvedUrls(coverKeys);

  const tracksByAlbum = new Map<string, number>();
  for (const t of tracks) {
    const k = `${t.artistSlug}/${t.albumSlug ?? "_singles"}`;
    tracksByAlbum.set(k, (tracksByAlbum.get(k) ?? 0) + 1);
  }

  type AlbumDoc = (typeof albums)[number];
  const bySection: Record<string, AlbumDoc[]> = {};
  const sunoStaging: AlbumDoc[] = [];
  const otherUnsorted: AlbumDoc[] = [];
  for (const a of albums) {
    if (a.artistSlug === "_suno") { sunoStaging.push(a); continue; }
    const sec = (a as { section?: string }).section;
    if (sec && SECTIONS.some((s) => s.key === sec)) {
      (bySection[sec] ??= []).push(a);
    } else {
      otherUnsorted.push(a);
    }
  }

  // Unsorted FLAT TRACKS — tracks whose album is _unsorted/_singles or has no albumSlug
  const unsortedTracks = useMemo(() => {
    let list = tracks.filter((t) => !t.albumSlug || t.albumSlug === "_singles" || t.albumSlug === "_unsorted");
    if (stage === "ready") list = list.filter((t) => !t.distributed && !t.archivedAt);
    if (stage === "distributed") list = list.filter((t) => t.distributed);
    if (stage === "mixing") list = list.filter((t) => !t.distributed && !t.archivedAt && (t.rating ?? 0) >= 4);
    return list.slice(0, 80);
  }, [tracks, stage]);

  return (
    <PageShell>
      <PageHero
        kicker="Library / 2026"
        title="Library"
        emphasis="catalog"
        description="Generated tracks, organised into albums and sections. Drag rows to reorder. Click ⋮ for more."
        accent="purple"
        stats={[
          { label: "Artists", value: artists.length },
          { label: "Albums", value: albums.length },
          { label: "Tracks", value: tracks.length, highlight: true },
        ]}
      />

      {stage && (
        <div className="mb-10 flex items-center gap-3">
          <span className="font-mono text-[0.6rem] uppercase tracking-[0.22em] text-paper-faint">Filter</span>
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-pink px-2.5 py-1 rounded-full border border-pink/30 bg-pink/5">
            {stage}
          </span>
          <a href="/library" className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-paper-faint hover:text-paper transition-colors">clear ×</a>
        </div>
      )}
      <div className="space-y-24">
        {SECTIONS.map((s) => {
          const list = bySection[s.key] ?? [];
          return (
            <Section
              key={s.key}
              sectionKey={s.key}
              label={s.label}
              icon={s.icon}
              accent={s.accent}
              rule={s.rule}
              count={list.length}
              hideIfEmpty={list.length === 0}
            >
              <Grid albums={list} tracksByAlbum={tracksByAlbum} />
            </Section>
          );
        })}

        {sunoStaging.length > 0 && (
          <Section label="Suno Staging" icon="◐" accent="#ec4899" rule="rgba(236,72,153,0.35)" count={sunoStaging.length}>
            <Grid albums={sunoStaging} tracksByAlbum={tracksByAlbum} />
          </Section>
        )}

        {otherUnsorted.length > 0 && (
          <Section label="Other" icon="◯" accent="#94a3b8" rule="rgba(148,163,184,0.3)" count={otherUnsorted.length}>
            <Grid albums={otherUnsorted} tracksByAlbum={tracksByAlbum} />
          </Section>
        )}

        {unsortedTracks.length > 0 && (
          <UnsortedTracks tracks={unsortedTracks} hearted={hearted} />
        )}
      </div>
    </PageShell>
  );
}

function Section({
  sectionKey,
  label,
  icon,
  accent,
  rule,
  count,
  hideIfEmpty,
  children,
}: {
  sectionKey?: string;
  label: string;
  icon: string;
  accent: string;
  rule: string;
  count: number;
  hideIfEmpty?: boolean;
  children: React.ReactNode;
}) {
  const setSection = useMutation(api.albums.setSection);
  const [hover, setHover] = useState(false);
  const isDropTarget = !!sectionKey;

  const onDragOver = (e: React.DragEvent) => {
    if (!isDropTarget) return;
    if (!e.dataTransfer.types.includes("application/x-mh-album")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setHover(true);
  };
  const onDrop = async (e: React.DragEvent) => {
    if (!isDropTarget) return;
    e.preventDefault();
    setHover(false);
    const raw = e.dataTransfer.getData("application/x-mh-album");
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as { albumId: string; section?: string };
      if (data.section === sectionKey) return;
      await setSection({ id: data.albumId as never, section: sectionKey });
    } catch {}
  };

  if (hideIfEmpty && count === 0 && !isDropTarget) return null;

  return (
    <section
      onDragOver={onDragOver}
      onDragLeave={() => setHover(false)}
      onDrop={onDrop}
      className={hover ? "ring-2 ring-offset-4 ring-offset-bg rounded-2xl transition-all" : "transition-all"}
      style={hover ? { boxShadow: `0 0 0 2px ${accent}, 0 0 32px ${rule}` } : undefined}
    >
      <div className="flex items-baseline justify-between mb-7 pb-3" style={{ borderBottom: `1px solid ${rule}` }}>
        <div className="flex items-baseline gap-3">
          <span style={{ color: accent }} className="text-[1.1rem]">{icon}</span>
          <h2 className="font-display text-[1.65rem] font-semibold tracking-tight" style={{ color: accent }}>{label}</h2>
          {isDropTarget && count === 0 && (
            <span className="font-mono text-[0.55rem] uppercase tracking-[0.2em] text-paper-faint">drop here</span>
          )}
        </div>
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.22em] text-paper-faint">{count} albums</span>
      </div>
      {count > 0 && children}
    </section>
  );
}

function Grid({ albums, tracksByAlbum }: { albums: { _id: string; artistSlug: string; slug: string; name: string; coverKey?: string; section?: string }[]; tracksByAlbum: Map<string, number>; }) {
  return (
    <div
      className="grid gap-7"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}
    >
      {albums.map((a) => (
        <AlbumCard
          key={a._id}
          albumId={a._id as never}
          artist={a.artistSlug}
          slug={a.slug}
          name={a.name}
          trackCount={tracksByAlbum.get(`${a.artistSlug}/${a.slug}`) ?? 0}
          coverKey={a.coverKey}
          section={a.section}
        />
      ))}
    </div>
  );
}

function UnsortedTracks({
  tracks,
  hearted,
}: {
  tracks: Array<{
    _id: string;
    title: string;
    artistSlug: string;
    albumSlug?: string;
    duration?: number;
    generator: "suno" | "mureka" | "import";
    audioKey: string;
    trackNum?: number;
  }>;
  hearted: Set<string>;
}) {
  // bulk presign all audio keys so play is instant
  const keys = useMemo(() => tracks.map((t) => t.audioKey), [tracks]);
  useResolvedUrls(keys);
  const queue: PlayerTrack[] = tracks.map((t) => ({
    id: t._id,
    title: t.title,
    artist: t.artistSlug,
    album: t.albumSlug,
    audioUrl: "",
  }));

  return (
    <section>
      <div className="flex items-baseline justify-between mb-7 pb-3" style={{ borderBottom: "1px solid rgba(251,191,36,0.35)" }}>
        <div className="flex items-baseline gap-3">
          <span className="text-[1.1rem] text-amber">◯</span>
          <h2 className="font-display text-[1.65rem] font-semibold tracking-tight text-amber">Unsorted</h2>
        </div>
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.22em] text-paper-faint">{tracks.length} tracks</span>
      </div>
      <div className="rounded-xl border border-brd bg-card/50 backdrop-blur p-3 space-y-0.5">
        {tracks.map((t, i) => (
          <TrackRow
            key={t._id}
            trackId={t._id as never}
            trackNum={t.trackNum}
            title={t.title}
            artistSlug={t.artistSlug}
            albumSlug={t.albumSlug}
            duration={t.duration}
            generator={t.generator}
            audioKey={t.audioKey}
            hearted={hearted.has(t._id)}
            queue={queue}
            index={i}
          />
        ))}
      </div>
    </section>
  );
}
