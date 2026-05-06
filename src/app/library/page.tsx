"use client";

import { useMemo, useState, Suspense } from "react";
import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import { api } from "../../../convex/_generated/api";
import { AlbumCard } from "@/components/album-card";
import { useResolvedUrls } from "@/components/url-cache-provider";
import { TrackRow, useHeartedSet } from "@/components/track-row";
import type { PlayerTrack } from "@/components/player-context";

const SECTIONS: Array<{ key: string; label: string; icon: string; accent: string; rule: string }> = [
  { key: "film_cinematic", label: "Film & Cinematic", icon: "🎬", accent: "#ef4444", rule: "rgba(239,68,68,0.25)" },
  { key: "artist_songs", label: "Artist Songs", icon: "🎤", accent: "#8b5cf6", rule: "rgba(139,92,246,0.25)" },
  { key: "gaming", label: "Gaming", icon: "🎮", accent: "#34d399", rule: "rgba(52,211,153,0.25)" },
];

function LibraryInner() {
  const albums = useQuery(api.albums.list, {}) ?? [];
  const tracks = useQuery(api.tracks.list, {}) ?? [];
  const artists = useQuery(api.artists.list, {}) ?? [];
  const hearted = useHeartedSet();
  const sp = useSearchParams();
  const stage = sp?.get("stage");

  const [genreFilter, setGenreFilter] = useState("");
  const [artistFilter, setArtistFilter] = useState("");
  const [heartedOnly, setHeartedOnly] = useState(false);

  const genres = useMemo(() => {
    const set = new Set<string>();
    for (const t of tracks) if (t.genre) set.add(t.genre);
    return Array.from(set).sort();
  }, [tracks]);

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
    if (artistFilter && a.artistSlug !== artistFilter) continue;
    if (a.artistSlug === "_suno") { sunoStaging.push(a); continue; }
    const sec = (a as { section?: string }).section;
    if (sec && SECTIONS.some((s) => s.key === sec)) {
      (bySection[sec] ??= []).push(a);
    } else {
      otherUnsorted.push(a);
    }
  }

  const unsortedTracks = useMemo(() => {
    let list = tracks.filter((t) => !t.albumSlug || t.albumSlug === "_singles" || t.albumSlug === "_unsorted");
    if (artistFilter) list = list.filter((t) => t.artistSlug === artistFilter);
    if (genreFilter) list = list.filter((t) => t.genre === genreFilter);
    if (heartedOnly) list = list.filter((t) => hearted.has(t._id));
    if (stage === "ready") list = list.filter((t) => !t.distributed && !t.archivedAt);
    if (stage === "distributed") list = list.filter((t) => t.distributed);
    if (stage === "mixing") list = list.filter((t) => !t.distributed && !t.archivedAt && (t.rating ?? 0) >= 4);
    return list.slice(0, 80);
  }, [tracks, stage, artistFilter, genreFilter, heartedOnly, hearted]);

  return (
    <main className="px-5 sm:px-6 lg:px-8 pt-3 pb-32 animate-fi">
      {/* Filter bar — legacy .fb */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <select
          className="fselect"
          value={genreFilter}
          onChange={(e) => setGenreFilter(e.target.value)}
        >
          <option value="">All genres</option>
          {genres.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select
          className="fselect"
          value={artistFilter}
          onChange={(e) => setArtistFilter(e.target.value)}
        >
          <option value="">All artists</option>
          {artists.map((a) => <option key={a._id} value={a.slug}>{a.name}</option>)}
        </select>
        <button
          className={"fbtn " + (heartedOnly ? "on" : "")}
          onClick={() => setHeartedOnly((v) => !v)}
        >
          ♥ Hearted
        </button>
        {stage && (
          <span className="fbtn on flex items-center gap-2" style={{ borderColor: "rgba(236,72,153,0.5)" }}>
            <span className="font-mono uppercase">stage: {stage}</span>
            <a href="/library" className="font-mono text-paper-faint hover:text-paper">×</a>
          </span>
        )}
        <span className="ml-auto font-mono text-[0.55rem] uppercase tracking-[0.18em] text-paper-faint">
          {tracks.length} trk · {albums.length} alb · {artists.length} artists
        </span>
      </div>

      <div className="space-y-7">
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
            >
              <Grid albums={list} tracksByAlbum={tracksByAlbum} />
            </Section>
          );
        })}

        {sunoStaging.length > 0 && (
          <Section label="Suno Staging" icon="◐" accent="#ec4899" rule="rgba(236,72,153,0.25)" count={sunoStaging.length}>
            <Grid albums={sunoStaging} tracksByAlbum={tracksByAlbum} />
          </Section>
        )}

        {otherUnsorted.length > 0 && (
          <Section label="Other" icon="◯" accent="#94a3b8" rule="rgba(148,163,184,0.2)" count={otherUnsorted.length}>
            <Grid albums={otherUnsorted} tracksByAlbum={tracksByAlbum} />
          </Section>
        )}

        {unsortedTracks.length > 0 && (
          <UnsortedTracks tracks={unsortedTracks} hearted={hearted} />
        )}
      </div>
    </main>
  );
}

