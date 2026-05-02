"use client";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { PageHero, PageShell } from "@/components/page-hero";

export default function DistributionPage() {
  const tracks = useQuery(api.tracks.list, {}) ?? [];
  const ready = tracks.filter((t) => !t.distributed && !t.archivedAt);
  const done = tracks.filter((t) => t.distributed);
  return (
    <PageShell>
      <PageHero
        kicker="Distribution / 2026"
        title="Distribution"
        emphasis="queue"
        description="Tracks awaiting distribution to streaming platforms, plus what's already shipped."
        accent="cyan"
        stats={[
          { label: "Ready", value: ready.length },
          { label: "Distributed", value: done.length },
        ]}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Column color="#34d399" label="Ready to Distribute" tracks={ready.slice(0, 30)} />
        <Column color="#06b6d4" label="Distributed" tracks={done.slice(0, 30)} />
      </div>
    </PageShell>
  );
}
function Column({ color, label, tracks }: { color: string; label: string; tracks: { _id: string; title: string; artistSlug: string; albumSlug?: string }[] }) {
  return (
    <section className="rounded-2xl border border-rule-soft bg-card/50 backdrop-blur p-7">
      <div className="flex items-center justify-between mb-6 pb-3" style={{ borderBottom: '1px solid ' + color + '30' }}>
        <h3 className="font-display text-[1.25rem] font-semibold tracking-tight" style={{ color }}>{label}</h3>
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-paper-faint">{tracks.length}</span>
      </div>
      <ul className="space-y-1">
        {tracks.length === 0 && <li className="text-center py-12 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-t4">empty</li>}
        {tracks.map((t) => (
          <li key={t._id} className="flex items-center justify-between px-3 py-2 rounded hover:bg-paper/[0.025]">
            <div className="min-w-0 flex-1">
              <div className="text-[0.84rem] text-paper truncate">{t.title}</div>
              <div className="font-mono text-[0.56rem] uppercase tracking-[0.14em] text-paper-faint truncate mt-0.5">{t.artistSlug}{t.albumSlug ? ' · ' + t.albumSlug : ''}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
