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
  const [dragOver, setDragOver] = useState<"above" | "below" | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (audioKey) ensure([audioKey]);
  }, [audioKey, ensure]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

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
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-mh-track", JSON.stringify({ trackId, artistSlug, albumSlug }));
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
        "track-row group flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors relative " +
        (isPlaying ? "now-playing-bar bg-purple/10" : "hover:bg-paper/[0.025]") +
        (dragOver === "above" ? " drag-above" : "") +
        (dragOver === "below" ? " drag-below" : "")
      }
    >
      <span className="drag-handle text-[0.7rem] select-none w-4 shrink-0 cursor-grab active:cursor-grabbing">⋮⋮</span>
      <span className="font-mono text-[0.62rem] text-t4 w-6 text-right shrink-0 tabular-nums">{trackNum ?? "—"}</span>
      <button
        onClick={handlePlay}
        className={
          "w-7 h-7 rounded-full grid place-items-center transition-all shrink-0 " +
          (isPlaying ? "bg-pink/15 text-pink" : "bg-purple/10 text-purple hover:bg-purple/25 hover:scale-110")
        }
        aria-label="Play"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
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
            className={"text-[0.83rem] truncate font-display font-medium cursor-text " + (isPlaying ? "text-purple" : "text-paper")}
            onDoubleClick={() => setEditing(true)}
            title="Double-click to rename"
          >
            {title}
          </div>
        )}
        <div className="font-mono text-[0.56rem] text-t3 mt-0.5 truncate">
          {artistSlug}
          {albumSlug ? " · " + albumSlug : ""}
          <span className="ml-2 text-[0.5rem]" style={{ color: generator === "suno" ? "#ec4899" : "#8b5cf6" }}>◆ {generator}</span>
        </div>
      </div>
      <span className="font-mono text-[0.62rem] text-t3 w-10 text-right shrink-0 tabular-nums">{dur}</span>
      <button
        onClick={() => toggleHeart({ trackId })}
        className={"w-7 h-7 grid place-items-center transition-all shrink-0 " + (hearted ? "text-pink animate-pulse-dot" : "text-t4 hover:text-pink")}
        aria-label={hearted ? "Unheart" : "Heart"}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill={hearted ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
          <path d="M12 21s-7-4.35-7-10a4.5 4.5 0 0 1 8-2.83A4.5 4.5 0 0 1 19 11c0 5.65-7 10-7 10z" />
        </svg>
      </button>
      <div className="relative shrink-0" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((m) => !m)}
          className="track-menu-btn w-6 h-7 grid place-items-center text-t3 hover:text-paper transition-colors"
          aria-label="More"
        >
          ⋮
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-9 z-30 w-40 rounded-md border bg-elevated shadow-2xl py-1 animate-fi" style={{ borderColor: "var(--color-brd)" }}>
            <Item icon="✎" label="Rename" onClick={() => { setMenuOpen(false); setEditing(true); }} />
            <Item icon="♪" label="Lyrics" onClick={() => { setMenuOpen(false); onShowLyrics?.(); }} />
            <Item icon="📡" label="Distribute" onClick={() => { setDistributed({ id: trackId, distributed: true }); setMenuOpen(false); }} />
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
          </div>
        )}
      </div>
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
