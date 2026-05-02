"use client";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { use } from "react";

export default function ArtistPage({ params }: { params: Promise<{ artist: string }> }) {
  const { artist } = use(params);
  const albums = useQuery(api.albums.list, { artistSlug: artist });
  const tracks = useQuery(api.tracks.list, { artistSlug: artist });

  const byAlbum = new Map<string, { tracks: typeof tracks }>();
  for (const t of tracks ?? []) {
    const k = t.albumSlug ?? "_singles";
    const cur = byAlbum.get(k) ?? { tracks: [] };
    cur.tracks!.push(t);
    byAlbum.set(k, cur);
  }

  return (
    <main className="max-w-[1440px] mx-auto px-8 lg:px-14 py-12">
      <a href="/library" className="font-mono text-paper-dim text-sm hover:text-paper">← library</a>
      <h1 className="font-display text-4xl text-paper mt-2">{artist}</h1>
      <p className="text-paper-dim text-sm mt-2 font-mono">{albums?.length ?? 0} albums · {tracks?.length ?? 0} tracks</p>

      <div className="mt-12 space-y-3">
        {(albums ?? []).map((a) => (
          <a key={a._id} href={`/library/${artist}/${a.slug}`}
             className="flex items-center justify-between border border-rule-soft/60 rounded-md p-4 hover:border-amber/60 transition">
            <div>
              <div className="text-paper font-display text-lg">{a.name}</div>
              <div className="text-paper-dim text-xs font-mono mt-1">{(byAlbum.get(a.slug)?.tracks?.length ?? 0)} tracks</div>
            </div>
            <span className="text-paper-dim font-mono text-xs">→</span>
          </a>
        ))}
      </div>
    </main>
  );
}
