"use client";
import { useQuery, useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export default function ArchivePage() {
  const tracks = useQuery(api.tracks.list, {}) ?? [];
  const archived = tracks.filter((t) => t.archivedAt);
  const unarchive = useMutation(api.tracks.unarchive);
  const remove = useMutation(api.tracks.remove);

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelected(new Set(archived.map((t) => t._id)));
  const clearSelection = () => setSelected(new Set());
  const exitSelectMode = () => {
    setSelecting(false);
    clearSelection();
  };

  const deleteSelected = async () => {
    const ids = Array.from(selected) as Id<"tracks">[];
    if (ids.length === 0) return;
    if (!confirm(`Permanently delete ${ids.length} track${ids.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
    await Promise.all(ids.map((id) => remove({ id })));
    exitSelectMode();
  };

  const deleteAll = async () => {
    if (archived.length === 0) return;
    if (!confirm(`Permanently delete ALL ${archived.length} archived tracks? This cannot be undone.`)) return;
    await Promise.all(archived.map((t) => remove({ id: t._id as Id<"tracks"> })));
    exitSelectMode();
  };

  const allSelected = archived.length > 0 && selected.size === archived.length;

  return (
    <main className="px-5 sm:px-6 lg:px-8 pt-3 pb-32 animate-fi">
      <div className="rounded-lg border border-brd bg-card p-4">
        <div
          className="flex items-center justify-between mb-3 pb-2 gap-3 flex-wrap"
          style={{ borderBottom: "1px solid rgba(251,191,36,0.25)" }}
        >
          <div className="flex items-baseline gap-3">
            <h3 className="font-display text-[0.92rem] font-bold tracking-tight text-amber">Archive</h3>
            <span className="font-mono text-[0.5rem] uppercase tracking-[0.18em] text-paper-faint">
              {archived.length} trk{selecting && selected.size > 0 ? ` · ${selected.size} selected` : ""}
            </span>
          </div>
          {archived.length > 0 && (
            <div className="flex items-center gap-2">
              {selecting ? (
                <>
                  <button
                    onClick={allSelected ? clearSelection : selectAll}
                    className="font-mono text-[0.55rem] uppercase tracking-[0.14em] px-2 py-1 rounded border border-brd text-paper-dim hover:text-paper hover:bg-paper/[0.04] transition-colors"
                  >
                    {allSelected ? "Clear" : "Select all"}
                  </button>
                  <button
                    onClick={deleteSelected}
                    disabled={selected.size === 0}
                    className="font-mono text-[0.55rem] uppercase tracking-[0.14em] px-2 py-1 rounded border border-red/30 text-red hover:bg-red/[0.06] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Delete selected ({selected.size})
                  </button>
                  <button
                    onClick={exitSelectMode}
                    className="font-mono text-[0.55rem] uppercase tracking-[0.14em] px-2 py-1 rounded border border-brd text-paper-dim hover:text-paper transition-colors"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setSelecting(true)}
                    className="font-mono text-[0.55rem] uppercase tracking-[0.14em] px-2 py-1 rounded border border-brd text-paper-dim hover:text-paper hover:bg-paper/[0.04] transition-colors"
                  >
                    Select
                  </button>
                  <button
                    onClick={deleteAll}
                    className="font-mono text-[0.55rem] uppercase tracking-[0.14em] px-2 py-1 rounded border border-red/40 text-red hover:bg-red/[0.08] transition-colors"
                  >
                    Delete all
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {archived.length === 0 ? (
          <p className="text-center py-12 font-mono text-[0.55rem] uppercase tracking-[0.2em] text-paper-faint/60">
            no archived tracks
          </p>
        ) : (
          <ul className="space-y-0.5">
            {archived.map((t) => {
              const isSelected = selected.has(t._id);
              return (
                <li
                  key={t._id}
                  className={
                    "group flex items-center gap-3 px-2.5 py-1.5 rounded transition-colors " +
                    (isSelected ? "bg-paper/[0.06]" : "hover:bg-paper/[0.04]")
                  }
                  onClick={selecting ? () => toggle(t._id) : undefined}
                  style={selecting ? { cursor: "pointer" } : undefined}
                >
                  {selecting && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(t._id)}
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0 w-3.5 h-3.5 accent-amber"
                      aria-label={`Select ${t.title}`}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[0.78rem] font-display text-paper truncate leading-tight">{t.title}</div>
                    <div className="font-mono text-[0.52rem] uppercase tracking-[0.12em] text-paper-faint truncate mt-0.5">
                      {t.artistSlug}
                      {t.albumSlug ? " · " + t.albumSlug : ""}
                    </div>
                  </div>
                  {!selecting && (
                    <>
                      <button
                        onClick={() => unarchive({ id: t._id })}
                        className="font-mono text-[0.55rem] uppercase tracking-[0.14em] px-2 py-1 rounded border border-amber/40 text-amber hover:bg-amber/[0.08] transition-colors opacity-0 group-hover:opacity-100"
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Permanently delete "${t.title}"?`)) remove({ id: t._id as Id<"tracks"> });
                        }}
                        className="font-mono text-[0.55rem] uppercase tracking-[0.14em] px-2 py-1 rounded border border-red/30 text-red hover:bg-red/[0.06] transition-colors opacity-0 group-hover:opacity-100"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
