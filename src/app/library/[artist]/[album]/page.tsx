"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { use, useMemo, useState } from "react";
import { TrackRow, useHeartedSet } from "@/components/track-row";
import { KaraokeLyrics } from "@/components/karaoke-lyrics";
import { usePlayer, type PlayerTrack } from "@/components/player-context";
import { useResolvedUrls } from "@/components/url-cache-provider";
import Link from "next/link";

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
    return (
      <main className="px-5 sm:px-6 lg:px-8 pt-3 pb-32">
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-paper-faint">loading…</p>
      </main>
    );
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

  const playAll = () => { if (queue.length) play(queue[0], queue); };
  const shuffle = () => {
    if (!queue.length) return;
    const shuffled = [...queue].sort(() => Math.random() - 0.5);
    play(shuffled[0], shuffled);
  };

  const totalDuration = sorted.reduce((s, t) => s + (t.duration ?? 0), 0);
  const durMin = Math.round(totalDuration / 60);
  const isPlayingThis = !!(current && queue.find((q) => q.id === current.id));

  const lyricsTrack = lyricsTrackId
    ? sorted.find((t) => t._id === lyricsTrackId)
    : current
      ? sorted.find((t) => t._id === current.id)
      : null;

  return (
    <main className="px-5 sm:px-6 lg:px-8 pt-3 pb-32 animate-fi">
      <Link
        href="/library"
        className="inline-flex items-center gap-2 font-mono text-[0.55rem] uppercase tracking-[0.2em] text-paper-faint hover:text-amber transition-colors mb-3"
      >
        ← Back to Albums
      </Link>

      {/* AHDR — legacy album header: cover left, meta + actions right (horizontal) */}
      <div
        className="relative rounded-lg border border-brd bg-card overflow-hidden mb-4"
        style={{
          backgroundImage: coverUrl ? `linear-gradient(180deg, rgba(5,6,8,0.85), rgba(5,6,8,0.96)), url(${coverUrl})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="flex gap-5 p-5 backdrop-blur-md">
          <div
            className={
              "w-[200px] h-[200px] rounded-md overflow-hidden bg-surface shrink-0 ring-1 ring-paper/10 " +
              (isPlayingThis ? "animate-cover-pulse" : "")
            }
          >
            {coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverUrl} alt={albumRow.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full grid place-items-center text-5xl text-paper-faint/40">♪</div>
            )}
          </div>

          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-center gap-2 mb-2">
              {albumRow.section && (
                <span className="font-mono text-[0.5rem] uppercase tracking-[0.18em] text-amber/85 px-1.5 py-0.5 rounded border border-amber/30">
                  {albumRow.section.replace(/_/g, " ")}
                </span>
              )}
              <span className="font-mono text-[0.5rem] uppercase tracking-[0.18em] text-paper-faint">
                {artist} · {sorted.length} trk · {durMin} min
              </span>
            </div>

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
                className="font-display text-[1.5rem] sm:text-[1.75rem] font-extrabold leading-[1.05] tracking-tight text-paper bg-transparent outline-none border-b border-pink/40 mb-2"
              />
            ) : (
              <h1
                className="font-display text-[1.5rem] sm:text-[1.75rem] font-extrabold leading-[1.05] tracking-tight text-paper cursor-text mb-2"
                onDoubleClick={() => { setDraftName(albumRow.name); setEditingName(true); }}
                title="Double-click to rename"
              >
                {albumRow.name}
              </h1>
            )}

            {albumRow.description && (
              <p className="text-[0.78rem] text-paper-dim leading-relaxed mb-3 max-w-2xl">{albumRow.description}</p>
            )}

            <div className="flex items-center gap-1.5 flex-wrap mt-auto">
              <Bx onClick={playAll} disabled={!queue.length} color="purple">▶ Play All</Bx>
              <Bx onClick={shuffle} disabled={!queue.length}>⤮ Shuffle</Bx>
              <Bx
                color="cyan"
                onClick={() => navigator.clipboard.writeText(window.location.href)}
              >
                🔗 Share
              </Bx>
              <Bx color="green">Complete</Bx>
              <Bx color="amber">📡 Distribute</Bx>
            </div>

            {lyricsTrack && (
              <div className="mt-3 rounded border border-brd bg-bg/60 p-3 max-h-[148px] overflow-hidden">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-mono text-[0.5rem] uppercase tracking-[0.2em] text-purple">Lyrics</span>
                  <button
                    onClick={() => setLyricsTrackId(null)}
                    className="font-mono text-[0.5rem] uppercase tracking-[0.16em] text-paper-faint hover:text-paper"
                  >
                    clear
                  </button>
                </div>
                <KaraokeLyrics
                  title={lyricsTrack.title}
                  lyrics={lyricsTrack.lyrics ?? []}
                  trackId={lyricsTrack._id}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Track list — full width below header */}
      <div className="rounded-md border border-brd bg-card/50 backdrop-blur p-1">
        {sorted.map((t, i) => (
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
            index={i}
          />
        ))}
      </div>
    </main>
  );
}

function Bx({
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
      className="font-mono text-[0.6rem] uppercase tracking-[0.14em] px-2.5 py-1.5 rounded border transition-all disabled:opacity-30 hover:translate-y-[-1px]"
      style={{ borderColor: c.border, color: c.text, background: c.bg }}
    >
      {children}
    </button>
  );
}
