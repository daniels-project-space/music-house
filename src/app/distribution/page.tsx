"use client";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export default function DistributionPage() {
  const tracks = useQuery(api.tracks.list, {}) ?? [];
  const setDistributed = useMutation(api.tracks.setDistributed);
  const ready = tracks.filter((t) => !t.distributed && !t.archivedAt);
  const done = tracks.filter((t) => t.distributed);

  return (
    <main className="px-5 sm:px-6 lg:px-8 pt-3 pb-32 animate-fi">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Column
          color="#34d399"
          label="Ready to Distribute"
          tracks={ready.slice(0, 60)}
          actionLabel="Distribute"
          onAction={(id) => setDistributed({ id, distributed: true })}
        />
        <Column
          color="#06b6d4"
          label="Distributed"
          tracks={done.slice(0, 60)}
          actionLabel="Recall"
          onAction={(id) => setDistributed({ id, distributed: false })}
        />
      </div>
    </main>
  );
}

type T = { _id: string; title: string; artistSlug: string; albumSlug?: string };

function Column({
  color,
  label,
  tracks,
  actionLabel,
  onAction,
}: {
  color: string;
  label: string;
  tracks: T[];
  actionLabel: string;
  onAction: (id: Id<"tracks">) => void;
}) {
  return (
    <section className="rounded-lg border border-brd bg-card p-4">
      <div className="flex items-center justify-between mb-3 pb-2" style={{ borderBottom: "1px solid " + color + "30" }}>
        <h3 className="font-display text-[0.92rem] font-bold tracking-tight" style={{ color }}>{label}</h3>
        <span className="font-mono text-[0.5rem] uppercase tracking-[0.18em] text-paper-faint">{tracks.length} trk</span>
      </div>
      <ul className="space-y-0.5">
        {tracks.length === 0 && (
          <li className="text-center py-10 font-mono text-[0.55rem] uppercase tracking-[0.18em] text-paper-faint/60">empty</li>
        )}
        {tracks.map((t) => (
          <li key={t._id} className="group flex items-center gap-3 px-2.5 py-1.5 rounded hover:bg-paper/[0.04] transition-colors">
            <div className="min-w-0 flex-1">
              <div className="text-[0.78rem] font-display text-paper truncate leading-tight">{t.title}</div>
              <div className="font-mono text-[0.52rem] uppercase tracking-[0.12em] text-paper-faint truncate mt-0.5">
                {t.artistSlug}{t.albumSlug ? " · " + t.albumSlug : ""}
              </div>
            </div>
            <button
              onClick={() => onAction(t._id as Id<"tracks">)}
              className="font-mono text-[0.55rem] uppercase tracking-[0.12em] px-2 py-1 rounded border opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ borderColor: color, color }}
            >
              {actionLabel}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
