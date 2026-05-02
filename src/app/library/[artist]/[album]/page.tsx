"use client";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { use, useEffect, useState } from "react";
import { usePlayer } from "@/components/player-context";

export default function AlbumPage({ params }: { params: Promise<{ artist: string; album: string }> }) {
  const { artist, album } = use(params);
  const albumRow = useQuery(api.albums.getOne, { artistSlug: artist, slug: album });
  const tracks = useQuery(api.tracks.list, { artistSlug: artist, albumSlug: album });
  const heartList = useQuery(api.hearts.list, {});
  const toggleHeart = useMutation(api.hearts.toggle);
  const { play } = usePlayer();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const heartedSet = new Set((heartList ?? []).map((h) => h.trackId));

  useEffect(() => {
    if (!tracks) return;
    Promise.all(
      tracks.map(async (t) => [t._id, await fetch(`/api/audio?key=${encodeURIComponent(t.audioKey)}`).then((r) => r.json()).then((j) => j.url)] as const),
    ).then((rs) => setUrls(Object.fromEntries(rs)));
  }, [tracks]);

  const queue = (tracks ?? []).map((t) => ({
    id: t._id,
    title: t.title,
    artist,
    album,
    audioUrl: urls[t._id] ?? "",
  })).filter((x) => x.audioUrl);

  return (
    <main className="max-w-[1440px] mx-auto px-8 lg:px-14 py-12">
      <a href={`/library/${artist}`} className="font-mono text-paper-dim text-sm hover:text-paper">← {artist}</a>
      <h1 className="font-display text-4xl text-paper mt-2">{albumRow?.name ?? album}</h1>
      <p className="text-paper-dim text-sm mt-2 font-mono">{tracks?.length ?? 0} tracks</p>

      <ol className="mt-12 space-y-1">
        {(tracks ?? []).sort((a, b) => (a.trackNum ?? 0) - (b.trackNum ?? 0)).map((t) => (
          <li key={t._id} className="group flex items-center gap-4 px-4 py-2 rounded hover:bg-paper/5">
            <span className="text-paper-dim font-mono text-xs w-6">{t.trackNum ?? "-"}</span>
            <button
              disabled={!urls[t._id]}
              onClick={() => urls[t._id] && play({ id: t._id, title: t.title, artist, album, audioUrl: urls[t._id] }, queue)}
              className="text-amber/60 hover:text-amber disabled:opacity-30 font-mono text-sm w-6"
            >
              ▶
            </button>
            <a href={`/track/${t._id}`} className="flex-1 text-paper hover:text-amber">{t.title}</a>
            <span className="text-paper-dim font-mono text-xs">{Math.round((t.duration ?? 0) / 60)}m</span>
            <button
              onClick={() => toggleHeart({ trackId: t._id })}
              className={`font-mono text-sm w-6 ${heartedSet.has(t._id) ? "text-amber" : "text-paper-dim hover:text-paper"}`}
            >
              ♥
            </button>
          </li>
        ))}
      </ol>
    </main>
  );
}