function Section({
  sectionKey,
  label,
  icon,
  accent,
  rule,
  count,
  children,
}: {
  sectionKey?: string;
  label: string;
  icon: string;
  accent: string;
  rule: string;
  count: number;
  children: React.ReactNode;
}) {
  const setSection = useMutation(api.albums.setSection);
  const [hover, setHover] = useState(false);
  const isDropTarget = !!sectionKey;

  const onDragOver = (e: React.DragEvent) => {
    if (!isDropTarget) return;
    if (!Array.from(e.dataTransfer.types ?? []).includes("application/x-mh-album")) return;
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

  return (
    <section
      onDragOver={onDragOver}
      onDragLeave={() => setHover(false)}
      onDrop={onDrop}
      className={"transition-all " + (hover ? "rounded-lg" : "")}
      style={hover ? { boxShadow: `inset 0 0 0 2px ${accent}, 0 0 32px ${rule}`, padding: "0.5rem" } : undefined}
    >
      <div className="flex items-baseline justify-between mb-2 pb-1.5" style={{ borderBottom: `1px solid ${rule}` }}>
        <div className="flex items-baseline gap-2">
          <span style={{ color: accent }} className="text-[0.95rem] leading-none">{icon}</span>
          <h2 className="font-display text-[0.9rem] font-bold tracking-tight leading-none" style={{ color: accent }}>{label}</h2>
        </div>
        <span className="font-mono text-[0.5rem] uppercase tracking-[0.16em] text-paper-faint">{count} alb</span>
      </div>
      {count > 0 ? (
        children
      ) : (
        <div
          className="border border-dashed rounded-md py-6 text-center font-mono text-[0.55rem] uppercase tracking-[0.2em] text-paper-faint/60"
          style={{ borderColor: rule }}
        >
          drag albums here
        </div>
      )}
    </section>
  );
}

function Grid({ albums, tracksByAlbum }: { albums: { _id: string; artistSlug: string; slug: string; name: string; coverKey?: string; section?: string }[]; tracksByAlbum: Map<string, number>; }) {
  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "1rem" }}
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
      <div className="flex items-baseline justify-between mb-2 pb-1.5" style={{ borderBottom: "1px solid rgba(251,191,36,0.25)" }}>
        <div className="flex items-baseline gap-2">
          <span className="text-[0.95rem] text-amber leading-none">◯</span>
          <h2 className="font-display text-[0.9rem] font-bold tracking-tight text-amber leading-none">Unsorted</h2>
          <span className="font-mono text-[0.5rem] uppercase tracking-[0.18em] text-paper-faint ml-1">drop on an album to organise</span>
        </div>
        <span className="font-mono text-[0.5rem] uppercase tracking-[0.16em] text-paper-faint">{tracks.length} trk</span>
      </div>
      <div className="rounded-md border border-brd bg-card/50 backdrop-blur p-1">
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

export default function LibraryPage() {
  return (
    <Suspense fallback={<main className="px-5 sm:px-6 lg:px-8 pt-3 pb-32"><p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-paper-faint">loading…</p></main>}>
      <LibraryInner />
    </Suspense>
  );
}
