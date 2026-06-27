"use client";
import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

/**
 * Niche Intelligence lab — demand-first creation.
 *
 * Research a niche (seed → /api/niche/research → nicheBank), browse researched
 * niches, copy a ready style prompt into the clipboard, and export the overview.
 * Grounded lyric writing reads the same nicheBank by slug.
 */
export function NicheLab() {
  const niches = useQuery(api.niches.list, {}) ?? [];
  const remove = useMutation(api.niches.remove);

  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const research = async () => {
    const s = seed.trim();
    if (!s) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/niche/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seed: s }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "research failed");
      setSeed("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  return (
    <section className="rounded-lg border border-brd bg-card p-4 backdrop-blur">
      <div className="flex items-center justify-between mb-4">
        <p className="label-mono">Niche Intelligence</p>
        <span className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-paper-faint">
          demand-first · Sonnet + YT autocomplete
        </span>
      </div>

      <div className="flex items-center gap-2">
        <input
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") research();
          }}
          placeholder="Seed a niche — e.g. outlaw country rap, dark academia lofi, phonk drift"
          className="flex-1 bg-paper/[0.04] border border-brd rounded-md px-2.5 py-2 text-[0.8rem] text-t1 outline-none focus:border-purple/50 transition-colors"
        />
        <button
          onClick={research}
          disabled={busy || !seed.trim()}
          className="px-4 py-2 rounded-md bg-purple text-paper font-display text-[0.8rem] hover:bg-purple/90 transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          {busy ? "Researching…" : "🔍 Research"}
        </button>
      </div>
      {error ? <p className="font-mono text-[0.6rem] text-red mt-2">{error}</p> : null}

      {niches.length > 0 ? (
        <div className="mt-4 space-y-1.5">
          {niches.map((n) => {
            const open = openId === n._id;
            const comp =
              n.competition === "low" ? "#34d399" : n.competition === "high" ? "#ef4444" : "#fbbf24";
            return (
              <div key={n._id} className="rounded border border-brd/50 hover:border-brd transition-colors">
                <button
                  onClick={() => setOpenId(open ? null : n._id)}
                  className="w-full text-left px-3 py-2 flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span
                      className="font-mono text-[0.6rem] text-paper-faint transition-transform"
                      style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
                    >
                      ▶
                    </span>
                    <span className="font-display text-[0.82rem] text-paper truncate">{n.name}</span>
                    <span className="font-mono text-[0.5rem] uppercase tracking-[0.14em] text-paper-faint truncate">
                      {n.primaryGenre}
                      {n.secondaryGenre ? ` / ${n.secondaryGenre}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    {n.competition ? (
                      <span
                        className="font-mono text-[0.5rem] uppercase tracking-[0.14em]"
                        style={{ color: comp }}
                      >
                        {n.competition} comp
                      </span>
                    ) : null}
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete niche "${n.name}"?`)) remove({ id: n._id as Id<"nicheBank"> });
                      }}
                      className="font-mono text-[0.55rem] text-paper-faint hover:text-red transition-colors px-1 cursor-pointer"
                    >
                      ✕
                    </span>
                  </span>
                </button>

                {open ? (
                  <div className="px-3 pb-3 space-y-2.5 text-[0.72rem] text-paper-dim">
                    <Meta label="Slug (use in lyrics)" value={n.slug} mono />
                    {n.bpmMin && n.bpmMax ? <Meta label="BPM" value={`${n.bpmMin}–${n.bpmMax}`} /> : null}
                    {n.keys?.length ? <Meta label="Keys" value={n.keys.join(", ")} /> : null}
                    {n.themes.length ? <Meta label="Themes" value={n.themes.join(" · ")} /> : null}
                    {n.moods.length ? <Meta label="Moods" value={n.moods.join(", ")} /> : null}
                    {n.instruments.length ? <Meta label="Instruments" value={n.instruments.join(", ")} /> : null}
                    {n.referenceArtists.length ? (
                      <Meta label="Reference (sound only)" value={n.referenceArtists.join(", ")} />
                    ) : null}
                    {n.relatedSearches.length ? (
                      <Meta label="Related searches" value={n.relatedSearches.join(" · ")} />
                    ) : null}

                    <div>
                      <p className="font-mono text-[0.5rem] uppercase tracking-[0.16em] text-paper-faint mb-1">
                        Style prompts (click to copy)
                      </p>
                      <div className="space-y-1">
                        {n.stylePrompts.map((p, i) => (
                          <button
                            key={i}
                            onClick={() => copy(p, `${n._id}-${i}`)}
                            className="block w-full text-left rounded border border-brd/40 hover:border-purple/40 px-2 py-1.5 text-[0.7rem] text-t1 transition-colors"
                          >
                            <span className="text-purple font-mono mr-1.5">
                              {copied === `${n._id}-${i}` ? "✓" : i + 1}
                            </span>
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={() => copy(n.overviewText, `${n._id}-overview`)}
                      className="font-mono text-[0.55rem] uppercase tracking-[0.14em] text-purple hover:text-pink transition-colors"
                    >
                      {copied === `${n._id}-overview` ? "✓ copied overview" : "⧉ copy full overview (.txt)"}
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-paper-faint/70 mt-4">
          No niches yet. Seed one above to research its genre, themes, BPM, instruments and style prompts.
        </p>
      )}
    </section>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="font-mono text-[0.5rem] uppercase tracking-[0.16em] text-paper-faint shrink-0 w-28 pt-0.5">
        {label}
      </span>
      <span className={mono ? "font-mono text-[0.7rem] text-t1" : "text-[0.72rem] text-paper-dim"}>{value}</span>
    </div>
  );
}
