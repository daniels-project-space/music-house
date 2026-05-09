"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { use, useEffect, useMemo, useState } from "react";
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
  const setComplete = useMutation(api.albums.setComplete);
  const setDistributed = useMutation(api.tracks.setDistributed);

  // Scroll to a #track-<id> hash once the tracks have loaded.
  useEffect(() => {
    if (!tracks || tracks.length === 0) return;
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash || !hash.startsWith("#track-")) return;
    const el = document.getElementById(hash.slice(1));
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-pink/60");
      const timer = setTimeout(() => el.classList.remove("ring-2", "ring-pink/60"), 2400);
      return () => clearTimeout(timer);
    }
  }, [tracks]);

  const allKeys = useMemo(() => {
    const k: string[] = [];
    if (albumRow?.coverKey) k.push(albumRow.coverKey);
    if (tracks) for (const t of tracks) k.push(t.audioKey);
    return k;
  }, [albumRow?.coverKey, tracks]);
  const urls = useResolvedUrls(allKeys);
  const coverUrl = albumRow?.coverKey ? urls[albumRow.coverKey] ?? null : null;

  const [lyricsTrackId, setLyricsTrackId] = useState<string | null>(null);
  const [lyricsExpanded, setLyricsExpanded] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");

  // Whenever a new track is selected for lyrics, default to collapsed
  useEffect(() => {
    setLyricsExpanded(false);
  }, [lyricsTrackId]);

  if (!tracks || !albumRow) {
    return (
      <main className="px-6 sm:px-10 lg:px-14 pt-6 pb-32">
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-paper-faint">loading…</p>
      </main>
    );
  }

  const sorted = [...tracks]
    .filter((t) => !(t as { archivedAt?: number }).archivedAt)
    .sort((a, b) => (a.trackNum ?? 0) - (b.trackNum ?? 0));
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
  const distributedCount = sorted.filter((t) => (t as { distributed?: boolean }).distributed).length;
  const allDistributed = distributedCount > 0 && distributedCount === sorted.length;
  const isComplete = !!(albumRow as { completedAt?: number }).completedAt;

  const distributeAll = async () => {
    if (!confirm(`Distribute ${sorted.length} track${sorted.length === 1 ? "" : "s"} from this album?`)) return;
    for (const t of sorted) {
      try { await setDistributed({ id: t._id, distributed: true }); } catch {}
    }
  };
  const toggleComplete = async () => {
    try { await setComplete({ id: albumRow._id, completed: !isComplete }); } catch {}
  };

  const lyricsTrack = lyricsTrackId
    ? sorted.find((t) => t._id === lyricsTrackId)
    : current
      ? sorted.find((t) => t._id === current.id)
      : null;

  return (
    <main className="px-6 sm:px-10 lg:px-14 pt-6 pb-32 animate-fi">
      <Link
        href="/library"
        className="inline-flex items-center gap-2 font-mono text-[0.55rem] uppercase tracking-[0.22em] text-paper-faint hover:text-amber transition-colors mb-10"
      >
        ← Library
      </Link>

      <div className="flex flex-col lg:flex-row gap-10 lg:gap-14 items-start mb-14">
        <div className="shrink-0 w-full lg:w-[280px]">
          <div
            className={
              "relative aspect-square rounded-md overflow-hidden bg-surface ring-1 ring-paper/10 transition-transform " +
              (isPlayingThis ? "animate-cover-pulse" : "")
            }
            style={{ boxShadow: "0 24px 60px -20px rgba(0,0,0,0.7), 0 8px 24px -8px rgba(236,72,153,0.12)" }}
          >
            {coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverUrl} alt={albumRow.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full grid place-items-center text-6xl text-paper-faint/30">♪</div>
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-6 pt-1">
          <div>
            <div className="flex items-center gap-2 mb-4">
              {albumRow.section && (
                <span className="font-mono text-[0.5rem] uppercase tracking-[0.2em] text-amber/85 px-2 py-0.5 rounded-full border border-amber/30">
                  {albumRow.section.replace(/_/g, " ")}
                </span>
              )}
              {isComplete && (
                <span className="font-mono text-[0.5rem] uppercase tracking-[0.2em] text-green/85 px-2 py-0.5 rounded-full border border-green/30">
                  ✓ complete
                </span>
              )}
              {allDistributed && (
                <span className="font-mono text-[0.5rem] uppercase tracking-[0.2em] text-cyan/85 px-2 py-0.5 rounded-full border border-cyan/30">
                  📡 distributed
                </span>
              )}
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
                className="w-full font-display text-[2.4rem] sm:text-[2.8rem] lg:text-[3.2rem] font-extrabold leading-[0.98] tracking-[-0.02em] text-paper bg-transparent outline-none border-b border-pink/40 pb-1"
              />
            ) : (
              <h1
                className="font-display text-[2.4rem] sm:text-[2.8rem] lg:text-[3.2rem] font-extrabold leading-[0.98] tracking-[-0.02em] text-paper cursor-text"
                onDoubleClick={() => { setDraftName(albumRow.name); setEditingName(true); }}
                title="Double-click to rename"
              >
                {albumRow.name}
              </h1>
            )}

            <p className="mt-4 font-mono text-[0.62rem] uppercase tracking-[0.2em] text-paper-faint">
              {artist.replace(/_/g, " ")} <span className="text-paper-faint/40 mx-2">·</span> {sorted.length} {sorted.length === 1 ? "track" : "tracks"} <span className="text-paper-faint/40 mx-2">·</span> {durMin} min
            </p>
          </div>

          {albumRow.description && (
            <p className="text-[0.92rem] text-paper-dim leading-relaxed max-w-2xl font-display font-light">{albumRow.description}</p>
          )}

          <div className="flex items-center gap-2 flex-wrap pt-2">
            <button
              onClick={playAll}
              disabled={!queue.length}
              className="px-5 py-2.5 rounded-full font-display text-[0.78rem] font-semibold text-paper transition-all disabled:opacity-30 hover:scale-[1.02] disabled:hover:scale-100"
              style={{ background: "linear-gradient(135deg, #ec4899, #8b5cf6)", boxShadow: "0 4px 16px rgba(236,72,153,0.32)" }}
            >
              ▶ Play all
            </button>
            <Btn onClick={shuffle} disabled={!queue.length}>⤮ Shuffle</Btn>
            <ShareBtn artist={artist} album={album} albumName={albumRow.name} />
            <div className="ml-auto flex items-center gap-2">
              <Btn onClick={toggleComplete} variant={isComplete ? "green" : "subtle"}>
                {isComplete ? "✓ Complete" : "Mark complete"}
              </Btn>
              <Btn onClick={distributeAll} disabled={allDistributed} variant="amber">
                📡 {allDistributed ? "Distributed" : `Distribute${distributedCount > 0 ? ` (${sorted.length - distributedCount})` : ""}`}
              </Btn>
            </div>
          </div>
        </div>
      </div>

      {lyricsTrack && (
        <div className="rounded-md border border-brd/60 bg-bg2/40 mb-10 max-w-3xl overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-paper/[0.03] transition-colors">
            <button
              type="button"
              onClick={() => setLyricsExpanded((v) => !v)}
              className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
              aria-expanded={lyricsExpanded}
            >
              <span
                className="font-mono text-[0.65rem] text-paper-dim transition-transform"
                style={{ transform: lyricsExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
              >
                ▶
              </span>
              <span className="font-mono text-[0.55rem] uppercase tracking-[0.22em] text-purple truncate">
                Lyrics · {lyricsTrack.title}
              </span>
              {!lyricsExpanded ? (
                <span className="font-mono text-[0.5rem] uppercase tracking-[0.18em] text-paper-faint">
                  ({lyricsTrack.lyrics?.length ? `${lyricsTrack.lyrics.length} lines` : "no lyrics"})
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setLyricsTrackId(null)}
              className="font-mono text-[0.5rem] uppercase tracking-[0.18em] text-paper-faint hover:text-paper px-1.5 py-0.5"
            >
              ✕
            </button>
          </div>
          {lyricsExpanded ? (
            <div className="px-5 pb-5">
              <KaraokeLyrics
                title={lyricsTrack.title}
                lyrics={lyricsTrack.lyrics ?? []}
                trackId={lyricsTrack._id}
              />
            </div>
          ) : null}
        </div>
      )}

      <div className="border-t border-brd/40 pt-6">
        <p className="font-mono text-[0.5rem] uppercase tracking-[0.22em] text-paper-faint mb-4">Tracks</p>
        <div className="rounded-md bg-card/30 backdrop-blur p-2 space-y-0.5">
          {sorted.map((t, i) => (
            <div key={t._id} id={`track-${t._id}`} className="scroll-mt-24">
              <TrackRow
                trackId={t._id}
                trackNum={t.trackNum}
                title={t.title}
                artistSlug={t.artistSlug}
                albumSlug={t.albumSlug}
                duration={t.duration}
                generator={t.generator}
                audioKey={t.audioKey}
                coverKey={t.coverKey ?? albumRow?.coverKey}
                hearted={hearted.has(t._id)}
                onShowLyrics={() => setLyricsTrackId(t._id)}
                queue={queue}
                index={i}
                size="comfortable"
                genre={t.genre}
                createdAt={t.createdAt}
                lyrics={t.lyrics}
              />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

function ShareBtn({ artist, album, albumName }: { artist: string; album: string; albumName: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    const url = `https://mh-listen.vercel.app/${artist}/${album}`;
    try {
      const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
      if (nav.share) {
        await nav.share({ title: albumName, url });
      } else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }
    } catch {}
  };
  return (
    <Btn onClick={onClick}>{copied ? "✓ Copied" : "🔗 Share"}</Btn>
  );
}

function Btn({
  children,
  onClick,
  disabled,
  variant = "default",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "subtle" | "green" | "amber";
}) {
  const styles: Record<string, { border: string; bg: string; color: string; hover: string }> = {
    default: { border: "rgba(255,255,255,0.12)", bg: "transparent", color: "var(--color-paper)", hover: "rgba(255,255,255,0.04)" },
    subtle: { border: "rgba(255,255,255,0.08)", bg: "transparent", color: "rgba(226,232,240,0.65)", hover: "rgba(255,255,255,0.04)" },
    green: { border: "rgba(52,211,153,0.4)", bg: "rgba(52,211,153,0.06)", color: "#34d399", hover: "rgba(52,211,153,0.1)" },
    amber: { border: "rgba(251,191,36,0.35)", bg: "rgba(251,191,36,0.04)", color: "#fbbf24", hover: "rgba(251,191,36,0.08)" },
  };
  const s = styles[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-3.5 py-2 rounded-full font-mono text-[0.6rem] uppercase tracking-[0.16em] border transition-colors disabled:opacity-30 hover:!bg-[var(--btn-hover)]"
      style={{ borderColor: s.border, color: s.color, background: s.bg, ["--btn-hover" as string]: s.hover }}
    >
      {children}
    </button>
  );
}
