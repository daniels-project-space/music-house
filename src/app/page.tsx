"use client";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export default function Home() {
  const albums = useQuery(api.albums.list, {});
  const tracks = useQuery(api.tracks.list, {});
  const stats = {
    albums: albums?.length ?? 0,
    tracks: tracks?.length ?? 0,
  };
  return (
    <main className="min-h-dvh">
      <header className="border-b border-rule-soft/60">
        <div className="max-w-[1440px] mx-auto px-8 lg:px-14 pt-12 pb-10">
          <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-amber/80">Music House / 2026</p>
          <h1 className="mt-2 font-display text-[64px] leading-[1.02] tracking-tight text-paper">
            Music <span className="italic text-paper-dim">House</span>
          </h1>
          <p className="mt-3 max-w-xl text-paper-dim text-[15px] leading-relaxed">
            AI music label. Generate with Suno or Mureka, organize into artists and albums,
            keep timestamped lyrics, hearts, and distribution status in one place.
          </p>
        </div>
      </header>
      <section className="max-w-[1440px] mx-auto px-8 lg:px-14 py-12 grid grid-cols-2 md:grid-cols-4 gap-6">
        <Stat label="Albums" value={stats.albums} />
        <Stat label="Tracks" value={stats.tracks} />
        <Stat label="Generators" value="Suno + Mureka" />
        <Stat label="Storage" value="R2 / music-house" />
      </section>
      <section className="max-w-[1440px] mx-auto px-8 lg:px-14 pb-16 grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card href="/library" title="Library" desc="Browse artists, albums, tracks." />
        <Card href="/create" title="Create" desc="Generate a track with Suno or Mureka." />
        <Card href="/playlists" title="Playlists" desc="Curate sets across the catalog." />
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="border border-rule-soft/60 rounded-md p-4">
      <div className="text-paper-dim font-mono text-[10px] uppercase tracking-wider">{label}</div>
      <div className="text-paper font-display text-3xl mt-2">{value}</div>
    </div>
  );
}

function Card({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <a href={href} className="block border border-rule-soft/60 rounded-md p-6 hover:border-amber/60 transition">
      <div className="text-paper font-display text-2xl">{title}</div>
      <div className="text-paper-dim text-sm mt-1">{desc}</div>
    </a>
  );
}
