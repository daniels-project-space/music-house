"use client";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

export default function ArchivePage() {
  const tracks = useQuery(api.tracks.list, {}) ?? [];
  const archived = tracks.filter((t) => t.archivedAt);
  const unarchive = useMutation(api.tracks.unarchive);
  return (
    <main className="max-w-[1600px] mx-auto px-8 lg:px-12 py-12 animate-fi">
      <div className="mb-12">
        <p className="label-mono-amber">Archive / 2026</p>
        <h1 className="mt-3 font-display text-[3.25rem] lg:text-[3.75rem] font-extrabold leading-[0.95] tracking-tight text-t1">
          Archive<span className="text-amber/60">.</span>
        </h1>
      </div>
      <div className="rounded-xl border border-brd bg-card/60 backdrop-blur p-6">
        <div className="flex items-center justify-between mb-4">
          <p className="label-mono">Archived tracks</p>
          <span className="label-mono">{archived.length}</span>
        </div>
        {archived.length === 0 ? (
          <p className="text-center py-12 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-t4">No archived tracks</p>
        ) : (
          <ul className="space-y-1">
            {archived.map((t) => (
              <li key={t._id} className="flex items-center justify-between px-3 py-2 rounded hover:bg-paper/[0.025]">
                <div className="flex-1 min-w-0">
                  <div className="text-[0.82rem] text-t1 truncate">{t.title}</div>
                  <div className="font-mono text-[0.55rem] text-t3 truncate">{t.artistSlug}{t.albumSlug ? ' · ' + t.albumSlug : ''}</div>
                </div>
                <button
                  onClick={() => unarchive({ id: t._id })}
                  className="font-mono text-[0.55rem] uppercase tracking-[0.16em] px-3 py-1.5 rounded border border-amber/40 text-amber hover:bg-amber/[0.06] transition-colors"
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
