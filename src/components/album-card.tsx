"use client";
import Link from "next/link";
import { useUrlCache } from "./url-cache-provider";
import type { Id } from "../../convex/_generated/dataModel";

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
  const { get } = useUrlCache();
  const coverUrl = coverKey ? get(coverKey) : undefined;

  const onDragStart = (e: React.DragEvent) => {
    if (!albumId) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-mh-album", JSON.stringify({ albumId, section }));
  };

  return (
    <Link
      href={`/library/${artist}/${slug}`}
      draggable={!!albumId}
      onDragStart={onDragStart}
      className="group block rounded-xl overflow-hidden bg-card border card-hover"
      style={{ borderColor: "var(--color-brd)" }}
    >
      <div className="relative aspect-square">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverUrl}
            alt={name}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#1e293b] via-[#0f172a] to-[#0a0c12] grid place-items-center text-5xl text-t4/60 animate-breathe">
            ♪
          </div>
        )}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "linear-gradient(180deg, transparent 50%, rgba(5,6,8,0.85) 100%)" }}
        />
        <span
          className="absolute bottom-2.5 right-2.5 font-mono text-[0.55rem] px-2 py-0.5 rounded backdrop-blur"
          style={{ background: "rgba(5,6,8,0.7)", color: "#94a3b8" }}
        >
          {trackCount} trk
        </span>
      </div>
      <div className="px-3.5 py-3">
        <h3 className="font-display text-[0.95rem] font-semibold tracking-tight truncate text-paper">
          {name}
        </h3>
        <p className="mt-0.5 font-mono text-[0.6rem] uppercase tracking-[0.16em] text-amber/85 truncate font-semibold">
          {artist}
        </p>
      </div>
    </Link>
  );
}
