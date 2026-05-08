"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { usePlayer, type PlayerTrack } from "./player-context";
import { useUrlCache } from "./url-cache-provider";

type TrackRowProps = {
  trackId: Id<"tracks">;
  trackNum?: number;
  title: string;
  artistSlug: string;
  albumSlug?: string;
  duration?: number;
  generator: "suno" | "mureka" | "import";
  audioKey: string;
  coverUrl?: string;
  hearted: boolean;
  onShowLyrics?: () => void;
  queue?: PlayerTrack[];
  index?: number;
  size?: "compact" | "comfortable";
  genre?: string;
};

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
  const removeTrack = useMutation(api.tracks.remove);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  useEffect(() => setDraftTitle(title), [title]);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const { play, current } = usePlayer();
  const { ensure, get } = useUrlCache();
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveSubmenu, setMoveSubmenu] = useState(false);
  const [dragOver, setDragOver] = useState<"above" | "below" | null>(null);
  const [distributing, setDistributing] = useState(false);
  const [distributePanelOpen, setDistributePanelOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const albumsForArtist = useQuery(
    api.albums.list,
    menuOpen && moveSubmenu ? { artistSlug } : "skip",
  );
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
        setMoveSubmenu(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const doMove = async (targetAlbumSlug: string | undefined) => {
    await move({ id: trackId, targetArtistSlug: artistSlug, targetAlbumSlug });
    setMenuOpen(false);
    setMoveSubmenu(false);
  };

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
    const url = get(audioKey) ?? (await ensure([audioKey]))[audioKey];
    if (!url) return;
    play(
      { id: trackId, title, artist: artistSlug, album: albumSlug, audioUrl: url, coverUrl },
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
          <span className={"ml-1.5 " + (size === "comfortable" ? "text-[0.55rem]" : "text-[0.46rem]")} style={{ color: generator === "suno" ? "#ec4899" : "#8b5cf6" }}>◆ {generator}</span>{genre ? <span className={"ml-2 px-1.5 py-0.5 rounded " + (size === "comfortable" ? "text-[0.5rem]" : "text-[0.44rem]")} style={{ background: "rgba(139,92,246,0.08)", color: "#a78bfa" }}>{genre}</span> : null}
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
            {moveSubmenu ? (
              <>
                <Item icon="←" label="Back" onClick={() => setMoveSubmenu(false)} />
                <div className="my-1 mx-2 h-px bg-brd" />
                <div className="max-h-64 overflow-y-auto">
                  {albumSlug ? (
                    <Item icon="∅" label="Unsorted" onClick={() => doMove(undefined)} />
                  ) : null}
                  {albumsForArtist === undefined ? (
                    <div className="px-3 py-1.5 text-[0.65rem] text-t4 font-mono">Loading…</div>
                  ) : (
                    (() => {
                      const others = albumsForArtist.filter((a) => a.slug !== albumSlug);
                      if (others.length === 0 && !albumSlug) {
                        return (
                          <div className="px-3 py-1.5 text-[0.65rem] text-t4 font-mono">No albums</div>
                        );
                      }
                      return others.map((a) => (
                        <Item
                          key={a._id}
                          icon="♫"
                          label={a.name}
                          onClick={() => doMove(a.slug)}
                        />
                      ));
                    })()
                  )}
                </div>
              </>
            ) : (
              <>
                <Item icon="✎" label="Rename" onClick={() => { setMenuOpen(false); setEditing(true); }} />
                <Item icon="♪" label="Lyrics" onClick={() => { setMenuOpen(false); onShowLyrics?.(); }} />
                <Item icon="→" label="Move to…" onClick={() => setMoveSubmenu(true)} />
                <Item icon="📡" label="Distribute" onClick={startDistribute} />
                <Item icon="✓" label="Mark distributed" onClick={() => { setDistributed({ id: trackId, distributed: true }); setMenuOpen(false); }} />
                <Item icon="📦" label="Archive" onClick={() => { archive({ id: trackId }); setMenuOpen(false); }} />
                <div className="my-1 mx-2 h-px bg-brd" />
                <Item
                  icon="🗑"
                  label="Delete"
                  danger
                  onClick={() => {
                    if (confirm(`Delete "${title}" permanently?`)) removeTrack({ id: trackId });
                    setMenuOpen(false);
                  }}
                />
              </>
            )}
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
            <div className="font-mono text-t3 text-[0.7rem] mb-4">DistroKid via Stagehand</div>
            {distributing || !distributionJob ? (
              <div className="font-mono text-t3 text-[0.75rem]">Starting browser session…</div>
            ) : distributionJob.status === "pending" || distributionJob.status === "running" ? (
              <div className="font-mono text-t3 text-[0.75rem]">
                {distributionJob.status === "pending" ? "Queued…" : "Filling DistroKid form…"}
              </div>
            ) : distributionJob.status === "draft_ready" && distributionJob.liveViewUrl ? (
              <>
                <div className="font-mono text-t2 text-[0.75rem] mb-3">
                  Draft ready. Open the live browser session below, review the metadata DistroKid filled, then click submit on their page.
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
                  I submitted on DistroKid · mark complete
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
