"use client";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

export default function ArchivePage() {
  const tracks = useQuery(api.tracks.list, {}) ?? [];
  const archived = tracks.filter((t) => t.archivedAt);
  const unarchive = useMutation(api.tracks.unarchive);
  const remove = useMutation(api.tracks.remove);

  return (
    <main className="px-5 sm:px-6 lg:px-8 pt-3 pb-32 animate-fi">
      <div className="rounded-lg border border-brd bg-card p-4">
        <div className="flex items-baseline justify-between mb-3 pb-2" style={{ borderBottom: "1px solid rgba(251,191,36,0.25)" }}>
          <h3 className="font-display text-[0.92rem] font-bold tracking-tight text-amber">Archive</h3>
          <span className="font-mono text-[0.5rem] uppercase tracking-[0.18em] text-paper-faint">{archived.length} trk</span>
        </div>
        {archived.length === 0 ? (
          <p className="text-center py-12 font-mono text-[0.55rem] uppercase tracking-[0.2em] text-paper-faint/60">no archived tracks</p>
        ) : (
          <ul className="space-y-0.5">
            {archived.map((t) => (
              <li key={t._id} className="group flex items-center gap-3 px-2.5 py-1.5 rounded hover:bg-paper/[0.04] transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="text-[0.78rem] font-display text-paper truncate leading-tight">{t.title}</div>
                  <div className="font-mono text-[0.52rem] uppercase tracking-[0.12em] text-paper-faint truncate mt-0.5">
                    {t.artistSlug}{t.albumSlug ? " · " + t.albumSlug : ""}
                  </div>
                </div>
                <button
                  onClick={() => unarchive({ id: t._id })}
                  className="font-mono text-[0.55rem] uppercase tracking-[0.14em] px-2 py-1 rounded border border-amber/40 text-amber hover:bg-amber/[0.08] transition-colors opacity-0 group-hover:opacity-100"
                >
                  Restore
                </button>
                <button
                  onClick={() => { if (confirm(`Permanently delete "${t.title}"?`)) remove({ id: t._id }); }}
                  className="font-mono text-[0.55rem] uppercase tracking-[0.14em] px-2 py-1 rounded border border-red/30 text-red hover:bg-red/[0.06] transition-colors opacity-0 group-hover:opacity-100"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
