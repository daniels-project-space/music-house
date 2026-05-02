"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Props = {
  artist: string;
  slug: string;
  name: string;
  trackCount: number;
  coverKey?: string;
  isSuno?: boolean;
};

export function AlbumCard({ artist, slug, name, trackCount, coverKey, isSuno }: Props) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!coverKey) return;
    fetch(`/api/audio?key=${encodeURIComponent(coverKey)}`)
      .then((r) => r.json())
      .then((j) => setCoverUrl(j.url ?? null))
      .catch(() => {});
  }, [coverKey]);

  return (
    <Link
      href={`/library/${artist}/${slug}`}
      className={`block bg-card border ${isSuno ? "border-pink/20" : "border-brd"} rounded-[var(--radius-default)] overflow-hidden card-hover`}
    >
      <div className="relative aspect-square bg-gradient-to-br from-[#1e293b] to-[#0f172a] grid place-items-center">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverUrl} alt={name} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
        ) : (
          <span className="text-4xl text-t4">♪</span>
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/70" />
        <span className="absolute bottom-2 right-2 font-mono text-[0.55rem] px-1.5 py-0.5 rounded bg-black/70 text-t2 backdrop-blur">
          {trackCount} trk
        </span>
      </div>
      <div className="p-3">
        <h3 className="text-[0.85rem] font-bold truncate">{name}</h3>
        <p className="font-mono text-[0.58rem] text-t3 mt-0.5 truncate">{artist}</p>
      </div>
    </Link>
  );
}
