"use client";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { AlbumCard } from "@/components/album-card";

const SECTIONS: Array<{ key: string; label: string; icon: string; color: string }> = [
  { key: "film_cinematic", label: "Film & Cinematic", icon: "🎬", color: "text-red" },
  { key: "artist_songs", label: "Artist Songs", icon: "🎤", color: "text-purple" },
  { key: "gaming", label: "Gaming", icon: "🎮", color: "text-green" },
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
  for (const a of albums) {
    const sec = (a as { section?: string }).section ?? null;
    if (sec && SECTIONS.some((s) => s.key === sec)) {
      (bySection[sec] ??= []).push(a);
    } else {
      unsorted.push(a);
    }
  }

  return (
    <main className="max-w-[1440px] mx-auto px-6 lg:px-10 py-6 animate-fi">
      <div className="flex items-baseline gap-3 mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight title-grad">Library</h1>
        <span className="label-mono">{artists.length} artists · {albums.length} albums · {tracks.length} tracks</span>
      </div>

      {SECTIONS.map((s) => {
        const list = bySection[s.key] ?? [];
        if (list.length === 0) return null;
        return (
          <section key={s.key} className="mb-8">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-brd">
              <span className="text-base">{s.icon}</span>
              <h2 className={`text-[0.9rem] font-bold ${s.color}`}>{s.label}</h2>
              <span className="label-mono">({list.length})</span>
            </div>
            <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
              {list.map((a) => (
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
          </section>
        );
      })}

      {unsorted.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-brd">
            <span className="text-base">📁</span>
            <h2 className="text-[0.9rem] font-bold text-amber">Unsorted</h2>
            <span className="label-mono">({unsorted.length})</span>
          </div>
          <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
            {unsorted.map((a) => (
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
        </section>
      )}
    </main>
  );
}
