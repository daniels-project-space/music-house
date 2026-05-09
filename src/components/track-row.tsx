"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { usePlayer, type PlayerTrack } from "./player-context";
import { useUrlCache } from "./url-cache-provider";
import { MoveToModal } from "./move-to-modal";

type LyricLine = { text: string; start: number; isSection: boolean };

type TrackRowProps = {
  trackId: Id<"tracks">;
  trackNum?: number;
  title: string;
  artistSlug: string;
  albumSlug?: string;
  duration?: number;
  generator: "suno" | "mureka" | "import";
  audioKey: string;
  /** Either pass a resolved coverUrl or a coverKey for auto-resolution */
  coverUrl?: string;
  coverKey?: string;
  hearted: boolean;
  onShowLyrics?: () => void;
  /** Track's lyrics (used by built-in fallback modal when onShowLyrics isn't provided) */
  lyrics?: LyricLine[];
  queue?: PlayerTrack[];
  index?: number;
  size?: "compact" | "comfortable";
  genre?: string;
  createdAt?: number;
};

function formatRelative(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 0) return new Date(ts).toLocaleDateString();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const date = new Date(ts);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" });
}

export function TrackRow({
  trackId,
  trackNum,
  title,
  artistSlug,
  albumSlug,
  duration,
  generator,
  audioKey,
  coverUrl,
  coverKey,
  createdAt,
  lyrics,
  hearted,
  onShowLyrics,
  queue,
  index,
  size = "compact",
  genre,
}: TrackRowProps) {
  const toggleHeart = useMutation(api.hearts.toggle);
  const archive = useMutation(api.tracks.archive);
  const reorder = useMutation(api.tracks.reorder);
  const move = useMutation(api.tracks.move);
  const rename = useMutation(api.tracks.rename);
  const setDistributed = useMutation(api.tracks.setDistributed);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  useEffect(() => setDraftTitle(title), [title]);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const { play, current } = usePlayer();
  const { ensure, get } = useUrlCache();
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [dragOver, setDragOver] = useState<"above" | "below" | null>(null);
  const [distributing, setDistributing] = useState(false);
  const [distributePanelOpen, setDistributePanelOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const distributionJob = useQuery(
    api.distribution.byTrack,
    distributePanelOpen ? { trackId } : "skip",
  );
  const setDistributionComplete = useMutation(api.distribution.setComplete);

  useEffect(() => {
    if (audioKey) ensure([audioKey]);
  }, [audioKey, ensure]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const startDistribute = async () => {
    setMenuOpen(false);
    setDistributePanelOpen(true);
    setDistributing(true);
    try {
      const r = await fetch("/api/distribute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trackId }),
      });
      if (!r.ok) {
        const text = await r.text();
        alert(`Distribute failed to start: ${text}`);
        setDistributePanelOpen(false);
      }
    } catch (e) {
      alert(`Distribute failed to start: ${(e as Error).message}`);
      setDistributePanelOpen(false);
    } finally {
      setDistributing(false);
    }
  };

  const isPlaying = current?.id === trackId;
  const mins = duration ? Math.floor(duration / 60) : 0;
  const secs = duration ? Math.floor(duration % 60) : 0;
  const dur = duration ? `${mins}:${secs.toString().padStart(2, "0")}` : "—";

  const handlePlay = async () => {
    const audioUrl = get(audioKey) ?? (await ensure([audioKey]))[audioKey];
    if (!audioUrl) return;
    let resolvedCover = coverUrl;
    if (!resolvedCover && coverKey) {
      resolvedCover = get(coverKey) ?? (await ensure([coverKey]))[coverKey];
    }
    play(
      { id: trackId, title, artist: artistSlug, album: albumSlug, audioUrl, coverUrl: resolvedCover },
      queue,
    );
  };

  const onDragStart = (e: React.DragEvent) => {
    console.log("[mh-dragstart] track", trackId, title);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-mh-track", JSON.stringify({ trackId, artistSlug, albumSlug }));
    e.dataTransfer.setData("text/plain", `track:${trackId}`);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("application/x-mh-track")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const r = e.currentTarget.getBoundingClientRect();
    setDragOver(e.clientY < r.top + r.height / 2 ? "above" : "below");
  };
  const onDragLeave = () => setDragOver(null);
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const raw = e.dataTransfer.getData("application/x-mh-track");
    if (!raw) return;
    const data = JSON.parse(raw) as { trackId: Id<"tracks">; artistSlug: string; albumSlug?: string };
    if (data.trackId === trackId) return;
    const targetPos = (index ?? 0) + (dragOver === "below" ? 1 : 0);
    if (data.artistSlug === artistSlug && data.albumSlug === albumSlug) {
      await reorder({ id: data.trackId, position: targetPos });
    } else {
      await move({ id: data.trackId, targetArtistSlug: artistSlug, targetAlbumSlug: albumSlug, targetPosition: targetPos + 1 });
    }
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={
        (size === "comfortable"
          ? "track-row group flex items-center gap-3.5 px-4 py-3 rounded-md transition-colors relative "
          : "track-row group flex items-center gap-2.5 px-2.5 py-1.5 rounded transition-colors relative ") +
        (isPlaying ? "now-playing-bar bg-purple/10" : "hover:bg-paper/[0.03]") +
        (dragOver === "above" ? " drag-above" : "") +
        (dragOver === "below" ? " drag-below" : "")
      }
    >
      <span className="drag-handle text-[0.62rem] select-none w-3 shrink-0 cursor-grab active:cursor-grabbing text-t4">⋮⋮</span>
      <span className={"font-mono text-t4 text-right shrink-0 tabular-nums " + (size === "comfortable" ? "text-[0.7rem] w-7" : "text-[0.56rem] w-5")}>{trackNum ?? "—"}</span>
      <button
        onClick={handlePlay}
        className={
          (size === "comfortable" ? "w-9 h-9 " : "w-6 h-6 ") + "rounded-full grid place-items-center transition-all shrink-0 " +
          (isPlaying ? "bg-pink/15 text-pink" : "bg-purple/10 text-purple hover:bg-purple/25 hover:scale-110")
        }
        aria-label="Play"
      >
        <svg width={size === "comfortable" ? 12 : 9} height={size === "comfortable" ? 12 : 9} viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
      </button>
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            ref={titleRef}
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={async () => {
              const t = draftTitle.trim();
              if (t && t !== title) {
                try { await rename({ id: trackId, title: t }); } catch { setDraftTitle(title); }
              } else {
                setDraftTitle(title);
              }
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
              if (e.key === "Escape") { setDraftTitle(title); setEditing(false); }
            }}
            autoFocus
            className="w-full bg-transparent outline-none font-display text-[0.83rem] font-medium text-paper border-b border-pink/40 pb-0.5"
          />
        ) : (
          <div
            className={(size === "comfortable" ? "text-[0.92rem] " : "text-[0.76rem] ") + "truncate font-display font-medium cursor-text leading-tight " + (isPlaying ? "text-purple" : "text-paper")}
            onDoubleClick={() => setEditing(true)}
            title="Double-click to rename"
          >
            {title}
          </div>
        )}
        <div className={"font-mono text-t3 truncate leading-tight " + (size === "comfortable" ? "text-[0.62rem] mt-1" : "text-[0.5rem] mt-0.5")}>
          {artistSlug}
          {albumSlug ? " · " + albumSlug : ""}
          <span className={"ml-1.5 " + (size === "comfortable" ? "text-[0.55rem]" : "text-[0.46rem]")} style={{ color: generator === "suno" ? "#ec4899" : "#8b5cf6" }}>◆ {generator}</span>{genre ? <span className={"ml-2 px-1.5 py-0.5 rounded " + (size === "comfortable" ? "text-[0.5rem]" : "text-[0.44rem]")} style={{ background: "rgba(139,92,246,0.08)", color: "#a78bfa" }}>{genre}</span> : null}{createdAt ? <span className={"ml-2 " + (size === "comfortable" ? "text-[0.5rem]" : "text-[0.44rem]")} title={new Date(createdAt).toLocaleString()}>· {formatRelative(createdAt)}</span> : null}
        </div>
      </div>
      <span className={"font-mono text-t3 text-right shrink-0 tabular-nums " + (size === "comfortable" ? "text-[0.68rem] w-12" : "text-[0.56rem] w-9")}>{dur}</span>
      <button
        onClick={() => toggleHeart({ trackId })}
        className={(size === "comfortable" ? "w-8 h-8 " : "w-6 h-6 ") + "grid place-items-center transition-all shrink-0 " + (hearted ? "text-pink animate-pulse-dot" : "text-t4 hover:text-pink")}
        aria-label={hearted ? "Unheart" : "Heart"}
      >
        <svg width={size === "comfortable" ? 15 : 12} height={size === "comfortable" ? 15 : 12} viewBox="0 0 24 24" fill={hearted ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
          <path d="M12 21s-7-4.35-7-10a4.5 4.5 0 0 1 8-2.83A4.5 4.5 0 0 1 19 11c0 5.65-7 10-7 10z" />
        </svg>
      </button>
      <div className="relative shrink-0" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((m) => !m)}
          className="track-menu-btn w-5 h-6 grid place-items-center text-t3 hover:text-paper transition-colors"
          aria-label="More"
        >
          ⋮
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 top-9 z-30 w-44 rounded-md border bg-elevated shadow-2xl py-1 animate-fi"
            style={{ borderColor: "var(--color-brd)" }}
          >
            <Item icon="✎" label="Rename" onClick={() => { setMenuOpen(false); setEditing(true); }} />
            <Item icon="♪" label="Lyrics" onClick={() => { setMenuOpen(false); if (onShowLyrics) onShowLyrics(); else setLyricsOpen(true); }} />
            <Item icon="→" label="Move to…" onClick={() => { setMenuOpen(false); setMoveModalOpen(true); }} />
            <Item icon="📡" label="Distribute" onClick={startDistribute} />
            <Item icon="✓" label="Mark distributed" onClick={() => { setDistributed({ id: trackId, distributed: true }); setMenuOpen(false); }} />
            <div className="my-1 mx-2 h-px bg-brd" />
            <Item
              icon="🗑"
              label="Delete"
              danger
              onClick={() => {
                archive({ id: trackId });
                setMenuOpen(false);
              }}
            />
          </div>
        )}
      </div>
      {distributePanelOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm" onClick={() => setDistributePanelOpen(false)}>
          <div
            className="w-full max-w-md rounded-lg border bg-elevated p-5 shadow-2xl"
            style={{ borderColor: "var(--color-brd)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-display text-paper text-base mb-1">Distribute · {title}</div>
            <div className="font-mono text-t3 text-[0.7rem] mb-4">RouteNote via Stagehand</div>
            {distributing || !distributionJob ? (
              <div className="font-mono text-t3 text-[0.75rem]">Starting browser session…</div>
            ) : distributionJob.status === "pending" || distributionJob.status === "running" ? (
              <div className="font-mono text-t3 text-[0.75rem]">
                {distributionJob.status === "pending" ? "Queued…" : "Filling DistroKid form…"}
              </div>
            ) : distributionJob.status === "draft_ready" && distributionJob.liveViewUrl ? (
              <>
                <div className="font-mono text-t2 text-[0.75rem] mb-3">
                  Draft ready. Open the live browser session below, review the metadata RouteNote filled, then click submit on their page.
                </div>
                <a
                  href={distributionJob.liveViewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full rounded-md bg-purple px-3 py-2 text-center font-display text-paper text-[0.8rem] hover:bg-purple/80 transition-colors"
                >
                  Open Browserbase live view ↗
                </a>
                <button
                  onClick={async () => {
                    await setDistributionComplete({ id: distributionJob._id, releaseUrl: undefined });
                    setDistributePanelOpen(false);
                  }}
                  className="mt-2 w-full rounded-md border px-3 py-2 font-display text-paper text-[0.75rem] hover:bg-paper/[0.04] transition-colors"
                  style={{ borderColor: "var(--color-brd)" }}
                >
                  I submitted on RouteNote · mark complete
                </button>
              </>
            ) : distributionJob.status === "failed" ? (
              <div className="font-mono text-red text-[0.7rem] whitespace-pre-wrap">
                Failed: {distributionJob.error ?? "unknown error"}
              </div>
            ) : (
              <div className="font-mono text-t2 text-[0.75rem]">Marked complete.</div>
            )}
            <button
              onClick={() => setDistributePanelOpen(false)}
              className="mt-4 w-full text-center font-mono text-t4 text-[0.65rem] hover:text-paper transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
      <MoveToModal
        open={moveModalOpen}
        onClose={() => setMoveModalOpen(false)}
        trackId={trackId}
        defaultArtistSlug={artistSlug}
        currentAlbumSlug={albumSlug}
      />
      {lyricsOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm animate-fi p-4"
          onClick={() => setLyricsOpen(false)}
        >
          <div
            className="w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-lg border bg-elevated p-5 shadow-2xl"
            style={{ borderColor: "var(--color-brd)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3 pb-3" style={{ borderBottom: "1px solid var(--color-brd)" }}>
              <div>
                <p className="font-display text-paper text-[1rem] font-semibold leading-tight">{title}</p>
                <p className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-paper-faint mt-1">Lyrics</p>
              </div>
              <button
                onClick={() => setLyricsOpen(false)}
                className="font-mono text-[0.7rem] text-t3 hover:text-paper transition-colors"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            {lyrics && lyrics.length > 0 ? (
              <div className="space-y-1">
                {lyrics.map((l, i) =>
                  l.isSection ? (
                    <p key={i} className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-purple mt-3 first:mt-0">
                      {l.text}
                    </p>
                  ) : (
                    <p key={i} className="font-display text-[0.85rem] text-paper leading-relaxed">
                      {l.text}
                    </p>
                  ),
                )}
              </div>
            ) : (
              <p className="font-mono text-[0.7rem] text-paper-faint py-6 text-center">
                No lyrics saved on this track.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Item({ icon, label, onClick, danger }: { icon: string; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={"w-full px-3 py-1.5 text-[0.7rem] text-left flex items-center gap-2.5 transition-colors " + (danger ? "text-red hover:bg-red/[0.06]" : "text-paper hover:bg-purple/[0.08] hover:text-purple")}
    >
      <span className="text-[0.75rem] w-4 text-center">{icon}</span>
      <span className="font-display">{label}</span>
    </button>
  );
}

export function useHeartedSet(): Set<string> {
  const list = useQuery(api.hearts.list, {});
  return new Set((list ?? []).map((h) => h.trackId));
}
