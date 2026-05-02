"use client";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

export default function LibraryPage() {
  const artists = useQuery(api.artists.list, {});
  const albums = useQuery(api.albums.list, {});
  const tracks = useQuery(api.tracks.list, {});

  const byArtist = new Map<string, { artist: string; albums: number; tracks: number }>();
  for (const a of albums ?? []) {
    const cur = byArtist.get(a.artistSlug) ?? { artist: a.artistSlug, albums: 0, tracks: 0 };
    cur.albums += 1;
    byArtist.set(a.artistSlug, cur);
  }
  for (const t of tracks ?? []) {
    const cur = byArtist.get(t.artistSlug) ?? { artist: t.artistSlug, albums: 0, tracks: 0 };
    cur.tracks += 1;
    byArtist.set(t.artistSlug, cur);
  }

  return (
    <main className="max-w-[1440px] mx-auto px-8 lg:px-14 py-12">
      <h1 className="font-display text-4xl text-paper">Library</h1>
      <p className="text-paper-dim text-sm mt-2 font-mono">
        {(artists?.length ?? 0)} artists · {(albums?.length ?? 0)} albums · {(tracks?.length ?? 0)} tracks
      </p>

      <h2 className="mt-12 font-display text-xl text-paper">Artists</h2>
      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from(byArtist.values()).sort((a, b) => b.tracks - a.tracks).map((x) => (
          <a key={x.artist} href={`/library/${x.artist}`}
             className="border border-rule-soft/60 rounded-md p-4 hover:border-amber/60 transition">
            <div className="text-paper font-display text-lg">{x.artist}</div>
            <div className="text-paper-dim text-xs font-mono mt-1">{x.albums}a · {x.tracks}t</div>
          </a>
        ))}
      </div>
    </main>
  );
}
