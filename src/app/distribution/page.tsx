"use client";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

export default function DistributionPage() {
  const tracks = useQuery(api.tracks.list, {}) ?? [];
  const ready = tracks.filter((t) => !t.distributed && !t.archivedAt);
  const done = tracks.filter((t) => t.distributed);
  return (
    <main className="max-w-[1600px] mx-auto px-8 lg:px-12 py-12 animate-fi">
      <div className="mb-12">
        <p className="label-mono-amber">Distribution / 2026</p>
        <h1 className="mt-3 font-display text-[3.25rem] lg:text-[3.75rem] font-extrabold leading-[0.95] tracking-tight text-t1">
          Distribution<span className="text-cyan/60">.</span>
        </h1>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Column color="#34d399" label="Ready to Distribute" count={ready.length} tracks={ready.slice(0, 25)} />
        <Column color="#06b6d4" label="Distributed" count={done.length} tracks={done.slice(0, 25)} />
      </div>
    </main>
  );
}
function Column({ color, label, count, tracks }: { color: string; label: string; count: number; tracks: { _id: string; title: string; artistSlug: string }[] }) {
  return (
    <section className="rounded-xl border border-brd bg-card/60 backdrop-blur p-6">
      <div className="flex items-center justify-between mb-5" style={{ borderBottom: '1px solid ' + color + '30', paddingBottom: 8 }}>
        <h2 className="font-display text-[1.15rem] font-semibold" style={{ color }}>{label}</h2>
        <span className="label-mono">{count}</span>
      </div>
      <ul className="space-y-1">
        {tracks.length === 0 && <li className="text-center py-6 font-mono text-[0.6rem] uppercase tracking-[0.16em] text-t4">empty</li>}
        {tracks.map((t) => (
          <li key={t._id} className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-paper/[0.025]">
            <span className="text-[0.78rem] text-t1 truncate flex-1">{t.title}</span>
            <span className="font-mono text-[0.55rem] text-t3 ml-3">{t.artistSlug}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
