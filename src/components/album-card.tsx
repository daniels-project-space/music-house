"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { useUrlCache } from "./url-cache-provider";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { AlbumEditModal } from "./album-edit-modal";

type Props = {
  albumId?: Id<"albums">;
  artist: string;
  slug: string;
  name: string;
  trackCount: number;
  coverKey?: string;
  section?: string;
};

export function AlbumCard({ albumId, artist, slug, name, trackCount, coverKey, section }: Props) {
  const router = useRouter();
  const { get } = useUrlCache();
  const coverUrl = coverKey ? get(coverKey) : undefined;
  const moveTrack = useMutation(api.tracks.move);
  const removeAlbum = useMutation(api.albums.removeAndOrphan);
  const [trackOver, setTrackOver] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const href = `/library/${artist}/${slug}`;

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const onDragStart = (e: React.DragEvent) => {
    if (!albumId) return;
    e.stopPropagation();
    try {
      e.dataTransfer.clearData();
    } catch {}
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-mh-album", JSON.stringify({ albumId, section }));
    e.dataTransfer.setData("text/plain", `album:${albumId}`);
  };

  const onDragOver = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types ?? []);
    if (types.includes("application/x-mh-track")) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      setTrackOver(true);
    }
  };
  const onDragLeave = () => setTrackOver(false);
  const onDrop = async (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types ?? []);
    console.log("[mh-drop]", types, "on", artist, slug);
    if (!types.includes("application/x-mh-track")) return;
    e.preventDefault();
    e.stopPropagation();
    setTrackOver(false);
    const raw = e.dataTransfer.getData("application/x-mh-track");
    console.log("[mh-drop] raw:", raw);
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as { trackId: Id<"tracks">; artistSlug: string; albumSlug?: string };
      if (data.artistSlug === artist && data.albumSlug === slug) {
        console.log("[mh-drop] same album, skip");
        return;
      }
      console.log("[mh-drop] calling moveTrack", data.trackId, "→", artist, slug);
      await moveTrack({ id: data.trackId, targetArtistSlug: artist, targetAlbumSlug: slug });
      console.log("[mh-drop] moveTrack done");
    } catch (err) {
      console.error("[mh-drop] err:", err);
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!albumId) return;
    if (!confirm(`Delete album "${name}"? ${trackCount} track${trackCount === 1 ? "" : "s"} will become singles.`)) return;
    try { await removeAlbum({ id: albumId }); } catch (err) { console.error("album delete:", err); }
  };

  const onClick = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    router.push(href);
  };

  return (
    <div
      role="link"
      tabIndex={0}
      draggable={!!albumId}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") router.push(href);
      }}
      data-album-id={albumId ?? ""}
      data-album-href={href}
      className={
        "album-card group block rounded-lg overflow-hidden bg-card border card-hover relative cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-pink/60 " +
        (trackOver ? "ring-2 ring-pink scale-[1.03]" : "")
      }
      style={{ borderColor: trackOver ? "rgba(236,72,153,0.7)" : "var(--color-brd)" }}
    >
      <div className="relative aspect-square">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverUrl}
            alt={name}
            loading="lazy"
            draggable={false}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 pointer-events-none"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#1e293b] via-[#0f172a] to-[#0a0c12] grid place-items-center text-4xl text-t4/60">
            ♪
          </div>
        )}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "linear-gradient(180deg, transparent 55%, rgba(5,6,8,0.85) 100%)" }}
        />
        <div className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
          <div
            className="w-11 h-11 rounded-full grid place-items-center transform scale-90 group-hover:scale-100 transition-transform duration-200"
            style={{ background: "linear-gradient(135deg, #ec4899, #8b5cf6)", boxShadow: "0 4px 20px rgba(236,72,153,0.4)" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
          </div>
        </div>
        <span
          className="absolute bottom-1.5 right-1.5 font-mono text-[0.5rem] px-1.5 py-[1px] rounded backdrop-blur tabular-nums pointer-events-none"
          style={{ background: "rgba(5,6,8,0.7)", color: "#94a3b8" }}
        >
          {trackCount} trk
        </span>
        {albumId && (
          <div ref={menuRef} className="absolute top-1.5 right-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setMenuOpen((v) => !v);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className={"w-6 h-6 rounded-full grid place-items-center transition-all text-paper hover:scale-110 " + (menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
              style={{ background: "rgba(5,6,8,0.85)", border: "1px solid rgba(255,255,255,0.12)", backdropFilter: "blur(8px)" }}
              aria-label={`Album menu for ${name}`}
              title="Album menu"
            >
              <span className="font-bold leading-none -mt-0.5">⋮</span>
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-7 z-30 w-36 rounded-md border bg-elevated shadow-2xl py-1 animate-fi"
                style={{ borderColor: "var(--color-brd)" }}
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setMenuOpen(false);
                    setEditOpen(true);
                  }}
                  className="w-full px-3 py-1.5 text-[0.7rem] text-left flex items-center gap-2.5 text-paper hover:bg-purple/[0.08] hover:text-purple transition-colors"
                >
                  <span className="text-[0.75rem] w-4 text-center">✎</span>
                  <span className="font-display">Edit</span>
                </button>
                <div className="my-1 mx-2 h-px bg-brd" />
                <button
                  type="button"
                  onClick={(e) => {
                    setMenuOpen(false);
                    handleDelete(e);
                  }}
                  className="w-full px-3 py-1.5 text-[0.7rem] text-left flex items-center gap-2.5 text-red hover:bg-red/[0.06] transition-colors"
                >
                  <span className="text-[0.75rem] w-4 text-center">🗑</span>
                  <span className="font-display">Delete</span>
                </button>
              </div>
            )}
          </div>
        )}
        {trackOver && (
          <div className="absolute inset-0 grid place-items-center pointer-events-none" style={{ background: "rgba(236,72,153,0.22)" }}>
            <span className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-pink font-bold">drop here</span>
          </div>
        )}
      </div>
      <div className="px-3 pt-2.5 pb-3 pointer-events-none">
        <h3 className="font-display text-[0.82rem] font-semibold tracking-tight truncate text-paper leading-tight">
          {name}
        </h3>
        <p className="mt-1 font-mono text-[0.55rem] uppercase tracking-[0.14em] text-amber/70 truncate">
          {artist}
        </p>
      </div>
      {albumId ? (
        <AlbumEditModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          albumId={albumId}
        />
      ) : null}
    </div>
  );
}
