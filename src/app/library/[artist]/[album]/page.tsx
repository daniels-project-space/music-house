"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { use, useMemo, useState } from "react";
import { TrackRow, useHeartedSet } from "@/components/track-row";
import { KaraokeLyrics } from "@/components/karaoke-lyrics";
import { usePlayer, type PlayerTrack } from "@/components/player-context";
import { useResolvedUrls } from "@/components/url-cache-provider";

export default function AlbumPage({ params }: { params: Promise<{ artist: string; album: string }> }) {
  const { artist, album } = use(params);
  const albumRow = useQuery(api.albums.getOne, { artistSlug: artist, slug: album });
  const tracks = useQuery(api.tracks.list, { artistSlug: artist, albumSlug: album });
  const hearted = useHeartedSet();
  const { play, current } = usePlayer();
  const renameAlbum = useMutation(api.albums.rename);

  const allKeys = useMemo(() => {
    const k: string[] = [];
    if (albumRow?.coverKey) k.push(albumRow.coverKey);
    if (tracks) for (const t of tracks) k.push(t.audioKey);
    return k;
  }, [albumRow?.coverKey, tracks]);
  const urls = useResolvedUrls(allKeys);
  const coverUrl = albumRow?.coverKey ? urls[albumRow.coverKey] ?? null : null;

  const [lyricsTrackId, setLyricsTrackId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");

  if (!tracks || !albumRow) {
    return <main className="max-w-[1600px] mx-auto px-8 lg:px-12 py-16 text-paper-dim">loading...</main>;
  }

  const sorted = [...tracks].sort((a, b) => (a.trackNum ?? 0) - (b.trackNum ?? 0));
  const queue: PlayerTrack[] = sorted
    .map((t) => ({
      id: t._id,
      title: t.title,
      artist,
      album,
      audioUrl: urls[t.audioKey] ?? "",
      coverUrl: coverUrl ?? undefined,
    }))
    .filter((t) => t.audioUrl);

  const playAll = () => {
    if (queue.length) play(queue[0], queue);
  };

  const shuffle = () => {
    if (!queue.length) return;
    const shuffled = [...queue].sort(() => Math.random() - 0.5);
    play(shuffled[0], shuffled);
  };

  const totalDuration = sorted.reduce((s, t) => s + (t.duration ?? 0), 0);
  const durMin = Math.round(totalDuration / 60);

  const lyricsTrack = lyricsTrackId
    ? sorted.find((t) => t._id === lyricsTrackId)
    : current
      ? sorted.find((t) => t._id === current.id)
      : null;

  return (
    <main className="max-w-[1600px] mx-auto px-8 lg:px-12 py-10 animate-fi">
      <a
        href={`/library`}
        className="inline-flex items-center gap-2 font-mono text-[0.65rem] uppercase tracking-[0.22em] text-t3 hover:text-amber transition-colors mb-8"
      >
        ← Library
      </a>

      <div className="grid grid-cols-12 gap-10">
        {/* LEFT — cover + actions */}
        <aside className="col-span-12 lg:col-span-4 xl:col-span-3 space-y-6">
          <div
            className={
              "relative aspect-square rounded-xl overflow-hidden bg-card border border-brd " +
              (current && queue.find((q) => q.id === current.id) ? "animate-cover-pulse" : "")
            }
          >
            {coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverUrl} alt={albumRow.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full grid place-items-center text-6xl text-t4">♪</div>
            )}
          </div>

          <div>
            <p className="label-mono-amber">{albumRow.section ?? "—"}</p>
            {editingName ? (
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={async () => {
                  const n = draftName.trim();
                  if (n && n !== albumRow.name) {
                    try { await renameAlbum({ id: albumRow._id, name: n }); } catch {}
                  }
                  setEditingName(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                  if (e.key === "Escape") setEditingName(false);
                }}
                autoFocus
                className="mt-1 w-full bg-transparent outline-none font-display text-2xl xl:text-4xl font-extrabold leading-[1.05] tracking-tight text-t1 border-b border-pink/40"
              />
            ) : (
              <h1
                className="mt-1 font-display text-2xl xl:text-4xl font-extrabold leading-[1.05] tracking-tight text-t1 cursor-text"
                onDoubleClick={() => { setDraftName(albumRow.name); setEditingName(true); }}
                title="Double-click to rename"
              >
                {albumRow.name}
              </h1>
            )}
            <p className="mt-2 font-mono text-[0.62rem] text-t3 uppercase tracking-[0.14em]">
              {artist} · {sorted.length} tracks · {durMin} min
            </p>
            {albumRow.description && (
              <p className="mt-3 text-[0.85rem] text-t2 leading-relaxed">{albumRow.description}</p>
            )}
          </div>

          <div className="space-y-2">
            <ActionButton color="purple" onClick={playAll} disabled={!queue.length}>
              ▶ Play All
            </ActionButton>
            <ActionButton onClick={shuffle} disabled={!queue.length}>
              ⤮ Shuffle
            </ActionButton>
            <div className="grid grid-cols-2 gap-2">
              <ActionButton
                color="cyan"
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                }}
              >
                🔗 Share
              </ActionButton>
              <ActionButton color="green">Complete</ActionButton>
            </div>
            <ActionButton color="amber">+ Distribute</ActionButton>
          </div>
        </aside>

        {/* CENTER — track list */}
        <section className="col-span-12 lg:col-span-5 xl:col-span-6">
          <div className="flex items-center justify-between mb-4">
            <p className="label-mono">Tracks</p>
            <p className="label-mono">{sorted.length}</p>
          </div>
          <ol className="space-y-0.5">
            {sorted.map((t) => (
              <TrackRow
                key={t._id}
                trackId={t._id}
                trackNum={t.trackNum}
                title={t.title}
                artistSlug={t.artistSlug}
                albumSlug={t.albumSlug}
                duration={t.duration}
                generator={t.generator}
                audioKey={t.audioKey}
                hearted={hearted.has(t._id)}
                onShowLyrics={() => setLyricsTrackId(t._id)}
                queue={queue}
              />
            ))}
          </ol>
        </section>

        {/* RIGHT — sticky lyrics karaoke */}
        <aside className="col-span-12 lg:col-span-3 xl:col-span-3">
          <div
            className="sticky top-24 rounded-xl border border-brd bg-card/60 backdrop-blur p-5 min-h-[420px]"
          >
            <div className="flex items-center justify-between mb-3">
              <p className="label-mono">Lyrics</p>
              {lyricsTrack && (
                <button
                  onClick={() => setLyricsTrackId(null)}
                  className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-t3 hover:text-t1"
                >
                  clear
                </button>
              )}
            </div>
            {lyricsTrack ? (
              <KaraokeLyrics
                title={lyricsTrack.title}
                lyrics={lyricsTrack.lyrics ?? []}
                trackId={lyricsTrack._id}
              />
            ) : (
              <div className="grid place-items-center h-[340px] text-center">
                <p className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-t4 leading-relaxed max-w-[180px]">
                  Click ⋮ on any track and pick Lyrics. Or play one — it follows.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

function ActionButton({
  children,
  color,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  color?: "purple" | "cyan" | "green" | "amber";
  onClick?: () => void;
  disabled?: boolean;
}) {
  const colors = {
    purple: { border: "rgba(139,92,246,0.4)", text: "#8b5cf6", bg: "rgba(139,92,246,0.06)" },
    cyan: { border: "rgba(6,182,212,0.4)", text: "#06b6d4", bg: "rgba(6,182,212,0.06)" },
    green: { border: "rgba(52,211,153,0.4)", text: "#34d399", bg: "rgba(52,211,153,0.06)" },
    amber: { border: "rgba(251,191,36,0.4)", text: "#fbbf24", bg: "rgba(251,191,36,0.06)" },
  };
  const c = color ? colors[color] : { border: "var(--color-brd)", text: "var(--color-t2)", bg: "transparent" };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full px-3 py-2 rounded-md border font-display text-[0.78rem] font-medium transition-all disabled:opacity-40 hover:translate-y-[-1px]"
      style={{ borderColor: c.border, color: c.text, background: c.bg }}
    >
      {children}
    </button>
  );
}
