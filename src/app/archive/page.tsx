"use client";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { PageHero, PageShell } from "@/components/page-hero";

export default function ArchivePage() {
  const tracks = useQuery(api.tracks.list, {}) ?? [];
  const archived = tracks.filter((t) => t.archivedAt);
  const unarchive = useMutation(api.tracks.unarchive);
  return (
    <PageShell>
      <PageHero
        kicker="Archive / 2026"
        title="Archive"
        emphasis="vault"
        description="Soft-deleted tracks. Restore any time — nothing is permanently lost from the catalog."
        accent="amber"
        stats={[{ label: "Archived", value: archived.length }]}
      />
      <div className="rounded-2xl border border-rule-soft bg-card/50 backdrop-blur p-7">
        {archived.length === 0 ? (
          <p className="text-center py-16 font-mono text-[0.62rem] uppercase tracking-[0.2em] text-t4">No archived tracks</p>
        ) : (
          <ul className="space-y-1">
            {archived.map((t) => (
              <li key={t._id} className="flex items-center justify-between px-3 py-2 rounded hover:bg-paper/[0.025]">
                <div className="min-w-0 flex-1">
                  <div className="text-[0.84rem] text-paper truncate">{t.title}</div>
                  <div className="font-mono text-[0.56rem] uppercase tracking-[0.14em] text-paper-faint truncate mt-0.5">{t.artistSlug}{t.albumSlug ? ' · ' + t.albumSlug : ''}</div>
                </div>
                <button onClick={() => unarchive({ id: t._id })} className="font-mono text-[0.56rem] uppercase tracking-[0.18em] px-3 py-1.5 rounded border border-amber/40 text-amber hover:bg-amber/[0.06] transition-colors">Restore</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
